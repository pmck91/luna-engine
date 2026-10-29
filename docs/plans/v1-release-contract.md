# V1-0 release contract and evidence

Implementation baseline: `86337e4` on `main`, including documentation merge
`cabe082`. Work is on `feature/v1-release`. Pages publication remains separate
from release acceptance; it has not been verified here.

## Build contract

The [release plan](v1-release.md#initial-build-matrix) defines four targets. The
`Native release baseline` workflow compiles the frontend before release binaries,
checks the actual Rust host triple, launches both release binaries with
`--version`, and runs the workspace tests on each native host. It runs on pull
requests or manually. It deliberately neither tags nor publishes releases.

Use Rust stable with the actual compiler recorded in each run, Node 26 and
Python 3.12 in CI. Dependency lockfiles are authoritative. A green run is evidence
for that compiler/revision, not a promise that arbitrary older toolchains work.

Proposed compatibility floor: Ubuntu 22.04/glibc 2.35, macOS 11 for both CPUs,
and Windows 10 x64 with the MSVC runtime. These are **candidates**, not advertised
support. macOS binaries set `MACOSX_DEPLOYMENT_TARGET=11.0`; running them on a
macOS 15 builder does not prove macOS 11 compatibility. Inspect linked libraries
and test ordinary extracted downloads before confirming minimum versions or
deciding whether Windows runtime files must be bundled.

## Archive contract for V1-1

- Names and root directory: `luna-engine-v<app-version>-<platform>`, with
  `linux-x86_64`, `macos-aarch64`, `macos-x86_64` or `windows-x86_64`.
- Unix archives use `.tar.gz`; Windows uses `.zip` and `.exe` binaries. Unix
  executables retain their executable bits.
- Contents: both executables with embedded frontend; concise launch instructions;
  README; examples README; the nine maintained workshop/story project directories
  and their matching `.luna` bundles (Locked Study, Packing Study, Parser Gallery,
  Procedure Workshop, Keeper Quest, Timer Workshop, Routine Workshop, Undo
  Workshop, Restore the Observatory).
- Do not recursively distribute `docs`, development dependencies, site output,
  caches, test evidence, project recovery files or locks. Documentation is linked
  to the public site. `my-adventure` is not a maintained packaged workshop.
- Include machine-readable source revision, app version, Rust target and build
  tooling metadata. Emit a SHA-256 sidecar for each final archive. Never include
  local credentials/configuration or session tokens.

App version stays `0.1.0` during foundation work. The RC will use workspace
`1.0.0-rc.1`, tag `v1.0.0-rc.1`, and identically versioned archives. Stable will
use `1.0.0`/`v1.0.0`. Both binaries must report the workspace app version; remove
the runner's obsolete hardcoded “game format 1” label in the metadata work rather
than confusing application and wire-format versions. Content 8, saves 7 and
setups 5 remain unchanged by packaging.

## Signing decision for owner review

Build and test unsigned artifacts first. Proposed public policy: signed and
notarized macOS binaries and signed Windows binaries if credentials are
available; otherwise explicitly review an unsigned RC and its actual download
trust prompts before deciding whether unsigned stable distribution is acceptable.
This proposal is not recorded as owner acceptance. No credentials, signing
services, release tags or public releases are needed for the baseline workflow.

## Evidence and remaining gate

GitHub's current [runner table](https://docs.github.com/en/actions/reference/runners/github-hosted-runners)
lists the four selected native labels and architectures. The
[Rust target table](https://doc.rust-lang.org/rustc/platform-support.html) includes
all four targets, with Intel macOS currently tier 2 with host tools. These
references establish availability, not Luna compatibility.

The workflow retains `native-baseline-<platform>` JSON artifacts with host,
revision, compiler and executable version information. Test pass/failure remains
in the corresponding workflow job; the JSON does not claim tests passed.

Local Linux validation and hosted results must be recorded separately. The
four-host gate remains open until the workflow runs on GitHub. No macOS or
Windows results are available yet. Known follow-up work remains portable
packaging, `.exe`/configuration isolation, pipe/process handling and native
filesystem/save validation, as listed in the parent plan. Record additional
failures from the actual native jobs instead of guessing fixes.

### First Windows finding

The owner supplied a Windows frontend build failure: extensionless imports
resolved ambiguously between `Templates.tsx`/`templates.ts` and
`ProjectSearch.tsx`/`projectSearch.ts`. The same source audit also found
`Recipes.tsx`/`recipes.ts`. Rename the UI files to `TemplatePanel.tsx`,
`ProjectSearchDialog.tsx` and `RecipePanel.tsx`, preserving their behavior and
the helper module names. A frontend regression test checks case-insensitive
module stems, including `.ts` versus `.tsx`, on Linux as well. Native Windows
confirmation remains pending a rerun of the hosted job.

The owner then confirmed both macOS jobs pass, while Windows reaches the Rust
documentation tests and fails parsing the tutorial route. Its parser assumed LF
after the Markdown code fence; Windows checkouts can use CRLF. Parse Markdown
lines with `str::lines()` and exercise both newline styles in a regression test.
The full native Windows result remains pending another hosted run.

### Local baseline validation

On the Linux development host (glibc 2.44, Rust 1.96.0, Node 26.12.1,
Python 3.14.8), the frontend build, locked release workspace build and locked
workspace Rust tests passed. Both release executables launched with `--version`;
the runner still exposes the known obsolete format-1 label. This local host does
not prove the Ubuntu 22.04/glibc 2.35 compatibility floor. Workflow YAML parsed
successfully and contains the four intended native targets. Hosted native runs
remain pending; this milestone is not marked complete.

### Version and experimental support update

The owner reports the native build is passing and requested application version
`1.0.0` directly, superseding the earlier RC-first version proposal. The Rust
workspace and private frontend/docs package metadata now use `1.0.0`. Runner
version output no longer claims obsolete game format 1. Game/example content
versions and content/save/setup wire formats are unchanged. README and public
installation documentation explicitly mark Windows and both macOS architectures
as experimental. Native CI success does not close packaging, signing, minimum
OS or desktop acceptance gates. This change creates no tag or public release.

### Portable packaging implementation

The branch now contains a Python 3.12+ native packager, one shared target matrix,
explicit tracked canonical/example/asset membership, file/archive SHA-256 checks,
source/toolchain/dependency metadata, platform instructions, versioned tar/ZIP
output and an unsigned distribution policy. The Unix shell entry point delegates
to it. Source checkout text is normalized to LF across native hosts; .luna and
image/archive files remain binary. Owner examples and historical fixture content
are unchanged.

Editor --config and explicit runner config isolate temporary native tests from
real user settings. Smoke tests use .exe where appropriate, portable bounded
startup/cleanup, explicit UTF-8, spaces/Unicode paths, embedded UI with web/dist
hidden, all workshop export/save cases, and Observatory route/check/completed
restore. Chromium authoring/export checks use another extracted executable; Linux
native release CI also runs the full Chromium/Firefox suite. Native-library
evidence checks the glibc 2.35 ceiling on Ubuntu 22.04, macOS non-system linkage
and static Windows CRT imports.

The tag workflow reuses the same four tested package jobs, validates tag/version/
commit identity and clean metadata, requires exactly four matching archives and
sidecars, and assembles only a draft with the built-in GitHub token. Existing
drafts/published releases are never overwritten. A failed partial draft needs
explicit inspection/deletion before rerunning; published assets require a new
version/tag. The public release maintenance guide covers recovery and review.

Local checks: 534 Rust tests/doctests, Clippy, 137 frontend tests and the release
archive regressions (10 cases) pass. The native Linux archive has 181 files and nine example
bundles, about 9.5 MiB compressed, with no documentation dependencies. Extracted
package smoke and Observatory saves/checks pass. The public docs build 47 routes
and pass 3,343 local link/asset/fragment checks. Local compilation is on Arch
Linux; the editor currently needs glibc 2.39 there, so this local build is not
evidence for the Ubuntu 22.04 release floor. Hosted native packages and ordinary
Mac/Windows desktop launches remain pending, as does actual tag/draft execution.
No tag or public release has been created.

Browser portability follow-up: the first complete packaged-editor Chromium run
passed 93/95 cases and exposed two tests reading the historical Linux config
location. Both now use the explicit temporary config helper; all four cases in
the affected specs pass. The suite's exported-runner launches are centralized
with .exe selection and explicit temporary runner.toml, and package acceptance
now supplies both extracted release executables rather than a debug runner.
The final full packaged-editor/packaged-runner Chromium run passes all 95 cases. actionlint 1.7.7
validates all workflows; Astro check reports zero errors/warnings.

Windows release builds/tests use an explicit native --target so static CRT flags
do not leak into host proc macros/build scripts, per Cargo’s target flag rules.
Developer builds keep their default linkage. The shared target configuration
and binary-directory helper account for the Windows target subdirectory.

### Rebase after the accepted runner usability patch

PR #12 merged as `ace30f2`; `feature/v1-release` was rebased onto it without
conflicts. Application version 1.0.0, explicit unsigned/experimental Mac/Windows
policy and release assembly protections remain intact. Package instructions and
installation docs now recommend searchable bare `luna run` and describe save
menus, controls/history and optional transcripts. Main's runner changes are no
longer a separate prerequisite.

The previous release matrix `40921915890` and application/docs workflows passed
on `bce6149`; all four downloaded archives/checksums were verified together, with
181 files each and clean metadata sharing PR merge revision `0d9c9e3`. Its tree
matched the branch exactly. The owner accepted the Linux download, then requested
the now-merged runner UX patch before tagging. Those older downloads therefore
precede the usability changes and must be rebuilt.

The refreshed smoke check covers packaged `/controls`, transcript start/stop and
no save/onboarding changes from pipe-only controls. Actual keyboard journeys run
against a separately extracted release runner. A Windows ConPTY test-harness
startup deadlock discovered in the runner CI is corrected as recorded in the
runner plan; its native result is still pending. No tag or release is created by
this integration work.

Local rebased verification: all 546 workspace tests/doctests and Clippy pass,
including seven terminal-harness cases. The rebuilt Linux package passes full
smoke (with controls/transcripts) and the same keyboard/save/guide journeys
against the extracted release runner. Release-tool regressions, Rust formatting,
workflow validation, docs formatting/build and 3,350 local link/asset/fragment
checks pass. The new native matrix must confirm Windows startup and all four
rebuilt downloads before the branch is ready for release review.
