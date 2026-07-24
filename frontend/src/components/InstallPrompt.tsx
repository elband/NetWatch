import { useEffect, useState } from 'react';

// Event khusus Chromium — belum ada di lib DOM standar.
interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

const SNOOZE_KEY = 'nw_install_snooze';
const SNOOZE_MS = 14 * 24 * 60 * 60 * 1000; // jangan menagih lagi selama 2 minggu

function snoozed(): boolean {
  try {
    const t = Number(localStorage.getItem(SNOOZE_KEY) || 0);
    return Number.isFinite(t) && Date.now() - t < SNOOZE_MS;
  } catch { return false; }
}
function snooze() {
  try { localStorage.setItem(SNOOZE_KEY, String(Date.now())); } catch { /* abaikan */ }
}

// Sudah berjalan sebagai aplikasi terpasang? (Chromium/Android + Safari iOS)
function isStandalone(): boolean {
  if (typeof window === 'undefined') return false;
  const iosStandalone = (window.navigator as Navigator & { standalone?: boolean }).standalone === true;
  return window.matchMedia?.('(display-mode: standalone)').matches || iosStandalone;
}

function isIos(): boolean {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent;
  // iPadOS 13+ menyamar sebagai Mac; dibedakan lewat layar sentuh.
  return /iphone|ipad|ipod/i.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
}

/**
 * Ajakan memasang NetWatch sebagai aplikasi.
 *
 * Chromium menembakkan `beforeinstallprompt`; kita tahan event-nya lalu panggil
 * ulang saat tombol ditekan (browser mensyaratkan pemanggilan dari gestur user).
 * Safari iOS tidak punya event itu sama sekali, jadi di sana banner hanya
 * memberi instruksi Bagikan → Tambah ke Layar Utama.
 *
 * Banner tidak pernah muncul bila aplikasi sudah terpasang, atau bila user
 * menutupnya dalam 14 hari terakhir.
 */
export default function InstallPrompt() {
  const [evt, setEvt] = useState<BeforeInstallPromptEvent | null>(null);
  const [showIos, setShowIos] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (isStandalone() || snoozed()) return;

    function onBip(e: Event) {
      e.preventDefault(); // cegah mini-infobar bawaan; kita tampilkan banner sendiri
      setEvt(e as BeforeInstallPromptEvent);
    }
    function onInstalled() { setEvt(null); setShowIos(false); snooze(); }

    window.addEventListener('beforeinstallprompt', onBip);
    window.addEventListener('appinstalled', onInstalled);

    // iOS: tak ada event, jadi munculkan instruksi setelah jeda singkat supaya
    // tidak menutupi konten tepat saat halaman baru dibuka.
    let t: number | undefined;
    if (isIos()) t = window.setTimeout(() => setShowIos(true), 2500);

    return () => {
      window.removeEventListener('beforeinstallprompt', onBip);
      window.removeEventListener('appinstalled', onInstalled);
      if (t) clearTimeout(t);
    };
  }, []);

  async function install() {
    if (!evt) return;
    setBusy(true);
    try {
      await evt.prompt();
      await evt.userChoice;
    } catch { /* user menutup dialog bawaan */ }
    finally {
      setEvt(null); // event sekali pakai — browser akan menembakkan lagi bila masih layak
      setBusy(false);
      snooze();
    }
  }

  function dismiss() { snooze(); setEvt(null); setShowIos(false); }

  if (!evt && !showIos) return null;

  return (
    <div className="fixed nw-above-nav left-3 right-3 lg:left-auto lg:right-4 lg:max-w-sm z-[38] nw-sheet">
      <div className="nw-glass border border-accent/30 rounded-xl shadow-2xl p-3 flex items-start gap-3">
        <div className="w-9 h-9 rounded-[9px] shrink-0 flex items-center justify-center text-lg bg-gradient-to-br from-accent to-accent2">📡</div>
        <div className="flex-1 min-w-0">
          <div className="text-[12px] font-bold">Pasang NetWatch di perangkat</div>
          {evt ? (
            <div className="text-[10.5px] text-text2 mt-0.5">Buka langsung dari layar utama, layar penuh tanpa bilah browser.</div>
          ) : (
            <div className="text-[10.5px] text-text2 mt-0.5">
              Ketuk tombol <span className="text-text font-semibold">Bagikan</span> di Safari, lalu pilih <span className="text-text font-semibold">Tambah ke Layar Utama</span>.
            </div>
          )}
          <div className="flex gap-2 mt-2">
            {evt && (
              <button onClick={install} disabled={busy} className="bg-accent text-bg rounded-md px-3 py-1.5 text-[11px] font-semibold disabled:opacity-50">
                {busy ? 'Memasang…' : 'Pasang'}
              </button>
            )}
            <button onClick={dismiss} className="border border-border text-text2 rounded-md px-3 py-1.5 text-[11px]">Nanti saja</button>
          </div>
        </div>
        <button onClick={dismiss} aria-label="Tutup" className="text-text2 hover:text-text text-lg leading-none shrink-0">×</button>
      </div>
    </div>
  );
}
