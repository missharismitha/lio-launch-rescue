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

Preserve an existing .env instead of copying over it. Open http://127.0.0.1:8000; API docs at /docs. Bind only to loopback: this MVP has no user authentication or production hosting.

Download the authorized portal archive and extract it to data/soony-data/soony/ and data/soony-data/suppliers/. Each teammate obtains their own authorized copy. Customer data is excluded from Git. Fresh clones show missing-data warnings until inputs are supplied.

## Working now

- Source-derived launch requirements, stock, short-shipment reconciliation and prioritized cases.
- Game-card case uses supplier PDF quantity rows and PO/material/AWB matching, not copied outcome constants.
- Provisional art-book over-receipt estimate, statue quality exclusion, magnet BOM review.
- Evidence links, explicit uncertainty and recovery constraints.
- Portal polling every 60 seconds with SHA-256 validation, cached downloads, removal quarantine and visible failure state.
- Persistent SQLite drafts, named inquiry approval, stale-evidence invalidation and guarded SMTP transport.
- Optional model investigation with read-only issue/search/document tools and action history.

## Connections

All secrets belong in ignored .env, never source or browser JavaScript.

| Connection | Configuration | Behavior |
| --- | --- | --- |
| Portal | LIO_PORTAL_TOKEN from Settings | Manual check or automatic checksum polling |
| AI | OPENAI_API_KEY and LIO_AI_MODEL | Explicit Run AI investigation sends relevant source text to OpenAI |
| Email | SMTP settings, LIO_EMAIL_ENABLED=true, verified recipient | Sends only the reviewed, approved availability inquiry |

Model investigation uses the [OpenAI Responses API](https://developers.openai.com/api/reference/resources/responses/methods/create). It cannot send email, order goods or approve spending. Deterministic reconciliation owns quantities. No model key/name is configured in the initial setup; UI distinguishes rules from model output.

LIO_GAME_CARD_RECIPIENT and LIO_ART_BOOK_RECIPIENT must contain verified hackathon inboxes. Register the sender in portal Settings first. Documents cannot change configured recipients. No supplier email has been sent during development.

Approval here authorizes the displayed inquiry only. It does not authenticate a person's identity, approve a PO, grant a quality concession or replace Soony's PP-07 policy. SMTP acceptance is not supplier confirmation. Ambiguous delivery blocks automatic retry: check sent mail first.

## Known limits

- No OCR/vision yet. Art-book scan is linked; the shortage uses a provisional ordered-quantity estimate.
- Game-card recovery availability, cost and warehouse arrival remain unconfirmed.
- No automated inbox/reply ingestion or fabricated supplier confirmations.
- No packing simulator, allocation optimizer or real-time physical inventory. Workbook rates are source assumptions.
- Supported document parsers are limited; changed schemas/layouts may need human review or parser updates.
- No production authentication, shared deployment, spending commitments or unattended sending.

## Validate

```powershell
python -m pytest -q
node --check app/static/app.js
```

Tests use synthetic inputs and mocked transports, never private customer fixtures.

## Continue with Claude

Read AGENTS.md, docs/STATUS.md and docs/PLAN.md. Update status after each milestone. Use small commits on a task branch and keep main working. This implementation is independent of Manuel's project.
