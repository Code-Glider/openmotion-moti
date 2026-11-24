"""Independent, read-only audit of a downloaded RTL Studio Actions artifact.

This verifies actual archive bytes with Python's ZIP reader rather than trusting
producer JSON or the production importer's ZIP implementation. It is not a
substitute for real Studio, rendering, or cross-platform acceptance.
"""
import argparse
from collections import Counter
import hashlib
from html.parser import HTMLParser
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


class FixtureRows(HTMLParser):
    """Read the seven plain-text fixture elements, never comments or scripts."""

    def __init__(self, expected):
        super().__init__(convert_charrefs=True)
        self.expected = expected
        self.rows = {}
        self.active = None
        self.in_body = False

    def handle_starttag(self, tag, attrs):
        require(self.active is None, "nested markup in fixture row: " + str(self.active))
        if tag == "body":
            self.in_body = True
        ids = [value for key, value in attrs if key == "id"]
        matching = [row for row in ids if row in self.expected]
        if not matching:
            return
        row = matching[0]
        require(len(ids) == 1 and self.in_body and tag == "div" and row not in self.rows,
                "duplicate or misplaced fixture row: " + row)
        _, lang, direction = self.expected[row]
        require([value for key, value in attrs if key == "lang"] == [lang] and
                [value for key, value in attrs if key == "dir"] == [direction],
                "fixture row language or direction differs: " + row)
        self.rows[row] = ""
        self.active = row

    def handle_endtag(self, tag):
        if self.active is not None:
            require(tag == "div", "unclosed fixture row: " + self.active)
            self.active = None
        if tag == "body":
            self.in_body = False

    def handle_data(self, data):
        if self.active is not None:
            self.rows[self.active] += data


def verify_fixture_rows(html, expected):
    parser = FixtureRows(expected)
    parser.feed(html)
    parser.close()
    require(parser.active is None and set(parser.rows) == set(expected),
            "fixture row inventory differs")
    for row, (text, _, _) in expected.items():
        require(parser.rows[row] == text, "fixture row Unicode differs: " + row)


class CaptionFixture(HTMLParser):
    """Inspect the known untransformed timed-caption fixture, not arbitrary HTML."""

    EXPECTED = {"timed-caption": ("div", "he", "שָׁלוֹם السَّلَامُ"),
                "caption-he": ("span", "he", "שָׁלוֹם"),
                "caption-ar": ("span", "ar", "السَّلَامُ")}
    # These deterministic source identities are observed in all six qualified
    # baseline archives. Re-minting or swapping unique IDs still breaks
    # authored identity. Deliberate fixture changes require requalification.
    SOURCE_IDS = {"timed-caption": "hf-4n47", "caption-he": "hf-qtiz", "caption-ar": "hf-g1we"}
    VOID_TAGS = frozenset(("area", "base", "br", "col", "embed", "hr", "img",
                           "input", "link", "meta", "param", "source", "track", "wbr"))

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.active = []
        self.rows = {}
        self.ids = {}
        self.all_hf = Counter()
        self.in_body = False
        self.word_order = []
        self.stack = []

    def handle_starttag(self, tag, attrs):
        def values(key):
            return [value for name, value in attrs if name == key]
        self.all_hf.update(values("data-hf-id"))
        parent_path = self.stack.copy()
        if tag not in self.VOID_TAGS:
            self.stack.append((tag, tuple(values("id"))))
        if tag == "body":
            self.in_body = True
        matching = [value for value in values("id") if value in self.EXPECTED]
        if not matching:
            require(not self.active, "unexpected markup inside timed caption fixture")
            return
        row = matching[0]
        expected_tag, lang, _ = self.EXPECTED[row]
        require(len(values("id")) == 1 and self.in_body and row not in self.rows and tag == expected_tag,
                "duplicate or misplaced caption element: " + row)
        require(values("lang") == [lang] and values("dir") == ["rtl"],
                "caption language or direction differs: " + row)
        hf = values("data-hf-id")
        require(len(hf) == 1 and bool(hf[0]), "missing caption source identity: " + row)
        if row == "timed-caption":
            require(not self.active, "nested timed caption parent")
            require(parent_path == [("html", ()), ("body", ()), ("div", ("main",))],
                    "caption parent outside authored composition")
            require(values("data-start") == ["0"] and values("data-duration") == ["1"] and
                    values("data-track-index") == ["7"], "caption parent timing or track differs")
        else:
            require(self.active == ["timed-caption"], "caption word outside authored parent: " + row)
            self.word_order.append(row)
        self.ids[row] = hf[0]
        self.rows[row] = ""
        self.active.append(row)

    def handle_startendtag(self, tag, attrs):
        # Only actual HTML void elements may self-close in this fixture.
        require(tag in self.VOID_TAGS, "unexpected self-closing fixture element")
        self.handle_starttag(tag, attrs)

    def handle_endtag(self, tag):
        require(bool(self.stack) and self.stack[-1][0] == tag,
                "unbalanced fixture HTML: " + tag)
        self.stack.pop()
        if self.active:
            row = self.active[-1]
            require(tag == self.EXPECTED[row][0], "unclosed caption element: " + row)
            self.active.pop()
        if tag == "body":
            self.in_body = False

    def handle_data(self, data):
        for row in self.active:
            self.rows[row] += data


