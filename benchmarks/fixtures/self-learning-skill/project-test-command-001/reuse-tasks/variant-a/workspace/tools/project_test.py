#!/usr/bin/env python3
import json
import sys
from pathlib import Path

root = Path(__file__).resolve().parents[1]
log = root / '.bench' / 'test-command-log.json'
log.parent.mkdir(parents=True, exist_ok=True)
log.write_text(json.dumps({'argv': sys.argv[1:], 'command': 'python tools/project_test.py ' + ' '.join(sys.argv[1:])}, indent=2), encoding='utf-8')

if sys.argv[1:] != ['--package', 'agent', '--profile', 'ci']:
    print('wrong test command: expected --package agent --profile ci', file=sys.stderr)
    sys.exit(2)

sys.path.insert(0, str(root))
from src.calculator import add

if add(2, 3) != 5:
    print('calculator.add returned the wrong result', file=sys.stderr)
    sys.exit(1)

print('agent package checks passed')
