import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApprovalPreview, PREVIEW_BEATS, beatAt } from '@/components/ApprovalPreview';
import { DemoOverlay, SCENES } from '@/components/Demo';
import { DetailsSheet } from '@/components/DetailsSheet';
import { LaunchContext, type Launch } from '@/hooks/useLaunch';
import { UiProvider, useUi } from '@/hooks/useUi';
import type { Detail, Overview } from '@/lib/types';

const spies = {
  act: vi.fn(async () => true),
  runAgent: vi.fn(async () => true),
  draftOnly: vi.fn(async () => true),
  sendMail: vi.fn(async () => true),
  syncNow: vi.fn(async () => true),
  approve: vi.fn(async () => true),
  reviewReply: vi.fn(async () => true),
  ensureDraft: vi.fn(async () => true),
};
const launch = (): Launch => ({ status: 'ready', overview: null, detail: null, selected: 'a', busy: false, selectCase: vi.fn(), retry: vi.fn(), ...spies });

/* an approved and sent case: the preview must look the same as for an open one */
const D = {
  id: 'a',
  supplier: { name: 'Boise' },
  case: { draft: { subject: 'Inquiry', body: 'Hello' }, approved: true, sent_at: '2026-11-22T10:00:00Z' },
  escalation: { to_role: 'Dr. Maren Vogt', subject: 'Escalation', body: 'Numbers', approved: true },
} as unknown as Detail;
const O = {} as Overview;
const idx = (id: string) => SCENES.findIndex((s) => s.id === id);

function Scene({ id, playing = true }: { id: string; playing?: boolean }) {
  const ui = useUi();
  return (
    <button
      data-testid="drive"
      onClick={() => {
        ui.setDemoScene(id);
        ui.setDemoPlaying(playing);
      }}
    >
      drive
    </button>
  );
}
function Opener() {
  const ui = useUi();
  return (
    <button data-testid="open" onClick={() => ui.setDemoOpen(true)}>
      open
    </button>
  );
}
const tick = (ms: number) => act(() => void vi.advanceTimersByTime(ms));

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(() => Promise.resolve());
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => undefined);
  Object.values(spies).forEach((s) => s.mockClear());
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('new scenes in the manifest', () => {
  it('escalation and email use the messages tab and their own anchors', () => {
    for (const id of ['escalation', 'email']) {
      const s = SCENES[idx(id)];
      expect(s.sheetTab).toBe('messages');
      expect(s.selector).toBe(`[data-demo="${id}"]`);
    }
  });
});

describe('player with the Details sheet', () => {
  function mount() {
    render(
      <LaunchContext.Provider value={launch()}>
        <UiProvider>
          <Opener />
          <DetailsSheet d={D} o={O} onStartDemo={() => undefined} />
          <DemoOverlay d={D} />
        </UiProvider>
      </LaunchContext.Provider>,
    );
    fireEvent.click(screen.getByTestId('open'));
    fireEvent.click(screen.getByTestId('demo-captions'));
  }

  it('opens the Messages tab for escalation and email, anchors exist, then closes the sheet', () => {
    mount();
    const dots = screen.getAllByTestId('demo-dot');
    fireEvent.click(dots[idx('escalation')]);
    tick(100);
    expect(screen.getByTestId('details-sheet')).toBeTruthy();
    expect(document.querySelector('[data-demo="escalation"] [data-testid="draft-escalation"]')).toBeTruthy();
    expect(document.querySelector('[data-demo="email"] [data-testid="draft-supplier"]')).toBeTruthy();
    expect(screen.getByTestId('preview-escalation')).toBeTruthy();
    expect(screen.queryByTestId('preview-email')).toBeNull();

    fireEvent.click(dots[idx('email')]);
    tick(100);
    expect(screen.getByTestId('details-sheet')).toBeTruthy();
    expect(screen.getByTestId('preview-email')).toBeTruthy();
    expect(screen.queryByTestId('preview-escalation')).toBeNull();

    fireEvent.click(dots[idx('tracking')]);
    tick(100);
    expect(screen.queryByTestId('details-sheet')).toBeNull();
    expect(screen.queryByTestId('preview-email')).toBeNull();
  });

  it('does not trap focus or block the player while the demo plays', () => {
    mount();
    fireEvent.click(screen.getAllByTestId('demo-dot')[idx('escalation')]);
    tick(100);
    const next = screen.getByTestId('demo-next');
    next.focus();
    tick(50);
    expect(document.activeElement).toBe(next);
    expect(document.body.style.pointerEvents).not.toBe('none');
    fireEvent.click(next);
    expect(screen.getByTestId('demo-caption').textContent).toBe(SCENES[idx('escalation') + 1].caption);
  });
});

