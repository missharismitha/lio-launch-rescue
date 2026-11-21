import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';

/* shown only after 300 ms so a fast load never flashes it */
export function Skeleton() {
  const [show, setShow] = useState(false);
  useEffect(() => {
    const t = window.setTimeout(() => setShow(true), 300);
    return () => window.clearTimeout(t);
  }, []);
  if (!show) return <div aria-busy="true" className="min-h-screen" />;
  return (
    <div data-testid="skeleton" role="status" aria-label="Loading" className="min-h-screen">
      <div className="mx-auto grid max-w-[1120px] gap-6 px-4 py-16 sm:px-8">
        <div className="skeleton h-4 w-64" />
        <div className="skeleton h-16 w-72" />
        <div className="skeleton h-40" />
      </div>
    </div>
  );
}

export function EmptyState({ message = "Waiting for Soony's data." }: { message?: string }) {
  return (
    <p data-testid="empty-state" className="py-8 text-ink-2">
      {message}
    </p>
  );
}

export function ErrorState({ onRetry }: { onRetry: () => void }) {
  return (
    <div data-testid="error-state" role="alert" className="mx-auto grid max-w-sm justify-items-start gap-3 p-6 pt-24">
      <p className="text-[17px] font-semibold">Can&apos;t reach the service.</p>
      <p className="text-ink-2">Check your connection, then try again.</p>
      <Button onClick={onRetry}>Retry</Button>
    </div>
  );
}
