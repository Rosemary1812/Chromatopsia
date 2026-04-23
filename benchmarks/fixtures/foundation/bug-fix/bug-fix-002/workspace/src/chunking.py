def split_into_chunks(values: list[int], size: int) -> list[list[int]]:
    chunks: list[list[int]] = []
    for start in range(0, len(values) - size, size):
        chunks.append(values[start:start + size])
    return chunks
