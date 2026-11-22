"""Local-only HTTP service. Start with python -m uvicorn app.main:app."""
import asyncio
import csv
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
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles
from starlette.middleware.trustedhost import TrustedHostMiddleware
from pydantic import BaseModel, Field

from app import config
from app.engine import analyze
from app.store import Store, fingerprint
from app.sync import PortalSync, safe_path, now
from app import investigator, crew, actions, agent_loop
from app.mailbox import Inbox
from app.recovery import scenario, aware
from app import access, labels, public, mapdata

lock = threading.RLock()
store = Store(config.STATE_DIR / 'cases.sqlite3')
portal = PortalSync(config.DATA_DIR, config.STATE_DIR, config.PORTAL_TOKEN)
snapshot = {}
inbox = None
agent_status = {'running': False, 'state': 'ready', 'steps': [], 'last_run': None, 'error': None}


def current_inbox():
    global inbox
    if inbox is None or inbox.store is not store:
        inbox = Inbox(store, store.path.parent / 'inbox')
    return inbox


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
    result['agent'] = dict(agent_status)
    result['inbox'] = current_inbox().status.copy()
    result['case_versions'] = {}
    for issue in result.get('issues', []):
        events = store.events(issue['id'])
        result['case_versions'][issue['id']] = events[0]['at'] if events else None
    return result


def issue_detail(issue_id):
    issue = next((i for i in snapshot.get('issues', []) if i['id'] == issue_id), None)
    if issue is None:
        raise HTTPException(404, 'Issue not found in current evidence')
    return {**issue, 'case': store.get(issue), 'events': store.events(issue_id),
            'integrations': config.integrations(), 'replies': current_inbox().list(issue_id)}


async def poll():
    # With a portal token, check the portal at once at startup (fresh hosts have no data yet, and the screen shows
    # 'data stale' until a sync succeeds); without one there is nothing to check, so wait.
    wait = not config.PORTAL_TOKEN
    while True:
        if wait:
            await asyncio.sleep(config.POLL_SECONDS)
        wait = True
        try:
            await asyncio.to_thread(refresh, bool(config.PORTAL_TOKEN))
            if config.integrations()['inbox_enabled']:
                await asyncio.to_thread(check_inbox)
        except Exception:
            # Never silently present an old result as fresh after ingestion fails.
            portal.status['error'] = 'Analysis failed. Last successful results retained; inspect the source formats.'


@asynccontextmanager
async def lifespan(app):
    if not access.enabled() and os.getenv('LIO_ALLOWED_HOSTS', '').strip():
        raise RuntimeError('LIO_ALLOWED_HOSTS exposes this service beyond loopback but LIO_ACCESS_CODE is not set. '
                           'Refusing to start unauthenticated.')
    await asyncio.to_thread(refresh)
    task = asyncio.create_task(poll())
    yield
    task.cancel()
    try:
        await task
    except asyncio.CancelledError:
        pass


app = FastAPI(title='Lio Launch Rescue', lifespan=lifespan, docs_url=None, redoc_url=None, openapi_url=None)
app.add_middleware(TrustedHostMiddleware, allowed_hosts=['127.0.0.1', 'localhost', 'testserver'] + [
    h.strip() for h in os.getenv('LIO_ALLOWED_HOSTS', '').split(',') if h.strip()])

SECURITY_HEADERS = {
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'no-referrer',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
    'Content-Security-Policy': "default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self'; "
                               "frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
    'Cache-Control': 'no-store',
}


def secured(response):
    for key, value in SECURITY_HEADERS.items():
        response.headers[key] = value
    return response


