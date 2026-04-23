def build_release_note(title: str, body: str, metadata: dict[str, object] | None = None) -> str:
    metadata = metadata or {}
    return f"{title}\n\n{body}"
