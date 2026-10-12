import { useState } from 'react';
import { ExternalLink } from 'lucide-react';
import { PageHeader } from '../components/layout/AppShell';
import { Card, ErrorState, EmptyState } from '../components/shared/States';
import { apiPost, ApiError } from '../services/api';
import type { ClassificationResult, LinkedEntities } from '../types/api';

const LABEL_COLORS: Record<string, string> = {
  CVE_ID: 'bg-red-50 text-red-700',
  CWE_ID: 'bg-orange-50 text-orange-700',
  VENDOR_PRODUCT: 'bg-blue-50 text-blue-700',
  ATTACK_VECTOR: 'bg-purple-50 text-purple-700',
};

export function EntityIntelligence() {
  const [text, setText] = useState('');
  const [entities, setEntities] = useState<ClassificationResult['entities'] | null>(null);
  const [links, setLinks] = useState<LinkedEntities | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const extract = () => {
    if (!text.trim()) return;
    setLoading(true);
    setError(null);
    Promise.all([
      apiPost<ClassificationResult>('/api/v1/classification', { text }),
      apiPost<LinkedEntities>('/api/v1/entities/link', { text }),
    ])
      .then(([classification, linked]) => {
        setEntities(classification.entities);
        setLinks(linked);
      })
      .catch((e: ApiError) => setError(e.message))
      .finally(() => setLoading(false));
  };

  const allLinks = links ? [...links.cves, ...links.cwes] : [];

  return (
    <div>
      <PageHeader title="Entity Intelligence" subtitle="NER (spaCy + custom EntityRuler) with automatic MITRE/NVD linking" />

      <Card className="p-5 mb-5">
        <textarea
          placeholder="Paste text containing CVE IDs, CWE IDs, products, or attack vectors..."
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={4}
          className="w-full px-4 py-3 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-primary/30 resize-none"
        />
        <button
          onClick={extract}
          disabled={loading || !text.trim()}
          className="mt-3 px-4 py-2 bg-brand-primary text-white rounded-lg text-sm font-medium disabled:opacity-40 hover:bg-brand-primary-hover"
        >
          Extract Entities
        </button>
      </Card>

      {error && <ErrorState message={error} onRetry={extract} />}

      {entities && (
        <Card className="p-5 mb-5">
          <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">Detected Entities</h2>
          {entities.length === 0 ? (
            <EmptyState title="No entities detected in this text." />
          ) : (
            <div className="flex gap-2 flex-wrap">
              {entities.map((e, i) => (
                <span
                  key={i}
                  className={`px-3 py-1.5 rounded-lg text-sm font-medium ${LABEL_COLORS[e.label] ?? 'bg-gray-100 text-gray-700'}`}
                >
                  {e.text} <span className="opacity-60 text-xs">{e.label}</span>
                </span>
              ))}
            </div>
          )}
        </Card>
      )}

      {allLinks.length > 0 && (
        <Card className="p-5">
          <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">Official References</h2>
          <ul className="space-y-2">
            {allLinks.map((ref) => (
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
        </Card>
      )}
    </div>
  );
}