@app.middleware('http')
async def boundary(request: Request, call_next):
    path = request.url.path
    if access.enabled() and path not in access.PUBLIC and not access.valid_cookie(request.cookies.get(access.COOKIE)):
        if path.startswith('/api/'):
            return secured(JSONResponse({'detail': 'Access code required'}, status_code=401))
        return secured(RedirectResponse('/login', status_code=303))
    if request.method not in ('GET', 'HEAD', 'OPTIONS'):
        origin = request.headers.get('origin')
        if origin and origin.rstrip('/') != str(request.base_url).rstrip('/'):
            return secured(JSONResponse({'detail': 'Cross-origin actions are not allowed'}, status_code=403))
    return secured(await call_next(request))


def cookie_secure(request: Request):
    return (request.url.scheme == 'https' or request.headers.get('x-forwarded-proto', '').lower() == 'https'
            or os.getenv('LIO_COOKIE_SECURE', '').lower() == 'true')


@app.get('/login')
def login_page(request: Request):
    if not access.enabled() or access.valid_cookie(request.cookies.get(access.COOKIE)):
        return RedirectResponse('/', status_code=303)
    return HTMLResponse(access.LOGIN_HTML)


class Login(BaseModel):
    code: str = Field(default='', max_length=200)


@app.post('/api/login')
def login(body: Login, request: Request):
    if not access.enabled():
        return JSONResponse({'ok': True})
    ip = request.client.host if request.client else 'unknown'
    outcome = access.attempt(ip, body.code)
    if outcome == 'limited':
        return JSONResponse({'detail': 'Too many tries. Wait a few minutes.'}, status_code=429)
    if outcome != 'ok':
        return JSONResponse({'detail': 'That code is wrong.'}, status_code=401)
    response = JSONResponse({'ok': True})
    response.set_cookie(access.COOKIE, access.make_cookie(), max_age=access.LIFETIME, httponly=True,
                        samesite='strict', path='/', secure=cookie_secure(request))
    return response


@app.post('/api/logout')
def logout(request: Request):
    access.revoke(request.cookies.get(access.COOKIE))
    response = JSONResponse({'ok': True})
    response.delete_cookie(access.COOKIE, path='/')
    return response


@app.get('/api/health')
def health():
    return {'status': 'ok', 'data_present': config.DATA_DIR.is_dir()}


def _public_overview(raw):
    result = public.public_overview(raw)
    data = mapdata.cached(config.DATA_DIR, (raw or {}).get('launch_date'))
    if data:
        result['map'] = data
    return result


@app.get('/api/overview')
def get_overview():
    with lock:
        return _public_overview(overview())


@app.post('/api/refresh')
def local_refresh():
    return _public_overview(refresh())


@app.post('/api/sync')
def portal_refresh():
    return _public_overview(refresh(sync=True))


@app.get('/api/issues/{issue_id}')
def get_issue(issue_id: str):
    with lock:
        return public.public_detail(issue_detail(issue_id))


def recipient_for(issue):
    # An explicit override wins; otherwise the supplier's contact from its profile (server-side only,
    # never returned to the browser). Used as the expected sender when importing replies.
    override = {'CMP-GAM-001': 'LIO_GAME_CARD_RECIPIENT', 'CMP-GAM-008': 'LIO_ART_BOOK_RECIPIENT'}.get(issue.get('material_id'))
    if override and os.getenv(override):
        return os.getenv(override, '')
    supplier = issue.get('supplier') or {}
    return str(supplier.get('contact_email') or '') if isinstance(supplier, dict) else ''


def supplier_option(case):
    """The option the crew would ask the supplier about, when its result matches the current evidence."""
    data = case.get('crew') if isinstance(case.get('crew'), dict) else None
    if not data or data.get('source_fingerprint') != case.get('source_fingerprint'):
        return None
    options = [o for o in data.get('options') or [] if o.get('mode') in ('air', 'sea', 'road')]
    return next((o for o in options if o.get('feasible') == 'yes'), None) or (options[0] if options else None)


def pricing_category(detail):
    try:
        from app import pricing
        return pricing.component_category(config.DATA_DIR, detail.get('material_id'))
    except Exception:
        return None


