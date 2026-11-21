# Deck: Launch Control (Lio challenge "Keep the Line Running")

This is the slide-by-slide source for the hand-in deck (6 slides maximum) and the speaker notes for the 3-minute pitch. Timings follow docs/SUBMISSION.md section 5. Claim status follows SUBMISSION: V = verified, A = assumption (must be labelled on the slide), P = pending (never say it as done).

Status change today (from the lead): a live gpt-5.5 agent run completed in run mode "agent" with 12 tool calls, 0 rejected, about 31 s, and ended at "awaiting human review". No email was sent. So "the model chooses tools" is now **V**.

Visual language (current UI, see the restyle note in docs/STATUS.md): white page, ink #0F1115 for text and the single solid element, ink-2 #565B69 for secondary text, hairline #E6E7EB rules. Risk red #B42318 and ok green #17694A appear only as small markers, numbers or one strip. No purple, no gradients, no card stacks, no stock photos. One idea per slide, one large numeral where possible, system sans with tabular numbers. Never show customer documents, file names, excerpts or email addresses (not in screenshots either).

---

## Slide 1. The sheet says OK. It isn't.
**Time:** 0:00 to 0:25 (25 s)

**On-slide text:**
> Soony's plan sheet: game cards **OK**, +13,200 cover.
> Our reconciliation: **6,800 Standard copies short.**
> Trucks leave Hamburg Sunday 20:00.

**Visual:** Split slide with a hairline divider. Left: "Soony plan sheet" with a small ok-green "OK" marker and "+13,200" in ink-2. Right: a large numeral "6,800" in risk red with "Standard copies won't ship" underneath. No other colour.

**Speaker notes:**
"Sunday 20:00 the trucks leave Hamburg with GH6. Soony's own plan sheet says the game cards are fine, with 13,200 to spare. They are not. Hwaseong shipped 28,000 of 48,000 and the rest lands after launch. Packing has already used 48,300 cards since the plan was made. The real position is 6,800 Standard copies short."
(V: needed 153,200 vs ERP 118,400 + 48,000 due; 28,000 shipped, balance 24 Nov; 48,300 used since plan; gap 6,800.)

---

## Slide 2. Six suppliers, one spreadsheet, found at the dock
**Time:** 0:25 to 0:50 (25 s)

**On-slide text:**
> Six suppliers. Mail and PDFs. Shipments tracked in a spreadsheet.
> "We find out at the dock."
> [INSERT: what Maren/Felix told us]

**Visual:** Three short lines in ink, left-aligned, lots of white space. The office-hours quote goes underneath, large, with attribution in ink-2. Optional small row: "10 places where Soony's own records disagree" (V on current data; the screen lists the first 8).

**Speaker notes:**
"Soony runs launches with six suppliers. Updates arrive as emails and PDFs, and shipments are tracked in a spreadsheet. Their onboarding notes say they find out at the dock. On Saturday, [INSERT: Maren/Felix] told us [INSERT: what Maren/Felix told us]. When we reconciled their files we found 10 places where their own records disagree with each other."
(V: six suppliers and "we find out at the dock" from the onboarding notes; 10 conflicts from the conflicts module on the current data; the UI lists the first 8. **Placeholder:** the interview quote is still missing. If there is no interview before the pitch, drop the line. Do not paraphrase from memory and do not make up a quote.)

---

## Slide 3. An agent that reads, decides, drafts
**Time:** 0:50 to 1:10 (20 s)

**On-slide text:**
> Reads messy files. Finds what breaks. Prices options. Routes the right approver. Drafts the messages.
> It never sends or pays. A named human approves.

**Visual:** One horizontal line of five steps in ink with hairline connectors: Read, Reconcile, Options, Approver, Draft. Then a thin gate marker "Human approval", and after it the greyed-out words "send / pay / book". Under the line, small ink-2 text: "Model chooses tools. Code writes every number."

**Speaker notes:**
"Launch Control is a control room for launch week. An agent reads the PDFs, spreadsheets, Word documents and CSVs; where files disagree, the newest one wins. It finds what breaks, prices the options, sends the decision to the approver named in Soony's approval policy, and drafts the supplier message and the internal escalation. Sending, paying, booking and approving are not tools it has. A named person approves."
(V: file types, newest-file-wins, policy routing, drafts only, the never-registered actions.)

