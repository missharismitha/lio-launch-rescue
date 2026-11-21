import { createContext, useCallback, useContext, useEffect, useMemo, useReducer, useRef, type ReactNode } from 'react';
import { api, issuePath } from '@/lib/api';
import type { Detail, Overview } from '@/lib/types';
import { toast } from '@/components/ui/toaster';

type Status = 'loading' | 'ready' | 'error';

interface State {
  status: Status;
  overview: Overview | null;
  detail: Detail | null;
  selected: string | null;
  busy: boolean;
}

type Action =
  | { type: 'loaded'; overview: Overview; detail: Detail | null; selected: string | null }
  | { type: 'failed' }
  | { type: 'select'; id: string }
  | { type: 'busy'; busy: boolean }
  | { type: 'retry' };

const initial: State = { status: 'loading', overview: null, detail: null, selected: null, busy: false };

function reducer(s: State, a: Action): State {
  switch (a.type) {
    case 'loaded':
      return { ...s, status: 'ready', overview: a.overview, detail: a.detail, selected: a.selected };
    case 'failed':
      return s.overview ? s : { ...s, status: 'error' };
    case 'select':
      return { ...s, selected: a.id };
    case 'busy':
      return { ...s, busy: a.busy };
    case 'retry':
      return { ...s, status: 'loading' };
  }
}

export interface Launch extends State {
  selectCase: (id: string) => void;
  retry: () => void;
  act: (fn: () => Promise<unknown>, okText?: string) => Promise<boolean>;
  runAgent: () => Promise<boolean>;
  draftOnly: () => Promise<boolean>;
  sendMail: () => Promise<boolean>;
  syncNow: () => Promise<boolean>;
  approve: (name: string, which: 'supplier' | 'escalation') => Promise<boolean>;
  reviewReply: (body: Record<string, unknown>) => Promise<boolean>;
  ensureDraft: () => Promise<boolean>;
}

const Ctx = createContext<Launch | null>(null);
export const LaunchContext = Ctx;
export const useLaunch = (): Launch => {
  const v = useContext(Ctx);
  if (!v) throw new Error('LaunchProvider missing');
  return v;
};

const POLL_MS = 3000;

export function LaunchProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, initial);
  const stateRef = useRef(state);
  stateRef.current = state;
  const busyRef = useRef(false);
  const counter = useRef(0);
  const ctl = useRef<AbortController | null>(null);
  const lastJson = useRef('');
  const selectedRef = useRef<string | null>(null);

  const load = useCallback(async (force: boolean) => {
    const req = ++counter.current;
    ctl.current?.abort();
    const c = new AbortController();
    ctl.current = c;
    try {
      const overview = await api<Overview>('/api/overview', undefined, c.signal);
      const issues = overview.issues || [];
      const sel = issues.some((i) => i.id === selectedRef.current)
        ? selectedRef.current
        : (issues.find((i) => i.id === 'game-card-shortage') || issues[0])?.id ?? null;
      const detail = sel ? await api<Detail>(`/api/issues/${encodeURIComponent(sel)}`, undefined, c.signal) : null;
      if (req !== counter.current) return;
      selectedRef.current = sel;
      const json = JSON.stringify([overview, detail, sel]);
      if (!force && json === lastJson.current && stateRef.current.status === 'ready') return;
      lastJson.current = json;
      dispatch({ type: 'loaded', overview, detail, selected: sel });
    } catch (e) {
      if ((e as Error).name === 'AbortError' || req !== counter.current) return;
      dispatch({ type: 'failed' });
    }
  }, []);

  useEffect(() => {
    let alive = true;
    let timer = 0;
    const cycle = async () => {
      if (!alive) return;
      if (!document.hidden && !busyRef.current) await load(false);
      if (alive) timer = window.setTimeout(cycle, POLL_MS);
    };
    void cycle();
    return () => {
      alive = false;
      window.clearTimeout(timer);
      ctl.current?.abort();
    };
  }, [load]);

  const selectCase = useCallback(
    (id: string) => {
      selectedRef.current = id;
      dispatch({ type: 'select', id });
      void load(true);
    },
    [load],
  );

  const retry = useCallback(() => {
    dispatch({ type: 'retry' });
    void load(true);
  }, [load]);

  const act = useCallback(
    async (fn: () => Promise<unknown>, okText?: string): Promise<boolean> => {
      if (busyRef.current) return false;
      busyRef.current = true;
      dispatch({ type: 'busy', busy: true });
      let ok = true;
      try {
        await fn();
        if (okText) toast(okText);
      } catch (e) {
        ok = false;
        toast((e as Error).message || 'Something went wrong.');
      }
      busyRef.current = false;
      dispatch({ type: 'busy', busy: false });
      await load(true);
      return ok;
    },
    [load],
  );

  const value = useMemo<Launch>(() => {
    const id = () => selectedRef.current || '';
    return {
      ...state,
      selectCase,
      retry,
      act,
      runAgent: () => act(() => api('/api/agent/run', { issue_id: id() }), 'Agent started.'),
      draftOnly: () => act(() => api(issuePath(id(), 'draft'), {}), 'Request drafted. Nothing was sent.'),
      ensureDraft: () => act(() => api(issuePath(id(), 'draft'), {})),
      sendMail: () => act(() => api(issuePath(id(), 'send'), {}), 'Sent.'),
      syncNow: () => act(() => api('/api/sync', {}), 'Checked for new data.'),
      approve: (name: string, which: 'supplier' | 'escalation') =>
        act(
          () => api(issuePath(id(), which === 'supplier' ? 'approve' : 'escalation/approve'), { approver: name, note: '' }),
          'Approved. Nothing was sent.',
        ),
      reviewReply: (body) => act(() => api(issuePath(id(), 'replies/review'), body), 'Offer reviewed. Nothing was ordered.'),
    };
  }, [state, selectCase, retry, act]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
