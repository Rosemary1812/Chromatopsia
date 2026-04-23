from src.labels import format_label


def test_format_label_without_prefix() -> None:
    assert format_label("  Ready  ") == "Ready"


def test_format_label_with_prefix() -> None:
    assert format_label("Ready", prefix="Status") == "Status: Ready"
