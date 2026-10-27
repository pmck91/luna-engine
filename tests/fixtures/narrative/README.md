# Narrative foundation fixtures

These are developer compatibility fixtures for N2, separate from the later playable Keeper example and the unchanged historical projects/saves.

- [content5.json](content5.json) is the canonical content-5 Project shape. The shared [fixture builder](../../support/narrative.rs) must reproduce it exactly. It includes unused definitions, a conditional return entry, terminal dialogue, quest stages/status hooks, native CALLs and separate narrative response roots.
- [state5.json](state5.json) is a structurally valid GameState with explicit synthetic progress: an active Entered checkpoint, visited/chosen history, an earned journal, lazy narrative cursors and structured procedure cursors. It is not a runner save envelope or evidence that the quest has been played through the production runtime.
- [setup3.json](setup3.json) wraps that state in captured setup version 3. Its source revision is deliberately a fixture label; real HTTP capture tests verify actual revision/provenance behaviour.

Rust validates these shapes and rejects incompatible references/progress. TypeScript reference/contract tests consume the same JSON. Runner tests additionally write real save-5 envelopes, reopen named/autosave slots and continue them in a separate CLI process. Editor tests use real state replacement/capture/restore endpoints and save/reopen/export. Empty narrative defaults and retained writes for content/save 1–4 and setup 1/2 are tested separately; those historical inputs are not rewritten here.

Narrative effects are canonical data in N2; production quest/conversation execution and authoring remain N3–N5. Do not publish this fixture as a playable game.
