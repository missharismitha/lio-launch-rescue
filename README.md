# Launch Control (Lio Launch Rescue)

START Hack Munich 2026, Lio challenge "Keep the Line Running".

## Problem

Soony launches GH6. The trucks leave Hamburg on Sunday at 20:00. Soony's own plan sheet shows the game cards as "ok", with 13,200 cards to spare. They are not ok. The game-card supplier shipped 28,000 of 48,000 (the rest lands after launch), and packing has used cards since the plan was made. Launch Control finds that 6,800 Standard copies will not ship on time. Collector's Edition comes first, as the CPO memo requires. This gap is only visible when POs, ERP stock, the plan, packing status, supplier notices, contracts and memos are read together, and they disagree in 10 places (current data).

## What it does

- Reads Soony's messy files (PDF, DOCX, XLSX, CSV; the newest file wins), works out the real shortfall and lists where the records conflict.
- Finds Plan B options nobody asked about. For example, a second supplier has 36,000 cards packed and on hold at its dock until delivery terms are confirmed. That is 5.3 times the gap. Their arrival time is unknown, and the app says so.
- Prices each option where it can (or shows "unknown"), routes the decision to the approver named in Soony's approval policy, and drafts the supplier message and the internal escalation.
- A what-if slider shows how many copies still ship if the parts arrive in N hours. This is a scenario, not a confirmed delivery.
- An agent (OpenAI Responses API, model set by env) picks its own tools across several turns, within fixed limits. Code checks every tool call. Without a model, a fixed rule-based order runs and is labelled `rule_based`.

## Human approval model

- The agent can read, compute and draft. Sending, ordering, booking freight, paying, approving and changing stock are not tools at all. If the model asks for one, the call is rejected and logged.
- A named person approves each draft in two steps (read it, then type a name). The internal escalation needs its own separate approval. Approval is tied to the evidence: if the source files change, the approval is cancelled.
- Approval in this app covers the displayed draft only. It does not replace Soony's authorised approver, a PO or a quality concession.
- Email sending is off by default. An optional guarded SMTP send exists only for an approved inquiry whose evidence has not changed. It needs `LIO_EMAIL_ENABLED=true` and a verified recipient. If SMTP fails or the result is unclear, the app does not retry automatically. SMTP acceptance does not mean the supplier confirmed anything.

Verified on 21 Nov 2026: `python -m pytest -q` gave 349 passed, 1 skipped. A live gpt-5.5 agent run finished in run mode `agent` with 12 tool calls, 0 rejected, in about 31 s. It stopped at `awaiting_human_review` and sent no email.

## Run

Python 3.11+. Windows PowerShell, from the repository root:

```powershell
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
Copy-Item .env.example .env   # skip if you already have a .env
.\.venv\Scripts\python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 8000
```

On any other OS:

```sh
python -m venv .venv && . .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
python -m uvicorn app.main:app --host 127.0.0.1 --port 8000
```

Open http://127.0.0.1:8000. Customer data is not in the repository. With `LIO_PORTAL_TOKEN` set, the service downloads the authorised portal archive into `LIO_DATA_DIR` and checks it every 60 seconds. Without the token, it shows missing-data warnings.

The built UI is already in `app/static/`. Rebuild it only after changing `frontend/`:

```powershell
cd frontend; npm ci; npm run build
```

## Test

```powershell
python -m pytest -q                          # backend; synthetic inputs, model/SMTP/network blocked
cd frontend; npm test; npm run typecheck     # vitest + TypeScript
```

The tests never use customer files and never call the real model or send email.

## Deployment

The repository has a `Dockerfile` (single uvicorn worker, proxy headers on, no customer data in the image) and a `render.yaml` blueprint for the Render free tier. Secrets go in the Render dashboard. Deployment is not live yet. The URL and the access code will be in the hand-in note.

## Environment variables

