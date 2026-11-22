/* Launch is at 20:00 Europe/Berlin on overview.launch_date. Pure helpers so they can be tested. */

const berlinWall = (t: number): number => {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Berlin', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date(t));
  const g = (k: string) => Number(parts.find((p) => p.type === k)?.value);
  return Date.UTC(g('year'), g('month') - 1, g('day'), g('hour'), g('minute'), g('second'));
};

/* the instant of 20:00 Berlin time on the given ISO date, or null */
export function launchInstant(date?: string | null, hour = 20): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(date || '');
  if (!m) return null;
  const guess = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), hour, 0, 0);
  const offset = berlinWall(guess) - guess;
  return guess - offset;
}

/* 'Xh Ym', whole minutes rounded down; 'Launched' once the time has passed */
export function countdownText(ms: number): string {
  if (!Number.isFinite(ms)) return '';
  if (ms <= 0) return 'Launched';
  const mins = Math.floor(ms / 60000);
  return `${Math.floor(mins / 60)}h ${mins % 60}m`;
}

export const launchCountdown = (date: string | null | undefined, now: number): string => {
  const at = launchInstant(date);
  return at == null ? '' : countdownText(at - now);
};
