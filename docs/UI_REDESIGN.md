# UI redesign brief (22 Nov 2026)

The operator's words: "this looks like a pdf with a lot of text, not like a website". Use the product images from the shared documents. Map the transport. Make the agent interactive, not a button, and show the steps it is doing, with few words. Everything straight to the point and visually appealing, colours not just black and white. Add a workflow section that looks like Amazon package tracking. Make no mistakes.

## Principles
1. **Product, not a report.** Image-led hero, live motion where it explains something, big numbers, short labels. A paragraph is a failure: max one short line of body text per block.
2. **Show, don't tell.** The agent shows its steps as they happen. The map shows where parts are. The tracker shows where the launch is.
3. **Colour has meaning.** Brand blue = actions and progress. Soony red = the problem. Green = confirmed. Amber = needs attention. Transport modes: air cyan, sea blue (dashed), road orange (dotted). Never colour alone: pair with an icon, a word or a pattern.
4. **Honesty stays.** Every estimate says "est.". Unknown stays "unknown". Nothing claims delivery. Email is sent by a person. Approval flow, privacy rules and every behaviour already tested must keep working.
5. **Same product everywhere.** One radius (16 px cards, 10 px controls), one shadow (`--shadow-card`), one type scale, one icon set (lucide-react).

## Palette (tokens already in `frontend/src/index.css`, use semantic classes)
page `#F5F7FB`, card white, ink `#101828`, ink-2 `#475467`, ink-3 `#667085`, line `#E4E7EC`. Brand blue `#1F4FD8` (deep `#17389E`, navy `#0B1F5C`, tint `#EEF3FF`, 100 `#DCE6FF`). Accent/Soony red `#D9381E` (tint `#FDECE8`). Risk `#B42318`, ok `#12805C` (tint `#E4F5EE`), warn `#B54708` (tint `#FFF4E5`). Modes: air `#0891B2`, sea `#2B4FD4`, road `#C2410C` (validated colour-blind-safe as a set). **No purple, violet or periwinkle anywhere** (a test scans the built bundle for those). AA contrast for text. Hero uses a navy to deep-blue gradient with white text.

## Assets (already optimised in `frontend/public/img/`, served from `/img/...`, same-origin so the CSP allows them)
- `soony-logo.png` (blue and red logo, transparent: use on WHITE or light backgrounds only)
- `box-standard.png` (Standard Edition disc case art), `box-collectors.png` (Collector's Edition box art), both transparent
- `bom-collectors.webp` (what goes in the Collector's box: card, steel case, collector's box, art book, map poster, statue, leaflet), `bom-standard.webp` (Standard parts). Their captions are WHITE text: always place them on a dark navy panel.
These come from the organiser's brief and deep-dive slides. Do not use staff avatars or photos. Add meaningful `alt` text.

## Page layout (top to bottom)
1. **Top bar** (white): Soony logo, "Launch Control", live countdown to launch (Sun 20:00, from `overview.launch_date`, Europe/Berlin), small data-status dot.
2. **Hero** (navy gradient): the one headline number ("6,800 short"), one line of status, one primary action. Right side: both product boxes with a packing progress ring each (packed/target, from `overview.products`).
3. **Agent live** (full width): the agent's steps appear as it works.
4. **Launch tracking** (full width): Amazon-style package tracking of the workflow.
5. **Decision and options**: recommendation, approval, what-if, parts that are short (with the BOM image on a navy panel).
6. **Transport map** (full width) with the lane list below.
7. Details sheet, print brief, demo overlay: keep, restyle.

## Ownership (do not edit files you do not own; the lead merges)
| Agent | Owns | May touch |
|---|---|---|
| Shell | `App.tsx`, `index.css`, `Header.tsx`, new `Hero.tsx`, `Parts.tsx`, `DecisionCard`, `OfferCard`, `Options`, `Packing`, `States`, `ApprovalFlow`, `ManualSend`, `DetailsSheet`, `PrintBrief`, `Demo`, `ui/*`, existing tests they affect | imports of the three slot components |
| Map | `TransportMap.tsx`, new `map/*`, `Transport.tsx` (restyle the lane list only), its tests; `npm install` for map libraries (ONLY this agent runs npm install) | `lib/types.ts` (append only) |
| Live agent | `AgentLive.tsx`, `AgentRail.tsx`, `hooks/useLaunch.tsx` (agent additions only), new `lib/agentSteps.ts`, tests | `lib/types.ts` (append only) |
| Workflow | `WorkflowTracker.tsx`, new `lib/workflow.ts`, tests | `lib/types.ts` (append only) |
| Backend | `app/` and `tests/` only | nothing under `frontend/` |

## Rules for everyone
- Do NOT run `npm run build` (the lead builds once at the end; concurrent builds corrupt `app/static`). Verify with `npx tsc --noEmit` and `npx vitest run` from `frontend/`.
- Do NOT `git add`, commit or push. Do not read `.env`.
- No new dependencies except the map libraries (Map agent only). No external network requests at runtime (CSP is `default-src 'self'`): no CDN, no map tiles, no web fonts.
- Honour `prefers-reduced-motion` (MotionConfig is set at the root; CSS animations need the media query).
- Keyboard and screen-reader friendly: real buttons, focus rings, `aria-live="polite"` for live updates, alt text.
- Works at 390 px and 1280 px, no horizontal scroll.
- Wording: fragments, verbs, numbers. No sentence over ~12 words in primary views. No emoji.
- Existing behaviour and tests must keep passing; update tests only where the visible wording legitimately changes, and say so.
- Types in `lib/types.ts`: treat every field as optional; render nothing rather than crash.

## Backend data contract: `map` on `GET /api/overview`
`{as_of, deadline, hub:{name,lat,lon}, suppliers:[{id,name,country,lat,lon,category}], ports:[{code,name,lat,lon,mode}], routes:[{id,mode,origin,destination,via,transit_days}], shipments:[{id,supplier_id,mode,status,origin,destination,lat,lon,eta,etd,late,material}]}` (see `MapData` in `lib/types.ts`). Never expose container or air waybill numbers, PO numbers, carrier ids, addresses, e-mail, file names or paths. Shipment ids are opaque.
