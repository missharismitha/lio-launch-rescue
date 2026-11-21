# Continuation status

Updated 21 November 2026, Europe/Berlin. Claude and other agents: start here.

## User decisions
Build from actual data, centered on GH6 game-card shortage. User and Manuel build independently; Manuel is a fallback collaborator. User explicitly requested skills, agents and progress tracking. No supplier outreach authorized for development; keep application approval gates.

## Repository and inputs
- Private remote: https://github.com/missharismitha/lio-launch-rescue
- Branch: codex/launch-rescue-mvp
- Snapshot: data/soony-data, 308 files; raw data and .analysis extracts ignored.
- Ignored .env has portal token from signed-in API docs. Never print it. No model or SMTP configured.
- Ignored .local/cases.sqlite3 stores cases/events; portal-manifest.json stores sync metadata.

## Code map
- app/engine.py: CSV/XLSX/PDF reconciliation. No OCR claim or copied outcome constants.
- app/main.py: FastAPI API/UI, polling, draft/approval/send/investigate, origin boundary, evidence SHA256 fingerprints.
- app/sync.py: authenticated checksum downloads; cached data, failed-batch retention, removed files quarantined outside active dataset.
- app/store.py: durable SQLite cases/events and approval invalidation.
- app/investigator.py: optional bounded Responses API tool loop (get_current_issue, search_documents, read_document). No write/send/spending tools.
- app/static/: vanilla responsive interface, no build step/external assets.
- tests/: synthetic engine, workflow and sync checks; network/email mocked.

## Real-data results
- Cards: required153200, stock118400, incoming28000, gap6800. Notice reduces48000 to28000; balance reaches Hamburg after launch. Rescue unconfirmed.
- Books: recorded91300, provisional19300, gap5900. Estimate uses PO/receipt discrepancy, not OCR. Original correction scan linked. Offer8000, historical-PO-price estimate EUR16800, loading4h driving9h. Quote, availability and packing feasibility unverified.
- Statues: exclude5600 pending authorized quality concession; gap3400.
- Magnets: supplier-fitted assembly, informational BOM review.
- Gaps overlap: do not sum into lost copies.

## Verification
- Final suite: 45 passed, 1 skipped in 10.69 seconds. The skipped search-symlink regression requires Windows symlink permission; traversal and safe-path regressions passed. All model/network/email calls in tests were mocked.
- node --check app/static/app.js passed.
- Actual /api/health and /api/overview HTTP200.
- Live /api/sync HTTP200, last_success populated, error null, zero changed files against308-file snapshot.
- Chrome checked overview, evidence, recovery and inquiry draft. Correct6800 gap; portal connected, AI/email unconfigured. Draft created locally, NO email sent; Send disabled.

## Run
python -m uvicorn app.main:app --host 127.0.0.1 --port 8000
Open http://127.0.0.1:8000. Ctrl+C stops service. Port8000 may already have the retained dev service; reuse it or stop that specific process before restarting. Fresh clone setup in README.

## API
GET /api/overview => engine output + sync + integrations.
POST /api/refresh => local rescan; POST /api/sync => portal check + rescan.
GET /api/issues/{id} => flat issue + case + events + integrations.
POST .../draft => local inquiry, no send.
POST .../approve {approver,note} => displayed inquiry approval only.
POST .../send => approved, configured SMTP transport.
POST .../investigate => optional model tool investigation saved to case.investigation.
GET /api/evidence?path=... => confined source. /api/health readiness, /docs OpenAPI.

States: detected, drafted, approved, sending, sent, delivery_unknown, review_required. Never auto-retry delivery_unknown. Changed evidence clears draft, approval and model result. SMTP acceptance is not shipment confirmation.

