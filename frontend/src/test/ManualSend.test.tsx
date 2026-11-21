import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { LazyMotion, domAnimation } from 'motion/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DecisionCard } from '@/components/DecisionCard';
import { LaunchContext, type Launch } from '@/hooks/useLaunch';
import { UiProvider } from '@/hooks/useUi';
import { cardState } from '@/lib/derive';
import type { Detail, Overview } from '@/lib/types';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const approved: Detail = { shortage: 10, case: { approved: true, approver: 'Ann', draft: { subject: 's', body: 'b' } }, brief: {}, supplier: { name: 'S' } };
const off: Overview = { integrations: { ai_enabled: true, email_enabled: false }, agent: {} };
const on: Overview = { integrations: { ai_enabled: true, email_enabled: true }, agent: {} };

const launch = (over: Partial<Launch> = {}): Launch => {
  const act = vi.fn(async (fn: () => Promise<unknown>) => {
    try {
      await fn();
      return true;
    } catch {
      return false;
    }
  });
  const noop = vi.fn(async () => true);
  return {
    status: 'ready', overview: null, detail: null, selected: 'x y', busy: false,
    selectCase: vi.fn(), retry: vi.fn(), act, runAgent: noop, draftOnly: noop, sendMail: noop, syncNow: noop,
    approve: noop, reviewReply: noop, ensureDraft: noop, ...over,
  };
};

function view(d: Detail, o: Overview, l: Launch) {
  return render(
    <LazyMotion features={domAnimation}>
      <LaunchContext.Provider value={l}>
        <UiProvider>
          <DecisionCard d={d} o={o} />
        </UiProvider>
      </LaunchContext.Provider>
    </LazyMotion>,
  );
}

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

describe('hand-off panel', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  let writeText: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    fetchMock = vi.fn(async () => json(200, { to: 'a@b.co', subject: '[Lio x] Hi', body: 'Hello' }));
    vi.stubGlobal('fetch', fetchMock);
    writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
  });

  it('is hidden when email is enabled or the case is not approved', () => {
    view(approved, on, launch());
    expect(screen.queryByText(/Send it yourself/)).toBeNull();
    cleanup();
    view({ shortage: 10, case: { draft: { subject: 's' } }, brief: {} }, off, launch());
    expect(screen.queryByText(/Send it yourself/)).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('fetches only when opened and copies the fetched values', async () => {
    view(approved, off, launch());
    expect(fetchMock).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText(/Send it yourself/));
    await screen.findByText('Copy address');
    expect(fetchMock.mock.calls[0][0]).toBe('/api/issues/x%20y/handoff');
    fireEvent.click(screen.getByText('Copy address'));
    fireEvent.click(screen.getByText('Copy subject'));
    fireEvent.click(screen.getByText('Copy message'));
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(3));
    expect(writeText.mock.calls.map((c) => c[0])).toEqual(['a@b.co', '[Lio x] Hi', 'Hello']);
    expect(document.body.textContent).toContain('including the [Lio ...] tag');
  });

  it('mark-sent needs a name of 2+ characters and posts sent_by', async () => {
    const l = launch();
    view({ ...approved, case: { ...approved.case, approver: '' } }, off, l);
    fireEvent.click(screen.getByText(/Send it yourself/));
    await screen.findByText('I sent it');
    fireEvent.click(screen.getByText('I sent it'));
    const btn = screen.getByText('Mark as sent') as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('Your name'), { target: { value: 'A' } });
    expect(btn.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('Your name'), { target: { value: 'Ann' } });
    expect(btn.disabled).toBe(false);
    fetchMock.mockImplementationOnce(async () => json(200, {}));
    fireEvent.click(btn);
    await waitFor(() => expect(l.act).toHaveBeenCalled());
    const call = fetchMock.mock.calls[fetchMock.mock.calls.length - 1];
    expect(call[0]).toBe('/api/issues/x%20y/mark-sent');
    expect(JSON.parse(call[1].body)).toEqual({ sent_by: 'Ann' });
    expect((l.act as ReturnType<typeof vi.fn>).mock.calls[0][1]).toBe('Marked as sent by hand. Delivery is not confirmed.');
  });
});

describe('import a reply', () => {
  const sent: Detail = { shortage: 10, case: { sent_at: 'x' }, supplier: { name: 'S' } };

  it('posts raw bytes as message/rfc822 and shows the 400 detail', async () => {
    const fetchMock = vi.fn(async () => json(400, { detail: 'Sender does not match.' }));
    vi.stubGlobal('fetch', fetchMock);
    view(sent, off, launch());
    expect(screen.getByText(/Download message/)).toBeTruthy();
    const file = new File([new Uint8Array([1, 2, 3])], 'r.eml', { type: 'message/rfc822' });
    fireEvent.change(document.querySelector('input[type=file]')!, { target: { files: [file] } });
    await screen.findByText('Sender does not match.');
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/api/issues/x%20y/replies/import');
    expect((init.headers as Record<string, string>)['Content-Type']).toBe('message/rfc822');
    expect(init.method).toBe('POST');
    expect(new Uint8Array(init.body as ArrayBuffer)).toEqual(new Uint8Array([1, 2, 3]));
  });

  it('refuses files over 2 MB without uploading', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    view(sent, off, launch());
    const big = new File([new Uint8Array(2 * 1024 * 1024 + 1)], 'big.eml');
    fireEvent.change(document.querySelector('input[type=file]')!, { target: { files: [big] } });
    await screen.findByText(/larger than 2 MB/);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('manual-sent wording', () => {
  it('says sent by hand, delivery not confirmed', () => {
    const d: Detail = { shortage: 10, case: { sent_at: 'x', sent_manually: true }, supplier: { name: 'S' } };
    expect(cardState(d, false, true, false)).toEqual({ kind: 'sent', manual: true });
    view(d, off, launch());
    expect(document.body.textContent).toContain('Sent by hand, delivery not confirmed');
  });
  it('plain sent stays plain', () => {
    view({ shortage: 10, case: { sent_at: 'x' }, supplier: { name: 'S' } }, on, launch());
    expect(document.body.textContent).toContain('Sent. Waiting for S.');
  });
});
