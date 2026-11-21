"use strict";

/* Launch Control. Vanilla JS, no build. Every field from the API is optional:
   missing data shows a plain fallback or nothing, never a guess. textContent only. */

const state = {
  overview: null, detail: null, selected: null, busy: false, approver: "", sig: "", request: 0,
  openerId: "details", drawerOpen: false, panel: false, whatif: null,
  entered: false, failed: false, sinceSeen: "",
};
const $ = (id) => document.getElementById(id);
const NB = " ";
const n = (v) => (typeof v === "number" && Number.isFinite(v) ? new Intl.NumberFormat("en-GB").format(Math.round(v)) : "");
const hrs = (v) => (typeof v === "number" && Number.isFinite(v) ? `${Math.round(v * 10) / 10}${NB}h` : "");
const eur = (v) => `EUR${NB}${n(v)}`;
const cap = (s) => (s ? `${String(s)[0].toUpperCase()}${String(s).slice(1)}` : "");
const berlin = (opts, v) => { const d = v instanceof Date ? v : new Date(v); return Number.isNaN(d.getTime()) ? "" : new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Berlin", ...opts }).format(d).replace(/,/g, ""); };
const timeOnly = (v) => berlin({ hour: "2-digit", minute: "2-digit" }, v);
const isoDay = (s) => (/^\d{4}-\d{2}-\d{2}/.test(s || "") ? new Date(`${s.slice(0, 10)}T12:00:00Z`) : null);
const dayLabel = (s, weekday) => { const d = isoDay(s); return d ? berlin(weekday ? { weekday: "short", day: "numeric", month: "short" } : { day: "numeric", month: "short" }, d) : ""; };
const etaText = (v) => { if (!v) return ""; const s = String(v); const day = dayLabel(s); if (!day) return s; const t = /T(\d{2}:\d{2})/.exec(s); return t ? `${day} ${t[1]}` : day; };

function h(tag, props, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k === "class") el.className = v;
    else if (k === "text") el.textContent = v;
    else if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else if (k === "disabled" || k === "readOnly") el[k] = !!v;
    else if (k === "value") el.value = v;
    else el.setAttribute(k, v === true ? "" : v);
  }
  for (const kid of kids.flat(Infinity)) if (kid !== null && kid !== undefined && kid !== false) el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
  return el;
}
function icon(name) {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("class", "ic"); svg.setAttribute("aria-hidden", "true");
  const use = document.createElementNS("http://www.w3.org/2000/svg", "use");
  use.setAttribute("href", `#i-${name}`); svg.append(use);
  return svg;
}
const chip = (kind, text, opts) => h("span", { class: `chip ${kind || ""}`.trim(), title: opts && opts.title }, opts && opts.icon ? icon(opts.icon) : opts && opts.dot ? h("i", { class: "dot", "aria-hidden": "true" }) : null, text);
const unknownChip = () => chip("unknown", "unknown");

/* ---------- toast (5 s, paused on hover or focus) ---------- */
let toastTimer = 0, toastPaused = false;
function toast(text) {
  const t = $("toast"); t.textContent = text; t.hidden = false;
  requestAnimationFrame(() => t.classList.add("show"));
  clearTimeout(toastTimer); toastPaused = false;
  const arm = () => { toastTimer = setTimeout(() => { if (toastPaused) return arm(); t.classList.remove("show"); setTimeout(() => { if (!t.classList.contains("show")) t.hidden = true; }, 200); }, 5000); };
  arm();
}
(() => { const t = $("toast"); t.dataset.testid = "toast"; for (const [ev, v] of [["mouseenter", true], ["mouseleave", false], ["focusin", true], ["focusout", false]]) t.addEventListener(ev, () => { toastPaused = v; }); })();

