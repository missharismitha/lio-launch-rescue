# Submission pack: Launch Control (Lio challenge "Keep the Line Running", START Hack Munich 2026)
Written Sat 21 Nov 2026 night. Every claim below is either verified in the repo/data (marked V), a documented assumption (A), or still pending a build/measurement (P: do NOT say it on stage until it is true). Hand-in: Sunday 12:00 (prototype, deck, demo video max 3 min, repo + README). Demos from 14:00: 3 min pitch + 2 min questions. Team count (~13) is user-reported, unverified.

## 1. Confirmed requirements vs assumptions
Confirmed (challenge brief + judging sheet): live demo is mandatory; hand-in = working prototype (deployed if possible), deck, 3-min video, code + short README by Sunday 12:00; four criteria: (1) pitch that sticks (problem understood in 30 s; clear line from what hurts at Soony to what we built; used what Soony's team told us, "On Saturday, Felix told us..."), (2) real business case (why this/why now/what it is worth; why Soony pays and roughly how much; who else has it; works beyond one launch), (3) technical depth: "Agents do real work. Your AI reads, decides and acts" (real actions, tool use/state, messy and contradictory data, nothing hardcoded, copes with new drops, can explain what happens when it is wrong), (4) taste (looks and feels like a real product, one clear recommendation, one click to act). Data use only for this hackathon; do not share outside the team.
Assumptions to avoid stating as fact: any judge preference beyond the sheet; the number of competing teams; Lio's internal UI/approval model (not public).
Not yet done by us: the three office-hours interviews (the "Felix told us" moment is still missing: book all three blocks); a real supplier reply (the Hwaseong inquiry was sent for real on Sat 18:20 from the user's Gmail; no reply yet; the sender must be registered in the portal Settings).

## 2. Likely competitor approaches (inference, not evidence)
(a) Dashboard over the spreadsheet with a chat box ("ask the data"): explicitly called weak by the sheet. (b) A supplier-chaser email bot (draft/send nudges) with little reconciliation of the messy data. (c) Stock-truth/risk-score visualisation without actions or approvals. Our differentiator must be what they are unlikely to have all at once.

## 3. Three differentiators (all V unless marked)
1. It found what the system hid. Soony's own plan sheet shows the game cards as "ok" with +13,200 cover (V: needed 153,200 vs ERP 118,400 + 48,000 due). Hwaseong then shipped only 28,000 of 48,000 (balance lands 24 Nov, after launch), and 48,300 cards were already used by packing since the plan: real position = 6,800 short, all Standard (Collector's first per the CPO memo). The agent reads PDFs, docx, xlsx and CSV, newest-file-wins, and lists 8 places where Soony's own records disagree (V: conflicts module).
2. It found the best Plan B nobody asked about: Boise has 36,000 cards packed and ON HOLD at its dock until Soony confirms delivery terms (our PO said DDP; Boise's sales agreement already says EXW) = 5.3 times the gap (V). The agent routes the decision to the right approver per the approval policy (terms change to the Head of Procurement, freight to the Category Lead; Collector's Items lead is vacant until 23 Nov) and drafts both messages. It does NOT claim the cards arrive in time: arrival is unknown (V: shown as unknown, confidence low).
3. Human-in-the-loop by design, with code-owned numbers: every price, quantity, date and approver in a draft is computed or re-checked in code; "send / pay / book / approve" are never tool calls; drafts only, named human approval, and the app never sends mail (V). Honest uncertainty: unknown prices shown as "unknown", low confidence stated plainly, simulated replies labelled.
P (build in progress, say only when live): the model now chooses tools across turns (14 tools, 6 draft-level actions), with a visible tool-call trace and a rule-based fallback labelled as such.

## 4. Quantified impact (A = assumption, say so)
V: gap 6,800 Standard copies of 640,000 (1.06 percent of the Standard run); 23 packing hours left and Collector's needs 21 (almost no slack); EUR 80,920 of product cost at stake on a cost basis (6,800 x EUR 11.90; the data has NO selling price or refund amount, so we do not claim lost revenue); potential late-delivery claim from the Hwaseong contract about USD 3,920 (2 percent per commenced week of the delayed USD 196,000, subject to Legal); the held Boise stock (36,000 units) is 5.3 times the gap. A: freight cost and FX are editable assumptions (empty until Maren/Felix or the team supplies them): until then the options say "price unknown". P: time saved per launch-week decision (not measured; do not claim a number). Business case line: priced decision + named approver + drafted messages in minutes instead of a day of phone calls and spreadsheet reconciliation (qualitative until measured).
Measurable baseline: Soony's sheet says "ok"; our reconciliation says 6,800 short. That single before/after is the demo.

## 5. Three-minute pitch (Problem, Pain, Solution, Live demo, Impact, Why we win)
0:00-0:25 Problem. "Sunday 20:00 the trucks leave Hamburg. Soony's own sheet says the game cards are fine. They are not." [Slide: the sheet's OK next to our 6,800 short.]
0:25-0:50 Pain. Six suppliers, mail and PDFs, shipments tracked in a spreadsheet, "we find out at the dock" (V: onboarding notes). INSERT the office-hours line: "On Saturday, [Maren/Felix] told us ..." (P: needs the interviews).
0:50-1:10 Solution. "Launch Control is a launch-week control room: an agent that reads their messy files, finds what breaks, prices the options, routes the right approver and drafts the messages. It never sends or pays; a named human approves."
1:10-2:20 Live demo (see section 6).
2:20-2:45 Impact. 6,800 copies, EUR 80,920 of product cost at stake, 36,000 cards sitting on a dock, every number recomputed in code, honest unknowns.
2:45-3:00 Why we win / next. "It works beyond this launch: any customer folder of POs, contracts, policies and memos; policy and priorities are parsed, not hardcoded. Next: Lio-grade ERP integration and live supplier loops."

## 6. 90-second live demo sequence (rehearse twice; backup video ready)
1 (0-10 s) Open on the first screen: headline "6,800 Standard copies won't ship on time", hours bar, decision card. 2 (10-25 s) Drag the "parts arrive" slider: the shortfall strip recolours, copies that still ship update (V what-if). 3 (25-45 s) Click Run agent / open the agent rail: tool calls appear (P: live tool-calling; fallback: show the stored trace and say "rule-based fallback"), the Boise hold is found, options are priced "unknown" honestly, approver named. 4 (45-65 s) Open Details: supplier message + internal escalation drafts, two-step named approval; point at "Nothing is sent". 5 (65-80 s) Show the reviewed offer card with the "Simulated reply" chip: "this is a rehearsal reply through the real import path; the real Hwaseong inquiry went out at 18:20 and we show its status honestly". 6 (80-90 s) Print the one-page brief (the CPO memo asks for one page, not forty dashboards).
Never disguise simulated or fallback output as live. If Wi-Fi fails: play the 3-minute video from the desktop (open in under 10 s).

## 7. Five hard judge questions with concise answers
1. "Is anything hardcoded?" No business numbers in code: quantities, stock, priority and approvals are parsed from the files (pack counts from the newest status file, priority from the CPO memo, approver tiers from the approval policy); prices/FX are explicit editable assumptions and show "unknown" until set. Show the policy parser and assumptions file.
2. "What if the model is wrong?" Numbers in every draft are injected and re-checked in code; a claim not in the records is rejected and replaced; spend/send need a named human; the rule-based path runs without a model and is labelled; approvals are voided when evidence changes.
3. "Does it work beyond Soony / one launch?" It takes a folder of POs, receipts, contracts, policy and memo documents; hold detection, conflict detection, approver routing and what-if are generic. (P: say "tested on one customer dataset"; do not claim a second customer unless the fixture test exists.)
4. "Why would Soony pay, and how much?" It replaces a day of reconciliation and phone calls at the moment a launch is at risk, and surfaces options nobody checked (the Boise hold). Price hypothesis labelled as hypothesis: a per-launch or monthly fee well below the cost of one expedited pallet; ask Maren what she would compare it with (P: pending interview).
5. "How does it handle a new data drop?" The portal sync detects changed files, the engine recomputes, approvals are voided on changed evidence, and the agent re-runs (P: since-last-run strip not built; say "recomputes and invalidates", not "explains the diff").

## 8. Architecture (diagram)
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
## 9. README outline (one page)
Problem and solution; screenshot (no customer documents); live URL + note that the access code is provided in the hand-in note; architecture bullets (6); what is data-driven vs assumption; what happens when the system is wrong; how to run and test (`python -m uvicorn app.main:app`, `python -m pytest -q`, env vars table: LIO_PORTAL_TOKEN, OPENAI_API_KEY, LIO_AI_MODEL, LIO_ACCESS_CODE, LIO_ALLOWED_HOSTS, LIO_COOKIE_SECURE, LIO_EXPOSE_SOURCES); data statement (customer data is not in the repo, used only for this hackathon); simulation notice (`scripts/simulate_supplier_reply.py`, labelled); limitations and next steps.

## 10. Submission checklist (tick before Sunday 11:00)
[ ] pytest green; app starts from a clean clone; [ ] README rewritten; [ ] deck PDF (max 6 slides: hook, pain + office-hours quote, solution, live-demo placeholder, business case, why it works beyond Soony); [ ] 3-minute video recorded on the final build (address bar masked; no customer documents on screen; simulated parts labelled); [ ] demo run twice end to end; [ ] backup screenshots saved; [ ] deploy/tunnel: app reachable behind LIO_ACCESS_CODE (laptop + tunnel), tested from a phone on mobile data; [ ] repo private, no data/.env/.local committed (`git ls-files` check); [ ] sender registered in the portal Settings; [ ] three office-hours interviews done with verbatim quotes; [ ] a teammate opens the hand-in links in a private window; [ ] submit by 11:00 (buffer one hour).
