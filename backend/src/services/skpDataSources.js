import { pool } from '../db/pool.js';

// ============================================================================
// Registry sumber data aplikasi NetWatch yang dapat dijadikan "Bukti Dukung" SKP.
// Setiap bukti tipe 'data' membekukan (snapshot) hasil query saat dibuat.
// Struktur snapshot seragam agar halaman publik bisa merendernya generik:
//   { source, title, period, summary:[{label,value}], columns:[...], rows:[[...]],
//     rowPhotos:[[url,…]|null,…]  ← sejajar dgn rows; foto bukti tiap baris, generatedAt }
// Catatan: rowPhotos menyimpan path apa adanya (/uploads/…). Berkas dari folder yang
// digate login (mis. /uploads/activities) TIDAK dibuka untuk umum; saat bukti dibuka
// lewat halaman publik, path-nya ditulis ulang menjadi tautan ber-token
// (/api/skp/bukti/public/:token/berkas?p=…) yang hanya melayani berkas yang memang
// tercantum di snapshot bukti tersebut — lihat skpRoutes.js.
// ============================================================================

const BULAN_ID = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];

// 'YYYY-MM' → { start:'YYYY-MM-01', end: awal bulan berikutnya, label:'Juni 2026' }
function monthRange(bulan) {
  const m = /^(\d{4})-(\d{2})$/.exec(bulan || '');
  if (!m) throw new Error('Parameter bulan tidak valid (format YYYY-MM).');
  const y = Number(m[1]); const mo = Number(m[2]);
  const start = `${m[1]}-${m[2]}-01`;
  const ny = mo === 12 ? y + 1 : y;
  const nm = mo === 12 ? 1 : mo + 1;
  const end = `${ny}-${String(nm).padStart(2, '0')}-01`;
  return { start, end, label: `${BULAN_ID[mo - 1]} ${y}` };
}

const HASIL_LABEL = { berhasil: 'Berhasil', sebagian: 'Sebagian', gagal: 'Belum berhasil' };
const MAINT_STATUS = { rencana: 'Rencana', selesai: 'Selesai', batal: 'Batal' };
const ACTIVITY_LABEL = { rapat: 'Rapat', lembur: 'Lembur', izin: 'Izin', 'dinas-luar': 'Dinas Luar', lainnya: 'Kegiatan Lain' };
// doc_urls disimpan sebagai JSON array; mysql2 umumnya sudah mem-parse, jaga-jaga bila string.
function parseDocUrls(v) {
  if (Array.isArray(v)) return v;
  if (typeof v === 'string') { try { const a = JSON.parse(v); return Array.isArray(a) ? a : []; } catch { return []; } }
  return [];
}

// Daftar sumber untuk dropdown UI. period: 'month' butuh parameter bulan; 'none' tidak.
export const DATA_SOURCES = [
  { key: 'perbaikan', label: 'Rekap Perbaikan (Insiden/LKP)', period: 'month' },
  { key: 'maintenance', label: 'Pemeliharaan & Perawatan Peralatan', period: 'month' },
  { key: 'inspeksi', label: 'Inspeksi/Pemeriksaan Peralatan', period: 'month' },
  { key: 'kegiatan', label: 'Kegiatan Non-Rutin', period: 'month' },
  { key: 'pengajuan_kegiatan', label: 'Kegiatan Diajukan Teknisi (Rapat/Lembur/Dinas Luar)', period: 'month' },
  { key: 'sla', label: 'Laporan SLA/Uptime Perangkat', period: 'month' },
  { key: 'laporan_bulanan', label: 'Laporan Bulanan (Rekap)', period: 'month' },
  { key: 'inventaris', label: 'Daftar / Inventaris Perangkat', period: 'none' },
  { key: 'qr', label: 'Pelaporan Fasilitas (QR Publik)', period: 'month' },
];
const SOURCE_LABEL = Object.fromEntries(DATA_SOURCES.map((s) => [s.key, s.label]));

