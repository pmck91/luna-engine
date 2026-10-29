#!/usr/bin/env python3
"""Record native release baseline evidence; this does not create a release package."""

import argparse
import json
import platform
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
REPORT = ROOT / "dist" / "native-baseline.json"


def output(*command):
    return subprocess.check_output(command, cwd=ROOT, text=True).strip()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    host = commands.add_parser("host")
    host.add_argument("--target", required=True)
    commands.add_parser("binaries")
    args = parser.parse_args()
    if args.command == "host":
        rust = output("rustc", "-vV")
        actual = next(line.removeprefix("host: ") for line in rust.splitlines()
                      if line.startswith("host: "))
        report = {
            "revision": output("git", "rev-parse", "HEAD"),
            "working_tree_dirty": bool(output("git", "status", "--porcelain")),
            "platform": platform.platform(),
            "expected_target": args.target,
            "actual_host": actual,
            "rust": rust,
            "node": output("node", "--version"),
            "python": platform.python_version(),
            "status": "host-recorded",
        }
        REPORT.parent.mkdir(parents=True, exist_ok=True)
        REPORT.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
        if actual != args.target:
            raise SystemExit(f"Expected native host {args.target}, got {actual}")
    else:
        report = json.loads(REPORT.read_text(encoding="utf-8"))
        suffix = ".exe" if platform.system() == "Windows" else ""
        report["binaries"] = {
            name: output(str(ROOT / "target" / "release" / (name + suffix)), "--version")
            for name in ("luna", "luna-editor")
        }
        report["status"] = "release-binaries-launched-tests-see-workflow"
        REPORT.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(REPORT.read_text(encoding="utf-8"))


if __name__ == "__main__":
    main()
