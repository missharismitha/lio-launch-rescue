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
const iconPaths = {
 search:["m21 21-4.4-4.4","M19 11a8 8 0 1 1-16 0 8 8 0 0 1 16 0"],
 spark:["m12 3 2.4 6.6L21 12l-6.6 2.4L12 21l-2.4-6.6L3 12l6.6-2.4Z"],
 files:["M9 3h7l4 4v14H9Z","M16 3v5h4","M5 7H3v14h2","M12 12h5m-5 4h5"],
 activity:["M3 12h4l3-8 4 16 3-8h4"],plug:["M8 3v5m8-5v5M6 8h12v3a6 6 0 0 1-12 0Zm6 9v4"],
 layers:["m12 3 10 5-10 5L2 8Z","m3 12 9 5 9-5","m3 16 9 5 9-5"],
 panel:["M3 4h18v16H3Z","M15 4v16"],menu:["M4 6h16M4 12h16M4 18h16"],play:["m9 5 11 7-11 7Z"],
 pin:["M19 10c0 5-7 11-7 11S5 15 5 10a7 7 0 0 1 14 0Z","M14 10a2 2 0 1 1-4 0 2 2 0 0 1 4 0"],
 send:["m12 19 0-14","m6 11 6-6 6 6"],shield:["m12 3 9 4v5c0 5-9 9-9 9s-9-4-9-9V7Z","m8 12 3 3 5-6"],
 box:["m12 3 9 5v9l-9 5-9-5V8Z","m3 8 9 5 9-5","M12 13v9","m7 5 10 5"],
 check:["m5 12 4 4L19 6"],clock:["M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0","M12 7v5l3 2"],
 external:["M14 3h7v7","m21 3-10 10","M10 3H3v18h18v-7"],book:["M12 5v16","M3 4c5-2 9 1 9 1s4-3 9-1v15c-5-2-9 1-9 1s-4-3-9-1Z"],
 alert:["m12 3 10 18H2Z","M12 9v5m0 3h.01"]
};
function icon(name) { const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg"); svg.setAttribute("viewBox","0 0 24 24"); svg.setAttribute("fill","none"); svg.setAttribute("stroke","currentColor"); svg.setAttribute("stroke-width","1.6"); svg.setAttribute("stroke-linecap","round"); svg.setAttribute("stroke-linejoin","round"); svg.setAttribute("aria-hidden","true"); for(const d of iconPaths[name] || iconPaths.spark){const path=document.createElementNS(svg.namespaceURI,"path");path.setAttribute("d",d);svg.append(path);} return svg; }
function mountIcons(root=document){root.querySelectorAll("[data-icon]").forEach(node=>node.replaceChildren(icon(node.dataset.icon)));}
function inspect(tab="evidence"){state.tab=tab;document.body.classList.remove("inspector-hidden");document.body.classList.add("inspector-open");$("inspector-toggle").setAttribute("aria-expanded","true");renderDetail();}
function caseName(issue){return (issue.title||"Component review").split(":")[0];}
function renderOverview() {
 const overview=state.overview||{},issues=overview.issues||[],sync=overview.sync||{},connections=overview.integrations||{};
 const source=$("source-mode"); source.replaceChildren(element("span"),document.createTextNode(sync.error ? "Sync needs attention" : connections.portal_enabled ? "Portal connected" : "Local snapshot")); source.classList.toggle("offline",!!sync.error||!connections.portal_enabled);
 $("checked-at").textContent=`Last checked ${formatTime(sync.last_checked)}`;
 $("snapshot-at").textContent=`Source snapshot ${formatTime(overview.snapshot_at)}`;
 $("poll-note").textContent=`Portal checks every ${sync.poll_seconds||60}s. Original records may predate this check.`;
 const date=/^\d{4}-\d{2}-\d{2}$/.test(overview.launch_date||"")?new Date(overview.launch_date+"T12:00:00Z"):null;
 $("launch-date").textContent=date?new Intl.DateTimeFormat("en-GB",{day:"numeric",month:"short",timeZone:"Europe/Berlin"}).format(date):"Not available";
 $("risk-count").textContent=number(issues.filter(i=>i.severity!=="info"&&!['resolved','dismissed'].includes(i.status)).length);
 const products=overview.products||[],packed=products.reduce((v,p)=>v+(p.packed||0),0),target=products.reduce((v,p)=>v+(p.target||0),0),percent=target?Math.round(packed/target*100):0;
 $("packed-total").textContent=target?`${number(packed)} / ${number(target)}`:"Launch plan unavailable"; $("progress-percent").textContent=target?percent+"%":"—"; $("progress-ring").style.setProperty("--progress",percent+"%");
 $("issue-total").textContent=issues.length;$("connection-count").textContent=`${[connections.portal_enabled,connections.ai_enabled,connections.email_enabled].filter(Boolean).length}/3`;
 $("agent-mode").textContent=connections.ai_enabled?"Model available":"Evidence mode";
 $("composer-context").textContent=state.selected?caseName(issues.find(i=>i.id===state.selected)||{}):"Select a case";
 $("composer-note").textContent=connections.ai_enabled?"Responses use your configured model and linked customer evidence. You approve external actions.":"Answers use verified case records. Connect a model for open-ended investigation.";
 $("run-agent").disabled=!!overview.agent?.running||state.busy;
 $("sync-button").disabled=!connections.portal_enabled||state.refreshing;$("refresh-button").disabled=state.refreshing;
 const integrations=clear($("integrations")); for(const [label,connected] of [["Customer portal",connections.portal_enabled],["Model reasoning",connections.ai_enabled],["Supplier email",connections.email_enabled],["Supplier inbox",connections.inbox_enabled]]){const item=element("div",`integration-tag${connected?" connected":""}`);item.append(icon(connected?"check":"plug"),document.createTextNode(`${label}: ${connected?"connected":"not configured"}`));integrations.append(item);}
 const warnings=clear($("warnings"));if(sync.error)warnings.append(message(sync.error,"error"));for(const warning of overview.warnings||[])warnings.append(message(typeof warning==="string"?warning:warning.message));
 const filter=$("case-search").value.toLowerCase(),list=clear($("issue-list"));
 for(const issue of issues.filter(i=>`${i.title} ${i.material_id}`.toLowerCase().includes(filter))){const button=element("button",`issue-button ${issue.severity}${state.selected===issue.id?" selected":""}`);button.type="button";button.setAttribute("aria-pressed",String(state.selected===issue.id));const mark=element("span","case-icon");mark.append(icon(/book/i.test(issue.title)?"book":"box"));const copy=element("span","case-copy"),meta=element("small");meta.append(element("span","tiny-dot"),document.createTextNode(issue.shortage>0?`${number(issue.shortage)} units uncovered`:"Needs verification"));copy.append(element("strong","",caseName(issue)),meta);button.append(mark,copy);button.addEventListener("click",()=>selectIssue(issue.id));list.append(button);}
 if(!list.children.length)list.append(element("p","loading",issues.length?"No matching cases.":"No case data yet. Connect the portal or rescan files."));
 renderThread();
}
function renderThread(){
 const panel=clear($("agent-thread")),issue=state.detail?getIssue():(state.overview?.issues||[]).find(i=>i.id===state.selected),caseData=getCase(),agent=state.overview?.agent||{};
 if(!issue){panel.append(element("p","loading","Reading your launch data…"));return;}
 const kicker=element("div","response-kicker");kicker.append(icon("files"),document.createTextNode(`${issue.evidence?.length||0} linked sources · ${human(issue.confidence||"review needed")}`));
 const title=issue.shortage>0?`${number(issue.shortage)} ${/card/i.test(issue.title)?"game cards":/book/i.test(issue.title)?"art books":/statue/i.test(issue.title)?"statues":"components"} need a recovery plan.`:"This component needs a closer look.";
 panel.append(kicker,element("h2","response-title",title),element("p","response-text",issue.summary));
 const math=element("div","supply-equation");for(const [label,value,key] of [["Recorded stock",issue.usable_stock,""],["Expected inbound",issue.incoming,""],["Still required",issue.required,""],["Uncovered",issue.shortage,"gap"]]){const item=element("div",key);item.append(element("span","",label),element("strong","",number(value)));math.append(item);}panel.append(math);
 const stages=element("div","task-track"),planDone=!!caseData.draft||!!caseData.investigation;const phase=[['Read sources',true],['Reconcile',true],['Plan a fix',planDone],['Your review',!!caseData.approved_fingerprint]];
 phase.forEach(([label,done],i)=>{const part=element("div",`stage ${done?"done":(i===2&&!planDone||i===3&&planDone)?"current":""}`),node=element("span","stage-node");if(done)node.append(icon("check"));else node.textContent=String(i+1);part.append(node,document.createTextNode(label));stages.append(part);if(i<phase.length-1)stages.append(element("span","track-line"));});panel.append(stages);
 const chips=element("div","source-chips");for(const [i,e] of (issue.evidence||[]).slice(0,3).entries()){const chip=element("button","source-chip");chip.type="button";chip.append(icon("files"),document.createTextNode(e.label.length>26?e.label.slice(0,25)+"…":e.label));chip.title=e.label;chip.addEventListener("click",()=>inspect("evidence"));chips.append(chip);}panel.append(chips);
 const tools=element("details","task-details"),summary=element("summary");summary.append(icon(agent.running?"clock":"check"),document.createTextNode(agent.running?"Agent is investigating…":agent.steps?.length?`${agent.steps.length} recorded activity steps`:"Evidence read and reconciled"));tools.append(summary);const steps=element("ol");for(const step of agent.steps||[])steps.append(element("li","",`${formatTime(step.at)} — ${step.message}`));if(!steps.children.length)steps.append(element("li","","Stock and requirements were calculated from the current source snapshot. No model call is implied."));tools.append(steps);panel.append(tools);
 if(agent.error)panel.append(message(agent.error,"error"));
 const next=element("div","next-action"),text=element("p");text.append(element("strong","",caseData.draft?"Your next move: review the inquiry":"Your next move: verify supply"),document.createTextNode(caseData.draft?"Check the supplier request before approving it.":"Ask for actual availability and warehouse arrival."));const button=element("button","button button-primary",caseData.draft?"Review inquiry":"Prepare inquiry");button.disabled=state.busy||agent.running||!!caseData.sent_at;button.addEventListener("click",()=>caseData.draft?inspect("action"):perform("draft",{}));next.append(text,button);panel.append(next);
 const suggestions=element("div","suggestions");for(const [label,prompt] of [["Explain this risk","Why is this case at risk?"],["Recovery options","What are the recovery options?"],["Show evidence","Which sources support this finding?"]]){const chip=element("button","suggestion",label);chip.type="button";chip.addEventListener("click",()=>sendChat(prompt));suggestions.append(chip);}panel.append(suggestions);
 renderChat();
}
function renderChat(){const list=clear($("chat-messages"));for(const entry of state.detail?.chat||[]){const item=element("article",`chat-bubble ${entry.role}`);if(entry.role==="assistant"){const meta=element("div","chat-meta");meta.append(icon("spark"),document.createTextNode(entry.mode==="model"?"Model response":"From your case records"));if(entry.source_fingerprint&&entry.source_fingerprint!==getCase().source_fingerprint)meta.append(element("span","badge","Earlier snapshot"));item.append(meta);}item.append(element("p","chat-content",entry.text));list.append(item);}if(state.chatBusy){const wait=element("div","typing-indicator");wait.append(element("i"),element("i"),element("i"),document.createTextNode("Checking this case…"));list.append(wait);}}
async function sendChat(text){text=text.trim();if(!text||!state.selected||state.chatBusy)return;const selected=state.selected;state.chatBusy=true;$("chat-input").value="";$("send-message").disabled=true;$("global-error").hidden=true;renderChat();try{const result=await api(`/api/issues/${encodeURIComponent(selected)}/chat`,{text});if(state.selected===selected){state.detail=result;renderDetail();}}catch(error){showError(error);}finally{state.chatBusy=false;$("send-message").disabled=false;renderChat();}}
async function selectIssue(id) {
  state.selected = id;
  state.detail = null;
  state.tab = "evidence";
  document.body.classList.remove("nav-open");
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
  for (const [key, name] of [["evidence", "Evidence"], ["recovery", "Recovery"], ["action", "Review & activity"]]) { const button = element("button", `tab${state.tab === key ? " active" : ""}`, name); button.type = "button"; button.setAttribute("aria-pressed", String(state.tab === key)); button.addEventListener("click", () => { state.tab = key; renderDetail(); }); tabs.append(button); }
  container.append(tabs);
  const panel = element("div", "panel");
  if (state.tab === "evidence") renderEvidence(panel, issue);
  if (state.tab === "recovery") renderRecovery(panel, issue);
  if (state.tab === "action") renderAction(panel, issue);
  container.append(panel);
  renderThread();
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
  if (getCase().recovery_offer) {
    panel.append(element("h3", "", "Reviewed supplier offer scenario"));
    panel.append(element("pre", "draft-body", JSON.stringify(getCase().recovery_offer, null, 2)));
    panel.append(message("This scenario does not change recorded stock, place an order, or confirm receipt. Per-edition bounds compete for the same offered units."));
  }
  const button = element("button", "button button-dark", "Prepare supplier inquiry"); button.disabled = state.busy; button.style.marginTop = "20px"; button.addEventListener("click", () => perform("draft", {})); panel.append(button);
}
function renderAction(panel) {
  const caseData = getCase(), integrations = state.overview?.integrations || {}, draft = caseData.draft;
  const status = element("div", "workflow-status"); status.append(element("span", "badge", human(caseData.state || "not started")), element("span", "", caseData.sent_at ? `Sent ${formatTime(caseData.sent_at)}` : "No supplier commitment recorded")); panel.append(status);
  panel.append(message("Approval here authorizes the displayed inquiry only. It does not approve spending, release a purchase order, or replace Soony’s required business approver."));
  const draftButton = element("button", "button button-quiet", draft ? "Regenerate inquiry draft" : "Prepare supplier inquiry"); draftButton.disabled = state.busy || !!caseData.sent_at || ["sending", "delivery_unknown"].includes(caseData.state); draftButton.addEventListener("click", () => perform("draft", {})); panel.append(draftButton);
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
  renderReplies(panel);
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
    if (state.selected === selectedId) { state.detail = detail; state.tab = action === "investigate" ? "recovery" : "action"; document.body.classList.add("inspector-open"); document.body.classList.remove("inspector-hidden"); }
  } catch (error) { showError(error); }
  finally { state.busy = false; renderDetail(); }
}
async function loadOverview(initial = false) {
  try {
    const previousVersion = state.overview?.case_versions?.[state.selected];
    const previousIssue = state.overview?.issues?.find(issue => issue.id === state.selected);
    state.overview = await api("/api/overview"); renderOverview();
    const issues = state.overview.issues || [];
    if (initial || !state.selected || !issues.some(issue => issue.id === state.selected)) {
      const issue = issues.find(item => item.id === "game-card-shortage") || issues[0]; if (issue) await selectIssue(issue.id);
    } else if (JSON.stringify(previousIssue) !== JSON.stringify(issues.find(issue => issue.id === state.selected)) || previousVersion !== state.overview.case_versions?.[state.selected]) {
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
async function runAgent() {
  try { await api("/api/agent/run", {issue_id: state.selected || "game-card-shortage"}); await loadOverview(); }
  catch(error) { showError(error); }
}
$("run-agent").addEventListener("click", runAgent);
loadOverview(true);
setInterval(() => { if (!document.hidden && !state.busy && !state.refreshing && !["INPUT", "TEXTAREA"].includes(document.activeElement?.tagName)) loadOverview(); }, 3000);

function renderReplies(panel) {
  const section = element("section", "reply-section");
  section.append(element("h3", "", "Supplier replies"), element("p", "panel-intro", "Import a plain-text .eml export or check the configured inbox. Sender headers must match your configured supplier; that alone does not prove identity. Review claims before using an offer."));
  const check = element("button", "button button-quiet", "Check supplier inbox");
  check.disabled = state.busy || !state.overview?.integrations?.inbox_enabled;
  check.addEventListener("click", async () => {
    try { const result = await api("/api/inbox/check", {}); if (result.error) throw new Error(result.error); await selectIssue(state.selected); }
    catch(error) { showError(error); }
  });
  const upload = element("input"); upload.type = "file"; upload.accept = ".eml"; upload.setAttribute("aria-label", "Import supplier reply as EML");
  upload.addEventListener("change", async () => {
    const file = upload.files[0]; if (!file) return;
    if (file.size > 2097152) { showError(new Error("Email exceeds the 2 MB import limit.")); return; }
    try {
      const response = await fetch(`/api/issues/${encodeURIComponent(state.selected)}/replies/import`, {method: "POST", headers: {"Content-Type":"message/rfc822"}, body: file});
      const result = await response.json(); if (!response.ok) throw new Error(result.detail || "Import failed");
      state.detail = result; renderDetail();
    } catch(error) { showError(error); }
  });
  section.append(check, upload);
  for (const reply of state.detail?.replies || []) {
    const card = element("article", "evidence-card");
    card.append(element("h4", "", reply.subject), element("p", "data-note", `${reply.sender} · ${formatTime(reply.received_at)} · Header matched, identity requires verification`), element("pre", "draft-body", reply.body));
    const form = element("form", "approval-form"), values = {};
    for (const [key,label,type,value] of [["reviewer","Reviewer name","text",""],["quantity","Additional available units","number",reply.candidates?.quantity ?? ""],["arrival_at","Warehouse arrival (ISO timestamp with timezone)","text",reply.candidates?.arrival_at ?? ""],["cost_eur","Total offered cost EUR","number",reply.candidates?.cost_eur ?? ""],["note","How you verified the offer","text",""]]) {
      const wrapper = element("label", "", label), input = element("input"); input.type = type; input.required = true; input.value = value; if (type === "number") { input.min = "0"; input.step = key === "quantity" ? "1" : "0.01"; } wrapper.append(input); form.append(wrapper); values[key] = input;
    }
    const button = element("button", "button button-primary", "Review offer and calculate scenario"); button.type = "submit"; button.disabled = state.busy; form.append(button);
    form.addEventListener("submit", event => {
      event.preventDefault(); perform("replies/review", {message_id: reply.id, reviewer: values.reviewer.value, quantity: Number(values.quantity.value), arrival_at: values.arrival_at.value, cost_eur: Number(values.cost_eur.value), note: values.note.value});
    });
    card.append(form); section.append(card);
  }
  panel.append(section);
}

mountIcons();
$("case-search").addEventListener("input",renderOverview);
$("menu-button").addEventListener("click",()=>document.body.classList.toggle("nav-open"));
$("inspector-toggle").addEventListener("click",()=>{const small=window.innerWidth<=1050;if(small){const open=document.body.classList.toggle("inspector-open");$("inspector-toggle").setAttribute("aria-expanded",String(open));}else{const hidden=document.body.classList.toggle("inspector-hidden");$("inspector-toggle").setAttribute("aria-expanded",String(!hidden));}});
$("connections-button").addEventListener("click",()=>$("connections-dialog").showModal());
$("workspace-button").addEventListener("click",()=>$("connections-dialog").showModal());
$("nav-evidence").addEventListener("click",()=>inspect("evidence"));
$("nav-activity").addEventListener("click",()=>inspect("action"));
$("nav-agent").addEventListener("click",()=>{$("chat-input").focus();document.body.classList.remove("nav-open");});
$("composer").addEventListener("submit",event=>{event.preventDefault();sendChat($("chat-input").value);});
$("chat-input").addEventListener("keydown",event=>{if(event.key==="Enter"&&!event.shiftKey&&!event.isComposing){event.preventDefault();sendChat(event.target.value);}});
function commands(){const query=$("command-search").value.toLowerCase(),list=clear($("command-results"));for(const item of [{title:"Run agent on selected case",icon:"play",action:runAgent},{title:"Open connections",icon:"plug",action:()=>$("connections-dialog").showModal()},...(state.overview?.issues||[]).map(issue=>({title:issue.title,icon:"box",action:()=>selectIssue(issue.id)}))].filter(item=>item.title.toLowerCase().includes(query))){const button=element("button","command-result");button.append(icon(item.icon),document.createTextNode(item.title));button.addEventListener("click",()=>{$("command-dialog").close();item.action();});list.append(button);}if(!list.children.length)list.append(element("p","loading","No matching cases or actions."));}
function openCommands(){$("command-dialog").showModal();$("command-search").value="";commands();$("command-search").focus();}
$("search-trigger").addEventListener("click",openCommands);$("command-search").addEventListener("input",commands);$("close-command").addEventListener("click",()=>$("command-dialog").close());
document.addEventListener("keydown",event=>{if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==="k"){event.preventDefault();if(!$("command-dialog").open)openCommands();}if(event.key==="Escape"){document.body.classList.remove("nav-open","inspector-open");}});
