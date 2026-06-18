import { Client } from 'ssh2';
import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';
import { pool } from '../db/pool.js';
import { getDutyStatus } from '../config/shifts.js';

export function attachSshNamespace(io) {
  const nsp = io.of('/ssh');

  nsp.use((socket, next) => {
    try {
      const token = socket.handshake.auth?.token;
      socket.user = jwt.verify(token, env.jwtSecret);
      next();
    } catch {
      next(new Error('unauthorized'));
    }
  });

  nsp.on('connection', (socket) => {
    let sshClient = null;
    let sshStream = null;

    socket.on('ssh:connect', async ({ deviceId, username, password, privateKey }) => {
      if (!['admin', 'koordinator', 'teknisi'].includes(socket.user.role)) {
        socket.emit('ssh:error', 'Tidak punya akses SSH');
        return;
      }
      // Teknisi hanya boleh SSH saat sedang on-duty.
      if (socket.user.role === 'teknisi') {
        const { onDuty } = await getDutyStatus(pool, socket.user.id);
        if (!onDuty) {
          socket.emit('ssh:error', 'Akses SSH hanya tersedia saat Anda sedang on-duty.');
          return;
        }
      }
      const [rows] = await pool.query('SELECT * FROM devices WHERE id = ?', [deviceId]);
      const device = rows[0];
      if (!device) return socket.emit('ssh:error', 'Perangkat tidak ditemukan');

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
    });

    socket.on('ssh:input', (data) => {
      sshStream?.write(data);
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
