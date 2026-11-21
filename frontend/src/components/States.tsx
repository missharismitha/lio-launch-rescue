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
      <div className="bg-band px-4 py-6 sm:px-8">
        <div className="skeleton mx-auto h-11 max-w-6xl opacity-30" />
      </div>
      <div className="mx-auto grid max-w-6xl gap-4 px-4 py-6 sm:px-8">
        <div className="skeleton h-40" />
        <div className="skeleton h-24" />
      </div>
    </div>
  );
}

export function EmptyState({ message = "Waiting for Soony's data." }: { message?: string }) {
  return (
    <p data-testid="empty-state" className="rounded-card border border-line bg-card p-6 text-ink-2">
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
