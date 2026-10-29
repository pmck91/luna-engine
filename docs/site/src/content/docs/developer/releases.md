---
title: Build and release native packages
description: Package Luna for Linux, macOS and Windows, validate extracted downloads and prepare a reviewed GitHub Release.
sidebar:
  order: 10
---

Luna uses one packaging implementation and one native build workflow for PRs, manual builds and tagged releases. Application versions come from the root Cargo.toml workspace; both executables and the private frontend/docs package metadata use the same version. Game content, save and setup formats are independent.

## Package locally

Install Git, stable Rust, Node 26, Python 3.12+ and the frontend dependencies, then run:

```sh
npm --prefix web ci
python3 scripts/package.py
python3 scripts/smoke-package.py
```

The packager detects the native Rust host and supports Linux x86_64, macOS aarch64/x86_64 and Windows x86_64 MSVC. It builds the frontend before release compilation, then writes a versioned `.tar.gz` (Unix) or `.zip` (Windows) and SHA-256 sidecar under dist. `--skip-build` is for callers that already built the current release executables; it still verifies binary versions. The Unix shell wrapper delegates to the same implementation.

The archive has one root directory containing both executables, README, START-HERE.txt, build.json and nine maintained examples with native exports. Only tracked canonical project files, declared assets and selected workshop prose are copied. Site dependencies, source trees, caches, locks and recovery files are excluded. Do not modify checked examples or historical fixtures just to make packaging pass.

build.json records source revision, dirty-checkout status, target, compiler, Node version, unsigned status, binary versions and per-file hashes. Local dirty builds are useful for testing; tagged release assembly rejects them. A checksum proves integrity against the supplied sidecar; it is not a signing certificate.

## Native checks

The **Native release packages** workflow runs on PRs and manually through Actions → Native release packages → Run workflow. A new workflow may need to reach the default branch before GitHub exposes its manual button; an open PR tests it before merge.

scripts/release-targets.json supplies both the workflow matrix and package identity. Native jobs use Ubuntu 22.04 x86_64, macOS 15 Apple Silicon, macOS 15 Intel and Windows Server 2022 x86_64. Each job:

1. Verifies the actual Rust host triple and records tooling.
2. Runs release-tool regressions and frontend tests, builds the UI and locked release workspace, and runs native Rust tests (including real PTY/ConPTY keyboard journeys).
3. Checks dynamic-library requirements. Linux CI rejects required glibc symbols newer than 2.35. macOS rejects local package-manager libraries. Windows release builds use static MSVC CRT linkage with explicit native --target so the flags stay off host proc macros/build scripts, and check PE import names for an unexpected dynamic CRT dependency. Ordinary developer builds keep their default linkage.
4. Builds and verifies its archive, then runs the extracted editor and runner with no developer tools on child PATH, explicit temporary config and a path containing spaces/Unicode.
5. Exercises authenticated embedded assets, real project editing/export, examples including the Observatory tutorial, named/autosave reloads in separate processes, completed games and corruption/rollback cases.
6. Runs the six terminal-control journeys against the extracted release runner itself, then Chromium authoring/playtest/export journeys against another extracted release editor. This verifies searchable launch/save menus, locks, keyboard history/editing, guide state and transcripts in the distributed executable.

Only successful jobs upload `release-package-<platform>` with the archive and checksum. Baseline/dependency JSON and browser failure artifacts are retained separately. Linux's existing full lint/frontend/Chromium/Firefox application checks remain in Validate Luna. Host checks run independently so one failure does not hide other results.

The local smoke test temporarily renames web/dist and restores it in finally. Run it separately from browser sessions or frontend compilation. It uses repository fixtures to drive tests, but the extracted applications run outside the checkout and serve their embedded UI. No source dependencies enter the archive.

## Signing and experimental support

The current packaging path is **unsigned**; no signing service or credential is required. macOS downloads are not notarized. Windows and both Mac targets remain experimental in public docs, package instructions and draft notes. Gatekeeper/SmartScreen behavior and ordinary desktop browser launch require manual acceptance. Hosted CI cannot prove those experiences or every claimed minimum OS.

macOS deployment target is 11.0; jobs execute on macOS 15. Windows jobs execute on Server 2022; ordinary Windows 10/11 testing is separate. Do not promote these to general support merely because CI passes. If signing is introduced later, sign/notarize final executables before archiving and checksumming, verify final downloads, and update the metadata/policy gate and documentation together. Never commit certificates or tokens.

## Prepare a draft release

Complete the package checks on the reviewed branch before merging. Update workspace version and Cargo.lock plus web/docs package metadata together; confirm `luna --version` and `luna-editor --version`. For v1 the owner chose 1.0.0 directly. Patch releases use 1.0.1, 1.0.2 and so on; ordinary CI runs retain the application version and identify their source by commit.

After approval to create a release tag, tag the exact reviewed commit and push it with your own GitHub credentials:

```sh
git tag v1.0.0 <reviewed-commit>
git push origin v1.0.0
```

This works on the feature branch as well as main. The tagged commit must contain both release workflows. Do not create an empty GitHub Release first: the automation refuses any existing release for that tag.

The tag-triggered **Draft GitHub release** workflow calls the same four native jobs. Tag validation requires `v<workspace-version>`, matching package metadata, exact checked-out tag commit and clean source. The draft job waits for all native jobs, downloads exactly four archives/four checksums, checks membership/hashes/source/targets, then creates a draft with the eight assets and launch/signing notes. Prerelease versions such as 1.0.1-rc.1 automatically set GitHub's prerelease flag.

Build jobs have contents:read. Only the final draft job gets contents:write through GitHub's built-in token; no personal access token is needed. No workflow publishes automatically. The owner must open the draft, review and explicitly publish it.

## Review and recover

Before publication, download and checksum all four assets. On each ordinary desktop, extract the full folder, launch the editor normally (including its browser behavior), author/export a small game, import it in the runner, and save/reopen both an active and a completed playthrough. Follow the Observatory tutorial. Record actual OS/CPU, trust prompts and results; keep experimental status where acceptance is incomplete.

If a native job fails, fix it on the branch and run PR checks again before tagging. Do not move a public release tag to silently replace its source. A patch or revised candidate needs a new version/tag.

If draft creation or asset upload fails, a partial **draft** may remain. Inspect the run and draft first. Delete only that unpublished draft through GitHub, retaining the tag, then rerun the failed draft job using its existing tested artifacts. If artifacts expired, rerun all jobs for that same tag. Existing drafts and published releases are never overwritten by the script. Published assets remain immutable by this process.

After publishing, check anonymous archive/checksum downloads, binary versions, the live installation docs and README release link. Keep source/evidence with the release review and record remaining experimental limitations. Final release publication remains an owner action.
