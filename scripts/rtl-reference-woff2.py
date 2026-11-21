"""Convert a Git-pinned licensed Hebrew TTF to a deterministic project-local WOFF2 QA asset.

Only used by cross-platform GitHub Actions; never alters the downloaded TTF or its OFL license.
Requirements (CI-pinned): fonttools==4.59.0 Brotli==1.1.0.
"""
import hashlib
import json
import sys
from pathlib import Path

from fontTools.ttLib import TTFont


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def glyph_inventory(font: TTFont) -> dict:
    if "cmap" not in font or "maxp" not in font:
        raise ValueError("Font is missing cmap/maxp")
    unicode_points = set()
    for table in font["cmap"].tables:
        if table.isUnicode():
            unicode_points.update(table.cmap.keys())
    if not unicode_points:
        raise ValueError("Font has no Unicode coverage")
    return {
        "numGlyphs": int(font["maxp"].numGlyphs),
        "codepoints": sorted(unicode_points),
        "layoutTables": sorted(tag for tag in ("GSUB", "GPOS", "GDEF", "fvar", "gvar") if tag in font),
    }


def main() -> None:
    if len(sys.argv) != 2:
        raise ValueError("Usage: python scripts/rtl-reference-woff2.py ABSOLUTE_PINNED_FONT_DIRECTORY")
    folder = Path(sys.argv[1])
    if not folder.is_absolute():
        raise ValueError("Expected absolute input directory")
    manifest = json.loads((folder / "manifest.json").read_text(encoding="utf-8"))
    if manifest.get("sourceCommit") != "06bfe0d62a98375cb09c942fa18e68bd32cff057":
        raise ValueError("PINNED_FONT_COMMIT_MISMATCH")
    faces = [face for face in manifest["faces"] if face["id"] == "hebrew"]
    if len(faces) != 1:
        raise ValueError("PINNED_HEBREW_FACE_MISSING_OR_DUPLICATE")
    face = faces[0]
    source = folder / face["filename"]
    original = source.read_bytes()
    if sha256(original) != face["fontSha256"]:
        raise ValueError("PINNED_HEBREW_TTF_SHA256_MISMATCH")
    if not (folder / face["licenseFilename"]).is_file():
        raise ValueError("PINNED_HEBREW_LICENSE_MISSING")
    output = folder / "hebrew.woff2"
    if output.exists():
        raise ValueError("REFUSE_TO_OVERWRITE_EXISTING_WOFF2")
    font = TTFont(source, lazy=False)
    try:
        prior = glyph_inventory(font)
        font.flavor = "woff2"
        font.save(output)
    finally:
        font.close()
    contents = output.read_bytes()
    if contents[:4] != b"wOF2":
        raise ValueError("WOFF2_SIGNATURE_MISMATCH")
    decoded = TTFont(output, lazy=False)
    try:
        restored = glyph_inventory(decoded)
    finally:
        decoded.close()
    if prior != restored:
        raise ValueError("WOFF2_ROUNDTRIP_CHANGED_GLYPH_CMAP_OR_LAYOUT_TABLES")
    probe = "שָׁלוֹם"
    if not all(ord(char) in restored["codepoints"] for char in probe if not char.isspace()):
        raise ValueError("WOFF2_HEBREW_NIQQUD_CMAP_INCOMPLETE")
    result = {
        "id": "hebrew", "format": "woff2", "filename": output.name,
        "sourceTtfSha256": face["fontSha256"], "sha256": sha256(contents),
        "originalBytes": len(original), "encodedBytes": len(contents),
        "numGlyphs": restored["numGlyphs"], "codepointCount": len(restored["codepoints"]),
        "layoutTables": restored["layoutTables"],
        "converter": "fonttools 4.59.0 + Brotli 1.1.0",
        "sourceLicense": face["licenseFilename"],
    }
    (folder / "hebrew-woff2.json").write_text(
        json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    print(json.dumps(result, ensure_ascii=False))


if __name__ == "__main__":
    main()
