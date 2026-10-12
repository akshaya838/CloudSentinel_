import { useState, type FormEvent } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { AlertCircle, Eye, EyeOff, FileSearch, Info, Languages, Loader2, ScanSearch, ShieldCheck } from 'lucide-react';
import { useAuth } from '../auth/AuthContext';
import { ApiError } from '../services/api';

// Convenience for local demos only: set VITE_SHOW_DEMO_ACCOUNTS=true (see .env.development).
// These accounts exist only when the backend runs with ENVIRONMENT=development.
const SHOW_DEMO = import.meta.env.VITE_SHOW_DEMO_ACCOUNTS === 'true';
const DEMO_ACCOUNTS = [
  { role: 'Admin', who: 'Platform Admin', email: 'admin@cloudco.example', password: 'Admin#2026Demo' },
  { role: 'Security Analyst', who: 'Security Engineer', email: 'analyst@cloudco.example', password: 'Analyst#2026Demo' },
  { role: 'Viewer', who: 'Cloud Engineer', email: 'viewer@cloudco.example', password: 'Viewer#2026Demo' },
];

const HIGHLIGHTS = [
  { icon: ScanSearch, title: 'Explainable severity', text: 'Every classification shows which terms drove the decision.' },
  { icon: FileSearch, title: 'Grounded answers', text: 'AI responses cite the CVE records they came from.' },
  { icon: Languages, title: 'English, தமிழ் and हिन्दी', text: 'Ask in your own language and get answers back in it.' },
];

export function Login() {
  const { user, loading, login, sessionExpired } = useAuth();
  const location = useLocation();
  const from = (location.state as { from?: string } | null)?.from ?? '/';

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [remember, setRemember] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showForgot, setShowForgot] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!loading && user) return <Navigate to={from} replace />;

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!email.trim() || !password) return;
    setSubmitting(true);
    setError(null);
    try {
      await login(email.trim(), password, remember);
      // Success: `user` is now set, so the redirect above takes over.
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong while signing in. Please try again.');
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen flex bg-white">
      {/* Brand panel */}
      <aside className="hidden lg:flex lg:w-[46%] bg-slate-900 text-white flex-col justify-between p-12">
        <div className="flex items-center gap-2.5">
          <ShieldCheck className="text-blue-400" size={26} />
          <span className="font-semibold tracking-tight">CloudSentinel</span>
        </div>

        <div>
          <h1 className="text-3xl font-semibold leading-tight tracking-tight max-w-md">
            Vulnerability intelligence for cloud engineering teams.
          </h1>
          <p className="mt-4 text-slate-300 text-sm leading-relaxed max-w-md">
            Triage CVEs, understand their impact, and get cited answers. Models run on your own
            infrastructure — CVE data and queries are not sent to third-party AI APIs.
          </p>
          <ul className="mt-10 space-y-6 max-w-md">
            {HIGHLIGHTS.map(({ icon: Icon, title, text }) => (
              <li key={title} className="flex gap-4">
                <div className="mt-0.5 h-9 w-9 shrink-0 rounded-lg bg-slate-800 flex items-center justify-center">
                  <Icon size={18} className="text-blue-400" />
                </div>
                <div>
                  <p className="text-sm font-medium">{title}</p>
                  <p className="text-sm text-slate-400">{text}</p>
                </div>
              </li>
            ))}
          </ul>
        </div>

        <p className="text-xs text-slate-500">Demonstration build · 38 curated CVE records</p>
      </aside>

      {/* Form panel */}
      <main className="flex-1 flex items-center justify-center bg-gray-50 px-6 py-12">
        <div className="w-full max-w-sm">
          <div className="lg:hidden flex items-center gap-2 mb-8">
            <ShieldCheck className="text-brand-primary" size={24} />
            <span className="font-semibold text-gray-900">CloudSentinel</span>
          </div>

          <h2 className="text-2xl font-semibold text-gray-900">Sign in</h2>
          <p className="text-sm text-gray-500 mt-1 mb-6">Use your company account to continue.</p>

          {sessionExpired && !error && (
            <div role="status" className="mb-4 flex gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
              <Info size={16} className="mt-0.5 shrink-0" />
              Your session has expired. Please sign in again.
            </div>
          )}

          <form onSubmit={onSubmit} className="space-y-4" noValidate>
            <div>
              <label htmlFor="email" className="block text-sm font-medium text-gray-700 mb-1">
                Work email
              </label>
              <input
                id="email"
                type="email"
                autoComplete="username"
                autoFocus
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@company.com"
                className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2.5 text-sm text-gray-900 placeholder:text-gray-400 focus:border-brand-primary focus:outline-none focus:ring-2 focus:ring-brand-primary/25"
              />
            </div>

            <div>
              <label htmlFor="password" className="block text-sm font-medium text-gray-700 mb-1">
                Password
              </label>
              <div className="relative">
                <input
                  id="password"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="current-password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2.5 pr-11 text-sm text-gray-900 focus:border-brand-primary focus:outline-none focus:ring-2 focus:ring-brand-primary/25"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                  className="absolute inset-y-0 right-0 flex items-center px-3 text-gray-400 hover:text-gray-600"
                >
                  {showPassword ? <EyeOff size={17} /> : <Eye size={17} />}
                </button>
              </div>
            </div>

            <div className="flex items-center justify-between">
              <label className="flex items-center gap-2 text-sm text-gray-600 cursor-pointer">
                <input
                  type="checkbox"
                  checked={remember}
                  onChange={(e) => setRemember(e.target.checked)}
                  className="h-4 w-4 rounded border-gray-300 text-brand-primary focus:ring-brand-primary/30"
                />
                Remember me
              </label>
              <button
                type="button"
                onClick={() => setShowForgot((v) => !v)}
                aria-expanded={showForgot}
                className="text-sm font-medium text-brand-primary hover:underline"
              >
                Forgot password?
              </button>
            </div>

            {showForgot && (
              <div role="status" className="flex gap-2 rounded-lg border border-blue-100 bg-blue-50 p-3 text-sm text-blue-900">
                <Info size={16} className="mt-0.5 shrink-0" />
                Password resets are handled by your administrator. Contact your platform or security team.
              </div>
            )}

            {error && (
              <div role="alert" className="flex gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">
                <AlertCircle size={16} className="mt-0.5 shrink-0" />
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={submitting || !email.trim() || !password}
              className="w-full flex items-center justify-center gap-2 rounded-lg bg-brand-primary px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-brand-primary-hover disabled:cursor-not-allowed disabled:opacity-50"
            >
              {submitting && <Loader2 size={16} className="animate-spin" />}
              {submitting ? 'Signing in…' : 'Sign in'}
            </button>
          </form>

          {SHOW_DEMO && (
            <details className="mt-8 rounded-lg border border-gray-200 bg-white p-3 text-sm">
              <summary className="cursor-pointer font-medium text-gray-700">Demo accounts (local development only)</summary>
              <ul className="mt-3 space-y-2">
                {DEMO_ACCOUNTS.map((a) => (
                  <li key={a.email} className="flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <p className="font-medium text-gray-800">{a.role}</p>
                      <p className="truncate text-xs text-gray-500">{a.who} · {a.email}</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setEmail(a.email);
                        setPassword(a.password);
                        setError(null);
                      }}
                      className="shrink-0 rounded-md border border-gray-200 px-2.5 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50"
                    >
                      Fill in
                    </button>
                  </li>
                ))}
              </ul>
            </details>
          )}

          <p className="mt-8 text-center text-xs text-gray-400">Sign-in activity is logged.</p>
        </div>
      </main>
    </div>
  );
}
