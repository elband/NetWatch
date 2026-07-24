import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';

export type Theme = 'dark' | 'light';

interface ThemeState {
  theme: Theme;
  toggle: () => void;
  setTheme: (t: Theme) => void;
}

const ThemeContext = createContext<ThemeState | null>(null);
const STORAGE_KEY = 'netwatch_theme';
// Samakan dengan --color-bg di index.css (dan theme_color manifest untuk gelap).
const THEME_COLOR = { dark: '#0d1117', light: '#ffffff' };

function getInitial(): Theme {
  try {
    const t = localStorage.getItem(STORAGE_KEY);
    if (t === 'light' || t === 'dark') return t;
  } catch { /* localStorage tak tersedia */ }
  // Selaras dengan skrip anti-FOUC di index.html (default gelap).
  const attr = typeof document !== 'undefined' ? document.documentElement.getAttribute('data-theme') : null;
  return attr === 'light' ? 'light' : 'dark';
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(getInitial);

  // Terapkan ke <html> + simpan preferensi. Token CSS (--color-*) dioverride
  // oleh selector html[data-theme="..."] di index.css.
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    try { localStorage.setItem(STORAGE_KEY, theme); } catch { /* abaikan */ }
    // Warnai bilah status OS saat dipasang sebagai aplikasi (PWA) — kalau tidak,
    // mode terang tetap memakai bilah gelap dari nilai statis di index.html.
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', theme === 'light' ? THEME_COLOR.light : THEME_COLOR.dark);
  }, [theme]);

  const setTheme = (t: Theme) => setThemeState(t);
  const toggle = () => setThemeState((p) => (p === 'dark' ? 'light' : 'dark'));

  return <ThemeContext.Provider value={{ theme, toggle, setTheme }}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used inside ThemeProvider');
  return ctx;
}
