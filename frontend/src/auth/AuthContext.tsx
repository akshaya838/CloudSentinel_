import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { apiGet, apiPost, AUTH_EXPIRED_EVENT } from '../services/api';
import { clearToken, getToken, setToken } from './tokenStore';
import type { LoginResponse, Role, User } from '../types/api';

export interface AuthContextValue {
  user: User | null;
  loading: boolean;
  sessionExpired: boolean;
  login: (email: string, password: string, remember: boolean) => Promise<User>;
  logout: () => void;
  hasRole: (...roles: Role[]) => boolean;
}

export const AuthContext = createContext<AuthContextValue | null>(null);

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState<boolean>(() => getToken() !== null);
  const [sessionExpired, setSessionExpired] = useState(false);

  // Restore the session on first load: validate the stored token with the backend.
  useEffect(() => {
    if (!getToken()) return;
    let cancelled = false;
    apiGet<User>('/api/v1/auth/me')
      .then((u) => !cancelled && setUser(u))
      .catch(() => {
        clearToken();
        if (!cancelled) setUser(null);
      })
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, []);

  // Any API call that comes back 401 (expired / revoked token) signs the user out.
  useEffect(() => {
    const onExpired = () => {
      setUser(null);
      setSessionExpired(true);
    };
    window.addEventListener(AUTH_EXPIRED_EVENT, onExpired);
    return () => window.removeEventListener(AUTH_EXPIRED_EVENT, onExpired);
  }, []);

  const login = useCallback(async (email: string, password: string, remember: boolean) => {
    const res = await apiPost<LoginResponse>('/api/v1/auth/login', { email, password });
    setToken(res.access_token, remember);
    setUser(res.user);
    setSessionExpired(false);
    return res.user;
  }, []);

  const logout = useCallback(() => {
    clearToken();
    setUser(null);
    setSessionExpired(false);
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      loading,
      sessionExpired,
      login,
      logout,
      hasRole: (...roles: Role[]) => user !== null && roles.includes(user.role),
    }),
    [user, loading, sessionExpired, login, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
