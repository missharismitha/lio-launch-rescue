import { useState } from 'react';
import { cn } from '@/lib/cn';
import type { PartInfo } from '@/lib/parts';

/* Part picture on a soft tile. Falls back to the icon when there is no picture or it fails to load. */
export function PartImage({ part, size = 64, className }: { part: PartInfo; size?: number; className?: string }) {
  const [failed, setFailed] = useState(false);
  const Icon = part.icon;
  const inner = Math.round(size * 0.82);
  return (
    <span
      data-testid="part-image"
      className={cn('inline-flex shrink-0 items-center justify-center rounded-control bg-brand-tint text-brand', className)}
      style={{ width: size, height: size }}
    >
      {part.img && !failed ? (
        <img src={part.img} alt={part.name} width={inner} height={inner} loading="eager" onError={() => setFailed(true)} className="object-contain" style={{ width: inner, height: inner }} />
      ) : (
        <span role="img" aria-label={part.name} data-testid="part-icon" className="inline-flex">
          <Icon aria-hidden="true" style={{ width: Math.round(size * 0.5), height: Math.round(size * 0.5) }} />
        </span>
      )}
    </span>
  );
}
