# Demo audit (22 Nov 2026)

Scope: the 10-scene narrated demo (problem, parts, agent, map, transport, decision, escalation, email, tracking, close) against the product UI in `frontend/src`. Criteria are the four judging criteria in docs/SUBMISSION.md and docs/DECK.md: **Pitch** (pitch that sticks), **Business** (real business case), **Depth** (technical depth: agents do real work, nothing hardcoded, copes with new data, explains when wrong), **Taste** (real product, one recommendation, one click).

## What changed in this pass
- Anchors: `data-demo="escalation"` and `data-demo="email"` wrap the two drafts in the Details sheet Messages tab (test ids `draft-escalation`, `draft-supplier` kept). New spare anchors: `data-demo="whatif"` (page slider and the Numbers tab input) and `data-demo="conflicts"` (Numbers tab, "Records that disagree").
- `Demo.tsx`: a scene whose target sits inside the sheet keeps the sheet open (escalation to email), a page target closes it. Before, a visible in-sheet target hit the `else closeSheet()` branch and would have closed the sheet between the two scenes. While a sheet scene plays, the player moves to the left edge (the sheet owns the right edge).
- `ui/sheet.tsx` got a `modal` prop. `DetailsSheet` passes `modal={!ui.demoOpen}`: during the demo the sheet has no focus trap, no body `pointer-events: none`, no dimmed overlay, and ignores outside clicks, so the player stays usable. Outside the demo nothing changes.
- New `components/ApprovalPreview.tsx`: inert strip labelled "Preview" under each draft, only while its scene plays. Escalation: Read it, Type your name (placeholder "Your name"), Approve lights up. Email: Send from your own inbox, Reply comes back as a file, Review. Beats are thirds of `useDemoReplay`. `role="img"` with a label, no buttons, inputs or focus targets, never calls approve, send or import, the same whether or not the case is approved or sent, transitions are `motion-safe:` only.

## Audit table

| Feature | In demo? | Why it matters | Proposed fix |
|---|---|---|---|
| Problem and shortage (6,800) | yes (problem, parts) | Pitch: understood in 30 s | none |
| Agent doing real work (reads, finds, compares, drafts) | yes (agent) | Depth: "agents do real work" | none |
| Supply map, air vs sea | yes (map) | Taste, Pitch | none |
| Transport estimates labelled "est." | yes (transport, one clause) | Depth and honesty: costs are not in the data | none; keep the clause |
| Boise hold (36,000 packed cards, PO vs agreement) | partly (decision: spoken, but the spotlight is the decision card, not the amber hold note) | Business and Depth: the biggest finding, 5.3x the gap | Extra scene B below, or spotlight `[data-demo="hold"]` in the decision scene |
| Approval-policy routing (who approves what) | partly (named Vogt in decision, escalation) | Depth: nothing hardcoded, approver comes from Soony's own policy | One clause in the extra scene or spotlight the approver chip; no new scene needed |
| Escalation approval (read, name, approve) | yes (new, preview only) | Depth and Taste: human in charge | done |
| Supplier email, send by hand, reply as file, review | yes (new, preview only) | Depth, Taste | done |
| What-if slider (parts arrive in N hours) | no | Business and Taste: the interactive moment; judges like to touch it | Extra scene A below. Anchor `data-demo="whatif"` added |
| 10 conflicting records | no (only the word "conflicts" in the agent scene) | Depth: messy contradictory data is a named criterion; Pitch: slide 2 line | Extra scene (needs `sheetTab: numbers`, anchor `data-demo="conflicts"` added) or fold into scene B. UI shows only the first 8 |
| Estimates labelled | partly (spoken in transport) | Honesty | none |
| Packing hours bar and per-edition strips | no | Business: packing capacity is part of "will it ship" | Include in what-if scene (strips move with the slider) |
| Reply import (.eml) and offer review | partly (spoken in email scene, shown as preview) | Depth: reply is reviewed by a person before any number changes | Fine as is. Real `ImportReply` only exists in the "sent" card state, so it cannot be spotlighted on a fresh case |
| Print one-page brief | no | Taste: leaves something on paper for the room | Not worth voice time. Mention in the deck or pitch; Brief tab has the button |
| Case switcher (art books, statue, magnets) | no | Business: works beyond one problem; "works beyond one launch" | Parts list is on screen in the parts scene. Optionally one clause: "Same agent, every short part" |
| Data sync and new data drops ("the world keeps moving") | no | Depth: "copes with new drops" is a named criterion; approvals voided on new evidence | Strongest missing story. Needs a safe visual: spotlight the Health tab "Checked hh:mm" plus Sync (do NOT press Sync). Not proposed as a scene because it needs a new anchor and a claim the UI only partly shows (see Product gaps 4) |
| Launch tracking | yes (tracking) | Taste | none |
| Honesty guard (narration recorded for 6,800 / 36,000) | yes (player note) | Depth: explains when wrong | none |

