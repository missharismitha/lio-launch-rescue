import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DemoOverlay, GAP_MS, MAX_TOTAL_MS, SCENES, aboutText, clockText, demoTotalMs, narratedMismatch } from '@/components/Demo';
import { UiProvider, useUi } from '@/hooks/useUi';
import manifest from '@/lib/demoManifest.json';
import type { Detail } from '@/lib/types';

const MATCHING = { allocation: { lines: [{ name: 'Standard', short: 6800 }] }, holds: [{ supplier: 'Boise', quantity: 36000 }] } as unknown as Detail;
const OTHER = { allocation: { lines: [{ name: 'Standard', short: 1200 }] }, holds: [{ supplier: 'Boise', quantity: 500 }] } as unknown as Detail;

let audios: HTMLMediaElement[] = [];
let playImpl: () => Promise<void>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let playSpy: any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let pauseSpy: any;

function Opener() {
  const ui = useUi();
  return (
    <button data-testid="open" onClick={() => ui.setDemoOpen(true)}>
      open
    </button>
  );
}
function mount(d: Detail = MATCHING) {
  render(
    <UiProvider>
      <Opener />
      <DemoOverlay d={d} />
    </UiProvider>,
  );
  fireEvent.click(screen.getByTestId('open'));
}
const play = () => fireEvent.click(screen.getByTestId('demo-play'));
const tick = (ms: number) => act(() => void vi.advanceTimersByTime(ms));
const current = (n: number) => audios.filter((a) => a.src.includes(SCENES[n].file)).pop()!;