// ---- Builder per sumber → { title, summary, columns, rows } ----
const BUILDERS = {
  async perbaikan({ start, end, label }) {
    const [rows] = await pool.query(
      `SELECT i.id, DATE_FORMAT(i.resolved_at,'%d-%m-%Y') tgl, i.device_name, i.issue,
              COALESCE(r.hasil,'') hasil, COALESCE(i.resolved_by,'-') teknisi, COALESCE(i.duration_min,0) dur
         FROM incidents i LEFT JOIN incident_reports r ON r.incident_id=i.id
        WHERE i.status='selesai' AND i.resolved_at>=? AND i.resolved_at<? ORDER BY i.resolved_at`, [start, end]);
    // Foto/dokumen bukti penanganan dari kronologi insiden (incident_notes.doc_url).
    const fotoMap = new Map();
    if (rows.length) {
      const ids = rows.map((r) => r.id);
      const [ph] = await pool.query(
        `SELECT incident_id, doc_url FROM incident_notes
          WHERE doc_url IS NOT NULL AND incident_id IN (${ids.map(() => '?').join(',')}) ORDER BY id`, ids);
      for (const p of ph) fotoMap.set(p.incident_id, [...(fotoMap.get(p.incident_id) || []), p.doc_url]);
    }
    const totalDur = rows.reduce((a, r) => a + Number(r.dur || 0), 0);
    const avg = rows.length ? Math.round(totalDur / rows.length) : 0;
    return {
      title: `Rekap Perbaikan (LKP) — ${label}`,
      summary: [
        { label: 'Insiden Selesai', value: rows.length },
        { label: 'Rata-rata Durasi', value: `${Math.floor(avg / 60)}j ${avg % 60}m` },
      ],
      columns: ['Tanggal', 'Perangkat', 'Masalah', 'Hasil', 'Teknisi'],
      rows: rows.map((r) => [r.tgl, r.device_name, r.issue, HASIL_LABEL[r.hasil] || '-', r.teknisi]),
      rowPhotos: rows.map((r) => fotoMap.get(r.id) || null),
    };
  },

  // Pemeliharaan = Maintenance Bulanan (equipment_maintenance) + Jendela Maintenance
  // (maintenance_windows). Banyak unit hanya memakai jendela maintenance, jadi keduanya
  // digabung — selaras dengan komponen PM pada penilaian & Logbook Peralatan.
  async maintenance({ bulan, start, end, label }) {
    const [bulanan] = await pool.query(
      `SELECT m.id, m.scheduled_date tgl, d.name perangkat, m.task, m.status,
              COALESCE(u.name,'-') oleh,
              (SELECT COUNT(*) FROM equipment_maintenance_photos p WHERE p.maintenance_id=m.id) foto
         FROM equipment_maintenance m JOIN devices d ON d.id=m.device_id
         LEFT JOIN users u ON u.id=m.done_by
        WHERE m.plan_month=?`, [bulan]);
    const [jendela] = await pool.query(
      `SELECT mw.id, mw.starts_at tgl, COALESCE(d.name, l.name, '-') perangkat, mw.title task,
              CASE WHEN mw.status='selesai' THEN 'selesai' ELSE 'rencana' END status,
              COALESCE(u.name,'-') oleh,
              (SELECT COUNT(*) FROM maintenance_window_photos p WHERE p.window_id=mw.id) foto
         FROM maintenance_windows mw
         LEFT JOIN devices d ON d.id=mw.device_id
         LEFT JOIN locations l ON l.id=mw.location_id
         LEFT JOIN users u ON u.id=mw.done_by
        WHERE mw.starts_at>=? AND mw.starts_at<?`, [start, end]);
    // Foto dokumentasi tiap pekerjaan (dua tabel foto terpisah) → dilampirkan per baris.
    const fotoOf = async (sql, ids) => {
      const map = new Map();
      if (!ids.length) return map;
      const [ph] = await pool.query(sql.replace('__IN__', ids.map(() => '?').join(',')), ids);
      for (const p of ph) map.set(p.ref, [...(map.get(p.ref) || []), p.url]);
      return map;
    };
    const fotoBulanan = await fotoOf(
      'SELECT maintenance_id ref, url FROM equipment_maintenance_photos WHERE maintenance_id IN (__IN__) ORDER BY id',
      bulanan.map((r) => r.id));
    const fotoJendela = await fotoOf(
      'SELECT window_id ref, url FROM maintenance_window_photos WHERE window_id IN (__IN__) ORDER BY id',
      jendela.map((r) => r.id));
    const rows = [
      ...bulanan.map((r) => ({ ...r, jenis: 'Maintenance Bulanan', fotos: fotoBulanan.get(r.id) || null })),
      ...jendela.map((r) => ({ ...r, jenis: 'Jendela Maintenance', fotos: fotoJendela.get(r.id) || null })),
    ].sort((a, b) => String(a.tgl).localeCompare(String(b.tgl)));
    const selesai = rows.filter((r) => r.status === 'selesai').length;
    const foto = rows.reduce((a, r) => a + Number(r.foto || 0), 0);
    const tgl = (v) => (v ? new Date(v).toLocaleDateString('id-ID', { day: '2-digit', month: '2-digit', year: 'numeric' }).replace(/\//g, '-') : '-');
    return {
      title: `Pemeliharaan & Perawatan Peralatan — ${label}`,
      summary: [
        { label: 'Total Kegiatan', value: rows.length },
        { label: 'Selesai', value: selesai },
        { label: 'Jendela Maintenance', value: jendela.length },
        { label: 'Dokumentasi Foto', value: foto },
      ],
      columns: ['Tgl Jadwal', 'Jenis', 'Perangkat/Lokasi', 'Tugas', 'Status', 'Dikerjakan Oleh'],
      rows: rows.map((r) => [tgl(r.tgl), r.jenis, r.perangkat, r.task, MAINT_STATUS[r.status] || r.status, r.oleh]),
      rowPhotos: rows.map((r) => r.fotos),
    };
  },

  async inspeksi({ start, end, label }) {
    const [rows] = await pool.query(
      `SELECT DATE_FORMAT(ei.inspect_date,'%d-%m-%Y') tgl, d.name perangkat, ei.slot, ei.status,
              COALESCE(ei.note,'-') catatan, COALESCE(ei.inspector_name,'-') pemeriksa, ei.photo_url
         FROM equipment_inspections ei JOIN devices d ON d.id=ei.device_id
        WHERE ei.inspect_date>=? AND ei.inspect_date<? ORDER BY ei.inspect_date, ei.slot`, [start, end]);
    const cnt = (s) => rows.filter((r) => r.status === s).length;
    return {
      title: `Inspeksi Peralatan — ${label}`,
      summary: [
        { label: 'Total Inspeksi', value: rows.length },
        { label: 'Baik', value: cnt('baik') },
        { label: 'Perhatian', value: cnt('perhatian') },
        { label: 'Rusak', value: cnt('rusak') },
        { label: 'Foto Bukti', value: rows.filter((r) => r.photo_url).length },
      ],
      columns: ['Tanggal', 'Perangkat', 'Slot', 'Kondisi', 'Catatan', 'Pemeriksa'],
      rows: rows.map((r) => [r.tgl, r.perangkat, `${r.slot}.00`, r.status, r.catatan, r.pemeriksa]),
      rowPhotos: rows.map((r) => (r.photo_url ? [r.photo_url] : null)),
    };
  },

  async kegiatan({ start, end, label }) {
    const [rows] = await pool.query(
      `SELECT id, DATE_FORMAT(tanggal_kegiatan,'%d-%m-%Y') tgl, judul, kategori, petugas_nama, status,
              COALESCE(durasi_jam,0) jam, COALESCE(poin,0) poin
         FROM kegiatan_non_rutin WHERE tanggal_kegiatan>=? AND tanggal_kegiatan<? ORDER BY tanggal_kegiatan`, [start, end]);
    // Berkas/foto dokumentasi kegiatan (folder terproteksi → dilayani lewat proxy bertoken).
    const fotoMap = new Map();
    if (rows.length) {
      const ids = rows.map((r) => r.id);
      const [fl] = await pool.query(
        `SELECT kegiatan_id, file_url FROM kegiatan_non_rutin_files WHERE kegiatan_id IN (${ids.map(() => '?').join(',')}) ORDER BY id`, ids);
      for (const f of fl) fotoMap.set(f.kegiatan_id, [...(fotoMap.get(f.kegiatan_id) || []), f.file_url]);
    }
    const jam = rows.reduce((a, r) => a + Number(r.jam || 0), 0);
    const poin = rows.reduce((a, r) => a + Number(r.poin || 0), 0);
    return {
      title: `Kegiatan Non-Rutin — ${label}`,
      summary: [
        { label: 'Total Kegiatan', value: rows.length },
        { label: 'Total Jam', value: jam },
        { label: 'Total Poin', value: poin },
      ],
      columns: ['Tanggal', 'Judul', 'Kategori', 'Petugas', 'Status'],
      rows: rows.map((r) => [r.tgl, r.judul, r.kategori, r.petugas_nama || '-', r.status]),
      rowPhotos: rows.map((r) => fotoMap.get(r.id) || null),
    };
  },

  // Kegiatan yang DIAJUKAN teknisi & disetujui koordinator (rapat, lembur, izin,
  // dinas luar, lainnya) — sumber "Kegiatan Lain" pada Dashboard Saya / Kegiatan Saya.
  async pengajuan_kegiatan({ start, end, label }) {
    const [rows] = await pool.query(
      `SELECT DATE_FORMAT(a.activity_date,'%d-%m-%Y') tgl, a.type, a.title, a.detail,
              a.start_time, a.end_time, a.completed_at, COALESCE(u.name,'-') pengaju,
              COALESCE(a.approver_name,'-') penyetuju, a.bukti_url, a.doc_urls,
              (CASE WHEN a.doc_urls IS NULL THEN 0 ELSE JSON_LENGTH(a.doc_urls) END) dok
         FROM activities a LEFT JOIN users u ON u.id=a.user_id
        WHERE a.status='disetujui' AND a.activity_date>=? AND a.activity_date<?
        ORDER BY a.activity_date, a.start_time`, [start, end]);
    const cnt = (t) => rows.filter((r) => r.type === t).length;
    const dok = rows.reduce((a, r) => a + Number(r.dok || 0), 0);
    const jam = (r) => (r.start_time ? `${String(r.start_time).slice(0, 5)}${r.end_time ? `–${String(r.end_time).slice(0, 5)}` : ''}` : '-');
    return {
      title: `Kegiatan Diajukan Teknisi (Disetujui) — ${label}`,
      summary: [
        { label: 'Total Kegiatan', value: rows.length },
        { label: 'Rapat', value: cnt('rapat') },
        { label: 'Dinas Luar', value: cnt('dinas-luar') },
        { label: 'Lembur', value: cnt('lembur') },
        { label: 'Dokumentasi Foto', value: dok },
      ],
      columns: ['Tanggal', 'Jam', 'Jenis', 'Kegiatan', 'Pengaju', 'Disetujui Oleh'],
      rows: rows.map((r) => [r.tgl, jam(r), ACTIVITY_LABEL[r.type] || r.type,
        r.title + (r.detail ? ` — ${r.detail}` : ''), r.pengaju, r.penyetuju]),
      // Bukti dukung pengajuan + dokumentasi penyelesaian (rapat/dinas luar).
      rowPhotos: rows.map((r) => [r.bukti_url, ...parseDocUrls(r.doc_urls)].filter(Boolean)),
    };
  },

  async sla({ start, end, label }) {
    const [rows] = await pool.query(
      `SELECT d.name perangkat, SUM(u.samples) samp, SUM(u.up_samples) up_s, SUM(u.warn_samples) warn_s,
              SUM(u.maint_samples) maint_s, SUM(u.down_seconds) downsec
         FROM device_uptime_daily u JOIN devices d ON d.id=u.device_id
        WHERE u.day>=? AND u.day<? GROUP BY u.device_id, d.name ORDER BY d.name`, [start, end]);
    const calc = (r) => {
      const denom = Number(r.samp || 0) - Number(r.maint_s || 0);
      if (denom <= 0) return 100;
      return Math.round(((Number(r.up_s || 0) + Number(r.warn_s || 0)) / denom) * 1000) / 10;
    };
    const avg = rows.length ? Math.round((rows.reduce((a, r) => a + calc(r), 0) / rows.length) * 10) / 10 : 100;
    return {
      title: `Laporan SLA / Uptime Perangkat — ${label}`,
      summary: [
        { label: 'Perangkat Terpantau', value: rows.length },
        { label: 'Rata-rata Uptime', value: `${avg}%` },
      ],
      columns: ['Perangkat', 'Uptime %', 'Total Downtime (menit)'],
      rows: rows.map((r) => [r.perangkat, `${calc(r)}%`, String(Math.round(Number(r.downsec || 0) / 60))]),
    };
  },

  async qr({ start, end, label }) {
    const [rows] = await pool.query(
      `SELECT DATE_FORMAT(created_at,'%d-%m-%Y') tgl, COALESCE(ruang,'-') lokasi, jenis, judul, status
         FROM public_reports WHERE created_at>=? AND created_at<? ORDER BY created_at`, [start, end]);
    const cnt = (s) => rows.filter((r) => r.status === s).length;
    return {
      title: `Pelaporan Fasilitas (QR Publik) — ${label}`,
      summary: [
        { label: 'Total Laporan', value: rows.length },
        { label: 'Selesai', value: cnt('selesai') },
        { label: 'Diproses', value: cnt('diproses') },
        { label: 'Menunggu', value: cnt('menunggu') },
      ],
      columns: ['Tanggal', 'Lokasi', 'Jenis', 'Judul', 'Status'],
      rows: rows.map((r) => [r.tgl, r.lokasi, r.jenis, r.judul, r.status]),
    };
  },

  async inventaris() {
    const [rows] = await pool.query(
      `SELECT name, type, ip, COALESCE(loc,'-') lokasi, status FROM devices ORDER BY name`);
    const cnt = (s) => rows.filter((r) => r.status === s).length;
    return {
      title: 'Daftar / Inventaris Perangkat Elektronika',
      summary: [
        { label: 'Total Perangkat', value: rows.length },
        { label: 'Online', value: cnt('online') },
        { label: 'Warning', value: cnt('warning') },
        { label: 'Offline', value: cnt('offline') },
      ],
      columns: ['Perangkat', 'Tipe', 'IP', 'Lokasi', 'Status'],
      rows: rows.map((r) => [r.name, r.type, r.ip, r.lokasi, r.status]),
    };
  },

  async laporan_bulanan(ctx) {
    const { start, end, bulan, label } = ctx;
    const [[inc]] = await pool.query("SELECT COUNT(*) c FROM incidents WHERE status='selesai' AND resolved_at>=? AND resolved_at<?", [start, end]);
    // Pemeliharaan selesai = Maintenance Bulanan + Jendela Maintenance (lihat builder maintenance).
    const [[mnt]] = await pool.query(
      `SELECT (SELECT COUNT(*) FROM equipment_maintenance WHERE plan_month=? AND status='selesai')
            + (SELECT COUNT(*) FROM maintenance_windows WHERE status='selesai' AND starts_at>=? AND starts_at<?) AS c`,
      [bulan, start, end]);
    const [[insp]] = await pool.query('SELECT COUNT(*) c FROM equipment_inspections WHERE inspect_date>=? AND inspect_date<?', [start, end]);
    const [[knr]] = await pool.query('SELECT COUNT(*) c FROM kegiatan_non_rutin WHERE tanggal_kegiatan>=? AND tanggal_kegiatan<?', [start, end]);
    const [[qr]] = await pool.query('SELECT COUNT(*) c FROM public_reports WHERE created_at>=? AND created_at<?', [start, end]);
    const sla = await BUILDERS.sla(ctx);
    const uptime = sla.summary.find((s) => s.label === 'Rata-rata Uptime')?.value || '-';
    return {
      title: `Laporan Bulanan (Rekap) — ${label}`,
      summary: [
        { label: 'Insiden Selesai', value: inc.c },
        { label: 'Maintenance Selesai', value: mnt.c },
        { label: 'Inspeksi', value: insp.c },
        { label: 'Kegiatan Non-Rutin', value: knr.c },
        { label: 'Rata-rata Uptime', value: uptime },
      ],
      columns: ['Komponen Kinerja', 'Jumlah'],
      rows: [
        ['Insiden/Perbaikan selesai', String(inc.c)],
        ['Pemeliharaan peralatan selesai', String(mnt.c)],
        ['Inspeksi peralatan', String(insp.c)],
        ['Kegiatan non-rutin', String(knr.c)],
        ['Laporan fasilitas (QR publik)', String(qr.c)],
        ['Rata-rata uptime perangkat', String(uptime)],
      ],
    };
  },
};

// Bangun snapshot beku untuk sumber + parameter tertentu.
export async function buildSnapshot(source, params = {}) {
  const builder = BUILDERS[source];
  if (!builder) throw new Error('Sumber data tidak dikenali.');
  const def = DATA_SOURCES.find((s) => s.key === source);
  let ctx = {};
  if (def?.period === 'month') {
    const r = monthRange(params.bulan);
    ctx = { ...r, bulan: params.bulan };
  }
  const out = await builder(ctx);
  // Foto bukti per baris. Hanya path di bawah /uploads yang diterima (bukan URL luar);
  // baris tanpa foto bernilai null & rowPhotos dihilangkan bila seluruhnya kosong.
  const rowPhotos = (out.rowPhotos || []).map((list) => {
    const ok = (list || []).filter((u) => typeof u === 'string' && u.startsWith('/uploads/') && !u.includes('..'));
    return ok.length ? ok : null;
  });
  const anyPhoto = rowPhotos.some(Boolean);
  return {
    source,
    sourceLabel: SOURCE_LABEL[source] || source,
    title: out.title,
    period: ctx.label || null,
    summary: out.summary || [],
    columns: out.columns || [],
    rows: out.rows || [],
    ...(anyPhoto ? { rowPhotos } : {}),
    generatedAt: new Date().toISOString(),
  };
}
