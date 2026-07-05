# Panduan Update Aman NetWatch (produksi yang sudah jalan)

Server: Ubuntu · proses PM2 `netwatch` (dari `ecosystem.config.cjs`).

Update ini membawa **migrasi besar multi-unit + AAB + hardening keamanan** (sekali jalan).
Migrasi bersifat **aditif** (menambah tabel/kolom, mengisi `unit_id` data lama ke unit **ELB**) —
**tidak menghapus data bisnis**. Tapi karena ini perubahan skema besar pada DB berisi data,
ikuti langkah berikut agar 100% aman.

---

## A. Persiapan (2 menit)
```bash
cd /path/ke/NetWatch
git rev-parse --short HEAD        # ← CATAT commit lama (untuk rollback kode)
```
- Pastikan tool ada: `node npm pm2 mysqldump gzip`. `mysqldump` dari `sudo apt install mysql-client`.
- Pilih **jam sepi** — akan ada downtime singkat (~1–3 menit) saat migrasi.

## B. (Disarankan) Uji migrasi di DB salinan dulu — nol risiko ke produksi
Karena ini migrasi besar pertama, buktikan dulu di salinan:
```bash
# ganti USER/DB sesuai backend/.env
MYSQL_PWD='PASSWORD' mysqldump -u USER --single-transaction --routines --triggers netwatch_erp > /tmp/prod.sql
mysql -u root -p -e "CREATE DATABASE netwatch_try"
mysql -u root -p netwatch_try < /tmp/prod.sql
( cd backend && DB_NAME=netwatch_try npm run migrate )     # migrasi ke DB UJI
mysql -u root -p netwatch_try -e "SELECT id,code,name FROM units; SELECT COUNT(*) n_user_unit FROM users WHERE unit_id IS NOT NULL;"
mysql -u root -p -e "DROP DATABASE netwatch_try"           # bersihkan
```
Migrate DB uji **sukses tanpa error** + tampil unit ELB & AAB → aman lanjut ke produksi.

## C. Update produksi (downtime singkat — paling aman)
Hentikan app saat migrasi supaya tidak ada baris baru tanpa `unit_id`:
```bash
cd /path/ke/NetWatch
mkdir -p backups

# 1) BACKUP dulu (wajib)
MYSQL_PWD='PASSWORD' mysqldump -u USER --single-transaction --routines --triggers netwatch_erp \
  | gzip > backups/pre-update-$(date +%F-%H%M).sql.gz
[ -s backups/pre-update-*.sql.gz ] && echo "✔ backup OK" || { echo "❌ backup gagal — STOP"; }

# 2) Hentikan app (downtime mulai)
pm2 stop netwatch

# 3) Ambil kode + build
git pull --ff-only origin main
( cd frontend && npm install && npm run build )
( cd backend && npm install )

# 4) Migrasi DB (aditif/idempoten)
( cd backend && npm run migrate )        # JANGAN 'npm run seed'

# 5) Nyalakan lagi (downtime selesai)
pm2 start ecosystem.config.cjs           # atau: pm2 restart netwatch
pm2 save
```
> **Alternatif satu perintah:** `bash deploy.sh` (backup→pull→build→migrate→reload). Ia me-reload di
> akhir (downtime lebih pendek) dengan risiko kecil ada 1–2 baris ter-insert tanpa unit_id selama
> migrasi. Untuk update BESAR pertama ini lebih disarankan varian **pm2 stop** di atas; untuk update
> rutin berikutnya `bash deploy.sh` sudah cukup.

## D. Verifikasi setelah update
- `pm2 logs netwatch` → tidak ada error saat start.
- Login **super admin** (akun `admin` lama otomatis jadi Super Admin lintas unit).
- Header punya **switcher unit**: **ELB** & **AAB**.
- Data lama (perangkat, insiden, jadwal, surat, dll.) muncul di unit **ELB**.
- Absensi, insiden, laporan berjalan normal.

## E. Setelah update — aktifkan unit AAB (sekali)
Semua data lama ada di ELB. Untuk mulai memakai AAB:
1. Login super admin → pilih unit **AAB** di switcher header.
2. **Manajemen User** → buat 1 koordinator AAB + teknisi-teknisinya.
3. **Jadwal → Atur Jam Dinas** → set jam dinas AAB (absensi & hidupkan-peralatan buka 30 mnt sebelumnya).
4. **Master Data → Identitas Surat** → kode surat, kop, koordinator penandatangan AAB.
5. Daftarkan **Aset & Fasilitas** AAB (kondisi B/RR/RB, grup fasilitas), metrik & checklist bila perlu.

## F. Rollback bila ada masalah
```bash
pm2 stop netwatch
gunzip -c backups/pre-update-XXXX.sql.gz | MYSQL_PWD='PASSWORD' mysql -u USER netwatch_erp   # kembalikan DATA
git checkout <commit-lama>                                                                  # kembalikan KODE
( cd frontend && npm run build ) && ( cd backend && npm install )
pm2 start ecosystem.config.cjs
```

---
**Catatan:** update rutin selanjutnya (tanpa migrasi besar) cukup `bash deploy.sh`. Simpan file
backup `backups/*.sql.gz` di tempat aman minimal sampai update terbukti stabil beberapa hari.
