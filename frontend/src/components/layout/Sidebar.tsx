import { NavLink, useNavigate } from 'react-router-dom';
import {
  LayoutDashboard, Search, MessageSquareText, Tags, ShieldAlert, Shapes, Copy, FileText,
  Workflow, BookOpen, Settings, ShieldCheck, ListTree, UsersRound, LogOut, type LucideIcon,
} from 'lucide-react';
import { useAuth } from '../../auth/AuthContext';
import { ADMIN_ONLY, ALL_ROLES, ANALYST_UP, ROLE_LABELS } from '../../auth/roles';
import type { Role } from '../../types/api';

const NAV_ITEMS: { to: string; label: string; icon: LucideIcon; roles: Role[] }[] = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard, roles: ALL_ROLES },
  { to: '/explorer', label: 'Vulnerability Explorer', icon: ListTree, roles: ALL_ROLES },
  { to: '/search', label: 'Semantic Search', icon: Search, roles: ANALYST_UP },
  { to: '/assistant', label: 'Voice Assistant', icon: MessageSquareText, roles: ANALYST_UP },
  { to: '/entities', label: 'Entity Intelligence', icon: Tags, roles: ANALYST_UP },
  { to: '/severity', label: 'Severity Analysis', icon: ShieldAlert, roles: ANALYST_UP },
  { to: '/topics', label: 'Topic Discovery', icon: Shapes, roles: ANALYST_UP },
  { to: '/duplicates', label: 'Duplicate Detection', icon: Copy, roles: ANALYST_UP },
  { to: '/reports', label: 'Reports', icon: FileText, roles: ANALYST_UP },
  { to: '/pipeline', label: 'Data Pipeline', icon: Workflow, roles: ADMIN_ONLY },
  { to: '/admin', label: 'Admin', icon: UsersRound, roles: ADMIN_ONLY },
  { to: '/docs', label: 'API Documentation', icon: BookOpen, roles: ALL_ROLES },
  { to: '/settings', label: 'Settings', icon: Settings, roles: ALL_ROLES },
];

function initials(name: string): string {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0].toUpperCase()).join('');
}

export function Sidebar() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const items = NAV_ITEMS.filter((item) => user && item.roles.includes(user.role));

  return (
    <aside className="w-64 shrink-0 bg-white border-r border-gray-200 flex flex-col h-screen sticky top-0">
      <div className="h-16 flex items-center gap-2 px-5 border-b border-gray-200">
        <ShieldCheck className="text-brand-primary" size={22} />
        <span className="font-semibold text-gray-900 text-sm">CloudSentinel</span>
      </div>

      <nav aria-label="Main" className="flex-1 overflow-y-auto py-3 px-2 space-y-0.5">
        {items.map(({ to, label, icon: Icon }) => (
          <NavLink
            key={to}
            to={to}
            end={to === '/'}
            className={({ isActive }) =>
              `flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                isActive ? 'bg-blue-50 text-brand-primary' : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
              }`
            }
          >
            <Icon size={17} />
            {label}
          </NavLink>
        ))}
      </nav>

      {user && (
        <div className="border-t border-gray-200 p-3">
          <div className="flex items-center gap-2.5 px-2 py-1.5">
            <div className="h-8 w-8 shrink-0 rounded-full bg-blue-100 flex items-center justify-center text-xs font-semibold text-brand-primary">
              {initials(user.full_name)}
            </div>
            <div className="min-w-0">
              <p className="text-xs font-medium text-gray-900 truncate">{user.full_name}</p>
              <p className="text-[11px] text-gray-500">{ROLE_LABELS[user.role]}</p>
            </div>
          </div>
          <button
            onClick={() => {
              logout();
              navigate('/login');
            }}
            className="mt-1 w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-gray-600 hover:bg-gray-50 hover:text-gray-900"
          >
            <LogOut size={16} />
            Sign out
          </button>
        </div>
      )}
    </aside>
  );
}
