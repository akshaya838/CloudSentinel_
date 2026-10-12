import type { ReactNode } from 'react';
import { AlertTriangle, Inbox, Loader2, Lock } from 'lucide-react';

export function LoadingState({ label = 'Loading...' }: { label?: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-gray-500">
      <Loader2 className="animate-spin mb-3" size={28} />
      <p className="text-sm">{label}</p>
    </div>
  );
}

export function ErrorState({
  message,
  onRetry,
}: {
  message: string;
  onRetry?: () => void;
}) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center px-6">
      <AlertTriangle className="text-amber-500 mb-3" size={28} />
      <p className="text-sm text-gray-700 max-w-md mb-4">{message}</p>
      {onRetry && (
        <button
          onClick={onRetry}
          className="px-4 py-2 text-sm font-medium rounded-md bg-brand-primary text-white hover:bg-brand-primary-hover transition-colors"
        >
          Retry
        </button>
      )}
    </div>
  );
}

export function EmptyState({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center px-6 text-gray-500">
      <Inbox className="mb-3" size={28} />
      <p className="text-sm font-medium text-gray-700">{title}</p>
      {subtitle && <p className="text-xs mt-1 max-w-md">{subtitle}</p>}
    </div>
  );
}

export function ForbiddenState({ feature, role }: { feature: string; role: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center px-6 text-gray-500">
      <Lock className="mb-3" size={28} />
      <p className="text-sm font-medium text-gray-700">You don't have access to {feature}</p>
      <p className="text-xs mt-1 max-w-md">
        Your role ({role}) doesn't include this area. Ask an administrator if you need access.
      </p>
    </div>
  );
}

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <div className={`bg-white border border-gray-200 rounded-xl shadow-sm ${className}`}>
      {children}
    </div>
  );
}
