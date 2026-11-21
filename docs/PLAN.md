# Build plan

## Milestone 1: Local evidence-to-inquiry workflow
- [x] Load launch requirements, stock, BOM, POs and receipts.
- [x] Parse supplier short shipment and reconcile quantities by identifiers.
- [x] Show game-card risk/evidence in browser.
- [x] Secondary art-book, quality and BOM cases with uncertainty.
- [x] Persist drafts, named inquiry approvals and audit events.
- [x] Invalidate approval on changed evidence; guard duplicate sends.
- [x] Connect portal polling and show failure state.
- [x] Optional tool-using model investigation (live verification pending credentials).
- [x] Synthetic tests and real snapshot browser smoke check.

## Milestone 2: Complete agent interaction
- [ ] Configure model key/name locally and verify real investigation/tool provenance.
- [ ] Verify supplier inboxes; register sender in portal Settings.
- [ ] Connect transport, explicitly approve one availability inquiry and verify delivery.
- [x] Implement read-only inbox/EML ingestion, sender-header/case checks and deduplication. Attachments require separate review; no automatic attachment claims.
- [x] Extract strictly labelled reply fields as proposed facts; human review calculates a scenario without changing warehouse stock.
- [x] Recompute a reviewed offer scenario; synthetic end-to-end tests pass. Live supplier response still needs configured transport.

## Milestone 3: Feasibility and hand-in
- [ ] Confirm current packing progress, allocation priorities, arrival and dock slots with Soony.
- [ ] Evaluate recovery against remaining shifts and overlapping component constraints.
- [ ] Add human-reviewed vision extraction if it improves the demo.
- [ ] Add authentication before shared deployment.
- [ ] Deploy to an appropriate authenticated Python host.
- [ ] Prepare three-minute pitch, backup video and live rehearsal.

Never hardcode outcomes or invent supplier availability. If no rescue exists, present evidence-backed allocation/escalation.
