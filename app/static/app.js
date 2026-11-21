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
function icon(name) { const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg"); svg.setAttribute("viewBox","0 0 24 24"); svg.setAttribute("width","18"); svg.setAttribute("height","18"); svg.setAttribute("fill","none"); svg.setAttribute("stroke","currentColor"); svg.setAttribute("stroke-width","1.6"); svg.setAttribute("stroke-linecap","round"); svg.setAttribute("stroke-linejoin","round"); svg.setAttribute("aria-hidden","true"); for(const d of iconPaths[name] || iconPaths.spark){const path=document.createElementNS(svg.namespaceURI,"path");path.setAttribute("d",d);svg.append(path);} return svg; }
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
const timeOnly = (v) => { const d = new Date(v); return Number.isNaN(d.getTime()) ? "" : new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit", timeZone: "Europe/Berlin" }).format(d); };
function mdSections(text) {
  const sections = []; let current = { title: "", lines: [] };
  for (const raw of String(text || "").split("\n")) {
    const heading = raw.match(/^#{1,3}\s+(.*)$/);
    if (heading) { if (current.title || current.lines.length) sections.push(current); current = { title: heading[1].replace(/\s*\(.*$/, "").trim(), lines: [] }; }
    else current.lines.push(raw);
  }
  sections.push(current);
  return sections.filter(s => s.title || s.lines.join("").trim());
}
function mdBlock(lines) {
  const box = element("div", "md");
  let list = null;
  for (const raw of lines) {
    const line = raw.trim(); if (!line) { list = null; continue; }
    const bullet = line.match(/^(?:[-*•]|\d+\.)\s+(.*)$/);
    const target = bullet ? (list || (list = box.appendChild(element("ul")))) : box;
    if (!bullet) list = null;
    const node = bullet ? element("li") : element("p");
    for (const [i, part] of (bullet ? bullet[1] : line).split("**").entries()) { if (!part) continue; node.append(i % 2 ? element("strong", "", part) : document.createTextNode(part.replace(/`/g, ""))); }
    target.append(node);
  }
  return box;
}
function editionRows(products, allocation) {
  const wrap = element("div", "editions");
  for (const p of products) {
    const row = element("div", "edition"), pct = p.target ? Math.round(p.packed / p.target * 100) : 0;
    const line = (allocation?.lines || []).find(l => l.product_id === p.id);
    const tight = p.hours_needed && p.hours_available && p.hours_needed / p.hours_available > 0.85;
    const head = element("div", "edition-head");
    head.append(element("strong", "", p.name), element("span", "", `${number(p.packed)} of ${number(p.target)} packed`));
    const bar = element("div", "bar"); const fill = element("span", "fill"); fill.style.width = pct + "%"; bar.append(fill);
    const facts = element("div", "edition-facts");
    facts.append(element("span", tight ? "warn" : "", `${p.hours_needed ?? "—"} h of packing left to do · ${p.hours_available ?? "—"} h of shifts remain`));
    if (line) facts.append(element("span", line.short ? "bad" : "good", line.short ? `${number(line.short)} short on this component` : "component fully covered"));
    row.append(head, bar, facts); wrap.append(row);
  }
  return wrap;
}
function agentLog(detail, agent) {
  const log = element("ol", "worklog");
  const live = agent.running ? (agent.steps || []) : [];
  const events = (detail?.events || []).filter(e => ["agent_tool", "investigated", "drafted", "approved", "sent", "question_answered"].includes(e.kind)).slice(0, 14).reverse();
  const rows = agent.running ? live.map(s => ({ at: s.at, message: s.message, kind: "live" })) : events;
  for (const row of rows) { const li = element("li", row.kind === "agent_tool" || row.kind === "live" ? "tool" : "done"); li.append(element("time", "", timeOnly(row.at)), element("span", "", String(row.message).replace(/^Agent: /, ""))); log.append(li); }
  if (!rows.length) log.append(element("li", "idle", "The agent has not run yet. Press Run agent."));
  return log;
}
function renderThread(){
  const panel=clear($("agent-thread")),issue=state.detail?getIssue():(state.overview?.issues||[]).find(i=>i.id===state.selected),caseData=getCase(),agent=state.overview?.agent||{},products=state.overview?.products||[];
  if(!issue){panel.append(element("p","loading","Reading your launch data…"));return;}
  const inv=caseData.investigation, sections=inv?mdSections(inv.text):[];
  const verdict=sections.find(s=>/verdict/i.test(s.title));
  const noun=/card/i.test(issue.title)?"game cards":/book/i.test(issue.title)?"art books":/statue/i.test(issue.title)?"statues":"components";
  // 1. Verdict
  const kicker=element("div","response-kicker");kicker.append(icon("files"),document.createTextNode(inv?`Agent verdict · ${inv.model}`:`Reconciled from ${issue.evidence?.length||0} sources`));
  panel.append(kicker,element("h2","response-title",issue.shortage>0?`${number(issue.shortage)} ${noun} short before Sunday 20:00.`:"Needs verification before launch."));
  panel.append(verdict?mdBlock(verdict.lines):element("p","response-text",issue.summary));
  // 2. Who gets what
  if(issue.allocation){const a=issue.allocation;const box=element("div","allocation");box.append(element("h3","","Allocation under the CPO rule"),element("p","muted",a.rule));
    for(const l of a.lines){const r=element("div",`alloc-row${l.short?" short":""}`);r.append(element("strong","",l.name),element("span","",`${number(l.covered)} of ${number(l.needed)} covered`),element("em","",l.short?`${number(l.short)} copies cannot be packed`:"fully covered"));box.append(r);}
    box.append(element("p","muted",a.caveat));panel.append(box);}
  panel.append(editionRows(products,issue.allocation));
  const math=element("div","supply-equation");for(const [label,value,key] of [["Stock now (est.)",issue.usable_stock,""],["Inbound by launch",issue.incoming,""],["Still required",issue.required,""],["Uncovered",issue.shortage,"gap"]]){const item=element("div",key);item.append(element("span","",label),element("strong","",number(value)));math.append(item);}panel.append(math);
  // 3. What the agent did
  const work=element("section","worklog-card");const wh=element("div","worklog-head");wh.append(element("h3","",agent.running?"Agent is working…":"What the agent did"),element("span","muted",agent.running?"live":inv?`${inv.tool_calls?.length||0} tool calls`:""));work.append(wh,agentLog(state.detail,agent));
  if(inv?.tool_calls?.length&&!agent.running){const d=element("details","task-details");d.append(element("summary","","Every document it opened or searched"));const ul=element("ul");for(const t of inv.tool_calls)ul.append(element("li","",`${t.name}: ${t.arguments?.path||t.arguments?.query||t.arguments?.file_path||t.arguments?.pattern||""}`.slice(0,150)));d.append(ul);work.append(d);}
  panel.append(work);
  if(agent.error)panel.append(message(agent.error,"error"));
  // 4. Agent analysis sections
  for(const s of sections){if(/verdict/i.test(s.title)||!s.title)continue;const d=element("details","analysis");if(/plan b|supplier/i.test(s.title))d.open=true;d.append(element("summary","",s.title),mdBlock(s.lines));panel.append(d);}
  // 5. The decision
  const next=element("div","next-action"),text=element("p");
  const label=caseData.sent_at?"Inquiry sent":caseData.draft?"Review the supplier inquiry":inv?"Prepare the supplier inquiry":"Run the agent first";
  text.append(element("strong","",label),document.createTextNode(caseData.draft?"It is drafted from the evidence. Nothing is sent until you approve it.":inv?"The agent recommends asking the supplier before anyone spends money.":"It will read the supplier documents, contracts and policies, then recommend a plan."));
  const button=element("button","button button-primary",caseData.draft?"Review & approve":inv?"Draft inquiry":"Run agent");button.disabled=state.busy||agent.running||!!caseData.sent_at;
  button.addEventListener("click",()=>caseData.draft?inspect("action"):inv?perform("draft",{}):runAgent());next.append(text,button);panel.append(next);
  const suggestions=element("div","suggestions");for(const [lab,prompt] of [["Why is this at risk?","Why is this case at risk?"],["Recovery options","What are the recovery options?"],["Which sources?","Which sources support this finding?"]]){const chip=element("button","suggestion",lab);chip.type="button";chip.addEventListener("click",()=>sendChat(prompt));suggestions.append(chip);}panel.append(suggestions);
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
    label.append(element("h4", "", evidence.label || evidence.path || "Source document"), element("p", "source-path", (evidence.path || "").split("/").pop().replace(/.[a-z0-9]+$/i, "").replace(/_/g, " ")));
    top.append(label);
    if (evidence.path) { const link = element("a", "", "Open source"); link.href = `/api/evidence?path=${encodeURIComponent(evidence.path)}`; link.target = "_blank"; link.rel = "noopener noreferrer"; top.append(link); }
    card.append(top);
    if (evidence.excerpt) { const d = element("details", "extract"); d.append(element("summary", "", "Show extracted text"), element("blockquote", "", evidence.excerpt)); card.append(d); }
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
  aiSection.append(element("h3", "", "AI investigation"), element("p", "panel-intro", aiEnabled ? "Running this investigation lets Claude read the supplier documents with read-only tools. It can inspect evidence and recommend next steps; it cannot send supplier email or commit spending." : "AI investigation is not configured. Configure an OpenAI API key and model to enable it. The reconciliation above does not claim an AI model ran."));
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