---

## Slide 4. Live demo
**Time:** 1:10 to 2:20 (70 s)

**On-slide text:**
> Live: Launch Control on Soony's real launch data.
> (Backup: recorded run, labelled.)

**Visual:** Mostly empty slide; switch to the browser. If the demo fails, the backup video is on the desktop and must open in under 10 s.

**Demo sequence and speaker notes:**
1. (0 to 10 s) First screen: headline "6,800 Standard copies won't ship on time", hours bar, decision card. "One recommendation, one decision."
2. (10 to 25 s) Drag the "parts arrive" slider. "If the parts arrive later, this many copies still ship. It's computed from the packing hours left: 23 hours, and Collector's needs 21 of them." (V)
3. (25 to 45 s) Agent timeline. "This run is the model choosing its own tools: 12 tool calls, none rejected, about 31 seconds, and it stopped at human review." (V, live gpt-5.5 run.) Point at the Boise hold: "36,000 cards are packed and on hold at Boise's dock because our PO says DDP and their agreement says EXW. That is 5.3 times the gap. The arrival date is unknown, so the agent says unknown." (V)
   - **Timing rule:** a run takes about 31 s. Start the run before the pitch, or press Run at the start of the demo and talk over steps 1 and 2. Don't wait silently. If the result shown is from an earlier run, say "this is the run from a few minutes ago".
   - If the model is unavailable, the run shows "rule-based". Say "this is the rule-based fallback" out loud.
