from src.links import make_link_slug
from src.page_titles import make_page_title


def test_make_page_title() -> None:
    assert make_page_title("Hello World") == "page:hello-world"


def test_make_link_slug() -> None:
    assert make_link_slug("Hello World") == "/docs/hello-world"
