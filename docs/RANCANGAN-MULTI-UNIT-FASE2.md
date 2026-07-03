# Rancangan Fase 2 — Aset Non-IP, Meter Reading & QR

> Status: **RANCANGAN — belum dieksekusi.** Disusun 2026-07-03. Lanjutan dari [Fase 1](RANCANGAN-MULTI-UNIT-FASE1.md).
> Tujuan: unit **Alat-Alat Besar (AAB)** & **Water & Pump System (WPS)** dapat mendata peralatan fisik (tanpa IP/sensor), mencatat pembacaan meter manual, melaporkan & menangani kerusakan, serta menempel QR per alat.

---

## 1. Keputusan arsitektur

**Aset non-IP dimodelkan sebagai baris di tabel `devices`** (extend), BUKAN tabel terpisah. Alasan (dikonfirmasi kode yang ada):

- `pingService.js:83-88` sudah melewati perangkat ber-`ip` `"N/A…"` dan `monitor_enabled=0` — pola aset non-pingable sudah ada, tinggal diformalkan.
- Subsistem **logbook, inspeksi, maintenance, poweron** (`equipment_*`) dan **insiden** semuanya menempel ke `device_id`. Dengan extend, AAB/WPS langsung mewarisi fitur ini tanpa menduplikasi wiring.
- Frontend sudah punya konsep `hasIp()` (step SSH otomatis disembunyikan bila tak ada IP).

Konsekuensi: `devices` mendapat kolom pembeda `asset_class` + field aset fisik. Query jaringan yang ada tetap jalan (default `network`).

---

## 2. Database

### 2.1 Kolom baru pada `devices` (via `addColumnIfMissing`)

| Kolom | Tipe | Guna |
|---|---|---|
| `asset_class` | `ENUM('network','physical') DEFAULT 'network'` | Pembeda. `physical` = aset non-IP |
| `model` | `VARCHAR(120) NULL` | Tipe/model spesifik alat |
| `photo_url` | `VARCHAR(255) NULL` | Foto alat |
| `op_status` | `ENUM('operasional','standby','rusak','perbaikan') NULL` | Status manual aset fisik (network tetap pakai `status` online/offline) |
| `qr_token` | `CHAR(32) NULL UNIQUE` | Token QR per alat (diisi saat aset dibuat) |

> **Pakai ulang kolom yang sudah ada:** `merk`, `serial`, `tahun` (sudah ada di `devices` untuk Laporan Bulanan) dipakai sebagai brand / nomor seri / tahun aset. `category` & `type` = jenis alat. Tidak menambah kolom duplikat.

Untuk aset `physical`: `ip` di-set otomatis `'N/A-<id>'`, `monitor_enabled=0`, `inspect_required` mengikuti pilihan. Field jaringan (ssh/snmp/cpu/mem) diabaikan di UI.

### 2.2 Tabel baru `asset_readings` (pembacaan meter manual)

```sql
CREATE TABLE IF NOT EXISTS asset_readings (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  device_id INT NOT NULL,
  unit_id INT DEFAULT NULL,             -- denormalisasi (konsisten Fase 1)
  metric VARCHAR(40) NOT NULL,          -- 'jam_operasi','bbm','tekanan','debit','level', dst.
  value DECIMAL(12,2) NOT NULL,
  note VARCHAR(255) DEFAULT NULL,
  photo_url VARCHAR(255) DEFAULT NULL,  -- foto bukti (opsional, mis. foto hour meter)
  recorded_by INT DEFAULT NULL,
  recorded_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_ar_device_metric_time (device_id, metric, recorded_at),
  CONSTRAINT fk_ar_device FOREIGN KEY (device_id) REFERENCES devices(id) ON DELETE CASCADE,
  CONSTRAINT fk_ar_user FOREIGN KEY (recorded_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB;
```

Satu baris = satu metrik pada satu waktu. Grafik tren = query per `(device_id, metric)` urut `recorded_at` (pola sama seperti `device_metrics`).

