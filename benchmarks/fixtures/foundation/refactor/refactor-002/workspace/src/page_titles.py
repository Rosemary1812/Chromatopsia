def make_page_title(title: str) -> str:
    slug = "-".join(title.strip().lower().split())
    return f"page:{slug}"
