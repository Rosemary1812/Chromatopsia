def normalize_query(value: str) -> str:
    return " ".join(value.strip().lower().split())
