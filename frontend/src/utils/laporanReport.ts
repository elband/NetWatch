// Pembangun HTML Laporan Bulanan format resmi (Kemenhub) — dipakai untuk preview & cetak.
export interface PerfTek { name: string; jabatan: string | null; done: number; onTime: number; taken: number; kritisDone: number; inspeksi: number; inspeksiV: number; breaches: number; score: number; }
export interface PerfKoord { name: string; jabatan: string | null; approvals: number; reportsSigned: number; suratCreated: number; suratSigned: number; escalations: number; score: number; }
export interface LaporanData {
  month: string; monthName: string; year: number; nextMonthName: string;
  personil: { no: number; name: string; nip: string | null; jabatan: string | null; pangkat: string | null; ttl: string | null; skor: number | null; grade: string }[];
  inventaris: { no: number; nama: string; merk: string; serial: string; tahun: string; lokasi: string; kondisi: string; ket: string }[];
  jadwalBulanIni: { month: string; days: number; rows: { nama: string; cells: string[] }[] };
  jadwal: { month: string; days: number; rows: { nama: string; cells: string[] }[] };
  kegiatanHarian: { tanggal: string; hari: string; petugas: string; items: { jam: string; peralatan: string; kegiatan: string; hasil: string }[] }[];
  dokumentasi?: { url: string; tanggal: string; jenis: string; peralatan: string; ket: string; oleh: string }[];
  dokumentasiTruncated?: number;
  unjukHasil: { days: number; rows: { no: number; nama: string; cells: string[]; ket: string }[] };
  evaluasi: { no: number; fasilitas: string; terjadwalJam: number; operasiJam: number; kegagalanJam: number; jumlahKegagalan: number; performancePct: number; ket: string; measuredUptimePct: number | null; avgPingMs: number | null }[];
  perbaikan: { no: number; tanggal: string; peralatan: string; lokasi: string; kategori: string; bagian: string; kerusakan: string; tindakan: string; tglKerusakan: string; tglSelesai: string; jam: string; ket: string }[];
  lkp: { incidentId: string; tanggal: string; lokasi: string; peralatan: string; bagian: string; kategori: string; uraian: string; tindakan: string; penyebab: string; oleh: string; tglKerusakan: string; tglSelesai: string; sparepart: string; hasil: string }[];
  logbook?: { no: number; peralatan: string; ip: string; uptimePct: number | null; avgPing: number | null; maxPing: number | null; inspeksi: number; baik: number; perhatian: number; rusak: number; hidup: number; mati: number; maintenance: number; maintSelesai: number; insiden: number; downtimeMin: number }[];
  recap: { tiketIn: number; tiketDone: number; mttr: number; slaPct: number; escalations: number; measuredUptimePct?: number | null };
  performaTeknisi: PerfTek[];
  performaKoordinator: PerfKoord[];
  opsHoursPerDay: number;
}

export interface LkpHead {
  kantor: string; kota: string; bandara: string;
  koord_jabatan: string; koord_nama: string; koord_nip: string;
  kasie_jabatan: string; kasie_nama: string; kasie_nip: string;
  nd_yth: string; nd_dari: string;
  kop_url?: string; // URL gambar kop/letterhead yang diunggah (opsional)
}
export interface CoverInfo {
  id?: number; nomor: string; tanggal: string; tujuan?: string | null;
  signer_name?: string | null; signer_nip?: string | null; sign_token?: string | null;
  kasi_signer_name?: string | null; kasi_signer_nip?: string | null; kasi_sign_token?: string | null;
}

export type SectionKey = 'cover' | 'personil' | 'inventaris' | 'jadwalBulanIni' | 'jadwal' | 'kegiatan' | 'dokumentasi' | 'unjukHasil' | 'evaluasi' | 'perbaikan' | 'lkp' | 'logbook' | 'lampiran';
export const SECTIONS: { key: SectionKey; label: string }[] = [
  { key: 'cover', label: 'Halaman Sampul' },
  { key: 'personil', label: 'I. Data Personil Teknisi' },
  { key: 'inventaris', label: 'II. Daftar/Inventaris Peralatan' },
  { key: 'jadwalBulanIni', label: 'III. Jadwal Dinas (bulan laporan)' },
  { key: 'jadwal', label: 'IV. Jadwal Dinas (bulan berikutnya)' },
  { key: 'kegiatan', label: 'V. Laporan Kegiatan dalam 1 Bulan' },
  { key: 'dokumentasi', label: 'VI. Dokumentasi Kegiatan (foto)' },
  { key: 'unjukHasil', label: 'VII. Laporan Unjuk Hasil / Performance' },
  { key: 'evaluasi', label: 'VIII. Evaluasi Kinerja Fasilitas' },
  { key: 'perbaikan', label: 'IX. Daftar Kegiatan Perbaikan & Kerusakan' },
  { key: 'lkp', label: 'X. LKP per Kerusakan' },
  { key: 'logbook', label: 'XI. Logbook Peralatan' },
  { key: 'lampiran', label: 'Lampiran: Ringkasan & Grafik Kinerja' },
];

