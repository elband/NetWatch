# Rancangan Fase 1 — Fondasi Multi-Unit

> Status: **DIIMPLEMENTASIKAN 2026-07-02** (lihat ringkasan implementasi & catatan di bawah). Disusun 2026-07-02.
> Tujuan: NetWatch dipakai 3 unit — **Elektronika Bandara (ELB)**, **Alat-Alat Besar (AAB)**, **Water & Pump System (WPS)** — dengan data terisolasi per unit.

---

## 1. Keputusan desain (hasil diskusi)

| Keputusan | Pilihan |
|---|---|
| Arsitektur | Satu aplikasi + satu database, semua entitas diberi `unit_id` (bukan instance terpisah) |
| Hierarki | Super Admin → Koordinator (= admin unitnya) → Teknisi → Viewer |
| Role `admin` eksisting | **Berubah makna jadi Super Admin** (lintas unit). Tidak perlu nilai enum baru — label di UI saja yang diganti "Super Admin". Semua `requireRole('admin')` tetap berfungsi. |
| Koordinator | Hak penuh di unitnya: kelola user, master data, aset, insiden, jadwal, laporan, surat — **hanya unitnya** |
| Keanggotaan | **1 user = 1 unit** (kolom `unit_id`). Super admin `unit_id = NULL` (lintas unit) |
| Alat unit baru | Tanpa sensor/jaringan — aset non-IP menyusul di **Fase 2** (bukan bagian Fase 1) |
| Laporan bulanan & surat | Format sama semua unit; hanya nama unit & penandatangan (koordinator unit) yang mengikuti unit |
| Data eksisting | Semua di-backfill ke unit **ELB** saat migrasi |

---

## 2. Database

### 2.1 Tabel baru `units`

```sql
CREATE TABLE IF NOT EXISTS units (
  id INT AUTO_INCREMENT PRIMARY KEY,
  code VARCHAR(20) NOT NULL UNIQUE,      -- 'ELB', 'AAB', 'WPS'
  name VARCHAR(120) NOT NULL,            -- 'Elektronika Bandara', dst.
  description VARCHAR(255) DEFAULT NULL,
  icon VARCHAR(10) DEFAULT '🏢',
  active TINYINT(1) NOT NULL DEFAULT 1,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB;
```

Seed 3 baris (ELB, AAB, WPS) di `migrate.js` — idempotent (INSERT IGNORE by code).

### 2.2 Kolom `unit_id` pada tabel eksisting

Ditambahkan via `addColumnIfMissing()` di `migrate.js` (pola yang sudah ada), `INT DEFAULT NULL` + index + FK `ON DELETE SET NULL`.

**Wajib ter-scope (data operasional per unit):**

| Tabel | Catatan |
|---|---|
| `users` | `NULL` = super admin lintas unit |
| `devices` | `device_metrics`, `device_uptime_daily` TIDAK perlu kolom — turunan via `device_id` |
| `incidents` | Denormalisasi sendiri (bukan via device) karena `device_id` bisa NULL (manual/laporan publik). Pool insiden = per unit |
| `shifts`, `attendance`, `absence_reviews`, `leave_requests` | Jadwal & absensi per unit |
| `maintenance_windows` | |
| `public_reports` | Form publik `/lapor` memilih unit tujuan (dropdown baru) |
| `pengajuan_diklat`, `diklat_history` | |
| `kegiatan_non_rutin` | Kategori (`kegiatan_non_rutin_categories`) juga per unit |
| `nota_dinas` | Surat keluar + laporan bulanan per unit |
| `activities` | |
| `equipment_inspections`, `equipment_maintenance`, `equipment_poweron` | Logbook peralatan per unit |
| `skp` | |
| `assets`, `services`, `rooms` | Master data per unit |

**Nullable = global (bersama):**

| Tabel | Alasan |
|---|---|
| `locations` | Lokasi fisik bandara sama untuk semua unit; `NULL` = global, unit boleh menambah lokasi khususnya sendiri |
| `device_types` | Sama — tipe global + tambahan per unit |
| `documents` (+ turunannya) | `NULL` = SOP/dokumen bersama; berisi = dokumen internal unit |
| `wa_log` | Diisi untuk keperluan filter log per unit; NULL = sistem |

