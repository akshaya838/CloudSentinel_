import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Download } from 'lucide-react';
import { PageHeader } from '../components/layout/AppShell';
import { Card, ErrorState, LoadingState } from '../components/shared/States';
import { apiGet, ApiError } from '../services/api';
import type { BriefingResult } from '../types/api';

export function Reports() {
  const [severity, setSeverity] = useState('CRITICAL');
  const [topN, setTopN] = useState(5);
  const [result, setResult] = useState<BriefingResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const generate = () => {
    setLoading(true);
    setError(null);
    apiGet<BriefingResult>('/api/v1/reports/weekly-brief', {
      severity: severity || undefined,
      top_n: topN,
    })
      .then(setResult)
      .catch((e: ApiError) => setError(e.message))
      .finally(() => setLoading(false));
  };

  return (
    <div>
      <PageHeader title="Reports" subtitle="Extractive summarization (custom PageRank) — no LLM required" />

      <Card className="p-5 mb-5 flex items-center gap-3 flex-wrap">
        <select
          value={severity}
          onChange={(e) => setSeverity(e.target.value)}
          className="px-3 py-2 text-sm border border-gray-200 rounded-lg"
        >
          <option value="">All severities</option>
          <option value="CRITICAL">Critical only</option>
          <option value="HIGH">High only</option>
          <option value="MEDIUM">Medium only</option>
          <option value="LOW">Low only</option>
        </select>
        <input
          type="number"
          min={1}
          max={10}
          value={topN}
          onChange={(e) => setTopN(Number(e.target.value))}
          className="w-20 px-3 py-2 text-sm border border-gray-200 rounded-lg"
        />
        <button
          onClick={generate}
          disabled={loading}
          className="px-4 py-2 bg-brand-primary text-white rounded-lg text-sm font-medium disabled:opacity-40 hover:bg-brand-primary-hover"
        >
          Generate Briefing
        </button>
        <button
          disabled
          title="PDF/CSV export is planned for a later phase and is not yet built"
          className="ml-auto px-4 py-2 border border-gray-200 text-gray-400 rounded-lg text-sm font-medium flex items-center gap-2 cursor-not-allowed"
        >
          <Download size={15} /> Export PDF
        </button>
      </Card>

      {loading && <LoadingState label="Ranking and selecting..." />}
      {error && <ErrorState message={error} onRetry={generate} />}

      {result && (
        <Card className="p-5">
          <h2 className="text-sm font-semibold text-gray-800 mb-1">Weekly Vulnerability Brief</h2>
          <p className="text-xs text-gray-400 mb-4">
            From {result.total_candidates} candidate CVEs{severity ? ` (${severity} only)` : ''}
          </p>
          <div className="space-y-3">
            {result.briefing.map((item) => (
              <div key={item.cve_id} className="border-l-2 border-brand-primary pl-4 py-1">
                <div className="flex items-center gap-2">
                  <Link to={`/explorer/${item.cve_id}`} className="text-sm font-semibold text-brand-primary hover:underline">
                    {item.cve_id}
                  </Link>
                  <span className="text-xs text-gray-400">centrality {item.centrality_score}</span>
                </div>
                <p className="text-sm text-gray-600 mt-1">{item.description}</p>
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}
