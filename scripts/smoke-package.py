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
import zipfile


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
        def run(arguments, commands="", *, profile="walkthrough"):
            cli = [str(package / "luna"), "--games-dir", str(work / profile / "games"),
                   "--saves-dir", str(work / profile / "saves")]
            result = subprocess.run(cli + arguments, input=commands, text=True,
                                    capture_output=True, env=env, cwd=work, timeout=15)
            if result.returncode:
                raise RuntimeError(f"Packaged CLI failed ({profile}, {arguments}): {result.stderr}")
            return result.stdout

        # The shipped example is editable authoring content; its puzzle may evolve.
        # Check that it imports and starts, independently of the fixed walkthrough.
        run(["import", str(package / "examples/locked-study.luna")], profile="example")
        example = run(["list"], profile="example").splitlines()[0].split("\t")
        startup = run(["run", example[0], "--new"], "look\nquit\n", profile="example")
        assert example[2] in startup, startup
        assert "\x1b" not in startup, startup

        fixture = work / "walkthrough.luna"
        fixture.write_bytes((root / ".fixtures/locked-study.luna").read_bytes())
        run(["import", str(fixture)])
        game_id = run(["list"]).splitlines()[0].split("\t")[0]
        transcript = run(["run", game_id, "--new"],
                         "examine painting\nexamine painting\ntake key\nuse key on door\n"
                         "save before garden\ngo east\nexamine rose\nsave completed\n"
                         "load completed\nuse key on door\n"
                         "load before garden\ninventory\nquit\n")
        assert transcript.count("Outcome: Neutral") == 2, transcript
        assert "Loaded completed." in transcript, transcript
        assert "This playthrough has ended." in transcript, transcript
        assert "Loaded before garden." in transcript, transcript
        assert "You are carrying: brass key." in transcript, transcript
        assert transcript.count("You enter the study for the first time.") == 1, transcript
        assert "I couldn't match that command." not in transcript, transcript
        assert "\x1b" not in transcript, transcript

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

            def api(path, method="GET", body=None, *, raw=False):
                request = urllib.request.Request(
                    urllib.parse.urljoin(base, f"api/v1/{path}"),
                    data=json.dumps(body).encode() if body is not None else None,
                    headers={"x-luna-token": token, "content-type": "application/json"},
                    method=method)
                with opener.open(request, timeout=5) as response:
                    return response.read() if raw else json.load(response)

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
            config = api("config")
            assert config["projects_root"] == str((package / "examples").resolve())

            # Compare the checked bundle with the packaged editor's actual export,
            # then exercise nested saves across separate runner processes.
            packing = api("open", "POST", {"folder": "packing-study"})
            packing_game = packing["project"]["game"]
            packing_bundle = work / "packing-from-editor.luna"
            packing_bundle.write_bytes(api(f"projects/{packing['handle']}/export", "POST", raw=True))
            shipped_bundle = package / "examples/packing-study.luna"
            with zipfile.ZipFile(packing_bundle) as current, zipfile.ZipFile(shipped_bundle) as shipped:
                assert json.loads(current.read("manifest.json")) == json.loads(shipped.read("manifest.json"))
                assert not any(name.startswith("editor/") for name in current.namelist())
            run(["import", str(packing_bundle)], profile="packing")
            run(["run", packing_game["id"], "--new"],
                "open chest\ntake key from chest\ntake bag\nput key in box\n"
                "take letter from chest\nput letter in bag\ngive bag to keeper\n"
                "ask keeper for bag\nclose bag\nopen door\nsave packed\nquit\n",
                profile="packing")
            packing_saves = work / "packing/saves" / packing_game["id"] / packing_game["content_version"]
            def packed_save():
                return json.loads((packing_saves / "autosave.json").read_text())
            nested = packed_save()
            assert nested["save_format"] == 3, nested
            assert nested["state"]["objects"]["key"]["placement"] == {"type": "inside", "object": "box"}
            assert nested["state"]["objects"]["box"]["placement"] == {"type": "inside", "object": "bag"}
            assert nested["state"]["objects"]["letter"]["placement"] == {"type": "inside", "object": "bag"}
            assert nested["state"]["objects"]["bag"]["placement"] == {"type": "inventory"}
            assert not nested["state"]["objects"]["bag"]["open"]
            assert nested["state"]["variables"] == {"starts": 1, "key_takes": 1, "door_opens": 0}
            resumed = run(["run", packing_game["id"], "--load", "autosave"], "inventory\nhelp key\nhint key\nquit\n", profile="packing")
            assert "Brass key" not in resumed and "Small box" not in resumed, resumed
            assert packed_save()["state"] == nested["state"], "Read-only resume replayed container state"
            completed = run(["run", packing_game["id"], "--load", "autosave"],
                "load packed\nopen bag\nopen door\nclose bag\ngo east\nuse bag\n"
                "save finished\nload finished\nopen door\nquit\n", profile="packing")
            assert "Everything is packed." in completed and "Loaded finished." in completed, completed
            assert "This playthrough has ended." in completed and "Outcome:" not in completed, completed
            assert packed_save()["state"]["ending"] == "packed"
            assert packed_save()["state"]["variables"] == {"starts": 1, "key_takes": 1, "door_opens": 1}
            run(["run", packing_game["id"], "--load", "autosave"], "load packed\nquit\n", profile="packing")
            assert packed_save()["state"] == nested["state"], "Named load changed nested contents or replayed events"

            # Exercise optional outcomes through the packaged editor's actual export,
            # then resume that completed game using the packaged runner.
            created = api("projects", "POST", {"folder": "smoke-outcome", "title": "No outcome"})
            project = created["project"]
            project["game"]["require_ending"] = True
            project["game"]["endings"] = [{
                "id": "finish", "name": "Finish", "text": "The story is complete.",
                "outcome": None,
            }]
            project["game"]["actions"] = [{
                "id": "finish-action", "name": "Finish", "verb": "use",
                "pattern": [{"type": "literal", "text": "finish"}],
                "effects": [{"type": "end", "ending": "finish"}],
            }]
            handle = created["handle"]
            saved = api(f"projects/{handle}", "PUT", {
                "project": project, "revision": created["revision"],
            })
            assert saved["project"]["game"]["endings"][0]["outcome"] is None
            exported = work / "no-outcome.luna"
            exported.write_bytes(api(f"projects/{handle}/export", "POST", raw=True))
            run(["import", str(exported)], profile="no-outcome")
            game = project["game"]
            completed = run(["run", game["id"], "--new"],
                            "use finish\nsave completed\nload completed\nuse finish\nquit\n",
                            profile="no-outcome")
            assert completed.count("The story is complete.") == 2, completed
            assert "Loaded completed." in completed, completed
            assert "This playthrough has ended." in completed, completed
            assert "Outcome:" not in completed, completed
            autosave = work / "no-outcome/saves" / game["id"] / game["content_version"] / "autosave.json"
            state = json.loads(autosave.read_text())
            assert state["save_format"] == (3 if game["format_version"] >= 2 else 2), state
            assert state["state"]["ending"] == "finish", state
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
        print("Packaged examples, nested container restarts/saves, fixed walkthrough, optional outcomes, and embedded editor passed "
              "without source UI or development tools.")


if __name__ == "__main__":
    main()
