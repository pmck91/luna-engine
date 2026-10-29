---
title: Build and develop locally
description: Build the Rust workspace, run the local editor without installing and preview the documentation.
sidebar:
  order: 8
---

Use stable Rust (edition 2024 workspace) and Node.js **22.23.4+** with npm for the complete repository, including docs. CI uses Node 26. Run commands from the repository root unless stated otherwise.

## Editor and runner

```sh
npm --prefix web ci
npm --prefix web run build
cargo build --workspace
cargo run -p luna-editor -- --projects-dir ./examples
```

The debug editor serves web/dist. Build the frontend after changing it. Run `cargo run -p luna-runner -- --help` for the terminal host without installing.

For live frontend development, launch the native service on its default port, then:

```sh
npm --prefix web run dev
```

Open the Vite URL using the same `#token=…` fragment printed by the service. Vite proxies /api to localhost:4318. Use a different disposable projects root when experiments should not edit checked-in examples.

## Shared types and API reference

```sh
cargo run -p luna-editor --example export_types
cargo run -p luna-editor --example export_types -- --check
cargo doc -p luna-core --no-deps --open
```

Regenerate only after intentional contract changes, review the diff and run frontend checks. Public core APIs enforce missing_docs; doctests cover practical embedding and access restrictions.

## Documentation

```sh
npm --prefix docs/site ci
npm --prefix docs/site run dev
```

Open the printed local URL under **/luna-engine/**. Search is indexed by the production build; use preview when checking it:

```sh
npm --prefix docs/site run check
npm --prefix docs/site run build
npm --prefix docs/site run check:links
npm --prefix docs/site run preview
```

Markdown/MDX content lives in docs/site/src/content/docs. Public documentation excludes internal plans/design evidence. Screenshots use real current-editor state; [documentation maintenance](/luna-engine/developer/documentation/) explains capture and tutorial verification.

## Package without installing

```sh
./scripts/package.sh
python3 scripts/smoke-package.py
```

Packaging builds release executables and an archive/checksum in dist. The release editor embeds the complete UI and Blockly media. The smoke check extracts outside the repository, removes development tools from child PATH and exercises native export/import/play/save/restore.

Run package smoke after browsers finish: it temporarily hides web/dist to prove embedded UI serving, then restores it. None of these commands install or publish a system package.