All secrets go in the git-ignored `.env` (or the host's secret store). They never go in source code or browser code.

| Variable | Default | Effect |
| --- | --- | --- |
| LIO_PORTAL_TOKEN | unset | Portal download and checksum polling (`LIO_POLL_SECONDS`, default 60). |
| OPENAI_API_KEY, LIO_AI_MODEL | unset | Turns on the model-driven agent. `LIO_AGENT_MODEL` overrides the model for the agent loop. Relevant source text is sent to OpenAI only when you run the agent. |
| LIO_ACCESS_CODE | unset (no login) | Every page and API call except /login, /api/login, /api/health and the login assets needs a signed 12-hour cookie. Too many wrong attempts return 429: 5 per client in 5 minutes, or 30 across all clients in 10 minutes. Logout revokes the cookie, and all sessions end when the service restarts. Required for any hosted copy. |
| LIO_ALLOWED_HOSTS | unset | Comma-separated Host names accepted in addition to localhost. If set without `LIO_ACCESS_CODE`, the service refuses to start. |
| LIO_COOKIE_SECURE | unset | `true` forces the Secure cookie flag. It is also set automatically on https or `X-Forwarded-Proto: https`. |
| LIO_EXPOSE_SOURCES | off | `true` re-enables /api/evidence (raw customer files). Local debugging only. Never set it on a hosted copy. |
| LIO_EMAIL_ENABLED, SMTP_*, LIO_*_RECIPIENT | false / unset | Optional guarded send of an approved inquiry to a verified recipient. |
| IMAP_* | unset | Optional read-only inbox check for supplier replies. |
| LIO_DATA_DIR, LIO_STATE_DIR | data/soony-data, .local | Input folder and the folder for the SQLite state and assumptions. |

## Architecture

```
Portal drops (files) --> sync --> engine (reconcile: PO, ERP, plan, status, memo, policy)
                                   |                                      |
                         holds + conflicts + what-if            pricing + policy routing
                                   \______________ tools _______________/
              Agent (model chooses tools, bounded) --> Checker (numbers re-verified in code)
                                   |
        public.py allowlist (browser never sees documents/paths/quotes)  -->  UI (decision, rail, drawer)
                                   |
        drafts only --> named human approval --> (human or Gmail connector sends) --> reply import (human review)
```

Main modules in `app/`:
- `sync.py` handles the portal. `engine.py` handles reconciliation. `holds.py`, `conflicts.py` and `whatif.py` cover holds, conflicts and what-if scenarios. `pricing.py` and `policy.py` handle pricing and approver routing.
- `tools.py` and `agent_loop.py` run the agent. `crew.py` runs the roles and the rule-based fallback. `verify.py` is the number checker. `actions.py` writes the drafts. `public.py` is the browser allowlist. `access.py` is the login gate.
- `frontend/` contains the UI (Vite + React).

Agent limits (each can be changed via env): 8 turns, 20 tool calls, 45 s, and per-tool caps. The loop stops after 3 rejected calls in a row.

## Data-driven vs assumption

- **From the files:** quantities, stock, packing counts (from the newest status file), edition priority (from the CPO memo), approver tiers (from the approval policy), supplier holds and conflicts. No challenge results are stored as constants in the code.
- **Assumptions:** freight rates and exchange rates are editable assumptions in `.local/assumptions.json`. They are empty by default, so options say "price unknown". The data has no selling price, so the app does not claim lost revenue. The figure it shows is product cost at stake.
- **Simulated:** `scripts/simulate_supplier_reply.py` creates a rehearsal supplier reply. The reply goes through the real import path and is clearly labelled as simulated. Its numbers are scenario inputs, not facts.

## When the system is wrong

- Code fills in and re-checks every quantity, date, price and approver in a draft. If the model writes a number or claim that is not in the records, it is rejected and replaced with a sentence composed by code.
- Code checks every tool call. Invalid calls are rejected and shown in the trace. If the model fails or makes no valid action, the rule-based path runs and is labelled as such.
- Unknown arrivals and prices are shown as unknown, with low confidence. Allocating existing stock never counts as recovered copies.
- New files trigger a fresh calculation and cancel existing approvals. Sending or spending always needs a named person.

## Privacy and access

The browser never receives source documents, file names, paths or excerpts. One filter layer (`app/public.py`) allowlists every API response. Raw evidence, tool arguments and model transcripts stay on the server. Agent steps appear only as generic labels. The approver's draft, which includes PO and waybill numbers, is shown in the Details drawer by design. API docs pages are disabled. Every response carries security headers. For hosting, put the app behind HTTPS with `--proxy-headers` (the Dockerfile already does this) and run a single worker, because the rate limiter and agent status live in memory. Customer data is used only for this hackathon and never committed.

## Known limits

- Tested on one customer dataset only. Document parsers are limited, so a changed layout may need human review or a parser update.
- No OCR or vision. The art-book shortage uses a provisional estimate.
- Recovery arrival times, costs and supplier confirmations are unknown until a supplier replies. Prices stay "unknown" until the assumptions are filled in.
- Hours left are counted from the time in the status file, not the wall clock. The packing bounds are not a full allocation optimiser.
- The agent runs only when you press Run. It does not re-run automatically on a new data drop, and it does not yet explain what changed since the last run.
- One shared access code, no per-user accounts. Approval records a typed name, but it does not prove who that person is. Matching a reply's sender does not prove identity either.
- IMAP reply intake is built, but no live inbox is configured.
