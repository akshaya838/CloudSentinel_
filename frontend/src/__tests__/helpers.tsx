import { vi } from 'vitest';
import type { ReactNode } from 'react';
import { AuthContext, type AuthContextValue } from '../auth/AuthContext';
import type { Role, User } from '../types/api';

const NAMES: Record<Role, string> = { admin: 'Platform Admin', analyst: 'Security Engineer', viewer: 'Cloud Engineer' };

export function makeUser(role: Role): User {
  return { id: 1, email: `${role}@cloudco.example`, full_name: NAMES[role], role };
}

export function authValue(role: Role | null): AuthContextValue {
  const user = role ? makeUser(role) : null;
  return {
    user,
    loading: false,
    sessionExpired: false,
    login: vi.fn(),
    logout: vi.fn(),
    hasRole: (...roles: Role[]) => user !== null && roles.includes(user.role),
  };
}

export function WithAuth({ role, children }: { role: Role | null; children: ReactNode }) {
  return <AuthContext.Provider value={authValue(role)}>{children}</AuthContext.Provider>;
}
