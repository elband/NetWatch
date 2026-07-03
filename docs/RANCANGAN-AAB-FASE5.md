# Rancangan Fase 5 — Penyempurnaan Unit AAB (dari Laporan Bulanan riil)

> Status: **DIIMPLEMENTASIKAN & TERUJI 2026-07-03.** Berdasarkan analisis *Laporan Bulanan AAB Mei 2026*.
> Uji: E2E API (fasilitas seed, kondisi/kebutuhan + procurement, checklist berkategori, obat air biaya, isolasi unit, laporan AAB terhimpun) + verifikasi browser (Aset kondisi/fasilitas/kebutuhan, halaman Obat Air, Laporan Bulanan AAB 7 seksi). `tsc --noEmit` bersih.
> Tujuan: menyelaraskan NetWatch dengan workflow nyata Unit Alat-Alat Besar (kondisi B/RR/RB, grup fasilitas, checklist riil, obat air, dan generator laporan bulanan otomatis).

Lima sub-modul, dikerjakan & di-commit bertahap: **5a kondisi & grup fasilitas**, **5b template checklist riil**, **5c modul obat air**, **5d generator Laporan Bulanan AAB**.

---

## 5a. Kondisi B/RR/RB, grup fasilitas & kebutuhan pada aset

Laporan memakai klasifikasi resmi **B / RR / RB** dan mengelompokkan inventaris per **fasilitas** (Kendaraan, Alat/Tools, GWT, WTP/STP, SWP, Intake), dengan catatan **kebutuhan** (Perlu Penggantian/Rekondisi/dst.).

**DB (kolom baru pada `devices`, via migrate.js):**
| Kolom | Tipe | Guna |
|---|---|---|
| `kondisi` | `ENUM('B','RR','RB') NULL` | Klasifikasi kondisi fisik (inventaris & pengadaan). Berdampingan dgn `op_status` (yg tetap dipakai availability) |
| `fasilitas` | `VARCHAR(80) NULL` | Grup fasilitas (untuk pengelompokan tabel inventaris) |
| `kebutuhan` | `VARCHAR(255) NULL` | Catatan kebutuhan/rekomendasi pengadaan |

- `op_status` (operasional/standby/rusak/perbaikan) **tetap** untuk availability/MTBF (Fase 3). `kondisi` = sudut pandang inventaris (B/RR/RB) yg muncul di laporan. Keduanya berbeda sumbu, dipertahankan.
- **Master grup fasilitas** per unit (seperti device_types): tabel `asset_facilities` (unit_id, name, sort). Seed AAB: Alat & Tools, Kendaraan & Alat Besar, GWT, WTP/STP, SWP Kawasan, SWP Unit, Intake.

**Backend:** field ditambah di create/update aset (assetController). Endpoint `/api/aset/facilities` (CRUD, seperti metric-types). Endpoint `/api/aset/procurement` → daftar aset kondisi RR/RB atau ber-`kebutuhan` (untuk rollup pengadaan).

**Frontend:** form & kartu Aset tampilkan kondisi (badge B/RR/RB) + fasilitas + kebutuhan; filter per fasilitas; halaman/section "Daftar Kebutuhan Pengadaan". Tab "Fasilitas" di Master Data.

---

## 5b. Template checklist riil (harian & bulanan)

Fitur checklist (Fase 3) sudah ada — dilengkapi agar setia pada form AAB yang mengelompokkan item per **kategori** (Mesin, Body, Elektronik, Kemudi, Rem, Penghasil Listrik, First Aid).

**DB:** tambah `category VARCHAR(60) NULL` pada `checklist_template_items` (+ salin ke `checklist_run_items` sebagai snapshot). Backend & frontend checklist menampilkan item dikelompokkan per kategori.

**Seed template AAB** (idempoten, INSERT IGNORE — tidak menimpa edit koordinator):
- **Checklist Harian Kendaraan** — Mesin (cek oli/kebocoran, BBM FULL, aki/terminal, tekanan ban), Body, Elektronik (fungsional lampu/saklar/cable body/outlet/ground), Kemudi, Rem (rem & baut velg), Penghasil Listrik, First Aid (P3K, aliran oksigen).
- **Checklist Bulanan Kendaraan** — item status *Serviceable* + catatan bulanan.

