# Deploying Lio for the hand-in (free)

Deadline: Sunday 22 Nov 2026 12:00. Platform facts below were checked against the vendors' docs on 21 Nov 2026.

## Rules for every hosted copy

- **No customer data in git or in the image.** `.dockerignore` excludes `data/`, `.analysis/`, `.local/` and `.env*`. At startup the container downloads the files from the portal into `/tmp/lio/data` using `LIO_PORTAL_TOKEN`.
- **`LIO_ACCESS_CODE` is required.** The challenge data must stay inside the team. If `LIO_ALLOWED_HOSTS` is set without an access code, the app refuses to start (`app/main.py` lifespan). Use a long random code and share it only with the team and judges.
- **`LIO_EMAIL_ENABLED=false`, and no `SMTP_*` or `IMAP_*` variables.** Render's free tier also blocks outbound ports 25, 465 and 587.
- **Never set `LIO_EXPOSE_SOURCES`.**
- **Run one worker.** The Dockerfile starts exactly one uvicorn process, because the login limiter and agent status live in memory. Do not add `--workers`.
- **Disk is ephemeral.** The SQLite state in `LIO_STATE_DIR` (`/tmp/lio/state`) is wiped on every restart, redeploy and free-tier spin-down. After a restart:
  - approvals, drafts, case notes and agent history are gone;
  - everyone must log in again (cookies are signed with a per-process salt);
  - the portal data re-syncs on its own at startup.
  
  For the demo, do the approval flow live in one session. Do not prepare it hours in advance.
- **The AI uses OpenAI.** The Claude CLI backend is not in the image, so set `OPENAI_API_KEY` and `LIO_AI_MODEL`. Without them the app still works, using the rule-based fallback.

## Before either option: push the code

The latest code is on branch `codex/launch-rescue-mvp`, and it has **not been pushed yet**. Push it to `github.com/missharismitha/lio-launch-rescue` (private). Then check on GitHub that the branch contains `Dockerfile`, `render.yaml` and `app/static/`, and contains no `data/`, `.env` or `.local/`.

## 1. Recommended: Render free web service

Verified on render.com/docs/free:
- Free web services spin down after **15 min** with no inbound traffic and take **about 1 min** to spin back up.
- The free allowance is 750 instance-hours per workspace per month.
- Free services run a single instance, have no persistent disk, and may be restarted at any time.
- `PORT` defaults to 10000; the Dockerfile reads `${PORT}`.

Not verified (check on the Render pricing page): free instance RAM/CPU (believed 512 MB / 0.1 CPU) and whether sign-up asks for a card.

### Option A: Blueprint (uses `render.yaml`)

1. Sign up at dashboard.render.com with GitHub. When asked, grant the Render GitHub App access to `missharismitha/lio-launch-rescue`. You can also do this later under Account settings > GitHub > Configure, then "Only select repositories". The repo is private, so without this grant Render cannot see it.
2. Click **New > Blueprint**, pick the repo, and set the branch to **`codex/launch-rescue-mvp`**.
3. Render reads `render.yaml`: service `lio-launch-control`, Docker, `plan: free`, health check `/api/health`, `LIO_EMAIL_ENABLED=false`, `LIO_AI_MODEL=gpt-5.5`. If `LIO_AI_MODEL` should differ, change it to the model name in the local `.env`.
4. Render then asks for each `sync: false` value:
   - `LIO_PORTAL_TOKEN`: the portal token
   - `OPENAI_API_KEY`: the OpenAI key
   - `LIO_ACCESS_CODE`: a long random code
   - `LIO_ALLOWED_HOSTS`: `lio-launch-control.onrender.com`. If the name is taken, Render adds a suffix. Use the exact host shown on the service page, without `https://` and without a trailing slash.
5. Click **Apply**. Wait for the build and the "Live" status.
6. If you guessed the host wrong in step 4, requests return "Invalid host header". Fix it under service > **Environment**, then save. Render redeploys.

### Option B: manual web service (if the Blueprint fails)

1. **New > Web Service**, then **Git Provider**. Pick the repo and branch `codex/launch-rescue-mvp`.
2. Runtime: **Docker** (detected from `Dockerfile`). Instance type: **Free**. Region: **Frankfurt**, which is close to the portal in West Europe.
3. Under **Advanced**, set the health check path to `/api/health`. Add these variables:
   - `LIO_PORTAL_TOKEN`
   - `OPENAI_API_KEY`
   - `LIO_AI_MODEL`
   - `LIO_ACCESS_CODE`
   - `LIO_EMAIL_ENABLED=false`
   - `LIO_ALLOWED_HOSTS=<service>.onrender.com`
4. Click **Create Web Service**.

### Cold start and pre-warm

