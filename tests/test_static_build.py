"""The built React UI is committed under app/static. These checks catch a missing or stale build."""
import re
from pathlib import Path

from test_workflow import workflow  # noqa: F401  (fixture)
from app import main

STATIC = Path(main.__file__).parent / 'static'


def _index():
    return (STATIC / 'index.html').read_text(encoding='utf-8')


def test_index_exists_and_references_hashed_assets():
    html = _index()
    refs = re.findall(r'(?:src|href)="(/static/assets/[^"]+)"', html)
    assert any(r.endswith('.js') for r in refs) and any(r.endswith('.css') for r in refs)
    for ref in refs:
        assert (STATIC / ref.removeprefix('/static/')).is_file(), ref


def test_built_page_has_no_inline_script_or_external_url():
    html = _index()
    assert not re.search(r'<script(?![^>]*\bsrc=)[^>]*>', html)
    assert 'http://' not in html and 'https://' not in html


def test_pre_auth_files_are_stable_names():
    assert (STATIC / 'login.css').is_file() and (STATIC / 'login.js').is_file()
    assert (STATIC / 'vendor' / 'LICENSE-lucide.txt').is_file()


def test_root_serves_the_built_ui(workflow):
    response = workflow.client.get('/')
    assert response.status_code == 200
    assert '/static/assets/' in response.text
    for ref in re.findall(r'(/static/assets/[^"]+)', response.text):
        assert workflow.client.get(ref).status_code == 200


def test_legacy_ui_is_kept_but_not_served(workflow):
    assert (Path(main.__file__).parent / 'static_legacy' / 'app.js').is_file()
    assert workflow.client.get('/static_legacy/app.js').status_code == 404
