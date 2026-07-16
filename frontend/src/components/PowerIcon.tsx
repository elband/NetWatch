// Ikon power (nyala/mati) sebagai SVG agar selalu tampil di semua perangkat.
// Emoji ⏻ (U+23FB, POWER SYMBOL) tidak tersedia di banyak font Android/browser,
// sehingga dulu muncul sebagai kotak "tofu". SVG di sini mewarisi currentColor + ukuran font.
export default function PowerIcon({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" className={`inline-block align-[-0.125em] ${className}`} aria-hidden="true">
      <path d="M12 3v9" />
      <path d="M7.5 6.5a7 7 0 1 0 9 0" />
    </svg>
  );
}
