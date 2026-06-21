import axios from 'axios';

// withCredentials: kirim cookie sesi HttpOnly pada setiap request.
export const api = axios.create({ baseURL: '/api', withCredentials: true });

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
