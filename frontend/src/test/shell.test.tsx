import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { LazyMotion, domAnimation } from 'motion/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Hero, heroAction, pickProducts, ringPercent } from '@/components/Hero';
import { BomSection, Parts } from '@/components/Parts';
import { Header, dataLive, dataState } from '@/components/Header';
import { LaunchContext, type Launch } from '@/hooks/useLaunch';
import { UiProvider } from '@/hooks/useUi';
import { countdownText, launchCountdown, launchInstant } from '@/lib/countdown';
import type { Detail, Overview } from '@/lib/types';

afterEach(cleanup);

const noop = vi.fn(async () => true);
const launch = (): Launch => ({
  status: 'ready', overview: null, detail: null, selected: 'a', busy: false,
  selectCase: vi.fn(), retry: vi.fn(), act: noop, runAgent: noop, draftOnly: noop, sendMail: noop, syncNow: noop,
  approve: noop, reviewReply: noop, ensureDraft: noop,
});

function hero(d: Detail, o: Overview) {
  return render(
    <LazyMotion features={domAnimation}>
      <LaunchContext.Provider value={launch()}>
        <UiProvider>
          <Hero d={d} o={o} />
        </UiProvider>
      </LaunchContext.Provider>
    </LazyMotion>,
  );
}

const prods = [
  { id: 's', name: 'Standard', packed: 400, target: 800 },
  { id: 'c', name: "Collector's", packed: 512000, target: 640000 },
];

describe('countdown', () => {
  it('formats Xh Ym, rounds minutes down, and says Launched after', () => {
    expect(countdownText(5 * 3600e3 + 7 * 60e3 + 59e3)).toBe('5h 7m');
    expect(countdownText(59e3)).toBe('0h 0m');
    expect(countdownText(0)).toBe('Launched');
    expect(countdownText(-1000)).toBe('Launched');
    expect(countdownText(NaN)).toBe('');
  });
  it('launch is 20:00 Berlin time (winter UTC+1, summer UTC+2)', () => {
    expect(new Date(launchInstant('2026-11-22')!).toISOString()).toBe('2026-11-22T19:00:00.000Z');
    expect(new Date(launchInstant('2026-07-05')!).toISOString()).toBe('2026-07-05T18:00:00.000Z');
    expect(launchInstant(null)).toBeNull();
    expect(launchInstant('soon')).toBeNull();
  });
  it('counts down from now', () => {
    const now = Date.parse('2026-11-22T14:30:00Z');
    expect(launchCountdown('2026-11-22', now)).toBe('4h 30m');
    expect(launchCountdown('2026-11-22', Date.parse('2026-11-22T19:00:00Z'))).toBe('Launched');
    expect(launchCountdown(undefined, now)).toBe('');
  });
  it('data dot is green only with a sync and no error', () => {
    expect(dataLive({ sync: { last_success: 'x', error: null } })).toBe(true);
    expect(dataLive({ sync: { last_success: 'x', error: 'boom' } })).toBe(false);
    expect(dataLive({})).toBe(false);
  });
});

describe('data status', () => {
  const now = Date.parse('2026-11-22T12:00:00Z');
  it('checking when no sync yet, live when fresh, stale when old or errored', () => {
    expect(dataState({}, now)).toBe('checking');
    expect(dataState({ sync: { last_success: null } }, now)).toBe('checking');
    expect(dataState({ sync: { last_success: '2026-11-22T11:55:00Z', error: null } }, now)).toBe('live');
    expect(dataState({ sync: { last_success: '2026-11-22T11:40:00Z', error: null } }, now)).toBe('stale');
    expect(dataState({ sync: { last_success: '2026-11-22T11:59:00Z', error: 'boom' } }, now)).toBe('stale');
  });
  it('header shows Checking data with a pulsing dot, never Data stale, without a sync', () => {
    render(
      <LaunchContext.Provider value={launch()}>
        <UiProvider>
          <Header d={null} o={{}} />
        </UiProvider>
      </LaunchContext.Provider>,
    );
    const el = screen.getByTestId('data-status');
    expect(el.textContent).toBe('Checking data');
    expect(el.querySelector('i')?.className).toContain('animate-pulse');
    expect(screen.queryByText('Data stale')).toBeNull();
  });
});

describe('layout guards', () => {
  it('no element in the hero or header has an inline fixed width above 390px', () => {
    const { container } = hero({ shortage: 5, case: {} }, { products: prods });
    const bad = Array.from(container.querySelectorAll<HTMLElement>('[style]')).filter((e) => parseFloat(e.style.width || '0') > 390 || parseFloat(e.style.minWidth || '0') > 390);
    expect(bad.length).toBe(0);
  });
  it('bom row wraps to 2 columns on phones and hides arrows below md', () => {
    const { container } = render(<BomSection o={{}} />);
    expect(screen.getByTestId('bom-row').className).toContain('grid-cols-2');
    container.querySelectorAll('li > svg').forEach((a) => expect(a.getAttribute('class')).toContain('hidden'));
  });
});

