import { useState } from 'react';
import { PageHeader } from '../components/layout/AppShell';
import { Card, ErrorState, LoadingState } from '../components/shared/States';
import { apiGet, ApiError } from '../services/api';
import type { TopicsResult } from '../types/api';

export function TopicDiscovery() {
  const [k, setK] = useState(5);
  const [result, setResult] = useState<TopicsResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const discover = () => {
    setLoading(true);
    setError(null);
    apiGet<TopicsResult>('/api/v1/topics', { k })
      .then(setResult)
      .catch((e: ApiError) => setError(e.message))
      .finally(() => setLoading(false));
  };

  return (
    <div>
      <PageHeader title="Topic Discovery" subtitle="Unsupervised clustering (K-Means over embeddings) — no labels used" />

      <Card className="p-5 mb-5 flex items-center gap-3">
        <label className="text-sm text-gray-600">Number of topics</label>
        <input
          type="number"
          min={2}
          max={10}
          value={k}
          onChange={(e) => setK(Number(e.target.value))}
          className="w-20 px-3 py-1.5 text-sm border border-gray-200 rounded-lg"
        />
        <button
          onClick={discover}
          disabled={loading}
          className="px-4 py-2 bg-brand-primary text-white rounded-lg text-sm font-medium disabled:opacity-40 hover:bg-brand-primary-hover"
        >
          Discover Topics
        </button>
      </Card>

      {loading && <LoadingState label="Clustering CVE embeddings..." />}
      {error && <ErrorState message={error} onRetry={discover} />}

      {result && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {Object.entries(result.topics).map(([id, topic]) => (
            <Card key={id} className="p-5">
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-sm font-semibold text-gray-800">Topic {id}</h3>
                <span className="text-xs text-gray-400">{topic.size} CVEs</span>
              </div>
              <div className="flex gap-1.5 flex-wrap mb-3">
                {topic.top_terms.map((t) => (
                  <span key={t} className="px-2 py-0.5 bg-indigo-50 text-indigo-700 text-xs rounded-md">
                    {t}
                  </span>
                ))}
              </div>
              <p className="text-xs text-gray-400">e.g. {topic.example_cves.join(', ')}</p>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
