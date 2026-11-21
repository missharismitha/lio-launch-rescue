# Morning checklist (hand-in: Sunday 22 Nov, 12:00; demos from 14:00)

Everything below is ordered by what blocks the hand-in. Tick as you go. Items marked YOU cannot be done by an assistant.

## 1. Check the app runs (5 min)
- Open http://127.0.0.1:8000. If it is not running, start it from `C:\Users\ASUS\Documents\ChatGPT\Lio 3` in PowerShell, with the mailbox settings blanked for this run:
  ```
  $env:IMAP_HOST=''; $env:IMAP_USERNAME=''; $env:IMAP_PASSWORD=''; $env:SMTP_HOST=''; $env:SMTP_USERNAME=''; $env:SMTP_PASSWORD=''; $env:SMTP_FROM=''
  python -m uvicorn app.main:app --host 127.0.0.1 --port 8000
  ```
- Click Run agent and wait about 30 s. Expect: recommendation to release the Boise hold, Transport options showing no mode makes Sunday for the game cards, drafts short, nothing sent.
- `.env` still holds a Gmail password that is NOT a valid app password. The inbox checker now stops after one rejected login, but fix or remove the `IMAP_*` / `SMTP_*` lines anyway. Keep `LIO_EMAIL_ENABLED=false`.

## 2. Register the sender (YOU, 2 min)
Lio portal, Settings, add `liohackathon@gmail.com` as a sender address. Suppliers only reply to registered senders.

## 3. Optional, only if time: office hours (YOU)
Ask Dr. Vogt: what a missing copy costs, who signs air freight. Ask Felix Brunner: where the lid magnets come from, which parts have one source. Write the quote down verbatim. Add it to the commented block on slide 2 of `docs/deck/deck.html`, then re-export (command in `docs/deck/README.md`). If there is no interview, leave the deck as it is.

## 4. If you want a real supplier reply (YOU, optional)
Approve the supplier message in the app, click Send it yourself, copy address, subject and message into Gmail (as liohackathon) and send. Keep the subject exactly, including the `[Lio ...]` tag. Click "I sent it". When a reply arrives, in Gmail choose three dots, Download message, then use Import a reply. Do not claim a reply in the pitch unless one really arrived.

## 5. Record the video (YOU, 20 min)
Follow `docs/VIDEO.md`. Under 3:00. Mask nothing private on screen; do not open the portal, `.env` or Gmail while recording. Play it once to check.

## 6. Push the code and submit (YOU, 10 min)
- The work is committed locally on branch `codex/launch-rescue-mvp`; nothing is pushed. To push: `git push origin codex/launch-rescue-mvp` (private repo `missharismitha/lio-launch-rescue`). Check `git status` is clean first; `.env`, `data/`, `.analysis/` and `.local/` are ignored.
- Upload before 12:00: deck PDF (`docs/deck/Launch-Control-deck.pdf`), video, repo link, README. The brief asks for a deployed prototype if possible; `docs/DEPLOY.md` has the free Render route, but hosting uploads Soony's data to a third party and the live demo works locally, so decide deliberately. The deployed copy needs `LIO_ACCESS_CODE`.

## 7. Before the 14:00 demo
- Start the app 10 min early, run the agent once, keep the video on the Desktop (opens in under 10 s).
- Do not say anything on the "Do not say" list in `docs/DECK.md`. Freight figures are estimates; email is sent by a person; one customer dataset.