def verify_caption_fixture(html):
    parser = CaptionFixture()
    parser.feed(html)
    parser.close()
    require(not parser.active and not parser.stack and set(parser.rows) == set(parser.EXPECTED),
            "caption fixture inventory differs")
    require(parser.word_order == ["caption-he", "caption-ar"], "caption logical word order differs")
    require(all(parser.all_hf[hf] == 1 for hf in parser.ids.values()),
            "duplicate caption source identity")
    require(parser.ids == parser.SOURCE_IDS, "caption source identity changed")
    for row, (_, _, text) in parser.EXPECTED.items():
        require(parser.rows[row] == text, "caption fixture Unicode differs: " + row)
    return sorted(parser.rows)


def audit(path, expected_platform=None, expected_variant=None):
    require(path.stat().st_size <= MAX_BYTES, "outer ZIP too large")
    with zipfile.ZipFile(path) as archive:
        outer = members(archive)
    report = json.loads(outer["result.json"])
    require(report["passed"] is True, "producer failed")
    if expected_platform is not None:
        require(report["scope"] == expected_platform + " Studio browser, source-backed UI edit and native exported MP4",
                "unexpected artifact platform: " + expected_platform)
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
    if expected_variant is not None:
        suffix = {"woff1": ".woff", "woff2": ".woff2"}[expected_variant]
        require(sorted(PurePosixPath(n).suffix for n in fonts) == sorted([suffix] * 4 + [".ttf"] * 2),
                "unexpected archived font format mix: " + expected_variant)
    for name in fonts:
        magic = {".ttf": b"\x00\x01\x00\x00", ".otf": b"OTTO",
                 ".woff": b"wOFF", ".woff2": b"wOF2"}.get(PurePosixPath(name).suffix)
        require(magic is not None and files[name].startswith(magic), "font signature mismatch: " + name)
    html = files["index.html"].decode("utf-8")
    script_check = one_check(report, "Actual Studio edited all five Semitic scripts without changing Ethiopic/LTR controls")
    edits = script_check["scriptEdits"]
    require([e["id"] for e in edits] == ["arabic", "persian", "urdu", "syriac"], "wrong script edit inventory")
    for edit in edits:
        require(edit["text"] in html and edit["original"] not in html,
                "archived source lost or resurrected Unicode: " + edit["id"])
    hebrew = one_check(report, "UI Content editor persisted Hebrew niqqud and mixed English/numerals")
    require(hebrew["newText"] in html and "שָׁלוֹם OpenMotion 2026" not in html,
            "archived Hebrew edit missing or stale")
    # This deliberately targets the known qualification fixture, not arbitrary
    # project HTML. Global substring checks alone accept swapped clip contents
    # and edited text hidden in a comment. Bind each row to its own identity.
    controls = ["ሰላም ኢትዮጵያ", "Render ABC-123 at 10:30"]
    require(script_check["ltrControls"] == controls, "LTR control receipt differs")
    rows = {"label": (hebrew["newText"], "he", "rtl"),
            "ethiopic": (controls[0], "am", "ltr"),
            "latin": (controls[1], "en", "ltr")}
    for edit, lang in zip(edits, ("ar", "fa", "ur", "syr")):
        rows[edit["id"]] = (edit["text"], lang, "rtl")
    verify_fixture_rows(html, rows)
    caption_rows = verify_caption_fixture(html)
    return {"artifactSha256": digest(path.read_bytes()), "offlineSha256": expected["sha256"],
            "manifestFiles": len(files), "fontLicensePairs": len(fonts),
            "verifiedFixtureRows": sorted(rows), "verifiedCaptionRows": caption_rows, "verified": True}


PLATFORMS = {"ubuntu-24.04": "linux", "macos-15": "darwin", "windows-2025": "win32"}
PREFIXES = {"woff1": "rtl-studio-woff1-", "woff2": "rtl-studio-mp4-parity-"}


def matrix_artifacts(root, variant):
    """Exactly one raw Actions archive from each named OS; no partial success."""
    prefix = PREFIXES[variant]
    require(root.is_dir(), "missing matrix artifact directory")
    expected = {prefix + os for os in PLATFORMS}
    require({p.name for p in root.iterdir()} == expected, "unexpected matrix artifact inventory")
    found = {}
    for os in PLATFORMS:
        directory = root / (prefix + os)
        require(directory.is_dir() and not directory.is_symlink(), "not an artifact directory: " + os)
        entries = list(directory.iterdir())
        require(len(entries) == 1 and entries[0].is_file() and not entries[0].is_symlink(),
                "expected exactly one raw artifact file: " + os)
        found[os] = entries[0]
    return found


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("artifacts", nargs="*", type=Path)
    parser.add_argument("--matrix-root", type=Path)
    parser.add_argument("--variant", choices=PREFIXES)
    args = parser.parse_args()
    if args.matrix_root is not None:
        if args.artifacts or args.variant is None:
            parser.error("--matrix-root requires --variant and no positional artifacts")
        paths = matrix_artifacts(args.matrix_root, args.variant)
        results = [{"os": os, "variant": args.variant, "artifact": str(p),
                    **audit(p, PLATFORMS[os], args.variant)} for os, p in paths.items()]
    else:
        if not args.artifacts or args.variant is not None:
            parser.error("supply artifact paths or --matrix-root with --variant")
        results = [{"artifact": str(p), **audit(p)} for p in args.artifacts]
    print(json.dumps(results, indent=2))


if __name__ == "__main__":
    main()
