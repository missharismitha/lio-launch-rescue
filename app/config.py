"""Environment configuration. Secrets never appear in API responses."""
import os
from pathlib import Path
from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parent.parent
load_dotenv(ROOT / '.env')


def configured_path(key: str, default: str) -> Path:
    path = Path(os.getenv(key, default))
    return (path if path.is_absolute() else ROOT / path).resolve()


DATA_DIR = configured_path('LIO_DATA_DIR', 'data/soony-data')
STATE_DIR = configured_path('LIO_STATE_DIR', '.local')
PORTAL_URL = 'https://start-hack-portal-cxh3crbdaef2f8gt.westeurope-01.azurewebsites.net'
PORTAL_TOKEN = os.getenv('LIO_PORTAL_TOKEN', '')
POLL_SECONDS = max(30, int(os.getenv('LIO_POLL_SECONDS', '60')))


def integrations() -> dict:
    email_ready = all(os.getenv(k) for k in ('SMTP_HOST', 'SMTP_FROM', 'SMTP_USERNAME', 'SMTP_PASSWORD'))
    ai_ready = bool(os.getenv('OPENAI_API_KEY') and os.getenv('LIO_AI_MODEL'))
    return {'portal_enabled': bool(PORTAL_TOKEN), 'ai_enabled': ai_ready,
            'email_enabled': os.getenv('LIO_EMAIL_ENABLED', '').lower() == 'true' and email_ready,
            'reasoning_mode': 'Model tool investigation available' if ai_ready else 'Evidence rules active; model key and model name needed',
            'inbox_enabled': all(os.getenv(k) for k in ('IMAP_HOST', 'IMAP_USERNAME', 'IMAP_PASSWORD')),
            'reply_mode': 'Read-only IMAP or local .eml import; supplier claims require review'}