beforeEach(() => {
  vi.useFakeTimers();
  audios = [];
  playImpl = () => Promise.resolve();
  playSpy = vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(function (this: HTMLMediaElement) {
    audios.push(this);
    return playImpl();
  });
  pauseSpy = vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => undefined);
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('demo manifest', () => {
  it('has 9 scenes, same-origin files, allowed selectors and fits in 2:05 with gaps', () => {
    expect(SCENES).toHaveLength(9);
    const allowed = ['problem', 'parts', 'agent', 'map', 'transport', 'decision', 'tracking'].map((k) => `[data-demo="${k}"]`);
    for (const s of manifest.scenes) {
      expect(s.file.startsWith('/audio/demo/')).toBe(true);
      expect(allowed).toContain(s.selector);
      expect(s.ms).toBeGreaterThan(0);
    }
    expect(demoTotalMs()).toBe(manifest.scenes.reduce((a, s) => a + s.ms, 0) + 8 * GAP_MS);
    expect(demoTotalMs()).toBeLessThanOrEqual(MAX_TOTAL_MS);
    expect(MAX_TOTAL_MS).toBe(125000);
  });
  it('formats lengths', () => {
    expect(aboutText(110000)).toBe('about 1 min 50 s');
    expect(aboutText(119850)).toBe('about 2 minutes');
    expect(clockText(42400)).toBe('0:42');
  });
});

describe('start card', () => {
  it('offers Play with the length computed from the manifest', () => {
    mount();
    expect(screen.getByTestId('demo-play')).toBeTruthy();
    expect(screen.getByTestId('demo-length').textContent).toBe(aboutText(demoTotalMs()));
    expect(screen.getByText('Sound on')).toBeTruthy();
    expect(screen.queryByTestId('demo-mismatch')).toBeNull();
    expect(playSpy).not.toHaveBeenCalled();
  });
  it('warns when the narrated numbers differ and still plays', () => {
    expect(narratedMismatch(OTHER)).toBe(true);
    expect(narratedMismatch(MATCHING)).toBe(false);
    mount(OTHER);
    expect(screen.getByTestId('demo-mismatch').textContent).toContain('recorded for the earlier data');
    play();
    expect(screen.getByTestId('demo-mismatch')).toBeTruthy();
    expect(playSpy).toHaveBeenCalled();
  });
});

describe('player', () => {
  it('Play starts scene 1 with its audio and caption', () => {
    mount();
    play();
    expect(current(0)).toBeTruthy();
    expect(screen.getByTestId('demo-caption').textContent).toBe(SCENES[0].caption);
    expect(screen.getByTestId('demo-text').textContent).toBe(SCENES[0].text);
    expect(screen.getAllByTestId('demo-dot')).toHaveLength(9);
    expect(screen.getByTestId('demo-clock').textContent).toBe(`0:00 / ${clockText(demoTotalMs())}`);
  });
  it('ended advances after the gap', () => {
    mount();
    play();
    act(() => void current(0).dispatchEvent(new Event('ended')));
    tick(GAP_MS - 50);
    expect(screen.getByTestId('demo-caption').textContent).toBe(SCENES[0].caption);
    tick(60);
    expect(screen.getByTestId('demo-caption').textContent).toBe(SCENES[1].caption);
    expect(current(1)).toBeTruthy();
  });
  it('pause stops audio and the clock, resume continues', () => {
    mount();
    play();
    tick(1000);
    const t = screen.getByTestId('demo-clock').textContent;
    fireEvent.click(screen.getByTestId('demo-pause'));
    expect(pauseSpy).toHaveBeenCalled();
    tick(3000);
    expect(screen.getByTestId('demo-clock').textContent).toBe(t);
    const before = playSpy.mock.calls.length;
    fireEvent.click(screen.getByTestId('demo-pause'));
    expect(playSpy.mock.calls.length).toBe(before + 1);
    tick(2000);
    expect(screen.getByTestId('demo-clock').textContent).not.toBe(t);
  });
  it('mute sets audio.muted and captions continue', () => {
    mount();
    play();
    fireEvent.click(screen.getByTestId('demo-mute'));
    expect(current(0).muted).toBe(true);
    expect(screen.getByTestId('demo-text').textContent).toBe(SCENES[0].text);
    fireEvent.click(screen.getByTestId('demo-mute'));
    expect(current(0).muted).toBe(false);
  });
  it('next and back jump scenes', () => {
    mount();
    play();
    fireEvent.click(screen.getByTestId('demo-next'));
    expect(screen.getByTestId('demo-caption').textContent).toBe(SCENES[1].caption);
    fireEvent.click(screen.getByTestId('demo-back'));
    expect(screen.getByTestId('demo-caption').textContent).toBe(SCENES[0].caption);
    fireEvent.click(screen.getAllByTestId('demo-dot')[3]);
    expect(screen.getByTestId('demo-caption').textContent).toBe(SCENES[3].caption);
  });
  it('keyboard: space pauses, arrows move, Esc closes and stops audio', () => {
    mount();
    play();
    fireEvent.keyDown(window, { key: 'ArrowRight' });
    expect(screen.getByTestId('demo-caption').textContent).toBe(SCENES[1].caption);
    fireEvent.keyDown(window, { key: ' ' });
    expect(screen.getByTestId('demo-pause').getAttribute('aria-label')).toBe('Play');
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByTestId('demo-card')).toBeNull();
    expect(pauseSpy).toHaveBeenCalled();
    tick(5000);
    expect(screen.queryByTestId('demo-card')).toBeNull();
  });
  it('falls back to captions and the timer when audio cannot play', async () => {
    playImpl = () => Promise.reject(new Error('blocked'));
    mount();
    play();
    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.getByTestId('demo-voice-fail').textContent).toBe('Voice unavailable, captions only');
    tick(SCENES[0].ms + 500);
    expect(screen.getByTestId('demo-caption').textContent).toBe(SCENES[1].caption);
  });
  it('captions only never plays audio but still runs on the timer', () => {
    mount();
    fireEvent.click(screen.getByTestId('demo-captions'));
    expect(playSpy).not.toHaveBeenCalled();
    tick(SCENES[0].ms + 500);
    expect(screen.getByTestId('demo-caption').textContent).toBe(SCENES[1].caption);
  });
  it('shows the end card after the last scene, with Replay and Close', () => {
    mount();
    play();
    fireEvent.click(screen.getAllByTestId('demo-dot')[8]);
    act(() => void current(8).dispatchEvent(new Event('ended')));
    tick(GAP_MS + 10);
    expect(screen.getByText('That was the demo')).toBeTruthy();
    fireEvent.click(screen.getByTestId('demo-replay'));
    expect(screen.getByTestId('demo-caption').textContent).toBe(SCENES[0].caption);
    fireEvent.click(screen.getByTestId('demo-esc'));
    expect(screen.queryByTestId('demo-card')).toBeNull();
  });
});
