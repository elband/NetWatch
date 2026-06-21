import { Client } from 'ssh2';
import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';
import { pool } from '../db/pool.js';
import { getDutyStatus } from '../config/shifts.js';
import { audit } from './audit.js';

export function attachSshNamespace(io) {
  const nsp = io.of('/ssh');

  nsp.use((socket, next) => {
    try {
      const token = socket.handshake.auth?.token;
      socket.user = jwt.verify(token, env.jwtSecret, { algorithms: ['HS256'] });
      next();
    } catch {
      next(new Error('unauthorized'));
    }
  });

  nsp.on('connection', (socket) => {
    let sshClient = null;
    let sshStream = null;
    let curDeviceId = null;
    let cmdBuf = ''; // buffer perintah hingga Enter, untuk audit trail SSH

    socket.on('ssh:connect', async ({ deviceId, username, password, privateKey }) => {
      try {
        // Bersihkan sesi lama bila klien mengirim ssh:connect dua kali (cegah kebocoran koneksi).
        sshStream?.end(); sshClient?.end(); sshStream = null; sshClient = null;

        // Otorisasi berdasarkan array roles (bukan hanya peran utama).
        const roles = socket.user.roles?.length ? socket.user.roles : [socket.user.role];
        if (!roles.some((r) => ['admin', 'koordinator', 'teknisi'].includes(r))) {
          socket.emit('ssh:error', 'Tidak punya akses SSH');
          return;
        }
        // Teknisi (yang bukan juga koordinator/admin) hanya boleh SSH saat on-duty.
        const isManager = roles.some((r) => r === 'admin' || r === 'koordinator');
        if (!isManager && roles.includes('teknisi')) {
          const { onDuty } = await getDutyStatus(pool, socket.user.id);
          if (!onDuty) {
            socket.emit('ssh:error', 'Akses SSH hanya tersedia saat Anda sedang on-duty.');
            return;
          }
        }
        const [rows] = await pool.query('SELECT * FROM devices WHERE id = ?', [deviceId]);
        const device = rows[0];
        if (!device) return socket.emit('ssh:error', 'Perangkat tidak ditemukan');
        curDeviceId = deviceId;
        await audit(socket.user, 'ssh_connect', 'device', deviceId, `SSH ke ${device.name} (${device.ssh_host || device.ip}) sebagai ${username || device.ssh_username || '-'}`);

      sshClient = new Client();
      sshClient
        .on('ready', () => {
          sshClient.shell((err, stream) => {
            if (err) return socket.emit('ssh:error', err.message);
            sshStream = stream;
            socket.emit('ssh:ready');
            stream.on('data', (data) => socket.emit('ssh:data', data.toString('utf8')));
            stream.on('close', () => {
              socket.emit('ssh:closed');
              sshClient?.end();
            });
          });
        })
        .on('error', (err) => socket.emit('ssh:error', err.message))
        .connect({
          host: device.ssh_host || device.ip,
          port: device.ssh_port || 22,
          username: username || device.ssh_username,
          password: password || undefined,
          privateKey: privateKey || undefined,
          readyTimeout: 8000,
        });
      } catch (e) {
        socket.emit('ssh:error', e?.message || 'Gagal memulai sesi SSH.');
      }
    });

    socket.on('ssh:input', (data) => {
      sshStream?.write(data);
      // Audit per-baris perintah: kumpulkan keystroke hingga Enter (CR/LF).
      const s = String(data ?? '');
      for (const ch of s) {
        if (ch === '\r' || ch === '\n') {
          const cmd = cmdBuf.trim();
          if (cmd) audit(socket.user, 'ssh_command', 'device', curDeviceId, cmd.slice(0, 200));
          cmdBuf = '';
        } else if (ch === '\x7f' || ch === '\b') {
          cmdBuf = cmdBuf.slice(0, -1); // backspace
        } else if (ch >= ' ') {
          cmdBuf += ch;
        }
      }
    });

    socket.on('ssh:resize', ({ rows, cols }) => {
      sshStream?.setWindow(rows, cols, 0, 0);
    });

    socket.on('disconnect', () => {
      sshStream?.end();
      sshClient?.end();
    });
  });
}
