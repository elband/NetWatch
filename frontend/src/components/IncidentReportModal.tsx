import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { api } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { hasRole } from '../utils/roles';
import { confirmDialog } from './dialog';
import type { Incident, IncidentReport, RepairResult } from '../types';

const HASIL_LABEL: Record<RepairResult, string> = {
  berhasil: '✅ Berhasil diperbaiki',
  sebagian: '⚠️ Diperbaiki sebagian',
  gagal: '❌ Belum berhasil / perlu tindak lanjut',
};

// Kop & penanda tangan LKP (default contoh; bisa diubah admin di Pengaturan).
const LKP_DEFAULT = {
  kantor: 'BANDAR UDARA A.P.T. PRANOTO - SAMARINDA',
  unit: 'UNIT ELEKTRONIKA BANDARA',
  kota: 'Samarinda',
  fasilitas: 'Elektronika Bandara',
  kepala_jabatan: 'KEPALA SEKSI TEKNIK DAN OPERASI',
  kepala_nama: 'MURDOKO',
  kepala_nip: '19780319 200012 1 001',
  koord_jabatan: 'KOORDINATOR UNIT ELEKTRONIKA BANDARA',
  koord_nama: 'PRAYUDA ELFANDRO',
  koord_nip: '19930311 202203 1 008',
  nd_kode: 'ELBAND/APTP',
  nd_yth: 'Kepala Seksi Teknik dan Operasi Penerbangan',
  nd_dari: 'Koordinator Elektronika Bandara',
};
type Lkp = typeof LKP_DEFAULT;

