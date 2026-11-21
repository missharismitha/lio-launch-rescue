# Lio Launch Rescue

START Hack Munich 2026 — Keep the Line Running.

An AI agent that reconciles Soony's inventory with original supplier documents, identifies shortages, and prepares a recovery for human approval before supplier outreach.

## First working demo

1. Detect the art-book delivery note correction from 80,000 to 8,000 units.
2. Reconcile the stock snapshot to estimate 19,300 available books against 25,200 required: a 5,900-unit shortage, subject to physical confirmation.
3. Evaluate Karton Nowak's offer of 8,000 finished books, including price, transport, receiving, and packing timing.
4. Present the evidence and approval request.
5. After approval, contact the supplier and track its response.

Figures describe the initial dataset, not constants to hardcode. Other component shortages may still prevent launch.

## Working together

- Keep `main` working and use it as the shared integration branch.
- Create a separate branch per task: `codex/<short-task>` or `manuel/<short-task>`.
- Agree on file ownership before asking coding agents to make changes. Avoid simultaneous edits to the same files.
- Use small pull requests and merge frequently. Pull the latest `main` before starting each task.
- Agree on the data contract before splitting frontend and backend implementation.
- Keep approval and email sending separate: analysis alone must not send messages or commit spending.

Suggested first split: Harismitha owns ingestion, reconciliation, and the recovery workflow; Manuel owns the evidence and approval UI against an agreed sample response. Confirm the stack and response contract together before implementing those pieces.

## Local challenge data

Download the current archive from the signed-in Soony portal. Extract it under `data/` so that files are available at `data/soony-data/soony/` and `data/soony-data/suppliers/`.

Customer files and analysis extracts are excluded from Git. Each teammate obtains their own authorized copy. Keep portal passwords, API tokens, email credentials, and session files out of the repository; use local environment variables when implementation begins.

## Project status

Repository initialized. Application stack and shared API contract are the next decisions; there is no runnable application yet.
