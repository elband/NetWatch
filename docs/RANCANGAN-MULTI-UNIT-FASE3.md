# Rancangan Fase 3 — Checklist Inspeksi, Preventive Maintenance & Availability

> Status: **DIIMPLEMENTASIKAN & TERUJI 2026-07-03.** Lanjutan dari [Fase 2](RANCANGAN-MULTI-UNIT-FASE2.md).
> Uji: E2E API (checklist rusak→insiden, PM hours due+reset, PM calendar overdue, availability MTBF/MTTR, isolasi antar unit) + verifikasi browser (checklist run→insiden INC, PM due badge + Tandai Selesai + reset anchor, halaman Availability). `tsc --noEmit` bersih.
> Tujuan: operasional harian aset fisik (AAB/WPS) — checklist inspeksi terstruktur per jenis alat, preventive maintenance terjadwal (interval jam operasi ATAU kalender) dengan reminder WA, dan laporan availability (uptime operasional, MTBF/MTTR) sebagai pengganti SLA untuk aset non-IP.

---

## 1. Ringkasan & prinsip

- Semua fitur menempel ke **aset fisik = baris `devices` `asset_class='physical'`** (Fase 2) dan ter-scope unit (pola `unitScope` Fase 1).
- **Tidak menduplikasi** yang sudah ada: `equipment_maintenance` (rencana kalender per bulan + reminder WA harian) tetap dipakai untuk tugas maintenance ad-hoc. Fase 3 menambah PM **berulang berbasis interval** (jam operasi/kalender) yang menghitung "jatuh tempo" otomatis — hal yang belum ada.
- Tiga sub-modul, dikerjakan & di-commit bertahap: **3a checklist**, **3b preventive maintenance**, **3c availability report**.

---

## 2. Database (semua via migrate.js idempoten + schema.sql)

### 2a. Checklist inspeksi

```sql
-- Template checklist per unit (opsional dikaitkan ke jenis alat via `category`).
CREATE TABLE checklist_templates (
  id INT AUTO_INCREMENT PRIMARY KEY,
  unit_id INT DEFAULT NULL,
  name VARCHAR(120) NOT NULL,        -- 'Inspeksi Harian Excavator'
  category VARCHAR(80) DEFAULT NULL, -- cocokkan ke devices.category/type (NULL = semua)
  active TINYINT(1) NOT NULL DEFAULT 1,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_ct_unit (unit_id)
);
CREATE TABLE checklist_template_items (
  id INT AUTO_INCREMENT PRIMARY KEY,
  template_id INT NOT NULL,
  label VARCHAR(160) NOT NULL,       -- 'Level oli mesin', 'Tekanan ban'
  sort_order INT NOT NULL DEFAULT 0,
  CONSTRAINT fk_cti_tpl FOREIGN KEY (template_id) REFERENCES checklist_templates(id) ON DELETE CASCADE
);
-- Satu pelaksanaan inspeksi pada satu aset.
CREATE TABLE checklist_runs (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  device_id INT NOT NULL,
  unit_id INT DEFAULT NULL,
  template_id INT DEFAULT NULL,
  run_date DATE NOT NULL,
  overall ENUM('baik','perhatian','rusak') NOT NULL DEFAULT 'baik',
  note VARCHAR(255) DEFAULT NULL,
  photo_url VARCHAR(255) DEFAULT NULL,
  done_by INT DEFAULT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_cr_device_date (device_id, run_date),
  CONSTRAINT fk_cr_device FOREIGN KEY (device_id) REFERENCES devices(id) ON DELETE CASCADE
);
CREATE TABLE checklist_run_items (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  run_id BIGINT NOT NULL,
  label VARCHAR(160) NOT NULL,       -- snapshot label saat run (aman bila template diubah)
  result ENUM('ok','tidak','na') NOT NULL DEFAULT 'ok',
  note VARCHAR(255) DEFAULT NULL,
  CONSTRAINT fk_cri_run FOREIGN KEY (run_id) REFERENCES checklist_runs(id) ON DELETE CASCADE
);
```

### 2b. Preventive maintenance (interval)

```sql
CREATE TABLE asset_pm_plans (
  id INT AUTO_INCREMENT PRIMARY KEY,
  device_id INT NOT NULL,
  unit_id INT DEFAULT NULL,
  name VARCHAR(120) NOT NULL,            -- 'Ganti oli tiap 250 jam'
  trigger_type ENUM('hours','calendar') NOT NULL DEFAULT 'hours',
  metric_key VARCHAR(40) DEFAULT NULL,   -- metrik kumulatif utk 'hours' (mis. jam_operasi)
  interval_hours DECIMAL(10,2) DEFAULT NULL,
  interval_days INT DEFAULT NULL,
  anchor_value DECIMAL(12,2) DEFAULT NULL, -- nilai meter saat servis terakhir (untuk 'hours')
  anchor_date DATE DEFAULT NULL,           -- tanggal servis terakhir (untuk 'calendar')
  active TINYINT(1) NOT NULL DEFAULT 1,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_pm_device (device_id), INDEX idx_pm_unit (unit_id),
  CONSTRAINT fk_pm_device FOREIGN KEY (device_id) REFERENCES devices(id) ON DELETE CASCADE
);
CREATE TABLE asset_pm_history (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  plan_id INT NOT NULL,
  device_id INT NOT NULL,
  done_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  meter_value DECIMAL(12,2) DEFAULT NULL,
  note VARCHAR(255) DEFAULT NULL,
  done_by INT DEFAULT NULL,
  CONSTRAINT fk_pmh_plan FOREIGN KEY (plan_id) REFERENCES asset_pm_plans(id) ON DELETE CASCADE
);
```

