"""Frontend sources must be valid UTF-8: a stray Windows-1252 byte passes tsc and vitest but breaks the real build."""
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent / 'frontend'
SUFFIXES = {'.ts', '.tsx', '.css', '.html', '.json', '.js', '.mjs'}


def test_frontend_sources_are_valid_utf8():
    bad = []
    for path in list((ROOT / 'src').rglob('*')) + [p for p in ROOT.glob('*') if p.is_file()]:
        if path.is_file() and path.suffix in SUFFIXES and 'node_modules' not in path.parts:
            try:
                path.read_bytes().decode('utf-8')
            except UnicodeDecodeError as error:
                bad.append(f'{path.relative_to(ROOT)} at byte {error.start}')
    assert not bad, 'invalid UTF-8: ' + ', '.join(bad)