### 2.3 Tabel baru `asset_metric_types` (definisi metrik per unit — dapat dikonfigurasi koordinator)

```sql
CREATE TABLE IF NOT EXISTS asset_metric_types (
  id INT AUTO_INCREMENT PRIMARY KEY,
  unit_id INT DEFAULT NULL,             -- NULL = global default
  metric_key VARCHAR(40) NOT NULL,      -- 'jam_operasi'
  label VARCHAR(80) NOT NULL,           -- 'Jam Operasi (Hour Meter)'
  satuan VARCHAR(20) DEFAULT NULL,      -- 'jam','liter','bar','m³/j','%'
  is_cumulative TINYINT(1) NOT NULL DEFAULT 0, -- true utk hour meter (nilai selalu naik) → PM interval Fase 3
  sort_order INT NOT NULL DEFAULT 0,
  active TINYINT(1) NOT NULL DEFAULT 1,
  UNIQUE KEY uniq_amt (unit_id, metric_key)
) ENGINE=InnoDB;
```

Seed default saat migrasi:
- **AAB**: `jam_operasi` (jam, kumulatif), `bbm` (liter), `kondisi` opsional.
- **WPS**: `jam_pompa` (jam, kumulatif), `tekanan` (bar), `debit` (m³/j), `level_air` (%).

`is_cumulative` menyiapkan Fase 3 (preventive maintenance berbasis interval jam operasi).

### 2.4 Scoping & backfill

- `asset_readings.unit_id`, `asset_metric_types.unit_id` mengikuti pola Fase 1 (via `unitScope`).
- Tidak ada backfill data lama (aset fisik = data baru). Kolom `devices.asset_class` default `network` → seluruh perangkat ELB lama tetap jaringan.

---

## 3. Backend

### 3.1 Aset fisik (extend `deviceController` + `deviceRoutes`)

- **Create/Update**: bila `asset_class='physical'` → `ip` tidak wajib; server set `ip='N/A-<id>'`, `monitor_enabled=0`, generate `qr_token`. Validasi jaringan (ip/ssh) dilewati.
- **List**: parameter `?class=physical|network` (default menampilkan sesuai halaman). Tetap ter-scope unit.
- **Detail by-id**: cek unit (anti-IDOR) — sudah ada dari Fase 1.

### 3.2 Meter reading (endpoint baru)

- `GET  /api/devices/:id/readings?metric=&from=&to=` → daftar/agregasi untuk grafik.
- `POST /api/devices/:id/readings` → simpan pembacaan (metric, value, note, foto opsional). `unit_id` dari device. Multer untuk foto (reuse `middleware/upload.js`).
- `GET  /api/devices/:id/readings/latest` → nilai terakhir tiap metrik (kartu ringkas).

### 3.3 Master metrik

- `GET/POST/PUT/DELETE /api/master/asset-metrics` (di `masterRoutes`) — koordinator kelola metrik unitnya; super admin semua unit.

### 3.4 QR & halaman publik aset

- `GET /api/public/asset/:token` → info ringkas aset (nama, unit, lokasi, status) untuk landing scan. Tanpa auth, hanya data non-sensitif.
- QR meng-encode URL `/@/aset/<qr_token>` → landing publik dengan tombol **"Lapor Kerusakan"** yang membuka `/lapor` ter-prefill (unit + nama/inventaris alat). Memakai alur Pelaporan QR + `public_reports` yang sudah ada (Fase 1 sudah menambah `public_reports.unit_id`).
- **Dua audiens (keputusan pengguna):** bila landing dibuka oleh teknisi yang sudah login, tampilkan tombol tambahan **"Input Meter / Detail Aset"** yang mengarah ke halaman Aset (detail + form pembacaan). Publik/anonim hanya melihat tombol Lapor Kerusakan.
- `GET /api/devices/:id/qr.png` (auth) → unduh/print QR untuk ditempel.

### 3.5 Insiden aset non-IP

