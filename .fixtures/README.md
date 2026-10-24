`locked-study.luna` is the fixed, exported Locked Study walkthrough used by the
runner storage/CLI tests, editor/runner parity tests, and packaged-release smoke
checks. It preserves the original painting → key → door → garden → rose progression
and its response sequence.

The editable project and export under `examples/` are independent authoring
content. Tests use this fixture so editing or re-exporting that project does not
change their expected walkthrough. Change this fixture deliberately alongside
its expected commands and save/load assertions.
