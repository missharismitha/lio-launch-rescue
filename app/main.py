"""Local-only HTTP service. Start with python -m uvicorn app.main:app."""
import asyncio
import hashlib
from contextlib import asynccontextmanager
from email.message import EmailMessage
import json
import os
from pathlib import Path
import smtplib
import ssl
import threading

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from starlette.middleware.trustedhost import TrustedHostMiddleware
from pydantic import BaseModel, Field

from app import config
from app.engine import analyze
from app.store import Store, fingerprint
from app.sync import PortalSync, safe_path, now
from app import investigator

lock = threading.RLock()
store = Store(config.STATE_DIR / 'cases.sqlite3')
portal = PortalSync(config.DATA_DIR, config.STATE_DIR, config.PORTAL_TOKEN)
snapshot = {}


def refresh(sync=False):
    global snapshot
    with lock:
        if sync:
            portal.run()
        result = analyze(config.DATA_DIR)
        result['analyzed_at'] = now()
        for issue in result.get('issues', []):
            for source in issue.get('evidence', []):
                try:
                    file = safe_path(config.DATA_DIR, source['path'])
                    source['sha256'] = hashlib.sha256(file.read_bytes()).hexdigest()
                except (OSError, ValueError):
                    source['sha256'] = None
        snapshot = result
        for issue in result.get('issues', []):
            store.get(issue)
        return overview()


def overview():
    result = dict(snapshot)
    result['sync'] = portal.status.copy()
    result['integrations'] = config.integrations()
    return result


def issue_detail(issue_id):
    issue = next((i for i in snapshot.get('issues', []) if i['id'] == issue_id), None)
    if issue is None:
        raise HTTPException(404, 'Issue not found in current evidence')
    return {**issue, 'case': store.get(issue), 'events': store.events(issue_id),
            'integrations': config.integrations()}


async def poll():
    while True:
        await asyncio.sleep(config.POLL_SECONDS)
        try:
            await asyncio.to_thread(refresh, bool(config.PORTAL_TOKEN))
        except Exception:
            # Never silently present an old result as fresh after ingestion fails.
            portal.status['error'] = 'Analysis failed. Last successful results retained; inspect the source formats.'


@asynccontextmanager
async def lifespan(app):
    await asyncio.to_thread(refresh)
    task = asyncio.create_task(poll())
    yield
    task.cancel()
    try:
        await task
    except asyncio.CancelledError:
        pass


app = FastAPI(title='Lio Launch Rescue', lifespan=lifespan)
app.add_middleware(TrustedHostMiddleware, allowed_hosts=['127.0.0.1', 'localhost', 'testserver'])


@app.middleware('http')
async def local_boundary(request: Request, call_next):
    # This MVP has no login system. Bind loopback and reject cross-origin mutations.
    if request.method not in ('GET', 'HEAD', 'OPTIONS'):
        origin = request.headers.get('origin')
        if origin and origin.rstrip('/') != str(request.base_url).rstrip('/'):
            from fastapi.responses import JSONResponse
            return JSONResponse({'detail': 'Cross-origin actions are not allowed'}, status_code=403)
    response = await call_next(request)
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['Cache-Control'] = 'no-store'
    return response


@app.get('/api/health')
def health():
    return {'status': 'ok', 'data_present': config.DATA_DIR.is_dir()}


@app.get('/api/overview')
def get_overview():
    with lock:
        return overview()


@app.post('/api/refresh')
def local_refresh():
    return refresh()


@app.post('/api/sync')
def portal_refresh():
    return refresh(sync=True)


@app.get('/api/issues/{issue_id}')
def get_issue(issue_id: str):
    with lock:
        return issue_detail(issue_id)


def recipient_for(issue):
    if issue['material_id'] == 'CMP-GAM-001':
        return os.getenv('LIO_GAME_CARD_RECIPIENT', '')
    if issue['material_id'] == 'CMP-GAM-008':
        return os.getenv('LIO_ART_BOOK_RECIPIENT', '')
    return ''


@app.post('/api/issues/{issue_id}/draft')
def draft(issue_id: str):
    with lock:
        issue = issue_detail(issue_id)
        case = issue['case']
        if case['state'] in ('sending', 'sent', 'delivery_unknown'):
            raise HTTPException(409, 'An inquiry has already been sent or needs delivery reconciliation')
        evidence = '\n'.join('- ' + e.get('label', e['path']) + ': ' + e.get('excerpt', '')[:600]
                             for e in issue.get('evidence', [])[:5])
        body = (f"Hello,\n\nWe are investigating supply for {issue['material_id']} at Soony's Hamburg site.\n\n"
                f"Current evidence: {issue['summary']}\n"
                f"Estimated uncovered quantity: {issue.get('shortage', 'not established')}.\n\n"
                "Please confirm the actual available and shipped quantities, earliest delivery date and time at Hamburg, "
                "any faster transport or available-stock option, its cost and currency, and constraints. "
                "Please distinguish a carrier arrival from delivery at the packing site.\n\n"
                "This is an availability inquiry, not an order, booking, quality concession or spending commitment.\n\n"
                f"Evidence references for verification:\n{evidence}\n\nThank you,\nSoony launch team")
        case.update(state='drafted', approver=None, approved_fingerprint=None,
                    draft={'to': recipient_for(issue), 'subject': f"[Lio {issue_id}] Launch supply verification — {issue['material_id']}",
                           'body': body})
        store.save(issue_id, case)
        store.event(issue_id, 'drafted', 'Prepared an evidence-based supplier inquiry. No email sent.')
        return issue_detail(issue_id)


