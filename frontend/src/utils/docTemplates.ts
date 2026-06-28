// Pembangun HTML dokumen surat keluar (Nota Dinas, Surat Pernyataan, dokumen gabungan
// insiden/LKP, laporan bulanan). Diekstrak dari halaman SuratKeluar agar bisa dipakai ulang
// oleh halaman cetak publik (DocPrint) yang dirender server jadi PDF.
//
// Semua fungsi di sini MURNI: tidak membaca state React / tidak memanggil api. Ketergantungan
// eksternal (org config `lkp`, `origin` untuk URL aset, fetcher data, QR) di-oper sebagai argumen.
import QRCode from 'qrcode';
import type { Surat, Incident } from '../types';
import { buildReportHtml, SECTIONS, type LaporanData, type LkpHead, type SectionKey } from './laporanReport';

export interface SplPegawaiRow {
  user_id?: number; nama: string; nip: string; mulai: string; selesai: string;
  pelaksana_token?: string; signed_at?: string; sign_token?: string;
}

// Default org config (dipakai sebagai fallback bila settings.lkp belum lengkap).
export const LKP_DEFAULT: LkpHead = {
  kantor: 'BANDAR UDARA A.P.T. PRANOTO - SAMARINDA', kota: 'Samarinda',
  bandara: 'Aji Pangeran Tumenggung Pranoto Samarinda',
  koord_jabatan: 'KOORDINATOR UNIT ELEKTRONIKA BANDARA', koord_nama: 'PRAYUDA ELFANDRO', koord_nip: '19930311 202203 1 008',
  kasie_jabatan: 'KEPALA SEKSI TEKNIK DAN OPERASI', kasie_nama: 'MURDOKO', kasie_nip: '19780319 200012 1 001',
  nd_yth: 'Kepala Seksi Teknik dan Operasi Penerbangan', nd_dari: 'Koordinator Elektronika Bandara',
};

export function numToId(n: number): string {
  const w = ['Nol', 'Satu', 'Dua', 'Tiga', 'Empat', 'Lima', 'Enam', 'Tujuh', 'Delapan', 'Sembilan', 'Sepuluh', 'Sebelas', 'Dua Belas'];
  return w[n] ?? String(n);
}

// Tentukan periode laporan: dari report_month, atau parse dari teks Hal (cover lama).
export function laporanMonthOf(s: Surat): string | null {
  if (s.report_month) return s.report_month;
  const m = /laporan bulanan.*?\b(januari|februari|maret|april|mei|juni|juli|agustus|september|oktober|november|desember)\s+(\d{4})/i.exec(s.hal || '');
  if (!m) return null;
  const idx = ['januari', 'februari', 'maret', 'april', 'mei', 'juni', 'juli', 'agustus', 'september', 'oktober', 'november', 'desember'].indexOf(m[1].toLowerCase()) + 1;
  return `${m[2]}-${String(idx).padStart(2, '0')}`;
}

