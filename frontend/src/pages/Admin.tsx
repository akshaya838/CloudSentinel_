import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { PageHeader } from '../components/layout/AppShell';
import { Card, ErrorState, LoadingState } from '../components/shared/States';
import { ROLE_LABELS } from '../auth/roles';
import { apiGet, apiPost, ApiError } from '../services/api';
import type { AuditLogEntry, Role, User } from '../types/api';

const fmt = (iso?: string | null) => (iso ? new Date(iso).toLocaleString() : '—');

export function Admin() {
  const [users, setUsers] = useState<User[] | null>(null);
  const [audit, setAudit] = useState<AuditLogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [role, setRole] = useState<Role>('viewer');
  const [password, setPassword] = useState('');
  const [formMsg, setFormMsg] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    Promise.all([apiGet<User[]>('/api/v1/admin/users'), apiGet<AuditLogEntry[]>('/api/v1/admin/audit-logs', { limit: 25 })])
      .then(([u, a]) => {
        setUsers(u);
        setAudit(a);
      })
      .catch((e: ApiError) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(load, [load]);

  const create = (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setFormMsg(null);
    apiPost<User>('/api/v1/admin/users', { email, full_name: name, role, password })
      .then((u) => {
        setFormMsg({ kind: 'ok', text: `Created ${u.email}.` });
        setEmail('');
        setName('');
        setPassword('');
        load();
      })
      .catch((err: ApiError) => setFormMsg({ kind: 'error', text: err.message }))
      .finally(() => setSaving(false));
  };

  const input = 'w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-primary focus:outline-none focus:ring-2 focus:ring-brand-primary/25';

  return (
    <div>
      <PageHeader title="Admin" subtitle="User accounts and recent security events" />

      {loading && <LoadingState />}
      {error && <ErrorState message={error} onRetry={load} />}

      {users && (
        <div className="space-y-5">
          <Card>
            <h2 className="text-sm font-semibold text-gray-700 px-5 pt-5">Users ({users.length})</h2>
            <table className="w-full text-sm mt-3">
              <thead>
                <tr className="border-b border-gray-200 text-left text-gray-500 text-xs uppercase tracking-wide">
                  <th className="px-5 py-2">Name</th><th className="px-5 py-2">Email</th><th className="px-5 py-2">Role</th><th className="px-5 py-2">Status</th><th className="px-5 py-2">Last sign-in</th>
                </tr>
              </thead>
              <tbody>
                {users.map((u) => (
                  <tr key={u.id} className="border-b border-gray-100 last:border-0">
                    <td className="px-5 py-2.5 font-medium text-gray-800">{u.full_name}</td>
                    <td className="px-5 py-2.5 text-gray-600">{u.email}</td>
                    <td className="px-5 py-2.5 text-gray-600">{ROLE_LABELS[u.role]}</td>
                    <td className="px-5 py-2.5 text-gray-600">{u.is_active ? 'Active' : 'Disabled'}</td>
                    <td className="px-5 py-2.5 text-gray-500">{fmt(u.last_login_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>

          <Card className="p-5">
            <h2 className="text-sm font-semibold text-gray-700 mb-3">Add user</h2>
            <form onSubmit={create} className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <label htmlFor="nu-name" className="block text-xs font-medium text-gray-600 mb-1">Full name</label>
                <input id="nu-name" value={name} onChange={(e) => setName(e.target.value)} className={input} required />
              </div>
              <div>
                <label htmlFor="nu-email" className="block text-xs font-medium text-gray-600 mb-1">Email</label>
                <input id="nu-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} className={input} required />
              </div>
              <div>
                <label htmlFor="nu-role" className="block text-xs font-medium text-gray-600 mb-1">Role</label>
                <select id="nu-role" value={role} onChange={(e) => setRole(e.target.value as Role)} className={input}>
                  <option value="viewer">Viewer</option>
                  <option value="analyst">Security Analyst</option>
                  <option value="admin">Admin</option>
                </select>
              </div>
              <div>
                <label htmlFor="nu-pw" className="block text-xs font-medium text-gray-600 mb-1">Temporary password</label>
                <input id="nu-pw" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} className={input} required />
              </div>
              <div className="md:col-span-2 flex items-center gap-3">
                <button type="submit" disabled={saving} className="px-4 py-2 bg-brand-primary text-white rounded-lg text-sm font-medium disabled:opacity-40 hover:bg-brand-primary-hover">
                  Create user
                </button>
                {formMsg && (
                  <span role={formMsg.kind === 'error' ? 'alert' : 'status'} className={`text-sm ${formMsg.kind === 'ok' ? 'text-green-700' : 'text-red-700'}`}>
                    {formMsg.text}
                  </span>
                )}
              </div>
            </form>
          </Card>

          <Card>
            <h2 className="text-sm font-semibold text-gray-700 px-5 pt-5">Recent security events</h2>
            <table className="w-full text-sm mt-3">
              <thead>
                <tr className="border-b border-gray-200 text-left text-gray-500 text-xs uppercase tracking-wide">
                  <th className="px-5 py-2">Time</th><th className="px-5 py-2">Event</th><th className="px-5 py-2">User</th><th className="px-5 py-2">IP</th><th className="px-5 py-2">Detail</th>
                </tr>
              </thead>
              <tbody>
                {audit.map((a) => (
                  <tr key={a.id} className="border-b border-gray-100 last:border-0">
                    <td className="px-5 py-2.5 text-gray-500 whitespace-nowrap">{fmt(a.created_at)}</td>
                    <td className="px-5 py-2.5 font-medium text-gray-800">{a.event.replace(/_/g, ' ')}</td>
                    <td className="px-5 py-2.5 text-gray-600">{a.user_email ?? '—'}</td>
                    <td className="px-5 py-2.5 text-gray-500">{a.ip ?? '—'}</td>
                    <td className="px-5 py-2.5 text-gray-500">{a.detail ?? ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        </div>
      )}
    </div>
  );
}
