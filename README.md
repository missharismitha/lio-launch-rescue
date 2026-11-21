# Lio Launch Rescue

Local working prototype for START Hack Munich 2026. Reconcile Soony's actual source files, investigate the GH6 game-card short shipment, and prepare a supplier inquiry with evidence, approval and persistent history.

## Run

Python 3.11+ required. In PowerShell from this repository:

```powershell
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
Copy-Item .env.example .env
.\.venv\Scripts\python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 8000
```

Preserve an existing .env instead of copying over it. Open http://127.0.0.1:8000. Interactive API docs are disabled. Bind to loopback for local use; the optional shared access code is described below.

Download the authorized portal archive and extract it to data/soony-data/soony/ and data/soony-data/suppliers/. Each teammate obtains their own authorized copy. Customer data is excluded from Git. Fresh clones show missing-data warnings until inputs are supplied.

## Working now

- Source-derived launch requirements, stock, short-shipment reconciliation and prioritized cases.
- Game-card case uses supplier PDF quantity rows and PO/material/AWB matching, not copied outcome constants.
- Provisional art-book over-receipt estimate, statue quality exclusion, magnet BOM review.
- Server-side source evidence, explicit uncertainty and recovery constraints.
- Portal polling every 60 seconds with SHA-256 validation, cached downloads, removal quarantine and visible failure state.
- Persistent SQLite drafts, named inquiry approval, stale-evidence invalidation and guarded SMTP transport.
- Optional model investigation with read-only issue/search/document tools and action history.
- A role-based agent crew, policy routing, checked quantities, separate supplier and internal drafts, and an arrival-time packing simulator.

## Connections

All secrets belong in ignored .env, never source or browser JavaScript.

| Connection | Configuration | Behavior |
| --- | --- | --- |
| Portal | LIO_PORTAL_TOKEN from Settings | Manual check or automatic checksum polling |
| AI | OPENAI_API_KEY and LIO_AI_MODEL | Explicit Run AI investigation sends relevant source text to OpenAI |
| Email | SMTP settings, LIO_EMAIL_ENABLED=true, verified recipient | Sends only the reviewed, approved availability inquiry |

Model investigation uses the [OpenAI Responses API](https://developers.openai.com/api/reference/resources/responses/methods/create). It cannot send email, order goods or approve spending. Deterministic reconciliation owns quantities. Each installation needs its own credentials; the UI reports available connections. Allocation of existing stock adds no new supply and never counts as recovered copies.

LIO_GAME_CARD_RECIPIENT and LIO_ART_BOOK_RECIPIENT must contain verified hackathon inboxes. Register the sender in portal Settings first. Documents cannot change configured recipients. No supplier email has been sent during development.

Approval here authorizes the displayed inquiry only. It does not authenticate a person's identity, approve a PO, grant a quality concession or replace Soony's PP-07 policy. SMTP acceptance is not supplier confirmation. Ambiguous delivery blocks automatic retry: check sent mail first.

## Privacy and access

The browser never receives source documents, file names, paths or excerpts. One filter layer (app/public.py) allowlists every API response; raw evidence, tool traces and model transcripts stay on the server. Agent steps are shown as generic labels only.

| Variable | Default | Effect |
| --- | --- | --- |
| LIO_ACCESS_CODE | unset (no login) | When set, every page and API call except /login, /api/login, /api/health and the login assets needs a signed 12-hour cookie. 5 wrong tries per client in 5 minutes and 30 in 10 minutes across all clients return 429. Set it before any non-local hosting; the service refuses to start if LIO_ALLOWED_HOSTS is set without it. Logout revokes the cookie and sessions end on restart. |
| LIO_EXPOSE_SOURCES | off | Only `true` re-enables /api/evidence (raw customer files). Local debugging only; never set it on a hosted copy. |
| LIO_ALLOWED_HOSTS | unset | Comma-separated extra Host names accepted besides localhost, 127.0.0.1 and testserver. |
| LIO_COOKIE_SECURE | unset | `true` forces the Secure flag on the session cookie. It is also set automatically on https or X-Forwarded-Proto https. |

Host only behind an HTTPS proxy and start uvicorn with `--proxy-headers --forwarded-allow-ips='*'` so the scheme and client address are read from the proxy (behind a proxy the global limiter is the real brute-force defence). Limiter and agent status are in memory, so run a single worker. The approver's draft (which includes PO and waybill numbers) is shown in the Details drawer by design.

## Known limits

- No OCR/vision yet. The art-book shortage uses a provisional ordered-quantity estimate; the original scan remains server-side.
- Game-card recovery availability, cost and warehouse arrival remain unconfirmed.
- Read-only IMAP and local .eml reply intake are implemented; live inbox credentials are not configured. Sender matching does not prove identity. Offer claims require human review.
- Per-edition packing bounds are calculated for reviewed offers, excluding nights and elapsed time. This is not a full allocation optimizer or real-time physical inventory; other components and shared capacity still constrain the launch.
- Supported document parsers are limited; changed schemas/layouts may need human review or parser updates.
- Shared-code access gate only (LIO_ACCESS_CODE); no per-user accounts. No spending commitments or unattended sending.

## Validate

```powershell
python -m pytest -q
node --check app/static/app.js
node --check app/static/login.js
```

Tests use synthetic inputs and mocked transports, never private customer fixtures.

## Continue with Claude

Read AGENTS.md, docs/HANDOFF.md, docs/STATUS.md and docs/REVIEW_LOG.md. Update status after each milestone. The current UI specification is docs/PLAN_UI_POLISH.md. Commit or push only when the user requests it. This implementation is independent of Manuel's project.

## Run the agent loop
Open Details to run the agent again: check portal data, reconcile the selected issue, check a configured inbox, optionally run model-directed investigation, and prepare a supplier inquiry for approval. It never auto-sends or commits spending. The crew trace shows which roles ran. The arrival slider is a scenario calculated from the packing snapshot, not a confirmed delivery.

Reply intake is available through the API and optional read-only IMAP. A plain-text .eml reply (max 2 MB) must match the configured sender and retain the case tag. Named review records quantity, timezone-aware warehouse arrival, cost and a verification note. The resulting scenario is a proposed supply alternative; source stock and orders remain unchanged. The current compact UI does not expose reply import or offer review.

## Agent tools and autonomy ladder
The model chooses tools; code validates every call and writes every number. Never registered (rejected and shown as "never"): send_email, place_order, book_freight, pay, approve, update_stock.

| Tool | Autonomy |
| --- | --- |
| get_case, search_documents, read_document, list_supplier_holds, find_conflicts, check_policy, price_option, whatif | auto |
| propose_option, draft_supplier_message, draft_escalation, set_recommendation, flag_unknown | draft (stored, never sent) |
| request_approval | approval (queues; a named human approves) |

The application never sends email. Without a key or when the model fails, the fixed rule-based order runs and is labelled run_mode rule_based. Set LIO_AGENT_MODEL (falls back to LIO_AI_MODEL).
