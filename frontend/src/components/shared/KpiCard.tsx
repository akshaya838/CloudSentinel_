import type { LucideIcon } from 'lucide-react';
import { Card } from './States';

export function KpiCard({
  label,
  value,
  description,
  icon: Icon,
  accentColor = 'text-brand-primary',
}: {
  label: string;
  value: string | number | null | undefined;
  description?: string;
  icon: LucideIcon;
  accentColor?: string;
}) {
  return (
    <Card className="p-5">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">{label}</p>
          <p className="text-2xl font-bold text-gray-900 mt-1">
            {value === null || value === undefined ? '—' : value}
          </p>
          {description && <p className="text-xs text-gray-400 mt-1">{description}</p>}
        </div>
        <div className={`p-2 rounded-lg bg-gray-50 ${accentColor}`}>
          <Icon size={20} />
        </div>
      </div>
    </Card>
  );
}
