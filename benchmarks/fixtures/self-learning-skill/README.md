# Self Learning Skill Fixtures

This directory contains fixtures for the Self Learning Skill Evaluation suite.

The suite is intentionally independent from `benchmarks/fixtures/foundation`.
Each case should evaluate the full learning-to-reuse loop:

1. historical conversation or turn events that should produce, patch, or skip a Skill
2. expected properties of the generated Skill
3. one or more reuse tasks used for with/without Skill paired trials

Expected case layout:

```text
<case-id>/
├── scenario.yaml
├── conversations/
│   └── learning-source.jsonl
├── existing-skills/
│   └── optional-existing-skill/
│       └── SKILL.md
├── reuse-tasks/
│   └── <task-id>/
│       ├── workspace/
│       └── expected/
└── judges/
    ├── quality-rubric.md
    └── reuse-rubric.md
```

The old `benchmarks/fixtures/skill-learning-todo` directory is a legacy TODO
placeholder. New work should use this directory.
