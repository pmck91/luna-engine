#!/usr/bin/env python3
"""Exercise a release outside the repository with no development tools on PATH."""
import argparse
import json
import os
from pathlib import Path
import re
import time
import subprocess
import tempfile
import urllib.error
import urllib.parse
import urllib.request
import zipfile

from release_common import extract_verified, native_target, package_path


def main():
    root = Path(__file__).resolve().parents[1]
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("package", nargs="?", type=Path,
                        default=package_path(native_target()))
    args = parser.parse_args()
    with tempfile.TemporaryDirectory(prefix="luna-release-smoke-") as directory:
        work = Path(directory) / "Luna package — café"
        work.mkdir()
        package = extract_verified(args.package, work, target=native_target())
        suffix = ".exe" if os.name == "nt" else ""
        runner = package / ("luna" + suffix)
        editor_binary = package / ("luna-editor" + suffix)
        runner_config = work / "runner.toml"
        runner_config.write_text("", encoding="utf-8")
        env = dict(os.environ, XDG_CONFIG_HOME=str(work / "config"),
                   XDG_DATA_HOME=str(work / "data"), PATH="", NO_COLOR="1")
        def run(arguments, commands="", *, profile="walkthrough"):
            cli = [str(runner), "--config", str(runner_config), "--games-dir", str(work / profile / "games"),
                   "--saves-dir", str(work / profile / "saves")]
            result = subprocess.run(cli + arguments, input=commands, text=True,
                                    capture_output=True, encoding="utf-8", env=env, cwd=work, timeout=15)
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
        stdout_log = (work / "editor-stdout.log").open("w", encoding="utf-8")
        stderr_log = (work / "editor-stderr.log").open("w", encoding="utf-8")
        opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
        try:
            if moved:
                frontend.rename(hidden)
            editor = subprocess.Popen(
                [str(editor_binary), "--config", str(work / "editor.json"), "--no-browser", "--port", "0",
                 "--projects-dir", str(package / "examples")],
                cwd=work, env=env, stdout=stdout_log, stderr=stderr_log)
            deadline = time.monotonic() + 15
            match = None
            while time.monotonic() < deadline:
                launch = (work / "editor-stdout.log").read_text(encoding="utf-8")
                match = re.search(r"http://127\.0\.0\.1:\d+/#token=[a-z0-9-]+", launch)
                if match:
                    break
                if editor.poll() is not None:
                    raise RuntimeError("Editor exited before startup: " +
                        (work / "editor-stderr.log").read_text(encoding="utf-8"))
                time.sleep(0.05)
            assert match, "Editor startup timed out"
            url = urllib.parse.urlsplit(match[0])
            base = url._replace(fragment="").geturl()
            token = urllib.parse.parse_qs(url.fragment)["token"][0]

            def api(path, method="GET", body=None, *, raw=False):
                request = urllib.request.Request(
                    urllib.parse.urljoin(base, f"api/v1/{path}"),
                    data=json.dumps(body).encode() if body is not None else None,
                    headers={"x-luna-token": token, "content-type": "application/json"},
                    method=method)
                try:
                    with opener.open(request, timeout=5) as response:
                        return response.read() if raw else json.load(response)
                except urllib.error.HTTPError as error:
                    raise RuntimeError(f"Packaged API failed ({method} {path}): {error.read().decode()}") from error

            with opener.open(base, timeout=5) as response:
                html = response.read().decode()
            script = re.search(r'<script[^>]+src="([^"]+)"', html)
            assert script, "Embedded UI has no entry script"
            with opener.open(urllib.parse.urljoin(base, script[1]), timeout=5) as response:
                entry = response.read()
                assert len(entry) > 100_000, "Embedded entry script is incomplete"
            if moved:
                assert html == (hidden / "index.html").read_text(encoding="utf-8"), "Embedded UI is from an older build"
                assert entry == (hidden / script[1].lstrip("/")).read_bytes(), "Embedded entry differs from the built UI"
            config_url = urllib.parse.urljoin(base, "api/v1/config")
            try:
                opener.open(config_url, timeout=5)
                raise AssertionError("API accepted a request without authentication")
            except urllib.error.HTTPError as error:
                assert error.code == 401
            config = api("config")
            assert os.path.samefile(config["projects_root"], package / "examples")

            # The public tutorial ships with every target. Exercise its actual
            # packaged authoring project, export and completed save across processes.
            observatory = api("open", "POST", {"folder": "observatory"})
            observatory_bundle = work / "observatory-from-editor.luna"
            observatory_bundle.write_bytes(api(f"projects/{observatory['handle']}/export", "POST", raw=True))
            with zipfile.ZipFile(observatory_bundle) as exported, zipfile.ZipFile(package / "examples/observatory.luna") as checked:
                assert json.loads(exported.read("manifest.json")) == json.loads(checked.read("manifest.json"))
            for check in observatory["project"]["editor"]["playtest"]["checks"]:
                assert api("playtests/checks", "POST", {"project": observatory["project"], "check": check})["passed"]
            guide = (root / "docs/site/src/content/docs/tutorials/observatory/index.md").read_text(encoding="utf-8")
            commands = guide.split("## Complete player route", 1)[1].split("```text", 1)[1].split("```", 1)[0].strip()
            run(["import", str(observatory_bundle)], profile="observatory")
            observatory_game = observatory["project"]["game"]
            run(["run", observatory_game["id"], "--new"], commands + "\nsave finished\nquit\n", profile="observatory")
            observatory_auto = work / "observatory/saves" / observatory_game["id"] / observatory_game["content_version"] / "autosave.json"
            finished = json.loads(observatory_auto.read_text(encoding="utf-8"))["state"]
            assert finished["ending"] == "first-light" and finished["variables"]["score"] == 10
            run(["run", observatory_game["id"], "--load", "finished"], "look\nquit\n", profile="observatory")
            assert json.loads(observatory_auto.read_text(encoding="utf-8"))["state"] == finished

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
                return json.loads((packing_saves / "autosave.json").read_text(encoding="utf-8"))
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

            # New-game defaults and the permanent parser fixture use the packaged
            # API/export, not a handwritten runner-only substitute.
            fresh = api("projects", "POST", {"folder": "smoke-parser", "title": "Parser defaults"})
            assert fresh["project"]["game"]["format_version"] == 8
            assert fresh["project"]["game"].get("turns") is None
            assert not fresh["project"]["game"].get("allow_player_undo", False)
            assert fresh["project"]["game"]["command_assistance"]["clarification"]
            assert fresh["project"]["game"]["command_assistance"]["recent_objects"]
            assert api("player-undo-review", "POST", fresh["project"]) == {
                "conflicts": [], "upgrade_errors": [],
            }

            # U2 is ordinary release code: canonical opt-in, native HTTP undo,
            # setup-5 restore, exported/installed CLI and session-local history.
            undo_project = json.loads(json.dumps(fresh["project"]))
            undo_game = undo_project["game"]
            undo_game["allow_player_undo"] = True
            undo_game["variables"] = {"counter": 0}
            undo_game["actions"] = [{
                "id": "undo-lever", "name": "Pull lever", "verb": "use",
                "pattern": [{"type": "literal", "text": "lever"}],
                "effects": [{"type": "update_variable", "name": "counter", "op": "add",
                             "operand": {"type": "literal", "value": 1}}],
            }]
            api(f"projects/{fresh['handle']}", "PUT", {
                "project": undo_project, "revision": fresh["revision"],
            })
            undo_start = api("playtests", "POST", {"project": undo_project})
            undo_session = undo_start["session"]
            changed = api(f"playtests/{undo_session}/commands", "POST", {"command": "use lever"})
            assert changed["result"]["undo"]["available"] == 1
            undo_setup = api(f"playtests/{undo_session}/capture", "POST", {"name": "Changed lever"})
            assert undo_setup["version"] == 5 and "undo_history" not in undo_setup["state"]
            restored = api(f"playtests/{undo_session}/undo", "POST", {"explain": True})
            assert restored["state"] == undo_start["state"]
            assert restored["result"]["undo_result"] == {"type": "restored", "command": "use lever"}
            assert restored["result"]["undo"]["available"] == 0
            assert restored["result"]["selected_flow"] is None
            assert restored["result"]["explanation"]["steps"][0]["kind"]["type"] == "undo"
            assert restored["result"]["explanation"]["steps"][0]["source"] is None
            reopened = api("playtests", "POST", {"project": undo_project, "setup": undo_setup})
            assert reopened["state"] == changed["state"]
            assert reopened["result"]["undo"]["available"] == 0
            undo_check = api("playtests/checks", "POST", {"project": undo_project, "check": {
                "id": "undo-check", "name": "Change and undo", "start": {"type": "fresh"},
                "steps": [{"command": "use lever"}, {"command": "undo"}],
            }})
            assert undo_check["passed"] and undo_check["undo"]["available"] == 0
            assert undo_check["state"] == undo_start["state"]
            undo_bundle = work / "undo-from-editor.luna"
            undo_bundle.write_bytes(api(f"projects/{fresh['handle']}/export", "POST", raw=True))
            with zipfile.ZipFile(undo_bundle) as exported:
                assert json.loads(exported.read("manifest.json"))["format_version"] == 8
                assert json.loads(exported.read("game.json"))["allow_player_undo"]
            run(["import", str(undo_bundle)], profile="undo")
            transcript = run(["run", undo_game["id"], "--new"],
                             "help\nuse lever\nsave taken\nundo\nquit\n", profile="undo")
            assert "UNDO" in transcript and "Undid “use lever”." in transcript, transcript
            undo_saves = work / "undo/saves" / undo_game["id"] / undo_game["content_version"]
            undo_auto = undo_saves / "autosave.json"
            auto_bytes = undo_auto.read_bytes()
            restored_save = json.loads(auto_bytes)
            assert restored_save["save_format"] == 7 and restored_save["state"] == undo_start["state"]
            named = next(undo_saves.glob("named-*.json"))
            named_bytes = named.read_bytes()
            assert json.loads(named_bytes)["state"] == changed["state"]
            transcript = run(["run", undo_game["id"], "--load", "taken"], "undo\nquit\n", profile="undo")
            assert "Undid" not in transcript, transcript
            assert named.read_bytes() == named_bytes and undo_auto.read_bytes() == auto_bytes

            gallery = api("open", "POST", {"folder": "parser-gallery"})
            gallery_game = gallery["project"]["game"]
            gallery_bundle = work / "gallery-from-editor.luna"
            gallery_bundle.write_bytes(api(f"projects/{gallery['handle']}/export", "POST", raw=True))
            with zipfile.ZipFile(gallery_bundle) as exported, zipfile.ZipFile(package / "examples/parser-gallery.luna") as checked:
                assert json.loads(exported.read("manifest.json")) == json.loads(checked.read("manifest.json"))
                assert not any(name.startswith("editor/") for name in exported.namelist())
            run(["import", str(gallery_bundle)], profile="parser")
            transcript = run(["run", gallery_game["id"], "--new"],
                             "take key\nsave waiting\nuse unstable\nbrass\nexamine it\n"
                             "put key on tray\nbrass\nsilver\nsave placed\nquit\n", profile="parser")
            assert transcript.count("Which do you mean?") == 3, transcript
            assert "brass key has a distinctive engraving" in transcript, transcript
            assert all(name not in transcript for name in ["Copper key", "Hidden key", "Gold key"]), transcript
            gallery_saves = work / "parser/saves" / gallery_game["id"] / gallery_game["content_version"]
            def gallery_save():
                return json.loads((gallery_saves / "autosave.json").read_text(encoding="utf-8"))
            placed = gallery_save()
            assert placed["save_format"] == 3
            assert placed["state"]["variables"] == {"starts": 1, "takes": 1, "watches": 1, "placements": 1,
                                                    "commands": 3, "zero": 0, "silver_free": False}
            assert placed["state"]["objects"]["brass"]["placement"] == {"type": "on", "object": "silver-tray"}
            assert "pending_clarification" not in json.dumps(placed) and "input_resolution" not in json.dumps(placed)
            resumed = run(["run", gallery_game["id"], "--load", "waiting"],
                          "1\nexamine it\nsave\nquit\n", profile="parser")
            assert "Which do you mean?" not in resumed and "I can't tell what “it” refers to here." in resumed, resumed
            # CLI startup from a named slot preserves the previous rolling save
            # until a save/state change; explicitly save the read-only restore.
            assert gallery_save()["state"]["variables"] == {"starts": 1, "takes": 0, "watches": 0,
                                                           "placements": 0, "commands": 0, "zero": 0,
                                                           "silver_free": False}
            completed = run(["run", gallery_game["id"], "--load", "placed"],
                            "take key\nsilver\nexamine it\nload placed\nexamine it\n"
                            "use finish\nsave finished\nquit\n", profile="parser")
            assert "The silver key is chained to the display." in completed, completed
            assert "silver key has a distinctive engraving" in completed, completed
            assert "I can't tell what “it” refers to here." in completed, completed
            finished = gallery_save()["state"]
            assert finished["ending"] == "complete" and finished["variables"] == placed["state"]["variables"]
            resumed = run(["run", gallery_game["id"], "--load", "finished"], "2\nquit\n", profile="parser")
            assert "This playthrough has ended." in resumed and "Outcome:" not in resumed, resumed
            assert gallery_save()["state"] == finished

            # Canonical procedure files and typed messages cross the packaged API,
            # exact bundle manifest, named-save and independent process boundaries.
            # Permanent R3 fixture through the packaged API and real process boundaries.
            workshop = api("open", "POST", {"folder": "procedure-workshop"})
            workshop_game = workshop["project"]["game"]
            workshop_bundle = work / "workshop-from-editor.luna"
            workshop_bundle.write_bytes(api(f"projects/{workshop['handle']}/export", "POST", raw=True))
            with zipfile.ZipFile(workshop_bundle) as exported, zipfile.ZipFile(package / "examples/procedure-workshop.luna") as checked:
                assert json.loads(exported.read("manifest.json")) == json.loads(checked.read("manifest.json"))
                assert len([name for name in exported.namelist() if name.startswith("procedures/")]) == 6
                assert "procedures/unused.json" in exported.namelist()
                assert not any(name.startswith("editor/") for name in exported.namelist())
            run(["import", str(workshop_bundle)], profile="workshop")
            run(["run", workshop_game["id"], "--new"],
                "use bell\nuse lever\nuse bell\nuse nested\nuse collect\nsave checkpoint\nquit\n", profile="workshop")
            workshop_saves = work / "workshop/saves" / workshop_game["id"] / workshop_game["content_version"]
            def workshop_state():
                saved = json.loads((workshop_saves / "autosave.json").read_text(encoding="utf-8"))
                assert saved["save_format"] == 4
                return saved["state"]
            before_failure = workshop_state()
            assert before_failure["properties"]["keeper"]["coins"] == 10
            assert before_failure["objects"]["token"]["placement"] == {"type": "inventory"}
            for name, value in {"starts": 1, "awards": 5, "watch_events": 5, "take_events": 1, "commands": 5}.items():
                assert before_failure["variables"][name] == value
            failed = run(["run", workshop_game["id"], "--load", "checkpoint"], "use fail\nsave failed\nquit\n", profile="workshop")
            assert "Discard this attempted output." not in failed
            assert workshop_state() == before_failure, "Nested failure leaked story/hook/cursor changes"
            repeated = run(["run", workshop_game["id"], "--load", "failed"], "use repeat\nuse repeat\nuse bell\nquit\n", profile="workshop")
            assert repeated.count("First shared reply.") == 3
            assert workshop_state()["properties"]["keeper"]["coins"] == 14
            finished = run(["run", workshop_game["id"], "--load", "autosave"], "use stop\nuse finish\nsave completed\nquit\n", profile="workshop")
            assert "The workshop review is complete." in finished and "Outcome:" not in finished
            completed_workshop = workshop_state()
            assert completed_workshop["ending"] == "complete"
            assert completed_workshop["properties"]["keeper"]["coins"] == 15
            for name, value in {"starts": 1, "awards": 9, "watch_events": 9, "ending_events": 1, "after_call": 2, "stopped_tail": 0, "ending_tail": 0}.items():
                assert completed_workshop["variables"][name] == value
            run(["run", workshop_game["id"], "--load", "completed"], "use bell\nquit\n", profile="workshop")
            assert workshop_state() == completed_workshop, "Completion restore replayed a hook"

            # The complete N6 project is authored through forms and blocks in the
            # browser suite, then retained alongside its actual editor export.
            keeper = api("open", "POST", {"folder": "keeper-quest"})
            keeper_project = keeper["project"]
            keeper_game = keeper_project["game"]
            keeper_bundle = work / "keeper-from-editor.luna"
            keeper_bundle.write_bytes(api(f"projects/{keeper['handle']}/export", "POST", raw=True))
            with zipfile.ZipFile(keeper_bundle) as exported, zipfile.ZipFile(package / "examples/keeper-quest.luna") as checked:
                assert json.loads(exported.read("manifest.json")) == json.loads(checked.read("manifest.json"))
                assert not any(name.startswith("editor/") for name in exported.namelist())
            for setup in keeper_project["editor"]["playtest"]["setups"]:
                restored = api("playtests", "POST", {"project": keeper_project, "setup": setup})
                assert setup["version"] == 3 and restored["state"] == setup["state"]
                assert not restored["result"]["state_changed"], "Setup restore replayed narrative hooks"
            run(["import", str(keeper_bundle)], profile="keeper")
            keeper_saves = work / "keeper/saves" / keeper_game["id"] / keeper_game["content_version"]
            key_id = next(o["id"] for o in keeper_project["objects"] if o["name"] == "Brass key")
            speaker_id = keeper_project["characters"][0]["id"]
            quest_id = keeper_project["quests"][0]["id"]

            def keeper_state():
                saved = json.loads((keeper_saves / "autosave.json").read_text(encoding="utf-8"))
                assert saved["save_format"] == 5
                return saved["state"]

            run(["run", keeper_game["id"], "--new"],
                "talk keeper\nsave greeting\nreply 2\ntalk keeper\nreply 1\nreply 1\nreply 1\n"
                "take brass key\ntalk keeper\nsave handover\nquit\n", profile="keeper")
            before_handover = keeper_state()
            assert before_handover["variables"] == {
                "coins": 0, "rewards": 0, "greeting_entries": 2,
                "progress_entries": 2, "quest_starts": 1, "zero": 0,
            }
            assert before_handover["objects"][key_id]["placement"] == {"type": "inventory"}
            rejected = run(["run", keeper_game["id"], "--load", "handover"],
                           "reply 4\nsave failed\nquit\n", profile="keeper")
            assert "You receive ten coins." not in rejected
            assert keeper_state() == before_handover, "Failed reply leaked reward, journal or placement"
            run(["run", keeper_game["id"], "--load", "failed"],
                "reply 3\nsave rewarded\nquit\n", profile="keeper")
            rewarded_keeper = keeper_state()
            assert rewarded_keeper["variables"]["coins"] == 10 and rewarded_keeper["variables"]["rewards"] == 1
            assert rewarded_keeper["objects"][key_id]["placement"] == {"type": "character", "character": speaker_id}
            assert rewarded_keeper["narrative"]["quests"][quest_id]["status"] == "completed"
            assert len(rewarded_keeper["narrative"]["quests"][quest_id]["journal"]) == 4
            repeated = run(["run", keeper_game["id"], "--load", "rewarded"],
                           "look\nquests\nquest key\nreply 1\ntalk keeper\ntalk keeper\nquit\n", profile="keeper")
            assert repeated.count("Thank you again for finding my key.") == 2
            assert "You receive ten coins." not in repeated
            assert keeper_state()["variables"] == rewarded_keeper["variables"]
            run(["run", keeper_game["id"], "--new"],
                "take brass key\ntalk keeper\nreply 1\nquit\n", profile="keeper")
            found_id = keeper_project["quests"][0]["stages"][0]["id"]
            assert keeper_state()["narrative"]["quests"][quest_id]["stages"] == [found_id]
            run(["run", keeper_game["id"], "--new"],
                "talk keeper\nreply 1\nreply 3\ntalk keeper\nquit\n", profile="keeper")
            assert keeper_state()["narrative"]["quests"][quest_id]["status"] == "failed"
            assert keeper_state()["variables"]["coins"] == 0

            created_procedures = api("projects", "POST", {"folder": "smoke-procedures", "title": "Shared rewards"})
            procedure_project = created_procedures["project"]
            procedure_project["game"]["variables"] = {"rewards": 0}
            procedure_project["procedures"] = [{
                "id": "award", "name": "Award coins", "inputs": [{
                    "id": "amount", "name": "Amount", "kind": "integer",
                }], "effects": [
                    {"type": "update_variable", "name": "rewards", "op": "add",
                     "operand": {"type": "input", "input": "amount"}},
                    {"type": "say", "text": {"text": "Awarded %amount% coins.", "references": {
                        "amount": {"type": "procedure_input", "input": "amount"}}}},
                    {"type": "respond", "id": "replies", "mode": "loop", "fallback": "",
                     "responses": ["First reply", "Second reply"]},
                ],
            }, {"id": "unused", "name": "Unused definition", "inputs": [], "effects": []}]
            procedure_project["game"]["actions"] = [{
                "id": f"action-{word}", "name": word, "verb": "use",
                "pattern": [{"type": "literal", "text": word}],
                "effects": [{"type": "call", "id": f"call-{word}", "procedure": "award",
                             "arguments": {"amount": {"type": "literal", "value": 1}}}],
            } for word in ["bell", "lever"]]
            procedure_handle = created_procedures["handle"]
            api(f"projects/{procedure_handle}", "PUT", {
                "project": procedure_project, "revision": created_procedures["revision"],
            })
            procedure_bundle = work / "procedures-from-editor.luna"
            procedure_bundle.write_bytes(api(f"projects/{procedure_handle}/export", "POST", raw=True))
            with zipfile.ZipFile(procedure_bundle) as exported:
                assert "procedures/award.json" in exported.namelist()
                assert "procedures/unused.json" in exported.namelist()
            run(["import", str(procedure_bundle)], profile="procedures")
            procedure_game = procedure_project["game"]
            first = run(["run", procedure_game["id"], "--new"],
                        "use bell\nsave first\nquit\n", profile="procedures")
            assert "Awarded 1 coins." in first and "First reply" in first, first
            resumed = run(["run", procedure_game["id"], "--load", "first"],
                          "use bell\nuse lever\nquit\n", profile="procedures")
            assert "Second reply" in resumed and "First reply" in resumed, resumed
            procedure_autosave = work / "procedures/saves" / procedure_game["id"] / procedure_game["content_version"] / "autosave.json"
            progress = json.loads(procedure_autosave.read_text(encoding="utf-8"))
            assert progress["save_format"] == 7 and progress["state"]["variables"]["rewards"] == 3, progress
            assert len(progress["state"]["procedure_sequences"]) == 2, progress
            run(["run", procedure_game["id"], "--load", "autosave"], "look\nquit\n", profile="procedures")
            assert json.loads(procedure_autosave.read_text(encoding="utf-8"))["state"] == progress["state"], "Restore replayed CALL effects"

            # N2 checks persistence of an explicit synthetic checkpoint. This
            # does not claim production conversation effects run yet.
            narrative_project = json.loads((root / "tests/fixtures/narrative/content5.json").read_text(encoding="utf-8"))
            narrative_state = json.loads((root / "tests/fixtures/narrative/state5.json").read_text(encoding="utf-8"))
            created_narrative = api("projects", "POST", {"folder": "smoke-narrative", "title": "Narrative persistence"})
            narrative_handle = created_narrative["handle"]
            api(f"projects/{narrative_handle}", "PUT", {
                "project": narrative_project, "revision": created_narrative["revision"],
            })
            playtest = api("playtests", "POST", {"project": narrative_project})
            session = playtest["session"]
            replaced = api(f"playtests/{session}/state", "PUT", {"state": narrative_state})
            assert replaced["state"] == narrative_state
            checkpoint = api(f"playtests/{session}/capture", "POST", {"name": "Narrative checkpoint"})
            assert checkpoint["version"] == 3 and checkpoint["state"] == narrative_state
            resumed = api("playtests", "POST", {"project": narrative_project, "setup": checkpoint})
            assert resumed["state"] == narrative_state, "Setup restoration replayed narrative hooks"
            narrative_bundle = work / "narrative-from-editor.luna"
            narrative_bundle.write_bytes(api(f"projects/{narrative_handle}/export", "POST", raw=True))
            with zipfile.ZipFile(narrative_bundle) as exported:
                assert "conversations/unused-conversation.json" in exported.namelist()
                assert "quests/missing.json" in exported.namelist()
                assert not any(name.startswith("editor/") for name in exported.namelist())
            run(["import", str(narrative_bundle)], profile="narrative")
            narrative_game = narrative_project["game"]
            run(["run", narrative_game["id"], "--new"], "look\nquit\n", profile="narrative")
            narrative_saves = work / "narrative/saves" / narrative_game["id"] / narrative_game["content_version"]
            narrative_autosave = narrative_saves / "autosave.json"
            envelope = json.loads(narrative_autosave.read_text(encoding="utf-8"))
            assert envelope["save_format"] == 5
            envelope["state"] = narrative_state
            narrative_autosave.write_text(json.dumps(envelope))
            transcript = run(["run", narrative_game["id"], "--load", "autosave"],
                             "use story\nsave continued\nquit\n", profile="narrative")
            assert "The key was found." in transcript and "First" not in transcript, transcript
            slots = [json.loads(path.read_text(encoding="utf-8")) for path in narrative_saves.glob("*.json")]
            continued = next(slot for slot in slots if slot.get("label") == "continued")
            paused_narrative = {**narrative_state, "narrative": {**narrative_state["narrative"], "active": None}}
            assert continued["save_format"] == 5 and continued["state"] == paused_narrative

            # N3 earns canonical quest progress through native effects. Compare
            # editor execution/captured setups with exported, separate CLI runs.
            quest_project = json.loads((root / "tests/fixtures/narrative/quests5.json").read_text(encoding="utf-8"))
            created_quest = api("projects", "POST", {"folder": "smoke-quests", "title": "Quest runtime"})
            quest_handle = created_quest["handle"]
            api(f"projects/{quest_handle}", "PUT", {
                "project": quest_project, "revision": created_quest["revision"],
            })
            quest_playtest = api("playtests", "POST", {"project": quest_project})
            quest_session = quest_playtest["session"]
            for command in ["use accept", "use find"]:
                api(f"playtests/{quest_session}/commands", "POST", {"command": command})
            quest_setup = api(f"playtests/{quest_session}/capture", "POST", {"name": "Key found"})
            quest_resumed = api("playtests", "POST", {"project": quest_project, "setup": quest_setup})
            assert quest_resumed["state"] == quest_setup["state"]
            for command in ["use return", "use complete", "use complete", "quest key"]:
                quest_result = api(f"playtests/{quest_resumed['session']}/commands", "POST", {"command": command, "explain": True})
            earned_quest = quest_result["state"]
            assert not quest_result["result"]["state_changed"]
            assert earned_quest["variables"]["rewards"] == 1
            assert len(earned_quest["narrative"]["quests"]["missing"]["journal"]) == 4
            quest_bundle = work / "quests-from-editor.luna"
            quest_bundle.write_bytes(api(f"projects/{quest_handle}/export", "POST", raw=True))
            run(["import", str(quest_bundle)], profile="quests")
            quest_game = quest_project["game"]
            run(["run", quest_game["id"], "--new"],
                "use accept\nuse find\nsave progress\nquit\n", profile="quests")
            quest_saves = work / "quests/saves" / quest_game["id"] / quest_game["content_version"]
            assert json.loads((quest_saves / "autosave.json").read_text(encoding="utf-8"))["state"] == quest_setup["state"]
            quest_transcript = run(["run", quest_game["id"], "--load", "progress"],
                "use return\nuse complete\nquest key\nsave completed\nquit\n", profile="quests")
            assert quest_transcript.count("Ten coins for your trouble.") == 1
            assert "Coins before reward: 0." in quest_transcript
            quest_auto = quest_saves / "autosave.json"
            assert json.loads(quest_auto.read_text(encoding="utf-8"))["state"] == earned_quest
            auto_bytes = quest_auto.read_bytes()
            quest_transcript = run(["run", quest_game["id"], "--load", "autosave"],
                "quests\nquest unknown\nquest key\nquit\n", profile="quests")
            assert "Ten coins for your trouble." not in quest_transcript
            assert quest_auto.read_bytes() == auto_bytes, "Quest queries rewrote autosave"

            # N4 uses the same native conversation in HTTP reply controls and
            # numbered terminal input, including entered checkpoints/revisits.
            conversation_project = json.loads((root / "tests/fixtures/narrative/conversations5.json").read_text(encoding="utf-8"))
            created_conversation = api("projects", "POST", {"folder": "smoke-conversations", "title": "Conversations"})
            conversation_handle = created_conversation["handle"]
            api(f"projects/{conversation_handle}", "PUT", {
                "project": conversation_project, "revision": created_conversation["revision"],
            })
            conversation_play = api("playtests", "POST", {"project": conversation_project})
            conversation_id = conversation_play["session"]
            greeting = api(f"playtests/{conversation_id}/commands", "POST", {"command": "talk keeper"})
            old_offer = greeting["result"]["conversation"]
            conversation_setup = api(f"playtests/{conversation_id}/capture", "POST", {"name": "Keeper greeting"})
            conversation_resumed = api("playtests", "POST", {"project": conversation_project, "setup": conversation_setup})
            conversation_id = conversation_resumed["session"]
            current_offer = conversation_resumed["result"]["conversation"]
            assert current_offer["offer_token"] != old_offer["offer_token"]
            assert conversation_resumed["state"] == greeting["state"]
            rejected = api(f"playtests/{conversation_id}/replies", "POST", {
                "offer_token": old_offer["offer_token"], "reply_id": "accept",
            })
            assert rejected["result"]["status"] == "unmatched" and rejected["state"] == greeting["state"]
            api(f"playtests/{conversation_id}/replies", "POST", {
                "offer_token": current_offer["offer_token"], "reply_id": "accept", "explain": True,
            })
            api(f"playtests/{conversation_id}/commands", "POST", {"command": "take brass key"})
            current_offer = api(f"playtests/{conversation_id}/commands", "POST", {"command": "talk keeper"})["result"]["conversation"]
            exchange = api(f"playtests/{conversation_id}/replies", "POST", {
                "offer_token": current_offer["offer_token"], "reply_id": "handover", "explain": True,
            })
            assert exchange["state"]["variables"]["rewards"] == 1
            for command in ["1", "talk keeper", "talk keeper"]:
                conversation_final = api(f"playtests/{conversation_id}/commands", "POST", {"command": command})
            assert "conversation" not in conversation_final["result"]
            conversation_bundle = work / "conversations-from-editor.luna"
            conversation_bundle.write_bytes(api(f"projects/{conversation_handle}/export", "POST", raw=True))
            run(["import", str(conversation_bundle)], profile="conversations")
            conversation_game = conversation_project["game"]
            run(["run", conversation_game["id"], "--new"], "talk keeper\nsave greeting\nquit\n", profile="conversations")
            conversation_saves = work / "conversations/saves" / conversation_game["id"] / conversation_game["content_version"]
            conversation_auto = conversation_saves / "autosave.json"
            assert json.loads(conversation_auto.read_text(encoding="utf-8"))["state"] == greeting["state"]
            exchange_text = run(["run", conversation_game["id"], "--load", "greeting"],
                "1\ntake brass key\ntalk keeper\nreply 2\nsave exchange\nquit\n", profile="conversations")
            assert exchange_text.count("Ten coins for your trouble.") == 1
            assert json.loads(conversation_auto.read_text(encoding="utf-8"))["state"] == exchange["state"]
            revisit_text = run(["run", conversation_game["id"], "--load", "exchange"],
                "1\ntalk keeper\ntalk keeper\nsave completed\nquit\n", profile="conversations")
            assert "Ten coins for your trouble." not in revisit_text
            assert revisit_text.count("Thank you again for finding my key.") == 2
            assert json.loads(conversation_auto.read_text(encoding="utf-8"))["state"] == conversation_final["state"]

            # Exercise canonical timers through the packaged editor, setup restore,
            # exported runner and independent processes with no development tools.
            created_timers = api("projects", "POST", {"folder": "smoke-timers", "title": "Timer boundary"})
            timer_project = created_timers["project"]
            timer_project["game"]["turns"] = {
                "actions": True, "replies": True, "failed_requirements": False,
                "look": False, "hints": False,
            }
            timer_project["game"]["variables"] = {"firings": 0}
            timer_project["timers"] = [{
                "id": "chime", "name": "Chime", "order": 0,
                "effects": [
                    {"type": "update_variable", "name": "firings", "op": "add",
                     "operand": {"type": "literal", "value": 1}},
                    {"type": "say", "text": "The chime sounds."},
                ],
            }, {"id": "unused-timer", "name": "Unused timer", "order": 1}]
            timer_project["game"]["actions"] = [{
                "id": "arm", "name": "Arm", "verb": "use",
                "pattern": [{"type": "literal", "text": "arm"}],
                "effects": [{"type": "schedule_timer", "timer": "chime",
                             "after": {"type": "literal", "value": 2}}],
            }, {
                "id": "cancel", "name": "Cancel", "verb": "use",
                "pattern": [{"type": "literal", "text": "cancel"}],
                "effects": [{"type": "cancel_timer", "timer": "chime"}],
            }]
            timer_handle = created_timers["handle"]
            api(f"projects/{timer_handle}", "PUT", {
                "project": timer_project, "revision": created_timers["revision"],
            })
            timer_test = api("playtests", "POST", {"project": timer_project})
            armed = api(f"playtests/{timer_test['session']}/commands", "POST", {
                "command": "use arm", "explain": True,
            })
            assert armed["result"]["turns"]["turn"] == 1
            pending = armed["result"]["turns"]["pending"][0]
            assert pending["remaining"] == 2 and pending["deadline"] == 3, pending
            assert pending["source"] == {"root": "arm", "subject": "arm", "path": "effects.0"}
            timer_setup = api(f"playtests/{timer_test['session']}/capture", "POST", {"name": "Armed"})
            assert timer_setup["version"] == 5 and timer_setup["state"] == armed["state"]
            timer_restored = api("playtests", "POST", {"project": timer_project, "setup": timer_setup})
            assert timer_restored["state"] == armed["state"]
            timer_session = timer_restored["session"]
            one_more = api(f"playtests/{timer_session}/commands", "POST", {"command": "wait"})
            fired = api(f"playtests/{timer_session}/commands", "POST", {"command": "wait"})
            assert fired["state"]["turns"] == {"turn": 3, "pending": {}}
            assert fired["state"]["variables"]["firings"] == 1
            timer_bundle = work / "timers-from-editor.luna"
            timer_bundle.write_bytes(api(f"projects/{timer_handle}/export", "POST", raw=True))
            with zipfile.ZipFile(timer_bundle) as exported:
                assert "timers/chime.json" in exported.namelist()
                assert "timers/unused-timer.json" in exported.namelist()
                assert not any(name.startswith("editor/") for name in exported.namelist())
            run(["import", str(timer_bundle)], profile="timers")
            timer_game = timer_project["game"]
            timer_auto = work / "timers/saves" / timer_game["id"] / timer_game["content_version"] / "autosave.json"
            run(["run", timer_game["id"], "--new"], "use arm\nlook\nsave armed\nquit\n", profile="timers")
            assert json.loads(timer_auto.read_text(encoding="utf-8"))["save_format"] == 7
            assert json.loads(timer_auto.read_text(encoding="utf-8"))["state"] == armed["state"]
            run(["run", timer_game["id"], "--load", "armed"], "look\nwait\nsave one more\nquit\n", profile="timers")
            assert json.loads(timer_auto.read_text(encoding="utf-8"))["state"] == one_more["state"]
            chime_text = run(["run", timer_game["id"], "--load", "one more"], "wait\nsave fired\nquit\n", profile="timers")
            assert chime_text.count("The chime sounds.") == 1, chime_text
            assert json.loads(timer_auto.read_text(encoding="utf-8"))["state"] == fired["state"]
            canceled_text = run(["run", timer_game["id"], "--load", "armed"], "use cancel\nwait\nquit\n", profile="timers")
            assert "The chime sounds." not in canceled_text
            assert json.loads(timer_auto.read_text(encoding="utf-8"))["state"]["turns"] == {"turn": 3, "pending": {}}
            assert json.loads(timer_auto.read_text(encoding="utf-8"))["state"]["variables"]["firings"] == 0

            # The permanent workshop ships independently of the historical specimens.
            workshop = api("open", "POST", {"folder": "timer-workshop"})
            workshop_project = workshop["project"]
            workshop_game = workshop_project["game"]
            workshop_bundle = work / "workshop-from-editor.luna"
            workshop_bundle.write_bytes(api(f"projects/{workshop['handle']}/export", "POST", raw=True))
            with zipfile.ZipFile(workshop_bundle) as current, zipfile.ZipFile(package / "examples/timer-workshop.luna") as checked:
                assert json.loads(current.read("manifest.json")) == json.loads(checked.read("manifest.json"))
                assert "timers/unused.json" in current.namelist()
                assert not any(name.startswith("editor/") for name in current.namelist())
            run(["import", str(workshop_bundle)], profile="timer-workshop")
            workshop_save = work / "timer-workshop/saves" / workshop_game["id"] / workshop_game["content_version"] / "autosave.json"

            def workshop_run(commands, slot=None):
                run(["run", workshop_game["id"], "--load", slot] if slot else ["run", workshop_game["id"], "--new"], commands + "\nquit\n", profile="timer-workshop")
                envelope = json.loads(workshop_save.read_text(encoding="utf-8"))
                assert envelope["save_format"] == 6
                return envelope["state"]

            def workshop_start(name):
                setup = next(s for s in workshop_project["editor"]["playtest"]["setups"] if s["name"] == name)
                assert setup["version"] == 4
                restored = api("playtests", "POST", {"project": workshop_project, "setup": setup})
                assert restored["state"] == setup["state"]
                assert not restored["result"]["state_changed"]
                return restored

            def workshop_command(view, command):
                return api(f"playtests/{view['session']}/commands", "POST", {"command": command, "explain": True})

            door = workshop_start("Door countdown")
            assert workshop_run("open stone door\nlook\nsave armed") == door["state"]
            for command in ["wait", "wait", "wait"]:
                door = workshop_command(door, command)
            assert workshop_run("wait\nwait\nwait", "armed") == door["state"]
            assert door["state"]["turns"] == {"turn": 4, "pending": {}}
            assert not door["state"]["objects"]["door"]["open"]

            failure = workshop_start("Before late failure")
            assert workshop_run("go lab\nuse failing\nsave dangerous") == failure["state"]
            failed = workshop_command(failure, "use step")
            assert failed["result"]["status"] == "error" and failed["result"]["messages"] == []
            assert failed["state"] == failure["state"]
            assert workshop_run("use step", "dangerous") == failure["state"]
            repaired = workshop_command(workshop_command(failed, "use repair"), "wait")
            assert workshop_run("use repair\nwait", "dangerous") == repaired["state"]
            assert repaired["state"]["variables"]["rewards"] == 1
            assert repaired["state"]["characters"]["keeper"]["location"] == "workshop"

            workshop_signal = workshop_start("Signal requested")
            assert workshop_run("go lab\ntalk keeper\nreply 1\nsave requested") == workshop_signal["state"]
            workshop_signal = workshop_command(workshop_signal, "wait")
            assert workshop_run("wait", "requested") == workshop_signal["state"]
            assert workshop_signal["quest_log"][0]["status"] == "completed"
            assert workshop_signal["state"]["variables"]["rewards"] == 1

            ending = workshop_start("Before timer ending")
            assert workshop_run("go lab\nuse finish\nsave finishing") == ending["state"]
            ending = workshop_command(ending, "wait")
            assert workshop_run("wait\nsave completed", "finishing") == ending["state"]
            assert ending["state"]["turns"] == {"turn": 3, "pending": {}}
            assert ending["state"]["variables"]["ending_hooks"] == 1
            assert workshop_run("look", "completed") == ending["state"]

            # Routines use the separate progressive workshop and version-7 saves.
            routine = api("open", "POST", {"folder": "routine-workshop"})
            routine_project = routine["project"]
            routine_game = routine_project["game"]
            routine_bundle = work / "routines-from-editor.luna"
            routine_bundle.write_bytes(api(f"projects/{routine['handle']}/export", "POST", raw=True))
            with zipfile.ZipFile(routine_bundle) as current, zipfile.ZipFile(package / "examples/routine-workshop.luna") as checked:
                assert json.loads(current.read("manifest.json")) == json.loads(checked.read("manifest.json"))
                assert len([name for name in current.namelist() if name.startswith("routines/")]) == 10
                assert "routines/unused.json" in current.namelist()
                assert not any(name.startswith("editor/") for name in current.namelist())
            run(["import", str(routine_bundle)], profile="routines")
            routine_saves = work / "routines/saves" / routine_game["id"] / routine_game["content_version"]

            def routine_run(commands, slot=None):
                transcript = run(["run", routine_game["id"], "--load", slot] if slot else
                                 ["run", routine_game["id"], "--new"], commands + "\nquit\n", profile="routines")
                envelope = json.loads((routine_saves / "autosave.json").read_text(encoding="utf-8"))
                assert envelope["save_format"] == 7
                return envelope["state"], transcript

            def routine_start(name):
                setup = next(s for s in routine_project["editor"]["playtest"]["setups"] if s["name"] == name)
                assert setup["version"] == 5
                restored = api("playtests", "POST", {"project": routine_project, "setup": setup})
                assert restored["state"] == setup["state"] and not restored["result"]["state_changed"]
                return restored

            def routine_command(view, command):
                return api(f"playtests/{view['session']}/commands", "POST", {"command": command, "explain": True})

            assert len(routine_project["editor"]["playtest"]["setups"]) == 9
            for setup in routine_project["editor"]["playtest"]["setups"]:
                routine_start(setup["name"])
            for check in routine_project["editor"]["playtest"]["checks"]:
                assert api("playtests/checks", "POST", {"project": routine_project, "check": check})["passed"]

            patrol = routine_start("Patrol mid-wait")
            assert routine_run("wait\ngo garden\nwait\nsave armed")[0] == patrol["state"]
            assert routine_run("look\nhelp\nsave inspected", "armed")[0] == patrol["state"]
            assert patrol["result"]["routines"][0]["wait"] == {"captured": 2, "remaining": 1}
            for _ in range(3):
                patrol = routine_command(patrol, "wait")
            completed, transcript = routine_run("wait\nwait\nwait", "armed")
            assert completed == patrol["state"] and transcript.count("The garden is quiet.") == 1
            held = routine_start("Conversation hold")
            assert routine_run("talk keeper\nsave held", "armed")[0] == held["state"]
            held = routine_command(held, "wait")
            assert held["result"]["routines"][0]["conversation_held"]
            assert routine_run("wait", "held")[0] == held["state"]
            held = routine_command(held, "reply 3")
            assert held["result"]["routines"][0]["wait"]["remaining"] == 1
            assert routine_run("wait\nreply 3", "held")[0] == held["state"]
            paused = routine_start("Manual pause during conversation")
            assert routine_run("reply 2\nsave paused", "held")[0] == paused["state"]
            for command in ["bye", "wait", "go study", "go lab", "use resume"]:
                paused = routine_command(paused, command)
            assert routine_run("bye\nwait\ngo study\ngo lab\nuse resume", "paused")[0] == paused["state"]
            assert paused["result"]["routines"][0]["wait"]["remaining"] == 1

            gate = routine_start("Gate blocked")
            assert gate["result"]["routines"][1]["blocked"]
            assert routine_run("go lab\nuse gate\nwait\nsave gated")[0] == gate["state"]
            for command in ["open gate", "wait", "use endgate", "wait"]:
                gate = routine_command(gate, command)
            assert routine_run("open gate\nwait\nuse endgate\nwait", "gated")[0] == gate["state"]
            night = routine_start("Night storage")
            assert routine_run("go lab\nuse night\nwait\nwait\nsave night")[0] == night["state"]
            assert night["state"]["objects"]["badge"]["placement"] == {"type": "character", "character": "keeper"}
            for _ in range(3):
                night = routine_command(night, "wait")
            assert routine_run("wait\nwait\nwait", "night")[0] == night["state"]
            ordered, transcript = routine_run("go lab\nuse pair\nwait")
            assert ordered["variables"]["signals"] == 2
            assert transcript.index("First signal.") < transcript.index("Second signal.")
            award = routine_start("Conditional award armed")
            assert routine_run("go lab\nuse ready\nwait\nsave award")[0] == award["state"]
            for command in ["wait", "use award", "wait"]:
                award = routine_command(award, command)
            assert routine_run("wait\nuse award\nwait", "award")[0] == award["state"]
            assert award["state"]["variables"]["rewards"] == 1

            failure = routine_start("Before late failure")
            assert routine_run("go lab\nuse failing\nsave dangerous")[0] == failure["state"]
            failed = routine_command(failure, "use step")
            assert failed["result"]["status"] == "error" and failed["result"]["messages"] == []
            assert failed["state"] == failure["state"]
            unchanged, discarded = routine_run("use step", "dangerous")
            assert unchanged == failure["state"] and "Discard this routine output" not in discarded
            repaired = routine_command(routine_command(failed, "use repair"), "wait")
            assert routine_run("use repair\nwait", "dangerous")[0] == repaired["state"]
            assert repaired["state"]["variables"]["rewards"] == 1
            ending = routine_start("Before routine ending")
            assert routine_run("go lab\nuse finish\nsave finishing")[0] == ending["state"]
            ending = routine_command(ending, "wait")
            finished, transcript = routine_run("wait\nsave completed", "finishing")
            assert finished == ending["state"] and finished["variables"]["ending_hooks"] == 1
            assert "Outcome:" not in transcript and "A later routine should not run." not in transcript
            assert routine_run("look", "completed")[0] == ending["state"]

            # Reject malformed stored cursors without rewriting the damaged bytes.
            damaged_path = next(path for path in routine_saves.glob("*.json")
                                if json.loads(path.read_text(encoding="utf-8"))["label"] == "armed")
            damaged = json.loads(damaged_path.read_text(encoding="utf-8"))
            damaged["state"]["routines"]["runs"]["evening-patrol"]["cursor"]["wait"]["remaining"] = 0
            damaged_bytes = json.dumps(damaged).encode()
            damaged_path.write_bytes(damaged_bytes)
            rejected = subprocess.run([str(runner), "--config", str(runner_config), "--games-dir", str(work / "routines/games"),
                "--saves-dir", str(work / "routines/saves"), "run", routine_game["id"], "--load", "armed"],
                input="quit\n", text=True, capture_output=True, encoding="utf-8", env=env, cwd=work, timeout=15)
            assert rejected.returncode != 0 and damaged_path.read_bytes() == damaged_bytes

            # Permanent U4 content: actual editor export, empty-history setup
            # restores, whole-action rollback/restoration and independent CLI slots.
            undo_workshop = api("open", "POST", {"folder": "undo-workshop"})
            undo_content = undo_workshop["project"]
            undo_content_game = undo_content["game"]
            assert undo_content_game["format_version"] == 8 and undo_content_game["allow_player_undo"]
            undo_export = work / "undo-workshop-from-editor.luna"
            undo_export.write_bytes(api(f"projects/{undo_workshop['handle']}/export", "POST", raw=True))
            with zipfile.ZipFile(undo_export) as exported, zipfile.ZipFile(package / "examples/undo-workshop.luna") as checked:
                assert json.loads(exported.read("manifest.json")) == json.loads(checked.read("manifest.json"))
                assert not any(name.startswith("editor/") for name in exported.namelist())
            undo_setups = {setup["name"]: setup for setup in undo_content["editor"]["playtest"]["setups"]}
            assert len(undo_setups) == 8
            for setup in undo_setups.values():
                assert setup["version"] == 5 and "undo_history" not in setup["state"]
                restored = api("playtests", "POST", {"project": undo_content, "setup": setup})
                assert restored["state"] == setup["state"] and restored["result"]["undo"]["available"] == 0
            for check in undo_content["editor"]["playtest"]["checks"]:
                assert api("playtests/checks", "POST", {"project": undo_content, "check": check, "explain": True})["passed"]
            def undo_restore(name):
                return api("playtests", "POST", {"project": undo_content, "setup": undo_setups[name]})
            def undo_command(view, command):
                return api(f"playtests/{view['session']}/commands", "POST", {"command": command, "explain": True})
            armed = undo_restore("Lab armed")
            changed = undo_command(armed, "pull console")
            assert changed["state"]["variables"]["coins"] == 10
            assert all(changed["state"]["variables"][key] == 1 for key in ["lab_value", "watches", "bells", "routine_moves"])
            undone = api(f"playtests/{armed['session']}/undo", "POST", {})
            assert undone["state"] == armed["state"] and undone["result"]["undo"]["available"] == 0
            failure = undo_restore("Before late failure")
            failed = undo_command(failure, "pull console")
            assert failed["result"]["status"] == "error" and failed["state"] == failure["state"]
            run(["import", str(undo_export)], profile="undo-workshop")
            undo_workshop_saves = work / "undo-workshop/saves" / undo_content_game["id"] / undo_content_game["content_version"]
            def undo_saved(label):
                return next(json.loads(path.read_text(encoding="utf-8")) for path in undo_workshop_saves.glob("*.json")
                            if json.loads(path.read_text(encoding="utf-8"))["label"] == label)
            transcript = run(["run", undo_content_game["id"], "--new"],
                             "take brass key\nsave carrying\nundo\nsave empty\nquit\n", profile="undo-workshop")
            assert "Undid “take brass key”." in transcript
            assert undo_saved("empty")["state"]["turns"]["turn"] == 0
            assert undo_saved("empty")["state"]["objects"]["brass-key"]["placement"]["type"] == "location"
            run(["run", undo_content_game["id"], "--new"],
                "go lab\nuse arm\nsave armed\npull console\nsave changed\nundo\nsave undone\nquit\n", profile="undo-workshop")
            assert undo_saved("changed")["state"] == changed["state"]
            assert undo_saved("undone")["state"] == armed["state"]
            assert undo_saved("undone")["save_format"] == 7
            transcript = run(["run", undo_content_game["id"], "--load", "changed"],
                             "undo\nsave unchanged\nquit\n", profile="undo-workshop")
            assert "Undid" not in transcript and undo_saved("unchanged")["state"] == changed["state"]
            transcript = run(["run", undo_content_game["id"], "--new"],
                             "pull lever\npush finish button\nsave ended\nundo\nsave playing\nquit\n", profile="undo-workshop")
            assert "Undid “push finish button”." in transcript and "Outcome:" not in transcript
            assert undo_saved("ended")["state"] == undo_setups["Completed game"]["state"]
            assert undo_saved("playing")["state"]["ending"] is None
            assert undo_saved("playing")["state"]["variables"]["ending_hooks"] == 0
            run(["run", undo_content_game["id"], "--new"],
                "pull lever\n" * 25 + "undo\n" * 20 + "save bounded\nquit\n", profile="undo-workshop")
            assert undo_saved("bounded")["state"]["variables"]["lever_pulls"] == 5

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
            state = json.loads(autosave.read_text(encoding="utf-8"))
            assert state["save_format"] == (7 if game["format_version"] >= 7 else 6 if game["format_version"] >= 6 else 5 if game["format_version"] >= 5 else 4 if game["format_version"] >= 4 else 3 if game["format_version"] >= 2 else 2), state
            assert state["state"]["ending"] == "finish", state
        finally:
            if editor is not None and editor.poll() is None:
                editor.terminate()
                try:
                    editor.wait(timeout=10)
                except subprocess.TimeoutExpired:
                    editor.kill()
                    editor.wait(timeout=10)
            stdout_log.close()
            stderr_log.close()
            if moved:
                hidden.rename(frontend)
        print("Packaged examples, containers, parser clarification/restart, player undo/content-8/session history and Undo Workshop, procedures/Reward Workshop, Keeper quest/checkpoints/rollback/revisits, narrative persistence/quest/conversation execution, turn timers/setup/process parity/cancellation, Timer Workshop callbacks/rollback/quests/endings, Routine Workshop holds/pauses/waits/order/offstage/rollback/corruption/endings, fixed walkthrough, optional outcomes, and embedded editor passed "
              "without source UI or development tools.")


if __name__ == "__main__":
    main()
