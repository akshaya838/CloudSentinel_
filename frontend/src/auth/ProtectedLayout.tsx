import type { ReactNode } from 'react';
import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { AppShell } from '../components/layout/AppShell';
import { ForbiddenState, LoadingState } from '../components/shared/States';
import { useAuth } from './AuthContext';
import { ROLE_LABELS } from './roles';
import type { Role } from '../types/api';

/** Everything inside requires a signed-in user; otherwise redirect to /login and come back after. */
export function ProtectedLayout() {
  const { user, loading } = useAuth();
  const location = useLocation();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <LoadingState label="Checking your session..." />
      </div>
    );
  }
  if (!user) {
    return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />;
  }
  return (
    <AppShell>
      <Outlet />
    </AppShell>
  );
}

/** Role gate for a page. The backend enforces the same rule; this gives a clear message instead of a failed request. */
export function RequireRole({ roles, feature, children }: { roles: Role[]; feature: string; children: ReactNode }) {
  const { user } = useAuth();
  if (user && !roles.includes(user.role)) {
    return <ForbiddenState feature={feature} role={ROLE_LABELS[user.role]} />;
  }
  return <>{children}</>;
}
