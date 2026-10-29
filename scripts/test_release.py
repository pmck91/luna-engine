"""Archive and publication gate regressions; no network or real release writes."""
import hashlib
import io
import json
from pathlib import Path
import tarfile
import tempfile
import struct
import unittest
from unittest.mock import patch
import zipfile

from release_common import EXAMPLES, TARGETS, extract_verified, package_name, sha256, verify_archive, version
import release
from check_native_dependencies import windows_imports


def fixture(directory, target, *, extra=None, executable=True, revision="abc123"):
    """Small structurally complete archives, for validation rather than execution."""
    suffix = ".exe" if target["platform"].startswith("windows-") else ""
    files = {name: b"fixture" for name in ("README.md", "START-HERE.txt", "examples/README.md",
                                         "luna" + suffix, "luna-editor" + suffix)}
    for example in EXAMPLES:
        files[f"examples/{example}.luna"] = b"fixture"
        files[f"examples/{example}/game.json"] = b"{}"
    files.update(extra or {})
    metadata = {"version": version(), "revision": revision, "target": target["target"],
                "working_tree_dirty": False, "signing": "unsigned",
                "files": {name: hashlib.sha256(data).hexdigest() for name, data in files.items()}}
    files["build.json"] = json.dumps(metadata).encode()
    root = package_name(target)
    path = directory / (root + target["extension"])
    if suffix:
        with zipfile.ZipFile(path, "w") as archive:
            for name, data in files.items():
                archive.writestr(root + "/" + name, data)
    else:
        with tarfile.open(path, "w:gz") as archive:
            for name, data in files.items():
                item = tarfile.TarInfo(root + "/" + name)
                item.size = len(data)
                item.mode = 0o755 if executable else 0o644
                archive.addfile(item, io.BytesIO(data))
    path.with_name(path.name + ".sha256").write_text(f"{sha256(path)}  {path.name}\n", encoding="utf-8")
    return path


class ReleaseTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.directory = Path(self.temp.name)

    def test_all_four_formats_verify_and_extract_with_spaces_and_unicode(self):
        for target in TARGETS:
            with self.subTest(target=target["platform"]):
                path = fixture(self.directory, target)
                metadata, _ = verify_archive(path, revision="abc123", target=target)
                self.assertEqual(metadata["target"], target["target"])
                extracted = extract_verified(path, self.directory / "café workspace", target=target)
                self.assertTrue((extracted / "examples/observatory/game.json").is_file())

    def test_tampered_archive_is_rejected_before_extraction(self):
        path = fixture(self.directory, TARGETS[0])
        with path.open("ab") as stream:
            stream.write(b"tampered")
        with self.assertRaisesRegex(ValueError, "Checksum mismatch"):
            extract_verified(path, self.directory / "destination")
        self.assertFalse((self.directory / "destination").exists())

    def test_wrong_revision_and_target_are_rejected(self):
        path = fixture(self.directory, TARGETS[0])
        with self.assertRaisesRegex(ValueError, "revision"):
            verify_archive(path, revision="different")
        with self.assertRaisesRegex(ValueError, "target"):
            verify_archive(path, target=TARGETS[-1])

    def test_nonportable_members_and_dependency_trees_are_rejected(self):
        for member in ("../escape", "C:/escape", "foo\\escape", "node_modules/cache", ".luna-write.lock", "readme.md", "CON.txt", "examples/AUX.json"):
            with self.subTest(member=member):
                path = fixture(self.directory, TARGETS[-1], extra={member: b"unexpected"})
                with self.assertRaises(ValueError):
                    verify_archive(path)

    def test_unix_executable_permissions_are_required(self):
        path = fixture(self.directory, TARGETS[0], executable=False)
        with self.assertRaisesRegex(ValueError, "permissions"):
            verify_archive(path)

    def test_release_requires_exactly_four_packages_of_the_same_source(self):
        for target in TARGETS:
            fixture(self.directory, target)
        self.assertEqual(len(release.verify_set(self.directory, "abc123")), 8)
        fixture(self.directory, TARGETS[-1], revision="different")
        with self.assertRaisesRegex(ValueError, "revision"):
            release.verify_set(self.directory, "abc123")

    def test_invalid_tag_is_rejected_before_any_git_or_network_call(self):
        with patch.object(release, "output") as command:
            with self.assertRaisesRegex(ValueError, "tag"):
                release.check_tag("v0.0.0")
            command.assert_not_called()

    def test_windows_dependency_reader_maps_pe_import_names(self):
        data = bytearray(1024)
        struct.pack_into("<I", data, 0x3C, 0x80)
        data[0x80:0x84] = b"PE\0\0"
        struct.pack_into("<H", data, 0x86, 1)
        struct.pack_into("<H", data, 0x94, 240)
        optional = 0x98
        struct.pack_into("<H", data, optional, 0x20B)
        struct.pack_into("<I", data, optional + 120, 0x1000)
        struct.pack_into("<IIII", data, optional + 240 + 8, 512, 0x1000, 512, 512)
        struct.pack_into("<I", data, 512 + 12, 0x1050)
        data[592:605] = b"KERNEL32.dll\0"
        path = self.directory / "fixture.exe"
        path.write_bytes(data)
        self.assertEqual(windows_imports(path), ["KERNEL32.dll"])

    def test_existing_draft_or_published_release_is_never_overwritten(self):
        for draft in (True, False):
            with self.subTest(draft=draft), patch.object(release, "check_tag", return_value="abc123"), \
                    patch.object(release, "verify_set", return_value=[]), \
                    patch.object(release, "output", return_value=json.dumps([[{"tag_name": "v1.0.0", "draft": draft}]])), \
                    patch.object(release.subprocess, "run") as mutation:
                with self.assertRaisesRegex(ValueError, "already exists"):
                    release.draft(self.directory, "v1.0.0")
                mutation.assert_not_called()

    def test_new_release_is_always_a_draft_with_the_complete_asset_set(self):
        assets = [self.directory / f"asset-{index}" for index in range(8)]
        for app_version in ("1.0.0", "1.0.1-rc.1"):
            with self.subTest(version=app_version), patch.object(release, "check_tag", return_value="abc123"), \
                    patch.object(release, "verify_set", return_value=assets), \
                    patch.object(release, "output", return_value="[[]]"), \
                    patch.object(release, "version", return_value=app_version), \
                    patch.object(release.subprocess, "run") as mutation:
                release.draft(self.directory, "v" + app_version)
                command = mutation.call_args.args[0]
                self.assertIn("--draft", command)
                self.assertIn("--verify-tag", command)
                self.assertEqual("--prerelease" in command, "-" in app_version)
                self.assertEqual(command[-8:], list(map(str, assets)))


if __name__ == "__main__":
    unittest.main()
