# Demo video: 3 minutes maximum

Record the live app (http://127.0.0.1:8000) with a voice-over. The video is the backup if Wi-Fi fails, and part of the hand-in (deadline Sunday 12:00).

## Fastest path: record the built-in narrated demo
The app has a voice-over demo (AI voice, nine scenes, about 2:00). Start the app, open http://127.0.0.1:8000, click **Watch demo**, then **Play**. The tour scrolls to each section, spotlights it, shows subtitles and speaks. Press Win+G, start a recording of the browser window with audio on (or use OBS with desktop audio), play the whole tour once, and stop. That is already a complete, in-time video (under 3:00). Add your own intro or outro only if you want one.
Voice-over script and audio: `scripts/make_demo_voice.py` (regenerates the mp3 files and `frontend/src/lib/demoManifest.json`; edit the scene texts there, then run it).

## Record
- Windows: press Win+G (Xbox Game Bar), click Record, or use OBS Studio. Record the browser window only.
- Browser at 1280 px wide, zoom 100 percent, address bar visible only if it shows `127.0.0.1:8000`. No other tabs, no email, no Notepad with `.env`.
- Do not show customer files, file names, excerpts, supplier email addresses, the portal token or any password. The app already hides these; do not open the portal or Gmail on screen.
- Say "estimate" whenever a freight figure is on screen. Say "a person sends it" about email.

## Before you press record
1. Start the app with the mailbox checker off (blank `IMAP_*` / `SMTP_*` in the shell, or comment them out in `.env`).
2. Click Run agent once and wait about 30 seconds so the screen shows a finished run. Or start it during the intro.
3. Close the Details sheet. Reload so you start at the top.
4. Rehearse once with a timer. Aim for 2:45, so there is slack.

## Shot list (matches docs/DECK.md; speak in your own words)
| Time | On screen | Say |
|---|---|---|
| 0:00 to 0:20 | Deck slide 1, or the first app screen | Soony's sheet says game cards are fine. The records say 6,800 Standard copies short. Trucks leave Sunday 20:00. |
| 0:20 to 0:40 | The decision card and the packing hours bar | One recommendation, one decision. 23 hours left, and the Collector's edition needs 21 of them. |
| 0:40 to 1:05 | Agent timeline | The model chooses its own tools: it read the case, found a supplier hold, found conflicting records, compared transport, priced the option and drafted the messages. It can't send, pay or book. |
| 1:05 to 1:30 | Transport options | We compared air, sea and road against Sunday 20:00. For the game cards none makes it; air is about 3.7 days late. Costs here are estimates from market rates. |
| 1:30 to 1:55 | Options and the Boise hold | 36,000 cards sit on hold at a supplier dock because the order terms and the supplier's agreement disagree. That is 5.3 times the gap. Arrival is unknown, and the app says so. |
| 1:55 to 2:25 | Supplier message, escalation, approval | Short drafts. Terms change goes to the Head of Procurement, freight to the Category Lead. A named person approves. Nothing is sent by the app; a person sends it from their own mailbox. |
| 2:25 to 2:40 | Print brief or the Details sheet | The CPO gets one page, not forty dashboards. |
| 2:40 to 3:00 | Deck slides 5 and 6 | 6,800 copies, EUR 80,920 of product cost at stake, counted at cost. Works for any launch with a fixed date and a kit from several suppliers. Tested on one customer dataset. |

## After
- Export as MP4, keep it under 3:00, and play it once from the start to check sound and that nothing private appears.
- Put a copy on the Desktop so it opens in under 10 seconds on stage.
- Do not say: the contents of the "Do not say" list in docs/DECK.md.
