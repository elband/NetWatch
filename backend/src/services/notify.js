import { pool } from '../db/pool.js';

// Socket.IO didaftarkan dari server.js agar service ini bisa mengirim real-time
// tanpa harus meneruskan io ke setiap pemanggil.
let _io = null;
export function setNotifyIo(io) { _io = io; }

// Metadata per-jenis notifikasi: prioritas default + link halaman terkait.
// priority → warna di UI: kritis=merah, warning=kuning, selesai=hijau, info=biru.
const TYPE_META = {
  ticket_new: { priority: 'warning', link: '/incidents' },
  ticket_assigned: { priority: 'info', link: '/my-incidents' },
  ticket_sla: { priority: 'kritis', link: '/incidents' },
  ticket_done: { priority: 'selesai', link: '/reports' },
  ticket_collab: { priority: 'info', link: '/my-dashboard' },
  diklat_new: { priority: 'info', link: '/diklat' },
  diklat_approved: { priority: 'selesai', link: '/diklat' },
  diklat_rejected: { priority: 'warning', link: '/diklat' },
  public_new: { priority: 'info', link: '/pelaporan-qr' },
  public_critical: { priority: 'kritis', link: '/pelaporan-qr' },
  doc_review: { priority: 'warning', link: '/dokumen' },
  sop_new: { priority: 'info', link: '/dokumen' },
  sop_expiring: { priority: 'warning', link: '/dokumen' },
  knr_new: { priority: 'info', link: '/kegiatan-nr' },
  approval_pending: { priority: 'warning', link: '/coord-dashboard' },
};

// Buat satu notifikasi untuk satu user + kirim real-time + update unread count.
export async function createNotification({ userId, title, message = null, type, priority, refId = null, refType = null, link }) {
  if (!userId || !title || !type) return null;
  const meta = TYPE_META[type] || {};
  const prio = priority || meta.priority || 'info';
  const finalLink = link || meta.link || null;
  const [r] = await pool.query(
    `INSERT INTO notifications (user_id, title, message, type, priority, reference_id, reference_type, link, is_read)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)`,
    [userId, String(title).slice(0, 160), message ? String(message).slice(0, 400) : null, type, prio, refId != null ? String(refId) : null, refType, finalLink]
  );
  const [[row]] = await pool.query('SELECT * FROM notifications WHERE id = ?', [r.insertId]);
  if (_io) {
    try {
      const [[c]] = await pool.query('SELECT COUNT(*) c FROM notifications WHERE user_id = ? AND is_read = 0', [userId]);
      _io.to(`user:${userId}`).emit('notification:new', { notification: row, unread: c.c });
    } catch (e) { console.warn('[notify] gagal emit real-time:', e?.message); }
  }
  return row;
}

// Ambil id user aktif berdasarkan peran (cek kolom role ATAU array roles).
// opts.unitId: batasi ke satu unit — user lintas unit (unit_id NULL, super admin) tetap ikut.
export async function userIdsByRole(roles, opts = {}) {
  const list = Array.isArray(roles) ? roles : [roles];
  if (!list.length) return [];
  const cond = list.map(() => '(role = ? OR JSON_CONTAINS(roles, ?))').join(' OR ');
  const params = [];
  for (const role of list) { params.push(role, JSON.stringify(role)); }
  let sql = `SELECT id FROM users WHERE active = 1 AND (${cond})`;
  if (opts.unitId != null) {
    sql += ' AND (unit_id IS NULL OR unit_id = ?)';
    params.push(opts.unitId);
  }
  const [rows] = await pool.query(sql, params);
  return rows.map((x) => x.id);
}

// Kirim notifikasi yang sama ke semua user dengan peran tertentu.
// opts.unitId: hanya ke user unit tsb (+ super admin lintas unit).
export async function notifyRoles(roles, payload, opts = {}) {
  const ids = await userIdsByRole(roles, opts);
  return notifyUsers(ids, payload);
}

// Kirim ke daftar user id (deduplikasi, abaikan kosong).
export async function notifyUsers(ids, payload) {
  const out = [];
  for (const id of [...new Set((ids || []).filter(Boolean))]) {
    out.push(await createNotification({ ...payload, userId: id }));
  }
  return out;
}
