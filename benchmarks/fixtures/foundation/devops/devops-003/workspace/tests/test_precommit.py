from pathlib import Path


def test_hook_name_is_preserved() -> None:
    config = Path(".pre-commit-config.yaml").read_text(encoding="utf-8")
    assert "name: python-tests" in config


def test_hook_runs_expected_pytest_command() -> None:
    config = Path(".pre-commit-config.yaml").read_text(encoding="utf-8")
    assert "entry: python -m pytest tests/ -q" in config