describe('Hero', () => {
  it('shows the one headline number, the rings and the primary action', () => {
    const d: Detail = { shortage: 6800, case: {}, allocation: { lines: [{ name: "Collector's", short: 6800 }] } };
    hero(d, { products: prods, integrations: { ai_enabled: true }, pack_status: { hours_left: 20 } });
    expect(screen.getByTestId('short-count').getAttribute('aria-label')).toBe('6,800');
    expect(screen.getByTestId('hero-headline').textContent).toContain('short');
    const nums = screen.getAllByTestId('ring-numbers').map((n) => n.textContent);
    expect(nums).toEqual(['400 / 800', '512,000 / 640,000']);
    expect(screen.getByAltText('Standard Edition game box')).toBeTruthy();
    expect(screen.getByAltText("Collector's Edition box")).toBeTruthy();
    expect(screen.getByTestId('hero-action').textContent).toContain('Run agent');
  });
  it('missing products stay unknown and draw no arc', () => {
    hero({ shortage: 5, case: {} }, {});
    expect(screen.getAllByTestId('ring-numbers').map((n) => n.textContent)).toEqual(['unknown', 'unknown']);
    expect(screen.queryAllByTestId('ring-arc').length).toBe(0);
  });
  it('unknown shortage is honest, not zero', () => {
    hero({ case: {} }, {});
    expect(screen.getByTestId('hero-headline').textContent).toContain('Needs a check');
  });
  it('run action calls the agent', () => {
    const l = launch();
    render(
      <LazyMotion features={domAnimation}>
        <LaunchContext.Provider value={l}>
          <UiProvider>
            <Hero d={{ shortage: 5, case: {} }} o={{ integrations: { ai_enabled: true } }} />
          </UiProvider>
        </LaunchContext.Provider>
      </LazyMotion>,
    );
    fireEvent.click(screen.getByTestId('hero-action'));
    expect(l.runAgent).toHaveBeenCalled();
  });
  it('ring percent clamps to 0..100 and survives bad numbers', () => {
    expect(ringPercent(50, 100)).toBe(50);
    expect(ringPercent(150, 100)).toBe(100);
    expect(ringPercent(-5, 100)).toBe(0);
    expect(ringPercent(5, 0)).toBe(0);
    expect(ringPercent(undefined, 10)).toBe(0);
    expect(ringPercent(NaN, 10)).toBe(0);
  });
  it('matches the collector edition by name', () => {
    const { standard, collectors } = pickProducts({ products: prods });
    expect(collectors?.id).toBe('c');
    expect(standard?.id).toBe('s');
    expect(pickProducts({}).collectors).toBeUndefined();
  });
  it('has no action when nothing is missing', () => {
    expect(heroAction({ shortage: 0, case: {} }, {})).toBeNull();
    expect(heroAction({ shortage: 3, case: {}, brief: {} }, {})?.run).toBe(false);
  });
});

describe('Parts', () => {
  const o: Overview = { issues: [{ id: 'a', title: 'Game cards: x', shortage: 6800 }, { id: 'b', title: 'Art books: y', shortage: 0 }, { id: 'c', title: 'Statues: z' }] };
  it('renders one tile per issue with a status word', () => {
    render(<Parts o={o} />);
    const tiles = screen.getAllByTestId('part-tile');
    expect(tiles.map((t) => t.getAttribute('data-status'))).toEqual(['short', 'ok', 'review']);
    expect(tiles[0].textContent).toContain('6,800');
    expect(tiles[0].textContent).toContain('Short');
    expect(tiles[1].textContent).toContain('OK');
    expect(tiles[2].textContent).toContain('unknown');
  });
  it('toggles the part row between the two editions', () => {
    render(<BomSection o={o} />);
    expect(screen.getAllByTestId('bom-card').length).toBe(8);
    expect(screen.getByTestId('bom-box-image').getAttribute('src')).toBe('/img/box-collectors.png');
    fireEvent.click(screen.getByText('Standard'));
    expect(screen.getAllByTestId('bom-card').length).toBe(4);
    expect(screen.getByTestId('bom-box-image').getAttribute('src')).toBe('/img/box-standard.png');
  });
  it('tiles select a case when a handler is given', () => {
    const onSelect = vi.fn();
    render(<Parts o={o} selected="a" onSelect={onSelect} />);
    fireEvent.click(screen.getAllByTestId('part-tile')[1]);
    expect(onSelect).toHaveBeenCalledWith('b');
  });
  it('renders without issues', () => {
    render(<Parts o={{}} />);
    expect(screen.queryAllByTestId('part-tile').length).toBe(0);
  });
});