@app.post('/api/issues/{issue_id}/investigate')
def investigate(issue_id: str):
    with lock:
        issue = next((i for i in snapshot.get('issues', []) if i['id'] == issue_id), None)
        if issue is None:
            raise HTTPException(404, 'Issue not found')
        source_fingerprint = fingerprint(issue)
    if not config.integrations()['ai_enabled']:
        raise HTTPException(409, 'Set OPENAI_API_KEY and LIO_AI_MODEL locally to enable AI investigation.')
    try:
        result = investigator.run(issue, config.DATA_DIR,
                                  lambda name: store.event(issue_id, 'agent_tool', f'Investigator called {name}'))
    except (ValueError, OSError) as error:
        raise HTTPException(502, str(error))
    except Exception:
        raise HTTPException(502, 'Model investigation failed. No supplier action was taken.')
    with lock:
        current = issue_detail(issue_id)
        case = current['case']
        if case['source_fingerprint'] != source_fingerprint:
            raise HTTPException(409, 'Source evidence changed during investigation. Run again on current evidence.')
        result['source_fingerprint'] = source_fingerprint
        case['investigation'] = result
        store.save(issue_id, case)
        store.event(issue_id, 'investigated', 'Model investigation completed. Recommendations require human verification; no email sent.')
        return issue_detail(issue_id)


class Approval(BaseModel):
    approver: str = Field(min_length=2, max_length=120)
    note: str = Field(default='', max_length=2000)


@app.post('/api/issues/{issue_id}/approve')
def approve(issue_id: str, approval: Approval):
    with lock:
        issue = issue_detail(issue_id)
        case = issue['case']
        if not approval.approver.strip() or case['state'] not in ('drafted', 'approved') or not case.get('draft'):
            raise HTTPException(409, 'Generate and review a current inquiry before approving')
        case.update(state='approved', approver=approval.approver.strip(), approval_note=approval.note,
                    approved_fingerprint=case['source_fingerprint'])
        store.save(issue_id, case)
        store.event(issue_id, 'approved', f"{approval.approver.strip()} approved this inquiry only. {approval.note}")
        return issue_detail(issue_id)


@app.post('/api/issues/{issue_id}/send')
def send(issue_id: str):
    with lock:
        issue = issue_detail(issue_id)
        case = issue['case']
        if not config.integrations()['email_enabled']:
            raise HTTPException(409, 'Supplier email is not enabled. Configure a registered sender and SMTP transport first.')
        if case['state'] != 'approved' or case.get('approved_fingerprint') != case['source_fingerprint']:
            raise HTTPException(409, 'Current evidence and inquiry require approval before sending')
        outgoing = case['draft']
        destination = recipient_for(issue)
        if not destination or outgoing['to'] != destination or '\n' in destination or '\r' in destination:
            raise HTTPException(409, 'A verified supplier recipient must be configured before sending')
        message = EmailMessage()
        message['From'] = os.environ['SMTP_FROM']
        message['To'] = destination
        message['Subject'] = outgoing['subject']
        message['Message-ID'] = f"<{issue_id}.{case['source_fingerprint'][:16]}@lio-launch-rescue.local>"
        message.set_content(outgoing['body'])
        case['state'] = 'sending'
        store.save(issue_id, case)
        store.event(issue_id, 'sending', 'Approved inquiry handed to SMTP transport.')
        try:
            with smtplib.SMTP(os.environ['SMTP_HOST'], int(os.getenv('SMTP_PORT', '587')), timeout=30) as smtp:
                smtp.starttls(context=ssl.create_default_context())
                smtp.login(os.environ['SMTP_USERNAME'], os.environ['SMTP_PASSWORD'])
                smtp.send_message(message)
        except Exception:
            case['state'] = 'delivery_unknown'
            store.save(issue_id, case)
            store.event(issue_id, 'delivery_unknown', 'Transport did not confirm completion. Check sent mail before retrying; automatic resend is blocked.')
            raise HTTPException(502, 'Email completion could not be confirmed. Check sent mail; no automatic retry will occur.')
        case.update(state='sent', sent_at=now())
        store.save(issue_id, case)
        store.event(issue_id, 'sent', 'SMTP accepted the inquiry. Supplier confirmation and shipment remain unverified.')
        return issue_detail(issue_id)


@app.get('/api/evidence')
def evidence(path: str):
    try:
        target = safe_path(config.DATA_DIR, path)
    except ValueError:
        raise HTTPException(400, 'Invalid evidence path')
    allowed = {'.pdf', '.csv', '.xlsx', '.png', '.jpg', '.jpeg', '.md', '.txt'}
    if not target.is_file() or target.suffix.lower() not in allowed:
        raise HTTPException(404, 'Evidence file not found')
    return FileResponse(target)


app.mount('/static', StaticFiles(directory=Path(__file__).parent / 'static'), name='assets')
app.mount('/', StaticFiles(directory=Path(__file__).parent / 'static', html=True), name='ui')
