"""Adversarial checks against a real downloaded Studio artifact, without altering it."""
import copy
import importlib.util
import io
import json
import re
from pathlib import Path
import sys
import tempfile
import zipfile

spec = importlib.util.spec_from_file_location(
    "offline_audit", Path(__file__).with_name("rtl-audit-offline-artifact.py"))
audit = importlib.util.module_from_spec(spec)
spec.loader.exec_module(audit)


def pack(entries):
    stream = io.BytesIO()
    with zipfile.ZipFile(stream, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        for name, data in entries.items():
            archive.writestr(name, data)
    return stream.getvalue()


def reject(entries, directory, name, expected):
    path = directory / (name + ".zip")
    path.write_bytes(pack(entries))
    try:
        audit.audit(path)
    except ValueError as error:
        audit.require(expected in str(error), name + ": wrong failure: " + str(error))
    else:
        raise RuntimeError(name + ": accepted corrupted evidence")
    print("PASS " + name)


def main(path):
    audit.audit(path)
    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp)
        def reject_matrix(expected):
            try:
                audit.matrix_artifacts(root, "woff2")
            except ValueError as error:
                audit.require(expected in str(error), "wrong matrix failure: " + str(error))
            else:
                raise RuntimeError("accepted incomplete or ambiguous matrix")
        reject_matrix("unexpected matrix artifact inventory")
        for os in audit.PLATFORMS:
            directory = root / (audit.PREFIXES["woff2"] + os)
            directory.mkdir()
            (directory / "raw.zip").write_bytes(b"inventory-only test fixture")
        audit.require(len(audit.matrix_artifacts(root, "woff2")) == 3, "missing matrix inputs")
        extra = root / (audit.PREFIXES["woff2"] + "ubuntu-24.04") / "duplicate.zip"
        extra.write_bytes(b"unexpected")
        reject_matrix("expected exactly one raw artifact file")
        extra.unlink()
        (root / "unexpected").mkdir()
        reject_matrix("unexpected matrix artifact inventory")
        print("PASS exact matrix inventory")
    with zipfile.ZipFile(path) as archive:
        original = audit.members(archive)
    report = json.loads(original["result.json"])
    actual_platform = report["scope"].split(" ", 1)[0]
    actual_variant = "woff1" if "scriptWoff" in report else "woff2"
    audit.audit(path, actual_platform, actual_variant)
    for platform, variant, expected in [
        ("not-a-platform", actual_variant, "unexpected artifact platform"),
        (actual_platform, "woff2" if actual_variant == "woff1" else "woff1", "unexpected archived font format mix"),
    ]:
        try:
            audit.audit(path, platform, variant)
        except ValueError as error:
            audit.require(expected in str(error), "wrong binding failure: " + str(error))
        else:
            raise RuntimeError("accepted mislabeled archive")
        print("PASS " + expected)
    with tempfile.TemporaryDirectory() as tmp:
        directory = Path(tmp)
        modified = copy.deepcopy(report)
        modified["offlineArchive"]["sha256"] = "0" * 64
        reject({**original, "result.json": json.dumps(modified)}, directory,
               "receipt-digest", "offline archive receipt")

        # Native writer evidence is mandatory, not just diagnostic. Keep the
        # genuine archive and final Unicode intact while corrupting receipts.
        def patch_receipts(value):
            return [r for r in value["sourceWriteReceipts"]
                    if r["endpoint"] == "file-mutations/patch-element/index.html"]

        for name, mutate, expected in [
            ("missing-native-receipts", lambda value: value.pop("sourceWriteReceipts"),
             "missing native write receipts"),
            ("duplicate-native-write", lambda value: value["sourceWriteReceipts"].append(
                copy.deepcopy(patch_receipts(value)[0])), "native write count differs"),
            ("wrong-native-target", lambda value: patch_receipts(value)[2]["target"].update(
                hfId="hf-mnw2"), "native write target differs"),
            ("wrong-native-unicode", lambda value: patch_receipts(value)[3]["operations"][0].update(
                value="اردو ٹ ڈ ڑ ں ے"), "native write Unicode or operation differs"),
            ("failed-native-write", lambda value: patch_receipts(value)[1].update(status=409),
             "native write did not acknowledge"),
            ("duplicate-native-request-hash", lambda value: patch_receipts(value)[1].update(
                requestBodySha256=patch_receipts(value)[0]["requestBodySha256"]),
             "invalid or repeated native request digest"),
            ("duplicate-native-etag", lambda value: patch_receipts(value)[1].update(
                responseEtag=patch_receipts(value)[0]["responseEtag"]),
             "invalid or repeated native file ETag"),
            ("unbound-native-etag", lambda value: patch_receipts(value)[-1].update(
                responseEtag='"sha256:' + '0' * 64 + '"'),
             "final acknowledged native file ETag differs"),
        ]:
            modified = copy.deepcopy(report)
            mutate(modified)
            reject({**original, "result.json": json.dumps(modified)}, directory, name, expected)

        with zipfile.ZipFile(io.BytesIO(original["offline-project.zip"])) as archive:
            nested = audit.members(archive)
        manifest = json.loads(nested["openmotion-projects.json"])
        project = manifest["projects"][0]
        html_path = project["root"] + "/index.html"

        def repack(nested_entries, report_value):
            data = pack(nested_entries)
            receipt = {"filename": "offline-project.zip", "bytes": len(data), "sha256": audit.digest(data)}
            modified_report = copy.deepcopy(report_value)
            modified_report["offlineArchive"] = receipt
            audit.one_check(modified_report, "Offline ZIP reimport retained exact edited Unicode and six licensed font assets")["offlineArchive"] = receipt
            return {**original, "offline-project.zip": data, "result.json": json.dumps(modified_report)}

        reject(repack({**nested, html_path: nested[html_path] + b" "}, report), directory,
               "manifest-file", "manifest byte mismatch")
        reject(repack({**nested, project["root"] + "/unlisted.txt": b"x"}, report), directory,
               "unlisted-file", "unlisted project ZIP payload")

        # Recompute both outer receipt and inner manifest to prove the original
        # logical Unicode check cannot be bypassed just by updating ZIP hashes.
        edited = copy.deepcopy(manifest)
        edit = audit.one_check(report, "Actual Studio edited all five Semitic scripts without changing Ethiopic/LTR controls")["scriptEdits"][0]
        stale = nested[html_path] + edit["original"].encode("utf-8")
        item = next(f for f in edited["projects"][0]["files"] if f["path"] == "index.html")
        item.update(bytes=len(stale), sha256=audit.digest(stale))
        reject(repack({**nested, html_path: stale, "openmotion-projects.json": json.dumps(edited)}, report),
               directory, "stale-unicode", "archived source lost or resurrected Unicode")

        # Preserve all final strings and all archive digests, but break their
        # association with the actual authored elements.
        def reject_html(html, name, expected):
            changed = copy.deepcopy(manifest)
            value = html.encode("utf-8")
            item = next(f for f in changed["projects"][0]["files"] if f["path"] == "index.html")
            item.update(bytes=len(value), sha256=audit.digest(value))
            reject(repack({**nested, html_path: value,
                           "openmotion-projects.json": json.dumps(changed)}, report),
                   directory, name, expected)

        html = nested[html_path].decode("utf-8")
        edits = audit.one_check(report, "Actual Studio edited all five Semitic scripts without changing Ethiopic/LTR controls")["scriptEdits"]
        first, second = edits[0]["text"], edits[1]["text"]
        sentinel = "__RTL_TEST_SWAP_SENTINEL__"
        audit.require(sentinel not in html, "test sentinel already present")
        swapped = html.replace(first, sentinel, 1).replace(second, first, 1).replace(sentinel, second, 1)
        reject_html(swapped, "swapped-row-text", "fixture row Unicode differs")
        reject_html(html.replace(first, "<!--" + first + "-->", 1),
                    "comment-only-text", "fixture row Unicode differs")
        reject_html(html.replace('id="latin" dir="ltr"', 'id="latin" dir="rtl"', 1),
                    "reversed-ltr-control", "fixture row language or direction differs")
        reject_html(html.replace("</body>", '<div id="arabic" dir="rtl" lang="ar">' +
                                 first + "</div></body>", 1),
                    "duplicate-row", "duplicate or misplaced fixture row")

        reject_html(html.replace('data-hf-id="hf-1tc8"', 'data-hf-id="hf-reminted-persian"', 1),
                    "reminted-native-row", "fixture row source identity differs")

        # Real timed-caption fixture: keep parent/word identities, logical
        # Unicode order, and source timing even if every archive hash is rebuilt.
        he = re.search(r'<span[^>]*id="caption-he"[^>]*>.*?</span>', html).group()
        ar = re.search(r'<span[^>]*id="caption-ar"[^>]*>.*?</span>', html).group()
        he_id = re.search(r'data-hf-id="([^"]+)"', he).group(1)
        ar_id = re.search(r'data-hf-id="([^"]+)"', ar).group(1)
        caption_sentinel = "__RTL_TEST_CAPTION_SWAP__"
        audit.require(caption_sentinel not in html, "caption sentinel already present")
        swapped_words = html.replace(he, caption_sentinel, 1).replace(ar, he, 1).replace(caption_sentinel, ar, 1)
        reject_html(html.replace(he, "", 1), "missing-caption-word", "caption fixture inventory differs")
        reject_html(swapped_words, "reordered-caption-words", "caption logical word order differs")
        reject_html(html.replace(ar, ar.replace(ar_id, he_id), 1),
                    "duplicate-caption-source-id", "duplicate caption source identity")
        reject_html(html.replace(he, he.replace(he_id, "hf-reminted-caption"), 1),
                    "reminted-caption-source-id", "caption source identity changed")
        swapped_ids = html.replace(he, he.replace(he_id, ar_id), 1).replace(ar, ar.replace(ar_id, he_id), 1)
        reject_html(swapped_ids, "swapped-caption-source-ids", "caption source identity changed")
        parent = re.search(r'<div[^>]*id="timed-caption"[^>]*>.*?</div>', html).group()
        reject_html(html.replace(parent, "<template>" + parent + "</template>", 1),
                    "inert-caption-template", "caption parent outside authored composition")
        timing = 'id="timed-caption" dir="rtl" lang="he" data-start="0" data-duration="1"'
        audit.require(timing in html, "expected timed caption fixture missing")
        reject_html(html.replace(timing, timing.replace('data-duration="1"', 'data-duration="0.5"'), 1),
                    "shortened-caption-parent", "caption parent timing or track differs")
        reject_html(html.replace(he, "", 1).replace("</body>", he + "</body>", 1),
                    "orphan-caption-word", "caption word outside authored parent")

        modified = copy.deepcopy(report)
        assets = audit.one_check(modified, "Offline ZIP reimport retained exact edited Unicode and six licensed font assets")["assets"]
        assets[0]["sha256"] = "0" * 64
        reject({**original, "result.json": json.dumps(modified)}, directory,
               "font-receipt", "font receipt byte mismatch")
        reject({**original, "../unsafe": b"x"}, directory, "unsafe-member", "unsafe or non-file ZIP member")


if __name__ == "__main__":
    if len(sys.argv) != 2:
        raise SystemExit("usage: python rtl-audit-offline-artifact-test.py ARTIFACT.zip")
    main(Path(sys.argv[1]))
