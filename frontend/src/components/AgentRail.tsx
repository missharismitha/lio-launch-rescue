import { AnimatedList, type ListItem } from '@/components/ui/animated-list';
import { useLaunch } from '@/hooks/useLaunch';
import { agentGroups, hasToolRows } from '@/lib/derive';
import type { Detail, Overview, TraceRow } from '@/lib/types';

const toolLabel = (t: string) => t.replace(/_/g, ' ');

export function runModeLine(d: Detail): string | null {
  const a = d.agent || {};
  if (d.run_mode === 'agent' || d.run_mode === 'agent_partial') {
    const lead = d.run_mode === 'agent' ? 'Agent decided' : 'Agent decided in part';
    return `${lead}: ${a.tool_calls ?? 0} tool calls, ${a.rejected ?? 0} rejected`;
  }
  if (d.run_mode === 'rule_based') return 'Rule-based fallback: model unavailable';
  return null;
}

/* "Priced an option" x2 -> "Priced 2 options"; "Checked the policy" x2 -> "Checked the policy twice" */
export function groupLabel(label: string, n: number): string {
  if (n === 1) return label;
  const m = /^(\w+) an? (.+)$/.exec(label);
  if (m) return `${m[1]} ${n} ${m[2]}s`;
  return `${label} ${n === 2 ? 'twice' : `${n} times`}`;
}

interface Row {
  label: string;
  n: number;
  summaries: string[];
  rule: boolean;
  approval: boolean;
  rejected: boolean;
  skipped?: boolean;
  autonomy?: string;
}

export type { Row as RailRow };

export function timelineRows(rows: TraceRow[]): Row[] {
  const out: Row[] = [];
  for (const r of rows) {
    const label = toolLabel(r.tool || r.agent || String(r.step ?? 'step'));
    const rule = r.by === 'rule';
    const approval = r.autonomy === 'approval';
    const rejected = /reject/i.test(r.outcome || '');
    const skipped = r.outcome === 'skipped';
    const text = r.summary || r.action || r.outcome || '';
    const last = out[out.length - 1];
    if (last && last.label === label && last.rule === rule && last.approval === approval && last.rejected === rejected && !!last.skipped === skipped) {
      last.n += 1;
      if (text && !last.summaries.includes(text)) last.summaries.push(text);
    } else out.push({ label, n: 1, summaries: text ? [text] : [], rule, approval, rejected, skipped, autonomy: r.autonomy });
  }
  return out;
}

const AUTONOMY_LEGEND: [string, string][] = [
  ['auto', 'ran by itself (read and compute)'],
  ['draft', 'prepared a draft for you to read'],
  ['approval', 'waits for a named person to approve'],
  ['never', 'the app does not do this (send, order, pay)'],
];

export function AgentLegend() {
  return (
    <ul className="m-0 grid list-none gap-1 p-0 text-[14px] leading-5 text-ink-2" data-testid="autonomy-legend">
      {AUTONOMY_LEGEND.map(([k, v]) => (
        <li key={k}>
          <b className="font-semibold text-ink">{k}</b> {v}
        </li>
      ))}
    </ul>
  );
}

function items(rows: Row[]): ListItem[] {
  return rows.map((r, i) => ({
    key: `${i}-${r.label}`,
    testId: 'agent-step',
    className: 'relative pb-5 pl-6 last:pb-0',
    node: (
      <>
        <i
          aria-hidden="true"
          className={
            'absolute top-[7px] -left-[4px] size-[7px] rounded-full ' +
            (r.rejected ? 'bg-risk' : r.approval ? 'bg-warn' : r.skipped ? 'border border-line-2 bg-white' : r.rule ? 'border border-brand bg-white' : 'bg-brand')
          }
        />
        <p className="m-0 text-[15px] leading-6 text-ink">
          {groupLabel(r.label, r.n)}
          {r.rule ? <span className="ml-2 text-[14px] text-ink-2">rule-based</span> : null}
          {r.approval ? <span className="ml-2 text-[14px] font-medium text-warn">needs your approval</span> : null}
        </p>
        {r.summaries.length ? <p className="m-0 truncate text-[14px] leading-5 text-ink-2">{r.summaries.join('; ')}</p> : null}
      </>
    ),
  }));
}

/* One row mapping for the rail and the live panel: tool rows when present, else the crew grouping */
export function railRows(d: Detail): Row[] {
  return hasToolRows(d)
    ? timelineRows(d.trace || [])
    : agentGroups(d).map((g) => ({
        label: g.agent,
        n: 1,
        summaries: g.main.action ? [g.main.action + (g.main.outcome === 'needs human review' ? '. Waiting for you.' : '')] : [],
        rule: false,
        approval: g.main.autonomy === 'approval',
        rejected: false,
        skipped: g.main.outcome === 'skipped',
        autonomy: g.main.autonomy,
      }));
}

export function AgentRail({ d, o, legend = false }: { d: Detail; o: Overview; legend?: boolean }) {
  const { busy } = useLaunch();
  const agent = o.agent || {};
  const rows = railRows(d);
  const mode = runModeLine(d);
  const live = agent.running || busy;
  return (
    <div data-demo="agent" data-testid="agent-rail" className="grid grid-cols-1 gap-4">
      {live ? (
        <p className="m-0 text-[14px] text-ink-2" role="status">
          Working: {String(agent.steps?.slice(-1)[0]?.message || 'Starting')}
        </p>
      ) : null}
      {mode ? (
        <p className="m-0 text-[14px] leading-5 text-ink-2" data-testid="run-mode">
          {mode}
        </p>
      ) : null}
      {rows.length ? (
        <AnimatedList items={items(rows)} className="m-0 ml-[3px] list-none border-l border-line p-0 pt-1" />
      ) : (
        <p className="m-0 text-ink-2">The agent has not run yet.</p>
      )}
      {(d.approvals || []).length ? (
        <ul className="m-0 grid list-none gap-1 p-0 text-[14px] text-ink-2">
          {(d.approvals || []).map((a, i) => (
            <li key={i}>
              {a.what || 'Approval'}
              {a.to_role ? ` to ${a.to_role}` : ''}
              {a.status ? `: ${a.status}` : ''}
            </li>
          ))}
        </ul>
      ) : null}
      {legend ? <AgentLegend /> : null}
    </div>
  );
}