**Perhitungan jatuh tempo (backend, bukan kolom tersimpan — selalu segar):**
- `hours`: `current` = pembacaan terakhir `metric_key`; `due_at_value = anchor_value + interval_hours`; `remaining = due_at_value - current`; **due** bila `remaining <= 0`. Progres `%` = `(current - anchor_value) / interval_hours`.
- `calendar`: `due_date = anchor_date + interval_days`; **due** bila `today >= due_date`.
- "Selesaikan PM" → tulis `asset_pm_history` + set `anchor_value = current` / `anchor_date = today` (reset siklus).

### 2c. Riwayat status → availability

```sql
-- Log setiap perubahan op_status aset (sumber MTBF/MTTR & % operasional).
CREATE TABLE asset_status_log (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  device_id INT NOT NULL,
  unit_id INT DEFAULT NULL,
  op_status ENUM('operasional','standby','rusak','perbaikan') NOT NULL,
  changed_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  changed_by INT DEFAULT NULL,
  INDEX idx_asl_device_time (device_id, changed_at),
  CONSTRAINT fk_asl_device FOREIGN KEY (device_id) REFERENCES devices(id) ON DELETE CASCADE
);
```
- Ditulis di `createAsset` (status awal) & `setAssetStatus` (Fase 2 — tambah INSERT log).
- **Availability** periode = durasi `operasional` / durasi total (kecuali `standby`? → *keputusan*: `standby` dihitung sebagai direncanakan non-operasi, tidak menurunkan availability, seperti maintenance window pada SLA jaringan).
- **Failure** = transisi masuk `rusak`. **MTTR** = rata-rata durasi (`rusak`+`perbaikan`) per kejadian. **MTBF** = total waktu operasional / jumlah failure.

---

## 3. Backend

Rute baru di bawah `/api/aset` (assetController/assetRoutes yang sudah ada) & satu file report:

**3a Checklist**
- `GET/POST/PUT/DELETE /api/aset/checklist-templates` (+ item) — koordinator kelola template unit.
- `GET  /api/aset/:id/checklist` — template yang cocok utk aset + riwayat run ringkas.
- `POST /api/aset/:id/checklist` — simpan run (items[], overall, note, foto). Bila `overall='rusak'` → set `op_status='rusak'` (opsional) & tawarkan buat insiden.

**3b Preventive maintenance**
- `GET/POST/PUT/DELETE /api/aset/:id/pm` — kelola PM plan aset + hitung status jatuh tempo.
- `POST /api/aset/pm/:planId/done` — catat penyelesaian + reset anchor.
- `GET  /api/aset/pm/due` — daftar PM jatuh tempo (unit) untuk dashboard/badge.
- **Reminder**: perluas `maintenanceReminderQueue` (job harian 08:00 yang sudah ada) — tambah cek PM `hours`/`calendar` yang due → WA ke **koordinator unit** (+ teknisi on-duty).

**3c Availability**
- `GET /api/aset/availability?from=&to=` — per aset: % operasional, jumlah failure, MTBF, MTTR, downtime; ter-scope unit.

Semua ter-scope unit (`unitFilter/rowInUnit/insertUnitId`) & cek by-id (anti-IDOR).

---

## 4. Frontend

| Area | Perubahan |
|---|---|
| `Aset.tsx` | Aksi kartu tambah: **✅ Checklist** & **🔧 PM**. Badge "PM jatuh tempo" merah bila ada plan due. |
| `ChecklistModal` (baru) | Isi checklist (item dari template, ok/tidak/na + catatan + foto), lihat riwayat run. |
| `PmModal` (baru) | Kelola PM plan aset (interval jam/kalender), progress bar ke jatuh tempo, tombol "Tandai Selesai", riwayat. |
| Halaman `AsetAvailability.tsx` (baru) | Laporan availability per unit (tabel: % operasional, failure, MTBF, MTTR) + pemilih periode. Nav `aset-availability`. |
| `MasterData.tsx` | Tab **Checklist** (kelola template + item per unit). |
| `types/index.ts` | `ChecklistTemplate/Item/Run`, `PmPlan`, `PmStatus`, `AvailabilityRow`. |
| Dashboard/badge | (opsional) ringkasan "PM jatuh tempo" & aset rusak per unit. |

---

## 5. Urutan pengerjaan

| # | Langkah | Bobot |
|---|---|---|
| 1 | Migrasi DB: 7 tabel (checklist ×4, pm ×2, status_log ×1) + status_log write di create/setStatus | Sedang |
| 2 | **3a** backend checklist template + run | Sedang |
| 3 | **3a** frontend ChecklistModal + tab Master Data | Sedang |
| 4 | **3b** backend PM plan + due calc + reminder WA | Sedang |
| 5 | **3b** frontend PmModal + badge due | Sedang |
| 6 | **3c** backend availability report + **3c** frontend halaman | Sedang |
| 7 | Uji: checklist run, PM due (hours & calendar), availability, isolasi unit, tsc/lint | Sedang |

## 6. Keputusan (dikonfirmasi user 2026-07-03)

1. **Template checklist**: **KOSONG** — tidak ada seed bawaan; koordinator menyusun sendiri di Master Data → Checklist.
2. **Penerima reminder PM**: **koordinator unit + teknisi on-duty** (konsisten dgn reminder maintenance yang ada).
3. **Status `standby`** pada availability: **netral** — availability = operasional / (total − standby).
4. **Checklist `overall='rusak'`**: **otomatis set `op_status='rusak'` + tawarkan buat insiden** (teknisi bisa batal).

## 7. Di luar lingkup Fase 3 (→ Fase 4)

- Kop/kode surat & penomoran per unit; sparepart & stok (relevan ke PM tapi modul terpisah).