async function api(path, body, signal) {
  const res = await fetch(path, { method: body === undefined ? "GET" : "POST", headers: { "Content-Type": "application/json" }, signal, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  if (res.status === 401) { window.location.href = "/login"; throw new Error("Access code required"); }
  let data = null; try { data = await res.json(); } catch (e) { /* not JSON */ }
  if (!res.ok) throw new Error((typeof data?.detail === "string" ? data.detail : "") || `Request failed (${res.status})`);
  return data;
}

/* ---------- derived story (nothing hard-coded) ---------- */
const nounOf = (d) => (/card/i.test(d.title || "") ? "game cards" : /book/i.test(d.title || "") ? "art books" : /statue/i.test(d.title || "") ? "statues" : /magnet/i.test(d.title || "") ? "magnets" : "parts");
const shortLines = (d) => (d.allocation?.lines || []).filter((l) => l.short > 0);
const recName = (d) => d.brief?.recommendation || null;
const recOption = (d) => (d.options || []).find((x) => x.recommended === true) || (d.options || []).find((x) => x.recommended === undefined && x.title && x.title === recName(d));
const manualSend = (d) => !!d.case?.draft?.manual_send;
const MANUAL_NOTE = "Send this one yourself from your own mail after approval.";
/* copies gained is shown only when it is real: a recovery/release with a known arrival, never an allocation or a check */
function gainsKnown(opt) {
  if (!opt || opt.copies_gained == null) return false;
  if (opt.kind === "allocation" || opt.kind === "verify" || opt.copies_gained_source === "arrival_unknown" || opt.copies_gained_source === "not_applicable") return false;
  return opt.kind ? true : opt.arrival_known === true;
}
const briefGains = (d) => (d.brief?.copies_gained != null && gainsKnown(recOption(d)) ? d.brief.copies_gained : null);
const deadlineTime = (d) => /(\d{1,2}:\d{2})/.exec(d.brief?.deadline || "")?.[1] || "";
const approverName = (d) => d.case?.approver || d.brief?.approver?.name || "your approver";
function approverChip(a) {
  if (!a || !a.role) return unknownChip();
  if (a.vacancy) return chip("warn", `${a.role}, seat vacant`, { icon: "user-check" });
  if (a.provisional) return chip("", `${a.name || a.role}, provisional`, { icon: "user-check", title: "Cost is unknown, so this is the lowest approver that could apply." });
  return chip("", a.name || a.role, { icon: "user-check" });
}
function agentGroups(d) {
  const groups = [];
  for (const t of d.trace || []) {
    let g = groups.find((x) => x.agent === t.agent);
    if (!g) { g = { agent: t.agent || "Agent", steps: [] }; groups.push(g); }
    g.steps.push(t);
  }
  for (const g of groups) g.main = g.steps.find((s) => s.autonomy === "approval") || g.steps.find((s) => s.autonomy === "never") || g.steps[g.steps.length - 1];
  return groups;
}
const approvalsNeeded = (d) => { const c = d.case || {}; return (c.approved ? 0 : 1) + (d.escalation && !d.escalation.approved ? 1 : 0); };

/* ---------- loading ---------- */
async function loadAll(initial, force) {
  const req = ++state.request;
  try {
    const o = await api("/api/overview");
    const issues = o.issues || [];
    const sel = issues.some((i) => i.id === state.selected) ? state.selected : (issues.find((i) => i.id === "game-card-shortage") || issues[0])?.id;
    const d = sel ? await api(`/api/issues/${encodeURIComponent(sel)}`) : null;
    if (req !== state.request) return;
    state.overview = o; state.selected = sel; state.detail = d; state.failed = false;
    render(!!force || !!initial);
  } catch (e) {
    if (!state.overview) { state.failed = true; showError(); }
  }
}
async function act(fn, okText) {
  if (state.busy) return;
  state.busy = true; render(true);
  try { await fn(); if (okText) toast(okText); } catch (e) { toast(e.message || "Something went wrong."); }
  state.busy = false; await loadAll(false, true);
}
const issuePath = (tail) => `/api/issues/${encodeURIComponent(state.selected)}/${tail}`;
const runAgent = () => act(() => api("/api/agent/run", { issue_id: state.selected }), "Agent started.");
const draftOnly = () => act(() => api(issuePath("draft"), {}), "Request drafted. Nothing was sent.");
const sendMail = () => act(() => api(issuePath("send"), {}), "Sent.");
const syncNow = () => act(() => api("/api/sync", {}), "Checked for new data.");
function confirmApproval() {
  const d = state.detail, name = (state.approver || "").trim();
  if (!d || name.length < 2) { toast("Type your name to confirm."); return; }
  act(async () => {
    if (d.case?.draft && !d.case.approved) await api(issuePath("approve"), { approver: name, note: "" });
    if (d.escalation && !d.escalation.approved) await api(issuePath("escalation/approve"), { approver: name, note: "" });
    state.panel = false;
  }, "Approved. Nothing was sent.");
}
async function startApproval(openerId, sendStep) {
  const d = state.detail; if (!d) return;
  if (!sendStep && !d.case?.draft) { await act(() => api(issuePath("draft"), {})); }
  if (!state.approver && state.detail?.brief?.approver?.name) state.approver = state.detail.brief.approver.name;
  state.panel = !sendStep;
  openDrawer("drafts", openerId);
}

/* ---------- what-if ---------- */
let wiTimer = 0, wiCtl = null;
function whatIfDefault(d) {
  const t = Date.parse(`${(d.shipments || [])[0]?.balance_eta || ""}T12:00:00`);
  if (!Number.isFinite(t)) return 24;
  return Math.max(0, Math.min(72, Math.round((t - Date.now()) / 3.6e6)));
}
function whatIfProduct(d, o) {
  const prods = o.products || [], res = state.whatif?.result;
  const line = shortLines(d)[0];
  if (line) return prods.find((p) => p.id === line.product_id) || null;
  if (res) return prods.find((p) => p.remaining === (res.copies_ship || 0) + (res.copies_short || 0)) || null;
  return null;
}
function ensureWhatIf(d) {
  if (!(d.shortage > 0)) { state.whatif = null; return; }
  if (!state.whatif || state.whatif.issue !== d.id) { state.whatif = { issue: d.id, hours: whatIfDefault(d), result: null, error: false }; queryWhatIf(0); }
}
function queryWhatIf(delay) {
  clearTimeout(wiTimer);
  wiTimer = setTimeout(async () => {
    const w = state.whatif; if (!w) return;
    if (wiCtl) wiCtl.abort();
    wiCtl = new AbortController();
    const { issue, hours } = w;
    try {
      const res = await api(`/api/issues/${encodeURIComponent(issue)}/whatif`, { arrive_in_hours: hours }, wiCtl.signal);
      if (state.whatif && state.whatif.issue === issue && state.whatif.hours === hours) { state.whatif.result = res; state.whatif.error = false; paintWhatIf(); }
    } catch (e) {
      if (e.name === "AbortError") return;
      if (state.whatif && state.whatif.issue === issue) { state.whatif.error = true; paintWhatIf(); }
    }
  }, delay === undefined ? 120 : delay);
}
const whatIfLabel = (hours) => (hours === 0 ? "now" : `in ${hours} h`);
function whatIfSentence(d, o) {
  const w = state.whatif; if (!w) return "";
  if (w.error) return "Can't work this out right now.";
  if (!w.result) return "Working it out.";
  const p = whatIfProduct(d, o);
  return `If ${nounOf(d)} arrive ${w.result.label || whatIfLabel(w.hours)}, ${n(w.result.copies_ship)}${p ? ` ${p.name}` : ""} copies ship.`;
}
function setHours(v, from) {
  const w = state.whatif; if (!w) return;
  const hours = Math.max(0, Math.min(72, Math.round(Number(v)) || 0));
  w.hours = hours;
  for (const el of document.querySelectorAll("[data-whatif]")) { if (el !== from) el.value = String(hours); }
  const s = $("whatif-slider"); if (s) s.setAttribute("aria-valuetext", whatIfLabel(hours));
  queryWhatIf();
}
function paintWhatIf() {
  const d = state.detail, o = state.overview; if (!d || !o) return;
  const lanes = $("lanes"); if (lanes) lanes.replaceWith(lanesNode(d, o));
  for (const out of document.querySelectorAll("[data-whatif-out]")) out.textContent = whatIfSentence(d, o);
  const s = $("whatif-slider"); if (s && state.whatif?.result?.label) s.setAttribute("aria-valuetext", state.whatif.result.label);
}

/* ---------- main view ---------- */
function selectCase(id) { state.selected = id; state.sig = ""; state.whatif = null; state.panel = false; loadAll(false, true); }
function topBar(o) {
  const live = !(o.sync || {}).error;
  const time = timeOnly((o.sync || {}).last_success);
  const select = h("select", { id: "case-select", "data-testid": "case-select", class: "select", "aria-label": "Case", onchange: (e) => selectCase(e.target.value) },
    (o.issues || []).map((i) => h("option", { value: i.id, selected: i.id === state.selected, text: `${(i.title || "Case").split(":")[0]}, ${i.shortage > 0 ? `${n(i.shortage)} short` : "check"}` })));
  return h("div", { class: "bar" },
    h("div", { class: "brand" }, h("span", { class: "brand-mark", "aria-hidden": "true" }, h("i")), h("div", {}, "Launch Control", h("small", { text: "Grand Heist 6" }))),
    h("div", { class: "grow" }), select,
    h("span", { class: `status${live ? "" : " off"}` }, h("b", { "aria-hidden": "true" }), live ? `Live${time ? ` ${time}` : ""}` : "Offline"));
}

function headline(d, o) {
  const lines = shortLines(d);
  let h1;
  if (lines.length) h1 = h("h1", {}, h("b", { class: "num", text: n(lines.reduce((s, l) => s + l.short, 0)) }), ` ${lines.map((l) => l.name).join(" and ")} copies won't ship on time.`);
  else if (d.shortage > 0) h1 = h("h1", {}, h("b", { class: "num", text: n(d.shortage) }), ` ${nounOf(d)} short before launch.`);
  else h1 = h("h1", { text: "Needs a check before launch." });
  const day = dayLabel(o.launch_date, true), time = deadlineTime(d), left = o.pack_status?.hours_left;
  const parts = [];
  if (day) parts.push(`Trucks leave ${day}${time ? ` ${time}` : ""}.`);
  if (typeof left === "number") parts.push(`${hrs(left)} of packing left.`);
  return [h1, parts.length ? h("p", { class: "countdown" }, icon("clock"), parts.join(" ")) : null, hoursBar(o)];
}
function hoursBar(o) {
  const left = o.pack_status?.hours_left;
  if (!(left > 0)) return null;
  const cells = Math.min(48, Math.ceil(left)), need = Math.max(0, ...(o.products || []).map((p) => p.hours_needed || 0));
  const filled = need > 0 ? Math.min(cells, Math.ceil(need)) : cells;
  const label = `${hrs(left)} packing left${need > 0 ? `. The tightest edition needs ${hrs(need)}.` : "."}`;
  return h("div", { class: "hours", "data-testid": "hours-bar" },
    h("div", { class: "hours-cells", role: "img", "aria-label": label }, Array.from({ length: cells }, (_, i) => h("i", { class: i < filled ? "" : "slack" }))));
}

/* the card shows the first sentence of the recommendation; the drawer has all of it */
const cardTitle = (t) => (t ? String(t).replace(/^First action:\s*/i, "").split(/(?<=[a-z0-9)])\.\s+(?=[A-Z])/)[0] : null);

/* a reviewed supplier offer: facts only, no order or spend button */
function offerFacts(of) {
  return [of.arrives_before_deadline === false
    ? h("p", { class: "line-risk", text: "Arrives after the last packing hour" })
    : of.gap_after_offer != null ? h("p", { class: "line", text: `Gap after offer: ${n(of.gap_after_offer)}` }) : null,
  h("dl", { class: "facts" },
    h("div", {}, h("dt", { text: "Cost" }), h("dd", { class: "num" }, of.cost_eur != null ? eur(of.cost_eur) : unknownChip(), h("small", { class: "caption", text: "from the supplier reply, not confirmed" }))),
    h("div", {}, h("dt", { text: "Approver" }), h("dd", {}, approverChip(of.approver))))];
}
function offerCard(d, card) {
  const of = d.offer;
  const kids = [h("h2", { text: `Offer reviewed: ${n(of.quantity)} units arrive ${of.arrival_label || "at a time to be confirmed"}` }), ...offerFacts(of)];
  if (of.simulated) kids.push(h("div", { class: "row" }, chip("", "Simulated reply")));
  kids.push(h("p", { class: "note", text: "Nothing is ordered. Stock and orders are unchanged." }));
  kids.push(h("p", { class: "note", text: `${of.approver?.role || "The approver"} decides on the spend.` }));
  return card(kids);
}
function offerSection(d) {
  const of = d.offer;
  if (!of) return null;
  const nodes = [h("h3", { text: "Reviewed offer" }), h("p", { class: "rec", text: `${n(of.quantity)} units arrive ${of.arrival_label || "at a time to be confirmed"}.` }), ...offerFacts(of)];
  if (of.extra_units_short_edition != null) nodes.push(h("p", { class: "line", text: `Up to ${n(of.extra_units_short_edition)} more copies of the short edition could be packed${of.packing_hours_after_arrival != null ? ` in ${hrs(of.packing_hours_after_arrival)} after arrival` : ""}.` }));
  if (of.simulated) nodes.push(h("div", { class: "row" }, chip("", "Simulated reply")));
  if (of.reviewed_by) nodes.push(h("p", { class: "note", text: `Reviewed by ${of.reviewed_by}.` }));
  nodes.push(h("p", { class: "note", text: "Nothing is ordered. Stock and orders are unchanged." }));
  return h("section", { id: "sec-offer" }, ...nodes);
}

/* the single decision */
function decisionCard(d, o) {
  const c = d.case || {}, agent = o.agent || {}, emailOn = !!o.integrations?.email_enabled, aiOn = !!o.integrations?.ai_enabled;
  const supplier = d.supplier?.name || "the supplier", busy = state.busy || !!agent.running;
  const kids = [];
  let showFacts = !!d.brief, note = "Nothing is sent until you confirm the supplier email.";
  const card = (extra) => h("section", { class: "decision", "data-testid": "decision-card", "aria-label": "Your decision" }, ...extra);

  if (!(d.shortage > 0) && !c.draft && !c.sent_at) return card([h("h2", { text: "No missing quantity. Check this with Soony." })]);
  if (c.state === "sending" || c.state === "delivery_unknown") return card([h("h2", { text: "Delivery not confirmed. Check sent mail." })]);
  if (d.offer) return offerCard(d, card);
  if (c.sent_at) return card([h("h2", { text: (d.replies || []).length ? "Reply received. Not confirmed yet." : `Sent. Waiting for ${supplier}.` })]);

  let button = null, why = null;
  const approvedAll = !!(c.draft && c.approved) && !(d.escalation && !d.escalation.approved);
  if (c.draft && c.approved) {
    kids.push(h("h2", {}, icon("check"), `Approved by ${approverName(d)}.`));
    if (!approvedAll) { kids.push(h("p", { class: "note", text: `The message to ${d.escalation?.to_role || "the approver"} still needs your OK.` })); button = { label: "Approve the escalation", onclick: () => startApproval("approve") }; }
    else if (manualSend(d)) { button = null; why = MANUAL_NOTE; }
    else { button = { label: "Send to supplier", disabled: !emailOn, onclick: () => startApproval("approve", true) }; if (!emailOn) why = "Sending is off until a sender is registered."; }
    note = null;
  } else {
    kids.push(h("h2", { text: cardTitle(d.brief?.headline || recName(d)) || (d.brief ? "Waiting for the agent's recommendation." : `Ask ${supplier} for the missing ${n(d.shortage)} ${nounOf(d)}.`) }));
    if (!d.brief) {
      showFacts = false;
      const run = aiOn && !c.investigation;
      button = { label: agent.error ? "Run again" : run ? "Run the agent" : "Draft the request", onclick: agent.error || run ? runAgent : draftOnly };
    } else button = { label: "Approve and draft both messages", onclick: () => startApproval("approve") };
  }
  if (d.brief?.confidence === "low") kids.push(h("p", { class: "line-warn", text: "Low confidence: key facts are unconfirmed." }));
  if (agent.error) kids.push(h("p", { class: "line-warn", role: "status", "data-testid": "error-note", text: d.brief ? `Model unavailable. Showing the ${timeOnly(agent.last_run) || "latest"} result and the rule-based plan.` : "The agent stopped. Try again." }));

  if (showFacts) {
    const b = d.brief, opt = recOption(d), gains = briefGains(d);
    kids.push(h("dl", { class: "facts" },
      h("div", {}, h("dt", { text: "Fix costs" }), h("dd", { class: "num" }, b.price_eur != null ? eur(b.price_eur) : unknownChip())),
      h("div", {}, h("dt", { text: "Approver" }), h("dd", {}, approverChip(b.approver))),
      gains != null ? h("div", {}, h("dt", { text: "Copies gained" }), h("dd", { class: "num", text: n(gains) }))
        : h("div", {}, h("dt", { text: "Arrives" }), h("dd", {}, opt?.eta ? etaText(opt.eta) : unknownChip()))));
  }
  if (button) kids.push(h("button", { id: "approve", "data-testid": "approve", class: "btn primary", disabled: button.disabled || busy, onclick: button.onclick }, busy && !button.disabled ? "Working…" : button.label));
  if (why) kids.push(h("p", { class: "why-off", text: why }));
  if (note) kids.push(h("p", { class: "note", text: note }));
  return card(kids);
}

function lanesNode(d, o) {
  const wp = whatIfProduct(d, o), res = state.whatif?.result;
  return h("div", { id: "lanes", class: "lanes-in" }, (o.products || []).map((p) => {
    const line = (d.allocation?.lines || []).find((l) => l.product_id === p.id);
    let short = line?.short > 0 ? line.short : 0, ships = Math.max(0, (p.remaining || 0) - short);
    if (res && wp && wp.id === p.id) { short = res.copies_short || 0; ships = res.copies_ship || 0; }
    const tight = p.hours_needed && p.hours_available && p.hours_needed / p.hours_available > 0.85;
    const badge = short > 0 ? chip("risk", `${n(short)} short`, { dot: true }) : tight ? chip("warn", "Tight", { dot: true }) : chip("ok", "On track", { dot: true });
    const seg = (cls, v) => { const el = h("i", { class: cls }); el.style.flexGrow = String(Math.max(0, v)); return el; };
    const slug = (p.name || "lane").toLowerCase().replace(/[^a-z]/g, "");
    return h("article", { class: "lane", "data-testid": `lane-${slug}` },
      h("div", { class: "lane-head" }, h("h3", { text: p.name || "Edition" }), badge),
      h("div", { class: "track", role: "img", "aria-label": `${n(p.packed)} packed, ${n(ships)} will ship if parts arrive, ${n(short)} short` }, seg("packed", p.packed || 0), ships > 0 ? seg("ships", ships) : null, short > 0 ? seg("short", short) : null),
      h("p", { class: "meta num", text: `${n(p.packed)} of ${n(p.target)} packed.${tight ? ` Needs ${hrs(p.hours_needed)} of ${hrs(p.hours_available)}.` : ""}` }));
  }));
}
function lanesPanel(d, o) {
  const w = state.whatif, kids = [lanesNode(d, o), h("p", { class: "legend" }, h("span", {}, h("i", { class: "packed" }), "Packed"), h("span", {}, h("i", { class: "ships" }), "Will ship"), h("span", {}, h("i", { class: "short" }), "Short"))];
  if (w) {
    const slider = h("input", { id: "whatif-slider", "data-testid": "whatif-slider", "data-whatif": "1", type: "range", min: 0, max: 72, step: 1, value: String(w.hours), "aria-valuetext": w.result?.label || whatIfLabel(w.hours), "aria-describedby": "whatif-output",
      oninput: (e) => setHours(e.target.value, e.target),
      onkeydown: (e) => { if (e.key === "PageUp" || e.key === "PageDown") { e.preventDefault(); const v = Math.max(0, Math.min(72, Number(e.target.value) + (e.key === "PageUp" ? 6 : -6))); e.target.value = String(v); setHours(v, e.target); } } });
    kids.push(h("div", { class: "whatif" }, h("label", { for: "whatif-slider", text: "Parts arrive" }), slider,
      h("output", { id: "whatif-output", "data-testid": "whatif-output", "data-whatif-out": "1", for: "whatif-slider", text: whatIfSentence(d, o) })));
  }
  return h("section", { class: "board", "aria-label": "Packing" }, ...kids);
}

/* boarding-pass option card */
function optionCard(x, d) {
  const isRec = x.recommended === true || (x.recommended === undefined && !!x.title && x.title === recName(d));
  const gains = gainsKnown(x) ? x.copies_gained : null;
  const na = x.feasible === "na" || x.kind === "allocation" || x.kind === "verify";
  const feas = na ? chip("", x.kind === "allocation" ? "Decision" : "To confirm", { dot: true })
    : x.feasible === "yes" ? chip("ok", "On time", { dot: true }) : x.feasible === "late" ? chip("risk", "Too late", { dot: true }) : chip("", "Unconfirmed", { dot: true });
  return h("div", { class: "stub-wrap" }, h("article", { class: "stub", "data-testid": "option-card" },
    h("div", { class: "left" },
      h("div", { class: "price num" }, x.price_eur != null ? eur(x.price_eur) : unknownChip()),
      h("h3", { text: x.title || "Option" }),
      x.detail ? h("p", { text: x.detail }) : null,
      isRec ? h("div", { class: "row" }, chip("ok", "Recommended", { icon: "check" })) : null),
    h("div", { class: "right" },
      h("div", { class: "row" }, icon("truck"), x.eta ? h("b", { class: "num", text: etaText(x.eta) }) : unknownChip()),
      gains != null ? h("div", { class: "row" }, "Copies gained", h("b", { class: "num", text: n(gains) })) : null,
      gains == null && x.potential_units != null ? h("p", { class: "note", text: `Could release up to ${n(x.potential_units)} units, arrival not confirmed.` }) : null,
      h("div", { class: "row" }, approverChip(x.approver)),
      h("div", { class: "row" }, feas))));
}
function holdsBlock(d) {
  const hs = (d.holds || []).filter((x) => x && (x.supplier || x.quantity != null));
  if (!hs.length) return null;
  return h("div", { class: "holds", style: "display:grid;gap:12px;margin-bottom:16px" }, hs.map((x) => h("div", { class: "line-risk", "data-testid": "hold", style: "display:grid;gap:6px" },
    h("b", { text: `${x.supplier || "A supplier"} is holding ${x.quantity != null ? `${n(x.quantity)} units` : "units"}.` }),
    x.required_action ? h("span", { text: x.required_action }) : null,
    x.consequence ? h("span", { text: x.consequence }) : null,
    h("span", { class: "row", style: "display:flex;gap:8px;flex-wrap:wrap;align-items:center" }, x.who_can_unlock?.role ? [h("span", { text: "Can unlock:" }), approverChip(x.who_can_unlock)] : null, x.needs_review ? chip("warn", "Needs review", { dot: true }) : null))));
}
function optionsBlock(d, cls) {
  const opts = (d.options || []).slice(0, 3), holds = holdsBlock(d);
  if (!opts.length && !holds) return null;
  return h("section", { class: cls || "options col-wide", "aria-label": "Options" }, holds, opts.length ? [h("h2", { text: "Options" }), h("div", { class: "stubs" }, opts.map((x) => optionCard(x, d)))] : null);
}

function sinceStrip(d, o) {
  const s = d.since_last_run || o.since_last_run || d.since || o.since;
  if (!s) return null;
  const count = typeof s.changes === "number" ? s.changes : Array.isArray(s.changes) ? s.changes.length : typeof s.count === "number" ? s.count : 0;
  if (!count) return null;
  const text = `Since last run: ${count} ${count === 1 ? "change" : "changes"}.${typeof s.reason === "string" && s.reason ? ` ${s.reason}` : ""}`;
  const fresh = state.sinceSeen !== text; state.sinceSeen = text;
  return h("p", { class: `since col-wide${fresh ? " enter" : ""}`, "data-testid": "since-strip", text });
}

function footLines(d) {
  const groups = agentGroups(d), need = approvalsNeeded(d);
  const money = d.value?.headline_eur != null
    ? (d.value.basis === "cost" || !d.value.basis ? `About ${eur(d.value.headline_eur)} of product cost short (cost basis, not price).` : `About ${eur(d.value.headline_eur)} at stake${d.value.label ? ` (${d.value.label})` : ""}.`)
    : null;
  const agent = groups.length ? `${groups.length} agents checked. ${need ? `${need} ${need === 1 ? "needs" : "need"} your approval.` : "Everything is approved."}` : "The agent has not run yet.";
  return h("div", { class: "col-wide", style: "display:grid;gap:12px" },
    money ? h("p", { class: "money", text: money }) : null,
    h("div", { class: "agent-line" }, h("span", { "data-testid": "agent-summary", text: agent }), h("button", { id: "details", "data-testid": "details", class: "linkbtn", onclick: () => openDrawer("brief", "details") }, "Details")));
}

function mainView(d, o) {
  return h("div", { class: state.entered ? "" : "enter" },
    h("header", { class: "band" }, h("div", { class: "band-in" }, topBar(o), h("div", { class: "headline" }, ...headline(d, o)))),
    h("main", { class: "page" }, sinceStrip(d, o), decisionCard(d, o), lanesPanel(d, o), optionsBlock(d), footLines(d)));
}

/* ---------- states: skeleton, empty, error ---------- */
function skeleton() {
  const b = (w, hgt) => { const el = h("div", { class: "block" }); el.style.width = w; el.style.height = hgt; return el; };
  return h("div", { class: "skel", "data-testid": "skeleton", role: "status", "aria-label": "Loading" },
    h("div", { class: "band" }, h("div", { class: "band-in" }, h("div", { class: "bar" }, h("div", { class: "brand" }, "Launch Control")), h("div", { class: "headline" }, b("min(420px,80%)", "44px")))),
    h("div", { class: "page" }, h("div", { class: "decision" }, b("70%", "26px"), b("100%", "48px"), b("100%", "48px"), b("100%", "48px")), h("div", { class: "board" }, b("100%", "80px"), b("100%", "80px"))));
}
function showError() {
  $("app").replaceChildren(h("div", { class: "state-box", "data-testid": "error-state", role: "alert" }, h("p", { text: "Can't reach the service." }), h("button", { class: "btn small primary", onclick: () => { $("app").replaceChildren(); loadAll(true); } }, "Retry")));
  $("app").removeAttribute("aria-busy");
}
function emptyView(o) {
  return h("div", {}, h("header", { class: "band" }, h("div", { class: "band-in" }, topBar(o), h("div", { class: "headline" }, h("h1", { text: "Nothing is at risk right now." })))),
    h("main", { class: "page" }, h("p", { class: "col-wide state-box", "data-testid": "empty-state", text: "Waiting for Soony's data." })));
}

/* ---------- drawer (native dialog) ---------- */
function briefSection(d) {
  const b = d.brief, nodes = [h("h3", { text: "Decision brief" })];
  if (!b) { nodes.push(h("p", { class: "empty", text: "No decision brief yet." })); return h("section", { id: "sec-brief" }, ...nodes); }
  const opt = recOption(d), gains = briefGains(d), conf = b.confidence;
  nodes.push(h("p", { class: "rec", text: b.recommendation || "No recommendation yet." }));
  nodes.push(h("dl", { class: "dl-card" },
    h("div", {}, h("dt", { text: "Fix costs" }), h("dd", { class: "num" }, b.price_eur != null ? eur(b.price_eur) : unknownChip())),
    h("div", {}, h("dt", { text: "Approver" }), h("dd", {}, approverChip(b.approver))),
    gains != null ? h("div", {}, h("dt", { text: "Copies gained" }), h("dd", { class: "num", text: n(gains) })) : h("div", {}, h("dt", { text: "Arrives" }), h("dd", {}, opt?.eta ? etaText(opt.eta) : unknownChip())),
    b.deadline ? h("div", {}, h("dt", { text: "Deadline" }), h("dd", { text: b.deadline })) : null));
  if (conf) nodes.push(h("div", { class: "btn-row" }, chip(conf === "low" ? "warn" : conf === "high" ? "ok" : "", `${cap(conf)} confidence`, { dot: true })));
  if (conf === "low") nodes.push(h("p", { class: "line-warn", text: "Low confidence: key facts are unconfirmed." }));
  if ((b.risks || []).length) nodes.push(h("h4", { text: "Risks" }), h("ul", { class: "plain" }, b.risks.map((r) => h("li", { text: r }))));
  if ((b.verify_next || []).length) nodes.push(h("h4", { text: conf === "low" ? "What to confirm first" : "What I'd verify next" }), h("ul", { class: "plain" }, b.verify_next.map((r) => h("li", { text: r }))));
  if (d.value?.claim_eur != null) nodes.push(h("p", { class: "note", text: `A late-delivery claim of about ${eur(d.value.claim_eur)} may apply. Legal decides.` }));
  nodes.push(optionsBlock(d, "options-drawer"));
  nodes.push(h("div", { class: "btn-row" }, h("button", { class: "btn line small", "data-testid": "brief-print", onclick: () => window.print() }, icon("printer"), "Print one-page brief")));
  return h("section", { id: "sec-brief" }, ...nodes);
}
function railSection(d, o) {
  const groups = agentGroups(d), agent = o.agent || {};
  const kind = { auto: ["Automatic", ""], draft: ["Draft only", ""], approval: ["Needs approval", "warn"], never: ["Never by the app", ""] };
  const rows = groups.map((g) => {
    const m = g.main, a = kind[m.autonomy] || ["", ""];
    const cls = m.outcome === "needs human review" ? "wait" : m.outcome === "skipped" ? "skip" : "";
    return h("li", { class: cls, "data-testid": "agent-step" }, h("span", { class: "rdot", "aria-hidden": "true" }),
      h("div", {}, h("div", { class: "who" }, g.agent, a[0] ? chip(a[1], a[0], { icon: m.autonomy === "approval" ? "user-check" : m.autonomy === "draft" ? "file-text" : m.autonomy === "auto" ? "shield-check" : "x" }) : null),
        h("div", { class: "what", text: `${m.action || ""}${m.outcome === "needs human review" ? ". Waiting for you." : ""}` })));
  });
  const live = agent.running ? h("li", { class: "now" }, h("span", { class: "rdot", "aria-hidden": "true" }), h("div", {}, h("div", { class: "who", text: "Working" }), h("div", { class: "what", text: String((agent.steps || []).slice(-1)[0]?.message || "Starting") }))) : null;
  return h("section", { id: "sec-rail" }, h("h3", { text: "Agents" }),
    rows.length || live ? h("ol", { class: "rail", "data-testid": "agent-rail" }, live, rows) : h("p", { class: "empty", text: "The agent has not run yet." }));
}
function numbersSection(d) {
  const ok = d.numbers_verified === true;
  const rows = [["Needed", d.required], ["In stock (estimate)", d.usable_stock], ["Arriving before launch", d.incoming], ["Missing", d.shortage]];
  const nodes = [h("h3", { text: "Numbers" }),
    h("div", { class: "btn-row" }, h("span", { "data-testid": "numbers-badge" }, ok ? chip("ok", "Numbers verified", { icon: "shield-check" }) : chip("warn", "Numbers not verified", { dot: true }))),
    h("dl", { class: "dl-card" }, rows.map(([k, v], i) => h("div", { class: i === rows.length - 1 ? "risk" : "" }, h("dt", { text: k }), h("dd", { class: "num", text: n(v) || "unknown" }))))];
  const cf = d.conflicts || [];
  if (cf.length) nodes.push(h("h4", { text: "Records that disagree" }), ...cf.map((x) => h("div", { class: "conflict" }, h("b", { text: x.field || "Record" }), h("span", { text: x.why || "" }), x.confidence ? h("span", { text: `${cap(x.confidence)} confidence` }) : null)));
  if (state.whatif) nodes.push(h("div", { class: "field" }, h("label", { for: "whatif-text", text: "Parts arrive in (hours, 0 to 72)" }),
    h("input", { id: "whatif-text", class: "input", "data-whatif": "1", type: "number", inputmode: "numeric", min: 0, max: 72, step: 1, value: String(state.whatif.hours), oninput: (e) => { if (e.target.value !== "") setHours(e.target.value, e.target); } }),
    h("p", { class: "note", "data-whatif-out": "1", "aria-live": "polite", text: whatIfSentence(d, state.overview) })));
  return h("section", { id: "sec-numbers" }, ...nodes);
}
function mailBox(subject, body, testid) {
  return h("div", { class: "mail", "data-testid": testid }, h("header", {}, h("b", { text: "Subject: " }), subject || ""), h("pre", { text: body || "" }));
}
function draftsSection(d, o) {
  const c = d.case || {}, dr = c.draft, esc = d.escalation, emailOn = !!o.integrations?.email_enabled;
  const nodes = [h("h3", { text: "Messages" })];
  if (dr) nodes.push(h("h4", { text: `To ${d.supplier?.name || "the supplier"}` }), mailBox(dr.subject, dr.body, "draft-supplier"));
  else nodes.push(h("p", { class: "empty", text: "No request yet." }), h("div", { class: "btn-row" }, h("button", { class: "btn line small", disabled: state.busy, onclick: draftOnly }, "Create the request")));
  const extra = (d.supplier_drafts || []).filter((x) => x && x.body && !(dr && x.subject === dr.subject));
  for (const x of extra) nodes.push(h("h4", { text: `To ${x.supplier || "another supplier"}` }), mailBox(x.subject, x.body, "draft-supplier-extra"), h("p", { class: "note", text: "Draft only. Nothing is sent from here." }));
  if (esc) nodes.push(h("h4", { text: `To ${esc.to_role || "the approver"}` }), mailBox(esc.subject, esc.body, "draft-escalation"));
  const all = !!(dr && c.approved) && !(esc && !esc.approved);
  if (c.sent_at) nodes.push(h("p", { class: "note", text: "Sent." }));
  else if (all) {
    nodes.push(chip("ok", `Approved by ${approverName(d)}`, { icon: "check" }),
      manualSend(d) ? h("p", { class: "note", text: MANUAL_NOTE })
        : h("div", { class: "btn-row" }, h("button", { id: "send-btn", class: "btn primary small", disabled: !emailOn || state.busy, onclick: sendMail }, "Send to supplier")),
      !emailOn && !manualSend(d) ? h("p", { class: "note", text: "Sending is off. No sender is registered yet." }) : null);
  } else if (dr) {
    if (!state.panel) nodes.push(h("div", { class: "btn-row" }, h("button", { id: "approve-open", class: "btn primary small", disabled: state.busy, onclick: () => { state.panel = true; fillDrawer(); $("name-input")?.focus(); } }, esc ? "Approve both messages" : "Approve the message")));
    else {
      const name = (state.approver || "").trim();
      nodes.push(h("div", { class: "approval", role: "group", "aria-label": "Approval" },
        h("div", { class: "field" }, h("label", { for: "name-input", text: "Your name" }), h("input", { id: "name-input", class: "input", autocomplete: "name", value: state.approver, oninput: (e) => { state.approver = e.target.value; const b = $("confirm-approve"); if (b) { const nm = e.target.value.trim(); b.disabled = nm.length < 2 || state.busy; b.textContent = nm.length >= 2 ? `Confirm as ${nm}` : "Confirm"; } } })),
        h("p", { class: "note", text: "Approving does not send anything." }),
        h("div", { class: "btn-row" },
          h("button", { id: "confirm-approve", "data-testid": "confirm-approve", class: "btn primary small", disabled: name.length < 2 || state.busy, onclick: confirmApproval }, name.length >= 2 ? `Confirm as ${name}` : "Confirm"),
          h("button", { class: "btn line small", onclick: () => { state.panel = false; fillDrawer(); $("approve-open")?.focus(); } }, "Cancel"))));
    }
  }
  return h("section", { id: "sec-drafts" }, ...nodes);
}
function casesSection(d, o) {
  const agent = o.agent || {}, portal = o.integrations?.portal_enabled && !(o.sync || {}).error;
  return h("section", { id: "sec-cases" }, h("h3", { text: "Cases" }),
    h("div", { class: "cases" }, (o.issues || []).map((i) => h("button", { "aria-current": i.id === state.selected ? "true" : "false", onclick: () => { $("drawer").close(); selectCase(i.id); } }, h("span", { text: (i.title || "Case").split(":")[0] }), i.shortage > 0 ? chip("risk", `${n(i.shortage)} short`, { dot: true }) : chip("", "Check")))),
    h("div", { class: "btn-row" },
      h("button", { class: "btn line small", disabled: state.busy || agent.running, onclick: runAgent }, "Run again"),
      h("button", { class: "btn line small", disabled: state.busy, onclick: syncNow }, "Check for new data")),
    h("div", { class: "health" }, h("span", { class: o.integrations?.ai_enabled ? "" : "off" }, h("b", { "aria-hidden": "true" }), `Agent ${o.integrations?.ai_enabled ? "ready" : "not set up"}`),
      h("span", { class: portal ? "" : "off" }, h("b", { "aria-hidden": "true" }), `Portal ${portal ? "live" : "offline"}`)));
}
function drawerView(d, o) {
  return [h("div", { class: "sheet" },
    h("div", { class: "sheet-head" }, h("h2", { id: "drawer-title", text: "Details" }), h("button", { id: "drawer-close", class: "icon-btn", "aria-label": "Close details", onclick: () => $("drawer").close() }, icon("x"))),
    offerSection(d), briefSection(d), railSection(d, o), numbersSection(d), draftsSection(d, o), casesSection(d, o))];
}
function fillDrawer() {
  const dlg = $("drawer"); if (!state.overview || !state.detail) return;
  const sheet = dlg.querySelector(".sheet"), top = sheet ? sheet.scrollTop : 0, active = document.activeElement;
  const focusId = active && dlg.contains(active) ? active.id : "", pos = active && active.selectionStart != null ? active.selectionStart : null;
  dlg.replaceChildren(...drawerView(state.detail, state.overview));
  const s2 = dlg.querySelector(".sheet"); if (s2) s2.scrollTop = top;
  if (focusId) { const el = $(focusId); if (el && !el.disabled) { el.focus({ preventScroll: true }); if (pos != null && el.type !== "number" && el.setSelectionRange) try { el.setSelectionRange(pos, pos); } catch (e) { /* ignore */ } } }
}
function openDrawer(section, openerId) {
  if (!state.detail) return;
  const dlg = $("drawer");
  state.openerId = openerId || "details";
  fillDrawer();
  if (!dlg.open) dlg.showModal();
  state.drawerOpen = true;
  const target = $(`sec-${section}`);
  if (target) target.scrollIntoView({ block: "start" });
  if (state.panel) $("name-input")?.focus();
}
$("drawer").addEventListener("close", () => {
  state.drawerOpen = false; state.panel = false;
  render(true);
  const back = $(state.openerId) || $("details") || $("case-select");
  if (back) back.focus({ preventScroll: true });
});
$("drawer").addEventListener("click", (e) => { if (e.target === $("drawer")) $("drawer").close(); });

/* ---------- one-page brief for printing ---------- */
function fillPrint(d) {
  const p = $("print-brief"), b = d.brief || {}, gains = briefGains(d), opt = recOption(d);
  const row = (k, v) => (v ? [h("dt", { text: k }), h("dd", { text: v })] : []);
  p.replaceChildren(
    h("h1", { text: "Decision brief" }),
    h("p", { text: `${d.title || ""}${d.supplier?.name ? `. Supplier: ${d.supplier.name}.` : ""}` }),
    h("h2", { text: "Recommendation" }),
    h("p", { text: b.recommendation || "No recommendation yet." }),
    h("dl", {}, ...row("Fix costs", b.price_eur != null ? `EUR ${n(b.price_eur)}` : "unknown"), ...row("Approver", b.approver?.role ? `${b.approver.name ? `${b.approver.name}, ` : ""}${b.approver.role}${b.approver.vacancy ? " (seat vacant)" : ""}` : "unknown"),
      ...row(gains != null ? "Copies gained" : "Arrives", gains != null ? n(gains) : opt?.eta ? etaText(opt.eta) : "unknown"), ...row("Deadline", b.deadline || ""), ...row("Confidence", b.confidence ? `${cap(b.confidence)}${b.confidence === "low" ? ". Key facts are unconfirmed." : ""}` : "")),
    (b.risks || []).length ? [h("h2", { text: "Risks" }), h("ul", {}, b.risks.map((r) => h("li", { text: r })))] : null,
    (b.verify_next || []).length ? [h("h2", { text: b.confidence === "low" ? "What to confirm first" : "What I'd verify next" }), h("ul", {}, b.verify_next.map((r) => h("li", { text: r })))] : null,
    h("h2", { text: "Numbers" }),
    h("p", { text: `Needed ${n(d.required) || "unknown"}. In stock (estimate) ${n(d.usable_stock) || "unknown"}. Arriving before launch ${n(d.incoming) || "unknown"}. Missing ${n(d.shortage) || "unknown"}.` }),
    h("p", { class: "small", text: d.numbers_verified === true ? "Numbers verified." : "Numbers not verified." }));
}

/* ---------- render ---------- */
function render(force) {
  const o = state.overview; if (!o) return;
  const d = state.detail, app = $("app");
  const sig = JSON.stringify([o, d, state.busy, state.selected, state.panel]);
  if (!force && sig === state.sig) return;
  const active = document.activeElement;
  if (!force && active && (active.id === "whatif-slider" || (app.contains(active) && ["INPUT", "TEXTAREA", "SELECT"].includes(active.tagName)))) return;
  if (!force && state.drawerOpen && active && $("drawer").contains(active) && ["INPUT", "TEXTAREA"].includes(active.tagName)) return;
  state.sig = sig;
  const focusId = active && active.id, y = window.scrollY;
  app.removeAttribute("aria-busy");
  if (!(o.issues || []).length || !d) { app.replaceChildren(emptyView(o)); return; }
  ensureWhatIf(d);
  app.replaceChildren(mainView(d, o));
  state.entered = true;
  window.scrollTo(0, y);
  fillPrint(d);
  if (state.drawerOpen) fillDrawer();
  else if (focusId && active !== document.body && !$("drawer").open) $(focusId)?.focus({ preventScroll: true });
}

setTimeout(() => { if (!state.overview && !state.failed) $("app").replaceChildren(skeleton()); }, 300);
loadAll(true);
setInterval(() => { if (!document.hidden && !state.busy) loadAll(false); }, 3000);
