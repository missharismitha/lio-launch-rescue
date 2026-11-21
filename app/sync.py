"""Checksum-verified portal ingestion. No credentials in URLs or logs."""
import hashlib
import json
from datetime import datetime, timezone
from pathlib import Path, PurePosixPath
from urllib.parse import quote
import requests
from app import config


def now() -> str:
    return datetime.now(timezone.utc).isoformat()


def safe_path(root: Path, relative: str) -> Path:
    part = PurePosixPath(relative)
    if not relative or relative.strip() != relative or '\\' in relative or part.is_absolute() or '..' in part.parts or ':' in relative:
        raise ValueError('Invalid source path')
    target = (root / relative).resolve()
    if target == root.resolve() or not target.is_relative_to(root.resolve()):
        raise ValueError('Source path escapes data directory')
    return target


class PortalSync:
    def __init__(self, root: Path, state_dir: Path, token: str):
        self.root, self.state_dir, self.token = root, state_dir, token
        self.status = {'last_checked': None, 'last_success': None, 'error': None,
                       'changed_files': [], 'poll_seconds': config.POLL_SECONDS,
                       'mode': 'portal' if token else 'local snapshot'}

    def run(self):
        self.status['last_checked'] = now()
        self.status['changed_files'] = []
        if not self.token:
            self.status['error'] = 'Portal token not configured. Local files remain available.'
            return self.status.copy()
        try:
            headers = {'Authorization': 'Bearer ' + self.token}
            response = requests.get(config.PORTAL_URL + '/api/v1/files', headers=headers,
                                    timeout=30, allow_redirects=False)
            if response.status_code != 200:
                raise ValueError(f'Portal file list returned HTTP {response.status_code}')
            manifest = response.json()
            files = manifest['files']
            if not isinstance(files, list) or manifest.get('count', len(files)) != len(files):
                raise ValueError('Invalid portal manifest')
            manifest_path = self.state_dir / 'portal-manifest.json'
            previous = json.loads(manifest_path.read_text(encoding='utf-8')) if manifest_path.exists() else {'files': []}
            staged = []
            for entry in files:
                relative = entry['path']
                target = safe_path(self.root, relative)
                checksum = entry['sha256'].lower()
                if len(checksum) != 64 or any(c not in '0123456789abcdef' for c in checksum):
                    raise ValueError('Invalid portal checksum')
                if target.is_file() and hashlib.sha256(target.read_bytes()).hexdigest() == checksum:
                    continue
                result = requests.get(config.PORTAL_URL + '/api/v1/files/' + quote(relative, safe='/'),
                                      headers=headers, timeout=60, allow_redirects=False)
                if result.status_code != 200:
                    raise ValueError(f'Portal download returned HTTP {result.status_code}')
                content = result.content
                if len(content) > 128 * 1024 * 1024 or hashlib.sha256(content).hexdigest() != checksum:
                    raise ValueError('Download size or checksum validation failed')
                staged.append((target, content, relative))
            # Publish only after all requested downloads validate; the API serializes refresh/sync.
            for target, content, relative in staged:
                target.parent.mkdir(parents=True, exist_ok=True)
                temporary = target.with_name(target.name + '.download')
                temporary.write_bytes(content)
                temporary.replace(target)
            self.state_dir.mkdir(parents=True, exist_ok=True)
            # Quarantine files removed from a previously successful manifest so old notices stop influencing analysis.
            current_paths = {entry['path'] for entry in files}
            removed = []
            for old in previous.get('files', []):
                if old['path'] in current_paths:
                    continue
                target = safe_path(self.root, old['path'])
                if target.is_file():
                    quarantine = safe_path(self.state_dir / 'retired' / now().replace(':', '-'), old['path'])
                    quarantine.parent.mkdir(parents=True, exist_ok=True)
                    target.replace(quarantine)
                    removed.append(old['path'] + ' (removed from portal)')
            (self.state_dir / 'portal-manifest.json').write_text(json.dumps(manifest), encoding='utf-8')
            self.status.update(last_success=now(), error=None, changed_files=[s[2] for s in staged] + removed)
        except (requests.RequestException, ValueError, KeyError, TypeError, OSError):
            self.status['error'] = 'Portal sync failed. Last local snapshot retained; check token, network and manifest.'
        return self.status.copy()
