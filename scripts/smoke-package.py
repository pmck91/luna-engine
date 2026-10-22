#!/usr/bin/env python3
"""Exercise a release outside the repository with no development tools on PATH."""
import argparse
import json
import os
from pathlib import Path
import re
import select
import signal
import subprocess
import tarfile
import tempfile
import urllib.error
import urllib.parse
import urllib.request


def main():
    root = Path(__file__).resolve().parents[1]
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("package", nargs="?", type=Path,
                        default=root / "dist/luna-engine-linux-x86_64.tar.gz")
    args = parser.parse_args()
    with tempfile.TemporaryDirectory(prefix="luna-release-smoke-") as directory:
        work = Path(directory)
        with tarfile.open(args.package) as archive:
            archive.extractall(work, filter="data")
        package = work / "luna-engine-linux-x86_64"
        env = dict(os.environ, XDG_CONFIG_HOME=str(work / "config"),
                   XDG_DATA_HOME=str(work / "data"), PATH="", NO_COLOR="1")
        cli = [str(package / "luna"), "--games-dir", str(work / "games"),
               "--saves-dir", str(work / "saves")]

        def run(arguments, commands=""):
            result = subprocess.run(cli + arguments, input=commands, text=True,
                                    capture_output=True, env=env, cwd=work, timeout=15)
            if result.returncode:
                raise RuntimeError(f"Packaged CLI failed: {result.stderr}")
            return result.stdout

        run(["import", str(package / "examples/locked-study.luna")])
        game_id = run(["list"]).splitlines()[0].split("\t")[0]
        transcript = run(["run", game_id, "--new"],
                         "examine painting\nexamine painting\ntake key\nuse key on door\n"
                         "save before garden\ngo east\nexamine rose\n"
                         "load before garden\ninventory\nquit\n")
        assert "Outcome: Neutral" in transcript
        assert "Loaded before garden." in transcript
        assert "You are carrying: brass key." in transcript
        assert transcript.count("You enter the study for the first time.") == 1
        assert "\x1b" not in transcript

        frontend = root / "web/dist"
        hidden = root / "web/dist.smoke-hidden"
        assert not hidden.exists(), f"Restore an earlier frontend backup first: {hidden}"
        moved = frontend.exists()
        editor = None
        opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
        try:
            if moved:
                frontend.rename(hidden)
            editor = subprocess.Popen(
                [str(package / "luna-editor"), "--no-browser", "--port", "0",
                 "--projects-dir", str(package / "examples")],
                cwd=work, env=env, text=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
            assert select.select([editor.stdout], [], [], 10)[0], "Editor startup timed out"
            line = editor.stdout.readline()
            match = re.search(r"http://127\.0\.0\.1:\d+/#token=[a-z0-9-]+", line)
            assert match, f"Editor did not print its launch URL: {line}"
            url = urllib.parse.urlsplit(match[0])
            base = url._replace(fragment="").geturl()
            token = urllib.parse.parse_qs(url.fragment)["token"][0]
            with opener.open(base, timeout=5) as response:
                html = response.read().decode()
            script = re.search(r'<script[^>]+src="([^"]+)"', html)
            assert script, "Embedded UI has no entry script"
            with opener.open(urllib.parse.urljoin(base, script[1]), timeout=5) as response:
                assert len(response.read()) > 100_000, "Embedded entry script is incomplete"
            config_url = urllib.parse.urljoin(base, "api/v1/config")
            try:
                opener.open(config_url, timeout=5)
                raise AssertionError("API accepted a request without authentication")
            except urllib.error.HTTPError as error:
                assert error.code == 401
            request = urllib.request.Request(config_url, headers={"x-luna-token": token})
            with opener.open(request, timeout=5) as response:
                config = json.load(response)
            assert config["projects_root"] == str((package / "examples").resolve())
        finally:
            if editor is not None and editor.poll() is None:
                editor.send_signal(signal.SIGINT)
                try:
                    editor.wait(timeout=10)
                except subprocess.TimeoutExpired:
                    editor.kill()
                    editor.wait()
            if moved:
                hidden.rename(frontend)
        print("Packaged CLI and embedded editor passed without source UI or development tools.")


if __name__ == "__main__":
    main()
