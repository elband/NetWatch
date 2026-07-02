import axios from 'axios';

// withCredentials: kirim cookie sesi HttpOnly pada setiap request.
export const api = axios.create({ baseURL: '/api', withCredentials: true });

// Multi-unit: unit aktif pilihan Super Admin (unit switcher di header).
// Dikirim sebagai header X-Unit-Id; backend mengabaikannya untuk non-admin.
const UNIT_KEY = 'netwatch_unit';
export function getActiveUnitId(): number | null {
  const v = Number(localStorage.getItem(UNIT_KEY));
  return Number.isInteger(v) && v > 0 ? v : null;
}
export function setActiveUnitId(id: number | null) {
  if (id) localStorage.setItem(UNIT_KEY, String(id));
  else localStorage.removeItem(UNIT_KEY);
}
api.interceptors.request.use((config) => {
  const unitId = getActiveUnitId();
  if (unitId) config.headers['X-Unit-Id'] = String(unitId);
  return config;
});

// Dipertahankan untuk kompatibilitas pemanggil lama. Auth kini berbasis cookie
// HttpOnly (tidak ada token di localStorage), jadi fungsi ini no-op.
export function setAuthToken(_token: string | null) { /* no-op */ }

api.interceptors.response.use(
  (res) => res,
  (err) => {
    // Jangan redirect untuk panggilan bootstrap /auth/me (cek sesi saat load),
    // dan jangan ulang-redirect bila sudah di halaman login.
    const url: string = err.config?.url || '';
    if (err.response?.status === 401 && !url.includes('/auth/me') && !location.pathname.startsWith('/login')) {
      window.location.href = '/login';
    }
    return Promise.reject(err);
  }
);
