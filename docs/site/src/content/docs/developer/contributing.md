---
title: Contribute a change
description: Make focused Luna changes with explicit contracts, compatibility, authoring and host parity checks.
sidebar:
  order: 10
---

## Start with a player or designer problem

Describe the concrete trigger and expected result. For UI changes, review a small working flow or wireframe before building a large subsystem. Preserve the accepted block shapes, colours, connectors and inline editing unless a separate design change is agreed.

Create a focused branch from current main. Keep existing user-authored examples and historical regression fixtures intact. A new acceptance game is usually safer than replacing a story someone is editing.

## Choose the boundary

- New gameplay behavior belongs in model/core, with host parity.
- Disk format/recovery belongs in project or runner storage.
- Authoring interaction belongs in the frontend projection and native API as needed.
- A public feature needs a designer guide, reference and verified tutorial coverage.
- An editor-only layout feature should not become a player save field.

For serialized changes, define content/save/setup compatibility before implementation. Add reviewed defaults or an explicit upgrade/error. Do not infer history or silently discard unsupported progress.

## Validate the change

Run [checks appropriate to the boundary](/luna-engine/developer/verification/). Native behavior needs exported runner and restoration coverage. UI changes need meaningful browser journeys and relevant projection tests. Regenerate TypeScript from Rust rather than editing contracts.ts by hand.

Source links must resolve to stable authored IDs/paths, not screen coordinates or transient block order. Reference-bearing variants need visits in rename/copy/delete/template/search logic.

## Prepare review

Lead the pull request with the concrete problem and resulting behavior. Include validation and material limitations. Explain compatibility or migration decisions. Avoid a chronological diary of implementation attempts.

For documentation, include a preview command and screenshots of changed journeys. Keep new public prose task-focused; retain technical evidence in developer/design records. Do not claim publication until the Pages deployment succeeds.

Report bugs with a small reproduction, exact input sequence, version and expected/actual state. Exclude launch tokens, private paths and personal save content.
