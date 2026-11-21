/* Public JSON contract (app/public.py). Every field is optional: missing data shows 'unknown' or nothing. */

export type Autonomy = 'auto' | 'draft' | 'approval' | 'never' | string;

export interface Approver {
  role?: string | null;
  name?: string | null;
  vacancy?: boolean;
  provisional?: boolean;
  note?: string | null;
}

export interface Option {
  title?: string;
  detail?: string;
  kind?: 'recovery' | 'release' | 'allocation' | 'verify' | string;
  price_eur?: number | null;
  eta?: string | null;
  copies_gained?: number | null;
  copies_gained_source?: string | null;
  potential_units?: number | null;
  arrival_known?: boolean;
  feasible?: 'yes' | 'late' | 'na' | 'unknown' | string | null;
  recommended?: boolean;
  approver?: Approver | null;
}

export interface Hold {
  supplier?: string;
  blocker_type?: string;
  required_action?: string;
  consequence?: string;
  quantity?: number | null;
  who_can_unlock?: Approver | null;
  needs_review?: boolean;
}

export interface TraceRow {
  step?: string;
  tool?: string;
  outcome?: string;
  autonomy?: Autonomy;
  summary?: string;
  by?: string;
  agent?: string;
  action?: string;
  turn?: number;
}

export interface Offer {
  quantity?: number | null;
  arrival_label?: string | null;
  arrives_before_deadline?: boolean | null;
  gap_after_offer?: number | null;
  cost_eur?: number | null;
  approver?: Approver | null;
  packing_hours_after_arrival?: number | null;
  extra_units_short_edition?: number | null;
  simulated?: boolean;
  reviewed_by?: string | null;
  reviewed_at?: string | null;
}

export interface Brief {
  headline?: string;
  recommendation?: string;
  price_eur?: number | null;
  approver?: Approver | null;
  copies_gained?: number | null;
  deadline?: string | null;
  confidence?: 'low' | 'medium' | 'high' | string | null;
  risks?: string[];
  verify_next?: string[];
}

export interface Draft {
  subject?: string;
  body?: string;
  manual_send?: boolean;
}

export interface CaseInfo {
  state?: string;
  approver?: string | null;
  approved?: boolean;
  draft?: Draft | null;
  investigation?: unknown;
  sent_at?: string | null;
}

export interface Escalation {
  to_role?: string;
  subject?: string;
  body?: string;
  approved?: boolean;
}

export interface AllocationLine {
  product_id?: string;
  name?: string;
  short?: number;
  [k: string]: unknown;
}

export interface Conflict {
  field?: string;
  why?: string;
  confidence?: string;
}

export interface Reply {
  id?: string;
  received_at?: string;
  simulated?: boolean;
}

export interface SupplierDraft {
  supplier?: string;
  subject?: string;
  body?: string;
}

export interface AgentInfo {
  mode?: string;
  tool_calls?: number;
  rejected?: number;
  seconds?: number;
  running?: boolean;
  error?: string | boolean | null;
  last_run?: string | null;
  steps?: { message?: string }[];
}

export interface Integrations {
  portal_enabled?: boolean;
  ai_enabled?: boolean;
  email_enabled?: boolean;
}

export interface Detail {
  id?: string;
  title?: string;
  shortage?: number;
  required?: number;
  usable_stock?: number;
  incoming?: number;
  supplier?: { name?: string };
  shipments?: { balance_eta?: string }[];
  allocation?: { lines?: AllocationLine[] };
  brief?: Brief | null;
  case?: CaseInfo;
  escalation?: Escalation | null;
  options?: Option[];
  holds?: Hold[];
  trace?: TraceRow[];
  agent?: AgentInfo;
  approvals?: { what?: string; to_role?: string; status?: string }[];
  run_mode?: 'agent' | 'agent_partial' | 'rule_based' | string | null;
  offer?: Offer | null;
  conflicts?: Conflict[];
  numbers_verified?: boolean;
  value?: { headline_eur?: number | null; basis?: string; label?: string; claim_eur?: number | null } | null;
  replies?: Reply[];
  supplier_drafts?: SupplierDraft[];
  integrations?: Integrations;
}

export interface Product {
  id?: string;
  name?: string;
  packed?: number;
  target?: number;
  remaining?: number;
  hours_needed?: number;
  hours_available?: number;
}

export interface IssueRow {
  id: string;
  title?: string;
  shortage?: number;
}

export interface Overview {
  launch_date?: string | null;
  products?: Product[];
  pack_status?: { hours_left?: number | null; as_of?: string | null };
  issues?: IssueRow[];
  agent?: AgentInfo;
  integrations?: Integrations;
  sync?: { last_success?: string | null; error?: boolean | string | null };
}

export interface WhatIfResult {
  copies_ship?: number;
  copies_short?: number;
  hours_left?: number;
  label?: string;
}