## Next concrete tasks
1. Configure OPENAI_API_KEY and LIO_AI_MODEL locally; verify a real investigation before claiming live model support.
2. Verify hackathon supplier inboxes/sender and connect email only on user instruction.
3. Inbox ingestion and reviewed reply-to-scenario recalculation are implemented. Configure live IMAP/SMTP and verify them on user-authorized correspondence.
4. Interview customer about allocation priorities, actual inventory and remaining shifts; calculate packing feasibility.
5. Add authentication before hosting; current app is loopback only. Deployment not done.

Follow docs/PLAN.md. Keep docs and commits current. Never upload data/secrets.

## Delivery checkpoint
Implementation complete for Milestone 1. All source is on codex/launch-rescue-mvp; commit history is the authoritative checkpoint. App runs at localhost:8000 and portal polling succeeds. Further live verification needs model credentials, verified sender setup and deployment authentication.

## Second implementation checkpoint
- Run agent orchestrator: portal sync, evidence reconciliation, optional model investigation, inquiry preparation, then human review. No automatic send.
- app/mailbox.py: read-only IMAP (last50 messages, size limit), plain-text .eml import, exact sender/case tag checks, Message-ID/content deduplication, raw emails stored only in ignored .local/inbox. Sender headers are NOT authenticated identity.
- app/recovery.py: review supplier offers with explicit timezone, per-edition packing bounds excluding night shifts and elapsed time, PP-07 value threshold guidance. Source inventory remains unchanged; scenario options are not additive.
- UI: agent execution timeline, reply import, inbox check, named review and recovery scenario.
- New API: POST /api/agent/run {issue_id}; POST /api/inbox/check; POST /api/issues/{id}/replies/import (message/rfc822 bytes); POST /api/issues/{id}/replies/review {message_id (digest),reviewer,quantity,arrival_at,cost_eur,note}.
- Real local agent cycle successfully ran against portal: reconciliation and inquiry draft completed, no model invocation (unconfigured), no outbound email.
- User asked to locate separate model credentials in Discord/email. Checked complete Lio channel (no pins), challenge Notion page, portal settings; only data token found. Server-wide key search identified 5U challenge mailbox/LLM gateway and AMD Token Factory, not a Lio model key. Email had personal OpenAI credit redemption, not API key. No account keys were created or vouchers redeemed. Do not claim model is connected.

## Latest validation
59 tests passed, 1 Windows symlink-permission test skipped. JavaScript syntax check passed. Real portal-connected Run agent completed to awaiting_human_review without error and drafted an inquiry; no email sent. Synthetic reply import -> named review -> recovery scenario verified without altering source stock. Repeated cycles and replies cannot bypass duplicate-delivery guards. Live model and SMTP/IMAP remain unconfigured, so do not describe them as verified live integrations.

## Third checkpoint: agent workspace UI and case chat (uncommitted at time of writing)
- UI redesigned as 3-column agent workspace (see docs/UI_DESIGN.md). app/chat.py gives evidence-mode answers; with a configured model, POST /api/issues/{id}/chat calls investigator.run(question=...). Turns persist in the SQLite `conversation` table and are rejected (409) if sources change mid-answer; model errors return a generic 502 and store nothing.
- Added tests/test_chat.py (8 tests: evidence mode, no send, validation, 404, model mode, 502, stale-source 409).
- Found the retained dev server on :8000 was stale (chat route 405); restarted it. Restart after pulling code changes.
- Verified: pytest all passing, live POST /api/issues/game-card-shortage/chat 200 with real-data answer, UI renders at desktop width with Portal connected / Evidence mode labels.
- Not verified: 375px mobile layout visually, live model chat (no key).

