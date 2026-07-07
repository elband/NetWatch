// Pembangun HTML "Program Kerja Unit" format resmi (Nota Dinas + I–V naratif +
// matriks jadwal tahunan + tanda tangan). Fungsi murni: semua data & origin di-pass
// eksplisit sehingga bisa dirender/diuji di luar browser. Dipakai Perencanaan.tsx.
import type { UnitPlan, UnitKpi } from '../types';

export interface ProgramKerjaCfg {
  nd_nomor?: string;
  nd_perihal?: string;
  latar_belakang?: string;
  tujuan?: string;
  personil_pengantar?: string;
  preventif?: string;
  korektif_pengantar?: string;
  penutup?: string;
  perawatan_cadence?: 'mingguan' | 'dwiminggu' | 'bulanan';
  tgl_dokumen?: string; // mis. "Mei 2025" — bila kosong dipakai bulan/tahun cetak
}
export interface PkLkp {
  kantor: string; unit: string; kota: string; fasilitas: string;
  kepala_jabatan: string; kepala_nama: string; kepala_nip: string;
  koord_jabatan: string; koord_nama: string; koord_nip: string;
  nd_kode: string; nd_yth: string; nd_dari: string; kop_url?: string;
}
export interface PkPersonil { no: number; name: string; nip: string | null; pangkat: string | null; ttl: string | null; jabatan: string | null }
export interface PkEquipGroup { category: string; items: { id: number; name: string; type: string | null; loc: string | null }[] }
export interface PkMaintCell { device_id: number; month: number; week: number } // month 0-11, week 0-3
export interface PkData {
  tahun: number;
  cfg: ProgramKerjaCfg;
  lkp: PkLkp;
  personil: PkPersonil[];
  equipment: PkEquipGroup[];
  maintenance: PkMaintCell[];
  plans: UnitPlan[];
  kpi: UnitKpi[];
}

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MEI', 'JUN', 'JUL', 'AGU', 'SEP', 'OKT', 'NOV', 'DES'];
const esc = (t: unknown) => String(t ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
// Render teks multi-baris jadi paragraf (dipisah baris kosong) yang menjaga baris tunggal.
const paras = (text: string) => text.split(/\n{2,}/).map((p) => `<p class="just">${esc(p.trim()).replace(/\n/g, '<br>')}</p>`).join('');

// ===== Teks naratif standar (fallback bila belum diisi di Pengaturan) =====
export const PK_DEFAULT_CFG: Required<Omit<ProgramKerjaCfg, 'tgl_dokumen'>> = {
  nd_nomor: '     /TO/APTP/     /20  ',
  nd_perihal: 'Program Kerja Unit Elektronika Bandara',
  latar_belakang:
    'Bandara atau bandar udara yang juga populer disebut dengan istilah airport merupakan sebuah fasilitas di mana pesawat terbang seperti pesawat udara dan helikopter dapat lepas landas dan mendarat. Menurut Annex 14 dari ICAO (International Civil Aviation Organization): Bandar udara adalah area tertentu di daratan atau perairan (termasuk bangunan, instalasi dan peralatan) yang diperuntukkan baik secara keseluruhan atau sebagian untuk kedatangan, keberangkatan dan pergerakan pesawat.\n\nDalam perkembangannya, berbagai fasilitas dan peralatan ditambahkan termasuk juga peralatan Elektronika seperti Sistem tampilan informasi penerbangan (FIDS), Sistem Public Address (PA) bandara dan lain-lain. Unit elektronika bandara adalah bagian yang bertanggung jawab atas pengoperasian dan pemeliharaan berbagai sistem elektronik di bandara.',
  tujuan:
    'Tujuan utama program kerja unit elektronika bandara adalah untuk memastikan operasional bandara yang aman, efisien, dan lancar dengan menjaga keandalan dan kinerja peralatan elektronika bandara. Ini mencakup tanggung jawab atas pemeliharaan, perbaikan, dan pengoperasian sistem elektronik dan peralatan yang digunakan di bandara, serta pemahaman yang baik tentang protokol keamanan dan keselamatan penerbangan.',
  personil_pengantar:
    'Dalam melaksanakan tugas dan fungsinya, unit Elektronika Bandara beranggotakan personil sebagai berikut:',
  preventif:
    'Berdasarkan tingkat kesulitan pelaksanaan, pemeliharaan fasilitas elektronika terdiri dari pemeliharaan tingkat 1, 2, 3, dan 4.\n\nPemeliharaan tingkat 1 merupakan pemeliharaan pencegahan yang dilaksanakan secara berkala dengan kegiatan: pembersihan ruangan; pembersihan peralatan/unit/bagian peralatan atau modul; pemeriksaan peralatan/unit/bagian peralatan; pemeriksaan lampu indikator; serta penggantian lampu indikator, komponen pengaman dan komponen habis pakai lainnya.\n\nPemeliharaan tingkat 2 meliputi pemeliharaan pencegahan berkala (uji coba peralatan, pengamatan tampilan dan target, pengecekan keluaran peralatan) dan pemeliharaan perbaikan untuk gangguan/kerusakan ringan (analisis kerusakan, penyetelan parameter, penggantian unit/modul dengan cadangan).\n\nPemeliharaan tingkat 3 adalah pemeliharaan perbaikan apabila peralatan mengalami gangguan/kerusakan sedang. Pemeliharaan tingkat 4 adalah pemeliharaan perbaikan apabila peralatan mengalami gangguan/kerusakan berat, termasuk modifikasi, rekondisi atau overhaul peralatan.',
  korektif_pengantar:
    'Selain pemeliharaan preventif, direncanakan kegiatan korektif dan pengembangan sebagai berikut:',
  penutup:
    'Demikian Program Kerja Unit Elektronika Bandara ini dibuat sebagai bahan pertimbangan pimpinan dalam pengambilan keputusan.',
  perawatan_cadence: 'mingguan',
};

function cfgVal<K extends keyof typeof PK_DEFAULT_CFG>(cfg: ProgramKerjaCfg, k: K): string {
  const v = (cfg as Record<string, unknown>)[k];
  return (typeof v === 'string' && v.trim()) ? v : String(PK_DEFAULT_CFG[k]);
}

const KATEGORI_LABEL: Record<string, string> = {
  pemeliharaan: 'Pemeliharaan', pengadaan: 'Pengadaan', sdm: 'Pengembangan SDM',
  pengembangan: 'Peningkatan Sistem', administrasi: 'Administrasi/SOP', lainnya: 'Lainnya',
};

// Minggu yang ditandai perawatan per bulan sesuai kadensi.
function cadenceWeeks(c: string): number[] {
  if (c === 'bulanan') return [1];
  if (c === 'dwiminggu') return [0, 2];
  return [0, 1, 2, 3];
}
// Bulan aktif sebuah rencana (dari kuartal; 0 = tahunan → semua bulan).
function planMonths(kuartal: number): number[] {
  if (!kuartal) return Array.from({ length: 12 }, (_, i) => i);
  const s = (kuartal - 1) * 3;
  return [s, s + 1, s + 2];
}

export function buildProgramKerjaHtml(d: PkData, origin: string): string {
  const { cfg, lkp, tahun } = d;
  const tglDok = (cfg.tgl_dokumen && cfg.tgl_dokumen.trim()) || new Date().toLocaleDateString('id-ID', { month: 'long', year: 'numeric' });
  const kopUrl = lkp.kop_url ? (lkp.kop_url.startsWith('http') ? lkp.kop_url : origin + lkp.kop_url) : '';

  // ---------- Kop surat ----------
  // Kop = gambar yang diunggah di Surat Keluar (settings.lkp.kop_url). Bila belum
  // ada kop, header dibiarkan KOSONG (tanpa kop) — sama seperti dokumen lain.
  const kop = kopUrl ? `<img class="kopimg" src="${esc(kopUrl)}" alt="Kop">` : '';

  // ---------- Halaman 1: Nota Dinas ----------
  const notaDinas = `<div class="page">
    ${kop}
    <div class="nd-title">NOTA - DINAS</div>
    <div class="nd-nomor">Nomor: ${esc(cfgVal(cfg, 'nd_nomor'))}</div>
    <table class="nd-head">
      <tr><td class="l">Kepada Yth.</td><td>:</td><td>${esc(lkp.nd_yth)}</td></tr>
      <tr><td class="l">Dari</td><td>:</td><td>${esc(lkp.nd_dari)}</td></tr>
      <tr><td class="l">Perihal</td><td>:</td><td>${esc(cfgVal(cfg, 'nd_perihal'))}</td></tr>
      <tr><td class="l">Tanggal</td><td>:</td><td>${esc(tglDok)}</td></tr>
    </table>
    <div class="nd-rule"></div>
    <div class="just" style="margin-top:14px">Dengan Hormat, bersama ini disampaikan ${esc(cfgVal(cfg, 'nd_perihal'))}.</div>
    <div class="just">Demikian disampaikan, atas perhatian dan perkenannya diucapkan terima kasih.</div>
    <table class="ttd-solo"><tr><td>
      <div>${esc(lkp.kepala_jabatan)}</div>
      <div class="sp"></div>
      <div class="nm">${esc(lkp.kepala_nama)}</div>
      <div>NIP. ${esc(lkp.kepala_nip)}</div>
    </td></tr></table>
    <div class="tagline">Transform to Excellent</div>
  </div>`;

  // ---------- Halaman 2+: Judul + I. Latar Belakang, II. Tujuan ----------
  const secTitle = (rom: string, t: string) => `<div class="sec"><span class="rom">${rom}.</span> ${esc(t)}</div>`;
  const bodyStart = `<div class="page">
    <div class="doc-title">PROGRAM KERJA ELEKTRONIKA BANDARA</div>
    <div class="doc-sub">${esc(lkp.kantor)}</div>
    ${secTitle('I', 'Latar Belakang')}${paras(cfgVal(cfg, 'latar_belakang'))}
    ${secTitle('II', 'Tujuan')}${paras(cfgVal(cfg, 'tujuan'))}
  </div>`;

  // ---------- III. Personil ----------
  const personilRows = d.personil.length
    ? d.personil.map((p) => `<tr>
        <td class="c">${p.no}</td>
        <td>${esc(p.name)}${p.nip ? `<div class="small">NIP. ${esc(p.nip)}</div>` : ''}</td>
        <td class="c">${esc(p.pangkat || '-')}</td>
        <td>${esc(p.ttl || '-')}</td>
        <td>${esc(p.jabatan || '-')}</td>
        <td></td>
      </tr>`).join('')
    : '<tr><td colspan="6" class="c small">Belum ada data personil.</td></tr>';
  const personil = `<div class="page">
    ${secTitle('III', 'Personil')}${paras(cfgVal(cfg, 'personil_pengantar'))}
    <table class="data"><thead><tr>
      <th style="width:26px">No</th><th>Nama / NIP</th><th>Pangkat/Gol</th><th>Tempat, Tgl Lahir</th><th>Jabatan</th><th>Ket</th>
    </tr></thead><tbody>${personilRows}</tbody></table>
  </div>`;

  // ---------- IV. Kegiatan (A. Preventif + B. Korektif/Program) ----------
  const korektifItems = d.plans.length
    ? `<ol class="korektif">${d.plans.map((p) => `<li><b>${esc(p.judul)}</b>${p.deskripsi ? `<div class="just" style="margin-top:2px">${esc(p.deskripsi).replace(/\n/g, '<br>')}</div>` : ''}<div class="small">Kategori: ${esc(KATEGORI_LABEL[p.kategori] || p.kategori)}${p.target_date ? ` · Target: ${esc(p.target_date)}` : ''}${p.pic_nama ? ` · PIC: ${esc(p.pic_nama)}` : ''}</div></li>`).join('')}</ol>`
    : '<div class="small">Belum ada program kerja terdaftar untuk tahun ini.</div>';
  const kegiatan = `<div class="page">
    ${secTitle('IV', 'Kegiatan')}
    <div class="subsec">A. Preventif (Pemeliharaan)</div>${paras(cfgVal(cfg, 'preventif'))}
    <div class="subsec">B. Korektif &amp; Program Kerja</div>${paras(cfgVal(cfg, 'korektif_pengantar'))}${korektifItems}
  </div>`;

  // ---------- Matriks Jadwal Tahunan (landscape) ----------
  const cWeeks = cadenceWeeks(cfg.perawatan_cadence || 'mingguan');
  const maintByDev = new Map<number, Set<number>>();
  for (const m of d.maintenance) {
    if (!maintByDev.has(m.device_id)) maintByDev.set(m.device_id, new Set());
    maintByDev.get(m.device_id)!.add(m.month * 4 + m.week);
  }
  const cell = (color: string) => `<td class="mc" style="background:${color}"></td>`;
  const emptyCells = () => Array.from({ length: 48 }, () => '<td class="mc"></td>').join('');
  // Baris perawatan per alat: sel merah untuk minggu kadensi + jadwal nyata.
  const equipRows = d.equipment.map((g) => {
    const head = `<tr class="grp"><td></td><td class="lbl">${esc(g.category)}</td>${emptyCells()}</tr>`;
    const rows = g.items.map((it) => {
      const real = maintByDev.get(it.id) || new Set<number>();
      const cells = [];
      for (let m = 0; m < 12; m++) for (let w = 0; w < 4; w++) {
        const on = cWeeks.includes(w) || real.has(m * 4 + w);
        cells.push(on ? cell('#e8615a') : '<td class="mc"></td>');
      }
      return `<tr><td></td><td class="lbl2">${esc(it.name)}${it.type ? ` <span class="small">· ${esc(it.type)}</span>` : ''}</td>${cells.join('')}</tr>`;
    }).join('');
    return head + rows;
  }).join('') || `<tr><td></td><td class="lbl2 small">Belum ada peralatan terdaftar.</td>${emptyCells()}</tr>`;
  // Baris kegiatan (rencana): sel hijau di bulan aktif.
  const kegiatanRows = d.plans.map((p, i) => {
    const months = new Set(planMonths(Number(p.kuartal) || 0));
    const cells = [];
    for (let m = 0; m < 12; m++) for (let w = 0; w < 4; w++) cells.push(months.has(m) ? cell('#5cb85c') : '<td class="mc"></td>');
    return `<tr><td class="c">${i + 1}</td><td class="lbl2">${esc(p.judul)}</td>${cells.join('')}</tr>`;
  }).join('') || `<tr><td></td><td class="lbl2 small">Belum ada program kerja.</td>${emptyCells()}</tr>`;
  // Pelaporan bulanan (biru, minggu ke-4 tiap bulan).
  const pelaporanCells = [];
  for (let m = 0; m < 12; m++) for (let w = 0; w < 4; w++) pelaporanCells.push(w === 3 ? cell('#5b9bd5') : '<td class="mc"></td>');
  const monthHead = MONTHS.map((m) => `<th class="mh" colspan="4">${m}</th>`).join('');
  const weekHead = Array.from({ length: 12 }, () => [1, 2, 3, 4].map((w) => `<th class="wh">${w}</th>`).join('')).join('');
  const matrix = `<div class="page landscape">
    <div class="doc-title" style="font-size:14px">RENCANA DAN PROGRAM KEGIATAN UNIT ELEKTRONIKA BANDARA TAHUN ${esc(tahun)}</div>
    <div class="doc-sub" style="margin-bottom:6px">${esc(lkp.kantor)}</div>
    <table class="matrix">
      <thead>
        <tr><th class="mno" rowspan="2">No</th><th class="mkeg" rowspan="2">Kegiatan</th>${monthHead}</tr>
        <tr>${weekHead}</tr>
      </thead>
      <tbody>
        <tr class="band"><td></td><td class="lbl">PERAWATAN</td>${emptyCells()}</tr>
        ${equipRows}
        <tr class="band"><td></td><td class="lbl">KEGIATAN</td>${emptyCells()}</tr>
        ${kegiatanRows}
        <tr class="band"><td></td><td class="lbl">PELAPORAN</td>${emptyCells()}</tr>
        <tr><td class="c">1</td><td class="lbl2">Laporan Bulanan (LAPBUL)</td>${pelaporanCells.join('')}</tr>
      </tbody>
    </table>
    <div class="legend">
      <span><i style="background:#e8615a"></i> Perawatan</span>
      <span><i style="background:#5cb85c"></i> Kegiatan / Program</span>
      <span><i style="background:#5b9bd5"></i> Pelaporan</span>
    </div>
  </div>`;

  // ---------- V. Penutup + Tanda tangan ----------
  const penutup = `<div class="page">
    ${secTitle('V', 'Penutup')}${paras(cfgVal(cfg, 'penutup'))}
    <table class="ttd2"><tr>
      <td>&nbsp;</td>
      <td>
        <div>${esc(lkp.kota)}, ${esc(tglDok)}</div>
        <div>Dibuat oleh :</div>
        <div>${esc(lkp.koord_jabatan)}</div>
        <div class="sp"></div>
        <div class="nm">${esc(lkp.koord_nama)}</div>
        <div>NIP. ${esc(lkp.koord_nip)}</div>
      </td>
    </tr></table>
    <table class="ttd2" style="margin-top:6px"><tr>
      <td>
        <div>Diketahui oleh :</div>
        <div>${esc(lkp.kepala_jabatan)}</div>
        <div class="sp"></div>
        <div class="nm">${esc(lkp.kepala_nama)}</div>
        <div>NIP. ${esc(lkp.kepala_nip)}</div>
      </td>
      <td>&nbsp;</td>
    </tr></table>
  </div>`;

  const kpiPage = d.kpi.length ? buildKpiPage(d) : '';

  return `<!doctype html><html><head><meta charset="utf-8"><title>Program Kerja Unit ${esc(tahun)}</title>
  <style>
    *{-webkit-print-color-adjust:exact;print-color-adjust:exact;box-sizing:border-box}
    body{font-family:'Times New Roman',serif;color:#111;font-size:12px;line-height:1.5;margin:0;background:#fff}
    @page{size:A4 portrait;margin:0}
    @page rotated{size:A4 landscape;margin:0}
    .page{width:210mm;min-height:297mm;padding:18mm 20mm;margin:0 auto;background:#fff;page-break-after:always;position:relative}
    .page.landscape{width:297mm;min-height:210mm;padding:12mm 14mm;page:rotated}
    @media screen{.page{box-shadow:0 1px 10px rgba(0,0,0,.25);margin-bottom:10px}}
    .just{text-align:justify;margin:8px 0;text-indent:24px}
    /* Kop — gambar kop/letterhead yang diunggah di Surat Keluar (settings.lkp.kop_url),
       dirender full-width tinggi natural agar identik dengan dokumen lain. */
    .kopimg{width:100%;display:block;margin-bottom:6px}
    /* Nota Dinas */
    .nd-title{text-align:center;font-weight:bold;font-size:16px;letter-spacing:3px;text-decoration:underline;margin:22px 0 2px}
    .nd-nomor{text-align:center;margin-bottom:18px}
    table.nd-head{margin:0 0 4px}table.nd-head td{padding:2px 6px;vertical-align:top}table.nd-head td.l{width:96px}
    .nd-rule{border-bottom:1px solid #000;width:60%;margin-left:96px}
    table.ttd-solo{margin:40px 0 0 55%;font-size:12px}table.ttd-solo .sp{height:60px}
    .ttd-solo .nm{font-weight:bold;text-decoration:underline}
    .tagline{position:absolute;bottom:14mm;left:0;right:0;text-align:center;font-style:italic;font-size:20px;color:#2f6fb0;font-family:'Segoe Script','Brush Script MT',cursive}
    /* Sections */
    .doc-title{text-align:center;font-weight:bold;font-size:15px;text-transform:uppercase;margin-bottom:2px}
    .doc-sub{text-align:center;font-weight:bold;font-size:12px;margin-bottom:14px}
    .sec{font-weight:bold;font-size:13px;margin:16px 0 4px}.sec .rom{display:inline-block;min-width:22px}
    .subsec{font-weight:bold;margin:12px 0 2px;padding-left:8px}
    p.just{margin:6px 0}
    ol.korektif{margin:6px 0 0 0;padding-left:22px}ol.korektif li{margin-bottom:8px;text-align:justify}
    .small{font-size:10px;color:#555}
    /* Tabel data */
    table.data{width:100%;border-collapse:collapse;font-size:11px;margin-top:6px}
    table.data th,table.data td{border:1px solid #333;padding:4px 6px;vertical-align:top;text-align:left}
    table.data th{background:#e8eef7;text-align:center}
    td.c{text-align:center}
    table.data td .small{font-weight:normal}
    /* Tanda tangan penutup */
    table.ttd2{width:100%;font-size:12px;page-break-inside:avoid}table.ttd2 td{width:50%;vertical-align:top;text-align:center}
    table.ttd2 .sp{height:60px}table.ttd2 .nm{font-weight:bold;text-decoration:underline}
    /* Matriks */
    table.matrix{width:100%;border-collapse:collapse;font-size:8px;table-layout:fixed}
    table.matrix th,table.matrix td{border:1px solid #888}
    .matrix .mno{width:22px}.matrix .mkeg{width:150px;text-align:left;padding:2px 4px}
    .matrix .mh{background:#f5d34a;font-weight:bold;font-size:9px;padding:2px}
    .matrix .wh{background:#fdf1c4;width:12px;font-size:7px;padding:1px}
    .matrix td.mc{height:14px;padding:0}
    .matrix .lbl{font-weight:bold;background:#f5d34a;text-align:left;padding:2px 4px;font-size:9px}
    .matrix .lbl2{text-align:left;padding:1px 4px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    .matrix tr.grp .lbl{background:#eaf1d6}
    .matrix tr.band .lbl{background:#f5d34a}
    .legend{margin-top:8px;font-size:10px;display:flex;gap:18px}
    .legend i{display:inline-block;width:14px;height:11px;border:1px solid #888;vertical-align:middle;margin-right:4px}
    @media print{.page{box-shadow:none;margin:0}}
  </style></head><body>
    ${notaDinas}${bodyStart}${personil}${kegiatan}${matrix}${kpiPage}${penutup}
  </body></html>`;
}

// Halaman KPI opsional (bila ada target/KPI).
function buildKpiPage(d: PkData): string {
  const rows = d.kpi.map((k, i) => {
    const fmt = (v: number | null) => v == null ? '-' : `${Number(v)}${k.satuan ? ' ' + k.satuan : ''}`;
    let pct: string;
    if (k.target == null || k.realisasi == null) pct = 'Belum diisi';
    else { const t = Number(k.target), r = Number(k.realisasi); const p = k.arah === 'turun' ? (r <= 0 ? 100 : Math.round(t / r * 100)) : (t <= 0 ? (r > 0 ? 100 : 0) : Math.round(r / t * 100)); pct = p >= 100 ? 'Tercapai' : `${p}%`; }
    return `<tr><td class="c">${i + 1}</td><td>${esc(k.label)}${k.catatan ? `<div class="small">${esc(k.catatan)}</div>` : ''}</td><td class="c">${esc(fmt(k.target))}</td><td class="c">${esc(fmt(k.realisasi))}</td><td class="c">${k.arah === 'turun' ? '⬇' : '⬆'}</td><td class="c">${esc(pct)}</td></tr>`;
  }).join('');
  return `<div class="page">
    <div class="sec"><span class="rom">VI.</span> Target / Indikator Kinerja (KPI) ${esc(d.tahun)}</div>
    <table class="data"><thead><tr><th style="width:26px">No</th><th>Indikator (KPI)</th><th>Target</th><th>Realisasi</th><th>Arah</th><th>Capaian</th></tr></thead><tbody>${rows}</tbody></table>
  </div>`;
}
