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
