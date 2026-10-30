"""Build deterministic source downloads; reject stale or malformed checked exports."""
import hashlib
import json
from pathlib import Path
import zipfile

SITE = Path(__file__).resolve().parents[1]
ROOT = SITE.parents[1]
DEST = SITE / "public/downloads"
LICENSE_FILES = ("LICENSE", "NOTICE")


def prepare(name):
    source = ROOT / "examples" / name
    bundle = ROOT / "examples" / f"{name}.luna"
    with zipfile.ZipFile(bundle) as archive:
        manifest = json.loads(archive.read("manifest.json"))
        expected = set(manifest["files"]) | {"manifest.json"}
        if set(archive.namelist()) != expected:
            raise ValueError(f"Unexpected bundle members: {name}")
        for path, digest in manifest["files"].items():
            data = archive.read(path)
            if hashlib.sha256(data).hexdigest() != digest:
                raise ValueError(f"Bundle hash mismatch: {name}/{path}")
            authored = (source / path).read_bytes()
            equivalent = (json.loads(data) == json.loads(authored)
                          if path.endswith(".json") else data == authored)
            if not equivalent:
                raise ValueError(f"Stale export: {name}/{path}; refresh through Luna")
        runtime_files = {p.relative_to(source).as_posix() for p in source.rglob("*.json")
                         if "editor" not in p.relative_to(source).parts
                         and not any(part.startswith(".") for part in p.relative_to(source).parts)}
        if runtime_files != {p for p in manifest["files"] if p.endswith(".json")}:
            raise ValueError(f"Canonical/export membership differs: {name}")
    DEST.mkdir(parents=True, exist_ok=True)
    (DEST / bundle.name).write_bytes(bundle.read_bytes())
    with zipfile.ZipFile(DEST / f"{name}-project.zip", "w", zipfile.ZIP_DEFLATED) as archive:
        for path in sorted(source.rglob("*")):
            relative = path.relative_to(source)
            if not path.is_file() or any(part.startswith(".") for part in relative.parts):
                continue
            info = zipfile.ZipInfo(f"{name}/{relative.as_posix()}", (2026, 10, 29, 0, 0, 0))
            info.compress_type = zipfile.ZIP_DEFLATED
            info.external_attr = 0o100644 << 16
            archive.writestr(info, path.read_bytes())
        for legal_name in LICENSE_FILES:
            info = zipfile.ZipInfo(f"{name}/{legal_name}", (2026, 10, 29, 0, 0, 0))
            info.compress_type = zipfile.ZIP_DEFLATED
            info.external_attr = 0o100644 << 16
            archive.writestr(info, (ROOT / legal_name).read_bytes())
    print(f"Prepared {name} project and playable bundle")


DEST.mkdir(parents=True, exist_ok=True)
for name in LICENSE_FILES:
    (DEST / name).write_bytes((ROOT / name).read_bytes())

for example in ("locked-study", "observatory"):
    prepare(example)

# Screenshot provenance is checked separately from semantic export equality:
# layout changes affect captures but must never enter player bundles.
evidence = json.loads((SITE / "evidence.json").read_text())
for name, expected in evidence["examples"].items():
    digest = hashlib.sha256()

    def visit(directory):
        for path in sorted(directory.iterdir()):
            if path.name.startswith("."):
                continue
            if path.is_dir():
                visit(path)
            elif path.suffix == ".json" or "assets" in path.relative_to(ROOT / "examples" / name).parts:
                digest.update(path.relative_to(ROOT).as_posix().encode())
                digest.update(b"\0")
                digest.update(path.read_bytes())

    visit(ROOT / "examples" / name)
    if digest.hexdigest() != expected:
        raise ValueError(f"Screenshot source changed: {name}; review/refresh captures")
for screenshot in evidence["screenshots"]:
    actual = hashlib.sha256((SITE / screenshot["file"]).read_bytes()).hexdigest()
    if actual != screenshot["sha256"]:
        raise ValueError(f"Screenshot evidence mismatch: {screenshot['file']}")
print(f"Verified source provenance and {len(evidence['screenshots'])} screenshots")
