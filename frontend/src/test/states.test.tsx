import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from '@/App';
import { api, ApiError } from '@/lib/api';

class RO {
  observe() {}
  unobserve() {}
  disconnect() {}
}
beforeEach(() => {
  vi.stubGlobal('ResizeObserver', RO);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const json = (body: unknown, status = 200) => Promise.resolve(new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }));

describe('app states', () => {
  it('API down shows the error state, Retry recovers', async () => {
    let up = false;
    vi.stubGlobal('fetch', (u: string) => {
      if (!up) return Promise.reject(new TypeError('down'));
      if (String(u).endsWith('/api/overview')) return json({ issues: [{ id: 'a', title: 'Game cards: x', shortage: 5 }], products: [], pack_status: { hours_left: 10 } });
      return json({ id: 'a', title: 'Game cards: x', shortage: 5, case: {}, allocation: { lines: [] } });
    });
    render(<App />);
    await waitFor(() => expect(screen.getByTestId('error-state')).toBeTruthy());
    up = true;
    fireEvent.click(screen.getByText('Retry'));
    await waitFor(() => expect(screen.getByTestId('decision-card')).toBeTruthy());
    expect(screen.queryByTestId('error-state')).toBeNull();
  });

  it('empty case list says it is waiting for data and invents nothing', async () => {
    vi.stubGlobal('fetch', () => json({ issues: [], products: [] }));
    render(<App />);
    await waitFor(() => expect(screen.getByTestId('empty-state')).toBeTruthy());
    expect(screen.getByTestId('empty-state').textContent).toBe("Waiting for Soony's data.");
  });

  it('a 401 is reported as an ApiError (the page then goes to /login)', async () => {
    vi.stubGlobal('fetch', () => json({ detail: 'no' }, 401));
    await expect(api('/api/overview')).rejects.toBeInstanceOf(ApiError);
  });

  it('server detail text becomes the error message', async () => {
    vi.stubGlobal('fetch', () => json({ detail: 'Reply is missing' }, 409));
    await expect(api('/api/x', {})).rejects.toThrow('Reply is missing');
  });
});
