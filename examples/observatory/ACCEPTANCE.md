# Restore the Observatory

The public progressive tutorial's complete example, added on `feature/documentation` from the `150e26f` engine/editor baseline. This project is separate from the owner's Locked Study. `../observatory.luna` is a native editor export; it excludes editor layout, setups/checks, templates and warning acknowledgements.

The public chapters are in `docs/site/src/content/docs/tutorials/observatory/`. The winning command block in index.md is executed directly by `crates/luna-editor/tests/documentation_examples.rs`; it must finish First light with score 10. The same test compares canonical/exported content, verifies the hinted and health-loss endings, restores all four captures and runs both saved checks through the native editor API.

## Content

The game demonstrates typed state, action patterns, requirements/branches, descriptions/sequences/fallback effects, inventories, hidden/consumed objects and crafting, openable storage/surfaces, lifecycle/entry/value triggers, typed procedures, conditional conversations and a terminal return, explicit quest stages and journal/reward hooks, turn costs, scheduling/cancellation, a connected two-step routine with a wait/hold, hints, clarification/recent references, optional player undo, formatted messages and optional ending outcomes.

There are four native setup-5 checkpoints: Fresh workshop, Ready for calibration, Ready to open shutter and Shutter countdown. Saved checks cover the winning route and the three subsequent-turn shutter boundary. The same shared key alias is intentional; its overlap warnings and the disconnected Offstage store have specific acknowledged reasons.

The field-notes asset demonstrates packaging only. It does not add automatic media/text-file presentation to the runner. Editor workflow exercises—templates, history, search, layouts, warnings, checks and explanations—are taught separately from story mechanics.

## Reproduce

```sh
cargo test -p luna-editor --test documentation_examples
npm --prefix docs/site run build
node docs/site/scripts/capture-editor.mjs
```

Capture requires the site/web dependencies, Chromium and a built debug editor/frontend. It copies projects into temporary storage and writes only the public screenshot/evidence destinations. Normal tests never rewrite examples or exports.

For an intentional content update, edit this project, export through the native editor, refresh relevant screenshots and run the checks. Source and screenshot digests are recorded in `docs/site/evidence.json`; the docs build rejects stale source/export pairs or capture provenance. Preserve stable identities when editing. Do not regenerate this example from an unrelated template.

Manual installed-runner acceptance also completes the public route, writes before-stars/completed slots, and compares exact state after loading each in separate processes without replaying effects. The documentation review record contains the verification outcome.