def release_draft(case):
    """The crew's inquiry to the supplier that holds goods, when the top option is a release and the result is current.

    Its recipient stays empty: the application never addresses it, and sending stays blocked until a person registers one.
    """
    data = case.get('crew') if isinstance(case.get('crew'), dict) else None
    if not data or data.get('source_fingerprint') != case.get('source_fingerprint') or data.get('top_kind') != 'release':
        return None
    drafts = data.get('supplier_drafts') or []
    first = drafts[0] if drafts and isinstance(drafts[0], dict) else None
    return {'to': '', 'subject': first['subject'], 'body': first['body'], 'manual_send': True} if first else None


def refresh_crew(issue_id, investigation=None, investigate=None, agent=False):
    """Run the agent crew on the current evidence and keep its result in the case. Never raises."""
    try:
        with lock:
            issue = next((i for i in snapshot.get('issues', []) if i['id'] == issue_id), None)
            if issue is None:
                return None
            source_fingerprint = fingerprint(issue)
            products = [dict(p) for p in snapshot.get('products', [])]
            hours = (snapshot.get('pack_status') or {}).get('hours_left')
            launch = snapshot.get('launch_date')
            as_of_label = (snapshot.get('pack_status') or {}).get('as_of')
            case = store.get(issue)
            inv = investigation if investigation is not None else case.get('investigation')
            if isinstance(inv, dict) and inv.get('source_fingerprint') not in (None, source_fingerprint):
                inv = None
            previous = case.get('crew') if isinstance(case.get('crew'), dict) else None
            if (not agent and previous and previous.get('run_mode') in ('agent', 'agent_partial')
                    and previous.get('source_fingerprint') == source_fingerprint):
                return previous  # one agent run per evidence state: the rule path must not overwrite it
        result = crew.run(issue_id, issue, products, hours, config.DATA_DIR, store.path.parent, investigation=inv,
                          investigate=investigate, launch=launch, source_fingerprint=source_fingerprint,
                          as_of_label=as_of_label, operator=agent_loop.operate if agent else None)
        with lock:
            current = issue_detail(issue_id)
            case = current['case']
            if case['source_fingerprint'] != source_fingerprint:
                return None
            if agent and result.get('run_mode') == 'rule_based' and previous and previous.get('run_mode') in ('agent', 'agent_partial'):
                case['crew_last_good'] = previous  # the model failed this time: keep the last good agent run, stamped with its own time
            case['crew'] = result
            store.save(issue_id, case)
        return result
    except Exception:
        return None


@app.post('/api/issues/{issue_id}/draft')
def draft(issue_id: str):
    with lock:
        issue = issue_detail(issue_id)
        case = issue['case']
        if case.get('sent_at') or case.get('delivery_status') in ('sending', 'delivery_unknown') or case['state'] in ('sending', 'sent', 'delivery_unknown'):
            raise HTTPException(409, 'An inquiry has already been sent or needs delivery reconciliation')
        # Supplier-facing text: only facts from the supplier's own advice plus the ask (see app/actions.py).
        # Never include internal stock, requirements, memos, priorities, prices or approvers.
        stored = release_draft(case)
        built = stored or actions.supplier_draft(issue, supplier_option(case), snapshot.get('launch_date'), recipient_for(issue), issue_id)
        case.update(state='drafted', approver=None, approved_fingerprint=None,
                    draft=built)
        store.save(issue_id, case)
        store.event(issue_id, 'drafted', 'Prepared an evidence-based supplier inquiry. No email sent.')
        return public.public_detail(issue_detail(issue_id))


def record_step(issue_id, label):
    label = label if label in labels.GENERIC else 'Checked a record'
    store.event(issue_id, 'agent_tool', f'Agent: {label}')
    if agent_status.get('running'):
        agent_status['steps'].append({'at': now(), 'message': label})


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
                                  lambda label: record_step(issue_id, label))
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
    refresh_crew(issue_id)
    with lock:
        return public.public_detail(issue_detail(issue_id))


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
                    approved_fingerprint=case['source_fingerprint'], approved_draft_hash=public.draft_hash(case['draft']))
        store.save(issue_id, case)
        store.event(issue_id, 'approved', f"{approval.approver.strip()} approved this inquiry only. {approval.note}")
        return public.public_detail(issue_detail(issue_id))


