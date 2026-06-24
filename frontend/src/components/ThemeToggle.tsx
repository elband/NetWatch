import { useTheme } from '../context/ThemeContext';

/**
 * Tombol ganti tema gelap/terang. Tampilkan ikon tujuan (☀️ saat gelap → klik ke
 * terang, 🌙 saat terang → klik ke gelap). Ukuran/posisi diatur lewat `className`.
 */
export default function ThemeToggle({ className = '' }: { className?: string }) {
  const { theme, toggle } = useTheme();
  const isDark = theme === 'dark';
  return (
    <button
      type="button"
      onClick={toggle}
      title={isDark ? 'Beralih ke mode terang' : 'Beralih ke mode gelap'}
      aria-label={isDark ? 'Beralih ke mode terang' : 'Beralih ke mode gelap'}
      className={`inline-flex items-center justify-center rounded-lg border border-border text-text2 hover:text-accent hover:border-accent/50 transition-all active:scale-95 ${className}`}
    >
      <span className="leading-none">{isDark ? '☀️' : '🌙'}</span>
    </button>
  );
}
