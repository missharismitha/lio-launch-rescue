import { Bot, FileText, ShieldCheck, UserCheck, X } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { AnimatedList, type ListItem } from '@/components/ui/animated-list';
import { useLaunch } from '@/hooks/useLaunch';
import { agentGroups, approvalsNeeded, hasToolRows } from '@/lib/derive';
import type { Detail, Overview, TraceRow } from '@/lib/types';

const AUTONOMY: Record<string, { label: string; tone: 'ok' | 'neutral' | 'accent' | 'warn'; icon: typeof Bot }> = {
  auto: { label: 'auto', tone: 'ok', icon: ShieldCheck },
  draft: { label: 'draft', tone: 'neutral', icon: FileText },
  approval: { label: 'approval', tone: 'accent', icon: UserCheck },
  never: { label: 'never', tone: 'warn', icon: X },
};

function AutonomyBadge({ a }: { a?: string }) {
  const m = a ? AUTONOMY[a] : undefined;
  if (!m) return null;
  const Icon = m.icon;
  return (
    <Badge tone={m.tone}>
      <Icon className="size-3.5" aria-hidden="true" />
      {m.label}
    </Badge>
  );
}

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

function toolItems(rows: TraceRow[]): ListItem[] {
  return rows.map((r, i) => ({
    key: `${i}-${r.tool || r.agent || ''}`,
    testId: 'agent-step',
    className: 'grid gap-1 py-2.5',
    node: (
      <>
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-md bg-warn-wash px-2 py-0.5 text-[13px] font-semibold" data-testid="tool-chip">
            {toolLabel(r.tool || r.agent || String(r.step ?? 'step'))}
          </span>
          <AutonomyBadge a={r.autonomy} />
          {r.by ? <span className="text-[12px] text-ink-2">by {r.by}</span> : null}
        </div>
        {r.summary || r.action || r.outcome ? <p className="m-0 text-[14px] text-ink-2">{r.summary || r.action || r.outcome}</p> : null}
      </>
    ),
  }));
}

function groupItems(d: Detail): ListItem[] {
  return agentGroups(d).map((g) => ({
    key: g.agent,
    testId: 'agent-step',
    className: 'grid gap-1 py-2.5',
    node: (
      <>
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-semibold">{g.agent}</span>
          <AutonomyBadge a={g.main.autonomy} />
        </div>
        <p className="m-0 text-[14px] text-ink-2">
          {g.main.action || ''}
          {g.main.outcome === 'needs human review' ? '. Waiting for you.' : ''}
        </p>
      </>
    ),
  }));
}

export function AgentRail({ d, o }: { d: Detail; o: Overview }) {
  const { busy } = useLaunch();
  const agent = o.agent || {};
  const rows = d.trace || [];
  const items = hasToolRows(d) ? toolItems(rows) : groupItems(d);
  const mode = runModeLine(d);
  const live = agent.running || busy;
  const need = approvalsNeeded(d);
  const groups = agentGroups(d).length;
  return (
    <div data-demo="agent" data-testid="agent-rail" className="grid gap-2">
      {live ? (
        <p className="m-0 flex items-center gap-2 text-[14px] text-accent-ink" role="status">
          <Bot className="size-4" aria-hidden="true" />
          Working: {String(agent.steps?.slice(-1)[0]?.message || 'Starting')}
        </p>
      ) : null}
      {mode ? (
        <p className="m-0 text-[14px] font-semibold" data-testid="run-mode">
          {mode}
        </p>
      ) : null}
      {items.length ? (
        <AnimatedList items={items} className="m-0 grid list-none divide-y divide-line p-0" />
      ) : (
        <p className="m-0 text-ink-2">The agent has not run yet.</p>
      )}
      {(d.approvals || []).length ? (
        <ul className="m-0 grid list-none gap-1 p-0 text-[14px]">
          {(d.approvals || []).map((a, i) => (
            <li key={i} className="flex flex-wrap items-center gap-2">
              <UserCheck className="size-4 text-accent-ink" aria-hidden="true" />
              {a.what || 'Approval'}
              {a.to_role ? ` to ${a.to_role}` : ''}
              {a.status ? `: ${a.status}` : ''}
            </li>
          ))}
        </ul>
      ) : groups ? (
        <p className="m-0 text-[13px] text-ink-2" data-testid="agent-summary">
          {groups} agents checked. {need ? `${need} ${need === 1 ? 'needs' : 'need'} your approval.` : 'Everything is approved.'}
        </p>
      ) : null}
    </div>
  );
}
