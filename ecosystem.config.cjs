/**
 * PM2 ecosystem config for NetWatch production.
 * Usage:
 *   pm2 start ecosystem.config.cjs
 *   pm2 save && pm2 startup   ← auto-start on reboot
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
      max_memory_restart: '512M',
      restart_delay: 3000,
      max_restarts: 10,
      // Logging
      out_file: '../logs/netwatch-out.log',
      error_file: '../logs/netwatch-err.log',
      merge_logs: true,
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
    },
  ],
};