Tidak ada kerja baru — insiden sudah mendukung `device_id` apa pun dan `hasIp()` menyembunyikan step SSH. Insiden aset fisik masuk lewat: (a) aduan publik via QR, atau (b) dibuat manual koordinator/teknisi. Semua ter-scope unit dari Fase 1.

---

## 4. Frontend

| Area | Perubahan |
|---|---|
| `types/index.ts` | `Device` + `asset_class`, `brand`, `model`, `serial_no`, `year_made`, `photo_url`, `op_status`, `qr_token`; tipe `AssetReading`, `AssetMetricType` |
| Halaman baru `Aset.tsx` | Daftar aset fisik unit (kartu/tabel: nama, merk/model, serial, lokasi, `op_status` badge, nilai meter terakhir). Form tambah/edit aset fisik. Aksi: input pembacaan, lihat tren, cetak QR, lapor/ubah status |
| `AssetReadingModal` (baru) | Form input pembacaan (pilih metrik unit, nilai, catatan, foto) + grafik tren per metrik (reuse pola `DeviceMetricsModal`) |
| `NavConfig.ts` | Menu **"Aset / Peralatan"** (`aset`) untuk admin, koordinator, teknisi. Untuk unit AAB/WPS ini menu utama; ELB tetap fokus "Perangkat" |
| `MasterData.tsx` | Tab **Metrik Aset** (kelola `asset_metric_types` per unit) |
| `LaporPublik.tsx` | Terima query `?aset=<token>` → prefill unit + identitas alat |
| Landing publik `/@/aset/:token` | Halaman ringkas aset + tombol Lapor Kerusakan (publik, tanpa login) |
| `App.tsx` | Route `aset` (privat) + landing aset publik |

Status `op_status` diubah manual (dropdown di kartu aset / saat lapor selesai perbaikan). Perubahan status dicatat ke `incident_notes`/`activities` bila terkait insiden.

---

## 5. Urutan pengerjaan

| # | Langkah | Bobot |
|---|---|---|
| 1 | Migrasi DB: kolom `devices`, tabel `asset_readings` + `asset_metric_types` + seed metrik AAB/WPS | Kecil |
| 2 | Backend: CRUD aset fisik (extend deviceController) + generate qr_token | Sedang |
| 3 | Backend: endpoint readings + master metrik | Sedang |
| 4 | Backend: QR + landing publik aset + prefill lapor | Kecil |
| 5 | Frontend: halaman `Aset.tsx` + form aset fisik | Sedang |
| 6 | Frontend: `AssetReadingModal` (input + grafik tren) | Sedang |
| 7 | Frontend: tab Metrik Aset di Master, menu nav, landing publik, prefill lapor | Sedang |
| 8 | Uji: buat aset AAB/WPS, input meter, lapor via QR → insiden, cek isolasi unit | Sedang |

## 6. Risiko & mitigasi

1. **Overload tabel `devices`** (network + physical dalam satu tabel). Mitigasi: `asset_class` sebagai pembeda tegas; UI terpisah (halaman Perangkat vs Aset); query jaringan default `network`.
2. **Ping worker tak sengaja memantau aset fisik.** Mitigasi: `physical` selalu `ip='N/A-*'` + `monitor_enabled=0` → sudah dilewati `pingService.js:86,88`. Uji eksplisit.
3. **QR token bocor/ditebak.** Mitigasi: token acak 32 char; endpoint publik hanya paparkan data non-sensitif; aksi hanya "lapor" (bukan mutasi aset).
4. **Metrik antar unit tercampur.** Mitigasi: `asset_metric_types.unit_id` + `unitScope`; dropdown metrik hanya menampilkan milik unit aset.

## 7. Di luar lingkup Fase 2 (→ Fase 3)

- Checklist inspeksi terstruktur per jenis alat.
- Preventive maintenance berbasis interval jam operasi (pakai `is_cumulative`) / kalender + reminder WA.
- Availability report aset non-IP (MTBF/MTTR, % operasional).