@app.post('/api/issues/{issue_id}/escalation/approve')
def approve_escalation(issue_id: str, approval: Approval):
    """A named person approves the INTERNAL escalation draft. The application never sends it."""
    with lock:
        issue = issue_detail(issue_id)
        case = issue['case']
        data = case.get('crew') if isinstance(case.get('crew'), dict) else None
        draft_ = data.get('escalation') if data else None
        if not draft_ or data.get('source_fingerprint') != case['source_fingerprint']:
            raise HTTPException(409, 'Run the agent on the current evidence and review the escalation before approving')
        name = approval.approver.strip()
        if len(name) < 2:
            raise HTTPException(422, 'A named approver is required')
        case['escalation_approval'] = {'approver': name, 'note': approval.note, 'at': now(),
                                       'source_fingerprint': case['source_fingerprint'],
                                       'escalation_hash': public.escalation_hash(draft_)}
        store.save(issue_id, case)
        store.event(issue_id, 'escalation_approved', f"{name} approved the escalation draft. It is not sent by the application.")
        return public.public_detail(issue_detail(issue_id))


class WhatIf(BaseModel):
    arrive_in_hours: float = Field(strict=True, ge=0, le=72, allow_inf_nan=False)


@app.post('/api/issues/{issue_id}/whatif')
def what_if(issue_id: str, body: WhatIf):
    with lock:
        issue = next((i for i in snapshot.get('issues', []) if i['id'] == issue_id), None)
        if issue is None:
            raise HTTPException(404, 'Issue not found in current evidence')
        products = [dict(p) for p in snapshot.get('products', [])]
        hours = (snapshot.get('pack_status') or {}).get('hours_left')
    if not isinstance(hours, (int, float)):
        raise HTTPException(409, 'The packing hours left are not known yet')
    try:
        result = crew.whatif_for(issue, products, hours, body.arrive_in_hours)
    except Exception:
        raise HTTPException(409, 'The scenario could not be worked out from the current records')
    if result is None:
        raise HTTPException(409, 'No edition is short, so there is nothing to simulate')
    return public.public_whatif(result)


@app.post('/api/issues/{issue_id}/send')
def send(issue_id: str):
    with lock:
        issue = issue_detail(issue_id)
        case = issue['case']
        if not config.integrations()['email_enabled']:
            raise HTTPException(409, 'Supplier email is not enabled. Configure a registered sender and SMTP transport first.')
        if (case.get('sent_at') or case.get('delivery_status') in ('sending', 'delivery_unknown') or case['state'] != 'approved'
                or case.get('approved_fingerprint') != case['source_fingerprint']
                or case.get('approved_draft_hash') != public.draft_hash(case.get('draft'))):
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
        return public.public_detail(issue_detail(issue_id))


def profile_contact(supplier_name):
    """Contact address from a supplier's own profile, matched by name. Server-side only; '' when not found."""
    wanted = str(supplier_name or '').strip().casefold()
    if not wanted:
        return ''
    for path in sorted((config.DATA_DIR).glob('suppliers/*/profile.csv')):
        try:
            with path.open(encoding='utf-8-sig', newline='') as stream:
                for row in csv.DictReader(stream):
                    if wanted in {str(row.get('name') or '').strip().casefold(), str(row.get('legal_name') or '').strip().casefold()}:
                        return str(row.get('contact_email') or '').strip()
        except (OSError, csv.Error):
            continue
    return ''


