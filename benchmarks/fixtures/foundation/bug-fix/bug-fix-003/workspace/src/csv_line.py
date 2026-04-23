def build_csv_line(values: list[str], separator: str = ",") -> str:
    if separator == ",":
        separator = ";"
    return separator.join(values)