## Fourth checkpoint: latest pack-out, CPO priority, agent-first UI
- Engine now prefers soony/context/launch_status.xlsx (Saturday 13:00) over the plan workbook: Standard 554,000 and Collector's 53,100 packed. German number format (554.000) handled by _de_number. Remaining shift hours computed from the plan's Shifts sheet (23 h at Saturday 13:00). Stock is ERP snapshot minus parts used by copies packed since the plan (estimate; no physical count).
- CPO memo (memo_launch_priorities.docx) parsed: Collector's first. Issue.allocation: Collector's 18,900 fully covered, Standard 79,200 of 86,000, 6,800 copies cannot be packed. Collector's needs 21 h of 23 h left: little slack.
- Agent: OpenAI Responses tool loop (gpt-5.5 via .env) with get_current_issue / read_document / search_documents over pdf, md, txt, csv, docx, xlsx; Claude CLI fallback (app/claude_agent.py) when no OpenAI key.
- UI: main view is verdict, allocation, per-edition hours, live work log of real tool calls, collapsible agent analysis, one decision button. Raw file paths and extracts are hidden by default.
- Known gaps: the agent's supplier contact name is unverified; approval limits (PP-07: Category Lead <500k, air freight CPO above 200k/month) are not yet checked against a priced option; no supplier email sent; not deployed.

## Fifth checkpoint: UI rebuilt as "Launch Control"; supplier draft no longer leaks internal data
- UI rewritten from scratch (app/static/index.html, styles.css, app.js; no external assets). One story per page: outcome headline, one decision card, per-edition packing lanes with hours, stock equation, the agent's work log and conclusion, Plan B option cards, supplier message with named approval, other risks, ask box, sources (file names only). Dispatch-board look: near-black band, signal amber, system DIN-style font. Verified at 1280 px and 390 px, no horizontal scroll.
- SECURITY FIX: the supplier inquiry draft previously pasted raw excerpts of internal files (CPO memo, stock snapshot) into the email body. It now contains only the supplier's own advice facts (PO, AWB, ordered/shipped/remaining) plus the ask, addressed to the supplier contact from the profile. Test: tests/test_draft_privacy.py.
- Chat answers made against older source fingerprints are hidden.
- Still open: priced Plan B vs PP-07 approval limits, supplier sender/inbox verification, deployment (app is loopback-only), pitch deck, 3-minute video, README refresh. Hand-in due Sunday 12:00.

## Sixth checkpoint: privacy boundary and optional access code (backend, uncommitted)
- New app/public.py is the only shaping layer for browser output (allowlists: public_overview, public_detail, public_investigation, public_events, scrub). Evidence, excerpts, sha256, tool traces, model text, warnings, inbox status, reply bodies, supplier recipient address, approval notes and recovery offers no longer leave the server. case.approved (bool) is derived from approved_fingerprint == source_fingerprint; draft carries subject, body and has_recipient only.
- New app/labels.py: tool steps are generic labels (e.g. "Read a supplier notice"); arguments never leave the server. investigator.py and claude_agent.py use it; prompts now ask for Verdict, Recommended action, Plan B options first and forbid file names/quotes there.
- New app/access.py + main.py boundary middleware: optional LIO_ACCESS_CODE gate (signed HttpOnly SameSite=Strict 12 h cookie, per-IP and global rate limit, /login, /api/login, /api/logout), security headers on every response (nosniff, DENY, no-referrer, CSP, no-store), LIO_ALLOWED_HOSTS, LIO_COOKIE_SECURE.
- /api/evidence returns 404 unless LIO_EXPOSE_SOURCES=true (local debugging only). Chat answers are scrubbed; the sources question now says documents stay on the server.
- Tests: new tests/test_privacy_api.py and tests/test_access_gate.py; existing tests adapted only where the projection removed a field (draft recipient, detected event, reply candidates, recovery offer read from store). Approval-gate assertions unchanged.
- Command: python -m pytest -q -> 109 passed, 1 skipped. Real data dumped via main.overview()/issue_detail() with a temp store: no file names, paths or excerpts in any case's public projection.
- Known gaps: front end (app/static) is owned by the UI agent; limiter state is in memory (single worker); deployment still needs an HTTPS proxy and LIO_ACCESS_CODE.
- Next: verify rendered DOM at 390 px, set LIO_ACCESS_CODE and host behind HTTPS.


