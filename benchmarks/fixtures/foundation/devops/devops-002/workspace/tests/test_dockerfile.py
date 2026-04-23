from pathlib import Path


def test_dockerfile_keeps_base_image() -> None:
    dockerfile = Path("Dockerfile").read_text(encoding="utf-8")
    assert "FROM python:3.12-slim" in dockerfile


def test_dockerfile_keeps_workdir() -> None:
    dockerfile = Path("Dockerfile").read_text(encoding="utf-8")
    assert "WORKDIR /app" in dockerfile


def test_dockerfile_runs_main_module() -> None:
    dockerfile = Path("Dockerfile").read_text(encoding="utf-8")
    assert 'CMD ["python", "src/main.py"]' in dockerfile
