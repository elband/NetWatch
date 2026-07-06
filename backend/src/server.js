import http from 'http';
import jwt from 'jsonwebtoken';
import { Server } from 'socket.io';
import { env } from './config/env.js';
import { logger } from './config/logger.js';
import { createApp } from './app.js';
import { setNotifyIo } from './services/notify.js';
import { attachSshNamespace } from './services/sshBridge.js';
import { startCoordWatcher } from './services/coordWatcher.js';
import { schedulePingSweep, startPingWorker } from './jobs/pingQueue.js';
import { startWaWorker } from './jobs/waWorker.js';
import { purgeOldWaLogs } from './jobs/waQueue.js';
import { scheduleMaintenanceReminder, startMaintenanceReminderWorker } from './jobs/maintenanceReminderQueue.js';
import { scheduleMetricsMaintenance, startMetricsWorker, runMetricsMaintenance } from './jobs/metricsQueue.js';
import { initTimezoneFromSettings } from './services/timezone.js';
import { loadShiftWindows } from './config/shifts.js';
import { pool } from './db/pool.js';

const app = createApp();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: env.corsOrigin, credentials: true } });
app.set('io', io); // agar route biasa bisa emit (mis. notifikasi maintenance selesai)
setNotifyIo(io); // Notification Center: kirim notifikasi real-time per-user

// Ambil JWT dari cookie HttpOnly pada handshake socket (fallback ke event/auth handshake).
function tokenFromCookie(socket) {
  const raw = socket.handshake.headers?.cookie || '';
  const m = /(?:^|;\s*)netwatch_token=([^;]+)/.exec(raw);
  return m ? decodeURIComponent(m[1]) : null;
}
function joinUserRoom(socket, token) {
  try {
    const u = jwt.verify(String(token || ''), env.jwtSecret, { algorithms: ['HS256'] });
    if (u?.id) socket.join(`user:${u.id}`);
    // Room per-unit: dipakai untuk siaran ter-scope (mis. services:update) agar
    // data unit lain tidak bocor ke dashboard. unit_id dari klaim token; efektif
    // ulang setelah login/reconnect bila unit user dipindah.
    if (u?.unit_id != null) socket.join(`unit:${u.unit_id}`);
  } catch { /* token tidak valid — abaikan */ }
}

io.on('connection', (socket) => {
  const cookieToken = tokenFromCookie(socket);
  if (cookieToken) joinUserRoom(socket, cookieToken);
  else if (socket.handshake.auth?.token) joinUserRoom(socket, socket.handshake.auth.token);
  socket.on('notif:auth', (token) => joinUserRoom(socket, token));
  socket.on('disconnect', () => {});
});

attachSshNamespace(io);
// Pulihkan zona waktu server dari Pengaturan (semua instance, sebelum melayani request).
await initTimezoneFromSettings();
// Muat aturan jam dinas (shift_windows) dari Pengaturan agar logika on-duty memakai
// jam kustom yang diatur Koordinator (fallback ke default bila belum diatur).
await loadShiftWindows(pool).catch(() => {});
// Worker latar belakang & penjadwal hanya jalan di SATU instance (PM2 primary),
// agar tidak terjadi duplikasi ping/notifikasi saat di-scale ke cluster.
const isPrimary = !process.env.NODE_APP_INSTANCE || process.env.NODE_APP_INSTANCE === '0';
if (isPrimary) {
  startPingWorker(io);
  startWaWorker(io);
  startMaintenanceReminderWorker();
  startMetricsWorker();
  startCoordWatcher(io);
  await schedulePingSweep();
  // Pengingat WA harian (08:00) ke teknisi dinas ttg maintenance peralatan terjadwal.
  await scheduleMaintenanceReminder();
  // Rollup uptime harian + retensi metrik mentah (00:10) + sekali saat start.
  await scheduleMetricsMaintenance();
  runMetricsMaintenance().then((r) => logger.info(r, '[metrics] maintenance awal')).catch(() => {});
  // Retensi log WA (PDP): bersihkan saat start + harian.
  purgeOldWaLogs().then((n) => n && logger.info(`[wa_log] retensi: ${n} log lama dihapus`)).catch(() => {});
  setInterval(() => { purgeOldWaLogs().catch(() => {}); }, 24 * 60 * 60 * 1000);
}

server.listen(env.port, () => {
  logger.info(`NetWatch backend running on http://localhost:${env.port} (TZ=${env.appTz})`);
});
