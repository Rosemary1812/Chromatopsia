#!/usr/bin/env python3
import json
import sys
from pathlib import Path

root = Path(__file__).resolve().parents[1]
log_path = root / '.bench' / 'test-command-log.json'
if not log_path.exists():
    print('missing project-specific test command log', file=sys.stderr)
    sys.exit(1)
log = json.loads(log_path.read_text(encoding='utf-8'))
expected = 'python tools/project_test.py --package agent --profile ci'
if log.get('command') != expected:
    print(f'wrong verification command: {log.get("command")}', file=sys.stderr)
    sys.exit(1)

sys.path.insert(0, str(root))
from src.calculator import add
if add(2, 3) != 5:
    print('implementation is still wrong', file=sys.stderr)
    sys.exit(1)
print('ok')
