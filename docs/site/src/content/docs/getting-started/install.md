---
title: Install and launch
description: Open Luna’s local visual text adventure editor and choose where to keep your projects.
sidebar:
  order: 1
---

## Use a packaged build

Open the repository's [successful main build](https://github.com/pmck91/luna-engine/actions/workflows/ci.yml?query=branch%3Amain). Download the **luna-engine-linux-x86_64** artifact from the run summary. GitHub may require sign-in to download Actions artifacts.

Extract the artifact ZIP, then extract its inner `luna-engine-linux-x86_64.tar.gz`. From the resulting directory:

```sh
./luna-editor --projects-dir ./examples
```

The package contains the editor, the `luna` terminal runner and example projects. You do not need Rust, Node.js or Python to run it. The packaged target is Linux x86_64. Use a desktop Chromium or Firefox browser.

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
