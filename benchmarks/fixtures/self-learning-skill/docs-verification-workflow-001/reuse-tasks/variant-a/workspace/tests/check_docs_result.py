#!/usr/bin/env python3
import json
import sys
from pathlib import Path

root = Path(__file__).resolve().parents[1]
config = root / 'docs' / 'configuration.md'
if not config.exists():
    print('missing docs/configuration.md', file=sys.stderr)
    sys.exit(1)
text = config.read_text(encoding='utf-8')
for required in ['title:', 'owner:', 'status:', '# Configuration']:
    if required not in text:
        print(f'missing required docs content: {required}', file=sys.stderr)
        sys.exit(1)
index = json.loads((root / 'docs' / 'index.json').read_text(encoding='utf-8'))
if 'configuration.md' not in index.get('pages', []):
    print('docs/index.json was not updated', file=sys.stderr)
    sys.exit(1)
log_path = root / '.bench' / 'docs-check-log.json'
if not log_path.exists():
    print('missing strict docs checker log', file=sys.stderr)
    sys.exit(1)
log = json.loads(log_path.read_text(encoding='utf-8'))
if log.get('command') != 'python tools/check_docs.py --strict':
    print(f'wrong docs verification command: {log.get("command")}', file=sys.stderr)
    sys.exit(1)
print('ok')