3b. (inside step 3, 10 s) Scroll to "Transport options". "We compared air, sea and road for each supplier against Sunday 20:00. For the game cards no mode makes it: air is about 3.7 days late. So the lever is the hold at Boise, not a faster flight." (V on the engine's output; the arrival time rests on stated handling assumptions of 1 day to the airport, 1 day customs, 2 days flight, 1 day truck. Freight prices are market-rate **estimates**: say "estimate" every time. Road from the Polish art-book supplier does fit, with about 7 hours to spare, but that is transit time only and supplier stock is unconfirmed.)
4. (45 to 65 s) Open Details: the supplier message and the internal escalation are drafts with two-step named approval. "Terms change goes to the Head of Procurement, freight to the Category Lead, as the policy says. Nothing is sent by the app: a person sends it from their own mailbox, and the reply comes back as a file for review." (V: manual send route, no SMTP.)
5. (65 to 80 s, optional, only if rehearsed) Offer card with the "Simulated reply" chip. "This is a rehearsal reply going through the real import path. The real inquiry to Hwaseong went out on Saturday and has no reply yet." (Simulated: say it.)
6. (80 to 90 s) Print the one-page brief. "The CPO asked for one page, not forty dashboards."

---

## Slide 5. What it is worth to Soony
**Time:** 2:20 to 2:45 (25 s)

**On-slide text:**
> 6,800 copies short. EUR 80,920 product cost at stake. 36,000 cards on a dock.
> *Hypothesis:* per-launch fee, below one expedited shipment.

**Visual:** Three numerals in a row with labels in ink-2: "6,800" (risk red), "EUR 80,920 at cost", "36,000 held = 5.3x gap". Under a hairline, the pricing hypothesis in italic with a visible "Hypothesis" tag. Footnote in small ink-2: "Cost basis only: the data has no selling price. Freight and FX: assumptions, unset."

**Speaker notes:**
"That's 6,800 copies, which is EUR 80,920 of product cost at stake. We count it at cost because the data has no selling price, so we don't claim lost revenue. There may also be a late-delivery claim of about USD 3,920 under the Hwaseong contract, subject to Legal. And 36,000 cards nobody asked about are sitting on a dock. Why now: launch week, when a day of phone calls and spreadsheet reconciliation costs packing hours. Our pricing is a hypothesis: a per-launch or monthly fee well below the cost of one expedited shipment. We'd want to check that with Soony."
(V: 6,800; EUR 80,920 = 6,800 x EUR 11.90 std cost; USD 3,920 claim = 2 % per commenced week of USD 196,000, subject to Legal; 36,000 = 5.3x. A: pricing; freight cost and FX are editable assumptions, so options say "price unknown". P: time saved, so give no number.)

---

## Slide 6. Works beyond one launch
**Time:** 2:45 to 3:00 (15 s)

**On-slide text:**
> Input: a folder of POs, receipts, contracts, policy, memos.
> Policy and priorities parsed, not hardcoded.
> Fits any launch-driven business with multi-supplier kits.

**Visual:** A folder glyph on the left, then three generic outputs: "holds", "conflicts", "approver". A small ink-2 line at the bottom: "Tested on one customer dataset. Next: ERP integration, live supplier loops."

**Speaker notes:**
"The input is just a folder: POs, receipts, contracts, policy and memos. Priority comes from the CPO memo, and approver tiers and pack counts come from the files, so nothing is hardcoded. Our reasoning: any business whose launch date is fixed and whose product is a kit from several suppliers has the same problem. Think game and toy publishers, consumer electronics bundles, subscription boxes. We've tested it on one customer dataset. Next is ERP integration and live supplier loops."
("Beyond Soony" is our reasoning. It is not a market-size claim and we give no TAM number. "One customer dataset" is the honest scope; a second-dataset test is P.)

---

## Hard judge questions (2-minute Q&A)

1. **"Is anything hardcoded?"** No business numbers are in the code. Quantities, stock, priority and approvers are parsed from the files: pack counts from the newest status file, priority from the CPO memo, tiers from the approval policy. Prices and FX are explicit editable assumptions and show "unknown" until they are set. *Show the policy parser and the assumptions file.*
2. **"What if the model is wrong?"** It can't send, pay, book or approve; those tools don't exist. Code injects and re-checks every number in a draft, and any claim the records don't support is rejected and replaced. A named person approves, and an approval is voided when the evidence changes. Without a model, the labelled rule-based path runs. In the live run, 0 of 12 calls were rejected.
3. **"Does it work beyond Soony?"** Its input is a generic folder of POs, receipts, contracts, policy and memos. Hold detection, conflict detection, approver routing and what-if are not specific to Soony. Honest scope: tested on one customer dataset.
4. **"Why would Soony pay, and how much?"** In launch week it replaces a day of reconciliation and phone calls, and it finds options nobody checked, like the Boise hold at 5.3 times the gap. Pricing is a hypothesis: a per-launch or monthly fee below the cost of one expedited shipment. We'd test that with Soony's team.
5. **"What happens on a new data drop?"** Portal sync detects the changed files, the engine recomputes, approvals tied to the old evidence are voided, and the agent can be run again. (Say "recomputes and invalidates". Don't say "explains what changed".)

## Do not say (unverified or false)

- Any interview quote, or "Felix/Maren told us", until the interview has happened and the words are written down verbatim.
- Lost revenue, selling price, margin, or a euro figure for the value of Launch Control. Only EUR 80,920 **at cost**.
- A concrete price for the product, or market size / TAM numbers.
- Time saved per decision (not measured).
- That the Boise cards arrive in time, or any arrival date or freight price for Plan B (unknown).
- That a supplier replied, or that the Hwaseong inquiry was answered. The offer card is a **simulated** reply.
- That the app sends email, places orders or books freight. It drafts; humans send.
- That it was tested on a second customer or dataset.
- "Explains the diff since the last run" (the since-last-run strip isn't built).
- Live IMAP/SMTP or Gmail integration as a verified feature of the app. Email is sent by a person from their own mailbox (hand-off route); replies are imported as .eml files.
- A freight price as fact. Every freight figure is a market-rate estimate with a stated source (docs/FREIGHT.md); the data contains no freight prices.
- That any transport mode saves the game-card shortfall. The engine says none reaches Hamburg by Sunday 20:00 under its stated assumptions.
- That it is deployed or public, unless the tunnel was tested on the day.
- The number of competing teams, or anything about Lio's internal tools or approval model.
- That the agent is "always" right or fully autonomous. The verified claim is one live run: 12 calls, 0 rejected, about 31 s, stopped at human review.
