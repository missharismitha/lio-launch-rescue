import { TriangleAlert } from 'lucide-react';

const line = (dash?: string) => (
  <svg width="30" height="8" aria-hidden="true">
    <line x1="1" y1="4" x2="29" y2="4" strokeWidth="2" strokeLinecap="round" strokeDasharray={dash} stroke="currentColor" />
  </svg>
);

export function Legend() {
  const item = 'inline-flex items-center gap-2';
  return (
    <ul data-testid="map-legend" aria-label="Legend" className="m-0 flex list-none flex-wrap gap-x-5 gap-y-2 p-0 text-[13px] leading-5 text-ink-2">
      <li className={`${item} text-air`}>
        {line()}
        <span className="text-ink-2">Air</span>
      </li>
      <li className={`${item} text-sea`}>
        {line('7 5')}
        <span className="text-ink-2">Sea</span>
      </li>
      <li className={`${item} text-road`}>
        {line('1.5 5')}
        <span className="text-ink-2">Road</span>
      </li>
      <li className={item}>
        <span className="size-3 rounded-full bg-accent ring-2 ring-white" aria-hidden="true" />
        Hamburg DC
      </li>
      <li className={item}>
        <span className="size-3 rounded-full bg-brand-navy ring-2 ring-white" aria-hidden="true" />
        Supplier
      </li>
      <li className={item}>
        <span className="size-2 rounded-full border border-ink-3 bg-white" aria-hidden="true" />
        Port
      </li>
      <li className={item}>
        <span className="inline-flex size-4 items-center justify-center rounded-full bg-risk text-white ring-2 ring-white" aria-hidden="true">
          <TriangleAlert className="size-2.5" />
        </span>
        Shipment late
      </li>
      <li className={item}>
        <span className="size-3 rounded-full bg-ink-3 ring-2 ring-white" aria-hidden="true" />
        Shipment on time
      </li>
      <li className={item}>
        <span className="inline-flex size-4 items-center justify-center rounded-full bg-sea/25" aria-hidden="true">
          <span className="size-1.5 rounded-full bg-sea" />
        </span>
        Moving to Hamburg
      </li>
      <li className={item}>
        <span className="inline-flex size-4 items-center justify-center rounded-full bg-risk text-[10px] leading-none font-bold text-white ring-2 ring-white" aria-hidden="true">
          3
        </span>
        Several shipments
      </li>
    </ul>
  );
}
