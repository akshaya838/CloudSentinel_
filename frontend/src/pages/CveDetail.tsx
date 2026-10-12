import { useEffect, useState, useCallback } from 'react';
import { useParams, Link } from 'react-router-dom';
import { ArrowLeft, ExternalLink } from 'lucide-react';
import { Card, LoadingState, ErrorState } from '../components/shared/States';
import { SeverityBadge } from '../components/shared/SeverityBadge';
import { apiGet, apiPost, ApiError } from '../services/api';
import type { CveRecord, LinkedEntities } from '../types/api';

export function CveDetail() {
  const { cveId } = useParams<{ cveId: string }>();
  const [cve, setCve] = useState<CveRecord | null>(null);
  const [links, setLinks] = useState<LinkedEntities | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    if (!cveId) return;
    setLoading(true);
    setError(null);
    apiGet<CveRecord>(`/api/v1/cves/${cveId}`)
      .then((data) => {
        setCve(data);
        return apiPost<LinkedEntities>('/api/v1/entities/link', { text: `${data.cve_id} ${data.cwe_ids}` });
      })
      .then(setLinks)
      .catch((e: ApiError) => setError(e.message))
      .finally(() => setLoading(false));
  }, [cveId]);

  useEffect(load, [load]);

  if (loading) return <LoadingState />;
  if (error) return <ErrorState message={error} onRetry={load} />;
  if (!cve) return null;

  return (
    <div>
      <Link to="/explorer" className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-800 mb-4">
        <ArrowLeft size={15} /> Back to Explorer
      </Link>

      <div className="flex items-center gap-3 mb-6">
        <h1 className="text-2xl font-bold text-gray-900">{cve.cve_id}</h1>
        <SeverityBadge severity={cve.cvss_severity} />
        <span className="text-sm text-gray-400">CVSS {cve.cvss_base_score}</span>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        <div className="lg:col-span-2 space-y-5">
          <Card className="p-5">
            <h2 className="text-sm font-semibold text-gray-700 mb-2">Description</h2>
            <p className="text-sm text-gray-600 leading-relaxed">{cve.description}</p>
          </Card>

          <Card className="p-5">
            <h2 className="text-sm font-semibold text-gray-700 mb-3">CIA Impact</h2>
            <div className="flex gap-2 flex-wrap">
              {cve.business_impact.split(';').map((impact) => (
                <span key={impact} className="px-3 py-1 bg-blue-50 text-blue-700 text-xs font-medium rounded-full">
                  {impact}
                </span>
              ))}
            </div>
          </Card>

          <Card className="p-5">
            <h2 className="text-sm font-semibold text-gray-700 mb-3">References</h2>
            {links ? (
              <ul className="space-y-2">
                {[...links.cves, ...links.cwes].map((ref) => (
                  <li key={ref.id}>
                    <a
                      href={ref.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-sm text-brand-primary hover:underline"
                    >
                      {ref.id} {ref.name ? `— ${ref.name}` : ''} <ExternalLink size={12} />
                    </a>
                    <span className="text-xs text-gray-400 ml-2">({ref.kb})</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-xs text-gray-400">No linkable references found.</p>
            )}
          </Card>
        </div>

        <div className="space-y-5">
          <Card className="p-5">
            <h2 className="text-sm font-semibold text-gray-700 mb-3">Risk Overview</h2>
            <dl className="text-sm space-y-2">
              <div className="flex justify-between">
                <dt className="text-gray-400">Severity</dt>
                <dd className="font-medium text-gray-900">{cve.cvss_severity}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-gray-400">CVSS Score</dt>
                <dd className="font-medium text-gray-900">{cve.cvss_base_score}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-gray-400">CWE</dt>
                <dd className="font-medium text-gray-900">{cve.cwe_ids}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-gray-400">Description Length</dt>
                <dd className="font-medium text-gray-900">{cve.description_length} words</dd>
              </div>
            </dl>
          </Card>
        </div>
      </div>
    </div>
  );
}