## Review fixes (privacy/hardening, uncommitted)
- Removed the case chat entirely: POST /api/issues/{id}/chat, app/chat.py, tests/test_chat.py and the `chat` key in public detail (scrubbing cannot sanitise free text). The `conversation` DB table and store.chat helpers remain but are unused. Earlier notes above about case chat are superseded.
- scrub() now NFKC-normalises, drops sentences with emails, URLs and markdown links, covers many more file extensions, and treats single-quoted and backtick spans of 4+ words like double quotes (apostrophes in contractions survive). Plan B options and agent steps pass through scrub.
- public_case.approved requires state == 'approved' plus matching fingerprint; UI shows "Delivery not confirmed. Check sent mail." with no send button for sending/delivery_unknown.
- Agent cycle writes only plain fixed phrases (Checking for new data, Reading the records, Weighing the options, Drafting the request, Ready for your review).
- Access: valid_cookie never raises (ASCII-only, bytes compare); logout revokes via a bounded in-memory sha256 set; a per-process random salt is mixed into the signing key (cookies die on restart); limiter dict capped at 1000 IPs.
- /docs, /redoc, /openapi.json disabled; /api/agent/run and /api/inbox/check return only the public agent projection.
- Hosted mode (LIO_ALLOWED_HOSTS set) with no LIO_ACCESS_CODE now raises RuntimeError at startup.
- Tests: tests/test_hardening.py added; chat tests removed. Command: python -m pytest -q -> 148 passed, 1 skipped; node --check app/static/app.js passes.