---

## 5c. Modul obat air (bahan kimia + biaya)

Laporan *Penggunaan Obat Air*: per bahan (Soda Ash, Kapur, Chlorine, PAC) ada **harga satuan** & **volume mingguan** → total **biaya** per periode. Ini konsumsi-berbiaya, beda dari stok sparepart → modul ringan tersendiri.

**DB:**
```sql
CREATE TABLE water_chemicals (            -- master bahan (per unit)
  id, unit_id, name, satuan, harga_satuan DECIMAL(12,2), active, ...);
CREATE TABLE water_chemical_usage (       -- pemakaian harian
  id, chemical_id, unit_id, usage_date DATE, volume DECIMAL(12,2), note, recorded_by, ...);
```

**Backend `/api/obat-air`:** CRUD bahan; catat pemakaian; laporan periode (`?from&to`) → rekap volume & biaya per bahan + total, opsional rincian mingguan.

**Frontend:** halaman "Obat Air" — master bahan (nama, satuan, harga), input pemakaian harian, tabel rekap bulanan (volume × harga = biaya) + total. Nav `obat-air`.

---

## 5d. Generator Laporan Bulanan AAB

Rakit dokumen bulanan otomatis dari data NetWatch (seperti Laporan Bulanan ELB yang sudah ada, tapi struktur AAB). Karena semua data kini di NetWatch, laporan tak perlu disusun manual.

**Bagian yang di-generate (dari data):**
1. **Nota Dinas** cover (kode `AAB/APTP` per unit — sudah dari Fase 4).
2. **Personil** (users unit AAB: nama/NIP/jabatan) + sistem jam kerja.
3. **Kegiatan Pemeliharaan** (dari kegiatan-non-rutin / maintenance unit AAB + foto).
4. **Inventaris per fasilitas** — tabel dikelompokkan `fasilitas`, kolom Merk/Type/Tahun/Jumlah/**Kondisi (B/RR/RB)**/Kebutuhan (dari 5a).
5. **Rekap Checklist** — ringkasan checklist harian bulan berjalan (dari 5b).
6. **Laporan Obat Air** (dari 5c).
7. **Daftar Dinas** (grid shift bulanan — dari jadwal/shifts).

**Pendekatan:** fungsi `buildAabReportHtml(data, lkp)` (pola `laporanReport.ts`) + endpoint backend `GET /api/laporan/aab?month=YYYY-MM` yang mengumpulkan data. Cetak via halaman print (reuse pola DocPrint) → bisa TTE seperti Laporan Bulanan ELB.
**Catatan cakupan:** target versi pertama = seksi berbasis data (inventaris, checklist, obat air, jadwal, personil, kegiatan) dalam HTML cetak rapi. Replikasi persis tata letak Word 45-halaman (mis. grid checklist harian per-kendaraan lengkap dengan foto tiap kegiatan) bertahap.

---

## 6. Urutan & keputusan

| # | Langkah | Bobot |
|---|---|---|
| 1 | 5a DB + backend + frontend (kondisi/fasilitas/kebutuhan + master + pengadaan) | Sedang |
| 2 | 5b checklist berkategori + seed template AAB | Sedang |
| 3 | 5c modul obat air (master + pemakaian + rekap biaya) | Sedang |
| 4 | 5d generator Laporan Bulanan AAB | Besar |
| 5 | Uji tiap bagian + tsc/lint + verifikasi browser | Sedang |

**Keputusan (dikonfirmasi user 2026-07-03):**
1. `kondisi` B/RR/RB = **field terpisah** dari `op_status` (op_status tetap untuk availability/MTBF).
2. Grup fasilitas = **master dikonfigurasi** (di-seed daftar dari laporan).
3. Generator 5d = **versi pertama seksi berbasis data** (inventaris/checklist/obat air/jadwal/personil/kegiatan) rapi & bisa TTE; replikasi Word penuh menyusul.
