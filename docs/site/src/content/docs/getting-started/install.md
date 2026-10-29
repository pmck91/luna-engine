---
title: Install and launch
description: Open Luna’s local visual text adventure editor and choose where to keep your projects.
sidebar:
  order: 1
---

## Platform support

Luna Engine **1.0.0** targets Linux x86_64. **Windows x86_64 and macOS (Apple Silicon and Intel) builds are experimental and unsigned.** macOS builds are not notarized. Ordinary desktop launch and minimum OS compatibility need separate review from hosted build/test checks.

The application version is separate from your game’s content version and the project/save format versions. Updating Luna to 1.0.0 does not change those formats.

## Use a packaged build

Open [GitHub Releases](https://github.com/pmck91/luna-engine/releases) and choose the archive matching your OS and processor. Before the first release is published, use a successful [native package workflow](https://github.com/pmck91/luna-engine/actions/workflows/native-release.yml) and download its `release-package-<platform>` artifact. GitHub may require sign-in for Actions artifacts. Those artifacts wrap the actual archive and checksum in an additional ZIP.

| Platform          | Version 1 archive                         |
| ----------------- | ----------------------------------------- |
| Linux x86_64      | `luna-engine-v1.0.0-linux-x86_64.tar.gz`  |
| Mac Apple Silicon | `luna-engine-v1.0.0-macos-aarch64.tar.gz` |
| Mac Intel         | `luna-engine-v1.0.0-macos-x86_64.tar.gz`  |
| Windows x86_64    | `luna-engine-v1.0.0-windows-x86_64.zip`   |

Download the matching `.sha256` sidecar. Compare its hash with `sha256sum <archive>` on Linux, `shasum -a 256 <archive>` on Mac, or `Get-FileHash <archive> -Algorithm SHA256` in PowerShell.

Extract the entire archive into a writable folder. On Linux or macOS, open a terminal in that folder:

```sh
./luna-editor --projects-dir ./examples
```

On Windows, open PowerShell in the extracted folder:

```powershell
.\luna-editor.exe --projects-dir .\examples
```

The package contains the editor, the `luna` terminal runner and nine editable example projects with matching exported games. You do not need Rust, Node.js or Python to run it. Windows builds include the static MSVC runtime. Use a desktop Chromium or Firefox browser. Read `START-HERE.txt` for launch instructions; `build.json` records the exact version, source, target and file hashes.

Unsigned downloads may be blocked or warned about by macOS Gatekeeper or Windows SmartScreen. Review the download source and checksum before deciding to run an experimental build; do not disable system-wide protections. There are no signing credentials to configure for users.

The Linux package is built on Ubuntu 22.04 with a glibc 2.35 compatibility ceiling; other distributions need compatible system libraries. macOS builds set a deployment target of 11.0 and are tested on macOS 15 hosts; that does not establish compatibility with every older version. Windows builds are tested on Windows Server 2022 x64; Windows 10/11 desktop acceptance remains separate.

If your file manager does not launch the executable, open a terminal in the extracted directory and run the command there. If a chosen port is occupied:

```sh
./luna-editor --port 0
```

## Choose a projects directory

Without `--projects-dir`, the first launch asks for **Projects directory (absolute path)**. Choose a folder you own, then **Use this directory**. The editor remembers it. Each project is a subfolder.

The editor opens a local URL with a launch token. Keep that complete URL when opening another tab; a different launch gets a new token. The service binds to localhost. Keep the terminal process running while editing.

For an existing project, choose its folder in **Open project**. An exported `.luna` game is a player bundle; open the original editable project folder to continue authoring.

## Run from source without installing

Install stable Rust and Node.js **22.23.4 or newer** (Node 26 is used in CI), then run from the repository root:

```sh
npm --prefix web ci
npm --prefix web run build
cargo run -p luna-editor -- --projects-dir ./examples
```

The first run compiles the local editor. These commands do not install it system-wide. See [developer setup](/luna-engine/developer/development/) for live frontend development and verification.

Next: [build your first adventure](/luna-engine/getting-started/first-adventure/).
