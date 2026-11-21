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


# These samples deliberately include combining marks and script-specific
# joining letters. The exact licensed source is checked before conversion;
# a missing codepoint fails rather than silently falling back to a host font.
SCRIPT_PROBES = {
    "hebrew": "שָׁלוֹם",
    "arabic": "السَّلَامُ",
    "urdu": "اردو ڈ ٹ ڑ ں ے",
    "syriac": "ܫܠܡܐ ܒܪܝܟܐ",
}


def convert_face(folder: Path, face: dict, sample: str) -> dict:
    face_id = face["id"]
    source = folder / face["filename"]
    original = source.read_bytes()
    if sha256(original) != face["fontSha256"]:
        raise ValueError("PINNED_" + face_id.upper() + "_TTF_SHA256_MISMATCH")
    license_bytes = (folder / face["licenseFilename"]).read_bytes()
    if sha256(license_bytes) != face["licenseSha256"]:
        raise ValueError("PINNED_" + face_id.upper() + "_LICENSE_SHA256_MISMATCH")
    output = folder / (face_id + ".woff2")
    repeat = folder / (face_id + "-woff2-repro-check.woff2")
    manifest_output = folder / (face_id + "-woff2.json")
    if any(path.exists() for path in (output, repeat, manifest_output)):
        raise ValueError("REFUSE_TO_OVERWRITE_EXISTING_" + face_id.upper() + "_WOFF2")

    # fontTools' default recalcTimestamp=True restamps the OpenType head
    # table: the old Hebrew CI failed reproducibility across three OSes.
    # Preserve original layout, timestamps and glyph bboxes on both passes.
    font = TTFont(source, lazy=False, recalcTimestamp=False, recalcBBoxes=False)
    try:
        prior = glyph_inventory(font)
        font.flavor = "woff2"
        font.save(output)
    finally:
        font.close()
    contents = output.read_bytes()
    probe = TTFont(source, lazy=False, recalcTimestamp=False, recalcBBoxes=False)
    try:
        probe.flavor = "woff2"
        probe.save(repeat)
    finally:
        probe.close()
    try:
        if repeat.read_bytes() != contents:
            raise ValueError("NONDETERMINISTIC_" + face_id.upper() + "_WOFF2_CONVERSION")
    finally:
        repeat.unlink()
    if contents[:4] != b"wOF2":
        raise ValueError(face_id.upper() + "_WOFF2_SIGNATURE_MISMATCH")
    decoded = TTFont(output, lazy=False)
    try:
        restored = glyph_inventory(decoded)
    finally:
        decoded.close()
    if prior != restored:
        raise ValueError(face_id.upper() + "_WOFF2_ROUNDTRIP_CHANGED_GLYPHS_OR_LAYOUT")
    required = {ord(char) for char in sample if not char.isspace()}
    missing = sorted(required.difference(restored["codepoints"]))
    if missing:
        raise ValueError(face_id.upper() + "_WOFF2_MISSING_SCRIPT_CODEPOINTS: " + str(missing))
    result = {
        "id": face_id, "format": "woff2", "filename": output.name,
        "sourceTtfSha256": face["fontSha256"], "sha256": sha256(contents),
        "originalBytes": len(original), "encodedBytes": len(contents),
        "numGlyphs": restored["numGlyphs"], "codepointCount": len(restored["codepoints"]),
        "layoutTables": restored["layoutTables"],
        "converter": "fonttools 4.59.0 + Brotli 1.1.0",
        "sourceLicense": face["licenseFilename"],
        "sourceLicenseSha256": face["licenseSha256"],
        "probeText": sample,
    }
    manifest_output.write_text(
        json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    return result


def main() -> None:
    if len(sys.argv) != 2:
        raise ValueError("Usage: python scripts/rtl-reference-woff2.py ABSOLUTE_PINNED_FONT_DIRECTORY")
    folder = Path(sys.argv[1])
    if not folder.is_absolute():
        raise ValueError("Expected absolute input directory")
    manifest = json.loads((folder / "manifest.json").read_text(encoding="utf-8"))
    if manifest.get("sourceCommit") != "06bfe0d62a98375cb09c942fa18e68bd32cff057":
        raise ValueError("PINNED_FONT_COMMIT_MISMATCH")
    result = []
    for face_id, sample in SCRIPT_PROBES.items():
        matches = [face for face in manifest["faces"] if face["id"] == face_id]
        if len(matches) != 1:
            raise ValueError("PINNED_" + face_id.upper() + "_FACE_MISSING_OR_DUPLICATE")
        result.append(convert_face(folder, matches[0], sample))
    print(json.dumps({"sourceCommit": manifest["sourceCommit"], "converted": result}, ensure_ascii=False))


if __name__ == "__main__":
    main()
