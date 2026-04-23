def format_label(value: str) -> str:
    normalized = " ".join(value.strip().lower().split())
    return f"[{normalized}]"
