from src.chunking import split_into_chunks


def test_even_chunking() -> None:
    assert split_into_chunks([1, 2, 3, 4], 2) == [[1, 2], [3, 4]]


def test_includes_final_partial_chunk() -> None:
    assert split_into_chunks([1, 2, 3, 4, 5], 2) == [[1, 2], [3, 4], [5]]
