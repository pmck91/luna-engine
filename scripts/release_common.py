"""Shared release identity, archive verification and extraction (Python 3.12+)."""
import hashlib
import json
from pathlib import Path, PurePosixPath
import platform
import stat
import subprocess
import tarfile
import tomllib
import zipfile

ROOT = Path(__file__).resolve().parents[1]
TARGETS = json.loads((ROOT / "scripts/release-targets.json").read_text(encoding="utf-8"))
EXAMPLES = ("locked-study", "packing-study", "parser-gallery", "procedure-workshop",
            "keeper-quest", "timer-workshop", "routine-workshop", "undo-workshop", "observatory")
LICENSE_FILES = ("LICENSE", "NOTICE")


def version():
    return tomllib.loads((ROOT / "Cargo.toml").read_text(encoding="utf-8"))["workspace"]["package"]["version"]


def output(*command):
    return subprocess.check_output(command, cwd=ROOT, text=True, encoding="utf-8").strip()


def native_target():
    host = next(line[6:] for line in output("rustc", "-vV").splitlines() if line.startswith("host: "))
    return next(item for item in TARGETS if item["target"] == host)


def package_name(target, app_version=None):
    return f"luna-engine-v{app_version or version()}-{target['platform']}"


def package_path(target):
    return ROOT / "dist" / (package_name(target) + target["extension"])


def binary_directory(target):
    # Windows uses explicit --target so CRT flags do not apply to host proc
    # macros/build scripts. Its executables therefore live in a target subdir.
    return ROOT / "target" / target["target"] / "release" if target["cargo_args"] else ROOT / "target/release"


def sha256(path):
    with path.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def safe_member(name):
    path = PurePosixPath(name)
    if (not name or "\\" in name or ":" in name or path.is_absolute()
            or any(part in ("", ".", "..") or part.endswith((" ", ".")) for part in name.split("/"))):
        raise ValueError(f"Unsafe archive member: {name!r}")
    reserved = {"CON", "PRN", "AUX", "NUL"} | {f"{prefix}{number}" for prefix in ("COM", "LPT") for number in range(1, 10)}
    if any(part.split('.')[0].upper() in reserved for part in path.parts):
        raise ValueError(f"Windows-reserved archive member: {name!r}")
    return path


def verify_archive(archive_path, *, revision=None, target=None):
    """Verify hashes, membership and identity before extracting any release files."""
    expected_digest = archive_path.with_name(archive_path.name + ".sha256").read_text(encoding="utf-8")
    if expected_digest != f"{sha256(archive_path)}  {archive_path.name}\n":
        raise ValueError(f"Checksum mismatch: {archive_path.name}")
    files = {}
    modes = {}
    if archive_path.suffix == ".zip":
        with zipfile.ZipFile(archive_path) as archive:
            for item in archive.infolist():
                safe_member(item.filename)
                if item.filename in files or item.is_dir() or stat.S_ISLNK(item.external_attr >> 16):
                    raise ValueError(f"Unexpected/duplicate ZIP entry: {item.filename}")
                files[item.filename] = archive.read(item)
    else:
        with tarfile.open(archive_path, "r:gz") as archive:
            for item in archive:
                safe_member(item.name)
                if not item.isfile() or item.name in files:
                    raise ValueError(f"Unexpected/duplicate tar entry: {item.name}")
                files[item.name] = archive.extractfile(item).read()
                modes[item.name] = item.mode
    roots = {PurePosixPath(name).parts[0] for name in files}
    if len(roots) != 1:
        raise ValueError("Archive must have exactly one top-level directory")
    root = roots.pop()
    metadata = json.loads(files[f"{root}/build.json"])
    selected = next(item for item in TARGETS if item["target"] == metadata["target"])
    if target is not None and selected != target:
        raise ValueError("Archive target does not match native host")
    if metadata["version"] != version() or (revision and metadata["revision"] != revision):
        raise ValueError("Archive version/revision does not match release source")
    if root != package_name(selected) or archive_path.name != root + selected["extension"]:
        raise ValueError("Archive name does not match its metadata")
    expected = {f"{root}/{path}" for path in metadata["files"]} | {f"{root}/build.json"}
    if set(files) != expected:
        raise ValueError("Archive membership differs from build manifest")
    folded = [name.casefold() for name in files]
    if len(folded) != len(set(folded)):
        raise ValueError("Archive contains case-insensitive path collisions")
    for name, digest in metadata["files"].items():
        if hashlib.sha256(files[f"{root}/{name}"]).hexdigest() != digest:
            raise ValueError(f"Packaged file digest mismatch: {name}")
    suffix = ".exe" if selected["platform"].startswith("windows-") else ""
    required = {"README.md", "START-HERE.txt", "examples/README.md", "luna" + suffix, "luna-editor" + suffix}
    required.update(LICENSE_FILES)
    required |= {f"examples/{example}.luna" for example in EXAMPLES}
    required |= {f"examples/{example}/game.json" for example in EXAMPLES}
    if not required <= metadata["files"].keys():
        raise ValueError("Archive is missing required executable/example/instruction/licence files")
    if modes and any(not modes[f"{root}/{name}" + suffix] & 0o111 for name in ("luna", "luna-editor")):
        raise ValueError("Unix executables have lost executable permissions")
    if any(part.startswith(".") or part in ("node_modules", "target", "dist", "__pycache__")
           for name in metadata["files"] for part in PurePosixPath(name).parts):
        raise ValueError("Archive contains development or hidden files")
    return metadata, files


def extract_verified(archive_path, destination, *, target=None):
    metadata, files = verify_archive(archive_path, target=target)
    for name, content in files.items():
        path = destination.joinpath(*PurePosixPath(name).parts)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(content)
    root = destination / package_name(next(item for item in TARGETS if item["target"] == metadata["target"]))
    if platform.system() != "Windows":
        for name in ("luna", "luna-editor"):
            if (root / name).exists():
                (root / name).chmod(0o755)
    return root
