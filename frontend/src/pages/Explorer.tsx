import { useEffect, useState, useCallback } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { PageHeader } from '../components/layout/AppShell';
import { Card, LoadingState, ErrorState, EmptyState } from '../components/shared/States';
import { SeverityBadge } from '../components/shared/SeverityBadge';
import { apiGet, ApiError } from '../services/api';

interface CveListResponse {
  total: number;
  page: number;
  page_size: number;
  records: Record<string, string | number>[];
}

const PAGE_SIZE = 10;

export function Explorer() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [data, setData] = useState<CveListResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [severity, setSeverity] = useState('');
  const [search, setSearch] = useState(params.get('search') ?? '');
  const [page, setPage] = useState(1);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    apiGet<CveListResponse>('/api/v1/cves', {
      severity: severity || undefined,
      search: search || undefined,
      page,
      page_size: PAGE_SIZE,
    })
      .then(setData)
      .catch((e: ApiError) => setError(e.message))
      .finally(() => setLoading(false));
  }, [severity, search, page]);

  useEffect(load, [load]);

  // The top-bar search can navigate here with a new ?search= while this page is already open.
  const urlSearch = params.get('search');
  useEffect(() => {
    if (urlSearch !== null) {
      setSearch(urlSearch);
      setPage(1);
    }
  }, [urlSearch]);

  const totalPages = data ? Math.ceil(data.total / PAGE_SIZE) : 1;

  return (
    <div>
      <PageHeader title="Vulnerability Explorer" subtitle="Search, filter, and drill into indexed CVE records" />

      <Card className="p-4 mb-5 flex flex-wrap gap-3 items-center">
        <input
          type="text"
          placeholder="Search CVE ID or description..."
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(1);
          }}
          className="px-3 py-2 text-sm border border-gray-200 rounded-lg w-72 focus:outline-none focus:ring-2 focus:ring-brand-primary/30"
        />
        <select
          value={severity}
          onChange={(e) => {
            setSeverity(e.target.value);
            setPage(1);
          }}
          className="px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-primary/30"
        >
          <option value="">All severities</option>
          <option value="LOW">Low</option>
          <option value="MEDIUM">Medium</option>
          <option value="HIGH">High</option>
          <option value="CRITICAL">Critical</option>
        </select>
        {data && <span className="text-xs text-gray-400 ml-auto">{data.total} matching records</span>}
      </Card>

      <Card>
        {loading && <LoadingState />}
        {error && <ErrorState message={error} onRetry={load} />}
        {!loading && !error && data && data.records.length === 0 && (
          <EmptyState title="No vulnerabilities match your current filters." subtitle="Try removing a filter or searching for another term." />
        )}
        {!loading && !error && data && data.records.length > 0 && (
          <>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200 text-left text-gray-500 text-xs uppercase tracking-wide">
                  <th className="px-4 py-3">CVE ID</th>
                  <th className="px-4 py-3">Severity</th>
                  <th className="px-4 py-3">CVSS</th>
                  <th className="px-4 py-3">CWE</th>
                  <th className="px-4 py-3">Business Impact</th>
                </tr>
              </thead>
              <tbody>
                {data.records.map((row) => (
                  <tr
                    key={row.cve_id as string}
                    onClick={() => navigate(`/explorer/${row.cve_id}`)}
                    className="border-b border-gray-100 last:border-0 hover:bg-gray-50 cursor-pointer"
                  >
                    <td className="px-4 py-3 font-medium text-brand-primary">{row.cve_id}</td>
                    <td className="px-4 py-3">
                      <SeverityBadge severity={row.cvss_severity as string} />
                    </td>
                    <td className="px-4 py-3 text-gray-700">{row.cvss_base_score}</td>
                    <td className="px-4 py-3 text-gray-700">{row.cwe_ids}</td>
                    <td className="px-4 py-3 text-gray-500 text-xs">{row.business_impact}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="flex items-center justify-between px-4 py-3 border-t border-gray-200">
              <span className="text-xs text-gray-400">
                Page {page} of {totalPages}
              </span>
              <div className="flex gap-2">
                <button
                  disabled={page <= 1}
                  onClick={() => setPage((p) => p - 1)}
                  className="px-3 py-1.5 text-xs font-medium border border-gray-200 rounded-md disabled:opacity-40 hover:bg-gray-50"
                >
                  Previous
                </button>
                <button
                  disabled={page >= totalPages}
                  onClick={() => setPage((p) => p + 1)}
                  className="px-3 py-1.5 text-xs font-medium border border-gray-200 rounded-md disabled:opacity-40 hover:bg-gray-50"
                >
                  Next
                </button>
              </div>
            </div>
          </>
        )}
      </Card>
    </div>
  );
}
