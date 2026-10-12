import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search } from 'lucide-react';
import { apiGet } from '../../services/api';
import { useAuth } from '../../auth/AuthContext';
import type { HealthStatus } from '../../types/api';

const CVE_ID = /^CVE-\d{4}-\d{4,}$/i;

export function Topbar() {
  const navigate = useNavigate();
  const { hasRole } = useAuth();
  const [term, setTerm] = useState('');
  const [health, setHealth] = useState<HealthStatus | null>(null);
  const [healthError, setHealthError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const poll = () =>
      apiGet<HealthStatus>('/health')
        .then((data) => {
          if (!cancelled) {
            setHealth(data);
            setHealthError(false);
          }
        })
        .catch(() => !cancelled && setHealthError(true));
    poll();
    const interval = setInterval(poll, 15000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  const onSearch = (e: FormEvent) => {
    e.preventDefault();
    const q = term.trim();
    if (!q) return;
    if (CVE_ID.test(q)) navigate(`/explorer/${q.toUpperCase()}`);
    else if (hasRole('analyst', 'admin')) navigate(`/search?q=${encodeURIComponent(q)}`);
    else navigate(`/explorer?search=${encodeURIComponent(q)}`);
    setTerm('');
  };

  const degraded = health ? Object.entries(health).filter(([, v]) => v !== 'operational').map(([k]) => k.replace(/_/g, ' ')) : [];
  const dot = healthError ? 'bg-gray-400' : degraded.length === 0 && health ? 'bg-green-500' : 'bg-amber-500';
  const label = healthError
    ? 'Backend unreachable'
    : !health
      ? 'Checking status…'
      : degraded.length === 0
        ? 'All systems operational'
        : 'Some services degraded';

  return (
    <header className="h-16 bg-white border-b border-gray-200 flex items-center justify-between px-6 sticky top-0 z-10">
      <form role="search" onSubmit={onSearch} className="relative w-96 max-w-full">
        <label htmlFor="global-search" className="sr-only">
          Search by CVE ID or keywords
        </label>
        <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
        <input
          id="global-search"
          type="search"
          value={term}
          onChange={(e) => setTerm(e.target.value)}
          placeholder="Search a CVE ID or describe a vulnerability"
          className="w-full rounded-lg border border-gray-200 bg-gray-50 py-1.5 pl-9 pr-3 text-sm placeholder:text-gray-400 focus:border-brand-primary focus:bg-white focus:outline-none focus:ring-2 focus:ring-brand-primary/25"
        />
      </form>

      <div
        className="flex items-center gap-1.5 text-xs font-medium"
        title={degraded.length ? `Not fully available: ${degraded.join(', ')}` : undefined}
      >
        <span className={`w-2 h-2 rounded-full ${dot}`} />
        <span className="text-gray-500">{label}</span>
      </div>
    </header>
  );
}
