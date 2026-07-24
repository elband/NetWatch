import { createPortal } from 'react-dom';
import { useShiftWindows, fmtWindow } from '../utils/shifts';

interface Props {
  onClose: () => void;
}

/**
 * Panduan Penggunaan NetWatch — dokumen berhalaman yang tampil sebagai overlay
 * dan bisa diunduh/dicetak jadi PDF.
 *
 * Dirender lewat PORTAL ke <body> (bukan inline di dalam #root). Ini WAJIB untuk
 * cetak: CSS print menyembunyikan #root (display:none), dan elemen di dalam
 * ancestor display:none tak bisa dimunculkan kembali. Versi lama meletakkan
 * dokumen di dalam #root sehingga PDF-nya selalu kosong. Sebagai portal, dokumen
 * jadi sibling #root — bisa disembunyikan/ditampilkan mandiri saat mencetak.
 */
export default function PanduanModal({ onClose }: Props) {
  const shiftWindows = useShiftWindows(); // jam dinas dinamis per-unit (bukan hardcode)
  // Baris shift untuk tabel panduan: jam diambil dari window efektif unit.
  // Normal (Dinas Kantor) opsional — hanya tampil bila diaktifkan koordinator.
  const shiftRows = [
    { shift: 'Pagi', jam: fmtWindow(shiftWindows.pagi, ':') || '05:00 – 13:00', color: 'bg-amber-50 border-amber-200' },
    { shift: 'Siang', jam: fmtWindow(shiftWindows.siang, ':') || '12:00 – 20:00', color: 'bg-orange-50 border-orange-200' },
    ...(shiftWindows.Normal ? [{ shift: 'Normal (Dinas Kantor)', jam: fmtWindow(shiftWindows.Normal, ':')!, color: 'bg-indigo-50 border-indigo-200' }] : []),
    { shift: 'Libur / Dinas Luar / Cuti', jam: '—', color: 'bg-gray-50 border-gray-200' },
  ];

  // window.print() memicu dialog cetak browser; pengguna memilih "Simpan sebagai
  // PDF" untuk mengunduh, atau printer fisik untuk mencetak. Satu tombol, dua guna.
  const printPdf = () => window.print();

  return createPortal(
    <>
      <style>{`
        @media print {
          #root { display: none !important; }
          #panduan-portal { position: static !important; background: #fff !important; overflow: visible !important; padding: 0 !important; }
          #panduan-portal .no-print { display: none !important; }
          #panduan-portal .panduan-doc { max-width: none !important; box-shadow: none !important; border-radius: 0 !important; }
          .panduan-page { page-break-after: always; box-shadow: none !important; }
          .panduan-page:last-child { page-break-after: auto; }
          @page { size: A4; margin: 0; }
        }
      `}</style>

      <div
        id="panduan-portal"
        className="fixed inset-0 z-[300] bg-black/80 overflow-y-auto py-6 px-4 flex items-start justify-center"
        onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
        role="dialog"
        aria-modal="true"
        aria-label="Panduan Penggunaan NetWatch"
      >
        {/* Bilah aksi mengambang — tak ikut tercetak (.no-print). */}
        <div className="no-print fixed top-4 right-4 z-[310] flex gap-2">
          <button
            onClick={printPdf}
            className="flex items-center gap-2 bg-accent text-bg rounded-lg px-4 py-2 text-sm font-semibold shadow-lg hover:brightness-110 transition-all active:scale-95"
          >
            ⬇️ Unduh / Cetak PDF
          </button>
          <button
            onClick={onClose}
            className="bg-surface border border-border text-text rounded-lg px-4 py-2 text-sm font-semibold shadow-lg hover:bg-surface2 transition-colors"
          >
            ✕ Tutup
          </button>
        </div>

        <div className="panduan-doc w-full max-w-[820px] rounded-xl overflow-hidden shadow-2xl" style={{ fontFamily: 'system-ui, -apple-system, sans-serif' }}>

          {/* ═══════════ HALAMAN 1 · SAMPUL ═══════════ */}
          <Page className="items-center justify-center text-center">
            <div className="w-24 h-24 rounded-[22px] bg-gradient-to-br from-blue-600 to-cyan-500 flex items-center justify-center text-5xl mb-8 shadow-xl">📡</div>
            <div className="text-[11px] uppercase tracking-[0.32em] text-gray-400 mb-3">Panduan Penggunaan</div>
            <h1 className="text-5xl font-black text-gray-900 mb-2 tracking-tight">NetWatch <span className="text-blue-600">ERP</span></h1>
            <div className="text-lg text-gray-500 font-medium mb-6">Sistem Monitoring &amp; Manajemen Operasi Teknologi Bandara</div>
            <div className="w-16 h-0.5 bg-gradient-to-r from-blue-600 to-cyan-500 mb-6" />
            <p className="text-gray-500 text-[15px] leading-relaxed max-w-md">
              Pantau perangkat jaringan, kelola insiden &amp; pemeliharaan, catat inspeksi dan absensi, serta nilai kinerja tim — semuanya dalam satu sistem, dari desktop maupun ponsel.
            </p>
            <div className="mt-12 grid grid-cols-3 gap-3 w-full max-w-lg">
              {[
                { icon: '📡', label: 'Monitoring Real-time' },
                { icon: '⚠️', label: 'Manajemen Insiden' },
                { icon: '🛠️', label: 'Pemeliharaan Alat' },
                { icon: '📊', label: 'Skor Performa' },
                { icon: '🏢', label: 'Multi-Unit' },
                { icon: '📱', label: 'Aplikasi (PWA)' },
              ].map((f) => (
                <div key={f.label} className="border border-gray-200 rounded-xl p-3 text-center">
                  <div className="text-2xl mb-1">{f.icon}</div>
                  <div className="text-[11px] text-gray-600 font-medium">{f.label}</div>
                </div>
              ))}
            </div>
            <div className="mt-auto pt-10 w-full border-t border-gray-100 flex items-center justify-between text-[11px] text-gray-400">
              <span>NetWatch ERP</span>
              <span>Dokumen Internal — Dilarang Disebarluaskan</span>
              <span>Hal. 1</span>
            </div>
          </Page>

          {/* ═══════════ HALAMAN 2 · LOGIN, RESET PIN, PERAN ═══════════ */}
          <Page>
            <SectionTitle number="1" title="Masuk ke Sistem" />
            <p className="text-gray-600 text-sm mb-5">
              NetWatch memakai <strong>login PIN</strong> (4–6 digit) agar cepat dipakai di lapangan — tanpa mengetik username &amp; password panjang.
            </p>
            <div className="grid grid-cols-2 gap-4 mb-8">
              <InfoCard title="Login via PIN" icon="🔢" steps={[
                'Buka halaman login NetWatch',
                'Ketuk angka pada keypad atau ketik di keyboard',
                'PIN 6 digit → otomatis masuk',
                'PIN 4–5 digit → tekan ↵ untuk masuk',
              ]} />
              <InfoCard title="Lupa PIN? Reset via WhatsApp" icon="🔐" steps={[
                'Di layar login, klik "Lupa PIN? Reset via WhatsApp"',
                'Masukkan username / email / no. WhatsApp',
                'Kode OTP dikirim ke WhatsApp terdaftar',
                'Masukkan OTP lalu tetapkan PIN baru (6 digit)',
              ]} />
            </div>

            <SectionTitle number="2" title="Peran Pengguna (Role)" />
            <div className="space-y-3 mb-8">
              {[
                { role: 'Admin', icon: '👑', color: 'bg-purple-50 border-purple-200', badge: 'bg-purple-100 text-purple-700', desc: 'Akses penuh & pengaturan sistem global.', access: ['Kelola pengguna & hak akses semua unit', 'Konfigurasi perangkat, layanan & sistem', 'Beralih antar unit (super admin)', 'Semua fitur koordinator & teknisi'] },
                { role: 'Koordinator', icon: '👩‍💼', color: 'bg-blue-50 border-blue-200', badge: 'bg-blue-100 text-blue-700', desc: 'Admin untuk unitnya sendiri.', access: ['Kelola user & master data unit', 'Setujui kegiatan, cuti & diklat', 'Tanda tangan digital surat (TTE)', 'Tetapkan peserta pemeliharaan'] },
                { role: 'Teknisi', icon: '👨‍🔧', color: 'bg-green-50 border-green-200', badge: 'bg-green-100 text-green-700', desc: 'Pelaksana lapangan.', access: ['Ambil & tangani insiden dari pool', 'Inspeksi peralatan (foto kamera langsung)', 'Isi laporan kerusakan & perbaikan', 'Remote SSH ke perangkat jaringan'] },
                { role: 'Viewer', icon: '👁️', color: 'bg-gray-50 border-gray-200', badge: 'bg-gray-100 text-gray-600', desc: 'Hanya melihat, tidak mengubah data.', access: ['Pantau status perangkat real-time', 'Lihat daftar insiden & statusnya', 'Akses laporan & statistik', 'Tidak bisa membuat/mengubah data'] },
              ].map((r) => (
                <div key={r.role} className={`rounded-xl border p-4 ${r.color}`}>
                  <div className="flex items-center gap-3 mb-2">
                    <span className="text-2xl">{r.icon}</span>
                    <div>
                      <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full ${r.badge}`}>{r.role.toUpperCase()}</span>
                      <div className="text-[12px] text-gray-600 mt-0.5">{r.desc}</div>
                    </div>
                  </div>
                  <ul className="grid grid-cols-2 gap-x-4 gap-y-0.5">
                    {r.access.map((a) => (
                      <li key={a} className="text-[12px] text-gray-700 flex items-start gap-1.5"><span className="text-blue-500 mt-0.5 shrink-0">›</span>{a}</li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>

            <div className="bg-blue-50 border border-blue-200 rounded-xl p-4">
              <div className="text-[12px] font-bold text-blue-800 mb-1">🏢 Multi-Unit</div>
              <p className="text-[12px] text-blue-700 leading-relaxed">
                Sistem menaungi beberapa unit (mis. <strong>ELB</strong> — jaringan/elektronika, <strong>AAB</strong> — alat berat &amp; air/pompa). Menu &amp; data otomatis disaring sesuai unit Anda. Super admin bisa berpindah unit lewat pemilih di kanan atas.
              </p>
            </div>
            <PageFooter page={2} />
          </Page>

          {/* ═══════════ HALAMAN 3 · MONITORING & INSIDEN ═══════════ */}
          <Page>
            <SectionTitle number="3" title="Monitoring Perangkat" />
            <p className="text-gray-600 text-sm mb-4">
              Perangkat jaringan (server, switch, router, AP, CCTV, dll.) dipantau otomatis setiap <strong>15 detik</strong>. Kartu perangkat menampilkan pita status di tepi, latensi, serta meter CPU/RAM (bila SNMP aktif).
            </p>
            <div className="grid grid-cols-3 gap-3 mb-8">
              {[
                { status: 'ONLINE', color: 'bg-green-50 border-green-300 text-green-700', dot: 'bg-green-500', desc: 'Merespons ping normal. Tidak perlu tindakan.' },
                { status: 'WARNING', color: 'bg-amber-50 border-amber-300 text-amber-700', dot: 'bg-amber-500', desc: 'Latensi tinggi / beban mendekati batas. Pantau.' },
                { status: 'OFFLINE', color: 'bg-red-50 border-red-300 text-red-700', dot: 'bg-red-500', desc: 'Tidak merespons. Insiden otomatis dibuat & alarm dikirim.' },
              ].map((s) => (
                <div key={s.status} className={`rounded-xl border p-3 ${s.color}`}>
                  <div className="flex items-center gap-1.5 mb-1.5"><span className={`w-2 h-2 rounded-full ${s.dot}`} /><span className="text-[11px] font-bold">{s.status}</span></div>
                  <p className="text-[11px] leading-snug">{s.desc}</p>
                </div>
              ))}
            </div>

            <SectionTitle number="4" title="Manajemen Insiden" />
            <p className="text-gray-600 text-sm mb-4">
              Insiden terbentuk <strong>otomatis</strong> (perangkat offline) atau <strong>manual</strong> (laporan staf / QR). Insiden tak bertuan masuk <em>pool</em>; teknisi on-duty mengambilnya. Alurnya:
            </p>
            <div className="flex items-stretch mb-6 rounded-xl overflow-hidden border border-gray-200">
              {[
                { icon: '⏳', label: '0 · Belum Mulai', color: 'bg-gray-100', desc: 'Pilih: coba SSH dulu, atau langsung kunjungan ke lokasi.' },
                { icon: '🔧', label: '1 · Bongkar & Analisa', color: 'bg-orange-50', desc: 'SSH gagal / kunjungan langsung → bongkar & analisa kerusakan. Bisa "tunggu suku cadang".' },
                { icon: '✅', label: '2 · Selesai', color: 'bg-green-50', desc: 'SSH berhasil melompat langsung ke selesai; atau tutup setelah laporan perbaikan diisi.' },
              ].map((s, i, arr) => (
                <div key={s.label} className={`flex-1 p-3 ${s.color} ${i < arr.length - 1 ? 'border-r border-gray-200' : ''}`}>
                  <div className="text-xl mb-1 text-center">{s.icon}</div>
                  <div className="text-[10px] font-bold text-center text-gray-700 mb-1">{s.label}</div>
                  <div className="text-[10px] text-gray-500 text-center leading-tight">{s.desc}</div>
                </div>
              ))}
            </div>
            <div className="grid grid-cols-2 gap-4 mb-4">
              <InfoCard title="Teknisi Mengambil Insiden" icon="✋" steps={['Buka "Insiden Saya" (harus ON-DUTY)', 'Lihat pool insiden yang tersedia', 'Klik "Ambil" pada insiden', 'Perbarui progres tiap langkah', 'Isi Laporan Kerusakan & Perbaikan']} />
              <InfoCard title="Memperbarui Progres" icon="▶️" steps={['Buka detail insiden', 'Klik tombol langkah berikutnya', 'Isi keterangan tindakan', 'Upload foto dokumentasi (wajib)', 'Simpan hingga insiden selesai']} />
            </div>
            <div className="bg-blue-50 border border-blue-200 rounded-xl p-4">
              <div className="text-[12px] font-bold text-blue-800 mb-1.5">⏰ Target Waktu Tanggap (SLA)</div>
              <div className="grid grid-cols-3 gap-3 text-[11px] text-blue-700">
                <div><span className="font-bold block">🔴 KRITIS</span>Ditangani ≤ <strong>1 jam</strong></div>
                <div><span className="font-bold block">🟡 TINGGI</span>Ditangani ≤ <strong>2 jam</strong></div>
                <div><span className="font-bold block">🔵 SEDANG</span>Ditangani ≤ <strong>4 jam</strong></div>
              </div>
            </div>
            <PageFooter page={3} />
          </Page>

          {/* ═══════════ HALAMAN 4 · INSPEKSI, ABSENSI, PEMELIHARAAN ═══════════ */}
          <Page>
            <SectionTitle number="5" title="Inspeksi Peralatan" />
            <p className="text-gray-600 text-sm mb-4">
              Teknisi mencatat inspeksi fisik perangkat pada tiap hari dinas. Foto diambil <strong>langsung dari kamera</strong> (bukan galeri) dan diverifikasi lokasi GPS-nya.
            </p>
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 mb-8 text-[12px] text-amber-800">
              📸 <strong>Anti-manipulasi:</strong> foto dari galeri ditolak. Bila GPS jauh dari lokasi perangkat atau lokasi dimatikan, foto ditandai mencurigakan dan <strong>menurunkan skor performa</strong>. Menghidupkan/mematikan peralatan juga wajib foto + verifikasi.
            </div>

            <SectionTitle number="6" title="Absensi & Jadwal Shift" />
            <div className="grid grid-cols-2 gap-4 mb-8">
              <InfoCard title="Absen Masuk / Pulang" icon="📍" steps={['Buka Dashboard → kartu Absensi', 'Aktifkan lokasi GPS di perangkat', 'Klik "Absen Masuk" saat tiba', 'Wajib berada dalam radius lokasi', 'Klik "Absen Pulang" saat selesai']} />
              <div>
                <div className="font-semibold text-gray-800 text-[13px] mb-2 flex items-center gap-2">🗓️ Jenis Shift <span className="text-[10px] font-normal text-gray-400">(jam per unit)</span></div>
                <div className="space-y-2">
                  {shiftRows.map((s) => (
                    <div key={s.shift} className={`flex justify-between items-center rounded-lg border px-3 py-2 text-[12px] ${s.color}`}>
                      <span className="font-medium">{s.shift}</span>
                      <span className="text-gray-500 font-mono">{s.jam}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <SectionTitle number="7" title="Pemeliharaan (Maintenance)" />
            <p className="text-gray-600 text-sm mb-4">
              Koordinator menyusun rencana pemeliharaan bulanan per perangkat; teknisi mengeksekusi &amp; melampirkan foto dokumentasi.
            </p>
            <div className="grid grid-cols-2 gap-4">
              <InfoCard title="Menyelesaikan Tugas" icon="🛠️" steps={['Buka Performa Peralatan → tab Maintenance', 'Kerjakan tugas sesuai jadwal', 'Klik "Selesai" → wajib foto dokumentasi', 'Notifikasi terkirim ke koordinator']} />
              <div className="border border-green-200 bg-green-50 rounded-xl p-4">
                <div className="font-semibold text-green-800 text-[13px] mb-2 flex items-center gap-2">👥 Peserta Pemeliharaan</div>
                <p className="text-[12px] text-green-700 leading-relaxed">
                  Satu tugas kerap dikerjakan beberapa orang. Koordinator menekan <strong>"Atur peserta"</strong> untuk mencentang semua yang ikut. Nilai Pemeliharaan (PM) <strong>dibagi rata</strong> antar peserta — berdua berarti ½ masing-masing — sehingga kolaborasi adil dan tidak menggelembungkan skor.
                </p>
              </div>
            </div>
            <PageFooter page={4} />
          </Page>

          {/* ═══════════ HALAMAN 5 · PENILAIAN PERFORMA (PERSEN) ═══════════ */}
          <Page>
            <SectionTitle number="8" title="Penilaian Performa" />
            <p className="text-gray-600 text-sm mb-5">
              Sistem menghitung <strong>skor persen 0–100 + grade</strong> otomatis tiap bulan (rata-rata tertimbang komponen), untuk teknisi maupun koordinator. Komponen tanpa data pada bulan itu diabaikan dan bobotnya dibagi ulang.
            </p>

            <div className="grid grid-cols-2 gap-4 mb-6">
              <ScoreTable title="👨‍🔧 Teknisi" rows={[
                ['Ketepatan SLA', '35%', 'Tiket diambil ≤ batas ÷ total diambil'],
                ['Penyelesaian', '25%', 'Tiket selesai ÷ tiket diambil'],
                ['Inspeksi', '20%', 'Inspeksi ÷ jumlah hari dinas'],
                ['Pemeliharaan (PM)', '20%', 'Kredit PM (dibagi peserta) ÷ target'],
              ]} />
              <ScoreTable title="👩‍💼 Koordinator" rows={[
                ['Kecepatan Persetujuan', '30%', 'Pengajuan diputus ≤ 2 hari kerja'],
                ['Ketersediaan Alat Unit', '30%', 'Rata-rata uptime peralatan unit'],
                ['Penanganan Eskalasi', '25%', 'Insiden eskalasi selesai ÷ masuk'],
                ['Kelengkapan Dokumen', '15%', 'Dokumen sah & berlaku ÷ total'],
              ]} />
            </div>

            <div className="border border-gray-200 rounded-xl overflow-hidden mb-8">
              <div className="bg-gray-50 px-4 py-2 text-[12px] font-semibold text-gray-700 border-b border-gray-200">🏅 Skala Grade</div>
              <div className="grid grid-cols-5 divide-x divide-gray-200 text-center">
                {[
                  ['≥ 90', 'Sangat Baik', 'text-green-600'],
                  ['75–89', 'Baik', 'text-emerald-600'],
                  ['60–74', 'Cukup', 'text-amber-600'],
                  ['50–59', 'Kurang', 'text-orange-600'],
                  ['< 50', 'Perlu Pembinaan', 'text-red-600'],
                ].map(([r, g, c]) => (
                  <div key={g} className="px-2 py-3">
                    <div className={`text-[15px] font-black ${c}`}>{r}</div>
                    <div className="text-[10px] text-gray-500 mt-0.5">{g}</div>
                  </div>
                ))}
              </div>
            </div>

            <div className="bg-blue-50 border border-blue-200 rounded-xl p-4">
              <div className="text-[12px] font-bold text-blue-800 mb-1">💡 Cara menaikkan skor</div>
              <p className="text-[12px] text-blue-700 leading-relaxed">
                Ambil tiket lebih sigap saat on-duty, tuntaskan yang sudah diambil, catat inspeksi tiap hari dinas dengan foto sah, dan selesaikan tugas pemeliharaan. Halaman Performa menampilkan rincian per komponen beserta saran perbaikan yang paling berdampak.
              </p>
            </div>
            <PageFooter page={5} />
          </Page>

          {/* ═══════════ HALAMAN 6 · QR, SURAT/TTE, SKP ═══════════ */}
          <Page>
            <SectionTitle number="9" title="Pelaporan Mandiri via QR" />
            <p className="text-gray-600 text-sm mb-4">
              Staf non-IT melaporkan gangguan sendiri dengan memindai QR yang terpasang di ruangan — tanpa perlu akun.
            </p>
            <div className="grid grid-cols-2 gap-4 mb-8">
              <InfoCard title="Melapor via QR" icon="📷" steps={['Scan QR di ruangan/lokasi', 'Isi nama, unit kerja, no. HP', 'Pilih jenis & urgensi gangguan', 'Jelaskan masalah singkat', 'Kirim → insiden otomatis dibuat']} />
              <InfoCard title="Surat Keluar & TTE" icon="📄" steps={['Buka "Surat Keluar" (admin/koordinator)', 'Buat nota dinas — nomor otomatis', 'Kirim link TTD ke penanda tangan', 'Penanda tangan TTE via WhatsApp', 'Unduh PDF ber-QR verifikasi']} />
            </div>

            <SectionTitle number="10" title="SKP / e-Kinerja" />
            <p className="text-gray-600 text-sm mb-4">
              Modul SKP membantu menyusun Sasaran Kinerja: rencana hasil kerja (RHK), indikator, rencana aksi, hingga realisasi bulanan beserta bukti dukung. Realisasi bulan lalu bisa disalin ke bulan aktif untuk mempercepat pengisian.
            </p>
            <div className="grid grid-cols-3 gap-3">
              {[
                { icon: '🎯', t: 'RHK & Indikator', d: 'Susun sasaran & ukuran keberhasilan.' },
                { icon: '📅', t: 'Realisasi Bulanan', d: 'Isi capaian tiap bulan + bukti foto.' },
                { icon: '🔗', t: 'Halaman Publik', d: 'Bagikan bukti kinerja lewat tautan bertoken.' },
              ].map((c) => (
                <div key={c.t} className="border border-gray-200 rounded-xl p-4 text-center">
                  <div className="text-3xl mb-1">{c.icon}</div>
                  <div className="font-semibold text-gray-800 text-[12px]">{c.t}</div>
                  <div className="text-[11px] text-gray-500 mt-1 leading-snug">{c.d}</div>
                </div>
              ))}
            </div>
            <PageFooter page={6} />
          </Page>

          {/* ═══════════ HALAMAN 7 · MOBILE & PWA ═══════════ */}
          <Page>
            <SectionTitle number="11" title="Di Ponsel: Aplikasi & Navigasi" />
            <p className="text-gray-600 text-sm mb-5">
              NetWatch dirancang nyaman di ponsel. Di layar kecil muncul <strong>bilah navigasi bawah</strong>: dua pintasan di kiri, tombol <strong>Layanan</strong> yang menonjol di tengah (membuka seluruh menu), dua pintasan di kanan, serta tombol <strong>Insiden</strong> mengambang yang menampilkan jumlah antrean dari halaman mana pun.
            </p>
            <div className="grid grid-cols-2 gap-4 mb-8">
              <InfoCard title="Pasang di Android (Chrome/Edge)" icon="🤖" steps={['Buka NetWatch di Chrome/Edge', 'Muncul banner "Pasang" — atau menu ⋮ → "Tambahkan ke Layar Utama"', 'Konfirmasi → ikon muncul di home screen', 'Buka seperti aplikasi biasa, layar penuh']} />
              <InfoCard title="Pasang di iPhone/iPad (Safari)" icon="🍎" steps={['Buka NetWatch di Safari (wajib Safari)', 'Ketuk tombol Bagikan di bar bawah', 'Pilih "Tambah ke Layar Utama"', 'Ketuk "Tambah" → ikon muncul di home screen']} />
            </div>
            <div className="bg-gradient-to-br from-blue-50 to-cyan-50 border border-blue-200 rounded-xl p-5">
              <div className="font-bold text-blue-900 text-[14px] mb-2">💡 Catatan Aplikasi</div>
              <ul className="text-[12px] text-blue-700 leading-relaxed space-y-1 list-disc pl-4">
                <li>Setelah terpasang, semua alur (absen, ambil insiden, inspeksi) sama seperti versi web.</li>
                <li>Pembaruan berjalan otomatis di latar — tidak perlu instal ulang.</li>
                <li>Data real-time tetap butuh internet aktif; tampilan dasar tersedia singkat saat sinyal terputus.</li>
              </ul>
            </div>
            <PageFooter page={7} />
          </Page>

          {/* ═══════════ HALAMAN 8 · REFERENSI & BANTUAN ═══════════ */}
          <Page>
            <SectionTitle number="12" title="Referensi Cepat" />
            <div className="border border-gray-200 rounded-xl p-4 mb-8">
              <div className="font-semibold text-gray-800 text-[13px] mb-3">🗺️ Peta Menu Utama</div>
              <div className="grid grid-cols-2 gap-x-8 gap-y-1.5">
                {[
                  { menu: 'Dashboard', role: 'Admin / Koordinator' },
                  { menu: 'Dashboard Saya', role: 'Teknisi' },
                  { menu: 'Live Monitor', role: 'Semua' },
                  { menu: 'Perangkat', role: 'Admin / Koord.' },
                  { menu: 'Insiden / Insiden Saya', role: 'Manajer / Teknisi' },
                  { menu: 'Performa Peralatan', role: 'Semua' },
                  { menu: 'Jadwal Dinas', role: 'Semua' },
                  { menu: 'Performa Teknisi', role: 'Admin / Koord.' },
                  { menu: 'Absensi', role: 'Semua' },
                  { menu: 'SKP / e-Kinerja', role: 'Koord. / Teknisi' },
                  { menu: 'Surat Keluar', role: 'Admin / Koord.' },
                  { menu: 'Manajemen User', role: 'Admin / Koord.' },
                ].map((m) => (
                  <div key={m.menu} className="flex items-center justify-between text-[11px] border-b border-gray-100 pb-1">
                    <span className="text-gray-700">{m.menu}</span>
                    <span className="text-gray-400">{m.role}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="bg-gradient-to-br from-blue-50 to-cyan-50 border border-blue-200 rounded-xl p-5 mb-8">
              <div className="font-bold text-blue-900 text-[14px] mb-2">📞 Butuh Bantuan?</div>
              <p className="text-[12px] text-blue-700 leading-relaxed">
                Kendala teknis, kesulitan login, atau menemukan bug? Hubungi <strong>Administrator NetWatch</strong> lewat WhatsApp atau langsung ke Tim IT unit Anda.
              </p>
              <p className="text-[11px] text-blue-500 mt-2">
                Lupa PIN &amp; terkunci? Gunakan <strong>"Reset PIN via WhatsApp"</strong> di layar login, atau minta admin menyetel ulang PIN dari menu Manajemen User.
              </p>
            </div>

            <div className="text-center text-[11px] text-gray-400 pt-4">
              — Terima kasih telah menggunakan NetWatch ERP —
            </div>
            <PageFooter page={8} last />
          </Page>
        </div>
      </div>
    </>,
    document.body
  );
}

// Satu halaman dokumen (rasio ± A4). Latar putih tetap, tak ikut tema aplikasi,
// agar hasil cetak konsisten.
function Page({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <div className="panduan-page bg-white text-gray-900 min-h-[1120px] flex flex-col">
      <div className="h-2 bg-gradient-to-r from-blue-600 to-cyan-500" />
      <div className={`flex-1 flex flex-col px-12 py-10 ${className}`}>{children}</div>
    </div>
  );
}

function SectionTitle({ number, title }: { number: string; title: string }) {
  return (
    <div className="flex items-center gap-3 mb-4">
      <div className="w-7 h-7 rounded-lg bg-blue-600 text-white text-[13px] font-black flex items-center justify-center shrink-0">{number}</div>
      <h2 className="text-[18px] font-bold text-gray-900">{title}</h2>
      <div className="flex-1 h-px bg-gray-200" />
    </div>
  );
}

function InfoCard({ title, icon, steps }: { title: string; icon: string; steps: string[] }) {
  return (
    <div className="border border-gray-200 rounded-xl p-4">
      <div className="font-semibold text-gray-800 text-[13px] mb-2.5 flex items-center gap-2"><span>{icon}</span>{title}</div>
      <ol className="space-y-1.5">
        {steps.map((s, i) => (
          <li key={i} className="text-[12px] text-gray-600 flex items-start gap-2">
            <span className="w-4 h-4 rounded-full bg-blue-100 text-blue-700 text-[10px] font-bold flex items-center justify-center shrink-0 mt-0.5">{i + 1}</span>{s}
          </li>
        ))}
      </ol>
    </div>
  );
}

function ScoreTable({ title, rows }: { title: string; rows: [string, string, string][] }) {
  return (
    <div className="border border-gray-200 rounded-xl overflow-hidden">
      <div className="bg-gray-50 px-4 py-2 text-[13px] font-semibold text-gray-800 border-b border-gray-200">{title}</div>
      <table className="w-full text-[11px]">
        <tbody>
          {rows.map(([k, w, d], i) => (
            <tr key={k} className={i % 2 ? 'bg-gray-50/60' : ''}>
              <td className="px-3 py-2 text-gray-800 font-medium align-top">{k}</td>
              <td className="px-2 py-2 text-blue-600 font-bold text-center align-top whitespace-nowrap">{w}</td>
              <td className="px-3 py-2 text-gray-500 align-top">{d}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function PageFooter({ page, last }: { page: number; last?: boolean }) {
  return (
    <div className="mt-auto pt-6 border-t border-gray-100 flex items-center justify-between text-[10px] text-gray-400">
      <span>NetWatch ERP · Panduan Penggunaan</span>
      <span className="text-gray-300">— {page} —</span>
      <span>{last ? 'Akhir Dokumen' : `Lanjut ke hal. ${page + 1}`}</span>
    </div>
  );
}
