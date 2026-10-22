# Runner implementation milestones

Begin implementation against the actual editor-produced format and Locked Study export. Use the shared Rust parser and engine unchanged.

1. Implement staged ZIP validation and atomic installation pointers, per-version locks, explicit reimport decisions, side-by-side versions, and removal that preserves saves.
2. Implement CLI operations, explicit version selection, per-user directories, TOML configuration, and directory overrides.
3. Implement line-oriented sessions, reserved controls, clarification/failure output, explicit new/restore selection, and ended-game behavior.
4. Persist complete engine state in versioned atomic autosaves and unlimited named slots. Validate identity, references, types, visits, endings, and response cursors on restore; preserve corrupt data.
5. Implement semantic terminal colours, plain output, NO_COLOR, Unicode/error handling, and normal diagnostic exit codes.
6. Exercise the fixture through the actual CLI and compare editor HTTP and runner gameplay state/output. Package a standalone Linux executable.

Acceptance follows the runner specification and colour addendum. First-release defaults are Linux x86_64 packages, XDG application directories, exact content-version saves, and no implicit migration. Network services, graphical player clients, and other operating-system packages remain deferred.
