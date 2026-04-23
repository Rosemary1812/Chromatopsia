from src.config_parser import parse_bool
from src.feature_flags import is_feature_enabled


def test_truthy_values() -> None:
    assert is_feature_enabled(" yes ")
    assert parse_bool("ON")


def test_falsy_values() -> None:
    assert not is_feature_enabled("off")
    assert not parse_bool("0")
