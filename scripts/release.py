#!/usr/bin/env python3
"""Validate release inputs, prepare package tests, and assemble a draft only."""
import argparse
import json
import os
from pathlib import Path
import re
import subprocess
import tempfile

from release_common import ROOT, TARGETS, extract_verified, native_target, output, package_name, package_path, verify_archive, version


def check_tag(tag):
    if not re.fullmatch(r"v\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?", tag) or tag != "v" + version():
        raise ValueError("Release tag must be v<workspace application version>")
    revision = output("git", "rev-parse", f"refs/tags/{tag}^{{commit}}")
    if revision != output("git", "rev-parse", "HEAD"):
        raise ValueError("Tag does not identify the checked-out commit")
    if output("git", "status", "--porcelain"):
        raise ValueError("Release source has uncommitted changes")
    for directory in ("web", "docs/site"):
        for filename in ("package.json", "package-lock.json"):
            data = json.loads((ROOT / directory / filename).read_text(encoding="utf-8"))
            if data["version"] != version() or ("packages" in data and data["packages"][""]["version"] != version()):
                raise ValueError(f"Application metadata version mismatch: {directory}/{filename}")
    return revision


def verify_set(directory, revision):
    expected = set()
    for target in TARGETS:
        name = package_name(target) + target["extension"]
        expected |= {name, name + ".sha256"}
        metadata, _ = verify_archive(directory / name, revision=revision, target=target)
        if metadata["working_tree_dirty"]:
            raise ValueError("Refusing a release assembled from a dirty checkout")
        if metadata["signing"] != "unsigned":
            raise ValueError("Unknown signing policy; review before changing release notes")
    if {path.name for path in directory.iterdir()} != expected:
        raise ValueError("Release requires exactly four archives and four checksum sidecars")
    return sorted(directory / name for name in expected)


def draft(directory, tag):
    """No publication and no replacement of an existing release or its assets."""
    revision = check_tag(tag)
    assets = verify_set(directory, revision)
    # Fail closed on API/network failures, instead of interpreting auth errors as
    # proof that a release does not exist.
    releases = json.loads(output("gh", "api", "--paginate", "--slurp",
                                 "repos/{owner}/{repo}/releases?per_page=100"))
    existing = next((release for page in releases for release in page if release["tag_name"] == tag), None)
    if existing:
        raise ValueError("A release already exists for this tag. Preserve published assets; "
                         "for a failed draft, review/delete only that draft in GitHub and rerun the job.")
    notes = f"""# Luna Engine {version()}

Visual text-adventure editor and terminal runner, built from `{revision}`.

Download and extract the archive for your OS/CPU; it contains both applications,
the embedded editor UI, nine editable examples and exported games. No Rust or
Node installation is required. Start with START-HERE.txt in the archive.

Luna is source available under PolyForm Noncommercial 1.0.0 with an additional
royalty-free commercial-game permission. You may sell your own games with the
required credit to Peter McKinney (pmck91), and bundle the unmodified runner
with its notices. Read LICENSE and NOTICE in the archive for the complete terms.
Commercialising Luna itself requires separate permission under those terms.

**Windows and macOS builds are experimental and unsigned.** macOS downloads are
not notarized. Gatekeeper or SmartScreen may warn or block launch. Native build,
Rust tests, extracted package smoke and Chromium authoring checks run in CI;
ordinary desktop launch and older OS compatibility require separate review.
Linux baseline: Ubuntu 22.04 x86_64/glibc 2.35. macOS deployment target: 11.0,
CI host: macOS 15. Windows: x64 MSVC with static C runtime, CI host: Server 2022.

Compare each archive's SHA-256 with its .sha256 sidecar. build.json inside each
archive records exact source, target, toolchain and individual file hashes.

[Documentation](https://pmck91.github.io/luna-engine/) ·
[Installation](https://pmck91.github.io/luna-engine/getting-started/install/) ·
[Licensing](https://pmck91.github.io/luna-engine/playing/licensing/)

This draft is for owner review. Verify downloads and desktop launches before
publishing. Application version {version()} does not change game/save formats.
"""
    with tempfile.TemporaryDirectory(prefix="luna-release-notes-") as temp:
        path = Path(temp) / "notes.md"
        path.write_text(notes, encoding="utf-8")
        command = ["gh", "release", "create", tag, "--draft", "--verify-tag",
                   "--target", revision, "--title", f"Luna Engine {version()}", "--notes-file", str(path)]
        if "-" in version():
            command.append("--prerelease")
        subprocess.run(command + [str(asset) for asset in assets], cwd=ROOT, check=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    commands.add_parser("matrix")
    tag = commands.add_parser("check-tag")
    tag.add_argument("tag")
    verify = commands.add_parser("verify-set")
    verify.add_argument("directory", type=Path)
    browser = commands.add_parser("test-browser")
    browser.add_argument("--full", action="store_true", help="Run the full editor browser suite")
    browser.add_argument("--spec", action="append", help="Run a particular browser spec (repeatable)")
    commands.add_parser("test-terminal")
    release = commands.add_parser("draft")
    release.add_argument("directory", type=Path)
    release.add_argument("tag")
    args = parser.parse_args()
    if args.command == "matrix":
        print(json.dumps({"include": TARGETS}))
    elif args.command == "check-tag":
        print(check_tag(args.tag))
    elif args.command == "verify-set":
        for asset in verify_set(args.directory, output("git", "rev-parse", "HEAD")):
            print(f"Verified {asset.name}")
    elif args.command in ("test-browser", "test-terminal"):
        target = native_target()
        with tempfile.TemporaryDirectory(prefix="luna-browser-package-") as directory:
            root = extract_verified(package_path(target), Path(directory), target=target)
            binary = root / ("luna-editor.exe" if os.name == "nt" else "luna-editor")
            runner = root / ("luna.exe" if os.name == "nt" else "luna")
            if args.command == "test-terminal":
                command = ["cargo", "test", "--locked", "-p", "luna-runner", "--test", "terminal"] + target["cargo_args"]
                cwd = ROOT
            else:
                command = ["node", str(ROOT / "web/node_modules/@playwright/test/cli.js"), "test"]
                if args.spec:
                    command += args.spec
                elif not args.full:
                    command += ["tests/e2e/editor.spec.ts", "--project=chromium"]
                cwd = ROOT / "web"
            subprocess.run(command, cwd=cwd, check=True,
                           timeout=180 if args.command == "test-terminal" else None,
                           env=dict(os.environ, LUNA_TEST_EDITOR=str(binary), LUNA_TEST_RUNNER=str(runner)))
    else:
        draft(args.directory, args.tag)


if __name__ == "__main__":
    main()
