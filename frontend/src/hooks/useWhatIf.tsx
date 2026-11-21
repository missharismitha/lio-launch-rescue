import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { api, issuePath } from '@/lib/api';
import { shortLines, whatIfDefault, whatIfSentence } from '@/lib/derive';
import type { Detail, Overview, WhatIfResult } from '@/lib/types';
import { whatIfLabel } from '@/lib/format';

export interface WhatIf {
  available: boolean;
  hours: number;
  setHours: (v: number) => void;
  result: WhatIfResult | null;
  error: boolean;
  sentence: string;
  valueText: string;
}

const Ctx = createContext<WhatIf | null>(null);
export const useWhatIf = (): WhatIf => {
  const v = useContext(Ctx);
  if (!v) throw new Error('WhatIfProvider missing');
  return v;
};

const clamp = (v: number) => Math.max(0, Math.min(72, Math.round(Number(v)) || 0));

/* slider 0..72 h, 120 ms debounce, previous POST aborted; updates only the strips and the sentence */
export function WhatIfProvider({ detail, overview, children }: { detail: Detail; overview: Overview; children: ReactNode }) {
  const id = detail.id || '';
  /* the server refuses a simulation when no edition is short, so the slider only exists when one is */
  const available = shortLines(detail).length > 0 && !!id;
  const [hours, setHoursState] = useState(() => whatIfDefault(detail));
  const [result, setResult] = useState<WhatIfResult | null>(null);
  const [error, setError] = useState(false);
  const ctl = useRef<AbortController | null>(null);
  const seenId = useRef(id);

  useEffect(() => {
    if (seenId.current !== id) {
      seenId.current = id;
      setHoursState(whatIfDefault(detail));
      setResult(null);
      setError(false);
    }
  }, [id, detail]);

  useEffect(() => {
    if (!available) return;
    const t = window.setTimeout(async () => {
      ctl.current?.abort();
      const c = new AbortController();
      ctl.current = c;
      try {
        const res = await api<WhatIfResult>(issuePath(id, 'whatif'), { arrive_in_hours: hours }, c.signal);
        if (c.signal.aborted) return;
        setResult(res);
        setError(false);
      } catch (e) {
        if ((e as Error).name === 'AbortError') return;
        setError(true);
      }
    }, 120);
    return () => window.clearTimeout(t);
  }, [hours, id, available]);

  useEffect(() => () => ctl.current?.abort(), []);

  const value: WhatIf = {
    available,
    hours,
    setHours: (v) => setHoursState(clamp(v)),
    result,
    error,
    sentence: available ? whatIfSentence(detail, overview, hours, result, error) : '',
    valueText: result?.label || whatIfLabel(hours),
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
