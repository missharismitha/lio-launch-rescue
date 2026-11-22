import { ArrowRight, Play, RefreshCw } from 'lucide-react';
import { NumberTicker } from '@/components/ui/number-ticker';
import { Button } from '@/components/ui/button';
import { useLaunch } from '@/hooks/useLaunch';
import { useUi } from '@/hooks/useUi';
import { cardState, nounOf, shortLines } from '@/lib/derive';
import { dayLong, deadlineTime, hrs, num } from '@/lib/format';
import type { Detail, Overview, Product } from '@/lib/types';

/* ---------- pure helpers (tested) ---------- */
export const ringPercent = (packed?: number | null, target?: number | null): number => {
  if (typeof packed !== 'number' || typeof target !== 'number' || !Number.isFinite(packed) || !Number.isFinite(target) || target <= 0) return 0;
  return Math.max(0, Math.min(100, (packed / target) * 100));
};

export function pickProducts(o: Overview): { standard?: Product; collectors?: Product } {
  const ps = o.products || [];
  const collectors = ps.find((p) => /collector/i.test(p.name || ''));
  const standard = ps.find((p) => p !== collectors);
  return { standard, collectors };
}

export interface HeroAction {
  label: string;
  run: boolean;
}

/* the same step the decision card offers; only the 'run' states act here, every other state scrolls to the card */
export function heroAction(d: Detail, o: Overview): HeroAction | null {
  const st = cardState(d, !!o.agent?.error, !!o.integrations?.ai_enabled, !!o.integrations?.email_enabled);
  switch (st.kind) {
    case 'no_gap':
      return null;
    case 'run':
      return { label: st.label, run: true };
    case 'approve':
      return { label: 'Review and approve', run: false };
    case 'replied':
      return { label: 'Review reply', run: false };
    case 'offer':
      return { label: 'See offer', run: false };
    case 'approved_partial':
      return { label: 'Approve escalation', run: false };
    case 'approved_manual':
    case 'approved_send':
      return { label: 'Send it', run: false };
    default:
      return { label: 'See status', run: false };
  }
}

/* ---------- ring ---------- */
const R = 52;
const C = 2 * Math.PI * R;

export function ProductRing({ name, product, src, alt, float }: { name: string; product?: Product; src: string; alt: string; float: 'float-a' | 'float-b' }) {
  const known = typeof product?.packed === 'number' && typeof product?.target === 'number' && product.target > 0;
  const pct = ringPercent(product?.packed, product?.target);
  const offset = C * (1 - pct / 100);
  return (
    <figure data-testid="product-ring" className="m-0 grid min-w-0 justify-items-center gap-2 sm:gap-3">
      <div className="relative grid aspect-square w-full max-w-[140px] place-items-center sm:max-w-[190px]">
        <svg viewBox="0 0 120 120" className="absolute inset-0 size-full -rotate-90" role="img" aria-label={known ? `${name}: ${Math.round(pct)} percent packed` : `${name}: packing unknown`}>
          <circle cx="60" cy="60" r={R} fill="none" stroke="rgba(255,255,255,0.18)" strokeWidth="7" />
          {known ? (
            <circle
              data-testid="ring-arc"
              data-percent={Math.round(pct)}
              className="ring-anim"
              cx="60"
              cy="60"
              r={R}
              fill="none"
              stroke="#ffffff"
              strokeWidth="7"
              strokeLinecap="round"
              strokeDasharray={C}
              strokeDashoffset={offset}
              style={{ ['--ring-c' as string]: C }}
            />
          ) : null}
        </svg>
        <img src={src} alt={alt} className={`${float} relative h-[64px] w-auto max-w-[64px] object-contain drop-shadow-[0_10px_14px_rgba(0,0,0,0.35)] min-[400px]:h-[76px] min-[400px]:max-w-[76px] sm:h-[120px] sm:max-w-[120px]`} />
      </div>
      <figcaption className="grid justify-items-center gap-0.5 text-center">
        <span className="text-[13px] font-semibold text-white sm:text-[14px]">{name}</span>
        <span className="num text-[13px] text-white/85 sm:text-[14px]" data-testid="ring-numbers">
          {known ? `${num(product!.packed)} / ${num(product!.target)}` : 'unknown'}
        </span>
        <span className="num text-[12px] text-white/70">{known ? `${Math.round(pct)}% packed` : 'not reported'}</span>
      </figcaption>
    </figure>
  );
}

