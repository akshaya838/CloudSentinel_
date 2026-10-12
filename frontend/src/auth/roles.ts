import type { Role } from '../types/api';

export const ROLE_LABELS: Record<Role, string> = {
  admin: 'Admin',
  analyst: 'Security Analyst',
  viewer: 'Viewer',
};

// Single source of truth for who can see what. The backend enforces the same
// rules independently; this only decides what the UI shows.
export const ALL_ROLES: Role[] = ['viewer', 'analyst', 'admin'];
export const ANALYST_UP: Role[] = ['analyst', 'admin'];
export const ADMIN_ONLY: Role[] = ['admin'];
