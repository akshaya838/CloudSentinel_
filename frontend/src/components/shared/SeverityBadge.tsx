const SEVERITY_STYLES: Record<string, string> = {
  CRITICAL: 'bg-red-50 text-red-700 border-red-200',
  HIGH: 'bg-orange-50 text-orange-700 border-orange-200',
  MEDIUM: 'bg-amber-50 text-amber-700 border-amber-200',
  LOW: 'bg-green-50 text-green-700 border-green-200',
};

export function SeverityBadge({ severity }: { severity: string }) {
  const key = severity?.toUpperCase();
  const style = SEVERITY_STYLES[key] ?? 'bg-gray-50 text-gray-600 border-gray-200';
  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold border ${style}`}>
      {severity}
    </span>
  );
}