- The first request after 15 idle minutes waits about 1 min, plus the startup portal sync (the disk is wiped, so all data is downloaded again; the app starts this at boot).
- **Pre-warm 5 min before the demo:**
  1. Open `https://<service>.onrender.com/api/health` and wait for `{"status":"ok","data_present":true}`.
  2. Log in and load the overview once.
  3. Keep the tab open, or reload any page every few minutes, until you present.
- A pre-warm does not bring back approvals or drafts if the service has spun down since they were made (ephemeral disk). Make them during the demo.
- Do not set up an always-on pinger. It burns the 750 free hours and is unnecessary for one demo.

## 2. Hugging Face Spaces: NOT a free fallback any more

Current HF docs (huggingface.co/docs/hub/spaces-overview) say:
- "Gradio and Docker Spaces run on compute and require a paid plan to create" (PRO for personal accounts). Only Static Spaces are free.
- A **private** Space's app is reachable only by the owner and collaborators. Everyone else gets a 404, so judges without HF accounts on the Space could not open it.

So HF does not meet the brief (free and private). If someone on the team already has PRO:
- Create a Space: SDK **Docker**, visibility **Private**.
- Push the repo contents to it, with a README YAML header of `sdk: docker` and `app_port: 7860`.
- In Space Settings, add a **Variable** `PORT=7860` (Docker Spaces do not set `PORT`; the default exposed port is 7860).
- Add **Secrets**: `LIO_PORTAL_TOKEN`, `OPENAI_API_KEY`, `LIO_ACCESS_CODE`.
- Add **Variables**: `LIO_AI_MODEL`, `LIO_EMAIL_ENABLED=false`, `LIO_ALLOWED_HOSTS=<owner>-<space>.hf.space`.

The container runs as uid 1000; `/tmp/lio` is writable. Free CPU Basic Spaces sleep when unused and the disk is not persistent. Open the app at the direct `https://<owner>-<space>.hf.space` URL, not the huggingface.co page: the app sends `X-Frame-Options: DENY`, so the embedded iframe stays blank. This path is untested.

**Free second fallback instead: a Cloudflare Quick Tunnel to the laptop.** Per developers.cloudflare.com (trycloudflare):
- No account is needed.
- The URL is a `trycloudflare.com` hostname that changes on every start.
- The limit is 200 in-flight requests, with no uptime guarantee.
- Server-Sent Events are not supported. Lio does not use them.

Steps:
1. Run `cloudflared tunnel --url http://localhost:8000` and note the hostname it prints.
2. Start the app with `LIO_ACCESS_CODE` set and `LIO_ALLOWED_HOSTS=<that-host>.trycloudflare.com`.
3. Start uvicorn on `127.0.0.1:8000` with `--proxy-headers --forwarded-allow-ips='*'` (see README "Privacy and access").

The laptop must stay awake and online.

## 3. Smoke test after deploy

1. `GET /api/health` returns `200 {"status":"ok","data_present":true}`. On a fresh or restarted instance `data_present` stays false while the first portal sync downloads about 52 MB (it starts immediately at boot; about 4 minutes in our laptop test); other pages may hang until it finishes. Pre-warm at least 10 minutes before the demo. If it is still false after 5 minutes, the sync failed: check `LIO_PORTAL_TOKEN` and the logs.
2. Without logging in:
   - `/` redirects to `/login`;
   - `GET /api/overview` returns `401`;
   - `GET /api/evidence...` is not available.
3. Log in with the access code. A wrong code shows "That code is wrong."
4. The overview loads with issues and a recent sync time, and the integrations show the portal enabled and **email disabled**. AI shows enabled if the OpenAI variables are set.
5. Click **Run agent**. It must finish, either with the model or with the rule-based fallback. Open one issue's Details drawer.
6. Confirm that no email was sent:
   - the UI shows email disabled;
   - nothing in the logs mentions SMTP;
   - no `SMTP_*` variables are set.
7. Log out. Then reloading `/` goes back to `/login`.
8. Check the logs for errors, and confirm no customer file contents are printed.

## 4. Demo-day fallback: run on the laptop

Use this if the hosted copy is down, slow or out of free hours. On the laptop, in the repo, with the existing `.env` (it already holds the token and AI settings):

```
.\.venv\Scripts\python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 8000
```

1. Open http://127.0.0.1:8000. With no `LIO_ACCESS_CODE` and loopback only, there is no login.
2. Wait for the first portal sync. Then run the smoke test from step 4 onward.
3. Keep `LIO_EMAIL_ENABLED=false`.
4. Present from the laptop screen. Do not bind to `0.0.0.0` on venue Wi-Fi. If the room needs a URL, use the Cloudflare tunnel above with an access code.
5. Test this once on Saturday evening, offline from Render, so the demo does not depend on hosting.
