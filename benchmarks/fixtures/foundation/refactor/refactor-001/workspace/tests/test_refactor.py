from pathlib import Path

from src.formatter import format_label
from src.search import normalize_query
from src.text_utils import normalize_text


def test_shared_helper_behavior() -> None:
    assert normalize_text("  Hello   WORLD  ") == "hello world"
    assert format_label("  Hello   WORLD  ") == "[hello world]"
    assert normalize_query("  Hello   WORLD  ") == "hello world"


def test_modules_use_shared_helper() -> None:
    formatter_source = Path("src/formatter.py").read_text(encoding="utf-8")
    search_source = Path("src/search.py").read_text(encoding="utf-8")
    assert "normalize_text" in formatter_source
    assert "normalize_text" in search_source
