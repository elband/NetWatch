// Pembangun HTML Laporan Bulanan AAB (Unit Alat-Alat Besar) — versi resmi & bisa
// ditandatangani elektronik (TTE). Sejajar dengan buildReportHtml (ELB) tapi memakai
// seksi/data AAB. Dipakai halaman TTD (Kepala Seksi) & DocPrint (render PDF Puppeteer).
import type { CoverInfo, LkpHead } from './laporanReport';

export interface AabReportData {
  month: string; monthName: string; daysInMonth: number;
  personil: { no: number; name: string; nip: string | null; jabatan: string | null }[];
  inventaris: { fasilitas: string; items: any[] }[];
  kondisiRekap: Record<string, number>;
  checklist: { total: number; aset: number; byOverall: { overall: string; n: number }[] };
  serviceability: { name: string; serviceable: number; note: string | null }[];
  svcRekap: { serviceable: number; unserviceable: number };
  checklistGrid: { days: number; rows: { nama: string; cells: string[] }[] };
  obatAir: { name: string; satuan: string; total_volume: string | number; biaya: string | number }[];
  obatTotal: number;
  procurement: any[];
  kegiatan: { tanggal_kegiatan: string; judul: string; lokasi: string | null; hasil?: string | null; petugas_nama: string | null }[];
  jadwal: { days: number; rows: { nama: string; cells: string[] }[] };
  tglCetak: string;
}

