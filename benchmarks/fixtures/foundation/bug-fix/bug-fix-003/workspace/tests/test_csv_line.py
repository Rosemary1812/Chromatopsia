from src.csv_line import build_csv_line


def test_default_separator_is_comma() -> None:
    assert build_csv_line(["a", "b", "c"]) == "a,b,c"


def test_custom_separator_is_preserved() -> None:
    assert build_csv_line(["a", "b", "c"], separator="|") == "a|b|c"
