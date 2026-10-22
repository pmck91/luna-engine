# Editor implementation milestones

The approved first release targets Linux first, with Rust engine/service code and a TypeScript browser UI. The runner follows the completed editor export milestone.

1. Establish the shared Rust content model, semantic markup, validation, deterministic parser, transactional engine, and generated TypeScript contracts.
2. Implement configured local projects, stable JSON persistence, recoverable autosave, disk revision checks, comparison/reload, Save As, and root-confined file operations.
3. Build hierarchy, map, inspector, vocabulary/settings, exits, and entity state authoring. Generate editable starter actions using the same normal content model.
4. Implement custom Blockly conditions/effects, response-sequence management, and formatted/plain text controls.
5. Host playtest through the Rust core, including parser trace, history, selected-location starts, state inspection, and typed test-state changes.
6. Author/save/export The Locked Study in the editor; retain its project and actual bundle as the runner fixture.
7. Validate browser workflows in Chromium and Firefox; package the executable with embedded frontend/media.

Acceptance follows the editor specification. Structural validation diagnoses disconnected locations/endings and obvious cycles; playtests establish puzzle solvability. Runtime logic stays independent of Blockly's UI serialization. Accounts, collaboration, scripting, custom shortcuts, and player save storage remain excluded.
