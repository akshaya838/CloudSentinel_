import { useState, type FormEvent } from 'react';
import { PageHeader } from '../components/layout/AppShell';
import { Card } from '../components/shared/States';
import { useAuth } from '../auth/AuthContext';
import { ROLE_LABELS } from '../auth/roles';
import { apiPost, ApiError } from '../services/api';

export function Settings() {
  const { user } = useAuth();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (next !== confirm) {
      setMessage({ kind: 'error', text: 'The new passwords do not match.' });
      return;
    }
    setBusy(true);
    setMessage(null);
    apiPost('/api/v1/auth/change-password', { current_password: current, new_password: next })
      .then(() => {
        setMessage({ kind: 'ok', text: 'Password updated.' });
        setCurrent('');
        setNext('');
        setConfirm('');
      })
      .catch((err: ApiError) => setMessage({ kind: 'error', text: err.message }))
      .finally(() => setBusy(false));
  };

  const field = 'w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-primary focus:outline-none focus:ring-2 focus:ring-brand-primary/25';

  return (
    <div>
      <PageHeader title="Settings" subtitle="Your account" />
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <Card className="p-5">
          <h2 className="text-sm font-semibold text-gray-700 mb-4">Profile</h2>
          {user && (
            <dl className="text-sm space-y-3">
              <div className="flex justify-between"><dt className="text-gray-400">Name</dt><dd className="font-medium text-gray-900">{user.full_name}</dd></div>
              <div className="flex justify-between"><dt className="text-gray-400">Email</dt><dd className="font-medium text-gray-900">{user.email}</dd></div>
              <div className="flex justify-between"><dt className="text-gray-400">Role</dt><dd className="font-medium text-gray-900">{ROLE_LABELS[user.role]}</dd></div>
            </dl>
          )}
        </Card>

        <Card className="p-5">
          <h2 className="text-sm font-semibold text-gray-700 mb-4">Change password</h2>
          <form onSubmit={submit} className="space-y-3">
            <div>
              <label htmlFor="cur" className="block text-xs font-medium text-gray-600 mb-1">Current password</label>
              <input id="cur" type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} className={field} required />
            </div>
            <div>
              <label htmlFor="new" className="block text-xs font-medium text-gray-600 mb-1">New password</label>
              <input id="new" type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} className={field} required />
              <p className="text-xs text-gray-400 mt-1">At least 10 characters, with letters and numbers.</p>
            </div>
            <div>
              <label htmlFor="conf" className="block text-xs font-medium text-gray-600 mb-1">Confirm new password</label>
              <input id="conf" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} className={field} required />
            </div>
            {message && (
              <p role={message.kind === 'error' ? 'alert' : 'status'} className={`text-sm ${message.kind === 'ok' ? 'text-green-700' : 'text-red-700'}`}>
                {message.text}
              </p>
            )}
            <button type="submit" disabled={busy || !current || !next || !confirm} className="px-4 py-2 bg-brand-primary text-white rounded-lg text-sm font-medium disabled:opacity-40 hover:bg-brand-primary-hover">
              Update password
            </button>
          </form>
        </Card>
      </div>
    </div>
  );
}
