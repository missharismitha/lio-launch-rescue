# Launch Control: pitch script (3:00) + Q&A

Order you asked for: **business case first, then the demo, then the tech at the end, then Q&A.** The spoken script is short because of the time limit; the deck (`docs/deck/Launch-Control-pitch-deck.pdf`, 10 slides) carries the detail the judges can read.

**Format assumption:** 3 minutes on stage, then 2 minutes of questions (the jury sheet's demo format). If you get more time, see "Extra lines" at the end.

| Time | Who | What | Deck slide |
|---|---|---|---|
| 0:00 - 0:40 | Maria | Business case | 1, 2, 3, 5 |
| 0:41 - 2:40 | (nobody) | Live demo in the app: **Watch demo, then Play** (1:59) | switch to the app tab |
| 2:41 - 3:00 | Nico | Tech in plain words + close | 7, then 9 |
| then | both | Q&A (2 min) | 10 |

Words in CAPS get a small push. (pause) means stop for a second.

---

## PART 1: Business case (Maria, 0:00 - 0:40)

*Slide 1 (2 seconds), then slide 2.*

> "Find out at the desk, not at the dock. (pause)
> Imagine launching the biggest game of the year. Soony's sheet said everything was fine. The records said **6,800 copies were short.**
> The information was there, buried in spreadsheets, supplier emails and contracts.
> The problem isn't missing data. It's decisions that come TOO LATE."

*Slide 3, then slide 5 (skip slide 4; it is there for the judges to read).*

> "Launch Control is an AI decision layer. It connects those files, finds the contradictions, and tells a procurement team what to do next.
> Our model: B2B SaaS, starting with paid pilots, with a launch-week fee well below one rush shipment. That's our hypothesis.
> Watch."

*Switch to the app tab and click **Watch demo, then Play**. Nobody talks for 1:59.*

---

## PART 2: Demo (in the app, no narration needed)

The app plays its own narrated tour (AI voice-over, subtitles, spotlight). It shows: 6,800 copies short; the agent working (Read, Find, Compare, Rules, Draft, Decide); the supply map and transport options; 36,000 cards on hold at Boise; the what-if slider; the escalation and email approval steps; launch tracking.

If the app or the sound fails: close the browser and play `Launch-Control-demo.mp4` from the Desktop (same content, works offline).

---

## PART 3: Tech and close (Nico, 2:41 - 3:00)

*When the end card shows, switch to slide 7.*

> "So how does it work? (pause)
> The AI reads the files and recommends. Plain code does every calculation and checks every number the AI writes.
> It can't send, pay or book. A human approves.
> Hosting, GDPR and access controls are our roadmap for enterprises.
> Launch Control. (pause) Find out at the DESK... not at the dock."

*Switch to slide 10 and stay on it for questions.*

**Timing:** about 125 words, roughly 50 seconds of speaking, plus 1:59 of demo and two one-second switches: about 2:55 to 3:00. If you run over, cut "That's our hypothesis." first, then "Hosting, GDPR and access controls are our roadmap for enterprises."

---

## What we corrected from the German draft (so we only say true things)

- "Nobody noticed in time" is gone: our agent DID find the shortage before the launch.
- "Tracks the situation from problem detection to resolution" became "from problem found to reply reviewed": we do not claim resolution.
- Pricing, financing, pilots, EU hosting and GDPR are always "our idea / our roadmap", never "we have". Today the app runs locally and is not deployed.
- We never say we interviewed Soony staff (we did not do the office-hours interviews). "We find out at the dock" is quoted from Soony's kickoff notes.

---

## Q&A (2 minutes): short answers in plain English

### Business
**Why would Soony pay, and how much?**
In launch week, a day of phone calls and spreadsheet checks costs packing hours, and this one shortage is about €80,920 of product cost (at cost, not price). Our agent also found an option nobody had checked: 36,000 cards on hold at Boise. Soony's policy lets a category lead approve up to €200,000 a month of emergency air freight, so a fee well below one rush shipment is an easy yes. That price is a hypothesis we would test in a paid pilot.

**What is the business model?**
B2B SaaS. A recurring subscription based on projects, users and documents processed, plus an integration fee for large enterprises. We would start with paid pilots and measure time saved, risks found earlier and decisions accelerated.

**How do you finance it?**
Revenue-first: pilots validate willingness to pay and fund development. Our main costs are cloud, AI processing and customer integrations. We have no revenue or customers yet.

**Who else has this problem?**
Any company with a fixed launch date and a product made from several suppliers' parts: consumer electronics, retail, manufacturing, subscription boxes. That is our reasoning, tested on one customer dataset, not a market-size claim.

**Why now?**
The pain peaks in launch week, teams still work from emails, PDFs and spreadsheets, and AI agents can finally read all of that and act under human control.

**Who are the competitors?**
Dashboards on top of spreadsheets, ERP alerts and generic AI chat tools. They show data or answer questions. Ours finds contradictions across documents, prices the options, routes the decision to the right approver and drafts the messages, with a human in control.

### Tech and trust
**Is anything hardcoded?**
No business numbers are in the code. Quantities, stock, priorities and approvers are read from the files. Prices are labelled estimates, and unknown values say "unknown".

**What if the AI is wrong?**
It cannot send, pay, book or approve: those actions do not exist for it. Code checks every number in a draft, and a wrong number is replaced. A named person approves in two steps, and approval is cancelled if the data changes.

**What does the agent actually do?**
The model chooses among 15 read-only tools over several steps: read the case, find supplier holds and conflicting records, compare transport, price options, check the approval policy, draft the messages. If the model is unavailable, a labelled rule-based mode runs.

**What happens when new data arrives?**
The portal sync detects changed files, the numbers are recomputed, and approvals tied to old data are voided. The agent can run again.

**Why can't a faster flight fix it?**
We compared air, sea and road. Even air arrives about four days late by our stated assumptions, so the real lever is the cards on hold at Boise.

**Security, GDPR and hosting?**
Today: named approvals, number checks, a privacy layer so the browser never receives source documents, an optional access-code login, and no customer data in the repository. The app runs locally and is not deployed. For enterprises we would add EU-based hosting, GDPR-compliant data handling, roles and SSO, and an exportable audit trail. Those are roadmap, not done.

**What was the hardest part?**
Messy, contradictory data: ten places where Soony's own records disagree. We show both sides, pick the newest and say how sure we are.

### Show it live
Before your slot, open the app. In the question round, switch to it and drag the what-if slider once: "If the parts land sooner, how many copies still ship?" That is a fresh, live action.

---

## Extra lines (only if you are given more than 3 minutes)

- **After slide 5 (business model):** "We'd measure three things in a pilot: time saved per decision, risks found before the dock, decisions accelerated."
- **After the demo (tech):** "Our six steps are Read, Find, Compare, Apply rules, Draft, Decide. The AI handles reading and recommending; the business rules and the maths are deterministic code."
- **Closing:** "Launch Control doesn't replace decision-makers. It gives them the right information, before it's too late."