const esc = (t: any) => String(t ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// Warna sel jadwal per kode shift.
const shiftBg = (c: string) => (c === 'P' ? '#dcfce7' : c === 'S' ? '#ffedd5' : c === 'N' ? '#dbeafe' : c === 'L' ? '#f3f4f6' : c === 'DL' ? '#ede9fe' : c === 'C' ? '#fce7f3' : '#fff');
const shiftFg = (c: string) => (c === 'P' ? '#166534' : c === 'S' ? '#9a3412' : c === 'N' ? '#1e40af' : c === 'L' ? '#6b7280' : c === 'DL' ? '#6d28d9' : c === 'C' ? '#be185d' : '#000');
// Warna sel unjuk hasil.
const cellBg = (c: string) => (c === 'x' ? '#fee2e2' : c === 'i' ? '#fef9c3' : '#dcfce7');

// Bar chart horizontal (SVG, ramah cetak).
function hbar(items: { label: string; value: number; color?: string }[], opts: { max?: number; suffix?: string } = {}): string {
  if (!items.length) return '<div style="font-size:10px;color:#666">Tidak ada data</div>';
  const W = 500, rowH = 24, pad = 130, max = opts.max || Math.max(1, ...items.map((i) => i.value));
  const H = items.length * rowH + 8;
  const bars = items.map((it, i) => {
    const bw = Math.max(1, (it.value / max) * (W - pad - 56));
    const y = i * rowH + 6;
    return `<text x="0" y="${y + 13}" font-size="10" fill="#111">${esc(it.label)}</text>
      <rect x="${pad}" y="${y + 3}" width="${W - pad - 56}" height="14" fill="#eef2f7" rx="2"/>
      <rect x="${pad}" y="${y + 3}" width="${bw}" height="14" fill="${it.color || '#2563eb'}" rx="2"/>
      <text x="${pad + bw + 5}" y="${y + 14}" font-size="10" font-weight="bold" fill="#111">${esc(it.value)}${esc(opts.suffix || '')}</text>`;
  }).join('');
  return `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" style="max-width:100%">${bars}</svg>`;
}
// Gauge donut persentase.
function gauge(pct: number, label: string, color?: string): string {
  const r = 40, c = 2 * Math.PI * r, off = c * (1 - Math.max(0, Math.min(100, pct)) / 100);
  const col = color || (pct >= 95 ? '#16a34a' : pct >= 80 ? '#ea580c' : '#dc2626');
  return `<svg width="110" height="110" viewBox="0 0 120 120">
    <circle cx="60" cy="60" r="${r}" fill="none" stroke="#e5e7eb" stroke-width="13"/>
    <circle cx="60" cy="60" r="${r}" fill="none" stroke="${col}" stroke-width="13" stroke-dasharray="${c}" stroke-dashoffset="${off}" stroke-linecap="round" transform="rotate(-90 60 60)"/>
    <text x="60" y="58" text-anchor="middle" font-size="22" font-weight="bold" fill="#111">${pct}%</text>
    <text x="60" y="78" text-anchor="middle" font-size="9" fill="#555">${esc(label)}</text>
  </svg>`;
}

export function buildReportHtml(data: LaporanData, cover: CoverInfo, qr: string, lkp: LkpHead, sel: Set<SectionKey>, kasiQr = ''): string {
  const namaBulan = data.monthName;
  const tgl = new Date(cover.tanggal).toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' });
  const tglTtd = `${lkp.kota}, ${tgl}`;
  // TTE diterapkan ke SETIAP blok tanda tangan di seluruh halaman (QR koordinator dari Nota Dinas yang sudah disahkan).
  const koordTtd = () => `<td style="text-align:center"><div>${esc(tglTtd)}</div><div>Dibuat Oleh :</div><div class="jb">${esc(lkp.koord_jabatan)}</div>
      ${qr ? `<div style="margin:2px auto"><img src="${qr}" style="width:80px;height:80px"><div style="font-size:7px;color:#0a0">✔ Ditandatangani Elektronik (TTE)</div><div style="font-size:7px;color:#444">${esc(cover.sign_token)}</div></div>` : '<div class="sp"></div>'}
      <div class="nm">${esc(cover.signer_name || lkp.koord_nama)}</div><div>NIP. ${esc(cover.signer_nip || lkp.koord_nip)}</div></td>`;
  // Sisi "Diperiksa Oleh" (Kepala Seksi). Bila sudah TTE → tampilkan QR + caption, jika belum → ruang ttd manual.
  const kasiTtd = () => `<td><div>Diperiksa Oleh :</div><div class="jb">${esc(lkp.kasie_jabatan)}<br>${esc(lkp.kantor)}</div>
      ${kasiQr ? `<div style="margin:2px 0"><img src="${kasiQr}" style="width:80px;height:80px"><div style="font-size:7px;color:#0a0">✔ Ditandatangani Elektronik (TTE)</div><div style="font-size:7px;color:#444">${esc(cover.kasi_sign_token || '')}</div></div>` : '<div class="sp"></div>'}
      <div class="nm">${esc(cover.kasi_signer_name || lkp.kasie_nama)}</div><div>NIP. ${esc(cover.kasi_signer_nip || lkp.kasie_nip)}</div></td>`;
  // sign(): blok ganda (Diperiksa Kasie + Dibuat Koordinator). sign({ kasie:false }): hanya koordinator (untuk Nota Dinas).
  const sign = (opts: { kasie?: boolean } = {}) => opts.kasie === false
    ? `<table class="sign"><tr><td></td>${koordTtd()}</tr></table>`
    : `<table class="sign"><tr>${kasiTtd()}${koordTtd()}</tr></table>`;
  const sec = (title: string) => `<div class="sec">${esc(title)}</div>`;
  const head2 = (t: string) => `<div style="display:flex;justify-content:space-between;font-size:10px;margin:2px 0"><span>BANDAR UDARA : ${esc(lkp.bandara)}</span><span>${esc(t)}</span></div>`;
  const bln = namaBulan.toUpperCase();
  const has = (k: SectionKey) => sel.has(k);
  const pages: string[] = [];

  // Nota Dinas (selalu ada)
  pages.push(`<div class="page">
    <div class="judul">Nota Dinas</div>
    <div class="nomor">Nomor: ${esc(cover.nomor)}</div>
    <table class="head">
      <tr><td class="l">Yth</td><td>:</td><td>${esc(cover.tujuan || lkp.nd_yth)}</td></tr>
      <tr><td class="l">Dari</td><td>:</td><td>${esc(lkp.nd_dari)}</td></tr>
      <tr><td class="l">Hal</td><td>:</td><td><b>- Laporan Bulanan Unit Elektronika Bandara ${esc(namaBulan)}<br>- Jadwal Dinas Unit Elektronika Bandara ${esc(data.nextMonthName)}</b></td></tr>
      <tr><td class="l">Tanggal</td><td>:</td><td>${tgl}</td></tr>
    </table>
    <div class="isi">Dengan ini disampaikan Laporan Bulanan Unit Elektronika Bandara periode <b>${esc(namaBulan)}</b> dan Jadwal Dinas Unit ${esc(data.nextMonthName)} dan mohon persetujuannya guna proses lebih lanjut.</div>
    <div class="isi">Demikian disampaikan, atas perhatiannya diucapkan terima kasih.</div>
    ${sign({ kasie: false })}
  </div>`);

  if (has('cover')) pages.push(`<div class="page"><div class="cover">
    <div>BADAN LAYANAN UMUM<br>KANTOR UNIT PENYELENGGARA BANDAR UDARA KELAS I<br>${esc(lkp.kantor)}</div>
    <div class="big" style="margin-top:30mm">LAPORAN BULANAN</div>
    <div class="sub">UNIT ELEKTRONIKA BANDARA</div>
    <div class="sub">BULAN ${esc(bln)}</div>
  </div></div>`);

  if (has('personil')) {
    // OJT (peserta on-the-job training) tidak memakai NIP.
    const skorCell = (p: LaporanData['personil'][number]) => {
      if (p.skor == null) return '<td style="text-align:center;color:#888;font-size:9px">Belum dinilai</td>';
      const col = p.skor >= 90 ? '#16803c' : p.skor >= 75 ? '#16a34a' : p.skor >= 60 ? '#b45309' : p.skor >= 50 ? '#c2410c' : '#b91c1c';
      return `<td style="text-align:center;font-weight:bold;color:${col}">${p.skor}<br><span style="font-size:8px;font-weight:normal">${esc(p.grade)}</span></td>`;
    };
    const r = data.personil.map((p) => {
      const isOjt = /OJT/i.test(p.jabatan || '');
      const nip = isOjt ? '' : `<br><span style="font-size:9px">NIP. ${esc(p.nip || '-')}</span>`;
      return `<tr><td style="text-align:center">${p.no}</td><td>${esc(p.name)}${nip}</td><td>${esc(p.pangkat || '-')}</td><td>${esc(p.ttl || '-')}</td><td>${esc(p.jabatan || '-')}</td>${skorCell(p)}</tr>`;
    }).join('');
    pages.push(`<div class="page">${sec('Data Personil Teknisi Elektronika Bandara')}${head2(`BULAN/TAHUN : ${bln}`)}
      <table class="data"><thead><tr><th style="width:28px">No</th><th>Nama / NIP</th><th>Pangkat/Gol</th><th>Tempat, Tgl Lahir</th><th>Jabatan</th><th style="width:70px">Skor Performa</th></tr></thead><tbody>${r}</tbody></table>
      <div style="font-size:9px;margin-top:4px">Skor performa = rata-rata pencapaian target per komponen (0–100). Teknisi: SLA, penyelesaian, inspeksi, PM. Koordinator: persetujuan, ketersediaan alat, eskalasi, jadwal. Komponen tanpa tugas bulan itu tidak dihitung.</div>${sign()}</div>`);
  }
  if (has('inventaris')) {
    const r = data.inventaris.map((d) => `<tr><td style="text-align:center">${d.no}</td><td>${esc(d.nama)}</td><td>${esc(d.merk)}</td><td>${esc(d.serial)}</td><td>${esc(d.lokasi)}</td><td>${esc(d.tahun)}</td><td style="text-align:center">${esc(d.kondisi)}</td><td>${esc(d.ket)}</td></tr>`).join('');
    pages.push(`<div class="page">${sec('Daftar / Inventaris Peralatan Elektronika Bandara')}${head2(`BULAN/TAHUN : ${bln}`)}
      <table class="data"><thead><tr><th style="width:24px">No</th><th>Nama Peralatan</th><th>Merk/Tipe</th><th>No. Seri</th><th>Lokasi</th><th>Bln/Th</th><th>Kondisi</th><th>Keterangan</th></tr></thead><tbody>${r}</tbody></table>${sign()}</div>`);
  }
  const jadwalPage = (j: LaporanData['jadwal']) => {
    const jHead = Array.from({ length: j.days }, (_, i) => `<th style="padding:1px">${i + 1}</th>`).join('');
    const jRows = j.rows.map((r, i) => `<tr><td style="text-align:center">${i + 1}</td><td style="white-space:nowrap">${esc(r.nama)}</td>${r.cells.map((c) => `<td style="text-align:center;padding:1px;background:${shiftBg(c)};color:${shiftFg(c)};font-weight:bold">${esc(c)}</td>`).join('')}</tr>`).join('') || `<tr><td colspan="${j.days + 2}" style="text-align:center;color:#666">Belum ada jadwal ${esc(j.month)}</td></tr>`;
    const lg = (col: string, t: string) => `<span style="display:inline-block;width:11px;height:11px;background:${col};border:1px solid #999;vertical-align:middle;margin-right:3px"></span>${t}`;
    return `<div class="page">${sec(`Jadwal Dinas Unit Elektronika Bandara — ${j.month}`)}
      <table class="grid"><thead><tr><th>No</th><th>Nama</th>${jHead}</tr></thead><tbody>${jRows}</tbody></table>
      <div style="font-size:9px;margin-top:5px">Keterangan: ${lg('#dbeafe', 'N = Dinas Kantor')} &nbsp; ${lg('#dcfce7', 'P = Dinas Pagi')} &nbsp; ${lg('#ffedd5', 'S = Dinas Siang')} &nbsp; ${lg('#f3f4f6', 'L = Libur')} &nbsp; ${lg('#ede9fe', 'DL = Dinas Luar')} &nbsp; ${lg('#fce7f3', 'C = Cuti')}</div>${sign()}</div>`;
  };
  if (has('jadwalBulanIni')) pages.push(jadwalPage(data.jadwalBulanIni));
  if (has('jadwal')) pages.push(jadwalPage(data.jadwal));
  if (has('kegiatan')) {
    const blocks = data.kegiatanHarian.map((d) => d.items.map((it, k) => `<tr>${k === 0 ? `<td rowspan="${d.items.length}" style="vertical-align:top;text-align:center">${esc(d.hari)},<br>${esc(d.tanggal)}<br><span style="font-size:9px">${esc(d.petugas)}</span></td>` : ''}<td style="text-align:center">${esc(it.jam)}</td><td>${esc(it.peralatan)}</td><td>${esc(it.kegiatan)}</td><td style="text-align:center">${esc(it.hasil)}</td></tr>`).join('')).join('') || '<tr><td colspan="5" style="text-align:center;color:#666">Tidak ada kegiatan tercatat</td></tr>';
    pages.push(`<div class="page">${sec('Laporan Kegiatan Dalam 1 Bulan')}${head2(`BULAN/TAHUN : ${bln}`)}
      <div style="font-size:9px;color:#444;margin:2px 0">Sumber: log kegiatan, inspeksi rutin, maintenance/pemeliharaan & penanganan insiden (teknisi & koordinator).</div>
      <table class="data"><thead><tr><th style="width:90px">Tanggal / Petugas</th><th style="width:46px">Jam</th><th>Nama Peralatan</th><th>Nama Kegiatan</th><th style="width:60px">Hasil</th></tr></thead><tbody>${blocks}</tbody></table>${sign()}</div>`);
  }
  if (has('dokumentasi')) {
    const docs = data.dokumentasi || [];
    const cells = docs.map((p) => `<div style="border:1px solid #99a;border-radius:4px;overflow:hidden;break-inside:avoid">
      <img src="${location.origin}${esc(p.url)}" style="width:100%;height:130px;object-fit:cover;display:block">
      <div style="padding:3px 5px;font-size:8.5px;line-height:1.3"><b>${esc(p.jenis)}</b> · ${esc(p.tanggal)}<br>${esc(p.peralatan)}${p.oleh ? ` · ${esc(p.oleh)}` : ''}${p.ket ? `<br><span style="color:#444">${esc(p.ket)}</span>` : ''}</div>
    </div>`).join('');
    pages.push(`<div class="page">${sec('Dokumentasi Kegiatan')}${head2(`BULAN/TAHUN : ${bln}`)}
      <div style="font-size:9px;color:#444;margin:2px 0 6px">Foto bukti kegiatan yang diunggah ke sistem (inspeksi rutin & tindakan/perbaikan).</div>
      ${docs.length ? `<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:6px">${cells}</div>` : '<div style="text-align:center;color:#666;padding:20px">Belum ada dokumentasi foto pada periode ini.</div>'}
      ${data.dokumentasiTruncated ? `<div style="font-size:9px;color:#666;margin-top:6px">…dan ${data.dokumentasiTruncated} foto lainnya (ditampilkan ${docs.length} foto pertama).</div>` : ''}
      ${sign()}</div>`);
  }
  if (has('unjukHasil')) {
    const uHead = Array.from({ length: data.unjukHasil.days }, (_, i) => `<th style="padding:1px">${i + 1}</th>`).join('');
    const uRows = data.unjukHasil.rows.map((r) => `<tr><td style="text-align:center">${r.no}</td><td style="white-space:nowrap">${esc(r.nama)}</td>${r.cells.map((c) => `<td style="text-align:center;padding:1px;background:${cellBg(c)};color:#7f1d1d">${esc(c)}</td>`).join('')}<td style="font-size:9px">${esc(r.ket)}</td></tr>`).join('');
    pages.push(`<div class="page">${sec('Laporan Bulanan Unjuk Hasil / Performance')}${head2(`BULAN/TAHUN : ${bln}`)}
      <table class="grid"><thead><tr><th>No</th><th>Nama Peralatan</th>${uHead}<th>Ket</th></tr></thead><tbody>${uRows}</tbody></table>
      <div style="font-size:9px;margin-top:4px">Keterangan: kosong = Operasi Normal · x = Operasi Terputus · i = Operasi Menurun</div>${sign()}</div>`);
  }
  if (has('evaluasi')) {
    const upCell = (v: number | null) => (v == null ? '<td style="text-align:center;color:#888">–</td>' : `<td style="text-align:center;font-weight:bold;color:${v >= 99 ? '#16803c' : v >= 95 ? '#b45309' : '#b91c1c'}">${v}%</td>`);
    const r = data.evaluasi.map((e) => `<tr><td style="text-align:center">${e.no}</td><td>${esc(e.fasilitas)}</td><td style="text-align:center">${e.terjadwalJam}</td><td style="text-align:center">${e.operasiJam}</td><td style="text-align:center">${e.kegagalanJam}</td><td style="text-align:center">${e.jumlahKegagalan}</td><td style="text-align:center;font-weight:bold;color:${e.performancePct >= 95 ? '#16803c' : '#b45309'}">${e.performancePct}%</td>${upCell(e.measuredUptimePct)}<td style="text-align:center">${e.avgPingMs == null ? '–' : `${e.avgPingMs} ms`}</td><td>${esc(e.ket)}</td></tr>`).join('') || '<tr><td colspan="10" style="text-align:center;color:#666">Tidak ada fasilitas kritis</td></tr>';
    pages.push(`<div class="page">${sec('Evaluasi Kinerja Fasilitas Elektronika Bandara')}${head2(`BULAN/TAHUN : ${bln}`)}
      <table class="data"><thead><tr><th style="width:24px">No</th><th>Jenis Fasilitas</th><th>Terjadwal (jam)</th><th>Operasi (jam)</th><th>Kegagalan (jam)</th><th>Jml Gagal</th><th>Performance</th><th>Uptime Terukur</th><th>Avg Ping</th><th>Keterangan</th></tr></thead><tbody>${r}</tbody></table>
      <div style="font-size:9px;margin-top:4px">Jam operasional ${data.opsHoursPerDay} jam/hari (05:00–20:00). <b>Performance</b> = Operasi ÷ Terjadwal (berbasis insiden). <b>Uptime Terukur</b> = ketersediaan nyata dari pemantauan (sampel ping, mengecualikan maintenance terjadwal); "–" = belum ada data pemantauan pada periode ini.</div>${sign()}</div>`);
  }
  if (has('perbaikan')) {
    const r = data.perbaikan.map((r) => `<tr><td style="text-align:center">${r.no}</td><td>${esc(r.tanggal)}</td><td>${esc(r.peralatan)}</td><td>${esc(r.lokasi)}</td><td style="text-align:center">${esc(r.kategori)}</td><td>${esc(r.kerusakan)}</td><td>${esc(r.tindakan)}</td><td style="font-size:9px">${esc(r.tglKerusakan)}</td><td style="font-size:9px">${esc(r.tglSelesai)}</td><td style="text-align:center">${esc(r.jam)}</td><td style="font-size:9px">${esc(r.ket)}</td></tr>`).join('') || '<tr><td colspan="11" style="text-align:center;color:#666">Tidak ada kerusakan tercatat</td></tr>';
    pages.push(`<div class="page">${sec('Daftar Kegiatan Perbaikan dan Kerusakan')}${head2(`BULAN/TAHUN : ${bln}`)}
      <table class="data"><thead><tr><th style="width:20px">No</th><th>Tgl</th><th>Peralatan</th><th>Lokasi</th><th>Kat.</th><th>Kerusakan</th><th>Tindakan</th><th>Tgl/Jam Rusak</th><th>Tgl/Jam Selesai</th><th>Jam</th><th>Ket</th></tr></thead><tbody>${r}</tbody></table>${sign()}</div>`);
  }
  if (has('lkp')) {
    pages.push(...data.lkp.map((r) => `<div class="page">${sec('LAPORAN KERUSAKAN DAN PERBAIKAN PERALATAN ELEKTRONIKA BANDARA')}
      <table class="data lkp"><tbody>
        <tr><td style="width:30px;text-align:center">1</td><td style="width:46%">Tanggal/Bulan/Tahun</td><td>${esc(r.tanggal)}</td></tr>
        <tr><td style="text-align:center">2</td><td>Lokasi</td><td>${esc(r.lokasi)}</td></tr>
        <tr><td style="text-align:center">3</td><td>Fasilitas</td><td>Elektronika Bandara</td></tr>
        <tr><td style="text-align:center">4</td><td>Peralatan</td><td>${esc(r.peralatan)}</td></tr>
        <tr><td style="text-align:center">5</td><td>Bagian Peralatan</td><td>${esc(r.bagian)}</td></tr>
        <tr><td style="text-align:center">6</td><td>Kategori Kerusakan (RR/RB)</td><td>${esc(r.kategori)}</td></tr>
        <tr><td style="text-align:center">7</td><td>Uraian Kerusakan</td><td>${esc(r.uraian)}</td></tr>
        <tr><td style="text-align:center">8</td><td>Tindakan Perbaikan (Oleh: ${esc(r.oleh)})</td><td>${esc(r.tindakan)}</td></tr>
        <tr><td style="text-align:center">9</td><td>Penyebab Kerusakan</td><td>${esc(r.penyebab)}</td></tr>
        <tr><td style="text-align:center">10</td><td>Tgl/Jam Kerusakan</td><td>${esc(r.tglKerusakan)}</td></tr>
        <tr><td style="text-align:center">11</td><td>Tgl/Jam Selesai Perbaikan</td><td>${esc(r.tglSelesai)}</td></tr>
        <tr><td style="text-align:center">12</td><td>Suku Cadang</td><td>${esc(r.sparepart)}</td></tr>
        <tr><td style="text-align:center">13</td><td>Hasil</td><td>${esc(r.hasil)}</td></tr>
      </tbody></table>${sign()}</div>`));
  }
  if (has('logbook')) {
    const rows = (data.logbook || []).map((r) => `<tr>
      <td style="text-align:center">${r.no}</td>
      <td>${esc(r.peralatan)}<div style="font-size:8px;color:#666">${esc(r.ip)}</div></td>
      <td style="text-align:center">${r.uptimePct != null ? r.uptimePct + '%' : '–'}</td>
      <td style="text-align:center">${r.avgPing != null ? r.avgPing + '/' + r.maxPing + ' ms' : '–'}</td>
      <td style="text-align:center">${r.inspeksi} <span style="font-size:8px;color:#666">(${r.baik}/${r.perhatian}/${r.rusak})</span></td>
      <td style="text-align:center">${r.hidup}× / ${r.mati}×</td>
      <td style="text-align:center">${r.maintenance} (${r.maintSelesai}✓)</td>
      <td style="text-align:center">${r.insiden}${r.downtimeMin ? ' · ' + r.downtimeMin + 'm' : ''}</td>
    </tr>`).join('') || '<tr><td colspan="8" style="text-align:center;color:#666">Tidak ada aktivitas peralatan</td></tr>';
    pages.push(`<div class="page">${sec('Logbook Peralatan (Rekap Bulanan)')}${head2(`BULAN/TAHUN : ${bln}`)}
      <table class="data"><thead><tr><th style="width:20px">No</th><th>Peralatan</th><th>Uptime</th><th>Latensi (rata/maks)</th><th>Inspeksi (B/P/R)</th><th>Hidup/Mati</th><th>Maintenance</th><th>Insiden</th></tr></thead><tbody>${rows}</tbody></table>
      <div style="font-size:9px;margin-top:4px">Inspeksi: total (Baik/Perhatian/Rusak). Uptime &amp; latensi dari pemantauan (mengecualikan maintenance terjadwal).</div>${sign()}</div>`);
  }
  if (has('lampiran')) {
    const tek = data.performaTeknisi.map((t) => `<tr><td>${esc(t.name)}</td><td style="text-align:center">${t.done}</td><td style="text-align:center">${t.onTime}/${t.taken}</td><td style="text-align:center">${t.kritisDone}</td><td style="text-align:center">${t.inspeksi} (${t.inspeksiV}✓)</td><td style="text-align:center;color:#b91c1c">${t.breaches}</td><td style="text-align:center;font-weight:bold">${t.score}</td></tr>`).join('');
    const ko = data.performaKoordinator.map((k) => `<tr><td>${esc(k.name)}</td><td style="text-align:center">${k.approvals}</td><td style="text-align:center">${k.reportsSigned}</td><td style="text-align:center">${k.suratCreated}</td><td style="text-align:center">${k.suratSigned}</td><td style="text-align:center;color:#b91c1c">${k.escalations}</td><td style="text-align:center;font-weight:bold">${k.score}</td></tr>`).join('');
    const scoreCol = (s: number) => (s >= 70 ? '#16a34a' : s >= 40 ? '#ea580c' : '#dc2626');
    const chartInsiden = hbar([
      { label: 'Insiden Masuk', value: data.recap.tiketIn, color: '#2563eb' },
      { label: 'Insiden Selesai', value: data.recap.tiketDone, color: '#16a34a' },
      { label: 'Eskalasi Koord.', value: data.recap.escalations, color: '#dc2626' },
    ]);
    const chartTek = hbar(data.performaTeknisi.map((t) => ({ label: t.name, value: t.score, color: scoreCol(t.score) })), { max: 100 });
    const chartEval = data.evaluasi.length
      ? hbar(data.evaluasi.map((e) => ({ label: e.fasilitas, value: e.performancePct, color: e.performancePct >= 95 ? '#16a34a' : '#ea580c' })), { max: 100, suffix: '%' })
      : '';
    pages.push(`<div class="page">${sec('Ringkasan & Grafik Kinerja')}
      <div class="stats">
        <div class="stat"><b>${data.recap.tiketIn}</b>Insiden Masuk</div>
        <div class="stat"><b>${data.recap.tiketDone}</b>Insiden Selesai</div>
        <div class="stat"><b>${data.recap.slaPct}%</b>Ketepatan SLA</div>
        ${data.recap.measuredUptimePct != null ? `<div class="stat"><b>${data.recap.measuredUptimePct}%</b>Uptime Terukur</div>` : ''}
        <div class="stat"><b>${data.recap.mttr}m</b>Rata² Penyelesaian</div>
        <div class="stat"><b>${data.recap.escalations}</b>Eskalasi Koord.</div>
      </div>
      <div style="display:flex;gap:14px;align-items:center;margin:12px 0;flex-wrap:wrap">
        <div style="text-align:center">${gauge(data.recap.slaPct, 'Ketepatan SLA', '#2563eb')}</div>
        ${data.recap.measuredUptimePct != null ? `<div style="text-align:center">${gauge(data.recap.measuredUptimePct, 'Uptime Terukur')}</div>` : ''}
        <div style="flex:1;min-width:280px"><div class="cap">Volume Insiden</div>${chartInsiden}</div>
      </div>
      <div class="cap">Skor Performa Teknisi (0–100)</div>${chartTek}
      ${chartEval ? `<div class="cap" style="margin-top:8px">Performance Fasilitas (%)</div>${chartEval}` : ''}
      <div style="font-weight:bold;margin:12px 0 4px">Performa Teknisi</div>
      <table class="data"><thead><tr><th>Nama</th><th>Selesai</th><th>Tepat SLA</th><th>Kritis</th><th>Inspeksi</th><th>Langgar</th><th>Skor</th></tr></thead><tbody>${tek}</tbody></table>
      <div style="font-weight:bold;margin:10px 0 4px">Performa Koordinator</div>
      <table class="data"><thead><tr><th>Nama</th><th>Setuju Keg.</th><th>Sah LKP</th><th>Surat Dibuat</th><th>Surat di-TTE</th><th>Eskalasi</th><th>Skor</th></tr></thead><tbody>${ko}</tbody></table>${sign()}</div>`);
  }

  return `<!doctype html><html><head><meta charset="utf-8"><title>Laporan Bulanan ${esc(namaBulan)}</title>
    <style>*{-webkit-print-color-adjust:exact;print-color-adjust:exact}
    body{font-family:'Times New Roman',serif;color:#111;background:#fff;font-size:11px;line-height:1.4;margin:0}
    .page{width:190mm;margin:0 auto 8px;padding:16mm 12mm;box-sizing:border-box;background:#fff;page-break-after:always;border-top:4px solid #1d4ed8}
    @media screen{.page{box-shadow:0 1px 8px rgba(0,0,0,.25)}}
    .judul{text-align:center;font-weight:bold;font-size:15px;color:#0f3d91;text-decoration:underline;letter-spacing:1px;text-transform:uppercase}
    .nomor{text-align:center;margin:2px 0 16px}table.head td{padding:1px 6px;vertical-align:top}table.head td.l{width:74px}
    .isi{margin:12px 0;text-align:justify}
    .sec{text-align:center;font-weight:bold;font-size:13px;text-transform:uppercase;margin:0 0 6px;color:#0f3d91;border-bottom:3px solid #1d4ed8;padding-bottom:4px}
    .cap{font-weight:bold;font-size:10px;color:#1d4ed8;margin:4px 0 2px}
    table.data{width:100%;border-collapse:collapse;font-size:10px;margin-top:4px}table.data th,table.data td{border:1px solid #99a;padding:2px 4px;text-align:left;vertical-align:top}
    table.data th{background:#dbeafe;color:#0f3d91;text-align:center}
    table.data tr:nth-child(even) td{background:#f7fafc}
    table.grid{width:100%;border-collapse:collapse;font-size:8px}table.grid th,table.grid td{border:1px solid #aab}table.grid th{background:#dbeafe;color:#0f3d91}
    table.sign{width:100%;margin-top:18px;font-size:10px}table.sign td{width:50%;vertical-align:top}.sign .jb{font-size:9px;margin-top:2px}.sign .sp{height:48px}.sign .nm{font-weight:bold;text-decoration:underline}
    .cover{text-align:center;margin-top:40mm}.cover .big{font-size:26px;font-weight:bold;letter-spacing:1px;color:#0f3d91}.cover .sub{font-size:18px;margin-top:8px}
    .stats{display:flex;gap:6px;margin:8px 0}.stat{flex:1;border:1px solid #2563eb;border-radius:4px;padding:6px;text-align:center;font-size:9px;background:#eff6ff}.stat b{font-size:17px;display:block;color:#1d4ed8}
    @media print{.page{margin:0;box-shadow:none}}</style></head><body>${pages.join('')}</body></html>`;
}
