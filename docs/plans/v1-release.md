# Version 1 release preparation

Status: **next major work item; approach approved, implementation not started**, 29 October 2026. The owner accepted the cross-platform release proposal and requested that it be documented as the next major piece of work. Documentation is accepted and committed as `e9b348b` on `feature/documentation`; its merge and first Pages publication are tracked separately in [todo](todo.md#documentation--v1).

Begin implementation on **`feature/v1-release`**, created from current merged `main` after the documentation work is integrated. Prepare and test **`v1.0.0-rc.1`** before publishing **`v1.0.0`**. Recording this plan does not create a release tag, promise untested platform support or authorize publishing a release now.

## Outcome

Provide tested native Linux, macOS and Windows downloads from GitHub Releases. Each archive contains both the editor and terminal runner, useful example projects/bundles and concise launch instructions. The editor retains its embedded frontend and opens a local browser; the runner remains a terminal application. End users do not build the Rust workspace or install Node to use the packaged frontend.

The architecture appears suitable for these targets, but only Linux x86_64 is currently verified by application CI and package smoke tests. Cross-platform support must be earned by actual native builds, runtime tests and launch review. The main work is packaging, test portability, platform-specific fixes where proved necessary, and release automation.

Preserve shared Rust gameplay semantics, the current editor/block appearance, stable references and existing examples. Application version 1.0.0 is independent of content **8**, player save **7**, setup **5**, and the designer's game content version. Release preparation does not itself require changing these formats or dropping their legacy readers.

## Initial build matrix

| Download | Rust target | Native CI candidate | Archive |
| --- | --- | --- | --- |
| Linux x86_64 | `x86_64-unknown-linux-gnu` | `ubuntu-22.04` | `.tar.gz` |
| macOS Apple Silicon | `aarch64-apple-darwin` | `macos-15` | `.tar.gz` |
| macOS Intel | `x86_64-apple-darwin` | `macos-15-intel` | `.tar.gz` |
| Windows x86_64 | `x86_64-pc-windows-msvc` | `windows-2022` | `.zip` |

Confirm runner availability, toolchain/dependency support and minimum operating-system versions in V1-0. Pin runner architecture explicitly: a floating macOS label must not silently switch the download's CPU architecture. Linux uses a deliberately chosen compatibility baseline; compilation on the existing Ubuntu 24.04 CI machine does not establish compatibility with older distributions.

Windows archives contain `luna.exe` and `luna-editor.exe`; Unix archives contain `luna` and `luna-editor` with executable permissions. Use versioned filenames such as `luna-engine-v1.0.0-rc.1-windows-x86_64.zip`, one top-level directory per archive, and SHA-256 checksums. Record actual supported OS versions and required system runtimes after verification rather than deriving them from Rust target support alone.

Native archives are the initial distribution format. Installers, app-store distribution, automatic updates and additional CPU targets can be separate work after the four downloads are established. Standalone browser game publishing remains outside this release-preparation scope.

## Existing issues to address

| Area | Current implementation | Required result |
| --- | --- | --- |
| Packaging | `scripts/package.sh` rejects everything except Linux x86_64 and uses Unix-specific tools/names | One maintained packaging implementation supporting the matrix |
| Package contents | The script recursively copies `docs` and `spec` | Deliberate distributable file list; exclude site `node_modules`, caches, build output, recovery/locks and development artifacts |
| Smoke tests | `scripts/smoke-package.py` assumes a Linux tarball/root, extensionless binaries, XDG overrides, `select()` on a pipe and Unix signal handling | Portable archive discovery, executable selection, configuration isolation, bounded startup and process cleanup |
| Browser helpers | `web/tests/setup.ts` and related helpers assume extensionless debug binaries and Linux configuration isolation | Launch the correct binary and isolate user data on every supported OS |
| Platform behavior | Filesystem, save locks, replacement/recovery, terminal output and default-browser launch are tested on Linux | Native regression and packaged checks on every target |
| Release metadata | Workspace application version is 0.1.0; runner version output has a historical format-1 label | Consistent release/tag/binary versions and accurate format information |
| Distribution | Existing CI uploads a Linux build artifact | Versioned GitHub Release assets, checksums and an explicit draft/review/publication path |

Do not repair compatibility by changing identities, silently normalizing saved references or weakening validation. If a platform issue exposes a real content/path constraint, define the policy and add regressions before changing it.

## Milestones

### V1-0 — Establish the release contract and prove the matrix

- [ ] Create `feature/v1-release` from current merged `main`; record the baseline and verify that the documentation is included.
- [ ] Confirm the four native runner/target combinations, supported compiler/Node/Python versions and proposed minimum OS versions. Choose a Linux baseline and macOS deployment targets deliberately.
- [ ] Compile the frontend and release binaries on each native host; run native tests and record actual failures. Linux success and cross-target type checking do not substitute for native execution.
- [ ] Freeze archive names/layout, example contents, checksums, CLI version output and RC/stable version rules. Identify whether system-runtime dependencies must be included or documented.
- [ ] Agree the public distribution approach for signing/notarization. Keep certificate-dependent work explicit; unsigned build/testing can progress independently.

Gate: four native build results and a concrete list of portability work, with no unverified support claims.

### V1-1 — Make packaged output portable and predictable

- [ ] Introduce a shared portable packager, likely using Python's standard library, with explicit version/OS/architecture inputs and a single distributable file list. Retain the current shell entry point as a wrapper or update all callers/documentation intentionally.
- [ ] Build the frontend before release compilation so both editor executables embed the current UI and Blockly media. Produce archives without depending on a source checkout at runtime.
- [ ] Include the example projects and matching native bundles, including Restore the Observatory. Preserve the owner's Locked Study and the historical regression fixture.
- [ ] Generate `.tar.gz` and `.zip` packages, executable permissions where applicable, SHA-256 checksums and release metadata identifying the exact source revision/target.
- [ ] Check archive membership and size, and prove that installed docs dependencies/caches cannot enter an archive. Make reruns replace only the intended local output.

Gate: all four archives have the agreed contents, current embedded UI and verified checksums.

### V1-2 — Prove native portability and fix demonstrated failures

- [ ] Adapt smoke/browser helpers for `.exe`, archive layouts and platform-specific configuration directories. Use explicit temporary configuration overrides; never redirect tests into a user's actual configuration or save library. If needed, add a small editor config-file override consistent with the runner.
- [ ] Replace pipe `select()` and Unix-only shutdown assumptions with portable, bounded startup/cleanup. Preserve useful failure diagnostics without exposing session tokens.
- [ ] Test paths with spaces/Unicode, case-insensitive collisions and Windows-reserved filenames; define any necessary restrictions without silently changing game/save identity.
- [ ] Verify atomic replacement, project recovery/conflict handling, save overwrite/corrupt-slot recovery, locking and cleanup under native filesystem behavior.
- [ ] Verify UTF-8 player input/output, plain text/colour controls, native default-browser launch and correct per-user directories. Run the editor with its ordinary launch behavior during human acceptance as well as `--no-browser` in automation.
- [ ] Make only the platform fixes demonstrated by these checks; retain existing gameplay, compatibility and transaction guarantees.

Gate: native Rust tests and installed/package smoke paths pass on each target with isolated data.

### V1-3 — Add ongoing platform build and test coverage

- [ ] Add a matrix workflow, or reusable build workflow, that can prove packages on pull requests/manual runs before a release tag exists. Keep version/target/content selection shared with the release path.
- [ ] Run Rust workspace tests and packaged editor/runner smoke checks on every target. Retain Linux's full frontend/browser acceptance and add meaningful native-host authoring/export/save journeys for macOS and Windows.
- [ ] Exercise extracted release files outside the repository with the development frontend unavailable. Verify CLI import/play, named/autosave restoration across processes, completed games and editor-served embedded assets.
- [ ] Retain per-target logs, checksums and useful failure artifacts; let all matrix jobs report their results if another target fails. Sequence compilation and browsers appropriately on limited-memory runners.
- [ ] Require the agreed native/package checks before claiming support. Document any test exclusions and provide equivalent evidence where needed.

Gate: a successful four-target run on one source revision, with downloadable tested artifacts.

### V1-4 — Automate release assembly and signing

- [ ] Add tag-triggered release automation for the agreed version pattern, with a manual build path. Validate the tag against the application version and intended source commit before preparing release assets.
- [ ] Build/test all targets from the same revision, verify the downloaded artifacts/checksums and assemble a **draft** GitHub Release only after all required jobs succeed. Do not publish a partial platform set.
- [ ] Keep ordinary build jobs read-only. Restrict release-write permissions and signing credentials to trusted release jobs; provide clear setup instructions without committing credentials.
- [ ] Implement macOS Developer ID signing/notarization and Windows signing according to the agreed distribution policy and available credentials. Sign final executables before archiving/checksumming. Verify any signed packages after distribution packaging.
- [ ] Make reruns safe for drafts and failures. Preserve already published release assets; avoid silently replacing an existing stable release.

Gate: a complete draft containing tested archives, checksums and release notes, with signing/notarization status accurately stated.

### V1-5 — Review `v1.0.0-rc.1` as a real user download

- [ ] Set the application version to the agreed RC value and synchronize lockfile/binary/release metadata. Do not relabel a 0.1.0 executable as 1.0.0 through its archive filename alone.
- [ ] After the preceding technical gates pass, create the RC tag and assemble its draft through the same release workflow intended for stable versions. Record the exact source, artifacts and prerelease status for owner review.
- [ ] Download, extract and launch each target package. Check the normal user experience, including Windows/macOS download trust behavior under the actual signing policy.
- [ ] Follow the public installation and Observatory walkthroughs, export from the packaged editor and run/import the exported game. Verify named/autosave reopening and that the user needs no Rust/Node build tooling.
- [ ] Update README and designer/developer installation/release pages with verified downloads, minimum versions and native platform paths. Check screenshots/tutorial provenance if UI changes were necessary.
- [ ] Record owner feedback, actual platform evidence and remaining release blockers. A hosted-runner smoke test is not a substitute for the ordinary desktop launch review.

Gate: the complete release candidate is accepted on the supported platforms, with public instructions matching the artifacts.

### V1-6 — Publish version 1 and close out

- [ ] Resolve RC findings and complete the required checks on the final source revision. Set the application version to 1.0.0 and verify tag/version consistency.
- [ ] After final owner acceptance and publication authorization, create `v1.0.0`, assemble/verify its draft assets and publish the complete release.
- [ ] Confirm public asset/checksum downloads, version/help output, documentation/README release links and the live documentation deployment. Retain the release evidence and update todo.
- [ ] Document how to build a patch release, diagnose a failed matrix job and recover a failed draft without modifying a published release.

Gate: a publicly downloadable, verified v1.0.0 for the four agreed targets, with an understood repeatable patch-release process.

## Acceptance and review boundaries

Every advertised target must compile, pass native tests, run the extracted editor/runner and restore real saves. The archive must contain the embedded frontend and intended examples, and exclude dependency trees/caches. Versions and checksums must match the tested source. Any remaining launch restrictions or signing prerequisites must be stated clearly in the installation instructions.

Keep the accepted documentation work separate from this implementation branch. Confirm its merge/Pages status when implementation starts; neither is assumed complete by this plan. Review a concrete RC and its platform evidence with the owner before the final public version. No engine rewrite, new gameplay feature or content/save format bump is planned merely to create release binaries.

## Sources and maintenance

These primary references informed the feasibility review. Verify current runner labels, tooling and signing requirements when the corresponding milestone begins:

- [GitHub-hosted runner platforms and architectures](https://docs.github.com/en/actions/reference/runners/github-hosted-runners).
- [Rust platform support](https://doc.rust-lang.org/rustc/platform-support.html).
- [GitHub CLI release creation, drafts and asset upload](https://cli.github.com/manual/gh_release_create).
- [Python select portability, including Windows pipe limitations](https://docs.python.org/3/library/select.html).
- [Apple Developer ID distribution](https://developer.apple.com/developer-id/) and [notarization](https://developer.apple.com/documentation/security/notarizing-macos-software-before-distribution).
- [Microsoft signing and SmartScreen reputation](https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/smartscreen-reputation).
