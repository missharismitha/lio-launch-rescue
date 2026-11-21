"use strict";

const state = { overview: null, selected: null, detail: null, tab: "evidence", busy: false, refreshing: false };
const $ = (id) => document.getElementById(id);
const number = (value) => typeof value === "number" && Number.isFinite(value) ? new Intl.NumberFormat("en-GB").format(value) : "—";
const formatTime = (value) => {
  if (!value) return "Not yet checked";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Berlin" }).format(date) + " Berlin";
};
const human = (value) => String(value || "pending").replace(/[_-]/g, " ");
function element(tag, className, text) { const node = document.createElement(tag); if (className) node.className = className; if (text !== undefined) node.textContent = text; return node; }
function clear(node) { node.replaceChildren(); return node; }
function message(text, type = "info") { return element("div", `notice ${type}`, text); }
function showError(error) { $("global-error").textContent = error.message || String(error); $("global-error").hidden = false; }
async function api(path, body) {
  const response = await fetch(path, { method: body === undefined ? "GET" : "POST", headers: { "Content-Type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(typeof data.detail === "string" ? data.detail : data.error || `Request failed (${response.status}).`);
  return data;
}
function renderOverview() {
  const overview = state.overview || {}, issues = overview.issues || [], sync = overview.sync || {}, integrations = overview.integrations || {};
  $("risk-count").textContent = number(issues.filter(issue => issue.severity !== "info" && !["resolved", "dismissed"].includes(issue.status)).length);
  const launchDate = /^\d{4}-\d{2}-\d{2}$/.test(overview.launch_date || "") ? new Date(`${overview.launch_date}T12:00:00Z`) : null;
  $("launch-date").textContent = launchDate && !Number.isNaN(launchDate.getTime()) ? new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "Europe/Berlin" }).format(launchDate) : "Not available";
  $("issue-total").textContent = String(issues.length);
  const products = overview.products || [];
  for (const [prefix, suffix] of [["standard", "STD"], ["collectors", "CE"]]) {
    const product = products.find(item => item.id?.endsWith(suffix));
    $(`${prefix}-remaining`).textContent = number(product?.remaining);
    $(`${prefix}-rate`).textContent = product?.rate_per_hour ? `${number(product.rate_per_hour)} units / packing hour` : "Packing rate not available";
  }
  $("source-mode").textContent = integrations.portal_enabled ? "Portal monitoring enabled" : "Local snapshot";
  $("checked-at").textContent = `Last checked ${formatTime(sync.last_checked)}`;
  $("snapshot-at").textContent = `Source snapshot ${formatTime(overview.snapshot_at)}`;
  $("poll-note").textContent = integrations.portal_enabled ? `Portal checks every ${sync.poll_seconds || 60}s · screen updates every 15s` : "Portal token needed for automatic external updates · screen updates every 15s";
  $("sync-button").disabled = !integrations.portal_enabled || state.refreshing;
  $("refresh-button").disabled = state.refreshing;
  const tags = element("div", "integration-tags");
  for (const [label, enabled] of [["Portal", integrations.portal_enabled], ["AI", integrations.ai_enabled], ["Email", integrations.email_enabled]]) tags.append(element("span", `integration-tag${enabled ? " connected" : ""}`, `${label} ${enabled ? "connected" : "not configured"}`));
  clear($("integrations")).append(tags);
  const warnings = clear($("warnings"));
  if (sync.error) warnings.append(message(`Portal check failed: ${sync.error}. Showing the last available local data.`, "error"));
  for (const warning of overview.warnings || []) warnings.append(message(typeof warning === "string" ? warning : warning.message || JSON.stringify(warning)));
  const list = clear($("issue-list"));
  if (!issues.length) list.append(element("p", "loading", "No component risks available. Check the data folder and refresh."));
  for (const issue of issues) {
    const button = element("button", `issue-button${state.selected === issue.id ? " selected" : ""}`);
    button.type = "button";
    button.setAttribute("aria-pressed", String(state.selected === issue.id));
    const meta = element("div", "issue-meta");
    meta.append(element("span", `badge ${issue.severity || "info"}`, human(issue.severity)), element("span", "issue-material", issue.material_id || "Component review"));
    button.append(meta, element("strong", "", issue.title), element("small", "", typeof issue.shortage === "number" && issue.shortage > 0 ? `${number(issue.shortage)} units at risk` : human(issue.status)));
    button.addEventListener("click", () => selectIssue(issue.id));
    list.append(button);
  }
}
async function selectIssue(id) {
  state.selected = id;
  state.detail = null;
  state.tab = "evidence";
  renderOverview();
  $("issue-detail").replaceChildren(element("p", "loading", "Opening evidence and case history…"));
  try { const detail = await api(`/api/issues/${encodeURIComponent(id)}`); if (state.selected === id) { state.detail = detail; renderDetail(); } } catch (error) { showError(error); }
}
function getIssue() { const detail = state.detail || {}; return detail.issue || detail; }
function getCase() { return state.detail?.case || state.detail?.case_state || {}; }
function renderDetail() {
  if (!state.detail) return;
  const issue = getIssue(), container = clear($("issue-detail"));
  const header = element("div", "detail-header"), heading = element("div");
  heading.append(element("span", `badge ${issue.severity || "info"}`, human(issue.status || issue.severity)), element("h2", "", issue.title || "Component review"), element("p", "material", issue.material_id || ""));
  const confidence = element("div", "confidence", "Evidence confidence"); confidence.append(element("strong", "", human(issue.confidence || "review required"))); header.append(heading, confidence);
  container.append(header, element("p", "detail-summary", issue.summary || "Review the underlying sources before acting."));
  const math = element("div", "math-grid");
  for (const [label, value] of [["Remaining requirement", issue.required], ["Usable stock estimate", issue.usable_stock], ["Expected incoming", issue.incoming], ["Component gap", issue.shortage]]) { const cell = element("div", "math-cell"); cell.append(element("span", "", label), element("strong", "", number(value))); math.append(cell); }
  container.append(math);
  const affected = Array.isArray(issue.affected_products) ? issue.affected_products.map(p => typeof p === "string" ? p : p.name || p.id).join(", ") : issue.affected_products;
  container.append(element("p", "data-note", `Recorded stock: ${number(issue.recorded_stock)}. ${affected ? `Affected: ${affected}. ` : ""}Figures reflect available source records, not a physical count or a confirmed recovery.`));
  const tabs = element("div", "tabs");
  for (const [key, name] of [["evidence", "Source evidence"], ["recovery", "Recovery plan"], ["action", "Approval & activity"]]) { const button = element("button", `tab${state.tab === key ? " active" : ""}`, name); button.type = "button"; button.setAttribute("aria-pressed", String(state.tab === key)); button.addEventListener("click", () => { state.tab = key; renderDetail(); }); tabs.append(button); }
  container.append(tabs);
  const panel = element("div", "panel");
  if (state.tab === "evidence") renderEvidence(panel, issue);
  if (state.tab === "recovery") renderRecovery(panel, issue);
  if (state.tab === "action") renderAction(panel, issue);
  container.append(panel);
}
function renderEvidence(panel, issue) {
  panel.append(element("h3", "", "Trace the decision to its source"), element("p", "panel-intro", "Compare original documents with recorded inventory. Contradictions stay visible until verified."));
  if (!issue.evidence?.length) panel.append(message("No supporting files are linked yet. Treat this finding as unverified."));
  for (const evidence of issue.evidence || []) {
    const card = element("article", "evidence-card"), top = element("div", "evidence-top"), label = element("div");
    label.append(element("h4", "", evidence.label || evidence.path || "Source document"), element("p", "source-path", evidence.path || ""));
    top.append(label);
    if (evidence.path) { const link = element("a", "", "Open source"); link.href = `/api/evidence?path=${encodeURIComponent(evidence.path)}`; link.target = "_blank"; link.rel = "noopener noreferrer"; top.append(link); }
    card.append(top);
    if (evidence.excerpt) card.append(element("blockquote", "", evidence.excerpt));
    panel.append(card);
  }
}
function displayValue(value) {
  if (value === null || value === undefined) return "Not established";
  if (Array.isArray(value)) return value.map(displayValue).join(" · ");
  if (typeof value === "object") return Object.entries(value).map(([key, val]) => `${human(key)}: ${displayValue(val)}`).join("; ");
  return String(value);
}
function renderRecovery(panel, issue) {
  panel.append(element("h3", "", "Investigate before committing"), element("p", "panel-intro", "A recovery option is a proposal. Availability, delivery and authorized approval must be confirmed before it can protect the launch."));
  const investigation = getCase().investigation, aiEnabled = !!state.overview?.integrations?.ai_enabled;
  panel.append(element("p", "data-note", "Analysis source: deterministic reconciliation of local customer files. Optional AI investigation is shown separately below."));
  if (issue.recovery && Object.keys(issue.recovery).length) {
    const fields = element("dl", "detail-fields");
    for (const [key, value] of Object.entries(issue.recovery)) { if (value === undefined) continue; const field = element("div", "detail-field"); field.append(element("dt", "", human(key)), element("dd", "", displayValue(value))); fields.append(field); }
    panel.append(fields);
  }
  for (const action of issue.actions || []) {
    const card = element("article", "action-card"), body = element("div");
    body.append(element("h4", "", typeof action === "string" ? action : action.title), element("p", "", typeof action === "string" ? "" : action.description)); card.append(element("span", "action-symbol", "◇"), body); panel.append(card);
  }
  if (!issue.actions?.length && !issue.recovery) panel.append(message("No feasible recovery has been established. Escalate the gap and investigate supplier availability."));
  const aiSection = element("section", "ai-investigation");
  aiSection.append(element("h3", "", "AI investigation"), element("p", "panel-intro", aiEnabled ? "Running this investigation sends source excerpts to the configured OpenAI model. It can inspect evidence and recommend next steps; it cannot send supplier email or commit spending." : "AI investigation is not configured. Configure an OpenAI API key and model to enable it. The reconciliation above does not claim an AI model ran."));
  const investigate = element("button", "button button-quiet", state.busy ? "Working…" : "Run AI investigation");
  investigate.disabled = state.busy || !aiEnabled;
  investigate.addEventListener("click", () => perform("investigate", {}));
  aiSection.append(investigate);
  if (investigation?.text) {
    const card = element("article", "evidence-card investigation-result"), fingerprint = investigation.source_fingerprint;
    const stale = fingerprint && getCase().source_fingerprint && fingerprint !== getCase().source_fingerprint;
    card.append(element("h4", "", stale ? "Previous AI investigation · sources changed" : "Saved AI investigation"), element("p", "data-note", `Model: ${investigation.model || "Not recorded"} · Run ${formatTime(investigation.at)}${fingerprint ? ` · Source ${String(fingerprint).slice(0, 12)}` : ""}`));
    if (stale) card.append(message("The sources have changed since this investigation. Run it again before relying on its recommendations."));
    card.append(element("pre", "draft-body", investigation.text));
    const calls = investigation.tool_calls || [];
    if (calls.length) {
      card.append(element("h4", "tool-heading", "Evidence tools used"));
      const tools = element("ul", "tool-provenance");
      for (const call of calls) { const item = element("li"); item.append(element("strong", "", human(call.name)), element("span", "", displayValue(call.arguments || {}))); tools.append(item); }
      card.append(tools);
    } else card.append(element("p", "data-note", "No tool calls recorded for this investigation."));
    aiSection.append(card);
  } else aiSection.append(element("p", "data-note", "No AI investigation has been recorded for this case."));
  panel.append(aiSection);
  const button = element("button", "button button-dark", "Prepare supplier inquiry"); button.disabled = state.busy; button.style.marginTop = "20px"; button.addEventListener("click", () => perform("draft", {})); panel.append(button);
}
function renderAction(panel) {
  const caseData = getCase(), integrations = state.overview?.integrations || {}, draft = caseData.draft;
  const status = element("div", "workflow-status"); status.append(element("span", "badge", human(caseData.state || "not started")), element("span", "", caseData.sent_at ? `Sent ${formatTime(caseData.sent_at)}` : "No supplier commitment recorded")); panel.append(status);
  panel.append(message("Approval here authorizes the displayed inquiry only. It does not approve spending, release a purchase order, or replace Soony’s required business approver."));
  const draftButton = element("button", "button button-quiet", draft ? "Regenerate inquiry draft" : "Prepare supplier inquiry"); draftButton.disabled = state.busy; draftButton.addEventListener("click", () => perform("draft", {})); panel.append(draftButton);
  if (draft) {
    const box = element("div", "draft-box");
    for (const [label, value] of [["Recipient", draft.to || "Not configured — email cannot be sent"], ["Subject", draft.subject || "No subject"]]) box.append(element("span", "draft-label", label), element("p", "draft-value", Array.isArray(value) ? value.join(", ") : value));
    box.append(element("pre", "draft-body", draft.body || "")); panel.append(box);
    const form = element("form", "approval-form"), nameLabel = element("label", "", "Approver name"), name = element("input"), noteLabel = element("label", "", "Approval note"), note = element("textarea");
    name.id = "approver-name"; nameLabel.htmlFor = name.id; name.required = true; name.autocomplete = "name"; name.placeholder = "Your name"; name.value = caseData.approver || "";
    note.id = "approval-note"; noteLabel.htmlFor = note.id; note.placeholder = "Conditions or context for this inquiry"; note.value = caseData.approval_note || "";
    const buttons = element("div", "workflow-buttons"), approve = element("button", "button button-primary", "Approve displayed inquiry"), send = element("button", "button button-dark", "Send approved inquiry");
    approve.type = "submit"; approve.disabled = state.busy || !!caseData.sent_at;
    send.type = "button"; send.disabled = state.busy || !integrations.email_enabled || !draft.to || !["approved", "ready_to_send"].includes(caseData.state) || !!caseData.sent_at;
    send.addEventListener("click", () => perform("send", {})); buttons.append(approve, send);
    form.append(nameLabel, name, noteLabel, note, buttons); form.addEventListener("submit", event => { event.preventDefault(); if (name.value.trim()) perform("approve", { approver: name.value.trim(), note: note.value.trim() }); }); panel.append(form);
    if (!integrations.email_enabled) panel.append(element("p", "data-note", "Email transport is not configured. Drafting and approval are available; nothing will be sent."));
    if (caseData.approver) panel.append(element("p", "data-note", `Last approver: ${caseData.approver}. Approval becomes invalid if the underlying evidence or draft changes.`));
  }
  panel.append(element("h3", "", "Case activity"));
  const events = state.detail?.events || caseData.events || [];
  if (!events.length) panel.append(element("p", "panel-intro", "No case actions recorded yet."));
  const list = element("ol", "event-list");
  for (const event of events) {
    const li = element("li"), body = element("div"); body.append(element("time", "", formatTime(event.created_at || event.timestamp || event.at)), element("strong", "", human(event.kind || event.type || event.action || "Case updated")));
    const detail = event.detail || event.message || event.note || event.payload;
    if (detail) body.append(element("p", "", displayValue(detail)));
    li.append(element("span", "event-dot"), body); list.append(li);
  }
  panel.append(list);
}
async function perform(action, body) {
  if (state.busy) return;
  const selectedId = state.selected;
  state.busy = true; $("global-error").hidden = true; renderDetail();
  try {
    const detail = await api(`/api/issues/${encodeURIComponent(selectedId)}/${action}`, body);
    if (state.selected === selectedId) { state.detail = detail; state.tab = action === "investigate" ? "recovery" : "action"; }
  } catch (error) { showError(error); }
  finally { state.busy = false; renderDetail(); }
}
async function loadOverview(initial = false) {
  try {
    const previousIssue = state.overview?.issues?.find(issue => issue.id === state.selected);
    state.overview = await api("/api/overview"); renderOverview();
    const issues = state.overview.issues || [];
    if (initial || !state.selected || !issues.some(issue => issue.id === state.selected)) {
      const issue = issues.find(item => item.id === "game-card-shortage") || issues[0]; if (issue) await selectIssue(issue.id);
    } else if (JSON.stringify(previousIssue) !== JSON.stringify(issues.find(issue => issue.id === state.selected))) {
      const selectedId = state.selected;
      const detail = await api(`/api/issues/${encodeURIComponent(selectedId)}`);
      if (state.selected === selectedId) { state.detail = detail; renderDetail(); }
    }
  } catch (error) { showError(error); $("source-mode").textContent = "Service unavailable"; }
}
async function refresh(kind) {
  if (state.refreshing) return;
  state.refreshing = true; $("global-error").hidden = true; renderOverview();
  try { await api(`/api/${kind}`, {}); await loadOverview(); if (state.selected) { state.detail = await api(`/api/issues/${encodeURIComponent(state.selected)}`); renderDetail(); } } catch (error) { showError(error); }
  finally { state.refreshing = false; renderOverview(); }
}
$("refresh-button").addEventListener("click", () => refresh("refresh"));
$("sync-button").addEventListener("click", () => refresh("sync"));
loadOverview(true);
setInterval(() => { if (!document.hidden && !state.busy && !state.refreshing) loadOverview(); }, 15000);