## Agent crew, number self-check, drafts (C1, uncommitted)
- New app/crew.py: blackboard plus role functions (Reconciler, Investigator, Allocation Planner, Pricer, Policy Officer, Approver-Router, Checker, Drafter, Checker). Each appends a trace entry from the fixed vocabulary in app/labels.py (agent, action, outcome, autonomy). A failing role is traced `fell back` and later roles still run. Works with no model: rule-based options (air freight of the short shipment balance, another supplier's inbound stock if the tracker lists one, else "Allocate by priority and escalate") and says so in the trace. Autonomy ladder constant AUTONOMY_LADDER (read/compute auto, draft draft, send/spend approval, book/pay never). Result is stored as case['crew'] and cleared with the investigation when evidence changes (store.get).
- New app/verify.py: extract_numbers, check, compose, vet_text. Model-written option titles and details are kept only if every number matches the blackboard; otherwise a code-composed sentence replaces them and numbers_verified is False. The brief, supplier draft and escalation draft are checked the same way.
- New app/actions.py: supplier_draft (moved from main.draft, supplier-facing facts only), escalation_draft (INTERNAL, addressed to the approver from the policy, never sent), flag_unknown, pick_approver.
- investigator.py and claude_agent.py now also ask for a fenced json block of up to 3 options; investigator.parse_options reads it defensively; invalid options are dropped and rules take over.
- main.py: agent_cycle runs crew.run (refresh_crew), POST /investigate refreshes the crew after saving the investigation, POST /api/issues/{id}/escalation/approve {approver, note} (named approval, tied to the source fingerprint and the escalation text hash, never sends), POST /api/issues/{id}/whatif {arrive_in_hours 0..72} -> {copies_ship, copies_short, hours_left, label}. recovery.scenario takes the approver from policy.required_approver (no hardcoded tiers).
- public.py: public_detail gains options, brief, value, trace, escalation, numbers_verified, conflicts (all through safe_text, fixed vocabularies, no files, paths or addresses); public_whatif.
- C2 modules brief.py, whatif.py, conflicts.py are wired (guarded imports with fallbacks).
- Command: python -m pytest -q -> 268 passed, 1 skipped (new: tests/test_crew.py, test_verify.py, test_actions.py).
- Known gaps: with real data nothing is priced yet because no freight rate or exchange rate is set in .local/assumptions.json; air-option arrival is unknown until a supplier replies, so the crew recommends allocate and escalate. Hours left are counted from the status time, not the wall clock. UI for the new fields is for the next agent.

## Crew fix wave (21 Nov 2026, evening): option kinds, honest copies gained, supplier holds
- New app/holds.py (pure, pattern table en/de/pl, composed wording, needs_review for scans/mismatches). Crew: holds_role, classify_option (recovery/release/allocation/verify, always set by code), release options first, allocation always last and never feasible, copies_gained only from whatif with a known ETA (else null), stock counts only with snapshot evidence. Pricing: freight commitment (goods already ordered, approver by freight, provisional when cost unknown), stock free only when established. Brief: honest "First action ..." text, low confidence when arrivals unknown. verify.check_claims rejects unrecorded gain/arrival/certainty claims. actions.hold_supplier_draft never confirms a term. public: kind, arrival_known, copies_gained_source, potential_units, feasible 'na', holds[], supplier_drafts[].
- Tests: `python -m pytest -q` = 299 passed, 1 skipped (new: tests/test_holds.py 9, tests/test_crew_fix.py 13).
- Known gaps: PO price vs Annex A conflict not added; the UI does not yet render 'na', holds or supplier_drafts; stock-basis-estimate confidence cap not wired (no flag in the issue record).

## Tool-calling agent (21 Nov 2026, night, uncommitted)
- New app/tools.py: 14-tool registry (get_case, search_documents, read_document, list_supplier_holds, find_conflicts, check_policy, price_option, whatif = auto; propose_option, draft_supplier_message, draft_escalation, set_recommendation, flag_unknown = draft; request_approval = approval). tools.NEVER = send_email, place_order, book_freight, pay, approve, update_stock: never registered, dispatch rejects and traces them. Strict schemas, per-tool validators; the model supplies no free text, recipients or amounts. Escalation below the policy tier is rejected; the stored draft always uses the policy role.
- New app/agent_loop.py: Responses-API loop with one `_post` seam. Budgets (env-overridable): 8 turns, 20 calls, 45 s, 25 s per request, per-tool caps, 3 consecutive rejections stop the loop, older tool results folded. Model: LIO_AGENT_MODEL, else LIO_AI_MODEL. Drafting intents are replayed on the final options at the commit stage; rule steps fill gaps and are traced by:'rule'.
- crew.run(..., operator=None): Reconciler stays code; with an operator the loop runs then agent_commit (rules fill gaps, unchanged Checker, brief). No key, model error, or no valid action call: the unchanged rule order runs, run_mode 'rule_based'. run_mode is agent | agent_partial | rule_based.
- public.py: trace rows {step, tool, outcome, autonomy, summary, by, turn} (old rows still pass), agent {mode, tool_calls, rejected, seconds}, approvals [{what, to_role, status}], run_mode, last_good_at. main.refresh_crew(agent=True) from agent_cycle only; rule refreshes never overwrite an agent result for the same evidence; case['crew_last_good'] kept when the model fails.
- tests/conftest.py blocks the real model in every test. tests/test_tool_agent.py: 31 new tests. tests/test_privacy_api.py: 'tool_calls' and 'summary' removed from FORBIDDEN_KEYS (public contract now), values still scanned.
- Command: python -m pytest -q -> 344 passed, 1 skipped. node --check app/static/app.js passes (UI untouched: being rebuilt).
- Unverified: a live model run (token cost and the 45 s ceiling are estimates); reasoning-item replay with store:false mirrors investigator.py. Not done: analyze_reply/recompute_scenario, UI chips/legend (front end rebuild), 2-minute debounce (agent only runs on the Run button).

## React UI rebuild (21 Nov 2026, night, uncommitted)
- New `frontend/` (Vite 8 + React 19 + Tailwind v4 + hand-written shadcn-style components + Radix Dialog/Tabs/Slider + motion, lucide icons). `cd frontend && npm ci --ignore-scripts && npm run build` writes `app/static/index.html` and `app/static/assets/index-<hash>.{js,css}` (prebuild runs `scripts/clean-assets.mjs`, which deletes only `app/static/assets/`). Stable pre-auth files `login.css`, `login.js`, `icon.svg` come from `frontend/public/`. `app/static/vendor/LICENSE-lucide.txt` kept. No change to `main.py`.
- Rollback: the old vanilla UI is copied to `app/static_legacy/` (not mounted). To roll back: copy `app/static_legacy/{index.html,app.js,styles.css,print.css,login.js}` to `app/static/`, delete `app/static/assets/`, and restore the two edits in `app/access.py` (PUBLIC `'/static/styles.css'` instead of `login.css`, LOGIN_HTML `href="/static/styles.css"`) and the static-path assertions in `tests/test_access_gate.py`, the test in `tests/test_hardening.py` (scan `static/app.js`) and `tests/test_privacy_api.py` (scan static `.js/.html/.css`).
- access.py: PUBLIC is now `/login, /api/login, /api/health, /static/login.css, /static/login.js`; the login page links `/static/login.css`. Built assets are behind the gate (401/303 when locked).
- Honesty rules live in `frontend/src/lib/derive.ts` (gainsKnown, recOption, approvalsNeeded, cardState), ported from the legacy `app.js`. Approval is a two-step panel (read, then type your name 2+ chars, Approve); the escalation is a separate second approval. No optimistic UI. Print: `print:` utilities + hidden `PrintBrief`.
- Deviations from the plan: ok green deepened to #177050 and input border to #8a8f9e so contrast passes AA (ok on its wash was 4.36 with #1b7f5c); chunk warning limit 500 kB (bundle is 455 kB raw, 147 kB gzip); what-if slider only shown when an edition is actually short (the server refuses otherwise); PageUp/PageDown move 6 h; no @types/node, so vite.config.ts is excluded from `tsc` (src only); jsdom pulls w3c-xmlserializer wanting node >= 24.15 (engine warning only, tests pass on 24.14.1).
- Tests: vitest 29 (derive, DecisionCard, OfferCard, states) via `cd frontend && npx vitest run`; `npx tsc --noEmit` clean; `python -m pytest -q` -> 349 passed, 1 skipped (new tests/test_static_build.py 5; edited test_access_gate, test_hardening, test_privacy_api).
- `npm audit` (run once, after install): found 0 vulnerabilities.
- Browser audit (Browser pane, live :8000, real case data; Run agent, Sync, approve and send POSTs were intercepted so nothing real was changed or spent): see the build report. Not verified: login.css visually (gate off on this server), reduced-motion emulation (code only: MotionConfig reducedMotion=user plus a CSS media query), real print preview.

## UI restyle: quiet editorial (21 Nov 2026, night)
- Purple and black band removed. New tokens in frontend/src/index.css: white page, ink #0F1115 (solid ink primary button), ink-2 #565B69, ink-3 #6B7080 (AA on white), hairline #E6E7EB, risk #B42318 and ok #17694A only as small text/markers/the short strip. No cards, no gradients, one soft shadow (Details sheet). Hero numeral 72/52, thin hours track, packing tracks 6 px, agent section "What the agent did" is a vertical timeline with grouped repeated rows and the autonomy legend in Details > Agent. login.css and icon.svg restyled; privacy test now forbids violet/purple/periwinkle and #8B8DFF/#4A4DD1.
- Build fix: `.npmrc` ignore-scripts disabled the npm `prebuild` hook, so `build` is now `node ../scripts/clean-assets.mjs && vite build` (app/static/assets holds only the referenced files).
- pytest 349 passed, 1 skipped; vitest 29; JS 453 kB raw / 146.6 kB gzip, CSS 6.1 kB gzip.
