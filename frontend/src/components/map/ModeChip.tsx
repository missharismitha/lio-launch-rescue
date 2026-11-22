import { Plane, Ship, Truck, type LucideIcon } from 'lucide-react';
import { cap } from '@/lib/format';

const ICON: Record<string, LucideIcon> = { air: Plane, sea: Ship, road: Truck };
const TONE: Record<string, string> = {
  air: 'bg-air/10 text-ink border-air/40',
  sea: 'bg-sea/10 text-ink border-sea/40',
  road: 'bg-road/10 text-ink border-road/40',
};
const ICON_TONE: Record<string, string> = { air: 'text-air', sea: 'text-sea', road: 'text-road' };

export function ModeIcon({ mode, className = 'size-4' }: { mode?: string; className?: string }) {
  const I = ICON[mode || ''];
  return I ? <I className={`${className} ${ICON_TONE[mode || '']}`} aria-hidden="true" /> : null;
}

/* mode chip: icon + word, tinted by mode colour (text stays ink) */
export function ModeChip({ mode }: { mode?: string }) {
  return (
    <span className={`inline-flex w-fit justify-self-start self-start items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[13px] leading-5 font-semibold ${TONE[mode || ''] || 'border-line bg-page text-ink'}`}>
      <ModeIcon mode={mode} className="size-3.5" />
      {cap(mode) || 'Mode'}
    </span>
  );
}