/* ---------- hero ---------- */
export function Hero({ d, o }: { d: Detail; o: Overview }) {
  const launch = useLaunch();
  const ui = useUi();
  const lines = shortLines(d);
  const total = lines.reduce((s, l) => s + (l.short || 0), 0);
  const gap = lines.length ? total : (d.shortage ?? 0);
  const unit = lines.length ? `${lines.map((l) => l.name).join(' and ')} copies short` : gap > 0 ? `${nounOf(d)} short` : '';
  const day = dayLong(o.launch_date);
  const time = deadlineTime(d.brief?.deadline);
  const left = o.pack_status?.hours_left;
  const act = heroAction(d, o);
  const running = launch.busy || !!o.agent?.running;
  const { standard, collectors } = pickProducts(o);

  const go = () => {
    if (act?.run) {
      void (act.label === 'Draft the request' ? launch.draftOnly() : launch.runAgent());
      return;
    }
    const el = document.getElementById('decision');
    if (!el) {
      ui.openSheet('brief', 'hero-action');
      return;
    }
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    (el.querySelector('button') as HTMLElement | null)?.focus({ preventScroll: true });
  };

  let status: string;
  if (gap > 0) status = typeof left === 'number' && left > 0 ? `${hrs(left)} of packing left.${d.supplier?.name ? ` Waiting on ${d.supplier.name}.` : ''}` : 'Parts are missing for launch.';
  else status = d.shortage == null ? 'Needs a check before launch.' : 'Nothing is missing right now.';

  return (
    <section data-demo="problem" aria-label="Launch status" className="hero-bg on-dark text-white">
      <div className="mx-auto grid max-w-[1200px] grid-cols-1 items-center gap-8 px-4 py-8 sm:gap-10 sm:px-8 sm:py-14 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
        <div className="grid min-w-0 content-center justify-items-start gap-4">
          <p className="m-0 text-[12px] font-semibold tracking-[0.14em] text-white/75 uppercase">
            Grand Heist 6{day ? `. Ships ${day}${time ? `, ${time}` : ''}` : ''}
          </p>
          <h1 className="m-0 grid gap-1" data-testid="hero-headline">
            {gap > 0 ? (
              <>
                <span className="flex items-baseline gap-3">
                  <NumberTicker value={gap} className="num text-[64px] leading-[64px] font-semibold tracking-[-0.04em] sm:text-[104px] sm:leading-[104px]" testId="short-count" />
                  <span className="text-[24px] leading-8 font-semibold sm:text-[32px]">short</span>
                </span>
                <span className="text-[16px] leading-6 text-white/80">{unit}</span>
              </>
            ) : (
              <span className="text-[34px] leading-[42px] font-semibold tracking-[-0.01em] sm:text-[44px] sm:leading-[52px]">{d.shortage == null ? 'Needs a check' : 'All parts covered'}</span>
            )}
          </h1>
          <p className="m-0 max-w-[40ch] text-[17px] leading-6 text-white/90" data-testid="hero-status">
            {status}
          </p>
          {act ? (
            <Button variant="light" data-testid="hero-action" id="hero-action" onClick={go} disabled={running && act.run} className="mt-1 w-full sm:w-auto sm:justify-self-start">
              {running && act.run ? (
                <>
                  <RefreshCw className="spin size-4" aria-hidden="true" />
                  Working…
                </>
              ) : (
                <>
                  {act.label}
                  <ArrowRight className="size-4" aria-hidden="true" />
                </>
              )}
            </Button>
          ) : null}
          <button
            type="button"
            data-testid="hero-demo"
            onClick={() => { ui.closeSheet(); ui.setDemoOpen(true); }}
            className="inline-flex min-h-10 cursor-pointer items-center gap-2 rounded-control border-0 bg-transparent px-0 text-[15px] font-semibold text-white underline underline-offset-4 hover:text-brand-100 focus-visible:outline-2 focus-visible:outline-white"
          >
            <Play className="size-4 fill-current" aria-hidden="true" />
            Watch the 2-minute demo
          </button>
        </div>
        <div className="grid min-w-0 grid-cols-2 justify-items-center gap-2 sm:gap-8" data-testid="hero-products">
          <ProductRing name="Standard" product={standard} src="/img/box-standard.png" alt="Standard Edition game box" float="float-a" />
          <ProductRing name="Collector's" product={collectors} src="/img/box-collectors.png" alt="Collector's Edition box" float="float-b" />
        </div>
      </div>
    </section>
  );
}