## Product gaps

| # | Gap | Severity | Note |
|---|---|---|---|
| 1 | The narration says "First, the escalation ... Then the email to Boise". In the product the escalation button (`approve-escalation`) appears only after the supplier email is approved (`supplierApproved && !esc.approved`), and the main card's first action is the supplier approval. So the real order is email first, then escalation. | Medium | The preview is order-agnostic so nothing on screen is false, but a judge who then clicks through will see the opposite order. Either swap the two scenes in the script (email, then escalation) or say "two approvals" without ordering words. Lead decides; I did not touch the voice files |
| 2 | On a phone the sheet is full width and the player sits at the bottom, so it can cover part of the spotlighted draft and the Preview strip. The left-edge move only applies at `sm` and up. | Medium (only if the demo is shown on a phone) | Present from a laptop. Fix later by docking the player at the top for sheet scenes at narrow width |
| 3 | The scene needs `d.escalation` and `d.case.draft`. If the agent has not drafted (or the case has no escalation), the sheet opens with no spotlight and no Preview. | Low | Demo case has both. The narration mismatch note already covers other data |
| 4 | "Copes with new data drops" is claimed in docs but there is no UI that shows a drop being detected or an approval being voided; Health shows only "Checked hh:mm" and the Sync button. | Medium for the Depth criterion | Cannot be demoed honestly in the UI today. Say it verbally or add a small "What changed" line later |
| 5 | The 10 conflicts exist, but the UI lists only the first 8 (public projection) and only inside Details > Numbers. | Low | Matches the deck footnote. Consider a count badge on the main page |
| 6 | `ImportReply` is reachable only in the "sent" card state; the offer-review form is only in the Offer tab once a reply exists. A fresh case has no way to show either. | Low | Preview strip covers it in the demo |
| 7 | docs/STATUS.md "Narrated demo" still says nine scenes, voice coral, narration 117 s. Manifest now has 10 scenes, voice marin, 104.5 s narration, about 1:48 with gaps. | Low | Update STATUS when the lead finalises the script |
| 8 | Two what-if controls (page slider, Numbers tab input) share one state and both carry `data-demo="whatif"`; `visible()` picks the first visible one, which is the page slider unless the sheet is open. | Low | Intended |
| 9 | Fixed in this pass: the demo could close the sheet between two sheet scenes, and the modal sheet trapped focus away from the player. | was Medium | See "What changed" |

## Proposed extra scenes

Both are at most 35 words, ready to paste into `SCENES` in scripts/make_demo_voice.py. Not added to the manifest. Insert A after "transport" (or after "decision"), B after "decision". Adding either needs a regenerated manifest, and the `allowed` list in Demo.test.tsx must gain the new selector.

**A. What-if (page, no sheet)**
```python
    ("whatif", '[data-demo="whatif"]', None, "What if parts arrive sooner?",
     "Now drag the slider. If the parts land in twelve hours, how many copies still ship? It's a calculation, not a guess, and the packing bars move with it. Try it."),
```
- Words: 31. Selector: `[data-demo="whatif"]` (anchor added in `Packing.tsx` `WhatIfControl`). sheetTab: None.
- UI support: none needed to spotlight it. Optional: a replay that sweeps the slider using `useDemoReplay('whatif')`. Caution: the slider writes real what-if state (`POST` simulation), so a replay must be visual only, not call `setHours`. Without a replay the narration ("drag the slider") is fine, because the player does not touch it.
- Note: "twelve hours" is a narrated example, not data. If the live default differs, say "if the parts land sooner".

**B. Hold and conflicts (sheet, Numbers tab)**
```python
    ("conflicts", '[data-demo="conflicts"]', 'numbers', "Records that disagree",
     "Why trust it? Ten places where Soony's own records disagree, like the order and Boise's agreement. The agent shows both sides, picks the newest, and says how sure it is."),
```
- Words: 31. Selector: `[data-demo="conflicts"]` (anchor added in `DetailsSheet.tsx`, Numbers tab). sheetTab: `numbers`.
- UI support: the sheet opens on the Numbers tab with the existing logic; the player moves left. The UI lists the first 8 conflicts, so say "Ten places" only because docs and the deck say 10 on current data; if the dataset changes, the narration is stale (same class of risk as the 6,800 note). Safer wording: "Places where Soony's own records disagree". The claim "picks the newest" matches the "newest file wins" rule in docs/DECK.md.
- If the scene count changes, update the `toHaveLength` and `+ N * GAP_MS` assertions in Demo.test.tsx.
