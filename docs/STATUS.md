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
3. Build inbox ingestion; close inquiry-response-recalculation loop.
4. Interview customer about allocation priorities, actual inventory and remaining shifts; calculate packing feasibility.
5. Add authentication before hosting; current app is loopback only. Deployment not done.

Follow docs/PLAN.md. Keep docs and commits current. Never upload data/secrets.

## Delivery checkpoint
Implementation complete for Milestone 1. All source is on codex/launch-rescue-mvp; commit history is the authoritative checkpoint. App runs at localhost:8000 and portal polling succeeds. Further milestones need model credentials, verified sender setup, reply ingestion and deployment authentication.