**Tidak diubah:** `notifications` (sudah per user), `settings` (tetap global di Fase 1), `audit_log` (cukup terlihat pelakunya), `incident_notes/duty/reports/collaborators`, `skp_*` anak (turunan parent).

### 2.3 Backfill

Setelah kolom ada: `UPDATE <tabel> SET unit_id = <id ELB> WHERE unit_id IS NULL` untuk semua tabel operasional (KECUALI `users` ber-role admin → biarkan NULL = super admin, dan tabel global). Idempotent — aman di-rerun.

---

## 3. Backend

### 3.1 Auth & JWT (`middleware/auth.js`, `authController.js`)

- Payload JWT ditambah `unit_id` (dan `unit_code` untuk display). Login memuat unit user.
- `requireAuth` tidak berubah signifikan (verifikasi `active` sudah ada; ikutkan `unit_id` segar dari DB agar pemindahan unit langsung efektif).
- **Middleware baru `unitScope`** (file baru `middleware/unitScope.js`):
  - Non-admin → `req.unitId = req.user.unit_id` (paksa, abaikan input klien).
  - Admin (super admin) → `req.unitId = header X-Unit-Id / query unit_id` bila dikirim; kosong = semua unit (`req.unitId = null`).
  - Helper `unitWhere(alias)` untuk menyisipkan `AND alias.unit_id = ?` secara konsisten.

### 3.2 Aturan koordinator = admin unit

- `userRoutes` dibuka untuk `koordinator` dengan batasan keras di controller:
  - hanya CRUD user ber-`unit_id` = unitnya;
  - tidak boleh membuat/mengedit user ber-role `admin`;
  - tidak boleh memindahkan user ke unit lain (hanya super admin);
  - tidak boleh menonaktifkan dirinya sendiri.
- `masterRoutes`, `settingsRoutes` (bagian non-global), `roomRoutes` → koordinator boleh, ter-scope unit.
- Pengaturan **global** (WA Gateway, SiKeren, timezone, jam shift default) tetap khusus super admin.

### 3.3 Scoping route (inti pekerjaan Fase 1)

Semua route list/detail/mutasi ditambah filter `unit_id` via `unitScope`. Terdampak (≈20 file): `deviceRoutes`, `incidentRoutes`, `dashboardRoutes`, `jadwalRoutes`, `attendanceRoutes`, `leaveRoutes`, `diklatRoutes`, `kegiatanNrRoutes`, `logbookRoutes`, `equipmentRoutes`, `suratRoutes`, `laporanRoutes`, `skpRoutes`, `performaRoutes`, `activityRoutes`, `publicReportRoutes`, `maintenanceRoutes`, `masterRoutes`, `userRoutes`, `slaRoutes`, `dokumenRoutes`, `waRoutes`.

Aturan kunci:
- **Pool insiden**: klaim/lihat hanya insiden `unit_id` = unit teknisi.
- **Insert selalu menulis `unit_id`** dari `req.unitId` (bukan dari body klien).
- Detail by-id juga dicek unitnya (bukan cuma list) — cegah IDOR antar unit.

### 3.4 Worker & notifikasi

- `pingQueue` / `monitorProbe`: tidak berubah (ping semua device apa pun unitnya; unit baru belum punya device ber-IP sampai Fase 2).
- `coordWatcher`: eskalasi/alert insiden → hanya koordinator **unit insiden tsb**.
- `notify.js` / WA (`waQueue`): penerima broadcast difilter per unit insiden/kejadian.
- `maintenanceReminderQueue`: reminder harian dikirim per unit ke teknisi dinas unit tsb.

---

## 4. Frontend

| Area | Perubahan |
|---|---|
| `types/index.ts` | Tipe `Unit`; `User` + `unit_id`, `unit?` |
| `AuthContext` | Simpan unit user; untuk admin: state `activeUnit` (pilihan "Semua Unit" / per unit) |
| `api/client.ts` | Interceptor kirim header `X-Unit-Id` bila admin memilih unit tertentu |
| `AppLayout` | **Unit switcher** di header (hanya admin): dropdown Semua Unit / ELB / AAB / WPS; nama unit tampil di sidebar untuk semua role |
| `NavConfig.ts` | Koordinator ditambah menu `users` (Manajemen User), `master` (Master Data), `settings` versi unit; label role admin → "Super Admin" |
| `Users.tsx` | Kolom & filter Unit; form: pilihan unit (admin saja); koordinator tidak bisa memilih role admin/unit lain |
| `Dashboard.tsx` | Mode admin "Semua Unit": kartu ringkasan per unit (device up/down, insiden aktif, teknisi dinas) + klik masuk ke unit |
| `MasterData.tsx` | Tab baru **Unit** (CRUD unit, admin saja); entitas lain menampilkan scope unitnya |
| `LaporPublik.tsx` | Dropdown "Unit tujuan" (ELB/AAB/WPS) pada form laporan publik |
| Halaman list lain | Tidak berubah secara UI — data otomatis ter-scope dari backend |

