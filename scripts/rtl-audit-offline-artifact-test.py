"""Adversarial checks against a real downloaded Studio artifact, without altering it."""
import copy
import importlib.util
import io
import json
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
    with zipfile.ZipFile(path) as archive:
        original = audit.members(archive)
    report = json.loads(original["result.json"])
    with tempfile.TemporaryDirectory() as tmp:
        directory = Path(tmp)
        modified = copy.deepcopy(report)
        modified["offlineArchive"]["sha256"] = "0" * 64
        reject({**original, "result.json": json.dumps(modified)}, directory,
               "receipt-digest", "offline archive receipt")

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
