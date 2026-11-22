import { CloudOff, Inbox } from 'lucide-react';
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
      <div className="hero-bg h-[300px]" />
      <div className="mx-auto grid max-w-[1200px] gap-6 px-4 py-8 sm:px-8">
        <div className="skeleton h-24 rounded-card" />
        <div className="grid gap-6 lg:grid-cols-2">
          <div className="skeleton h-56 rounded-card" />
          <div className="skeleton h-56 rounded-card" />
        </div>
      </div>
    </div>
  );
}

export function EmptyState({ message = "Waiting for Soony's data." }: { message?: string }) {
  return (
    <div className="card grid justify-items-center gap-2 px-6 py-12 text-center">
      <span className="grid size-12 place-items-center rounded-full bg-brand-tint text-brand">
        <Inbox className="size-6" aria-hidden="true" />
      </span>
      <p data-testid="empty-state" className="m-0 text-ink-2">
        {message}
      </p>
    </div>
  );
}

export function ErrorState({ onRetry }: { onRetry: () => void }) {
  return (
    <div data-testid="error-state" role="alert" className="card mx-auto mt-24 grid max-w-sm justify-items-start gap-3 p-6">
      <span className="grid size-10 place-items-center rounded-full bg-risk-tint text-risk">
        <CloudOff className="size-5" aria-hidden="true" />
      </span>
      <p className="m-0 text-[17px] font-semibold">Can&apos;t reach the service.</p>
      <p className="m-0 text-ink-2">Check your connection, then try again.</p>
      <Button onClick={onRetry}>Retry</Button>
    </div>
  );
}
