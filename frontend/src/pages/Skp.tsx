import { useCallback, useEffect, useState } from 'react';
import { api } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { confirmDialog, alertDialog } from '../components/dialog';
import type { Skp, SkpRhk, SkpIndikator, SkpBukti, SkpAspek, SkpDataSource } from '../types';

const field = 'w-full bg-surface2 border border-border rounded-md px-3 py-2 text-xs outline-none focus:border-accent2/60';
const ASPEK_OPTS: SkpAspek[] = ['Kuantitas', 'Kualitas', 'Waktu', 'Biaya'];
const BULAN_ID = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];

const aspekCls = (a: string) =>
  a === 'Kuantitas' ? 'text-accent2 border-accent2/40 bg-accent2/10'
  : a === 'Waktu' ? 'text-warn border-warn/40 bg-warn/10'
  : a === 'Kualitas' ? 'text-success border-success/40 bg-success/10'
  : 'text-text2 border-border bg-surface2';

const errMsg = (e: any) => e?.response?.data?.error || 'Terjadi kesalahan.';
const thisMonth = () => new Date().toISOString().slice(0, 7);
const monthsOfYear = (tahun: number) => Array.from({ length: 12 }, (_, i) => `${tahun}-${String(i + 1).padStart(2, '0')}`);
const monthLabel = (m?: string) => { if (!m) return '-'; const [y, mo] = m.split('-'); return `${BULAN_ID[Number(mo) - 1]} ${y}`; };
const skpPublicUrl = (t: string, bulan: string) => `${window.location.origin}/skp-publik?token=${t}&bulan=${bulan}`;
const buktiPublicUrl = (t: string) => `${window.location.origin}/skp-bukti?token=${t}`;

function copy(text: string) {
  navigator.clipboard?.writeText(text).then(() => alertDialog({ variant: 'success', title: 'Tautan disalin', message: text })).catch(() => {});
}

