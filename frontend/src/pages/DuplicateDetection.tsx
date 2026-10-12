import { useState } from 'react';
import { Link } from 'react-router-dom';
import { PageHeader } from '../components/layout/AppShell';
import { Card, ErrorState, LoadingState, EmptyState } from '../components/shared/States';
import { apiGet, ApiError } from '../services/api';
import type { DuplicatesResult } from '../types/api';

export function DuplicateDetection() {
  const [threshold, setThreshold] = useState(0.85);
  const [result, setResult] = useState<DuplicatesResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = () => {
    setLoading(true);
    setError(null);
    apiGet<DuplicatesResult>('/api/v1/duplicates', { threshold })
      .then(setResult)
      .catch((e: ApiError) => setError(e.message))
      .finally(() => setLoading(false));
  };

  return (
    <div>
      <PageHeader title="Duplicate Detection" subtitle="Flags near-identical or related vulnerability reports via embedding similarity" />

      <Card className="p-5 mb-5 flex items-center gap-4">
        <label className="text-sm text-gray-600">Similarity threshold</label>
        <input
          type="range"
          min={0.5}
          max={0.99}
          step={0.01}
          value={threshold}
          onChange={(e) => setThreshold(Number(e.target.value))}
          className="w-48"
        />
        <span className="text-sm font-medium text-gray-700 w-12">{threshold.toFixed(2)}</span>
        <button
          onClick={run}
          disabled={loading}
          className="ml-auto px-4 py-2 bg-brand-primary text-white rounded-lg text-sm font-medium disabled:opacity-40 hover:bg-brand-primary-hover"
        >
          Scan for Duplicates
        </button>
      </Card>

      {loading && <LoadingState label="Comparing all CVE pairs..." />}
      {error && <ErrorState message={error} onRetry={run} />}

      {result && result.near_duplicate_pairs.length === 0 && (
        <EmptyState title="No near-duplicate pairs found above this threshold." subtitle="Try lowering the threshold." />
      )}

      {result && result.near_duplicate_pairs.length > 0 && (
        <Card>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 text-left text-gray-500 text-xs uppercase tracking-wide">
                <th className="px-4 py-3">CVE A</th>
                <th className="px-4 py-3">CVE B</th>
                <th className="px-4 py-3">Similarity</th>
              </tr>
            </thead>
            <tbody>
              {result.near_duplicate_pairs.map((p, i) => (
                <tr key={i} className="border-b border-gray-100 last:border-0">
                  <td className="px-4 py-3">
                    <Link to={`/explorer/${p.cve_a}`} className="text-brand-primary hover:underline font-medium">
                      {p.cve_a}
                    </Link>
                  </td>
                  <td className="px-4 py-3">
                    <Link to={`/explorer/${p.cve_b}`} className="text-brand-primary hover:underline font-medium">
                      {p.cve_b}
                    </Link>
                  </td>
                  <td className="px-4 py-3 font-medium text-gray-700">{(p.similarity * 100).toFixed(1)}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}
