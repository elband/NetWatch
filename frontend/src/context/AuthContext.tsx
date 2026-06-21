import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { api } from '../api/client';
import type { User } from '../types';

interface AuthState {
  user: User | null;
  token: string | null; // dipertahankan untuk kompatibilitas tipe; selalu null (auth via cookie)
  loading: boolean;
  login: (identifier: string, password: string) => Promise<void>;
  loginPin: (pin: string) => Promise<void>;
  loginAs: (userId: number) => Promise<void>;
  updateSession: (token: string, user: User) => void;
  logout: () => void;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  // Pulihkan sesi dari cookie HttpOnly saat load (token tidak bisa dibaca JS).
  useEffect(() => {
    api
      .get('/auth/me')
      .then((res) => setUser(res.data.user))
      .catch(() => setUser(null))
      .finally(() => setLoading(false));
  }, []);

  async function login(identifier: string, password: string) {
    const res = await api.post('/auth/login', { identifier, password });
    setUser(res.data.user); // cookie sesi di-set oleh server
  }

  async function loginPin(pin: string) {
    const res = await api.post('/auth/login-pin', { pin });
    setUser(res.data.user);
  }

  async function loginAs(userId: number) {
    const res = await api.post(`/auth/login-as/${userId}`);
    setUser(res.data.user);
  }

  // updateSession(token, user): token diabaikan (cookie diperbarui server); cukup set user.
  function updateSession(_token: string, newUser: User) {
    setUser(newUser);
  }

  async function logout() {
    try { await api.post('/auth/logout'); } catch { /* tetap bersihkan state lokal */ }
    setUser(null);
  }

  return (
    <AuthContext.Provider value={{ user, token: null, loading, login, loginPin, loginAs, updateSession, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
