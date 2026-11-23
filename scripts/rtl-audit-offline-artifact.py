"""Independent, read-only audit of a downloaded RTL Studio Actions artifact.

This verifies actual archive bytes with Python's ZIP reader rather than trusting
producer JSON or the production importer's ZIP implementation. It is not a
substitute for real Studio, rendering, or cross-platform acceptance.
"""
import argparse
import hashlib
import io
import json
from pathlib import Path, PurePosixPath
import zipfile

MAX_BYTES = 32 * 1024 * 1024
MAX_ENTRIES = 128


def require(condition, message):
    if not condition:
        raise ValueError(message)


def digest(data):
    return hashlib.sha256(data).hexdigest()


def members(archive):
    infos = archive.infolist()
    require(len(infos) <= MAX_ENTRIES, "too many ZIP entries")
    require(sum(i.file_size for i in infos) <= MAX_BYTES, "expanded ZIP too large")
    result = {}
    folded = set()
    for info in infos:
        name = info.filename
        p = PurePosixPath(name)
        require(not p.is_absolute() and str(p) == name and
                not set(p.parts).intersection({".", ".."}) and
                not any(c in name for c in ("\\", ":", "\x00")) and
                not info.is_dir(), "unsafe or non-file ZIP member: " + name)
        require(name.casefold() not in folded, "duplicate ZIP member: " + name)
        folded.add(name.casefold())
        result[name] = archive.read(info)  # stdlib checks decompression and CRC
    return result


def one_check(report, name):
    checks = [c for c in report["checks"] if c["name"] == name]
    require(len(checks) == 1, "missing or duplicate receipt: " + name)
    return checks[0]


def audit(path):
    require(path.stat().st_size <= MAX_BYTES, "outer ZIP too large")
    with zipfile.ZipFile(path) as archive:
        outer = members(archive)
    report = json.loads(outer["result.json"])
    require(report["passed"] is True, "producer failed")
    receipt = one_check(report, "Offline ZIP reimport retained exact edited Unicode and six licensed font assets")
    data = outer["offline-project.zip"]
    expected = {"filename": "offline-project.zip", "bytes": len(data), "sha256": digest(data)}
    require(report["offlineArchive"] == expected and receipt["offlineArchive"] == expected,
            "offline archive receipt does not match actual bytes")
    with zipfile.ZipFile(io.BytesIO(data)) as archive:
        actual = members(archive)
    manifest = json.loads(actual.pop("openmotion-projects.json"))
    require(manifest["format"] == "openmotion.project-archive" and manifest["version"] == 1,
            "unexpected project archive format")
    require(len(manifest["projects"]) == 1, "expected one archived project")
    project = manifest["projects"][0]
    root = project["root"] + "/"
    require(len(PurePosixPath(project["root"]).parts) == 2 and root.startswith("projects/"),
            "unexpected project root")
    files = {}
    for item in project["files"]:
        name = item["path"]
        require(name not in files, "duplicate manifest path: " + name)
        value = actual.pop(root + name)
        require(len(value) == item["bytes"] and digest(value) == item["sha256"],
                "manifest byte mismatch: " + name)
        files[name] = value
    require(not actual, "unlisted project ZIP payload")
    assets = receipt["assets"]
    require(len(assets) == 12 and len({a["path"] for a in assets}) == 12,
            "expected twelve distinct font/license receipts")
    actual_fonts = {n for n in files if n.startswith("assets/fonts/")}
    require(actual_fonts == {a["path"] for a in assets}, "font asset inventory differs")
    for a in assets:
        require(digest(files[a["path"]]) == a["sha256"], "font receipt byte mismatch: " + a["path"])
    fonts = {n for n in actual_fonts if not n.endswith(".license.txt")}
    licenses = actual_fonts - fonts
    require(len(fonts) == len(licenses) == 6 and
            {str(PurePosixPath(n).with_suffix(".license.txt")) for n in fonts} == licenses,
            "missing or mismatched font/license pairs")
    for name in fonts:
        magic = {".ttf": b"\x00\x01\x00\x00", ".otf": b"OTTO",
                 ".woff": b"wOFF", ".woff2": b"wOF2"}.get(PurePosixPath(name).suffix)
        require(magic is not None and files[name].startswith(magic), "font signature mismatch: " + name)
    html = files["index.html"].decode("utf-8")
    edits = one_check(report, "Actual Studio edited all five Semitic scripts without changing Ethiopic/LTR controls")["scriptEdits"]
    require([e["id"] for e in edits] == ["arabic", "persian", "urdu", "syriac"], "wrong script edit inventory")
    for edit in edits:
        require(edit["text"] in html and edit["original"] not in html,
                "archived source lost or resurrected Unicode: " + edit["id"])
    hebrew = one_check(report, "UI Content editor persisted Hebrew niqqud and mixed English/numerals")
    require(hebrew["newText"] in html and "שָׁלוֹם OpenMotion 2026" not in html,
            "archived Hebrew edit missing or stale")
    return {"artifactSha256": digest(path.read_bytes()), "offlineSha256": expected["sha256"],
            "manifestFiles": len(files), "fontLicensePairs": len(fonts), "verified": True}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("artifacts", nargs="+", type=Path)
    args = parser.parse_args()
    print(json.dumps([{"artifact": str(p), **audit(p)} for p in args.artifacts], indent=2))


if __name__ == "__main__":
    main()