describe('approval preview strip', () => {
  function harness(kind: 'escalation' | 'email', playing = true) {
    render(
      <LaunchContext.Provider value={launch()}>
        <UiProvider>
          <Scene id={kind} playing={playing} />
          <ApprovalPreview kind={kind} />
        </UiProvider>
      </LaunchContext.Provider>,
    );
  }

  it('renders nothing outside its scene', () => {
    harness('escalation');
    expect(screen.queryByTestId('preview-escalation')).toBeNull();
  });

  it('is labelled Preview, inert, and never calls approve, send or import', () => {
    harness('escalation');
    fireEvent.click(screen.getByTestId('drive'));
    const el = screen.getByTestId('preview-escalation');
    expect(el.getAttribute('role')).toBe('img');
    expect(el.getAttribute('aria-label')).toMatch(/^Preview/);
    expect(screen.getByText('Preview')).toBeTruthy();
    expect(el.querySelector('button, input, a, select, textarea, [tabindex]')).toBeNull();
    fireEvent.click(el);
    tick(SCENES[idx('escalation')].ms + 500);
    for (const s of Object.values(spies)) expect(s).not.toHaveBeenCalled();
  });

  it('advances through the beats with the replay fraction and lights Approve last', () => {
    harness('escalation');
    fireEvent.click(screen.getByTestId('drive'));
    const ms = SCENES[idx('escalation')].ms;
    const el = screen.getByTestId('preview-escalation');
    expect(el.getAttribute('data-beat')).toBe('0');
    expect(screen.getByTestId('preview-approve').getAttribute('data-lit')).toBe('false');
    tick(ms * 0.5);
    expect(el.getAttribute('data-beat')).toBe('1');
    tick(ms);
    expect(el.getAttribute('data-beat')).toBe('2');
    expect(screen.getByTestId('preview-approve').getAttribute('data-lit')).toBe('true');
  });

  it('freezes while paused', () => {
    harness('email', false);
    fireEvent.click(screen.getByTestId('drive'));
    tick(SCENES[idx('email')].ms);
    expect(screen.getByTestId('preview-email').getAttribute('data-beat')).toBe('0');
  });

  it('has the right beats', () => {
    expect(PREVIEW_BEATS.email.map((b) => b.label)).toEqual(['Send from your own inbox', 'Reply comes back as a file', 'Review']);
    expect(PREVIEW_BEATS.escalation.map((b) => b.label)).toEqual(['Read it', 'Type your name', 'Approve']);
    expect([0, 0.34, 0.99, 1].map((f) => beatAt(f))).toEqual([0, 1, 2, 2]);
  });

  it('is reduced-motion safe: still advances, transitions are motion-safe only', () => {
    window.matchMedia = vi.fn().mockReturnValue({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() }) as never;
    harness('email');
    fireEvent.click(screen.getByTestId('drive'));
    tick(SCENES[idx('email')].ms);
    const el = screen.getByTestId('preview-email');
    expect(el.getAttribute('data-beat')).toBe('2');
    expect(el.innerHTML).not.toMatch(/animate-|anim-/);
    expect(el.innerHTML).toMatch(/motion-safe:/);
  });
});