// Halaman lampiran bukti dukung (gambar tampil, PDF sebagai tautan).
export function lampiranHtml(s: Surat, origin: string): string {
  const lp = s.lampiran || [];
  if (!lp.length) return '';
  const e = (t: string) => String(t || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const items = lp.map((l, i) => {
    const url = `${origin}${l.file_url}`;
    const isImg = (l.mimetype || '').startsWith('image');
    return `<div style="margin:8px 0;page-break-inside:avoid"><div style="font-size:11px;font-weight:bold">${i + 1}. ${e(l.filename || 'Lampiran')}</div>${isImg ? `<img src="${url}" style="max-width:100%;max-height:230px;border:1px solid #999;margin-top:3px">` : `<div style="font-size:10px">📄 Berkas PDF: <a href="${url}">${e(l.filename || url)}</a></div>`}</div>`;
  }).join('');
  return `<div style="page-break-before:always;margin-top:20px"><div style="text-align:center;font-weight:bold;font-size:14px;text-decoration:underline;text-transform:uppercase;margin-bottom:10px">Lampiran Bukti Dukung</div>${items}</div>`;
}

// Render Surat Pernyataan Lembur: 3 halaman (SPL + Dokumentasi + Laporan Hasil).
export function suratPernyataanHtml(s: Surat, lkp: LkpHead, origin: string, kasiQr = '', pelaksanaQr: Record<string, string> = {}): string {
  const esc = (v: unknown) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  let d: Record<string, unknown> = {};
  try { d = JSON.parse(s.body || '{}'); } catch { /* body bukan JSON valid */ }
  const kasNama = String(d.kasi_nama || s.kasi_signer_name || lkp.kasie_nama || '');
  const kasNip = String(d.kasi_nip || s.kasi_signer_nip || lkp.kasie_nip || '');
  const kasGol = String(d.kasi_golongan || '');
  const kasJab = String(d.kasi_jabatan || lkp.kasie_jabatan || 'Kepala Seksi Teknik dan Operasi');
  const tglKeg = String(d.tanggal_kegiatan || '');
  const hariKeg = String(d.hari_kegiatan || '');
  const kegiatan = String(d.kegiatan || '');
  const durasi = String(d.durasi_jam || '5');
  const dasarList = String(d.dasar || '').split('\n').map((x) => x.trim()).filter(Boolean);
  const tujuanList = String(d.tujuan_kegiatan || '').split('\n').map((x) => x.trim()).filter(Boolean);
  const hasilList = String(d.hasil || '').split('\n').map((x) => x.trim()).filter(Boolean);
  // Hanya pegawai yang benar-benar dipilih (punya nama) yang ditampilkan/dihitung.
  const pegawai = (Array.isArray(d.pegawai) ? d.pegawai : []).filter((p: SplPegawaiRow) => (p?.nama || '').trim()) as SplPegawaiRow[];
  const dmy = (v: string) => { if (!v) return '-'; const dt = new Date(v.replace(' ', 'T')); return isNaN(dt.getTime()) ? v : dt.toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' }); };
  const tglSurat = dmy(s.tanggal);
  const tglKegStr = dmy(tglKeg);
  const kota = lkp.kota || 'Samarinda';

  const kasiTtdBlock = kasiQr && s.kasi_status === 'disetujui'
    ? `<div style="margin:4px auto;width:110px"><img src="${kasiQr}" style="width:100px;height:100px"><div style="font-size:8px;color:#0a0">✔ Ditandatangani elektronik</div><div style="font-size:7px;color:#666">Token: ${esc(s.kasi_sign_token || '')}</div></div>`
    : '<div style="height:70px"></div>';

  // Kop/letterhead: pakai gambar yang diunggah (Pengaturan Kop di halaman Surat Keluar).
  // Bila belum ada, dokumen digenerate tanpa header (sesuai permintaan).
  const kopUrl = lkp.kop_url ? `${origin}${lkp.kop_url}` : '';
  const kop = kopUrl
    ? `<img src="${kopUrl}" alt="Kop Surat" style="display:block;width:100%;margin:0 auto 22px">`
    : '<div style="margin-bottom:22px"></div>';

  const page1 = `<div class="page" style="page-break-after:always;font-family:'Times New Roman',serif;color:#000;width:190mm;padding:18mm 20mm;margin:0 auto;font-size:13px;line-height:1.6">
      ${kop}
      <div style="text-align:center;margin-bottom:4px"><u><b>SURAT PERNYATAAN</b></u></div>
      <div style="text-align:center;margin-bottom:20px">Nomor : ${esc(s.nomor)}</div>
      <table style="border-collapse:collapse;margin-bottom:16px">
        <tr><td style="width:90px;padding:1px 0">Nama</td><td style="padding:1px 6px">:</td><td>${esc(kasNama)}</td></tr>
        <tr><td style="padding:1px 0">NIP</td><td style="padding:1px 6px">:</td><td>${esc(kasNip)}</td></tr>
        <tr><td style="padding:1px 0">Golongan</td><td style="padding:1px 6px">:</td><td>${esc(kasGol)}</td></tr>
        <tr><td style="padding:1px 0">Jabatan</td><td style="padding:1px 6px">:</td><td>${esc(kasJab)}</td></tr>
      </table>
      <p style="margin-bottom:8px">Dengan ini menyatakan bahwa :</p>
      <ol style="padding-left:24px">
        <li style="margin-bottom:10px;text-align:justify">Telah dilaksanakan pekerjaan lembur kegiatan ${esc(kegiatan)} setelah jam operasional bandara pada hari ${esc(hariKeg)}, tanggal ${tglKegStr} pada Unit Elektronika Bandara selama ${esc(durasi)} (${numToId(Number(durasi))}) jam sebanyak ${pegawai.length} orang.</li>
        <li style="margin-bottom:10px">Pegawai yang melaksanakan kegiatan lembur sebagai berikut :
          <table style="border-collapse:collapse;width:100%;margin-top:8px;font-size:12px">
            <tr><th style="border:1px solid #000;padding:4px 8px;text-align:center;background:#f5f5f5" rowspan="2">No.</th><th style="border:1px solid #000;padding:4px 8px;text-align:center;background:#f5f5f5" rowspan="2">Nama</th><th style="border:1px solid #000;padding:4px 8px;text-align:center;background:#f5f5f5" rowspan="2">NIP</th><th style="border:1px solid #000;padding:4px 8px;text-align:center;background:#f5f5f5" colspan="2">Jam Lembur (WITA)</th></tr>
            <tr><th style="border:1px solid #000;padding:4px 8px;text-align:center;background:#f5f5f5">Mulai</th><th style="border:1px solid #000;padding:4px 8px;text-align:center;background:#f5f5f5">Selesai</th></tr>
            ${pegawai.map((p, i) => `<tr><td style="border:1px solid #000;padding:3px 8px;text-align:center">${i + 1}.</td><td style="border:1px solid #000;padding:3px 8px">${esc(p.nama)}</td><td style="border:1px solid #000;padding:3px 8px;text-align:center">${esc(p.nip || '-')}</td><td style="border:1px solid #000;padding:3px 8px;text-align:center">${esc(p.mulai)}</td><td style="border:1px solid #000;padding:3px 8px;text-align:center">${esc(p.selesai)}</td></tr>`).join('')}
          </table>
        </li>
        <li>Dokumentasi dan data dukung terlampir.<br>
          <p style="margin:8px 0;text-align:justify">Demikian pernyataan ini dibuat dengan sesungguhnya untuk dipergunakan sebagai dasar pemberian uang lembur pegawai bersangkutan.</p>
        </li>
      </ol>
      <div style="text-align:right;margin-top:20px">
        <div>${esc(kota)}, ${tglSurat}</div>
        <div>${esc(kasJab)}</div>
        ${kasiTtdBlock}
        <div><u><b>${esc(kasNama)}</b></u></div>
        <div>NIP. ${esc(kasNip)}</div>
      </div>
    </div>`;

  const lampiranImgs = (s.lampiran || []).filter((l) => (l.mimetype || '').startsWith('image'));
  const lampiranPdfs = (s.lampiran || []).filter((l) => l.mimetype === 'application/pdf');
  const docGrid = lampiranImgs.length
    ? `<div style="display:grid;grid-template-columns:repeat(${Math.min(lampiranImgs.length, 3)},1fr);gap:10px;margin-top:24px">${lampiranImgs.slice(0, 9).map((l) => `<div style="text-align:center"><img src="${origin}${l.file_url}" style="max-width:100%;max-height:200px;border:1px solid #ccc;object-fit:cover"></div>`).join('')}</div>`
    : '<p style="text-align:center;color:#888;margin-top:40px;font-style:italic">[Foto dokumentasi kegiatan — tambahkan via Lampiran Bukti Dukung]</p>';

  const page2 = `<div class="page" style="page-break-after:always;font-family:'Times New Roman',serif;color:#000;width:190mm;padding:18mm 20mm;margin:0 auto">
      ${kop}
      <div style="text-align:center;font-size:14px;font-weight:bold;text-decoration:underline;margin:20px 0">DOKUMENTASI KEGIATAN</div>
      ${docGrid}
      ${lampiranPdfs.map((l) => `<div style="margin-top:8px;font-size:11px">📄 <a href="${origin}${l.file_url}">${esc(l.filename || 'Lampiran PDF')}</a></div>`).join('')}
    </div>`;

  const page3 = `<div class="page" style="font-family:'Times New Roman',serif;color:#000;width:190mm;padding:18mm 20mm;margin:0 auto">
      ${kop}
      <div style="text-align:center;font-size:14px;font-weight:bold;text-decoration:underline;margin-bottom:24px">LAPORAN HASIL KEGIATAN LEMBUR</div>
      <div style="font-size:13px;line-height:1.8">
        <p style="font-weight:bold;margin-bottom:4px">A. DASAR</p>
        <ol style="margin:0 0 14px;padding-left:28px">${dasarList.map((x) => `<li style="text-align:justify">${esc(x)}</li>`).join('') || '<li>-</li>'}</ol>
        <p style="font-weight:bold;margin-bottom:4px">B. MAKSUD DAN TUJUAN</p>
        <ol style="margin:0 0 14px;padding-left:28px">${tujuanList.map((x) => `<li style="text-align:justify">${esc(x)}</li>`).join('') || '<li>-</li>'}</ol>
        <p style="font-weight:bold;margin-bottom:4px">C. HASIL YANG DICAPAI</p>
        <p style="margin:0 0 6px">Kegiatan dengan rincian sebagai berikut :</p>
        <ol style="margin:0 0 14px;padding-left:28px">${hasilList.map((x) => `<li style="text-align:justify">${esc(x)}</li>`).join('') || '<li>-</li>'}</ol>
      </div>
      <div style="text-align:right;margin-top:16px;font-size:13px">${esc(kota)}, ${tglSurat}</div>
      <table style="width:100%;margin-top:8px;font-size:12.5px;border-collapse:collapse">
        <tr>
          <td style="width:36%;text-align:center;vertical-align:top;padding:4px 8px">
            Mengetahui,<br><b>${esc(kasJab)}</b>
            ${kasiTtdBlock}
            <u><b>${esc(kasNama)}</b></u><br>NIP. ${esc(kasNip)}
          </td>
          <td style="text-align:center;vertical-align:top;padding:4px 8px">
            Pelaksana Kegiatan
            <div style="display:flex;flex-wrap:wrap;margin-top:4px">
              ${pegawai.map((p) => {
                const qr = p.sign_token ? pelaksanaQr[p.sign_token] : '';
                const mark = p.sign_token
                  ? `${qr ? `<img src="${qr}" style="width:64px;height:64px;display:block;margin:2px auto 0">` : '<div style="height:8px"></div>'}<div style="font-size:9px;color:#0a7d27;font-weight:bold">✔ Ditandatangani elektronik</div>${p.signed_at ? `<div style="font-size:8px;color:#666">${dmy(p.signed_at)}</div>` : ''}`
                  : '<div style="height:64px"></div>';
                const nama = p.sign_token ? `<u><b>${esc(p.nama)}</b></u>` : `<b>${esc(p.nama)}</b>`;
                const tok = p.sign_token ? `<div style="font-size:7px;color:#888">Token: ${esc(p.sign_token)}</div>` : '';
                return `<div style="width:50%;text-align:center;margin-top:16px">${mark}${nama}${p.nip ? `<br>NIP. ${esc(p.nip)}` : ''}${tok}</div>`;
              }).join('')}
            </div>
          </td>
        </tr>
      </table>
    </div>`;

  return `<!doctype html><html><head><meta charset="utf-8"><title>Surat Pernyataan ${esc(s.nomor)}</title>
    <style>* { box-sizing:border-box;margin:0;padding:0 } body { background:#fff } .page { background:#fff } @media print { .page { page-break-after:always } }</style>
    </head><body>${page1}${page2}${page3}</body></html>`;
}

// HTML dokumen surat tunggal (dipakai untuk pratinjau iframe).
export function suratHtml(s: Surat, qr: string, lkp: LkpHead, origin: string): string {
  const esc = (t: string) => String(t || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br>');
  const tgl = new Date(s.tanggal).toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' });
  const isi = s.body?.trim() || `Dengan ini disampaikan ${s.hal} dan mohon persetujuannya guna proses lebih lanjut.`;
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(s.jenis)} ${esc(s.nomor)}</title>
      <style>body{font-family:'Times New Roman',serif;color:#000;background:#fff;max-width:190mm;margin:24mm auto;font-size:13px;line-height:1.6}
      .judul{text-align:center;font-weight:bold;font-size:16px;text-decoration:underline;letter-spacing:1px;text-transform:uppercase}
      .nomor{text-align:center;margin:2px 0 18px} table.head td{padding:1px 6px;vertical-align:top} table.head td.l{width:74px}
      .isi{margin:16px 0;text-align:justify} .ttd{margin-top:30px;width:62%;margin-left:auto;text-align:center}</style></head><body>
      <div class="judul">${esc(s.jenis)}</div>
      <div class="nomor">Nomor: ${esc(s.nomor)}</div>
      <table class="head">
        <tr><td class="l">Yth</td><td>:</td><td>${esc(s.tujuan || lkp.nd_yth)}</td></tr>
        <tr><td class="l">Dari</td><td>:</td><td>${esc(lkp.nd_dari)}</td></tr>
        <tr><td class="l">Hal</td><td>:</td><td><b>${esc(s.hal)}</b></td></tr>
        <tr><td class="l">Tanggal</td><td>:</td><td>${tgl}</td></tr>
      </table>
      <div class="isi">${esc(isi)}</div>
      <div class="isi">Demikian disampaikan, atas perhatiannya diucapkan terima kasih.</div>
      <div class="ttd">${esc(lkp.koord_jabatan)}<br>
        ${qr ? `<div style="margin:6px auto;width:120px"><img src="${qr}" style="width:104px;height:104px"><div style="font-size:8px;color:#0a0">✔ Ditandatangani elektronik</div><div style="font-size:8px;color:#444">${esc(s.sign_token || '')}</div></div>` : '<br><br><br>'}
        <u><b>${esc(s.signer_name || lkp.koord_nama)}</b></u><br>NIP. ${esc(s.signer_nip || lkp.koord_nip)}</div>
      ${lampiranHtml(s, origin)}
      </body></html>`;
}

// Gabungkan Nota Dinas (hal.1) + LKP form (hal.2) + Lampiran (hal.3) dalam 1 HTML.
export function buildCombinedIncidentDoc(s: Surat, notaQr: string, inc: Incident, lkpQr: string, lkp: LkpHead, origin: string, kasiQr = ''): string {
  const report = inc.report;
  const cfg = lkp as unknown as Record<string, string>;
  const esc = (v: unknown) => String(v || '-').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br>');
  const dt = (v?: string | null) => (v ? new Date(v.replace(' ', 'T')) : null);
  const dmy = (v?: string | null) => { const d = dt(v); return d ? d.toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' }) : '-'; };
  const dshort = (v?: string | null) => { const d = dt(v); return d ? `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}` : '-'; };
  const jam = (v?: string | null) => { const d = dt(v); return d ? d.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }) : '-'; };
  const tgl = inc.resolved_at || inc.created_at;
  const dur = inc.duration_min || 0;
  const durTxt = dur ? `${Math.floor(dur / 60)} Jam ${dur % 60} menit` : '-';
  const kategori = inc.priority === 'kritis' || inc.priority === 'tinggi' ? 'RB' : 'RR';
  const kodeHambatan = inc.awaiting_part ? 'SC' : 'TH';
  const signerNama = report?.signer_name || cfg.koord_nama;
  const signerNip = report?.signer_nip || cfg.koord_nip;
  const fotos = (inc.notes || []).filter((n) => n.doc_url);
  const img = (u: string, max = 300) => `<img src="${origin}${u}" style="max-width:100%;max-height:${max}px;object-fit:contain;border:1px solid #ddd">`;
  const awal = fotos[0];
  const sesudah = fotos.find((n) => /selesai|normal kembali|teratasi|diperbaiki/i.test(n.note)) || (fotos.length > 1 ? fotos[fotos.length - 1] : null);
  const notaTgl = new Date(s.tanggal).toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' });
  const notaIsi = s.body?.trim() || `Dengan ini disampaikan ${s.hal} dan mohon persetujuannya guna proses lebih lanjut.`;
  const notaQrBlock = notaQr ? `<div style="margin:6px auto;width:120px"><img src="${notaQr}" style="width:104px;height:104px"><div style="font-size:8px;color:#0a0">✔ TTE Koordinator</div><div style="font-size:8px;color:#444">${esc(s.sign_token || '')}</div></div>` : '<br><br><br>';
  const lkpQrBlock = lkpQr ? `<div style="margin:6px auto;width:120px"><img src="${lkpQr}" style="width:108px;height:108px"><div style="font-size:8px;color:#0a0">✔ Ditandatangani elektronik</div><div style="font-size:8px;color:#444">Token: ${esc(report?.sign_token || '')}</div><div style="font-size:7px;color:#666">Pindai untuk verifikasi</div></div>` : `<div style="margin:14px 0;font-size:10px;color:#999">(Belum disahkan TTE koordinator)</div>`;
  const kasiQrBlock = kasiQr && s.kasi_status === 'disetujui'
    ? `<div style="margin:6px auto;width:120px"><img src="${kasiQr}" style="width:108px;height:108px"><div style="font-size:8px;color:#0a0">✔ Ditandatangani elektronik</div><div style="font-size:8px;color:#444">Token: ${esc(s.kasi_sign_token || '')}</div><div style="font-size:7px;color:#666">Pindai untuk verifikasi</div></div>`
    : '<br><br><br>';
  const kasiNama = s.kasi_signer_name || cfg.kepala_nama || cfg.kasie_nama;
  const kasiNip = s.kasi_signer_nip || cfg.kepala_nip || cfg.kasie_nip;
  const sigBlock = `<table class="sig"><tr><td style="width:50%;vertical-align:top;padding:4px 8px;font-family:Arial,sans-serif;font-size:12px;text-align:center">Diperiksa Oleh :<br><b>${esc(cfg.kepala_jabatan || cfg.kasie_jabatan)}</b><br>${esc(cfg.kantor)}${kasiQrBlock}<u><b>${esc(kasiNama)}</b></u><br>NIP. ${esc(kasiNip)}</td><td style="width:50%;vertical-align:top;padding:4px 8px;font-family:Arial,sans-serif;font-size:12px;text-align:center">${esc(cfg.kota)}, ${dmy(report?.signed_at || tgl)}<br>Dibuat Oleh :<br><b>${esc(cfg.koord_jabatan)}</b><br>${esc(cfg.kantor)}${lkpQrBlock}<u><b>${esc(signerNama)}</b></u><br>NIP. ${esc(signerNip)}</td></tr></table>`;

  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(s.jenis)} ${esc(s.nomor)}</title><style>
      *{box-sizing:border-box}
      .nd{font-family:'Times New Roman',serif;color:#000;max-width:190mm;padding:24mm 16mm;margin:0 auto;font-size:13px;line-height:1.6;page-break-after:always}
      .nd .judul{text-align:center;font-weight:bold;font-size:16px;text-decoration:underline;letter-spacing:1px;text-transform:uppercase}
      .nd .nomor{text-align:center;margin:2px 0 18px}
      .nd table.head td{padding:1px 6px;vertical-align:top} .nd table.head td.l{width:74px}
      .nd .isi{margin:16px 0;text-align:justify} .nd .ttd{margin-top:30px;width:62%;margin-left:auto;text-align:center}
      .lkp{width:210mm;min-height:297mm;padding:18mm 16mm;margin:0 auto;page-break-after:always}
      .lkp h1{font-family:Arial,sans-serif;font-size:14px;text-align:center;margin:0 0 14px;text-transform:uppercase}
      .lkp table{width:100%;border-collapse:collapse;font-family:Arial,sans-serif;font-size:12px}
      .lkp td{border:1px solid #000;padding:5px 7px;vertical-align:top}
      .lkp td.no{width:26px;text-align:center} .lkp td.ur{width:200px;font-weight:bold}
      .ket{font-size:10px;color:#333} table.sig{margin-top:18px;width:100%;border-collapse:collapse}
      @media print{.nd,.lkp{padding:14mm}}
    </style></head><body>

    <div class="nd">
      <div class="judul">${esc(s.jenis || 'NOTA DINAS')}</div>
      <div class="nomor">Nomor: ${esc(s.nomor)}</div>
      <table class="head">
        <tr><td class="l">Yth</td><td>:</td><td>${esc(s.tujuan || cfg.nd_yth)}</td></tr>
        <tr><td class="l">Dari</td><td>:</td><td>${esc(cfg.nd_dari)}</td></tr>
        <tr><td class="l">Hal</td><td>:</td><td><b>${esc(s.hal)}</b></td></tr>
        <tr><td class="l">Tanggal</td><td>:</td><td>${notaTgl}</td></tr>
      </table>
      <div class="isi">${esc(notaIsi)}</div>
      <div class="isi">Demikian disampaikan, atas perhatiannya diucapkan terima kasih.</div>
      <div class="ttd">${esc(cfg.koord_jabatan)}<br>${notaQrBlock}<u><b>${esc(s.signer_name || cfg.koord_nama)}</b></u><br>NIP. ${esc(s.signer_nip || cfg.koord_nip)}</div>
    </div>

    <div class="lkp">
      <h1>Laporan Kerusakan dan Perbaikan Peralatan Elektronika Bandara</h1>
      <table>
        <tr><td class="no"><b>NO</b></td><td class="ur">URAIAN</td><td><b>DATA</b></td></tr>
        <tr><td class="no">1</td><td class="ur">Tanggal/Bulan/Tahun</td><td>${dmy(tgl)}</td></tr>
        <tr><td class="no">2</td><td class="ur">Lokasi</td><td>${esc(inc.device_name)}</td></tr>
        <tr><td class="no">3</td><td class="ur">Fasilitas</td><td>${esc(cfg.fasilitas || 'Elektronika Bandara')}</td></tr>
        <tr><td class="no">4</td><td class="ur">Peralatan</td><td>${esc(inc.device_name)}${inc.ip && inc.ip.match(/^\d/) ? ' (' + esc(inc.ip) + ')' : ''}</td></tr>
        <tr><td class="no">5</td><td class="ur">Bagian Peralatan</td><td>${esc(report?.sparepart)}</td></tr>
        <tr><td class="no">6</td><td class="ur">Kategori Kerusakan</td><td><b>${kategori}</b> <span class="ket">Ket: RR - Rusak Ringan · RB - Rusak Berat</span></td></tr>
        <tr><td class="no">7</td><td class="ur">Uraian Kerusakan</td><td>${esc(report?.kerusakan)}</td></tr>
        <tr><td class="no">8</td><td class="ur">Tindakan Perbaikan<br><span class="ket">Oleh: ${esc(report?.reporter_name)} · Lokasi: ${esc(cfg.kota)}</span></td><td>${esc(report?.perbaikan)}</td></tr>
        <tr><td class="no">9</td><td class="ur">Penyebab Kerusakan</td><td>${esc(report?.penyebab)}</td></tr>
        <tr><td class="no">10</td><td class="ur">Tgl. Kerusakan / Jam</td><td>${dshort(inc.created_at)} / ${jam(inc.created_at)}</td></tr>
        <tr><td class="no">11</td><td class="ur">Tgl. Selesai / Jam</td><td>${dshort(inc.resolved_at)} / ${jam(inc.resolved_at)}</td></tr>
        <tr><td class="no">12</td><td class="ur">Jumlah Jam Operasi Terputus</td><td>${durTxt}</td></tr>
        <tr><td class="no">13</td><td class="ur">Kode Hambatan</td><td><b>${kodeHambatan}</b> <span class="ket">(SC - Suku Cadang · TH - Tidak Ada Hambatan)</span></td></tr>
      </table>
      ${sigBlock}
    </div>

    <div class="lkp">
      <h1>Lampiran Kerusakan</h1>
      <table><tr>
        <td style="width:50%;height:260px;text-align:center;vertical-align:middle"><b>Kondisi Awal</b><br><br>${awal?.doc_url ? img(awal.doc_url, 240) : '<span style="color:#999">- belum ada foto -</span>'}</td>
        <td style="width:50%;height:260px;text-align:center;vertical-align:middle"><b>Kondisi Sesudah</b><br><br>${sesudah?.doc_url ? img(sesudah.doc_url, 240) : '<span style="color:#999">- belum ada foto -</span>'}</td>
      </tr></table>
      ${fotos.length ? `<div style="margin-top:14px;font-family:Arial,sans-serif;font-size:12px;font-weight:bold">Dokumentasi dari Log Perbaikan (${fotos.length} foto)</div><table style="margin-top:4px;border-collapse:collapse"><tr>${fotos.map((n) => `<td style="text-align:center;width:${Math.floor(100 / Math.min(fotos.length, 3))}%;vertical-align:top;padding:4px">${img(n.doc_url || '', 160)}<div style="font-size:9px;margin-top:3px">${esc(n.note.split(':')[0])}</div><div style="font-size:8px;color:#666">${esc(n.created_at)}</div></td>`).join('')}</tr></table>` : ''}
      ${sigBlock}
    </div>

    ${lampiranHtml(s, origin)}
    </body></html>`;
}

// Buat QR data-URL untuk tautan verifikasi publik dari sebuah token.
async function tokenQr(origin: string, token: string | null | undefined, width: number): Promise<string> {
  if (!token) return '';
  try { return await QRCode.toDataURL(`${origin}/verify-tte?token=${token}`, { width, margin: 1 }); } catch { return ''; }
}

export interface BuildDocDeps {
  lkp: LkpHead;
  origin: string;
  // Ambil insiden untuk dokumen gabungan (Nota Dinas + LKP). Boleh kembalikan null.
  fetchIncident: (id: string) => Promise<Incident | null>;
  // Ambil data laporan bulanan. Boleh kembalikan null.
  fetchLaporan: (month: string) => Promise<LaporanData | null>;
  // Bagian laporan yang disertakan (default: semua).
  sections?: Set<SectionKey>;
}

// Orkestrator: bangun HTML dokumen lengkap sesuai jenis surat.
// - Surat Pernyataan → suratPernyataanHtml
// - punya incident_id → dokumen gabungan Nota Dinas + LKP
// - cover laporan bulanan → buildReportHtml
// - selain itu → surat tunggal
export async function buildDocHtml(s: Surat, deps: BuildDocDeps): Promise<string> {
  const { lkp, origin } = deps;
  if (s.jenis === 'Surat Pernyataan') {
    const kasiQr = await tokenQr(origin, s.kasi_sign_token, 130);
    // QR per pelaksana yang sudah TTE (token PK… di body JSON) → tautan verifikasi publik.
    const pelaksanaQr: Record<string, string> = {};
    try {
      const body = JSON.parse(s.body || '{}');
      const pegawai = Array.isArray(body.pegawai) ? body.pegawai : [];
      for (const p of pegawai) {
        if (p?.sign_token) pelaksanaQr[p.sign_token] = await tokenQr(origin, p.sign_token, 120);
      }
    } catch { /* body bukan JSON valid */ }
    return suratPernyataanHtml(s, lkp, origin, kasiQr, pelaksanaQr);
  }
  if (s.incident_id) {
    try {
      const inc = await deps.fetchIncident(s.incident_id);
      if (inc) {
        const notaQr = await tokenQr(origin, s.sign_token, 130);
        const lkpQr = await tokenQr(origin, inc.report?.sign_token, 150);
        const kasiQr = await tokenQr(origin, s.kasi_sign_token, 150);
        return buildCombinedIncidentDoc(s, notaQr, inc, lkpQr, lkp, origin, kasiQr);
      }
    } catch (err) {
      console.error('[docTemplates] Gagal memuat insiden untuk dokumen gabungan:', err);
    }
  }
  const qr = await tokenQr(origin, s.sign_token, 130);
  const lm = laporanMonthOf(s);
  if (lm) {
    try {
      const data = await deps.fetchLaporan(lm);
      if (data) {
        const kasiQr = await tokenQr(origin, s.kasi_sign_token, 130);
        const cover = { nomor: s.nomor, tanggal: s.tanggal, tujuan: s.tujuan, signer_name: s.signer_name, signer_nip: s.signer_nip, sign_token: s.sign_token, kasi_signer_name: s.kasi_signer_name, kasi_signer_nip: s.kasi_signer_nip, kasi_sign_token: s.kasi_sign_token };
        const sel = deps.sections ?? new Set(SECTIONS.map((x) => x.key));
        return buildReportHtml(data, cover, qr, lkp, sel, kasiQr);
      }
    } catch { return suratHtml(s, qr, lkp, origin); }
  }
  return suratHtml(s, qr, lkp, origin);
}
