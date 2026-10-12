import { PageHeader } from '../components/layout/AppShell';
import { Card } from '../components/shared/States';
import { ExternalLink } from 'lucide-react';

export function ApiDocs() {
  return (
    <div>
      <PageHeader title="API Documentation" subtitle="Auto-generated from the FastAPI backend" />
      <Card className="p-8 text-center">
        <p className="text-sm text-gray-600 mb-4">
          Interactive Swagger documentation is served directly by the backend (not embeddable
          cross-origin by default) — open it in a new tab:
        </p>
        <a
          href="http://localhost:8000/docs"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-2 px-4 py-2 bg-brand-primary text-white rounded-lg text-sm font-medium hover:bg-brand-primary-hover"
        >
          Open Swagger UI <ExternalLink size={14} />
        </a>
        <p className="text-xs text-gray-400 mt-3">
          ReDoc alternative: <a href="http://localhost:8000/redoc" target="_blank" rel="noopener noreferrer" className="underline">localhost:8000/redoc</a>
        </p>
      </Card>
    </div>
  );
}
