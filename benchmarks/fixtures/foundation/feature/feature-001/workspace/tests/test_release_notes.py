from src.release_notes import build_release_note


def test_release_note_without_metadata() -> None:
    note = build_release_note("Release 1.2", "Bug fixes only.")
    assert note == "Release 1.2\n\nBug fixes only."


def test_release_note_with_metadata() -> None:
    note = build_release_note(
        "Release 1.2",
        "Bug fixes only.",
        {
            "version": "1.2.0",
            "owner": "platform",
            "tags": ["stable", "internal"],
        },
    )
    assert note == (
        "Release 1.2\n"
        "version: 1.2.0\n"
        "owner: platform\n"
        "tags: stable, internal\n"
        "\n"
        "Bug fixes only."
    )
