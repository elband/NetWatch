import { useShiftWindows, fmtWindow } from '../utils/shifts';

interface Props {
  onClose: () => void;
}

export default function PanduanModal({ onClose }: Props) {
  const shiftWindows = useShiftWindows(); // jam dinas dinamis per-unit
  // Baris shift untuk tabel panduan: jam diambil dari window efektif unit (bukan hardcode).
  // Normal (Dinas Kantor) opsional — hanya tampil bila diaktifkan koordinator.
  const shiftRows = [
    { shift: 'Pagi', jam: fmtWindow(shiftWindows.pagi, ':') || '05:00 – 13:00', color: 'bg-yellow-50 border-yellow-200' },
    { shift: 'Siang', jam: fmtWindow(shiftWindows.siang, ':') || '12:00 – 20:00', color: 'bg-orange-50 border-orange-200' },
    ...(shiftWindows.Normal ? [{ shift: 'Normal (Dinas Kantor)', jam: fmtWindow(shiftWindows.Normal, ':')!, color: 'bg-indigo-50 border-indigo-200' }] : []),
    { shift: 'Libur / Dinas Luar / Cuti', jam: '—', color: 'bg-gray-50 border-gray-200' },
  ];

  function printPdf() {
    window.print();
  }

  return (
    <>
      {/* Print-only: hide everything except modal content */}
      <style>{`
        @media print {
          body > * { display: none !important; }
          #panduan-print-root { display: block !important; }
          #panduan-print-root .no-print { display: none !important; }
          #panduan-print-root { position: static !important; background: white !important; }
          .panduan-page { page-break-after: always; }
          .panduan-page:last-child { page-break-after: auto; }
        }
      `}</style>

      <div
        id="panduan-print-root"
        className="fixed inset-0 z-[300] bg-black/80 flex items-start justify-center overflow-y-auto py-6 px-4"
        onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      >
        {/* Floating action bar */}
        <div className="no-print fixed top-4 right-4 z-[310] flex gap-2">
          <button
            onClick={printPdf}
            className="flex items-center gap-2 bg-accent text-bg rounded-lg px-4 py-2 text-sm font-semibold shadow-lg hover:bg-accent/90 transition-colors"
          >
            🖨️ Download / Print PDF
          </button>
          <button
            onClick={onClose}
            className="bg-surface border border-border text-text rounded-lg px-4 py-2 text-sm font-semibold shadow-lg hover:bg-surface2 transition-colors"
          >
            ✕ Tutup
          </button>
        </div>

        {/* Document */}
        <div className="w-full max-w-[800px] space-y-0 rounded-xl overflow-hidden shadow-2xl" style={{ fontFamily: 'system-ui, -apple-system, sans-serif' }}>

          {/* ── HALAMAN 1: COVER ── */}
          <div className="panduan-page bg-white text-gray-900 min-h-[1040px] flex flex-col">
            {/* Top accent bar */}
            <div className="h-2 bg-gradient-to-r from-blue-600 to-cyan-500" />

            <div className="flex-1 flex flex-col items-center justify-center px-12 py-16 text-center">
              {/* Logo / Icon */}
              <div className="w-24 h-24 rounded-2xl bg-gradient-to-br from-blue-600 to-cyan-500 flex items-center justify-center text-5xl mb-8 shadow-xl">
                📡
              </div>

              <div className="text-[11px] uppercase tracking-[0.3em] text-gray-400 mb-3">Panduan Penggunaan</div>
              <h1 className="text-5xl font-black text-gray-900 mb-2 tracking-tight">NetWatch ERP</h1>
              <div className="text-xl text-blue-600 font-semibold mb-6">Enterprise Resource Planning for Airport Technology Operations</div>

              <div className="w-16 h-0.5 bg-gradient-to-r from-blue-600 to-cyan-500 mx-auto mb-6" />

              <p className="text-gray-500 text-[15px] leading-relaxed max-w-md">
                Sistem informasi terpadu untuk monitoring infrastruktur jaringan, manajemen insiden, dan pengelolaan kinerja teknisi.
              </p>

              {/* Feature highlights */}
              <div className="mt-12 grid grid-cols-3 gap-4 w-full max-w-lg">
                {[
                  { icon: '📡', label: 'Monitoring Real-time' },
                  { icon: '🚨', label: 'Manajemen Insiden' },
                  { icon: '📊', label: 'Analitik Performa' },
                  { icon: '📝', label: 'Laporan Digital' },
                  { icon: '👥', label: 'Manajemen Tim' },
                  { icon: '🔐', label: 'Login via PIN' },
                ].map((f) => (
                  <div key={f.label} className="border border-gray-200 rounded-xl p-3 text-center">
                    <div className="text-2xl mb-1">{f.icon}</div>
                    <div className="text-[11px] text-gray-600 font-medium">{f.label}</div>
                  </div>
                ))}
              </div>
            </div>

            {/* Footer */}
            <div className="px-12 py-6 border-t border-gray-100 flex items-center justify-between text-[11px] text-gray-400">
              <span>NetWatch ERP · v2.0</span>
              <span>Dokumen Internal — Dilarang Disebarluaskan</span>
              <span>Hal. 1</span>
            </div>
          </div>

          {/* ── HALAMAN 2: LOGIN & PERAN PENGGUNA ── */}
          <div className="panduan-page bg-white text-gray-900 min-h-[1040px] flex flex-col">
            <div className="h-2 bg-gradient-to-r from-blue-600 to-cyan-500" />
            <div className="flex-1 px-12 py-10">
              <SectionTitle number="1" title="Cara Login" />

              <p className="text-gray-600 text-sm mb-5">
                NetWatch menggunakan sistem login berbasis <strong>PIN</strong> (4–6 digit) untuk kemudahan akses di lapangan. Tidak perlu mengetik username atau password panjang.
              </p>

              <div className="grid grid-cols-2 gap-4 mb-8">
                <InfoCard
                  title="Login via PIN"
                  icon="🔢"
                  steps={[
                    'Buka halaman login NetWatch',
                    'Ketuk angka pada keypad atau gunakan keyboard fisik',
                    'PIN 6 digit → otomatis masuk',
                    'PIN 4-5 digit → tekan ↵ untuk konfirmasi',
                  ]}
                />
                <InfoCard
                  title="Tips Keamanan"
                  icon="🔐"
                  steps={[
                    'Jangan bagikan PIN kepada siapa pun',
                    'Gunakan PIN yang unik, bukan tanggal lahir',
                    'Hubungi admin jika PIN terkunci',
                    'Logout setelah selesai di komputer bersama',
                  ]}
                />
              </div>

              <SectionTitle number="2" title="Peran Pengguna (Role)" />

              <div className="space-y-3">
                {[
                  {
                    role: 'Admin', icon: '👑', color: 'bg-purple-50 border-purple-200',
                    badge: 'bg-purple-100 text-purple-700',
                    desc: 'Akses penuh ke seluruh sistem.',
                    access: ['Kelola pengguna & hak akses', 'Konfigurasi perangkat & layanan', 'Semua fitur koordinator & teknisi', 'Pengaturan sistem global'],
                  },
                  {
                    role: 'Koordinator', icon: '👩‍💼', color: 'bg-blue-50 border-blue-200',
                    badge: 'bg-blue-100 text-blue-700',
                    desc: 'Mengawasi tim dan eskalasi insiden.',
                    access: ['Pantau semua insiden & eskalasi', 'Setujui kegiatan & pengajuan diklat', 'Tanda tangan digital surat keluar', 'Laporan bulanan & analitik tim'],
                  },
                  {
                    role: 'Teknisi', icon: '👨‍🔧', color: 'bg-green-50 border-green-200',
                    badge: 'bg-green-100 text-green-700',
                    desc: 'Menangani insiden dan inspeksi lapangan.',
                    access: ['Ambil & tangani insiden dari pool', 'Inspeksi peralatan 3x/hari', 'Isi laporan kerusakan & perbaikan', 'Remote SSH ke perangkat jaringan'],
                  },
                  {
                    role: 'Viewer', icon: '👁️', color: 'bg-gray-50 border-gray-200',
                    badge: 'bg-gray-100 text-gray-600',
                    desc: 'Hanya bisa melihat, tidak bisa mengubah data.',
                    access: ['Pantau status perangkat real-time', 'Lihat daftar insiden & statusnya', 'Akses laporan & statistik', 'Tidak bisa membuat/mengubah data'],
                  },
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
                        <li key={a} className="text-[12px] text-gray-700 flex items-start gap-1.5">
                          <span className="text-blue-500 mt-0.5 flex-shrink-0">›</span>{a}
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            </div>
            <PageFooter page={2} />
          </div>

          {/* ── HALAMAN 3: MONITORING & INSIDEN ── */}
          <div className="panduan-page bg-white text-gray-900 min-h-[1040px] flex flex-col">
            <div className="h-2 bg-gradient-to-r from-blue-600 to-cyan-500" />
            <div className="flex-1 px-12 py-10">

              <SectionTitle number="3" title="Monitoring Perangkat" />
              <p className="text-gray-600 text-sm mb-4">
                NetWatch memantau perangkat jaringan (server, switch, router, AP, CCTV, dll.) secara otomatis setiap <strong>15 detik</strong>.
              </p>
              <div className="grid grid-cols-3 gap-3 mb-8">
                {[
                  { status: 'ONLINE', color: 'bg-green-50 border-green-300 text-green-700', dot: 'bg-green-500', desc: 'Perangkat merespons ping normal. Tidak ada tindakan diperlukan.' },
                  { status: 'WARNING', color: 'bg-yellow-50 border-yellow-300 text-yellow-700', dot: 'bg-yellow-500', desc: 'Latensi tinggi atau CPU/memori mendekati batas. Perlu dipantau.' },
                  { status: 'OFFLINE', color: 'bg-red-50 border-red-300 text-red-700', dot: 'bg-red-500', desc: 'Perangkat tidak merespons. Insiden otomatis dibuat & notifikasi dikirim.' },
                ].map((s) => (
                  <div key={s.status} className={`rounded-xl border p-3 ${s.color}`}>
                    <div className="flex items-center gap-1.5 mb-1.5">
                      <span className={`w-2 h-2 rounded-full ${s.dot}`} />
                      <span className="text-[11px] font-bold">{s.status}</span>
                    </div>
                    <p className="text-[11px] leading-snug">{s.desc}</p>
                  </div>
                ))}
              </div>

              <SectionTitle number="4" title="Manajemen Insiden" />
              <p className="text-gray-600 text-sm mb-4">
                Insiden bisa terbentuk <strong>otomatis</strong> (perangkat offline) atau <strong>manual</strong> (laporan staf/QR). Alur penanganan mengikuti langkah berikut:
              </p>

              {/* Step flow */}
              <div className="flex items-stretch gap-0 mb-6 rounded-xl overflow-hidden border border-gray-200">
                {[
                  { step: '0', label: 'Mulai', color: 'bg-gray-100', icon: '⏳', desc: 'Pilih: Coba SSH dulu, atau langsung kunjungan ke lokasi.' },
                  { step: '1', label: 'Bongkar & Analisa', color: 'bg-orange-50', icon: '🔧', desc: 'SSH gagal / kunjungan langsung → bongkar & analisa kerusakan di lokasi.' },
                  { step: '2', label: 'Selesai', color: 'bg-green-50', icon: '✅', desc: 'SSH berhasil → langsung selesai. Atau setelah laporan kerusakan diisi: tutup / tunggu sparepart.' },
                ].map((s, idx, arr) => (
                  <div key={s.step} className={`flex-1 p-3 ${s.color} ${idx < arr.length - 1 ? 'border-r border-gray-200' : ''}`}>
                    <div className="text-xl mb-1 text-center">{s.icon}</div>
                    <div className="text-[10px] font-bold text-center text-gray-700 mb-1">{s.label}</div>
                    <div className="text-[10px] text-gray-500 text-center leading-tight">{s.desc}</div>
                  </div>
                ))}
              </div>

              <div className="grid grid-cols-2 gap-4 mb-4">
                <InfoCard
                  title="Cara Teknisi Mengambil Insiden"
                  icon="✋"
                  steps={[
                    'Buka menu "Insiden Saya"',
                    'Pastikan status ON-DUTY (jadwal aktif)',
                    'Lihat pool insiden yang tersedia',
                    'Klik tombol "Ambil" pada insiden',
                    'Update progres tiap langkah penanganan',
                    'Isi Laporan Kerusakan & Perbaikan saat selesai',
                  ]}
                />
                <InfoCard
                  title="Cara Memperbarui Progres"
                  icon="▶️"
                  steps={[
                    'Buka detail insiden (klik "Detail →")',
                    'Klik tombol langkah berikutnya',
                    'Isi keterangan tindakan yang dilakukan',
                    'Upload foto dokumentasi (wajib)',
                    'Klik "Simpan" untuk menyimpan progres',
                    'Ulangi hingga insiden selesai',
                  ]}
                />
              </div>

              <div className="bg-blue-50 border border-blue-200 rounded-xl p-4">
                <div className="text-[12px] font-bold text-blue-800 mb-1.5">⏰ SLA (Service Level Agreement)</div>
                <div className="grid grid-cols-3 gap-3 text-[11px] text-blue-700">
                  <div><span className="font-bold block">🔴 KRITIS</span>Harus ditangani dalam <strong>1 jam</strong></div>
                  <div><span className="font-bold block">🟡 TINGGI</span>Harus ditangani dalam <strong>2 jam</strong></div>
                  <div><span className="font-bold block">🔵 SEDANG</span>Harus ditangani dalam <strong>4 jam</strong></div>
                </div>
              </div>
            </div>
            <PageFooter page={3} />
          </div>

          {/* ── HALAMAN 4: FITUR LANJUTAN ── */}
          <div className="panduan-page bg-white text-gray-900 min-h-[1040px] flex flex-col">
            <div className="h-2 bg-gradient-to-r from-blue-600 to-cyan-500" />
            <div className="flex-1 px-12 py-10">

              <SectionTitle number="5" title="Inspeksi Peralatan" />
              <p className="text-gray-600 text-sm mb-4">
                Teknisi wajib melakukan inspeksi fisik perangkat jaringan <strong>3 kali sehari</strong> pada slot waktu yang ditentukan.
              </p>
              <div className="grid grid-cols-3 gap-3 mb-8">
                {[
                  { slot: '09:00', label: 'Pagi', icon: '🌅', desc: 'Inspeksi awal hari kerja. Pastikan semua perangkat normal.' },
                  { slot: '12:00', label: 'Siang', icon: '☀️', desc: 'Inspeksi tengah hari. Cek kondisi thermal & beban jaringan.' },
                  { slot: '15:00', label: 'Sore', icon: '🌆', desc: 'Inspeksi akhir shift. Dokumentasi kondisi sebelum handover.' },
                ].map((s) => (
                  <div key={s.slot} className="border border-gray-200 rounded-xl p-4 text-center">
                    <div className="text-3xl mb-2">{s.icon}</div>
                    <div className="font-bold text-gray-900 text-lg">{s.slot}</div>
                    <div className="text-[11px] font-medium text-gray-500 mb-2">{s.label}</div>
                    <div className="text-[11px] text-gray-500 leading-snug">{s.desc}</div>
                  </div>
                ))}
              </div>
              <div className="bg-yellow-50 border border-yellow-200 rounded-xl p-3 mb-8 text-[12px] text-yellow-800">
                📸 <strong>Foto wajib</strong> diupload saat inspeksi. Sistem memverifikasi lokasi GPS untuk memastikan inspeksi dilakukan di lokasi yang benar.
              </div>

              <SectionTitle number="6" title="Absensi & Jadwal Shift" />
              <div className="grid grid-cols-2 gap-4 mb-8">
                <InfoCard
                  title="Check-In Absensi"
                  icon="📍"
                  steps={[
                    'Buka menu "Absensi" di dashboard',
                    'Aktifkan lokasi GPS di perangkat',
                    'Klik "Check In" saat tiba di kantor',
                    'Pastikan berada dalam radius lokasi',
                    'Klik "Check Out" saat pulang',
                  ]}
                />
                <div>
                  <div className="font-semibold text-gray-800 text-[13px] mb-2 flex items-center gap-2">🗓️ Jenis Shift</div>
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

              <SectionTitle number="7" title="Pelaporan via QR Code" />
              <p className="text-gray-600 text-sm mb-3">
                Staf non-IT dapat melaporkan gangguan perangkat secara mandiri dengan memindai QR code yang terpasang di setiap ruangan.
              </p>
              <div className="grid grid-cols-2 gap-4">
                <InfoCard
                  title="Cara Melaporkan via QR"
                  icon="📷"
                  steps={[
                    'Scan QR code di ruangan/lokasi',
                    'Isi form: nama, unit kerja, HP',
                    'Pilih jenis & urgensi gangguan',
                    'Jelaskan masalah secara singkat',
                    'Submit → insiden otomatis dibuat',
                    'Tim IT akan menghubungi Anda',
                  ]}
                />
                <InfoCard
                  title="Surat Keluar & TTE"
                  icon="📄"
                  steps={[
                    'Admin/Koordinator buka "Surat Keluar"',
                    'Buat nota dinas baru',
                    'Sistem generate nomor surat otomatis',
                    'Kirim link TTD ke Kasi via WhatsApp',
                    'Kasi tanda tangan digital (TTE)',
                    'Download PDF dengan QR verifikasi',
                  ]}
                />
              </div>
            </div>
            <PageFooter page={4} />
          </div>

          {/* ── HALAMAN 5: REFERENSI CEPAT ── */}
          <div className="panduan-page bg-white text-gray-900 min-h-[1040px] flex flex-col">
            <div className="h-2 bg-gradient-to-r from-blue-600 to-cyan-500" />
            <div className="flex-1 px-12 py-10">

              <SectionTitle number="8" title="Performa & Penilaian Teknisi" />
              <p className="text-gray-600 text-sm mb-4">
                Sistem menghitung skor performa otomatis setiap bulan berdasarkan aktivitas masing-masing teknisi.
              </p>
              <div className="border border-gray-200 rounded-xl overflow-hidden mb-8">
                <table className="w-full text-[12px]">
                  <thead>
                    <tr className="bg-gray-50 border-b border-gray-200">
                      <th className="text-left px-4 py-2.5 font-semibold text-gray-700">Aktivitas</th>
                      <th className="text-center px-4 py-2.5 font-semibold text-gray-700">Poin</th>
                      <th className="text-left px-4 py-2.5 font-semibold text-gray-700">Keterangan</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[
                      { act: 'Selesaikan insiden', poin: '+2', note: 'Per insiden yang ditutup' },
                      { act: 'Tepat SLA', poin: '+4', note: 'Insiden selesai sebelum batas waktu' },
                      { act: 'Insiden kritis', poin: '+6', note: 'Tambahan untuk prioritas KRITIS' },
                      { act: 'Inspeksi peralatan', poin: '+3', note: 'Per slot inspeksi yang dilakukan' },
                      { act: 'Upload foto dokumentasi', poin: '+5', note: 'Laporan dilengkapi foto bukti' },
                      { act: 'Langgar SLA', poin: '−10', note: 'Insiden on-duty tidak diambil dalam batas SLA' },
                      { act: 'Eskalasi ke koordinator', poin: '−5', note: 'Insiden harus dieskalasi karena telat' },
                      { act: 'Absen (alpa)', poin: '−15', note: 'Hanya jika dikonfirmasi koordinator' },
                    ].map((r, i) => (
                      <tr key={r.act} className={i % 2 === 0 ? '' : 'bg-gray-50'}>
                        <td className="px-4 py-2 text-gray-800">{r.act}</td>
                        <td className={`px-4 py-2 text-center font-bold ${r.poin.startsWith('+') ? 'text-green-600' : 'text-red-600'}`}>{r.poin}</td>
                        <td className="px-4 py-2 text-gray-500">{r.note}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <SectionTitle number="9" title="Referensi Cepat" />
              <div className="grid grid-cols-1 gap-4 mb-6">
                <div className="border border-gray-200 rounded-xl p-4">
                  <div className="font-semibold text-gray-800 text-[13px] mb-3">🗺️ Peta Menu Utama</div>
                  <div className="space-y-1.5">
                    {[
                      { menu: 'Dashboard', role: 'Admin / Koordinator' },
                      { menu: 'Dasbor Saya', role: 'Teknisi' },
                      { menu: 'Monitor', role: 'Semua' },
                      { menu: 'Perangkat', role: 'Admin / Koordinator' },
                      { menu: 'Insiden', role: 'Admin / Koordinator' },
                      { menu: 'Insiden Saya', role: 'Teknisi' },
                      { menu: 'Inspeksi', role: 'Teknisi' },
                      { menu: 'Jadwal', role: 'Admin / Koordinator' },
                      { menu: 'Performa', role: 'Admin / Koordinator' },
                      { menu: 'Absensi', role: 'Semua' },
                    ].map((m) => (
                      <div key={m.menu} className="flex items-center justify-between text-[11px]">
                        <span className="text-gray-700">{m.menu}</span>
                        <span className="text-gray-400">{m.role}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              {/* Contact & support */}
              <div className="bg-gradient-to-br from-blue-50 to-cyan-50 border border-blue-200 rounded-xl p-5">
                <div className="font-bold text-blue-900 text-[14px] mb-2">📞 Butuh Bantuan?</div>
                <p className="text-[12px] text-blue-700 leading-relaxed">
                  Jika mengalami kendala teknis, kesulitan login, atau menemukan bug pada sistem, segera hubungi <strong>Administrator NetWatch</strong> melalui WhatsApp atau secara langsung ke Tim IT.
                </p>
                <p className="text-[11px] text-blue-500 mt-2">
                  Untuk reset PIN: Admin → menu Pengguna → pilih akun → Edit → ubah PIN.
                </p>
              </div>
            </div>
            <PageFooter page={5} />
          </div>

          {/* ── HALAMAN 6: INSTAL SEBAGAI APLIKASI (PWA) ── */}
          <div className="panduan-page bg-white text-gray-900 min-h-[1040px] flex flex-col">
            <div className="h-2 bg-gradient-to-r from-blue-600 to-cyan-500" />
            <div className="flex-1 px-12 py-10">
              <SectionTitle number="10" title="Instal sebagai Aplikasi (PWA)" />
              <p className="text-gray-600 text-sm mb-6">
                NetWatch ERP bisa dipasang seperti aplikasi native di HP/laptop — muncul ikon di home screen, bisa dibuka tanpa membuka browser, dan tetap bisa membuka tampilan dasar walau koneksi internet putus sebentar.
              </p>
              <div className="grid grid-cols-2 gap-4 mb-6">
                <InfoCard
                  title="Chrome / Edge (Android & Desktop)"
                  icon="🤖"
                  steps={[
                    'Buka NetWatch ERP di browser Chrome atau Edge.',
                    'Klik ikon "Install" (⊕) di address bar, atau buka menu ⋮ → "Tambahkan ke Layar Utama" / "Install app".',
                    'Konfirmasi "Install" — ikon NetWatch akan muncul di home screen / desktop seperti aplikasi biasa.',
                  ]}
                />
                <InfoCard
                  title="Safari (iPhone / iPad)"
                  icon="🍎"
                  steps={[
                    'Buka NetWatch ERP di Safari (wajib Safari, bukan Chrome di iOS).',
                    'Ketuk ikon Share (kotak dengan tanda panah ke atas) di bar bawah.',
                    'Pilih "Add to Home Screen" / "Tambah ke Layar Utama", lalu ketuk "Tambah".',
                  ]}
                />
              </div>
              <div className="bg-gradient-to-br from-blue-50 to-cyan-50 border border-blue-200 rounded-xl p-5">
                <div className="font-bold text-blue-900 text-[14px] mb-2">💡 Catatan</div>
                <ul className="text-[12px] text-blue-700 leading-relaxed space-y-1 list-disc pl-4">
                  <li>Setelah terinstal, notifikasi & alur kerja (absen, ambil insiden, dsb.) tetap sama seperti versi web.</li>
                  <li>Update aplikasi berjalan otomatis di belakang layar setiap kali ada versi baru — tidak perlu instal ulang.</li>
                  <li>Data insiden/perangkat tetap butuh koneksi internet aktif (real-time), hanya tampilan dasar yang tersedia singkat saat offline.</li>
                </ul>
              </div>
            </div>
            <PageFooter page={6} last />
          </div>
        </div>
      </div>
    </>
  );
}

function SectionTitle({ number, title }: { number: string; title: string }) {
  return (
    <div className="flex items-center gap-3 mb-4">
      <div className="w-7 h-7 rounded-lg bg-blue-600 text-white text-[13px] font-black flex items-center justify-center flex-shrink-0">{number}</div>
      <h2 className="text-[18px] font-bold text-gray-900">{title}</h2>
      <div className="flex-1 h-px bg-gray-200" />
    </div>
  );
}

function InfoCard({ title, icon, steps }: { title: string; icon: string; steps: string[] }) {
  return (
    <div className="border border-gray-200 rounded-xl p-4">
      <div className="font-semibold text-gray-800 text-[13px] mb-2.5 flex items-center gap-2">
        <span>{icon}</span>{title}
      </div>
      <ol className="space-y-1.5">
        {steps.map((s, i) => (
          <li key={i} className="text-[12px] text-gray-600 flex items-start gap-2">
            <span className="w-4 h-4 rounded-full bg-blue-100 text-blue-700 text-[10px] font-bold flex items-center justify-center flex-shrink-0 mt-0.5">{i + 1}</span>
            {s}
          </li>
        ))}
      </ol>
    </div>
  );
}

function PageFooter({ page, last }: { page: number; last?: boolean }) {
  return (
    <div className="px-12 py-4 border-t border-gray-100 flex items-center justify-between text-[10px] text-gray-400">
      <span>NetWatch ERP · Panduan Penggunaan</span>
      <span className="text-gray-300">— {page} —</span>
      <span>{last ? 'Akhir Dokumen' : `Lanjut ke hal. ${page + 1}`}</span>
    </div>
  );
}
