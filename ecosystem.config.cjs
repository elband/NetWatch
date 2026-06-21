/**
 * PM2 ecosystem config for NetWatch production.
 * Usage:
 *   pm2 start ecosystem.config.cjs
 *   pm2 save && pm2 startup        ← auto-start on reboot
 *   pm2 install pm2-logrotate      ← WAJIB: rotasi log otomatis
 *
 * CATATAN SCALING: tetap `fork` 1 instance untuk saat ini. Untuk naik ke
 * `cluster` (multi-core) diperlukan: (1) @socket.io/redis-adapter agar broadcast
 * lintas instance, dan (2) worker latar belakang sudah dibatasi ke instance
 * primary (lihat server.js, guard NODE_APP_INSTANCE). Tanpa (1), notifikasi
 * real-time bisa tidak tersampaikan antar instance.
 */
module.exports = {
  apps: [
    {
      name: 'netwatch',
      cwd: './backend',
      script: 'src/server.js',
      interpreter: 'node',
      interpreter_args: '--experimental-vm-modules',
      instances: 1,
      exec_mode: 'fork',
      env: {
        NODE_ENV: 'production',
      },
      // Restart policy
      max_memory_restart: '768M',
      restart_delay: 3000,
      max_restarts: 10,
      kill_timeout: 8000,       // beri waktu koneksi & job selesai saat reload
      // Logging
      out_file: '../logs/netwatch-out.log',
      error_file: '../logs/netwatch-err.log',
      merge_logs: true,
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
    },
  ],
};
