from src.summary_builder import build_summary


def test_build_summary_without_footer() -> None:
    assert build_summary("Title", "Body") == "Title\n\nBody"


def test_build_summary_with_footer() -> None:
    assert build_summary("Title", "Body", footer="Footer") == "Title\n\nBody\n\nFooter"
