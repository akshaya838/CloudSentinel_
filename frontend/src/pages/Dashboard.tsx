import { useEffect, useState, useCallback } from 'react';
import { ShieldAlert, ShieldX, Layers, Bug, Copy, Boxes } from 'lucide-react';
import { BarChart, Bar, Cell, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';
import { PageHeader } from '../components/layout/AppShell';
import { KpiCard } from '../components/shared/KpiCard';
import { Card, LoadingState, ErrorState } from '../components/shared/States';
import { apiGet, ApiError } from '../services/api';
import { useAuth } from '../auth/AuthContext';
import { ROLE_LABELS } from '../auth/roles';
import type { DashboardData, CveStats } from '../types/api';

const SEVERITY_COLORS: Record<string, string> = {
  LOW: '#16a34a',
  MEDIUM: '#d97706',
  HIGH: '#ea580c',
  CRITICAL: '#dc2626',
};
const SEVERITY_ORDER = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'];

export function Dashboard() {
  const { user } = useAuth();
  const [dashboard, setDashboard] = useState<DashboardData | null>(null);
  const [stats, setStats] = useState<CveStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    Promise.all([
      apiGet<DashboardData>('/api/v1/dashboard'),
      apiGet<CveStats>('/api/v1/cves/stats'),
    ])
      .then(([d, s]) => {
        setDashboard(d);
        setStats(s);
      })
      .catch((e: ApiError) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(load, [load]);

  if (loading) return <LoadingState label="Loading dashboard..." />;
  if (error) return <ErrorState message={error} onRetry={load} />;
  if (!dashboard || !stats) return null;

  const severityData = SEVERITY_ORDER.filter((s) => stats.severity_breakdown[s] !== undefined).map((s) => ({
    severity: s,
    count: stats.severity_breakdown[s],
  }));

  return (
    <div>
      <PageHeader
        title="Security Intelligence Dashboard"
        subtitle={`${user ? `Signed in as ${user.full_name} (${ROLE_LABELS[user.role]}) · ` : ''}Live view over ${stats.total_records} indexed CVE records`}
      />

      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-4 mb-6">
        <KpiCard label="Total CVEs" value={dashboard.kpis.total_cves} icon={Layers} />
        <KpiCard label="Critical" value={dashboard.kpis.critical_cves} icon={ShieldX} accentColor="text-red-600" />
        <KpiCard label="High Severity" value={dashboard.kpis.high_cves} icon={ShieldAlert} accentColor="text-orange-600" />
        <KpiCard
          label="Affected Products"
          value={dashboard.kpis.affected_products}
          description={dashboard.kpis.affected_products === null ? 'Not yet tracked structurally (Phase 3)' : undefined}
          icon={Boxes}
        />
        <KpiCard label="CWEs Detected" value={dashboard.kpis.cwes_detected} icon={Bug} />
        <KpiCard
          label="Duplicate Reports"
          value={dashboard.kpis.duplicate_reports}
          description={dashboard.kpis.duplicate_reports === null ? 'See Duplicate Detection page' : undefined}
          icon={Copy}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 mb-6">
        <Card className="p-5">
          <h2 className="text-sm font-semibold text-gray-700 mb-4">Severity Distribution</h2>
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={severityData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis dataKey="severity" tick={{ fontSize: 12 }} />
              <YAxis tick={{ fontSize: 12 }} allowDecimals={false} />
              <Tooltip />
              <Bar dataKey="count" radius={[4, 4, 0, 0]}>
                {severityData.map((entry) => (
                  <Cell key={entry.severity} fill={SEVERITY_COLORS[entry.severity]} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </Card>

        <Card className="p-5">
          <h2 className="text-sm font-semibold text-gray-700 mb-4">Dataset Summary</h2>
          <dl className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <dt className="text-gray-400">Avg CVSS Score</dt>
              <dd className="text-gray-900 font-medium">{stats.avg_cvss_score}</dd>
            </div>
            <div>
              <dt className="text-gray-400">Avg Description Length</dt>
              <dd className="text-gray-900 font-medium">{stats.avg_description_length} words</dd>
            </div>
            <div>
              <dt className="text-gray-400">Unique CWE Types</dt>
              <dd className="text-gray-900 font-medium">{stats.unique_cwe_types}</dd>
            </div>
            <div>
              <dt className="text-gray-400">Total Records</dt>
              <dd className="text-gray-900 font-medium">{stats.total_records}</dd>
            </div>
          </dl>
          <p className="text-xs text-gray-400 mt-4">
            Demonstration dataset (38 real CVEs) — architecture supports larger datasets via CSV/JSON import (Phase 3).
          </p>
        </Card>
      </div>
    </div>
  );
}
