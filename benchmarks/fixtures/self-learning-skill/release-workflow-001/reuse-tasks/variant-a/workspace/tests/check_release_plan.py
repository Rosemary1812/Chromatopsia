#!/usr/bin/env python3
import sys
from pathlib import Path

root = Path(__file__).resolve().parents[1]
plan = root / 'reports' / 'release-plan.md'
if not plan.exists():
    print('missing reports/release-plan.md', file=sys.stderr)
    sys.exit(1)
text = plan.read_text(encoding='utf-8').lower()
required = [
    'run release validation before tagging',
    'build or verify the artifact before uploading',
    'gh release upload 1.0.0 main.js --clobber',
]
missing = [item for item in required if item not in text]
if missing:
    print('missing release workflow items: ' + ', '.join(missing), file=sys.stderr)
    sys.exit(1)
forbidden = ['personal access token', 'github_pat_', 'tag before validation', 'skip verification']
hits = [item for item in forbidden if item in text]
if hits:
    print('forbidden release workflow items present: ' + ', '.join(hits), file=sys.stderr)
    sys.exit(1)
print('ok')
