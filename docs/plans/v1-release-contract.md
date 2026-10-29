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

### Local baseline validation

On the Linux development host (glibc 2.44, Rust 1.96.0, Node 26.12.1,
Python 3.14.8), the frontend build, locked release workspace build and locked
workspace Rust tests passed. Both release executables launched with `--version`;
the runner still exposes the known obsolete format-1 label. This local host does
not prove the Ubuntu 22.04/glibc 2.35 compatibility floor. Workflow YAML parsed
successfully and contains the four intended native targets. Hosted native runs
remain pending; this milestone is not marked complete.