export default function IncidentReportModal({
  incident,
  onClose,
  onSaved,
}: {
  incident: Incident;
  onClose: () => void;
  onSaved?: (report: IncidentReport) => void;
}) {
  const { user } = useAuth();
  const isManager = hasRole(user, 'koordinator', 'admin');
  const [report, setReport] = useState<IncidentReport | null>(incident.report);
  const existing = report;
  // Semua tindakan yang dilaporkan teknisi = catatan kronologi yang berfoto.
  const tindakanList = (incident.notes || []).filter((n) => n.doc_url);
  const [kerusakan, setKerusakan] = useState(existing?.kerusakan || '');
  const [penyebab, setPenyebab] = useState(existing?.penyebab || '');
  const [perbaikan, setPerbaikan] = useState(existing?.perbaikan || '');
  const [sparepart, setSparepart] = useState(existing?.sparepart || '');
  const [hasil, setHasil] = useState<RepairResult>(existing?.hasil || 'berhasil');
  const [saving, setSaving] = useState(false);
  const [signing, setSigning] = useState(false);
  const [error, setError] = useState('');
  const [lkp, setLkp] = useState<Lkp>(LKP_DEFAULT);
  const signed = !!report?.sign_token;

  useEffect(() => {
    api.get('/settings').then((res) => {
      if (res.data.settings?.lkp) setLkp({ ...LKP_DEFAULT, ...res.data.settings.lkp });
    }).catch(() => {});
  }, []);

  async function signReport() {
    if (!(await confirmDialog({ title: 'Sahkan laporan', message: 'Laporan ini akan ditandatangani secara elektronik (TTE) atas nama Anda. Tindakan ini tidak bisa dibatalkan.', confirmText: '🔏 Sahkan', variant: 'success' }))) return;
    setSigning(true); setError('');
    try {
      const res = await api.post(`/incidents/${incident.id}/report/sign`, { signerName: lkp.koord_nama, signerNip: lkp.koord_nip });
      setReport(res.data.report);
    } catch (e: any) {
      setError(e?.response?.data?.error || 'Gagal mengesahkan laporan.');
    } finally { setSigning(false); }
  }

  async function printNotaDinas() {
    let nota;
    try {
      const res = await api.post(`/incidents/${incident.id}/nota-dinas`);
      nota = res.data.nota;
    } catch (e: any) {
      setError(e?.response?.data?.error || 'Gagal membuat Nota Dinas.'); return;
    }
    const esc = (s: string) => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const tgl = new Date(nota.tanggal).toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' });
    const w = window.open('', '_blank', 'width=800,height=1000');
    if (!w) return;
    w.document.write(`<!doctype html><html><head><title>Nota Dinas ${esc(nota.nomor)}</title>
      <style>
        body{font-family:'Times New Roman',serif;color:#000;max-width:190mm;margin:24mm auto;font-size:13px;line-height:1.6}
        .judul{text-align:center;font-weight:bold;font-size:16px;text-decoration:underline;letter-spacing:1px}
        .nomor{text-align:center;margin:2px 0 18px}
        table.head td{padding:1px 6px;vertical-align:top} table.head td.l{width:70px}
        .isi{margin:16px 0;text-align:justify}
        .ttd{margin-top:36px;width:62%;margin-left:auto;text-align:left}
      </style></head><body>
      <div class="judul">NOTA DINAS</div>
      <div class="nomor">Nomor: ${esc(nota.nomor)}</div>
      <table class="head">
        <tr><td class="l">Yth</td><td>:</td><td>${esc(lkp.nd_yth)}</td></tr>
        <tr><td class="l">Dari</td><td>:</td><td>${esc(lkp.nd_dari)}</td></tr>
        <tr><td class="l">Hal</td><td>:</td><td><b>${esc(nota.hal)}</b></td></tr>
        <tr><td class="l">Tanggal</td><td>:</td><td>${tgl}</td></tr>
      </table>
      <div class="isi">Dengan ini disampaikan <b>${esc(nota.hal)}</b> dan mohon persetujuannya guna proses lebih lanjut.</div>
      <div class="isi">Demikian disampaikan, atas perhatiannya diucapkan terima kasih.</div>
      <div class="ttd">${esc(lkp.koord_jabatan)}<br><br><br><br><u><b>${esc(lkp.koord_nama)}</b></u><br>NIP. ${esc(lkp.koord_nip)}</div>
      </body></html>`);
    w.document.close();
    w.focus();
    setTimeout(() => w.print(), 300);
  }

  // Tindakan yang bukan perbaikan nyata: percobaan SSH gagal & status menunggu suku cadang.
  const isFailedAttempt = (note: string) => /\(gagal[,)]|Tidak Bisa Ditangani/i.test(note);

  function fillFromTindakan() {
    const summary = tindakanList
      .filter((n) => !isFailedAttempt(n.note))
      .map((n) => `• ${n.note}`)
      .join('\n');
    if (!summary) return; // semua tindakan adalah percobaan gagal — jangan ubah field.
    setPerbaikan((prev) => (prev.trim() ? `${prev.trim()}\n${summary}` : summary));
  }

  async function save() {
    if (!kerusakan.trim() || !perbaikan.trim()) {
      setError('Deskripsi kerusakan dan tindakan perbaikan wajib diisi.');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const res = await api.put(`/incidents/${incident.id}/report`, {
        kerusakan,
        penyebab,
        perbaikan,
        sparepart,
        hasil,
      });
      setReport(res.data.report);
      onSaved?.(res.data.report);
      onClose();
    } catch (e: any) {
      setError(e?.response?.data?.error || 'Gagal menyimpan laporan.');
    } finally {
      setSaving(false);
    }
  }

  async function printReport() {
    const esc = (s: string) => String(s || '-').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br>');
    const dt = (s?: string | null) => (s ? new Date(s.replace(' ', 'T')) : null);
    const dmy = (s?: string | null) => { const d = dt(s); return d ? d.toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' }) : '-'; };
    const dshort = (s?: string | null) => { const d = dt(s); return d ? `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}` : '-'; };
    const jam = (s?: string | null) => { const d = dt(s); return d ? d.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }) : '-'; };
    const dur = incident.duration_min || 0;
    const durTxt = dur ? `${Math.floor(dur / 60)} Jam ${dur % 60} menit` : '-';
    const kategori = incident.priority === 'kritis' || incident.priority === 'tinggi' ? 'RB' : 'RR';
    const kodeHambatan = incident.awaiting_part ? 'SC' : 'TH';
    const tgl = incident.resolved_at || new Date().toISOString();

    // TTE QR koordinator: QR berisi URL verifikasi publik bila laporan sudah disahkan.
    const signerNama = report?.signer_name || lkp.koord_nama;
    const signerNip = report?.signer_nip || lkp.koord_nip;
    const token = report?.sign_token || '';
    const verifyUrl = token ? `${location.origin}/verify-tte?token=${token}` : '';
    let qr = '';
    if (token) { try { qr = await QRCode.toDataURL(verifyUrl, { width: 150, margin: 1 }); } catch { qr = ''; } }

    // Foto dari log perbaikan peralatan (tiap tindakan berfoto).
    const fotos = tindakanList.filter((n) => n.doc_url);
    const img = (u: string, max = 300) => `<img src="${location.origin}${u}" style="max-width:100%;max-height:${max}px;object-fit:contain;border:1px solid #ddd">`;
    const awal = fotos[0];
    const sesudah = fotos.find((n) => /selesai|normal kembali|teratasi|diperbaiki/i.test(n.note)) || (fotos.length > 1 ? fotos[fotos.length - 1] : null);
    const w = window.open('', '_blank', 'width=900,height=1000');
    if (!w) return;
    const tteBlock = token
      ? `<div style="margin:6px auto;width:120px">
           <img src="${qr}" style="width:108px;height:108px">
           <div style="font-size:8px;color:#0a0">✔ Ditandatangani elektronik</div>
           <div style="font-size:8px;color:#444">Token: ${esc(token)}</div>
           <div style="font-size:7px;color:#666">Pindai untuk verifikasi</div>
         </div>`
      : `<div style="margin:14px 0;font-size:10px;color:#999">(Belum disahkan TTE koordinator)</div>`;
    const sigBlock = `
      <table class="sig"><tr>
        <td style="width:50%;vertical-align:top">Diperiksa Oleh :<br><b>${esc(lkp.kepala_jabatan)}</b><br>${esc(lkp.kantor)}<br><br><br><br><u><b>${esc(lkp.kepala_nama)}</b></u><br>NIP. ${esc(lkp.kepala_nip)}</td>
        <td style="width:50%;vertical-align:top">${esc(lkp.kota)}, ${dmy(report?.signed_at || tgl)}<br>Dibuat Oleh :<br><b>${esc(lkp.koord_jabatan)}</b><br>${esc(lkp.kantor)}
          ${tteBlock}
          <u><b>${esc(signerNama)}</b></u><br>NIP. ${esc(signerNip)}</td>
      </tr></table>`;

    w.document.write(`<!doctype html><html><head><title>LKP ${incident.id} — ${incident.device_name}</title>
      <style>
        *{box-sizing:border-box} body{font-family:Arial,Helvetica,sans-serif;color:#000;margin:0;font-size:12px}
        .page{width:210mm;min-height:297mm;padding:18mm 16mm;margin:0 auto}
        h1{font-size:14px;text-align:center;margin:0 0 14px;text-transform:uppercase}
        table{width:100%;border-collapse:collapse} td{border:1px solid #000;padding:5px 7px;vertical-align:top}
        td.no{width:26px;text-align:center} td.ur{width:200px;font-weight:bold} .ket{font-size:10px;color:#333}
        table.sig{margin-top:18px} table.sig td{border:none;padding:2px 7px;font-size:12px;text-align:center}
        .legend{font-size:10px;line-height:1.4}
        @media print{.page{padding:14mm}}
      </style></head><body>
      <div class="page">
        <h1>Laporan Kerusakan dan Perbaikan Peralatan Elektronika Bandara</h1>
        <table>
          <tr><td class="no"><b>NO</b></td><td class="ur">URAIAN</td><td><b>DATA</b></td></tr>
          <tr><td class="no">1</td><td class="ur">Tanggal/Bulan/Tahun</td><td>${dmy(tgl)}</td></tr>
          <tr><td class="no">2</td><td class="ur">Lokasi</td><td>${esc(incident.device_name)}</td></tr>
          <tr><td class="no">3</td><td class="ur">Fasilitas</td><td>${esc(lkp.fasilitas)}</td></tr>
          <tr><td class="no">4</td><td class="ur">Peralatan</td><td>${esc(incident.device_name)}${incident.ip && incident.ip.match(/^\\d/) ? ' (' + esc(incident.ip) + ')' : ''}</td></tr>
          <tr><td class="no">5</td><td class="ur">Bagian Peralatan</td><td>${esc(sparepart || '-')}</td></tr>
          <tr><td class="no">6</td><td class="ur">Kategori Kerusakan</td><td><b>${kategori}</b> <span class="ket">&nbsp;&nbsp;Ket: RR - Rusak Ringan&nbsp;·&nbsp;RB - Rusak Berat</span></td></tr>
          <tr><td class="no">7</td><td class="ur">Uraian Kerusakan</td><td>${esc(kerusakan)}</td></tr>
          <tr><td class="no">8</td><td class="ur">Tindakan Perbaikan<br><span class="ket">Oleh: ${esc(existing?.reporter_name || '-')} · Lokasi: ${esc(lkp.kota)}</span></td><td>${esc(perbaikan)}</td></tr>
          <tr><td class="no">9</td><td class="ur">Penyebab Kerusakan</td><td>${esc(penyebab)}</td></tr>
          <tr><td class="no">10</td><td class="ur">Tgl. Kerusakan<br>Jam Kerusakan</td><td>${dshort(incident.created_at)}<br>${jam(incident.created_at)}</td></tr>
          <tr><td class="no">11</td><td class="ur">Tgl. Selesai Perbaikan<br>Jam Selesai Perbaikan</td><td>${dshort(incident.resolved_at)}<br>${jam(incident.resolved_at)}</td></tr>
          <tr><td class="no">12</td><td class="ur">Jumlah Jam Operasi Terputus</td><td>${durTxt}</td></tr>
          <tr><td class="no">13</td><td class="ur">Kode Hambatan</td><td><b>${kodeHambatan}</b> <span class="ket">(SC - Menunggu Suku Cadang · TH - Tidak Ada Hambatan · AL - Alasan Lain)</span></td></tr>
        </table>
        ${sigBlock}
      </div>
      <div class="page" style="page-break-before:always">
        <h1>Lampiran Kerusakan</h1>
        <table><tr>
          <td style="width:50%;height:260px;text-align:center;vertical-align:middle"><b>Kondisi Awal</b><br><br>${awal?.doc_url ? img(awal.doc_url, 240) : '<span style="color:#999">- belum ada foto -</span>'}</td>
          <td style="width:50%;height:260px;text-align:center;vertical-align:middle"><b>Kondisi Sesudah</b><br><br>${sesudah?.doc_url ? img(sesudah.doc_url, 240) : '<span style="color:#999">- belum ada foto -</span>'}</td>
        </tr></table>
        ${fotos.length ? `<div style="margin-top:14px;font-size:12px;font-weight:bold">Dokumentasi dari Log Perbaikan (${fotos.length} foto)</div>
        <table style="margin-top:4px"><tr>${fotos.map((n) => `<td style="text-align:center;width:${Math.floor(100 / Math.min(fotos.length, 3))}%;vertical-align:top">${img(n.doc_url || '', 160)}<div style="font-size:9px;margin-top:3px">${esc(n.note.split(':')[0])}</div><div style="font-size:8px;color:#666">${esc(n.created_at)}</div></td>`).join('')}</tr></table>` : ''}
        ${sigBlock}
      </div>
      </body></html>`);
    w.document.close();
    w.focus();
    setTimeout(() => w.print(), 400);
  }

  const field = 'w-full bg-surface2 border border-border rounded-md px-3 py-2 text-xs';

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-[300]" onClick={onClose}>
      <div className="bg-surface border border-border rounded-xl p-6 w-[560px] max-w-[95vw] max-h-[88vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex justify-between items-center mb-1">
          <span className="text-[15px] font-bold">📝 Laporan Kerusakan & Perbaikan</span>
          <button onClick={onClose} className="text-text2 hover:text-text">✕</button>
        </div>
        <div className="text-[11px] text-text2 mb-4">{incident.id} — {incident.device_name}</div>

        {tindakanList.length > 0 && (
          <div className="mb-4 border border-border rounded-lg p-3 bg-surface2/40">
            <div className="flex items-center justify-between mb-2 gap-2">
              <span className="text-[11px] font-semibold">🧾 Tindakan yang Dilaporkan ({tindakanList.length})</span>
              <button type="button" onClick={fillFromTindakan} className="text-[10px] border border-accent/40 text-accent rounded px-2 py-0.5 hover:bg-accent/10 whitespace-nowrap">↧ Salin ke Tindakan Perbaikan</button>
            </div>
            <div className="space-y-2 max-h-[170px] overflow-y-auto pr-1">
              {tindakanList.map((n) => (
                <div key={n.id} className="flex gap-2 items-start text-[11px] border-b border-border/30 pb-2 last:border-0 last:pb-0">
                  {n.doc_url && (
                    <a href={n.doc_url} target="_blank" rel="noreferrer" className="flex-shrink-0">
                      <img src={n.doc_url} alt="dok" className="w-10 h-10 rounded object-cover border border-border" />
                    </a>
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="leading-snug">{n.note}</div>
                    <div className="text-[9px] text-text2 font-mono mt-0.5">{n.created_at}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="space-y-3">
          <div>
            <label className="text-[11px] text-text2 block mb-1">Deskripsi Kerusakan <span className="text-danger">*</span></label>
            <textarea className={field} rows={2} value={kerusakan} onChange={(e) => setKerusakan(e.target.value)} placeholder="Apa yang rusak / gejala kerusakan…" />
          </div>
          <div>
            <label className="text-[11px] text-text2 block mb-1">Penyebab</label>
            <textarea className={field} rows={2} value={penyebab} onChange={(e) => setPenyebab(e.target.value)} placeholder="Akar penyebab kerusakan…" />
          </div>
          <div>
            <label className="text-[11px] text-text2 block mb-1">Tindakan Perbaikan <span className="text-danger">*</span></label>
            <textarea className={field} rows={3} value={perbaikan} onChange={(e) => setPerbaikan(e.target.value)} placeholder="Langkah perbaikan yang dilakukan…" />
          </div>
          <div>
            <label className="text-[11px] text-text2 block mb-1">Sparepart / Komponen Diganti</label>
            <textarea className={field} rows={2} value={sparepart} onChange={(e) => setSparepart(e.target.value)} placeholder="Daftar sparepart / komponen (opsional)…" />
          </div>
          <div>
            <label className="text-[11px] text-text2 block mb-1">Hasil</label>
            <select className={field} value={hasil} onChange={(e) => setHasil(e.target.value as RepairResult)}>
              <option value="berhasil">{HASIL_LABEL.berhasil}</option>
              <option value="sebagian">{HASIL_LABEL.sebagian}</option>
              <option value="gagal">{HASIL_LABEL.gagal}</option>
            </select>
          </div>
        </div>

        {existing && (
          <div className="text-[10px] text-text2 mt-3">
            Terakhir diperbarui {existing.updated_at}{existing.reporter_name ? ` · oleh ${existing.reporter_name}` : ''}
          </div>
        )}
        {signed && (
          <div className="mt-3 bg-success/10 border border-success/30 rounded-md px-3 py-2 text-[11px] text-success">
            🔏 Disahkan TTE oleh <b>{report?.signer_name}</b>{report?.signer_nip ? ` (NIP ${report.signer_nip})` : ''} · {report?.signed_at} · token <span className="font-mono">{report?.sign_token}</span>
          </div>
        )}
        {error && <div className="text-[11px] text-danger mt-3">{error}</div>}

        <div className="flex gap-2 mt-5 flex-wrap">
          <button disabled={saving} className="bg-accent text-bg rounded-md px-3 py-1.5 text-xs font-medium disabled:opacity-50" onClick={save}>
            {saving ? 'Menyimpan…' : '💾 Simpan Laporan'}
          </button>
          {existing && isManager && !signed && (
            <button disabled={signing} className="bg-success text-bg rounded-md px-3 py-1.5 text-xs font-semibold disabled:opacity-50" onClick={signReport}>
              {signing ? 'Mengesahkan…' : '🔏 Sahkan (TTE)'}
            </button>
          )}
          {existing && (
            <button className="border border-border text-text2 hover:text-text rounded-md px-3 py-1.5 text-xs font-medium" onClick={printReport}>
              🖨️ Cetak {signed ? '(TTE)' : ''}
            </button>
          )}
          {existing && isManager && (
            <button className="border border-accent2/40 text-accent2 hover:bg-accent2/10 rounded-md px-3 py-1.5 text-xs font-medium" onClick={printNotaDinas}>
              📄 Nota Dinas
            </button>
          )}
          <button className="border border-border text-text2 hover:text-text rounded-md px-3 py-1.5 text-xs font-medium ml-auto" onClick={onClose}>
            Tutup
          </button>
        </div>
      </div>
    </div>
  );
}
