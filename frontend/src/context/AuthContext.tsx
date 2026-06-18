import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { api, setAuthToken } from '../api/client';
import type { User } from '../types';

interface AuthState {
  user: User | null;
  token: string | null;
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
  const [token, setToken] = useState<string | null>(localStorage.getItem('netwatch_token'));
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const stored = localStorage.getItem('netwatch_token');
    if (stored) {
      setAuthToken(stored);
      api
        .get('/auth/me')
        .then((res) => setUser(res.data.user))
        .catch(() => {
          localStorage.removeItem('netwatch_token');
          setToken(null);
        })
        .finally(() => setLoading(false));
    } else {
      setLoading(false);
    }
  }, []);

  function applySession(newToken: string, newUser: User) {
    localStorage.setItem('netwatch_token', newToken);
    setAuthToken(newToken);
    setToken(newToken);
    setUser(newUser);
  }

  async function login(identifier: string, password: string) {
    const res = await api.post('/auth/login', { identifier, password });
    applySession(res.data.token, res.data.user);
  }

  async function loginPin(pin: string) {
    const res = await api.post('/auth/login-pin', { pin });
    applySession(res.data.token, res.data.user);
  }

  async function loginAs(userId: number) {
    const res = await api.post(`/auth/login-as/${userId}`);
    applySession(res.data.token, res.data.user);
  }

  function logout() {
    localStorage.removeItem('netwatch_token');
    setAuthToken(null);
    setToken(null);
    setUser(null);
  }

  return (
    <AuthContext.Provider value={{ user, token, loading, login, loginPin, loginAs, updateSession: applySession, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
