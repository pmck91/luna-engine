---
title: Tests and performance
description: Choose meaningful Rust, frontend, browser, parity and package checks, and measure large games without misleading thresholds.
sidebar:
  order: 9
---

## Continuous verification

```sh
npm --prefix web run format:check
npm --prefix web run build
cargo fmt --all --check
cargo clippy --workspace --all-targets -- -D warnings
RUSTDOCFLAGS="-D warnings" cargo doc -p luna-core --no-deps
cargo test --workspace
cargo run -p luna-editor --example export_types -- --check
npm --prefix web test
cargo build -p luna-editor
```

Install Chromium/Firefox once, then run both browser projects:

```sh
cd web
npx playwright install chromium firefox
LUNA_TEST_FIREFOX=1 npm run test:e2e
```

CI installs browser system dependencies too. LUNA_FIREFOX_EXECUTABLE can select a compatible preinstalled Firefox. Playwright writes failure screenshots/traces under web/test-results.

Compile Rust before running browsers on a memory-constrained machine. Keep one Playwright worker. Run benchmarks alone; concurrent browser/build workloads distort timing.

## What each layer proves

| Layer              | Expected evidence                                                                      |
| ------------------ | -------------------------------------------------------------------------------------- |
| Model/core         | Validation, state invariants, transactional semantics, limits and compatibility        |
| Project/runner     | Real files, bundles, locks, recovery and process restoration                           |
| Editor integration | HTTP/native playtest, exported/installed runner parity and captured setups             |
| Frontend unit      | Canonical projection/round-trip, reference repair, history and layout logic            |
| Browser            | Real controls, blocks, navigation, keyboard/focus, compact layouts and player flow     |
| Packaged smoke     | Standalone executables and embedded UI without development dependencies                |
| Docs               | Build/types, internal routes/assets/anchors, real screenshots and tutorial walkthrough |

Use meaningful behavior assertions. A test that duplicates an internal expression adds less value than a rejected malformed save, failed late callback rollback or real authored/exported playthrough.

Normal tests must not rewrite canonical examples. Explicit LUNA_CAPTURE_* refresh switches are maintenance operations. Read the corresponding acceptance notes before using them.

## Scaling

```sh
cargo bench -p luna-runner --bench scaling -- 100 1000 5000
cargo bench -p luna-runner --bench parser_context -- 100 1000 5000
cargo bench -p luna-runner --bench procedures -- 100 1000 5000
cargo bench -p luna-runner --bench turns -- 100 1000 5000
cargo bench -p luna-runner --bench routines -- 100 1000 5000
```

Definition startup and repeated gameplay are separate measurements. Immutable indexes improve repeated lookup at an initialization/memory cost. Ordinary transactions clone the whole mutable state; read-only views can borrow it. Sparse procedure progress avoids enumerating potential call paths.

Explained execution takes additional state snapshots/diffs. A large simultaneous changing batch can take seconds in diagnostics even when normal execution is much faster. Queue/routine work remains bounded by the shared execution budget.

Record compiler, fixture sizes, sample counts and storage device. Save timings on tmpfs exclude physical-disk latency. Observations are not CI performance thresholds. Profile a realistic game before adding a complex cache or undo-log executor.

Raw evidence is retained in the repository's [design measurement records](https://github.com/pmck91/luna-engine/tree/main/docs/design) and [hardening plan](https://github.com/pmck91/luna-engine/blob/main/docs/plans/core-hardening.md).
