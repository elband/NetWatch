import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import PanduanModal from '../components/PanduanModal';

const QUICK_LOGINS = [
  { label: 'Admin', pin: '222222', emoji: '👑' },
  { label: 'Teknisi (Okta)', pin: '333333', emoji: '🔧' },
  { label: 'Teknisi (Alex)', pin: '444444', emoji: '🔧' },
  { label: 'Viewer', pin: '777777', emoji: '👁️' },
];

const HIGHLIGHTS = [
  { icon: '📡', title: 'Monitoring Real-time', desc: 'Pantau status & latency perangkat jaringan secara langsung.' },
  { icon: '🚨', title: 'Manajemen Insiden', desc: 'Lacak insiden hingga laporan kerusakan & perbaikan.' },
  { icon: '📊', title: 'Analitik Performa', desc: 'Skor & SLA teknisi dalam satu dasbor terpadu.' },
];

const MAX_PIN = 6;

export default function Login() {
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [showPanduan, setShowPanduan] = useState(false);
  const { loginPin } = useAuth();
  const navigate = useNavigate();

  async function submit(value: string) {
    if (value.length < 4 || loading) return;
    try {
      setError('');
      setLoading(true);
      await loginPin(value);
      navigate('/');
    } catch (e: any) {
      setError(e?.response?.data?.error || 'PIN salah atau tidak terdaftar.');
      setPin('');
    } finally {
      setLoading(false);
    }
  }

  function press(d: string) {
    setError('');
    setPin((p) => {
      if (p.length >= MAX_PIN) return p;
      const next = p + d;
      if (next.length === MAX_PIN) submit(next); // auto-submit di 6 digit
      return next;
    });
  }
  function backspace() { setError(''); setPin((p) => p.slice(0, -1)); }

  // Dukungan keyboard fisik.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key >= '0' && e.key <= '9') press(e.key);
      else if (e.key === 'Backspace') backspace();
      else if (e.key === 'Enter') submit(pin);
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [pin, loading]);

  return (
    <div className="relative min-h-screen overflow-hidden bg-bg flex items-center justify-center p-4">
      <div className="absolute inset-0 login-grid opacity-60" />
      <div className="absolute -top-32 -left-24 w-[420px] h-[420px] rounded-full bg-accent/20 blur-[120px] login-blob" />
      <div className="absolute -bottom-40 -right-20 w-[460px] h-[460px] rounded-full bg-accent2/20 blur-[130px] login-blob" style={{ animationDelay: '-6s' }} />
      <div className="absolute inset-0 bg-gradient-to-t from-bg via-transparent to-bg/40 pointer-events-none" />

      <div className="login-card relative z-10 w-full max-w-[920px] grid md:grid-cols-2 rounded-2xl overflow-hidden border border-border shadow-2xl shadow-black/50 backdrop-blur-xl">
        {/* Left — brand */}
        <div className="hidden md:flex flex-col justify-between p-10 bg-gradient-to-br from-surface/90 to-surface2/70 relative">
          <div className="absolute top-0 left-0 right-0 h-px overflow-hidden">
            <div className="login-sweep h-full w-1/3 bg-gradient-to-r from-transparent via-accent to-transparent" />
          </div>
          <div>
            <div className="flex items-center gap-3 mb-1">
              <div className="w-12 h-12 rounded-xl flex items-center justify-center text-2xl bg-gradient-to-br from-accent to-accent2 shadow-lg shadow-accent/30">📡</div>
              <div>
                <div className="text-xl font-extrabold tracking-tight">NetWatch <span className="text-accent">ERP</span></div>
                <div className="text-[10px] text-text2 uppercase tracking-[0.2em]">Enterprise Resource Planning for Airport Technology Operations</div>
              </div>
            </div>
            <div className="mt-9 space-y-4">
              {HIGHLIGHTS.map((h) => (
                <div key={h.title} className="flex items-start gap-3">
                  <div className="w-9 h-9 rounded-lg bg-surface2 border border-border flex items-center justify-center text-base flex-shrink-0">{h.icon}</div>
                  <div>
                    <div className="text-[13px] font-semibold">{h.title}</div>
                    <div className="text-[11px] text-text2 leading-snug">{h.desc}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-[11px] text-text2">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-success opacity-75" />
                <span className="relative inline-flex rounded-full h-2 w-2 bg-success" />
              </span>
              Sistem operasional · v2.0
            </div>
            <button
              onClick={() => setShowPanduan(true)}
              className="flex items-center gap-1.5 text-[11px] text-text2 hover:text-white border border-border/60 hover:border-accent/50 rounded-lg px-3 py-1.5 transition-all hover:bg-accent/10"
            >
              📖 Panduan
            </button>
          </div>
        </div>

        {/* Right — PIN pad */}
        <div className="p-8 sm:p-10 bg-surface/80 backdrop-blur-xl flex flex-col items-center">
          <div className="md:hidden flex items-center gap-3 justify-center mb-6">
            <div className="w-11 h-11 rounded-[10px] flex items-center justify-center text-xl bg-gradient-to-br from-accent to-accent2">📡</div>
            <div className="text-xl font-extrabold">NetWatch ERP</div>
          </div>

          <h1 className="text-[22px] font-bold text-center">Masukkan PIN 🔐</h1>
          <p className="text-[12px] text-text2 mt-1 mb-6 text-center">Login cukup dengan PIN Anda (4–6 digit).</p>

          {/* PIN dots */}
          <div className="flex items-center gap-3 mb-5">
            {Array.from({ length: MAX_PIN }).map((_, i) => (
              <span key={i} className={`w-3.5 h-3.5 rounded-full border transition-all ${i < pin.length ? 'bg-accent border-accent scale-110' : 'border-border'}`} />
            ))}
          </div>

          {error && <div className="bg-danger/10 border border-danger/30 rounded-md px-3 py-2 text-xs text-danger mb-4 flex items-center gap-2 w-full justify-center"><span>⚠️</span>{error}</div>}

          {/* Keypad */}
          <div className="grid grid-cols-3 gap-3 w-full max-w-[280px]">
            {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((d) => (
              <button key={d} disabled={loading} onClick={() => press(d)} className="aspect-square rounded-xl bg-surface2 border border-border text-xl font-semibold hover:border-accent hover:text-accent transition-all active:scale-95 disabled:opacity-50">{d}</button>
            ))}
            <button disabled={loading} onClick={() => submit(pin)} title="Masuk" className="aspect-square rounded-xl bg-accent/15 border border-accent/40 text-accent text-lg font-bold hover:bg-accent/25 active:scale-95 disabled:opacity-50">↵</button>
            <button disabled={loading} onClick={() => press('0')} className="aspect-square rounded-xl bg-surface2 border border-border text-xl font-semibold hover:border-accent hover:text-accent transition-all active:scale-95 disabled:opacity-50">0</button>
            <button disabled={loading} onClick={backspace} title="Hapus" className="aspect-square rounded-xl bg-surface2 border border-border text-lg hover:border-warn hover:text-warn transition-all active:scale-95 disabled:opacity-50">⌫</button>
          </div>

          {loading && <div className="text-[11px] text-text2 mt-4">Memverifikasi…</div>}

          <div className="mt-6 border-t border-border pt-4 w-full">
            <div className="text-[10px] text-text2 uppercase tracking-wider mb-2.5 text-center">Login cepat (demo)</div>
            <div className="grid grid-cols-2 gap-2">
              {QUICK_LOGINS.map((q) => (
                <button key={q.pin} disabled={loading} className="flex items-center gap-2 bg-surface2 border border-border rounded-lg px-3 py-2 text-[12px] text-text2 transition-all hover:border-accent hover:text-white disabled:opacity-60" onClick={() => { setPin(q.pin); submit(q.pin); }}>
                  <span className="text-base">{q.emoji}</span> {q.label}
                </button>
              ))}
            </div>

            {/* Panduan button — visible on mobile (md:hidden for desktop, covered by left panel) */}
            <button
              onClick={() => setShowPanduan(true)}
              className="md:hidden mt-4 w-full flex items-center justify-center gap-2 border border-border/60 rounded-lg px-3 py-2 text-[12px] text-text2 hover:border-accent/50 hover:text-white hover:bg-accent/10 transition-all"
            >
              📖 Panduan Penggunaan
            </button>
          </div>
        </div>
      </div>

      {showPanduan && <PanduanModal onClose={() => setShowPanduan(false)} />}
    </div>
  );
}