export default function SkpPage() {
  const { user } = useAuth();
  const [list, setList] = useState<Skp[]>([]);
  const [detail, setDetail] = useState<Skp | null>(null);
  const [loading, setLoading] = useState(true);
  const [lkp, setLkp] = useState<any>({});
  const [dataSources, setDataSources] = useState<SkpDataSource[]>([]);
  const [headerModal, setHeaderModal] = useState<'create' | 'edit' | null>(null);
  const [rhkModal, setRhkModal] = useState<{ rhk?: SkpRhk } | null>(null);
  const [indModal, setIndModal] = useState<{ rhkId: number; ind?: SkpIndikator } | null>(null);
  const [realModal, setRealModal] = useState<{ ind: SkpIndikator } | null>(null);
  const [buktiModal, setBuktiModal] = useState<{ indId: number; bukti?: SkpBukti } | null>(null);

  const loadList = useCallback(async () => {
    setLoading(true);
    try { const r = await api.get('/skp'); setList(r.data.skp || []); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => {
    loadList();
    api.get('/settings').then((r) => setLkp(r.data.settings?.lkp || {})).catch(() => {});
    api.get('/skp/data-sources').then((r) => setDataSources(r.data.sources || [])).catch(() => {});
  }, [loadList]);

  const bulan = detail?.bulan || thisMonth();

  async function openDetail(id: number, b?: string) {
    try { const r = await api.get(`/skp/${id}`, { params: { bulan: b } }); setDetail(r.data.skp); }
    catch (e) { alertDialog({ variant: 'danger', message: errMsg(e) }); }
  }
  const refreshDetail = (skp: Skp) => { setDetail(skp); loadList(); };

  async function deleteSkp() {
    if (!detail) return;
    if (!(await confirmDialog({ variant: 'danger', title: 'Hapus SKP', message: `Hapus SKP ${detail.periode} ${detail.tahun} beserta seluruh RHK, indikator, realisasi & bukti dukung semua bulan? Tindakan ini tidak bisa dibatalkan.`, confirmText: 'Hapus' }))) return;
    try { await api.delete(`/skp/${detail.id}`); setDetail(null); loadList(); }
    catch (e) { alertDialog({ variant: 'danger', message: errMsg(e) }); }
  }
  async function del(url: string, msg: string) {
    if (!(await confirmDialog({ variant: 'danger', message: msg, confirmText: 'Hapus' }))) return;
    try { const r = await api.delete(url, { params: { bulan } }); refreshDetail(r.data.skp); }
    catch (e) { alertDialog({ variant: 'danger', message: errMsg(e) }); }
  }

  // ---------- LIST ----------
  if (!detail) {
    return (
      <div className="max-w-5xl mx-auto">
        <div className="flex items-center justify-between mb-4 gap-2 flex-wrap">
          <div>
            <h1 className="text-lg font-bold">📋 Sasaran Kinerja Pegawai (SKP)</h1>
            <p className="text-[12px] text-text2">RHK & indikator disusun sekali per tahun, lalu diisi realisasi + bukti dukung tiap bulan. Tiap SKP & bukti punya halaman publik.</p>
          </div>
          <button onClick={() => setHeaderModal('create')} className="bg-accent text-bg rounded-md px-3 py-1.5 text-xs font-semibold">+ SKP Baru</button>
        </div>
        {loading ? (
          <div className="text-text2 text-sm py-10 text-center">Memuat…</div>
        ) : list.length === 0 ? (
          <div className="border border-dashed border-border rounded-xl p-10 text-center text-text2 text-sm">Belum ada SKP. Klik <b>+ SKP Baru</b> untuk membuat.</div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {list.map((s) => (
              <button key={s.id} onClick={() => openDetail(s.id, thisMonth())} className="text-left border border-border rounded-xl p-4 bg-surface hover:border-accent2/50 transition">
                <div className="flex items-start justify-between gap-2">
                  <div className="font-semibold text-sm">{s.periode} · {s.tahun}</div>
                  {s.can_edit === false && <span className="text-[9px] px-1.5 py-0.5 rounded border border-border text-text2 shrink-0">👁️ Lihat saja</span>}
                </div>
                <div className="text-[12px] text-text2 mt-1">{s.pegawai_nama || '-'}{s.pegawai_jabatan ? ` · ${s.pegawai_jabatan}` : ''}</div>
                <div className="text-[11px] text-text2 mt-2 flex gap-3">
                  <span>🎯 {s.jml_rhk || 0} RHK</span><span>📎 {s.jml_bukti || 0} bukti</span>
                </div>
              </button>
            ))}
          </div>
        )}
        {headerModal && <HeaderModal mode="create" user={user} lkp={lkp} onClose={() => setHeaderModal(null)} onSaved={(skp) => { setHeaderModal(null); loadList(); setDetail(skp); }} />}
      </div>
    );
  }

  // ---------- DETAIL ----------
  const d = detail;
  // Koordinator membuka SKP anggota unitnya: hanya boleh melihat (tombol ubah disembunyikan;
  // backend tetap menolak bila dipaksa lewat API).
  const ro = d.can_edit === false;
  return (
    <div className="max-w-5xl mx-auto pb-10">
      <button onClick={() => setDetail(null)} className="text-[12px] text-text2 hover:text-text mb-3">← Kembali ke daftar SKP</button>

      {/* Identitas */}
      <div className="border border-border rounded-xl p-4 bg-surface mb-3">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <h1 className="text-base font-bold">SKP {d.periode} · {d.tahun}</h1>
            <div className="text-[12px] text-text2 mt-0.5">Pendekatan: {d.pendekatan}</div>
          </div>
          {ro ? (
            <span className="text-[10px] px-2 py-1 rounded border border-border text-text2">👁️ Lihat saja — SKP {d.pemilik_nama || d.pegawai_nama || 'personel'}</span>
          ) : (
            <div className="flex gap-2 flex-wrap">
              <button onClick={() => setHeaderModal('edit')} className="border border-border text-text2 hover:text-text rounded-md px-2.5 py-1 text-[11px]">✏️ Edit Identitas</button>
              <button onClick={deleteSkp} className="border border-danger/40 text-danger rounded-md px-2.5 py-1 text-[11px]">🗑️ Hapus</button>
            </div>
          )}
        </div>
        <div className="grid sm:grid-cols-2 gap-3 mt-3">
          <div className="bg-surface2/50 border border-border rounded-lg p-3">
            <div className="text-[10px] uppercase tracking-wide text-text2 mb-1">Pegawai yang Dinilai</div>
            <div className="text-[13px] font-semibold">{d.pegawai_nama || '-'}</div>
            <div className="text-[11px] text-text2">{d.pegawai_jabatan || '-'}</div>
            <div className="text-[11px] text-text2">NIP. {d.pegawai_nip || '-'}</div>
            <div className="text-[11px] text-text2">{d.pegawai_unit || '-'}</div>
          </div>
          <div className="bg-surface2/50 border border-border rounded-lg p-3">
            <div className="text-[10px] uppercase tracking-wide text-text2 mb-1">Pejabat Penilai</div>
            <div className="text-[13px] font-semibold">{d.penilai_nama || '-'}</div>
            <div className="text-[11px] text-text2">{d.penilai_jabatan || '-'}</div>
            <div className="text-[11px] text-text2">NIP. {d.penilai_nip || '-'}</div>
          </div>
        </div>
      </div>

      {/* Bar bulan */}
      <div className="border border-border rounded-xl p-3 bg-surface mb-2 flex items-center gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <span className="text-[11px] text-text2">📅 Bulan:</span>
          <select value={bulan} onChange={(e) => openDetail(d.id, e.target.value)} className="bg-surface2 border border-border rounded-md px-2 py-1 text-xs">
            {monthsOfYear(d.tahun).map((m) => (
              <option key={m} value={m}>{BULAN_ID[Number(m.split('-')[1]) - 1]}{d.months?.includes(m) ? ' ●' : ''}</option>
            ))}
          </select>
        </div>
        <div className="flex items-center gap-2 flex-wrap ml-auto">
          {d.public_token && (
            <>
              <a href={skpPublicUrl(d.public_token, bulan)} target="_blank" rel="noreferrer" className="bg-accent/15 text-accent border border-accent/40 rounded-md px-3 py-1 text-[11px] font-semibold">🌐 Halaman Publik</a>
              <button onClick={() => copy(skpPublicUrl(d.public_token!, bulan))} className="border border-border text-text2 hover:text-text rounded-md px-3 py-1 text-[11px]">📋 Salin</button>
            </>
          )}
        </div>
      </div>
      {d.laporanBulanan ? (
        <a href={`${window.location.origin}${d.laporanBulanan.pdf_url}`} target="_blank" rel="noreferrer"
          className="mb-3 flex items-center gap-2 rounded-lg border border-success/40 bg-success/10 px-3 py-2 text-[11.5px] text-success hover:bg-success/20 transition">
          <span>⬇️</span>
          <span><b>Unduh Laporan Bulanan {monthLabel(bulan)} (PDF)</b> — sudah TTE Koordinator ({d.laporanBulanan.koordinator.nama || '-'}) &amp; Kasi ({d.laporanBulanan.kasi.nama || '-'}) · No. {d.laporanBulanan.nomor}</span>
        </a>
      ) : (
        <div className="mb-3 text-[10.5px] text-text2 flex items-start gap-1.5 border border-border rounded-lg px-3 py-2 bg-surface2/40">
          <span>📄</span>
          <span>Dokumen Laporan Bulanan {monthLabel(bulan)} ber-TTE Koordinator &amp; Kasi belum tersedia. Buat & tandatangani lewat menu <b>Laporan Bulanan</b> → <b>Surat Keluar</b>; tombol unduhnya akan muncul otomatis di sini & di halaman publik.</span>
        </div>
      )}
      <div className="text-[10.5px] text-text2 mb-4 flex items-start gap-1.5">
        <span>ℹ️</span>
        <span>Pengajuan penilaian SKP dilakukan di <b>situs resmi e-Kinerja Kementerian</b>. Aplikasi ini hanya untuk menyusun RHK/indikator dan menyiapkan bukti dukung beserta tautan publiknya untuk dilampirkan/diverifikasi di sana.</span>
      </div>

      {/* RHK */}
      <div className="flex items-center justify-between mb-2">
        <h2 className="text-sm font-bold">Rencana Hasil Kerja & Indikator <span className="text-[11px] text-text2 font-normal">· realisasi/bukti untuk {monthLabel(bulan)}</span></h2>
        {!ro && <button onClick={() => setRhkModal({})} className="bg-accent text-bg rounded-md px-3 py-1.5 text-xs font-semibold">+ Tambah RHK</button>}
      </div>

      {(!d.rhk || d.rhk.length === 0) ? (
        <div className="border border-dashed border-border rounded-xl p-8 text-center text-text2 text-sm">Belum ada RHK. Klik <b>+ Tambah RHK</b>.</div>
      ) : (
        <div className="space-y-4">
          {d.rhk.map((r, ri) => (
            <div key={r.id} className="border border-border rounded-xl bg-surface overflow-hidden">
              <div className="flex items-start justify-between gap-2 p-3 bg-surface2/40 border-b border-border">
                <div className="flex-1 min-w-0">
                  <span className={`text-[9px] px-1.5 py-0.5 rounded border mr-2 ${r.klasifikasi === 'utama' ? 'text-accent border-accent/40 bg-accent/10' : 'text-text2 border-border'}`}>{r.klasifikasi.toUpperCase()}</span>
                  <span className="text-[13px] font-semibold">RHK {ri + 1}.</span>
                  <span className="text-[13px]"> {r.rhk}</span>
                </div>
                {!ro && (
                  <div className="flex gap-1 shrink-0">
                    <button onClick={() => setRhkModal({ rhk: r })} className="text-[11px] text-text2 hover:text-text px-1.5">✏️</button>
                    <button onClick={() => del(`/skp/rhk/${r.id}`, 'Hapus RHK ini beserta indikator, realisasi & bukti di bawahnya (semua bulan)?')} className="text-[11px] text-danger px-1.5">🗑️</button>
                  </div>
                )}
              </div>

              <div className="p-3 space-y-3">
                {r.indikator.length === 0 && <div className="text-[11px] text-text2 italic">Belum ada indikator.</div>}
                {r.indikator.map((ind) => (
                  <div key={ind.id} className="border border-border rounded-lg p-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <span className={`text-[9px] px-1.5 py-0.5 rounded border mr-2 ${aspekCls(ind.aspek)}`}>{ind.aspek}</span>
                        <span className="text-[12.5px] font-medium">{ind.indikator}</span>
                        {ind.target && <div className="text-[11px] text-text2 mt-0.5">🎯 Target: {ind.target}</div>}
                      </div>
                      {!ro && (
                        <div className="flex gap-1 shrink-0">
                          <button title="Edit indikator (rencana tahunan)" onClick={() => setIndModal({ rhkId: r.id, ind })} className="text-[11px] text-text2 hover:text-text px-1.5">✏️</button>
                          <button onClick={() => del(`/skp/indikator/${ind.id}`, 'Hapus indikator ini beserta realisasi & bukti (semua bulan)?')} className="text-[11px] text-danger px-1.5">🗑️</button>
                        </div>
                      )}
                    </div>

                    {ind.renaksi && <div className="mt-2"><Field label="Rencana Aksi (Renaksi) — tahunan" value={ind.renaksi} /></div>}

                    {/* Realisasi (bulan terpilih) */}
                    <div className="mt-2">
                      {ro
                        ? <Field label={`Realisasi · ${monthLabel(bulan)}`} value={ind.realisasi} />
                        : <FieldEdit label={`Realisasi · ${monthLabel(bulan)}`} value={ind.realisasi} onEdit={() => setRealModal({ ind })} />}
                    </div>

                    {/* Bukti dukung (bulan terpilih) */}
                    <div className="mt-2.5 border-t border-border/60 pt-2">
                      <div className="flex items-center justify-between mb-1.5">
                        <span className="text-[11px] font-semibold text-text2">📎 Bukti Data Dukung · {monthLabel(bulan)} ({ind.bukti.length})</span>
                        {!ro && <button onClick={() => setBuktiModal({ indId: ind.id })} className="text-[10px] border border-accent/40 text-accent rounded px-2 py-0.5 hover:bg-accent/10">+ Tambah Bukti</button>}
                      </div>
                      {ind.bukti.length === 0 ? (
                        <div className="text-[10.5px] text-text2 italic">Belum ada bukti dukung bulan ini.</div>
                      ) : (
                        <ol className="space-y-1.5">
                          {ind.bukti.map((b, bi) => (
                            <li key={b.id} className="flex items-start gap-2 text-[11px]">
                              <span className="text-text2 shrink-0">{bi + 1}.</span>
                              <div className="flex-1 min-w-0">
                                <span className={`text-[9px] px-1.5 py-0.5 rounded border mr-1.5 ${b.kind === 'data' ? 'text-accent border-accent/40 bg-accent/10' : 'text-text2 border-border'}`}>{b.kind === 'data' ? '📊 Data' : b.kind === 'file' ? '📄 Berkas' : '🔗 Tautan'}</span>
                                <span>{b.deskripsi}</span>
                                {(b.url || b.file_url) && (
                                  <div className="flex gap-2 flex-wrap mt-0.5">
                                    {b.url && <a href={b.url} target="_blank" rel="noreferrer" className="text-accent2 hover:underline break-all">🔗 Tautan</a>}
                                    {b.file_url && <a href={b.file_url} target="_blank" rel="noreferrer" className="text-accent2 hover:underline">📄 Berkas</a>}
                                  </div>
                                )}
                                {b.public_token && (
                                  <div className="mt-1 flex items-center gap-1.5 bg-surface2/60 border border-border rounded px-2 py-1">
                                    <span className="text-[9px] text-text2 shrink-0">🌐 Link publik:</span>
                                    <a href={buktiPublicUrl(b.public_token)} target="_blank" rel="noreferrer" className="text-accent font-mono text-[10px] break-all hover:underline flex-1">{buktiPublicUrl(b.public_token)}</a>
                                    <button onClick={() => copy(buktiPublicUrl(b.public_token!))} className="text-text2 hover:text-text shrink-0" title="Salin">📋</button>
                                  </div>
                                )}
                              </div>
                              {!ro && (
                                <div className="flex gap-1 shrink-0">
                                  <button onClick={() => setBuktiModal({ indId: ind.id, bukti: b })} className="text-text2 hover:text-text">✏️</button>
                                  <button onClick={() => del(`/skp/bukti/${b.id}`, 'Hapus bukti dukung ini?')} className="text-danger">🗑️</button>
                                </div>
                              )}
                            </li>
                          ))}
                        </ol>
                      )}
                    </div>
                  </div>
                ))}
                {!ro && <button onClick={() => setIndModal({ rhkId: r.id })} className="text-[11px] border border-border text-text2 hover:text-text rounded-md px-3 py-1">+ Tambah Indikator</button>}
              </div>
            </div>
          ))}
        </div>
      )}

      {headerModal && <HeaderModal mode={headerModal} skp={headerModal === 'edit' ? d : undefined} bulan={bulan} user={user} lkp={lkp} onClose={() => setHeaderModal(null)} onSaved={(skp) => { setHeaderModal(null); refreshDetail(skp); }} />}
      {rhkModal && <RhkModal skpId={d.id} bulan={bulan} rhk={rhkModal.rhk} onClose={() => setRhkModal(null)} onSaved={(skp) => { setRhkModal(null); refreshDetail(skp); }} />}
      {indModal && <IndikatorModal rhkId={indModal.rhkId} bulan={bulan} ind={indModal.ind} onClose={() => setIndModal(null)} onSaved={(skp) => { setIndModal(null); refreshDetail(skp); }} />}
      {realModal && <RealisasiModal indId={realModal.ind.id} bulan={bulan} realisasi={realModal.ind.realisasi} onClose={() => setRealModal(null)} onSaved={(skp) => { setRealModal(null); refreshDetail(skp); }} />}
      {buktiModal && <BuktiModal indId={buktiModal.indId} bulan={bulan} bukti={buktiModal.bukti} dataSources={dataSources} onClose={() => setBuktiModal(null)} onSaved={(skp) => { setBuktiModal(null); refreshDetail(skp); }} />}
    </div>
  );
}

function Field({ label, value, accent }: { label: string; value: string | null; accent?: boolean }) {
  return (
    <div className={`rounded-md border px-2.5 py-1.5 ${accent ? 'border-accent2/40 bg-accent2/5' : 'border-border bg-surface2/40'}`}>
      <div className="text-[9px] uppercase tracking-wide text-text2 mb-0.5">{label}</div>
      <div className="text-[11.5px] whitespace-pre-wrap">{value || <span className="text-text2 italic">—</span>}</div>
    </div>
  );
}
function FieldEdit({ label, value, onEdit, accent }: { label: string; value: string | null; onEdit: () => void; accent?: boolean }) {
  return (
    <button onClick={onEdit} className={`text-left rounded-md border px-2.5 py-1.5 hover:border-accent2/60 transition ${accent ? 'border-accent2/40 bg-accent2/5' : 'border-border bg-surface2/40'}`}>
      <div className="text-[9px] uppercase tracking-wide text-text2 mb-0.5 flex justify-between">{label}<span className="text-accent2">✏️</span></div>
      <div className="text-[11.5px] whitespace-pre-wrap">{value || <span className="text-text2 italic">— klik untuk isi —</span>}</div>
    </button>
  );
}

// ---------- Modal shell ----------
function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-[300] p-4" onClick={onClose}>
      <div className="bg-surface border border-border rounded-xl p-5 w-[560px] max-w-[95vw] max-h-[88vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex justify-between items-center mb-4">
          <span className="text-[15px] font-bold">{title}</span>
          <button onClick={onClose} className="text-text2 hover:text-text">✕</button>
        </div>
        {children}
      </div>
    </div>
  );
}
function Label({ children, req }: { children: React.ReactNode; req?: boolean }) {
  return <label className="text-[11px] text-text2 block mb-1">{children}{req && <span className="text-danger"> *</span>}</label>;
}
function SaveBar({ saving, error, onSave, onClose }: { saving: boolean; error: string; onSave: () => void; onClose: () => void }) {
  return (
    <>
      {error && <div className="text-[11px] text-danger mt-3">{error}</div>}
      <div className="flex gap-2 mt-5">
        <button disabled={saving} onClick={onSave} className="bg-accent text-bg rounded-md px-3 py-1.5 text-xs font-semibold disabled:opacity-50">{saving ? 'Menyimpan…' : '💾 Simpan'}</button>
        <button onClick={onClose} className="border border-border text-text2 hover:text-text rounded-md px-3 py-1.5 text-xs ml-auto">Batal</button>
      </div>
    </>
  );
}