def approved_unsent(issue_id):
    """(issue, case) when the supplier inquiry is approved for the current evidence and not yet sent; else HTTP 409."""
    issue = issue_detail(issue_id)
    case = issue['case']
    draft_ = case.get('draft')
    if (not draft_ or case.get('sent_at') or case.get('state') != 'approved'
            or case.get('approved_fingerprint') != case.get('source_fingerprint')
            or case.get('approved_draft_hash') != public.draft_hash(draft_)):
        raise HTTPException(409, 'Approve the current inquiry first. It must be approved for the current evidence and not yet sent.')
    return issue, case


@app.get('/api/issues/{issue_id}/handoff')
def handoff(issue_id: str):
    """The approved inquiry for sending by hand from the operator's own mailbox. Nothing is sent by the application."""
    with lock:
        issue, case = approved_unsent(issue_id)
        draft_ = case['draft']
        to = str(draft_.get('to') or '')
        if not to:
            crew_data = case.get('crew') if isinstance(case.get('crew'), dict) else {}
            first = (crew_data.get('supplier_drafts') or [None])[0]
            to = profile_contact(first.get('supplier') if isinstance(first, dict) else None)
        return JSONResponse({'to': to, 'subject': draft_.get('subject') or '', 'body': draft_.get('body') or ''},
                            headers={'Cache-Control': 'no-store'})


class MarkSent(BaseModel):
    sent_by: str = Field(min_length=2, max_length=120)


@app.post('/api/issues/{issue_id}/mark-sent')
def mark_sent(issue_id: str, body: MarkSent):
    """Record that a named person sent the approved inquiry by hand. Delivery and receipt stay unverified."""
    with lock:
        issue, case = approved_unsent(issue_id)
        name = body.sent_by.strip()
        if len(name) < 2:
            raise HTTPException(422, 'A name is required')
        case.update(state='sent', sent_at=now(), sent_manually=True, sent_by=name)
        store.save(issue_id, case)
        store.event(issue_id, 'sent_manually', f"{name} says the approved inquiry was sent by hand from their own mailbox. "
                                               "Delivery and supplier receipt are not confirmed.")
        return public.public_detail(issue_detail(issue_id))


@app.get('/api/evidence')
def evidence(path: str):
    if os.getenv('LIO_EXPOSE_SOURCES', '').lower() != 'true':
        raise HTTPException(404, 'Not found')
    try:
        target = safe_path(config.DATA_DIR, path)
    except ValueError:
        raise HTTPException(400, 'Invalid evidence path')
    allowed = {'.pdf', '.csv', '.xlsx', '.png', '.jpg', '.jpeg', '.md', '.txt'}
    if not target.is_file() or target.suffix.lower() not in allowed:
        raise HTTPException(404, 'Evidence file not found')
    return FileResponse(target)


def check_inbox():
    with lock:
        issues = [{**i, '_fingerprint': fingerprint(i)} for i in snapshot.get('issues', [])]
    return current_inbox().check(issues, recipient_for)


@app.post('/api/inbox/check')
def inbox_check():
    check_inbox()
    with lock:
        return public.public_agent(agent_status)


@app.post('/api/issues/{issue_id}/replies/import')
async def import_reply(issue_id: str, request: Request):
    raw = await request.body()
    with lock:
        detail = issue_detail(issue_id)
        issue = next(i for i in snapshot['issues'] if i['id'] == issue_id)
        try:
            record, created = current_inbox().ingest(raw, {**issue, '_fingerprint': fingerprint(issue)}, recipient_for(issue))
        except ValueError as error:
            raise HTTPException(400, str(error))
        if created:
            case = detail['case']
            # Receiving a reply cannot reauthorize an old draft or mark a shipment confirmed.
            case.update(state='reply_review_required', approved_fingerprint=None)
            store.save(issue_id, case)
        return public.public_detail(issue_detail(issue_id))


class OfferReview(BaseModel):
    message_id: str = Field(min_length=1)
    reviewer: str = Field(min_length=2, max_length=120)
    quantity: int = Field(ge=0, le=10000000)
    arrival_at: str
    cost_eur: float = Field(ge=0, le=1000000000, allow_inf_nan=False)
    note: str = Field(min_length=5, max_length=2000)


