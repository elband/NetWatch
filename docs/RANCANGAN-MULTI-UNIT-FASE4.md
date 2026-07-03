# Rancangan Fase 4 — Identitas Surat per Unit & Sparepart/Stok

> Status: **RANCANGAN — belum dieksekusi.** Disusun 2026-07-03. Lanjutan dari [Fase 3](RANCANGAN-MULTI-UNIT-FASE3.md). Fase terakhir roadmap multi-unit.

Dua sub-modul: **4a identitas surat per unit** (kop + kode/nomor unik per unit) dan **4b sparepart & stok**.

---

## 4a. Identitas surat per unit

### Masalah
Penomoran surat sudah menghitung `seq` per unit (`suratRoutes.nextNomor`), TAPI kode surat (`lkp.nd_kode`), kop/letterhead (`lkp.kop_url`), dan penandatangan koordinator (`lkp.koord_*`) dibaca dari **satu** `settings.lkp` global. Akibatnya nomor bisa kembar antar unit (`001/ELBAND/APTP/VII/2026` identik untuk ELB & AAB) dan kop/penandatangan tidak sesuai unit.

### Desain
Simpan **override per-unit** di kolom baru `units.config` (JSON). `lkp` efektif = `{ ...settings.lkp global, ...units.config }`. Konsumen (docTemplates, laporanReport, penomoran) tidak berubah — mereka menerima `lkp` yang sudah di-merge.

| Field | Sumber | Alasan |
|---|---|---|
| `nd_kode`, `kop_url`, `unit` (nama unit), `koord_nama/nip/jabatan`, `nd_dari`, `nd_yth` | **per-unit** (`units.config`) | Beda tiap unit — inti perbaikan |
| `bandara`, `kantor`, `kota`, `kasie_*` (Kepala Seksi di atas semua unit), `map` | **global** (`settings.lkp`) | Identitas kantor & atasan bersama |

### Perubahan
**DB**: `units.config JSON DEFAULT NULL` (via migrate.js).

**Backend**:
- `GET /settings` (settingsRoutes) — pasang `unitScope`; setelah baca `settings.lkp` global, merge `units.config` unit aktif → kembalikan `settings.lkp` efektif. Non-surat settings tetap global.
- `nextNomor` (suratRoutes) sudah terima `unitId` → baca `nd_kode` dari config unit itu (fallback global).
- `getLkp()` server-side (render PDF TTE) → jadikan unit-aware: merge `units.config` milik **unit surat tsb** (surat punya `unit_id`) agar dokumen lama & baru pakai identitas unitnya.
- Endpoint edit: `PUT /units/:id/config` (koordinator = unitnya sendiri; super admin = unit mana pun) + `POST /units/:id/kop` (unggah kop per unit, simpan ke `config.kop_url`).

**Frontend**:
- Editor "Identitas Surat Unit" — tab/section baru di halaman **Master Data → Unit** (atau kartu unit): kode surat, unggah kop, nama unit, data koordinator penandatangan, nd_dari/nd_yth. Koordinator lihat/edit unitnya; super admin pilih unit.
- `SuratKeluar`/`LaporanBulanan`/`DocPrint` tidak berubah — otomatis dapat `lkp` per-unit dari `GET /settings` (sudah kirim `X-Unit-Id`).

### Risiko
- Pipeline TTE/PDF delikat. Mitigasi: merge bersifat additif (config kosong → identik perilaku lama); surat lama ELB tetap render sama (unit_id=ELB, config kosong → global). Uji: generate surat AAB (kode berbeda) + buka surat ELB lama (tetap sama).

---

## 4b. Sparepart & stok

Modul inventaris suku cadang per unit (filter, oli, ban, seal pompa) dengan kartu stok masuk/keluar. Relevan ke PM (Fase 3) — pemakaian saat servis.

