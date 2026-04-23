from pathlib import Path


def test_ci_workflow_runs_pytest() -> None:
    workflow = Path(".github/workflows/ci.yml").read_text(encoding="utf-8")
    assert "actions/setup-python" in workflow
    assert "python -m pytest tests/ -q" in workflow
