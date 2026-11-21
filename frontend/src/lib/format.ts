export const NB = ' ';

export const num = (v: unknown): string =>
  typeof v === 'number' && Number.isFinite(v) ? new Intl.NumberFormat('en-GB').format(Math.round(v)) : '';

export const hrs = (v: unknown): string =>
  typeof v === 'number' && Number.isFinite(v) ? `${Math.round(v * 10) / 10}${NB}h` : '';

export const eur = (v: number): string => `EUR${NB}${num(v)}`;

export const cap = (s?: string | null): string => (s ? `${String(s)[0].toUpperCase()}${String(s).slice(1)}` : '');

function berlin(opts: Intl.DateTimeFormatOptions, v: Date | string | null | undefined): string {
  if (!v) return '';
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime())
    ? ''
    : new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Berlin', ...opts }).format(d).replace(/,/g, '');
}

export const timeOnly = (v: string | null | undefined): string => berlin({ hour: '2-digit', minute: '2-digit' }, v);

const isoDay = (s?: string | null): Date | null => (/^\d{4}-\d{2}-\d{2}/.test(s || '') ? new Date(`${String(s).slice(0, 10)}T12:00:00Z`) : null);

export function dayLabel(s?: string | null, weekday = false): string {
  const d = isoDay(s);
  return d ? berlin(weekday ? { weekday: 'short', day: 'numeric', month: 'short' } : { day: 'numeric', month: 'short' }, d) : '';
}

export function etaText(v?: string | null): string {
  if (!v) return '';
  const s = String(v);
  const day = dayLabel(s);
  if (!day) return s;
  const t = /T(\d{2}:\d{2})/.exec(s);
  return t ? `${day} ${t[1]}` : day;
}

export const deadlineTime = (deadline?: string | null): string => /(\d{1,2}:\d{2})/.exec(deadline || '')?.[1] || '';

export const whatIfLabel = (hours: number): string => (hours === 0 ? 'now' : `in ${hours} h`);

/* "Sunday 22 November" */
export const dayLong = (s?: string | null): string => {
  const d = isoDay(s);
  return d ? berlin({ weekday: 'long', day: 'numeric', month: 'long' }, d) : '';
};
