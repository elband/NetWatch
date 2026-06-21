# NetWatch — High Availability & Disaster Recovery (HA/DR) Runbook

Dokumen operasional untuk ketersediaan tinggi & pemulihan bencana sistem ERP
operasional bandara. Target audiens: tim DevOps/Infra.

## 1. Target Pemulihan

| Metrik | Target | Keterangan |
|---|---|---|
| **RTO** (Recovery Time Objective) | ≤ 4 jam | Waktu maksimum sistem kembali beroperasi |
| **RPO** (Recovery Point Objective) | ≤ 15 menit | Kehilangan data maksimum (dicapai dgn binlog) |
| **Backup retention** | 30 hari lokal + 90 hari off-site | |
| **Restore drill** | Tiap kuartal | Uji restore ke staging, catat durasi aktual |

## 2. Komponen & Single Point of Failure (SPOF) saat ini

| Komponen | Status | Risiko bila tunggal | Mitigasi target |
|---|---|---|---|
| MySQL | 1 instance | Aplikasi mati total | Replikasi primary→replica + failover |
| Redis | 1 instance | Queue & notifikasi berhenti | Redis Sentinel (3 node) |
| Node/PM2 | 1 instance (fork) | Downtime saat restart | PM2 cluster + Socket.io Redis adapter |
| Nginx | 1 instance | Tidak ada entry point | 2 node + VIP/keepalived (opsional) |

## 3. Backup

### 3.1 Backup harian otomatis (sudah tersedia)
Script: `backend/scripts/backup-mysql.sh` (dump + gzip + retensi 30 hari).
```bash
# crontab -e
0 2 * * * /var/www/netwatch/backend/scripts/backup-mysql.sh >> /var/log/netwatch-backup.log 2>&1
```

### 3.2 Point-in-Time Recovery (PITR) — binlog
Aktifkan binary log untuk pemulihan presisi (RPO ≤ 15 menit):
```ini
# /etc/mysql/mysql.conf.d/mysqld.cnf
[mysqld]
server-id = 1
log_bin = /var/lib/mysql/mysql-bin
binlog_format = ROW
binlog_expire_logs_seconds = 1209600   # 14 hari
sync_binlog = 1
```

### 3.3 Off-site copy (WAJIB untuk DR)
Salin backup ke storage terpisah (beda lokasi fisik) setelah dump:
```bash
# tambahkan di akhir backup-mysql.sh atau cron terpisah
rclone copy /var/backups/netwatch remote:netwatch-backups   # atau: aws s3 sync ...
```

### 3.4 Verifikasi backup
Backup tanpa uji restore = tidak ada backup. Jalankan tiap kuartal:
```bash
backend/scripts/restore-mysql.sh /var/backups/netwatch/netwatch_<stamp>.sql.gz   # ke DB staging!
```

## 4. MySQL Replikasi (HA)

**Primary** (`my.cnf`): seperti 3.2 (server-id=1, log_bin aktif).
**Replica** (`my.cnf`): `server-id = 2`, `read_only = ON`, `relay_log = relay-bin`.

Setup replikasi (GTID disarankan):
```sql
-- Primary:
CREATE USER 'repl'@'%' IDENTIFIED BY '<kuat>';
GRANT REPLICATION SLAVE ON *.* TO 'repl'@'%';
-- Replica:
CHANGE REPLICATION SOURCE TO SOURCE_HOST='<primary-ip>', SOURCE_USER='repl',
  SOURCE_PASSWORD='<kuat>', SOURCE_AUTO_POSITION=1;
START REPLICA;  SHOW REPLICA STATUS\G   -- pastikan Replica_IO/SQL_Running=Yes
```
**Failover manual:** arahkan `DB_HOST` aplikasi ke replica, `SET GLOBAL read_only=OFF` di replica, restart PM2. (Otomatisasi: Orchestrator/ProxySQL — fase lanjutan.)

## 5. Redis HA — Sentinel

Jalankan 3 node Sentinel untuk failover otomatis:
```conf
# sentinel.conf
port 26379
sentinel monitor netwatch-master 127.0.0.1 6379 2
sentinel down-after-milliseconds netwatch-master 5000
sentinel failover-timeout netwatch-master 10000
requirepass <redis-password>
sentinel auth-pass netwatch-master <redis-password>
```
Aplikasi (ioredis) mendukung Sentinel — ubah `queueConnection.js`:
```js
new IORedis({
  sentinels: [{ host: 's1', port: 26379 }, { host: 's2', port: 26379 }, { host: 's3', port: 26379 }],
  name: 'netwatch-master',
  password: env.redis.password,
  maxRetriesPerRequest: null,
});
```

## 6. Horizontal Scaling (PM2 cluster) — prasyarat

Aplikasi sudah membatasi worker latar belakang ke instance primary
(`NODE_APP_INSTANCE`, lihat `server.js`). Sebelum mengaktifkan cluster:
1. Pasang `@socket.io/redis-adapter` agar broadcast notifikasi tersampaikan
   lintas instance:
   ```js
   import { createAdapter } from '@socket.io/redis-adapter';
   const pub = redisConnection.duplicate(), sub = redisConnection.duplicate();
   io.adapter(createAdapter(pub, sub));
   ```
2. Ubah `ecosystem.config.cjs`: `instances: 'max'`, `exec_mode: 'cluster'`.
3. Pastikan Nginx tetap satu upstream (PM2 yang load-balance antar worker).

## 7. Prosedur Pemulihan Bencana (langkah cepat)

1. **Triase**: tentukan komponen gagal (MySQL/Redis/Node/host).
2. **MySQL hilang**: promote replica → arahkan `DB_HOST` → restart PM2.
   Bila tak ada replica: provision DB baru → restore backup terakhir + replay binlog.
3. **Redis hilang**: Sentinel auto-failover; bila tidak ada, start Redis baru →
   job `wa_log` status `pending` di-requeue (lihat catatan di bawah).
4. **Host total**: provision host baru → deploy (lihat CLAUDE.md) → restore DB →
   set `.env` → `pm2 start ecosystem.config.cjs`.
5. **Verifikasi**: `/health` OK, login berhasil, ping sweep jalan, notifikasi WA terkirim.
6. **Post-mortem**: catat penyebab, durasi (RTO aktual), perbaikan preventif.

> Catatan re-queue WA: setelah Redis restart, job antrian hilang tetapi baris
> `wa_log` berstatus `pending` tetap ada di MySQL. Sediakan job pemulihan yang
> men-scan `SELECT id FROM wa_log WHERE status='pending'` lalu memasukkan ulang
> ke antrian saat startup (peningkatan yang direkomendasikan).

## 8. Monitoring & Alerting (prasyarat keandalan)

- Uptime: probe `/health` tiap 30–60 dtk (UptimeRobot/Prometheus blackbox).
- MySQL: `SHOW REPLICA STATUS` lag; koneksi pool mendekati limit.
- Redis: `INFO` memory & connected; status Sentinel.
- Queue: jumlah job `failed`/`pending` membengkak → alert.
- PM2: `pm2 monit` / `pm2-logrotate`; restart count.
- Aplikasi: pasang error tracking (Sentry) untuk error 5xx.
