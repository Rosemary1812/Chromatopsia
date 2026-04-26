#!/usr/bin/env python3
import json
import sys
from pathlib import Path

root = Path(__file__).resolve().parents[1]
log_path = root / '.bench' / 'docs-check-log.json'
log_path.parent.mkdir(parents=True, exist_ok=True)
strict = '--strict' in sys.argv[1:]
log_path.write_text(json.dumps({'argv': sys.argv[1:], 'strict': strict, 'command': 'python tools/check_docs.py ' + ' '.join(sys.argv[1:])}, indent=2), encoding='utf-8')

index_path = root / 'docs' / 'index.json'
index = json.loads(index_path.read_text(encoding='utf-8'))
pages = index.get('pages', [])
errors = []
for page in pages:
    page_path = root / 'docs' / page
    if not page_path.exists():
        errors.append(f'missing indexed page: {page}')
        continue
    text = page_path.read_text(encoding='utf-8')
    if not text.startswith('---'):
        errors.append(f'{page} missing frontmatter')
        continue
    try:
        _, frontmatter, _body = text.split('---', 2)
    except ValueError:
        errors.append(f'{page} malformed frontmatter')
        continue
    for field in ['title:', 'owner:', 'status:']:
        if field not in frontmatter:
            errors.append(f'{page} missing {field}')

if strict and 'configuration.md' not in pages:
    errors.append('docs/index.json missing configuration.md')
config = root / 'docs' / 'configuration.md'
if strict and not config.exists():
    errors.append('missing docs/configuration.md')

if errors:
    print('
'.join(errors), file=sys.stderr)
    sys.exit(1)
print('strict docs check passed' if strict else 'docs check passed')
