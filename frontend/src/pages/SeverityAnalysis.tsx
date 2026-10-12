import { useState } from 'react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import { PageHeader } from '../components/layout/AppShell';
import { Card, ErrorState, LoadingState } from '../components/shared/States';
import { SeverityBadge } from '../components/shared/SeverityBadge';
import { VoiceInput, languageName, type VoiceResult } from '../components/shared/VoiceInput';
import { apiPost, ApiError } from '../services/api';
import type { ClassificationResult } from '../types/api';

export function SeverityAnalysis() {
  const [text, setText] = useState('');
  const [result, setResult] = useState<ClassificationResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [autoClassify, setAutoClassify] = useState(true);
  const [heard, setHeard] = useState<VoiceResult | null>(null);

  const classify = (value: string = text) => {
    if (!value.trim()) return;
    setLoading(true);
    setError(null);
    apiPost<ClassificationResult>('/api/v1/classification', { text: value })
      .then(setResult)
      .catch((e: ApiError) => setError(e.message))
      .finally(() => setLoading(false));
  };

  // Dictation adds to what is already in the box, like any dictation tool.
  const onVoice = (r: VoiceResult) => {
    const next = text.trim() ? `${text.trim()} ${r.text}` : r.text;
    setText(next);
    setHeard(r);
    if (autoClassify && r.classifiable) classify(next);
  };

  const chartData = result?.severity_prediction.contributing_words
    .slice()
    .sort((a, b) => a.weight - b.weight)
    .map((w) => ({ word: w.word, weight: Number(w.weight.toFixed(3)) }));

  return (
    <div>
      <PageHeader title="Severity Analysis" subtitle="TF-IDF + Logistic Regression, explained with LIME. Type, paste, or speak the description." />

      <Card className="p-5 mb-5">
        <textarea
          placeholder="Paste a CVE description to classify..."
          aria-label="CVE description"
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={4}
          className="w-full px-4 py-3 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-primary/30 resize-none"
        />

        <div className="mt-3 flex flex-wrap items-start gap-x-6 gap-y-3">
          <button
            onClick={() => classify()}
            disabled={loading || !text.trim()}
            className="px-4 py-2 bg-brand-primary text-white rounded-lg text-sm font-medium disabled:opacity-40 hover:bg-brand-primary-hover"
          >
            Classify
          </button>
          <VoiceInput onResult={onVoice} disabled={loading} />
          <label className="flex items-center gap-2 text-sm text-gray-600 cursor-pointer py-2">
            <input
              type="checkbox"
              checked={autoClassify}
              onChange={(e) => setAutoClassify(e.target.checked)}
              className="h-4 w-4 rounded border-gray-300 text-brand-primary"
            />
            Classify automatically after I speak
          </label>
        </div>

        {heard && (
          <div className="mt-4 rounded-lg bg-gray-50 p-3 text-xs text-gray-600" data-testid="heard">
            <p>
              Heard ({languageName(heard.language)}): <span className="italic">“{heard.heard}”</span>
            </p>
            {heard.translated && <p className="mt-1">Translated to English and added to the text above.</p>}
            {heard.notice && <p className="mt-1 text-amber-700">{heard.notice}</p>}
            <p className="mt-1 text-gray-400">Check the text above for misheard words (especially CVE and CWE numbers) before relying on the result.</p>
          </div>
        )}
      </Card>

      {loading && <LoadingState label="Running classifier..." />}
      {error && <ErrorState message={error} onRetry={() => classify()} />}

      {result && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          <Card className="p-5">
            <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">Prediction</h2>
            <div className="flex items-center gap-3 mb-4">
              <SeverityBadge severity={result.severity_prediction.predicted_severity} />
              <span className="text-sm text-gray-500">
                {(result.severity_prediction.confidence * 100).toFixed(1)}% confidence
              </span>
            </div>
            <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Business Impact</h3>
            <div className="flex gap-2 flex-wrap mb-4">
              {result.business_impact.map((b) => (
                <span key={b} className="px-2.5 py-1 bg-blue-50 text-blue-700 text-xs font-medium rounded-full">
                  {b}
                </span>
              ))}
            </div>
            <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Extracted Entities</h3>
            <div className="flex gap-2 flex-wrap">
              {result.entities.length === 0 && <span className="text-xs text-gray-400">None found</span>}
              {result.entities.map((e, i) => (
                <span key={i} className="px-2 py-1 bg-gray-100 text-gray-700 text-xs rounded-md">
                  {e.text} <span className="text-gray-400">({e.label})</span>
                </span>
              ))}
            </div>
          </Card>

          <Card className="p-5">
            <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">
              Why? Important Features (LIME)
            </h2>
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={chartData} layout="vertical" margin={{ left: 20 }}>
                <XAxis type="number" tick={{ fontSize: 11 }} />
                <YAxis type="category" dataKey="word" width={110} tick={{ fontSize: 11 }} />
                <Tooltip />
                <Bar dataKey="weight" radius={[0, 4, 4, 0]}>
                  {chartData?.map((d, i) => (
                    <Cell key={i} fill={d.weight > 0 ? '#dc2626' : '#2563eb'} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </Card>
        </div>
      )}
    </div>
  );
}