@app.post('/api/issues/{issue_id}/replies/review')
def review_reply(issue_id: str, review: OfferReview):
    with lock:
        detail = issue_detail(issue_id)
        case = detail['case']
        reply = next((m for m in detail['replies'] if m['id'] == review.message_id), None)
        if not reply or reply['source_fingerprint'] != case['source_fingerprint']:
            raise HTTPException(409, 'Reply is missing or tied to older evidence. Reverify against the current case.')
        if not review.reviewer.strip() or not review.note.strip():
            raise HTTPException(422, 'Reviewer and verification note are required')
        try:
            result = scenario(detail, snapshot['products'], snapshot['launch_date'], review.quantity, review.arrival_at, review.cost_eur,
                              policy=crew.cached_policy(config.DATA_DIR),
                              category=pricing_category(detail))
        except (ValueError, TypeError):
            raise HTTPException(422, 'Arrival must be ISO 8601 with an explicit timezone and launch date must be available')
        result.update(reviewer=review.reviewer.strip(), note=review.note, reply_id=reply['id'], reviewed_at=now(),
                      source_fingerprint=case['source_fingerprint'])
        case.update(recovery_offer=result, state='offer_reviewed', approved_fingerprint=None)
        store.save(issue_id, case)
        store.event(issue_id, 'offer_reviewed', f"{review.reviewer.strip()} reviewed a supplier offer. Scenario updated; recorded stock and orders unchanged.")
        return public.public_detail(issue_detail(issue_id))


class AgentRun(BaseModel):
    issue_id: str = 'game-card-shortage'


def agent_cycle(issue_id):
    try:
        def step(message):
            with lock:
                agent_status['steps'].append({'at': now(), 'message': message})
        step('Checking for new data')
        refresh(sync=bool(config.PORTAL_TOKEN))
        step('Reading the records')
        if config.integrations()['inbox_enabled']:
            check_inbox()
        with lock:
            current = issue_detail(issue_id)
        if current.get('shortage', 0) <= 0:
            step('Ready for your review')
            agent_status['state'] = 'review_findings'
            return
        failed = None
        use_agent = bool(config.integrations()['ai_enabled'] and agent_loop.available())
        if use_agent:
            step('Weighing the options')
        elif config.integrations()['ai_enabled']:
            step('Weighing the options')
            try:
                investigate(issue_id)
            except Exception:
                def failed():  # the crew traces this as 'fell back' and uses rule-based options
                    raise RuntimeError('model unavailable')
            step('Weighing the options')
        else:
            step('Weighing the options')
        refresh_crew(issue_id, investigate=failed, agent=use_agent)
        with lock:
            current = issue_detail(issue_id)
            if not current['case'].get('sent_at') and not current['case'].get('draft') and current['case']['state'] not in ('sent', 'sending', 'delivery_unknown', 'reply_review_required', 'offer_reviewed'):
                draft(issue_id)
                step('Drafting the request')
        agent_status['state'] = 'awaiting_human_review'
        step('Ready for your review')
    except Exception:
        agent_status.update(state='needs_attention', error='Agent cycle could not complete. Check connection status and current evidence; no automatic send occurred.')
    finally:
        agent_status.update(running=False, last_run=now())


@app.post('/api/agent/run', status_code=202)
def run_agent(run: AgentRun):
    with lock:
        if agent_status['running']:
            raise HTTPException(409, 'Agent is already running')
        agent_status.update(running=True, state='investigating', steps=[], error=None)
        threading.Thread(target=agent_cycle, args=(run.issue_id,), daemon=True).start()
        return public.public_agent(agent_status)


app.mount('/static', StaticFiles(directory=Path(__file__).parent / 'static'), name='assets')
app.mount('/', StaticFiles(directory=Path(__file__).parent / 'static', html=True), name='ui')
