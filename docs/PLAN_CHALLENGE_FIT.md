# Plan: make the agent act, price the options, win the criteria (Sat 21 Nov 17:00 to Sun 22 Nov 12:00)

Produced by the Plan agent. Build agents follow this file. Facts quoted from the data MUST be re-verified by the builder from the files (never trust this text blindly); all user-visible output goes through app/public.py allowlists and shows NO file names, paths or document quotes (see docs/PLAN_UI_PRIVACY.md).

## User decisions (final)
1. The agent may send ONE real, harmless availability inquiry to Hwaseong from a sender registered in the portal Settings, ONLY after a named human approval of the exact text in the app. Never send anything else, never auto-send, never in tests.
2. Hosting: run from the laptop and expose through a tunnel (Cloudflare quick tunnel or ngrok) behind LIO_ACCESS_CODE. No customer data in the repo or any image. Installing a tunnel binary needs the user's explicit OK (download = ask first).

## Judging criteria to optimise
Pitch that sticks (use what Soony's team told us); real business case (a money number, why Soony pays, who else); technical depth = THE ONE RULE agents do real work (decide, write, escalate), tool use + state, messy/contradictory data, nothing hardcoded, copes with NEW DROPS, can explain what happens when the system is wrong; taste (one recommendation, one click); live demo mandatory; submission Sunday 12:00 (prototype, deck, 3-min video, repo+README); go deep not wide.

## Data facts to verify and use (do not hardcode)
- PP-07 approval policy PDF (soony/context): per-PO limits Buyer <50k, Category Lead <500k, Head of Procurement <2M, CPO <5M, CPO+CFO jointly >=5M; unplanned air freight up to EUR 200k per calendar month and category by Category Lead, above that CPO before booking; site-received POs need a dock slot released by the site lead (DC-HAM Katrin Jansen, deputy Raj Patel); exceptions by Head of Procurement. Parse from the PDF text with a clear "could not parse" failure; do not embed numbers as constants beyond test fixtures.
- Onboarding notes (soony/context/onboarding_notes.md) reportedly say the Category Lead for Collector's Items left and the role is open: verify; if true, required approver for that category is VACANT and must route to the next level (Head of Procurement or CPO). Cross-check org_chart files.
- CPO memo (docx): Collector's first; no unreleased part leaves Hamburg; Quality has the last word; air freight/rush above policy limits reach the CPO the same hour "with cost against copies gained".
- Money inputs: data/master/products.csv std_cost_eur (verify: Standard 11.90, Collector's 34.50; these are COSTS not prices); PO CSV unit_price + currency (cards in USD); contract late-delivery clauses (Hwaseong LTA: verify 2% of delayed value per commenced week, cap 10% of PO; Pune/PackRight 0.5%/week cap 5%; Boise liability limited to price). No selling price or air-freight rate exists in the data: these MUST be explicit, editable assumptions (.local/assumptions.json, git-ignored), labelled "assumption, to be confirmed", never invented as fact.
- A NEW drop is already in the data: bom_delta_2026-11-21.csv and components_update_2026-11-21.csv (ECN-118 Standard sleeve rev B -> C, rev B must not be packed; ECN-119 Collector's fold pattern A -> B, rev A may be used up). Release-gate case.
- Some scanned contracts/delivery notes have no extractable text (need vision/OCR): out of scope, report as "needs human review".

## Build order (stop where time runs out; protect submission time Sunday 08:30-11:00)
Wait until the backend privacy/access build is finished and green before touching app/main.py, app/investigator.py, app/claude_agent.py, app/public.py. Put logic in NEW modules; touch in-flux files only for small hooks.

### Item 1: policy engine + priced Plan B (highest priority, ~1.5 h)
- NEW app/policy.py: parse PP-07 (pymupdf text + regex): tier table, air-freight monthly limit, dock-slot rule, site-lead names; cross-reference org charts / onboarding notes for vacancies. API: required_approver(value_eur, kind, category) -> {role, name_if_known, why, vacancy}; needs_escalation(kind, month_to_date_air).
- NEW app/pricing.py: price_option(option, issue) -> {goods_eur, freight_eur, total_eur, assumptions[], approver}. goods = quantity x latest PO unit_price for the material (FX as visible assumption); freight from .local/assumptions.json (EUR per unit); unknown price returns "unknown", never a guess. Code (not the LLM) prices, checks PP-07, checks the packing window via app/recovery.py (arrival before packing hours run out), and ranks: copies gained per euro, then earliest feasible.
- Tests: tests/test_policy.py (synthetic PDF text; boundaries 49,999/50,000/499,999/500,000/1,999,999/4,999,999/5,000,000; air 199k/201k and cumulative per month; vacant Category Lead falls through), tests/test_pricing.py (missing price -> unknown).

### Item 2: agent ACTION loop with write tools (~2.5 h)
- Extend the tool loop with logged, side-effect-free-by-default tools: price_options, check_policy, draft_supplier_email (reuse supplier-safe draft), draft_escalation, flag_unknown(question, owner). NEW app/actions.py: draft_escalation builds an INTERNAL message to the person required_approver returns: "Decision needed within the hour", copies gained, cost in EUR, assumptions, deadline, and "cost against copies gained" as the CPO memo requires. Stored as a draft with a named approval like the supplier email; NEVER auto-sent.
- Guardrails (the "what if the system is wrong" story): all external/spending actions need a named human approval; drafts invalidate when evidence changes (existing); the agent cannot book, pay or send; every number in a message is computed by code, not typed by the LLM; post-check that the message quantities/dates equal computed values, else reject, re-run once, then fall back to the deterministic template.
- NEW app/runs.py: SQLite table runs(id, at, input_fingerprint, output_json, trigger, status) (base for items 3, 4, 5).
- Tests: tests/test_actions.py (escalation target: vacant Category Lead -> Head of Procurement; air above 200k -> CPO; >=5M -> CPO+CFO; message numbers match computed; mismatched LLM numbers rejected; nothing sent without approval). Mock the LLM. UI: one extra card "Also drafted: escalation to {role}" in the drawer beside the supplier draft (use public.py allowlist; no file names).

### Item 3: one money number on screen 1 (~0.75 h)
- NEW app/value.py: "Value at stake" = copies at risk x unit value; unit values are settings prefilled from std_cost_eur and labelled "cost basis, not price"; if the user supplies a price/refund figure in assumptions it becomes "revenue at risk". Do NOT invent a selling price; with only cost basis show e.g. "about EUR 81k of product cost (6,800 x 11.90) short on launch day" and "Cost to fix vs cost to miss" (cheapest feasible Plan B total vs cost basis). Contract lever: compute potential late-delivery claim from the contract clause and PO value, labelled "from contract, subject to Legal". No hardcoded EUR constants in app/.
- Hook: public.py allowlist `value`; one line under the headline in app.js (coordinate with front end rule: max 4 interactive elements on first screen). Tests: tests/test_value.py (formula, missing-setting path, cap).

### Item 5: robustness (~1 h)
- Cache last good agent result per issue in runs; on OpenAI timeout/failure show the last good result stamped "as of HH:MM" plus a deterministic fallback (engine numbers, template draft, rule-based Plan B with pricing/policy code). Model loop timeout 45 s total, one retry, then fallback. Health strip in the drawer footer (portal sync age, model OK/fallback, email enabled/not); stale badge when last sync older than 10 min. LIO_DEMO_REPLAY=true replays a recorded real run (stored in .local, never committed) through the normal UI path in ~20 s. NEW app/fallback.py. Tests: model raises -> fallback used and labelled; portal offline -> stale badge, page still renders.

### Item 4: new-drop handling with "what changed" (~1.5 h)
- On each sync that detects changed files, auto-run the agent; compare to the last run (runs table) and emit a change summary (delta in gap, delta in stock, changed files by category: logistics/suppliers/customer/news, one-sentence reason). Small "Since last run" strip (max 3 lines; no raw paths). NEW app/diffs.py (pure diff_runs(old,new)). NEW scripts/simulate_drop.py copies a fixture change into a TEMP copy of the dataset (never touches data/) and triggers the same sync path. Tests: tests/test_new_drop.py (engine output differs, approval invalidated, change summary lists it, agent run triggered once, debounced). Guards: one run per fingerprint, max one per 2 minutes, env LIO_AUTORUN=false kill switch. Surface the existing ECN-118 drop as a release-gate flag.

### Later, only if time remains (cut in this order: 6, 8; item 10 is NOT optional)
- Item 10 submission package: README (one page: problem, solution, architecture in 6 bullets, what is data-driven vs assumption, what happens when the system is wrong, run/tests/env vars, data statement, limitations), deck outline max 6 slides, 3-minute video script, live run sheet with failure fallback ladder. Docs only in docs/ (SUBMISSION.md) unless told otherwise; no customer content or file names in public repo docs.
- Item 7 live supplier loop (reply triage/translation + recovery recalculation) after the one approved real inquiry.
- Item 6 release gate on the sleeve ECN as a second case through the same agent (NEW app/release_gate.py, one-line registration).
- Item 8 works beyond Soony: config-driven rules + a test running engine/policy parsers on a synthetic second customer fixture (tests/fixtures/acme/) with no code change; docs/BUSINESS_CASE.md.

## NOT building
Art-book/statue/magnet full flows, truck/port tracker, OCR of delivery notes, chat polish, multi-user auth, anything that books or pays, rewriting in-flux files, fancy charts.

## Office-hours questions (for the human; capture verbatim quotes)
Maren Vogt: (1) What does one missing pre-ordered Collector's copy cost in euros (refund, penalty), and a Standard copy shipped Tuesday instead of Sunday? (2) The Collector's Category Lead is vacant: who actually signs air freight for Collector's parts, any delegation? Spare: above what cost would you ship fewer copies than pay for air freight? Pay per launch or per month?
Felix Brunner: (1) Hwaseong cut 48,000 to 28,000 cards: who really answers there, how fast, would they air-freight the rest, rough price per card? (2) Is ERP stock for cards trustworthy; how many cards used since the last snapshot? Spare: how long to release a DC-HAM dock slot on a Sunday; which parts are single-source?
Nils Berger: (1) Is the tracker spreadsheet or the ERP export the source of truth for open shipments and how often does each update? (2) Will new drops keep file names/column layout; any machine-readable feed? Spare: why do lid magnets not appear in stock; are scans available as text?

## Acceptance
Item 1: tests green; every Plan B card shows total EUR, assumptions and a named approver or "vacant, escalate to X"; unknown price shows "unknown". Item 2: one agent run creates supplier draft + internal escalation draft, both need named approval, nothing sent in tests, mismatch test rejects. Item 3: one money line on first screen, formula+assumptions in drawer, changing assumption changes the number, `grep` for 11.9/34.5 in app/ returns nothing. Item 5: bad API key still shows a labelled fallback; portal blocked shows stale badge. Item 4: tests green; simulate_drop shows a change strip within one poll cycle, approval cleared, one run. Always: tests/test_draft_privacy.py and public-projection tests stay green; no file names/paths/quotes on screen.