const esc = (t: any) => String(t ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const rupiah = (n: number | string) => 'Rp ' + Number(n || 0).toLocaleString('id-ID');
const KOND: Record<string, string> = { B: 'Baik', RR: 'Rusak Ringan', RB: 'Rusak Berat' };

export function buildAabReportHtml(data: AabReportData, cover: CoverInfo, qr: string, lkp: LkpHead, kasiQr = ''): string {
  const namaBulan = data.monthName;
  const tgl = new Date(cover.tanggal).toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' });
  const tglTtd = `${lkp.kota}, ${tgl}`;
  const koordJab = lkp.koord_jabatan || 'KOORDINATOR UNIT ALAT-ALAT BESAR';

  // Blok TTD ganda (Diperiksa Kasie + Dibuat Koordinator) dengan QR TTE — identik pola ELB.
  const koordTtd = () => `<td style="text-align:center"><div>${esc(tglTtd)}</div><div>Dibuat Oleh :</div><div class="jb">${esc(koordJab)}</div>
      ${qr ? `<div style="margin:2px auto"><img src="${qr}" style="width:80px;height:80px"><div style="font-size:7px;color:#0a0">✔ Ditandatangani Elektronik (TTE)</div><div style="font-size:7px;color:#444">${esc(cover.sign_token)}</div></div>` : '<div class="sp"></div>'}
      <div class="nm">${esc(cover.signer_name || lkp.koord_nama)}</div><div>NIP. ${esc(cover.signer_nip || lkp.koord_nip)}</div></td>`;
  const kasiTtd = () => `<td><div>Diperiksa Oleh :</div><div class="jb">${esc(lkp.kasie_jabatan)}<br>${esc(lkp.kantor)}</div>
      ${kasiQr ? `<div style="margin:2px 0"><img src="${kasiQr}" style="width:80px;height:80px"><div style="font-size:7px;color:#0a0">✔ Ditandatangani Elektronik (TTE)</div><div style="font-size:7px;color:#444">${esc(cover.kasi_sign_token || '')}</div></div>` : '<div class="sp"></div>'}
      <div class="nm">${esc(cover.kasi_signer_name || lkp.kasie_nama)}</div><div>NIP. ${esc(cover.kasi_signer_nip || lkp.kasie_nip)}</div></td>`;
  const sign = (opts: { kasie?: boolean } = {}) => opts.kasie === false
    ? `<table class="sign"><tr><td></td>${koordTtd()}</tr></table>`
    : `<table class="sign"><tr>${kasiTtd()}${koordTtd()}</tr></table>`;
  const sec = (title: string) => `<div class="sec">${esc(title)}</div>`;
  const bln = namaBulan.toUpperCase();
  const pages: string[] = [];

  // 1) Nota Dinas pengantar (TTE koordinator saja).
  pages.push(`<div class="page">
    <div class="judul">Nota Dinas</div>
    <div class="nomor">Nomor: ${esc(cover.nomor)}</div>
    <table class="head">
      <tr><td class="l">Yth</td><td>:</td><td>${esc(cover.tujuan || lkp.nd_yth)}</td></tr>
      <tr><td class="l">Dari</td><td>:</td><td>${esc(lkp.nd_dari || koordJab)}</td></tr>
      <tr><td class="l">Hal</td><td>:</td><td><b>Laporan Bulanan Unit Alat-Alat Besar ${esc(namaBulan)}</b></td></tr>
      <tr><td class="l">Tanggal</td><td>:</td><td>${tgl}</td></tr>
    </table>
    <div class="isi">Dengan ini disampaikan Laporan Bulanan Unit Alat-Alat Besar periode <b>${esc(namaBulan)}</b> dan mohon persetujuannya guna proses lebih lanjut.</div>
    <div class="isi">Demikian disampaikan, atas perhatiannya diucapkan terima kasih.</div>
    ${sign({ kasie: false })}
  </div>`);

  // 2) Sampul.
  pages.push(`<div class="page"><div class="cover">
    <div>BADAN LAYANAN UMUM<br>KANTOR UNIT PENYELENGGARA BANDAR UDARA KELAS I<br>${esc(lkp.kantor)}</div>
    <div class="big" style="margin-top:30mm">LAPORAN BULANAN</div>
    <div class="sub">UNIT ALAT-ALAT BESAR (AAB)</div>
    <div class="sub">BULAN ${esc(bln)}</div>
  </div></div>`);

  // 3) I. Personil.
  const persRows = data.personil.map((p) => `<tr><td style="text-align:center">${p.no}</td><td>${esc(p.name)}</td><td>${esc(p.nip || '-')}</td><td>${esc(p.jabatan || '-')}</td></tr>`).join('')
    || '<tr><td colspan="4" style="text-align:center;color:#666">Belum ada personil pada unit ini</td></tr>';
  // 4) II. Inventaris per fasilitas.
  const invBlocks = data.inventaris.map((g) => {
    const r = g.items.map((it: any) => `<tr><td>${esc(it.name)}</td><td>${esc([it.merk, it.model].filter(Boolean).join(' ') || '-')}</td><td style="text-align:center">${esc(it.tahun || '-')}</td><td style="text-align:center">${esc(it.kondisi ? `${it.kondisi} (${KOND[it.kondisi] || ''})` : '-')}</td><td>${esc(it.kebutuhan || '-')}</td></tr>`).join('');
    return `<div style="font-weight:bold;font-size:11px;margin:6px 0 2px">${esc(g.fasilitas)} (${g.items.length})</div>
      <table class="data"><thead><tr><th>Nama</th><th>Merk/Tipe</th><th>Tahun</th><th>Kondisi</th><th>Kebutuhan</th></tr></thead><tbody>${r}</tbody></table>`;
  }).join('') || '<div style="color:#666">Belum ada aset fisik.</div>';

  pages.push(`<div class="page">${sec('Data Personil & Inventaris — Unit Alat-Alat Besar')}
    <div class="cap">I. Data Personil</div>
    <table class="data"><thead><tr><th style="width:28px">No</th><th>Nama</th><th>NIP</th><th>Jabatan</th></tr></thead><tbody>${persRows}</tbody></table>
    <div class="cap" style="margin-top:8px">II. Inventaris per Fasilitas — Kondisi B: ${data.kondisiRekap.B || 0} · RR: ${data.kondisiRekap.RR || 0} · RB: ${data.kondisiRekap.RB || 0}</div>
    ${invBlocks}${sign()}</div>`);

  // 5) III. Checklist harian (rekap + grid) & IV. Serviceable.
  const gridHead = Array.from({ length: data.checklistGrid.days }, (_, i) => `<th style="padding:1px">${i + 1}</th>`).join('');
  const gridRows = data.checklistGrid.rows.map((r) => `<tr><td style="white-space:nowrap">${esc(r.nama)}</td>${r.cells.map((c) => `<td style="text-align:center;padding:1px">${esc(c)}</td>`).join('')}</tr>`).join('')
    || `<tr><td colspan="${data.checklistGrid.days + 1}" style="text-align:center;color:#666">Belum ada checklist harian</td></tr>`;
  const svcRows = data.serviceability.map((s, i) => `<tr><td style="text-align:center">${i + 1}</td><td>${esc(s.name)}</td><td style="text-align:center;font-weight:bold;color:${s.serviceable ? '#16803c' : '#b91c1c'}">${s.serviceable ? 'Serviceable' : 'Unserviceable'}</td><td>${esc(s.note || '-')}</td></tr>`).join('')
    || '<tr><td colspan="4" style="text-align:center;color:#666">Belum ada penilaian kelayakan bulanan</td></tr>';

  pages.push(`<div class="page">${sec('Rekap Checklist & Status Kelayakan')}
    <div class="cap">III. Rekap Checklist Harian</div>
    <div style="font-size:10px">${data.checklist.total} pelaksanaan pada ${data.checklist.aset} aset.${data.checklist.byOverall.length ? ' — ' + data.checklist.byOverall.map((o) => `${esc(o.overall)}: ${o.n}`).join(', ') : ''}</div>
    <table class="grid" style="margin-top:4px"><thead><tr><th>Aset / Kendaraan</th>${gridHead}</tr></thead><tbody>${gridRows}</tbody></table>
    <div style="font-size:9px;margin-top:2px">✓ Baik · △ Perhatian · ✗ Rusak</div>
    <div class="cap" style="margin-top:8px">IV. Status Kelayakan Bulanan (Serviceable) — Serviceable: ${data.svcRekap.serviceable} · Unserviceable: ${data.svcRekap.unserviceable}</div>
    <table class="data"><thead><tr><th style="width:28px">No</th><th>Aset</th><th>Status</th><th>Catatan</th></tr></thead><tbody>${svcRows}</tbody></table>${sign()}</div>`);

  // 6) V. Obat air, VI. Pengadaan, VII. Kegiatan.
  const obatRows = data.obatAir.map((o) => `<tr><td>${esc(o.name)}</td><td>${esc(Number(o.total_volume))} ${esc(o.satuan)}</td><td>${esc(rupiah(o.biaya))}</td></tr>`).join('')
    || '<tr><td colspan="3" style="text-align:center;color:#666">Belum ada data obat air</td></tr>';
  const procRows = data.procurement.map((p: any) => `<tr><td>${esc(p.name)}</td><td>${esc(p.fasilitas || '-')}</td><td style="text-align:center">${esc(p.kondisi || '-')}</td><td>${esc(p.kebutuhan || '-')}</td></tr>`).join('')
    || '<tr><td colspan="4" style="text-align:center;color:#666">Tidak ada aset RR/RB atau kebutuhan tercatat</td></tr>';
  const kegRows = data.kegiatan.map((k) => `<tr><td>${esc(new Date(k.tanggal_kegiatan).toLocaleDateString('id-ID'))}</td><td>${esc(k.judul)}</td><td>${esc(k.lokasi || '-')}</td><td>${esc(k.hasil || '-')}</td></tr>`).join('')
    || '<tr><td colspan="4" style="text-align:center;color:#666">Belum ada kegiatan tercatat bulan ini</td></tr>';

  pages.push(`<div class="page">${sec('Obat Air, Pengadaan & Kegiatan Pemeliharaan')}
    <div class="cap">V. Penggunaan Obat Air</div>
    <table class="data"><thead><tr><th>Bahan</th><th>Volume</th><th>Biaya</th></tr></thead><tbody>${obatRows}</tbody><tfoot><tr><td colspan="2" style="text-align:right;font-weight:bold">Total</td><td style="font-weight:bold">${esc(rupiah(data.obatTotal))}</td></tr></tfoot></table>
    <div class="cap" style="margin-top:8px">VI. Daftar Kebutuhan Pengadaan</div>
    <table class="data"><thead><tr><th>Nama</th><th>Fasilitas</th><th>Kondisi</th><th>Kebutuhan</th></tr></thead><tbody>${procRows}</tbody></table>
    <div class="cap" style="margin-top:8px">VII. Kegiatan Pemeliharaan</div>
    <table class="data"><thead><tr><th style="width:80px">Tanggal</th><th>Kegiatan</th><th>Lokasi</th><th>Hasil</th></tr></thead><tbody>${kegRows}</tbody></table>${sign()}</div>`);

  // 7) VIII. Jadwal dinas.
  const jHead = Array.from({ length: data.jadwal.days }, (_, i) => `<th style="padding:1px">${i + 1}</th>`).join('');
  const jRows = data.jadwal.rows.map((r, i) => `<tr><td style="text-align:center">${i + 1}</td><td style="white-space:nowrap">${esc(r.nama)}</td>${r.cells.map((c) => `<td style="text-align:center;padding:1px">${esc(c)}</td>`).join('')}</tr>`).join('')
    || `<tr><td colspan="${data.jadwal.days + 2}" style="text-align:center;color:#666">Belum ada jadwal</td></tr>`;
  pages.push(`<div class="page">${sec(`Jadwal Dinas — ${namaBulan}`)}
    <table class="grid"><thead><tr><th>No</th><th>Nama</th>${jHead}</tr></thead><tbody>${jRows}</tbody></table>
    <div style="font-size:9px;margin-top:4px">P=Pagi · S=Siang · N=Normal · L=Libur · DL=Dinas Luar · C=Cuti</div>${sign()}</div>`);

  return `<!doctype html><html><head><meta charset="utf-8"><title>Laporan Bulanan AAB ${esc(namaBulan)}</title>
    <style>*{-webkit-print-color-adjust:exact;print-color-adjust:exact}
    body{font-family:'Times New Roman',serif;color:#111;background:#fff;font-size:11px;line-height:1.4;margin:0}
    .page{width:190mm;margin:0 auto 8px;padding:16mm 12mm;box-sizing:border-box;background:#fff;page-break-after:always;border-top:4px solid #1d4ed8}
    @media screen{.page{box-shadow:0 1px 8px rgba(0,0,0,.25)}}
    .judul{text-align:center;font-weight:bold;font-size:15px;color:#0f3d91;text-decoration:underline;letter-spacing:1px;text-transform:uppercase}
    .nomor{text-align:center;margin:2px 0 16px}table.head td{padding:1px 6px;vertical-align:top}table.head td.l{width:74px}
    .isi{margin:12px 0;text-align:justify}
    .sec{text-align:center;font-weight:bold;font-size:13px;text-transform:uppercase;margin:0 0 6px;color:#0f3d91;border-bottom:3px solid #1d4ed8;padding-bottom:4px}
    .cap{font-weight:bold;font-size:11px;color:#1d4ed8;margin:4px 0 2px}
    table.data{width:100%;border-collapse:collapse;font-size:10px;margin-top:4px}table.data th,table.data td{border:1px solid #99a;padding:2px 4px;text-align:left;vertical-align:top}
    table.data th{background:#dbeafe;color:#0f3d91;text-align:center}
    table.grid{width:100%;border-collapse:collapse;font-size:8px}table.grid th,table.grid td{border:1px solid #aab}table.grid th{background:#dbeafe;color:#0f3d91}
    table.sign{width:100%;margin-top:18px;font-size:10px}table.sign td{width:50%;vertical-align:top;text-align:center}.sign .jb{font-size:9px;margin-top:2px}.sign .sp{height:48px}.sign .nm{font-weight:bold;text-decoration:underline}
    .cover{text-align:center;margin-top:40mm}.cover .big{font-size:26px;font-weight:bold;letter-spacing:1px;color:#0f3d91}.cover .sub{font-size:18px;margin-top:8px}
    @media print{.page{margin:0;box-shadow:none}}</style></head><body>${pages.join('')}</body></html>`;
}
