def make_link_slug(title: str) -> str:
    slug = "-".join(title.strip().lower().split())
    return f"/docs/{slug}"
