import { useEffect, useState, useCallback } from 'react';
import { CheckCircle2, Circle } from 'lucide-react';
import { PageHeader } from '../components/layout/AppShell';
import { Card, ErrorState, LoadingState } from '../components/shared/States';
import { apiGet, ApiError } from '../services/api';
import type { PipelineStatus } from '../types/api';

export function DataPipeline() {
  const [status, setStatus] = useState<PipelineStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    apiGet<PipelineStatus>('/api/v1/pipeline/status')
      .then(setStatus)
      .catch((e: ApiError) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(load, [load]);

  return (
    <div>
      <PageHeader title="Data Pipeline" subtitle="Raw data → cleaning → normalization → embedding → vector index" />

      {loading && <LoadingState />}
      {error && <ErrorState message={error} onRetry={load} />}

      {status && (
        <Card className="p-5">
          <ul className="space-y-4">
            {status.stages.map((s) => (
              <li key={s.stage} className="flex items-center gap-3">
                {s.status === 'complete' ? (
                  <CheckCircle2 className="text-green-500" size={20} />
                ) : (
                  <Circle className="text-gray-300" size={20} />
                )}
                <span className={`text-sm ${s.status === 'complete' ? 'text-gray-800' : 'text-gray-400'}`}>
                  {s.stage}
                </span>
                <span
                  className={`ml-auto text-xs font-medium px-2 py-0.5 rounded-full ${
                    s.status === 'complete' ? 'bg-green-50 text-green-700' : 'bg-gray-100 text-gray-500'
                  }`}
                >
                  {s.status}
                </span>
              </li>
            ))}
          </ul>
          <div className="mt-6 pt-4 border-t border-gray-100">
            <button
              disabled
              title="Triggering the pipeline from the API needs a background-job layer, not yet built — run the scripts manually for now (see README)"
              className="px-4 py-2 border border-gray-200 text-gray-400 rounded-lg text-sm font-medium cursor-not-allowed"
            >
              Run Pipeline
            </button>
            <p className="text-xs text-gray-400 mt-2">
              For now, run manually: <code className="bg-gray-50 px-1 py-0.5 rounded">python -m ml.etl.etl_pipeline</code>,{' '}
              <code className="bg-gray-50 px-1 py-0.5 rounded">python -m ml.eda.eda_analysis</code>, then{' '}
              <code className="bg-gray-50 px-1 py-0.5 rounded">build_index.py</code> in <code className="bg-gray-50 px-1 py-0.5 rounded">ml/rag/</code>.
            </p>
          </div>
        </Card>
      )}
    </div>
  );
}
