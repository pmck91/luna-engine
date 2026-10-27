# Turns and scheduled events — T2 foundation

Status: **T2 complete; T3 production authoring next**, 27 October 2026, on `feature/turn-events`. T0/T1 was committed as `b80861a` after owner acceptance. This milestone implements the [frozen contract](shared-contract.md); production authoring and its owner review remain T3.

## Shared execution

The shipping model now has an optional `Game.turns` policy, named `ScheduledTrigger` definitions, SCHEDULE/CANCEL effects, TIMER PENDING conditions, independent success/failure action and exit overrides, and reply overrides. New projects use content 6 with turns disabled. Existing content keeps its declared version and command behavior; enabling turns requires format 6 and rejects any whole-command WAIT collision, including hidden owners and synonyms.

There is one clock in `GameState`. Public `Session` startup, commands, clarification, numbered replies and token-bearing replies use the existing native Run transaction. The initiating cost resolves before due callbacks and final conversation reconciliation. Scheduling after three turns from a spending action at turn zero produces turn one, deadline four and three turns remaining. Free inputs never tick. A callback has its own lexical root, uses ordinary guards/effects/CALLs/cursors, and shares the original execution/depth budget.

Compiled definition, lexical scheduling-site and CALL reachability indexes are built with the immutable game definition. Runtime scheduling looks up definitions directly; boundary dispatch scans only the bounded pending queue. Definitions' explicit persisted order survives filename sorting. Due candidates sort by deadline, descending priority and author order, and retain attempt-local generations to invalidate earlier cancellation/replacement. Consumed false guards, self-rescheduling, STOP, ending hooks and full late-failure rollback retain the T1 semantics.

The T1 test-only runtime coordinator, proxy triggers and alternate Session entry have been removed. The promoted integration cases lower convenience fixture data to canonical effects **before validation/start** and execute only shipping public APIs. Their memory snapshot checks are supplemented by actual disk, process and HTTP tests.

## Storage and host boundaries

Content/save **6** and captured setup **4** are implemented together. Compatible content/save 1–5 and setup 1–3 remain explicit paths. Timer definitions live in `timers/<id>.json`, including unused definitions. Managed writes, stale-file deletion, revision hashing, recovery, Save As, bundle manifests and export all include them. Editor layouts and test libraries remain excluded from runtime exports.

The persisted queue contains timer IDs, future deadlines and the actual scheduling root/subject/path. Sources are captured with explanation recording off, including a scheduling block inside a called procedure. Restore validates the definition, lexical site and root-to-callee reachability. Duplicate queue keys, unknown identities, bad source addresses, missing enabled clocks, overdue deadlines, impossible ended queues and mislabeled old envelopes reject without rewriting save bytes. Restore never ticks, fires callbacks or replays hooks.

Runner named saves, autosaves, a new Storage instance and independent CLI processes resume the same countdown. Editor HTTP results match native execution and capture/restore setup 4 through a fresh session. Normal and explained execution return the same committed world, clock, queue and output. Disabled hints and unresolved hint targets remain free even when the game charges for accepted hint requests. Native read-only views expose turn, ordered pending definitions, deadlines, remaining turns and scheduling sources; both hosts consume the same results rather than calculating time themselves.

## Explanations and frontend compatibility

Typed Turn observations record input classification, inherited/overridden cost and the before/after clock. Timer observations record schedule/restart/keep/cancel, due guards, invalidated candidates and resolved deadlines. A pre-boundary schedule records its evaluated delay with no absolute deadline yet; a linked Deadline observation confirms the actual boundary-relative deadline. Callbacks can record their deadline immediately. This avoids displaying a provisional deadline that excludes a spending input.

Generated TypeScript includes the new canonical models and result/view/trace types. Existing explanation rendering understands these observations. The shared reference visitor covers timer guards/bodies and numeric delay operands, so variable/property renames and message references stay consistent. General script discovery includes timer bodies. Full timer deletion, creation, authoring, search, drafts and block navigation remain T3 work; this milestone does not offer an incomplete Scheduled menu.

## Verification

| Check | Result |
| --- | --- |
| Public native timer scenarios | 54 passed, including the 50 promoted T1 cases |
| New model/storage/runner/editor timer boundary tests | 11 passed |
| Full workspace Rust tests and doctests | 405 passed |
| Frontend unit tests | 105 passed, including timer reference refactoring and explanation labels |
| Isolated Blockly model proof and preview TypeScript | Six model cases and TypeScript passed |
| TypeScript and production Vite build | Passed; existing large-chunk advisory remains |
| Clippy and core rustdoc with warnings denied | Passed |
| Generated contracts and Rust/frontend formatting | Passed |
| Existing editor browser regressions | 135 passed across Chromium/Firefox; one existing Chromium-only zoom check skipped in Firefox |
| Final rebuilt-editor hint browser checks | Four passed across Chromium/Firefox after the disabled-hint classification fix |
| Release package smoke | Passed with source UI hidden and no development tools on PATH; includes timers, setup 4, save 6, separate processes and cancellation |

Compatibility assertions for newly created projects now expect format/save 6 with no turn clock by default. Explicit older projects, checked exports and historical JSON fixtures retain their existing expectations and bytes. The packaged timer specimen matches native editor states after scheduling, setup restore and subsequent turns, retains unused definitions, resumes named saves in independent processes and cancels without firing. The optional-outcome and newly created procedure checks cover the new save envelope. Existing authored examples, including Locked Study and Keeper, are untouched.

## Next gate

T3 adds the accepted Scheduled-trigger library, full-operand SCHEDULE/CANCEL/PENDING blocks and inspector, settings/overrides, explicit upgrade review, safe references, draft/history/template/search integration, native pending panel and source navigation. Keep the current block appearance and request owner feedback on that working slice. T4 supplies a separate permanent workshop/export, release workload measurements and complete feature acceptance; public user guides stay deferred.

Reproduce the foundation checks with `cargo test --workspace --offline`, `cargo clippy --workspace --all-targets --offline -- -D warnings`, `RUSTDOCFLAGS='-D warnings' cargo doc -p luna-core --no-deps --offline`, `cargo run -p luna-editor --offline --example export_types -- --check`, and the frontend build/unit/browser scripts. Browser tests require a built editor/runner and installed Chromium/Firefox. Package smoke uses `./scripts/package.sh` followed by `python3 scripts/smoke-package.py` after browser checks finish.
