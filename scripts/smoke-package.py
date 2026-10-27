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

            # New-game defaults and the permanent parser fixture use the packaged
            # API/export, not a handwritten runner-only substitute.
            fresh = api("projects", "POST", {"folder": "smoke-parser", "title": "Parser defaults"})
            assert fresh["project"]["game"]["format_version"] == 5
            assert fresh["project"]["game"]["command_assistance"]["clarification"]
            assert fresh["project"]["game"]["command_assistance"]["recent_objects"]
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
                return json.loads((gallery_saves / "autosave.json").read_text())
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
                saved = json.loads((workshop_saves / "autosave.json").read_text())
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
                saved = json.loads((keeper_saves / "autosave.json").read_text())
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
            progress = json.loads(procedure_autosave.read_text())
            assert progress["save_format"] == 5 and progress["state"]["variables"]["rewards"] == 3, progress
            assert len(progress["state"]["procedure_sequences"]) == 2, progress
            run(["run", procedure_game["id"], "--load", "autosave"], "look\nquit\n", profile="procedures")
            assert json.loads(procedure_autosave.read_text())["state"] == progress["state"], "Restore replayed CALL effects"

            # N2 checks persistence of an explicit synthetic checkpoint. This
            # does not claim production conversation effects run yet.
            narrative_project = json.loads((root / "tests/fixtures/narrative/content5.json").read_text())
            narrative_state = json.loads((root / "tests/fixtures/narrative/state5.json").read_text())
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
            envelope = json.loads(narrative_autosave.read_text())
            assert envelope["save_format"] == 5
            envelope["state"] = narrative_state
            narrative_autosave.write_text(json.dumps(envelope))
            transcript = run(["run", narrative_game["id"], "--load", "autosave"],
                             "use story\nsave continued\nquit\n", profile="narrative")
            assert "The key was found." in transcript and "First" not in transcript, transcript
            slots = [json.loads(path.read_text()) for path in narrative_saves.glob("*.json")]
            continued = next(slot for slot in slots if slot.get("label") == "continued")
            paused_narrative = {**narrative_state, "narrative": {**narrative_state["narrative"], "active": None}}
            assert continued["save_format"] == 5 and continued["state"] == paused_narrative

            # N3 earns canonical quest progress through native effects. Compare
            # editor execution/captured setups with exported, separate CLI runs.
            quest_project = json.loads((root / "tests/fixtures/narrative/quests5.json").read_text())
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
            assert json.loads((quest_saves / "autosave.json").read_text())["state"] == quest_setup["state"]
            quest_transcript = run(["run", quest_game["id"], "--load", "progress"],
                "use return\nuse complete\nquest key\nsave completed\nquit\n", profile="quests")
            assert quest_transcript.count("Ten coins for your trouble.") == 1
            assert "Coins before reward: 0." in quest_transcript
            quest_auto = quest_saves / "autosave.json"
            assert json.loads(quest_auto.read_text())["state"] == earned_quest
            auto_bytes = quest_auto.read_bytes()
            quest_transcript = run(["run", quest_game["id"], "--load", "autosave"],
                "quests\nquest unknown\nquest key\nquit\n", profile="quests")
            assert "Ten coins for your trouble." not in quest_transcript
            assert quest_auto.read_bytes() == auto_bytes, "Quest queries rewrote autosave"

            # N4 uses the same native conversation in HTTP reply controls and
            # numbered terminal input, including entered checkpoints/revisits.
            conversation_project = json.loads((root / "tests/fixtures/narrative/conversations5.json").read_text())
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
            assert json.loads(conversation_auto.read_text())["state"] == greeting["state"]
            exchange_text = run(["run", conversation_game["id"], "--load", "greeting"],
                "1\ntake brass key\ntalk keeper\nreply 2\nsave exchange\nquit\n", profile="conversations")
            assert exchange_text.count("Ten coins for your trouble.") == 1
            assert json.loads(conversation_auto.read_text())["state"] == exchange["state"]
            revisit_text = run(["run", conversation_game["id"], "--load", "exchange"],
                "1\ntalk keeper\ntalk keeper\nsave completed\nquit\n", profile="conversations")
            assert "Ten coins for your trouble." not in revisit_text
            assert revisit_text.count("Thank you again for finding my key.") == 2
            assert json.loads(conversation_auto.read_text())["state"] == conversation_final["state"]

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
            assert state["save_format"] == (5 if game["format_version"] >= 5 else 4 if game["format_version"] >= 4 else 3 if game["format_version"] >= 2 else 2), state
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
        print("Packaged examples, containers, parser clarification/restart, procedures/Reward Workshop, Keeper quest/checkpoints/rollback/revisits, narrative persistence/quest/conversation execution, fixed walkthrough, optional outcomes, and embedded editor passed "
              "without source UI or development tools.")


if __name__ == "__main__":
    main()
