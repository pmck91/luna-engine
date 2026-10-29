#!/usr/bin/env python3
"""Build and package the native host. Run with Python 3.12+ from any directory."""
import argparse
import json
import os
import platform
from pathlib import Path
import shutil
import subprocess
import tarfile
import tempfile
import zipfile

from check_native_dependencies import inspect_native_dependencies
from release_common import EXAMPLES, ROOT, binary_directory, native_target, output, package_name, package_path, sha256, verify_archive, version


def distributable_sources():
    """Only canonical tracked project files, declared assets and workshop prose."""
    files = ["README.md", "examples/README.md"]
    tracked = set(output("git", "ls-files", "-z", "examples").split("\0"))
    for example in EXAMPLES:
        prefix = f"examples/{example}/"
        game = json.loads((ROOT / prefix / "game.json").read_text(encoding="utf-8"))
        assets = {prefix + name for name in game["assets"]}
        for name in sorted(tracked):
            if not name.startswith(prefix):
                continue
            relative = name[len(prefix):]
            if any(part.startswith(".") for part in Path(relative).parts):
                continue
            if name in assets or relative.endswith(".json") or relative in ("README.md", "ACCEPTANCE.md"):
                files.append(name)
        if not assets <= set(files):
            raise ValueError(f"Untracked or missing project assets: {assets - set(files)}")
        files.append(f"examples/{example}.luna")
    return files


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--skip-build", action="store_true", help="Use already-built release binaries (CI)")
    args = parser.parse_args()
    target = native_target()
    if not args.skip_build:
        npm = shutil.which("npm")
        if npm is None:
            raise SystemExit("npm is required to build the embedded frontend")
        subprocess.run([npm, "--prefix", "web", "run", "build"], cwd=ROOT, check=True)
        build_env = dict(os.environ)
        if target["platform"].startswith("windows-"):
            build_env["CARGO_TARGET_X86_64_PC_WINDOWS_MSVC_RUSTFLAGS"] = "-C target-feature=+crt-static"
        subprocess.run(["cargo", "build", "--locked", "--release", "--workspace"] + target["cargo_args"],
                       cwd=ROOT, env=build_env, check=True)
    suffix = ".exe" if target["platform"].startswith("windows-") else ""
    archive_path = package_path(target)
    archive_path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix=".luna-package-", dir=archive_path.parent) as directory:
        stage = Path(directory)
        package = stage / package_name(target)
        package.mkdir()
        for name in distributable_sources():
            source = ROOT / name
            if source.is_symlink() or not source.is_file():
                raise ValueError(f"Not a regular distributable file: {source}")
            destination = package / name
            destination.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(source, destination)
        binaries = {}
        for name in ("luna", "luna-editor"):
            source = binary_directory(target) / (name + suffix)
            actual = output(str(source), "--version")
            if actual != f"{name} {version()}":
                raise ValueError(f"Binary version mismatch: {actual!r}")
            binaries[name] = actual
            shutil.copyfile(source, package / source.name)
            (package / source.name).chmod(0o755)
        shutil.copyfile(ROOT / "scripts/package-start.txt", package / "START-HERE.txt")
        files = {path.relative_to(package).as_posix(): sha256(path)
                 for path in sorted(package.rglob("*")) if path.is_file()}
        metadata = {
            "version": version(), "revision": output("git", "rev-parse", "HEAD"),
            "working_tree_dirty": bool(output("git", "status", "--porcelain")),
            "target": target["target"], "platform": target["platform"], "signing": "unsigned",
            "system": platform.platform(), "dependencies": inspect_native_dependencies(),
            "rust": output("rustc", "-vV"), "node": output(shutil.which("node"), "--version"),
            "binaries": binaries, "files": files,
        }
        (package / "build.json").write_text(json.dumps(metadata, indent=2) + "\n", encoding="utf-8")
        temporary_archive = stage / archive_path.name
        if suffix:
            with zipfile.ZipFile(temporary_archive, "w", compression=zipfile.ZIP_DEFLATED) as archive:
                for path in sorted(package.rglob("*")):
                    if path.is_file():
                        archive.write(path, path.relative_to(stage).as_posix())
        else:
            with tarfile.open(temporary_archive, "w:gz") as archive:
                for path in sorted(package.rglob("*")):
                    if path.is_file():
                        info = archive.gettarinfo(path, path.relative_to(stage).as_posix())
                        info.uid = info.gid = 0
                        info.uname = info.gname = ""
                        info.mode = 0o755 if path.name in ("luna", "luna-editor") else 0o644
                        with path.open("rb") as content:
                            archive.addfile(info, content)
        temporary_archive.with_name(temporary_archive.name + ".sha256").write_text(
            f"{sha256(temporary_archive)}  {archive_path.name}\n", encoding="utf-8")
        verify_archive(temporary_archive, target=target)
        os.replace(temporary_archive, archive_path)
        os.replace(temporary_archive.with_name(temporary_archive.name + ".sha256"),
                   archive_path.with_name(archive_path.name + ".sha256"))
    print(f"Package: {archive_path}")


if __name__ == "__main__":
    main()