// ---------- Header modal ----------
function HeaderModal({ mode, skp, bulan, user, lkp, onClose, onSaved }: { mode: 'create' | 'edit'; skp?: Skp; bulan?: string; user: any; lkp: any; onClose: () => void; onSaved: (s: Skp) => void }) {
  const [f, setF] = useState({
    periode: skp?.periode || `Tahunan ${new Date().getFullYear()}`,
    tahun: String(skp?.tahun || new Date().getFullYear()),
    pendekatan: skp?.pendekatan || 'Kuantitatif',
    pegawai_nama: skp?.pegawai_nama ?? user?.name ?? '',
    pegawai_nip: skp?.pegawai_nip ?? user?.nip ?? '',
    pegawai_jabatan: skp?.pegawai_jabatan ?? user?.jabatan ?? lkp.koord_jabatan ?? '',
    pegawai_unit: skp?.pegawai_unit ?? lkp.unit ?? 'Unit Elektronika Bandara',
    penilai_nama: skp?.penilai_nama ?? lkp.kepala_nama ?? '',
    penilai_nip: skp?.penilai_nip ?? lkp.kepala_nip ?? '',
    penilai_jabatan: skp?.penilai_jabatan ?? lkp.kepala_jabatan ?? '',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const set = (k: string, v: string) => setF((p) => ({ ...p, [k]: v }));

  async function save() {
    if (!f.periode.trim()) { setError('Periode wajib diisi.'); return; }
    setSaving(true); setError('');
    try {
      const body = { ...f, bulan };
      const r = mode === 'create' ? await api.post('/skp', body) : await api.put(`/skp/${skp!.id}`, body);
      onSaved(r.data.skp);
    } catch (e) { setError(errMsg(e)); setSaving(false); }
  }

  return (
    <Modal title={mode === 'create' ? '➕ SKP Baru (Tahunan)' : '✏️ Edit Identitas SKP'} onClose={onClose}>
      <div className="grid grid-cols-2 gap-3">
        <div><Label req>Periode</Label><input className={field} value={f.periode} onChange={(e) => set('periode', e.target.value)} placeholder="Tahunan 2026" /></div>
        <div><Label req>Tahun</Label><input className={field} type="number" value={f.tahun} onChange={(e) => set('tahun', e.target.value)} /></div>
      </div>
      <div className="mt-3"><Label>Pendekatan</Label>
        <select className={field} value={f.pendekatan} onChange={(e) => set('pendekatan', e.target.value)}>
          <option value="Kuantitatif">Kuantitatif</option><option value="Kualitatif">Kualitatif</option>
        </select>
      </div>
      <div className="text-[11px] font-semibold text-text2 mt-4 mb-1">Pegawai yang Dinilai</div>
      <div className="grid grid-cols-2 gap-3">
        <div><Label>Nama</Label><input className={field} value={f.pegawai_nama} onChange={(e) => set('pegawai_nama', e.target.value)} /></div>
        <div><Label>NIP</Label><input className={field} value={f.pegawai_nip} onChange={(e) => set('pegawai_nip', e.target.value)} /></div>
        <div><Label>Jabatan</Label><input className={field} value={f.pegawai_jabatan} onChange={(e) => set('pegawai_jabatan', e.target.value)} /></div>
        <div><Label>Unit Kerja</Label><input className={field} value={f.pegawai_unit} onChange={(e) => set('pegawai_unit', e.target.value)} /></div>
      </div>
      <div className="text-[11px] font-semibold text-text2 mt-4 mb-1">Pejabat Penilai</div>
      <div className="grid grid-cols-2 gap-3">
        <div><Label>Nama</Label><input className={field} value={f.penilai_nama} onChange={(e) => set('penilai_nama', e.target.value)} /></div>
        <div><Label>NIP</Label><input className={field} value={f.penilai_nip} onChange={(e) => set('penilai_nip', e.target.value)} /></div>
        <div className="col-span-2"><Label>Jabatan</Label><input className={field} value={f.penilai_jabatan} onChange={(e) => set('penilai_jabatan', e.target.value)} /></div>
      </div>
      <SaveBar saving={saving} error={error} onSave={save} onClose={onClose} />
    </Modal>
  );
}

// ---------- RHK modal ----------
function RhkModal({ skpId, bulan, rhk, onClose, onSaved }: { skpId: number; bulan: string; rhk?: SkpRhk; onClose: () => void; onSaved: (s: Skp) => void }) {
  const [text, setText] = useState(rhk?.rhk || '');
  const [klas, setKlas] = useState(rhk?.klasifikasi || 'utama');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  async function save() {
    if (!text.trim()) { setError('Teks RHK wajib diisi.'); return; }
    setSaving(true); setError('');
    try {
      const body = { rhk: text, klasifikasi: klas, bulan };
      const r = rhk ? await api.put(`/skp/rhk/${rhk.id}`, body) : await api.post(`/skp/${skpId}/rhk`, body);
      onSaved(r.data.skp);
    } catch (e) { setError(errMsg(e)); setSaving(false); }
  }
  return (
    <Modal title={rhk ? '✏️ Edit RHK' : '➕ Tambah RHK'} onClose={onClose}>
      <Label>Klasifikasi</Label>
      <select className={field} value={klas} onChange={(e) => setKlas(e.target.value as any)}>
        <option value="utama">Utama</option><option value="tambahan">Tambahan</option>
      </select>
      <div className="mt-3"><Label req>Rencana Hasil Kerja</Label>
        <textarea className={field} rows={3} value={text} onChange={(e) => setText(e.target.value)} placeholder="Tersusunnya Laporan…" />
      </div>
      <SaveBar saving={saving} error={error} onSave={save} onClose={onClose} />
    </Modal>
  );
}

// ---------- Indikator modal (rencana tahunan) ----------
function IndikatorModal({ rhkId, bulan, ind, onClose, onSaved }: { rhkId: number; bulan: string; ind?: SkpIndikator; onClose: () => void; onSaved: (s: Skp) => void }) {
  const [f, setF] = useState({ aspek: ind?.aspek || 'Kuantitas', indikator: ind?.indikator || '', target: ind?.target || '', renaksi: ind?.renaksi || '' });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const set = (k: string, v: string) => setF((p) => ({ ...p, [k]: v }));
  async function save() {
    if (!f.indikator.trim()) { setError('Teks indikator wajib diisi.'); return; }
    setSaving(true); setError('');
    try {
      const body = { ...f, bulan };
      const r = ind ? await api.put(`/skp/indikator/${ind.id}`, body) : await api.post(`/skp/rhk/${rhkId}/indikator`, body);
      onSaved(r.data.skp);
    } catch (e) { setError(errMsg(e)); setSaving(false); }
  }
  return (
    <Modal title={ind ? '✏️ Edit Indikator (Rencana Tahunan)' : '➕ Tambah Indikator'} onClose={onClose}>
      <div className="text-[10px] text-text2 mb-3">Indikator & rencana aksi berlaku untuk seluruh tahun (dipakai tiap bulan). Realisasi diisi terpisah per bulan.</div>
      <div className="grid grid-cols-2 gap-3">
        <div><Label>Aspek</Label>
          <select className={field} value={f.aspek} onChange={(e) => set('aspek', e.target.value)}>
            {ASPEK_OPTS.map((a) => <option key={a} value={a}>{a}</option>)}
          </select>
        </div>
        <div><Label>Target (tahunan)</Label><input className={field} value={f.target} onChange={(e) => set('target', e.target.value)} placeholder="mis. 12 laporan / 100%" /></div>
      </div>
      <div className="mt-3"><Label req>Indikator Kinerja</Label><textarea className={field} rows={2} value={f.indikator} onChange={(e) => set('indikator', e.target.value)} /></div>
      <div className="mt-3"><Label>Rencana Aksi (Renaksi)</Label><textarea className={field} rows={3} value={f.renaksi} onChange={(e) => set('renaksi', e.target.value)} placeholder={'1. Melakukan Pemeliharaan…\n2. Melakukan Perawatan…'} /></div>
      <SaveBar saving={saving} error={error} onSave={save} onClose={onClose} />
    </Modal>
  );
}

// ---------- Realisasi modal (per bulan) ----------
function RealisasiModal({ indId, bulan, realisasi, onClose, onSaved }: { indId: number; bulan: string; realisasi: string | null; onClose: () => void; onSaved: (s: Skp) => void }) {
  const [r, setR] = useState(realisasi || '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const lbl = (() => { const [y, mo] = bulan.split('-'); return `${BULAN_ID[Number(mo) - 1]} ${y}`; })();
  async function save() {
    setSaving(true); setError('');
    try {
      const res = await api.put(`/skp/indikator/${indId}/realisasi`, { bulan, realisasi: r });
      onSaved(res.data.skp);
    } catch (e) { setError(errMsg(e)); setSaving(false); }
  }
  return (
    <Modal title={`📝 Realisasi · ${lbl}`} onClose={onClose}>
      <Label>Realisasi</Label>
      <textarea className={field} rows={5} value={r} onChange={(e) => setR(e.target.value)} placeholder="Apa yang dikerjakan/dicapai pada bulan ini…" />
      <div className="text-[10px] text-text2 mt-2">ℹ️ Feedback penilai diberikan di situs resmi e-Kinerja Kementerian, bukan di sini.</div>
      <SaveBar saving={saving} error={error} onSave={save} onClose={onClose} />
    </Modal>
  );
}

// ---------- Bukti modal ----------
function BuktiModal({ indId, bulan, bukti, dataSources, onClose, onSaved }: { indId: number; bulan: string; bukti?: SkpBukti; dataSources: SkpDataSource[]; onClose: () => void; onSaved: (s: Skp) => void }) {
  const editing = !!bukti;
  const [kind, setKind] = useState<'link' | 'file' | 'data'>(bukti?.kind || 'link');
  const [deskripsi, setDeskripsi] = useState(bukti?.deskripsi || '');
  const [url, setUrl] = useState(bukti?.url || '');
  const [file, setFile] = useState<File | null>(null);
  const [source, setSource] = useState(bukti?.source || dataSources[0]?.key || 'perbaikan');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const srcDef = dataSources.find((s) => s.key === source);
  const lbl = (() => { const [y, mo] = bulan.split('-'); return `${BULAN_ID[Number(mo) - 1]} ${y}`; })();

  async function save() {
    setSaving(true); setError('');
    try {
      let r;
      if (kind === 'data' && !editing) {
        r = await api.post(`/skp/indikator/${indId}/bukti-data`, { source, bulan, deskripsi: deskripsi.trim() || undefined });
      } else {
        if (!deskripsi.trim()) { setError('Deskripsi bukti wajib diisi.'); setSaving(false); return; }
        const fd = new FormData();
        fd.append('deskripsi', deskripsi);
        fd.append('bulan', bulan);
        if (kind !== 'data') { fd.append('url', url); if (file) fd.append('file', file); }
        r = editing
          ? await api.put(`/skp/bukti/${bukti!.id}`, fd, { headers: { 'Content-Type': 'multipart/form-data' } })
          : await api.post(`/skp/indikator/${indId}/bukti`, fd, { headers: { 'Content-Type': 'multipart/form-data' } });
      }
      onSaved(r.data.skp);
    } catch (e) { setError(errMsg(e)); setSaving(false); }
  }

  const TYPES: { k: 'link' | 'file' | 'data'; label: string }[] = [
    { k: 'link', label: '🔗 Tautan' }, { k: 'file', label: '📄 Berkas' }, { k: 'data', label: '📊 Data Aplikasi' },
  ];

  return (
    <Modal title={editing ? '✏️ Edit Bukti Dukung' : `➕ Tambah Bukti · ${lbl}`} onClose={onClose}>
      {!editing && (
        <div className="mb-3">
          <Label>Jenis Bukti</Label>
          <div className="flex gap-1.5">
            {TYPES.map((t) => (
              <button key={t.k} type="button" onClick={() => setKind(t.k)}
                className={`flex-1 rounded-md px-2 py-1.5 text-[11px] border ${kind === t.k ? 'bg-accent/15 text-accent border-accent/40 font-semibold' : 'border-border text-text2 hover:text-text'}`}>{t.label}</button>
            ))}
          </div>
        </div>
      )}

      {kind === 'data' ? (
        <>
          {!editing ? (
            <>
              <Label req>Sumber Data Aplikasi</Label>
              <select className={field} value={source} onChange={(e) => setSource(e.target.value)}>
                {dataSources.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
              </select>
              <div className="mt-2 text-[11px] text-text2">{srcDef?.period === 'month' ? `Periode snapshot: ${lbl} (mengikuti bulan aktif).` : 'Sumber ini tidak berbasis bulan (snapshot kondisi saat ini).'}</div>
              <div className="mt-3"><Label>Deskripsi (opsional)</Label>
                <input className={field} value={deskripsi} onChange={(e) => setDeskripsi(e.target.value)} placeholder="Kosongkan untuk pakai judul otomatis" />
              </div>
              <div className="text-[10px] text-text2 mt-2">📸 Data <b>dibekukan (snapshot)</b> saat disimpan & tampil di halaman publik bukti. Bukti melekat pada bulan {lbl}.</div>
            </>
          ) : (
            <>
              <div className="rounded-md border border-border bg-surface2/40 px-3 py-2 text-[11px] text-text2 mb-3">📊 Bukti data aplikasi (snapshot beku). Isi snapshot tidak dapat diubah; hanya deskripsi.</div>
              <Label req>Deskripsi</Label>
              <input className={field} value={deskripsi} onChange={(e) => setDeskripsi(e.target.value)} />
            </>
          )}
        </>
      ) : (
        <>
          <Label req>Deskripsi</Label>
          <input className={field} value={deskripsi} onChange={(e) => setDeskripsi(e.target.value)} placeholder="mis. Logbook Peralatan / Laporan Bulanan" />
          <div className="mt-3"><Label>Tautan (URL)</Label><input className={field} value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://drive.google.com/…" /></div>
          <div className="mt-3"><Label>Unggah Berkas (opsional)</Label>
            <input type="file" onChange={(e) => setFile(e.target.files?.[0] || null)} className="text-[11px] text-text2 file:mr-2 file:rounded file:border-0 file:bg-surface2 file:px-2 file:py-1 file:text-text" />
            {bukti?.file_url && !file && <div className="text-[10px] text-text2 mt-1">Berkas saat ini: <a href={bukti.file_url} target="_blank" rel="noreferrer" className="text-accent2 underline">lihat</a></div>}
          </div>
        </>
      )}
      <SaveBar saving={saving} error={error} onSave={save} onClose={onClose} />
    </Modal>
  );
}
