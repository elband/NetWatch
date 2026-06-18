import axios from 'axios';

export const api = axios.create({ baseURL: '/api' });

export function setAuthToken(token: string | null) {
  if (token) {
    api.defaults.headers.common.Authorization = `Bearer ${token}`;
  } else {
    delete api.defaults.headers.common.Authorization;
  }
}

api.interceptors.response.use(
  (res) => res,
  (err) => {
    if (err.response?.status === 401) {
      localStorage.removeItem('netwatch_token');
      window.location.href = '/login';
    }
    return Promise.reject(err);
  }
);