---

## 5. Urutan pengerjaan & estimasi

| # | Langkah | Bobot |
|---|---|---|
| 1 | Migrasi DB: tabel `units`, kolom `unit_id`, seed, backfill ELB | Kecil |
| 2 | Auth: JWT + `unitScope` middleware + aturan koordinator-admin-unit | Sedang |
| 3 | Scoping seluruh route + tulis `unit_id` di semua INSERT | **Besar** (inti) |
| 4 | Worker/notifikasi per unit (coordWatcher, WA, reminder) | Sedang |
| 5 | Frontend: types, AuthContext, unit switcher, NavConfig, Users, MasterData, LaporPublik | Sedang |
| 6 | Dashboard gabungan super admin | Sedang |
| 7 | Uji isolasi: login sebagai koordinator/teknisi tiap unit, pastikan tidak ada kebocoran lintas unit | Sedang |

## 6. Risiko utama & mitigasi

1. **Kebocoran data antar unit karena WHERE terlewat** (risiko terbesar). Mitigasi: semua filter lewat satu helper `unitScope`/`unitWhere` (bukan tulis-tangan per route) + checklist review per route file + uji manual butir 7.
2. **Query detail by-id tanpa cek unit (IDOR)**. Mitigasi: pola wajib `WHERE id = ? AND (unit_id = ? OR ? IS NULL)` di semua endpoint detail/mutasi.
3. **Token lama tanpa `unit_id`** setelah deploy. Mitigasi: `requireAuth` fallback baca `unit_id` dari DB bila tak ada di payload.
4. **Laporan bulanan/surat lama** (milik ELB) harus tetap terbuka & terverifikasi TTE. Mitigasi: backfill `nota_dinas.unit_id` = ELB; endpoint verifikasi publik `verify-tte` memang tanpa scoping (by token) — tidak terdampak.

## 7. Di luar lingkup Fase 1

- Aset non-IP + status manual, meter reading, QR per alat → **Fase 2**
- Checklist inspeksi, preventive maintenance interval jam, availability report → **Fase 3**
- Kop/identitas surat per unit, sparepart & stok → **Fase 4**

---

## 8. Catatan implementasi (2026-07-02)

Terimplementasi sesuai rancangan; uji isolasi lolos (koordinator/teknisi AAB tidak bisa melihat/mengklaim/mengedit data ELB; header X-Unit-Id diabaikan untuk non-admin; koordinator tidak bisa memberi peran admin). `tsc --noEmit` bersih; error ESLint yang tersisa adalah baseline lama proyek.

Penyimpangan kecil dari rancangan:
- `kegiatan_non_rutin_categories` dibiarkan **global** (bukan per unit) — kategori seed generik dipakai bersama.
- Menu **Pengaturan** tetap khusus super admin di Fase 1 (isinya konfigurasi global: WA Gateway, SiKeren, timezone); koordinator mendapat Manajemen User + Master Data.
- Unit switcher admin disimpan di `localStorage` (`netwatch_unit`) + header `X-Unit-Id`; ganti unit = reload halaman.

Keterbatasan yang diketahui (kandidat penyempurnaan):
- **Kode nomor surat** (mis. `ELBAND` pada `001/ELBAND/APTP/VII/2026`) masih global dari settings — urutan `seq` sudah per unit, tapi dua unit bisa punya nomor identik di bulan yang sama → diselesaikan di Fase 4 (kop/identitas per unit).
- `computeServices()` (kartu Layanan Kritis dashboard) menghitung status perangkat lintas unit; kartu tersimpan sudah terfilter unit.
- Notifikasi WA dokumen baru (`dokumenRoutes`) masih broadcast semua koordinator.
- Halaman publik bukti SKP memuat laporan TTE tanpa filter unit (akses tetap by token).
