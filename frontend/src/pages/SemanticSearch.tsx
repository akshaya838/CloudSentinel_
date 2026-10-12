import { useCallback, useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Search as SearchIcon, Loader2 } from 'lucide-react';
import { PageHeader } from '../components/layout/AppShell';
import { Card, ErrorState, EmptyState } from '../components/shared/States';
import { SeverityBadge } from '../components/shared/SeverityBadge';
import { apiPost, ApiError } from '../services/api';
import type { SearchResult } from '../types/api';

export function SemanticSearch() {
  const [params] = useSearchParams();
  const urlQuery = params.get('q') ?? '';
  const [query, setQuery] = useState(urlQuery);
  const [result, setResult] = useState<SearchResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searched, setSearched] = useState(false);

  const runSearch = useCallback((q: string) => {
    if (!q.trim()) return;
    setLoading(true);
    setError(null);
    setSearched(true);
    apiPost<SearchResult>('/api/v1/search', { query: q, top_k: 8 })
      .then(setResult)
      .catch((e: ApiError) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  // Arriving from the top-bar search (?q=...) runs the query immediately.
  useEffect(() => {
    if (urlQuery.trim()) {
      setQuery(urlQuery);
      runSearch(urlQuery);
    }
  }, [urlQuery, runSearch]);

  return (
    <div>
      <PageHeader
        title="Semantic Search"
        subtitle="Searches by meaning (embedding similarity), not just keyword matching"
      />

      <Card className="p-5 mb-5">
        <div className="flex gap-3">
          <input
            type="text"
            placeholder='e.g. "Find critical vulnerabilities that allow remote code execution without authentication"'
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && runSearch(query)}
            className="flex-1 px-4 py-2.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-primary/30"
          />
          <button
            onClick={() => runSearch(query)}
            disabled={loading || !query.trim()}
            className="px-4 py-2.5 bg-brand-primary text-white rounded-lg text-sm font-medium disabled:opacity-40 hover:bg-brand-primary-hover flex items-center gap-2"
          >
            {loading ? <Loader2 className="animate-spin" size={16} /> : <SearchIcon size={16} />}
            Search
          </button>
        </div>
      </Card>

      {error && <ErrorState message={error} onRetry={() => runSearch(query)} />}

      {!loading && searched && !error && result && result.results.length === 0 && (
        <EmptyState title="No matching vulnerabilities found." subtitle="Try a broader or differently-worded query." />
      )}

      {result && result.results.length > 0 && (
        <div className="space-y-3">
          {result.results.map((hit, i) => (
            <Card key={i} className="p-4">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <Link to={`/explorer/${hit.metadata.source_id}`} className="text-sm font-semibold text-brand-primary hover:underline">
                    {hit.metadata.source_id}
                  </Link>
                  <SeverityBadge severity={hit.metadata.cvss_severity} />
                </div>
                <span className="text-xs text-gray-400">
                  relevance: {(1 - hit.distance).toFixed(3)}
                </span>
              </div>
              <p className="text-sm text-gray-600">{hit.text}</p>
              <p className="text-xs text-gray-400 mt-2">
                Matched on semantic similarity to your query — business impact: {hit.metadata.business_impact}
              </p>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