### DB
```sql
CREATE TABLE spareparts (
  id INT AUTO_INCREMENT PRIMARY KEY,
  unit_id INT DEFAULT NULL,
  name VARCHAR(150) NOT NULL,
  part_no VARCHAR(80) DEFAULT NULL,
  category VARCHAR(80) DEFAULT NULL,
  satuan VARCHAR(20) NOT NULL DEFAULT 'pcs',
  stock_qty DECIMAL(12,2) NOT NULL DEFAULT 0,
  min_qty DECIMAL(12,2) NOT NULL DEFAULT 0,
  location VARCHAR(120) DEFAULT NULL,
  notes VARCHAR(255) DEFAULT NULL,
  active TINYINT(1) NOT NULL DEFAULT 1,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_sp_unit (unit_id)
);
CREATE TABLE sparepart_moves (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  sparepart_id INT NOT NULL,
  unit_id INT DEFAULT NULL,
  type ENUM('masuk','keluar','adjust') NOT NULL,
  qty DECIMAL(12,2) NOT NULL,
  device_id INT DEFAULT NULL,     -- aset terkait (opsional, mis. dipakai saat PM/servis)
  note VARCHAR(255) DEFAULT NULL,
  moved_by INT DEFAULT NULL,
  moved_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_spm_part (sparepart_id),
  CONSTRAINT fk_spm_part FOREIGN KEY (sparepart_id) REFERENCES spareparts(id) ON DELETE CASCADE
);
```
Stok = kolom `stock_qty` (diperbarui transaksional saat ada move). `masuk` menambah, `keluar` mengurangi (tolak bila stok kurang), `adjust` set selisih.

### Backend — `/api/spareparts` (routes/controller baru)
- CRUD sparepart (ter-scope unit; teknisi lihat, koordinator/admin kelola).
- `POST /:id/move` — catat masuk/keluar/adjust (transaksional, update stock_qty).
- `GET /:id/moves` — kartu stok.
- `GET /low-stock` — daftar stok menipis (`stock_qty <= min_qty`) untuk badge.

### Frontend
- Halaman `Spareparts.tsx` (nav `sparepart`): tabel sparepart (nama, part no, stok vs min dengan badge merah bila menipis), form tambah/edit, aksi Masuk/Keluar/Adjust (modal), riwayat kartu stok.
- (Opsional) di `PmModal` "Tandai Selesai" → input sparepart terpakai → catat move `keluar` ref aset.

---

## 5. Urutan pengerjaan

| # | Langkah | Bobot |
|---|---|---|
| 1 | DB: `units.config`, tabel `spareparts` + `sparepart_moves` | Kecil |
| 2 | **4a** backend: settings merge per-unit, nextNomor/getLkp unit-aware, PUT unit config + kop | Sedang |
| 3 | **4a** frontend: editor identitas surat unit (Master Data → Unit) | Sedang |
| 4 | **4b** backend: CRUD sparepart + moves + low-stock | Sedang |
| 5 | **4b** frontend: halaman Sparepart + modal move | Sedang |
| 6 | Uji: surat AAB kode berbeda + surat ELB lama tetap sama; sparepart masuk/keluar/stok, low-stock, isolasi unit | Sedang |

## 6. Keputusan (dikonfirmasi user 2026-07-03)

1. **Pemisahan field surat**: pakai usulan §4a — per-unit = kode/kop/nama unit/koordinator/nd_dari/nd_yth; global = identitas kantor (bandara/kota) & Kepala Seksi.
2. **Integrasi sparepart ↔ PM**: **YA** — saat "Tandai Selesai" PM, bisa catat sparepart terpakai → stok berkurang + move `keluar` ref aset.
3. **Alert stok menipis**: **badge in-app + reminder WA** harian ke koordinator unit (numpang job reminder harian).

## 7. Penutup roadmap
Setelah Fase 4, seluruh roadmap multi-unit (Fase 1–4) selesai. Peningkatan lanjutan (mis. integrasi sensor pompa, dashboard lintas-unit lebih kaya) di luar cakupan roadmap ini.
