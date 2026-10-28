#[path = "../../../tests/support/routines.rs"]
mod fixture;
use luna_project::*;
use std::fs;

#[test]
fn routine_files_reopen_export_and_save_as_without_losing_author_order_or_unused_definitions() {
    let root = tempfile::tempdir().unwrap();
    let copy = tempfile::tempdir().unwrap();
    let stage = tempfile::tempdir().unwrap();
    let p = fixture::project();
    let rev = save_project(root.path(), &p, None).unwrap();
    assert_eq!(load_project(root.path()).unwrap(), p);
    assert!(root.path().join("routines/unused.json").exists());
    save_project(copy.path(), &p, None).unwrap();
    assert_eq!(load_project(copy.path()).unwrap(), p);
    let bytes = export_bundle(root.path(), &p).unwrap();
    let installed = extract_bundle(&bytes, stage.path()).unwrap();
    assert_eq!(installed, p);
    assert!(!stage.path().join("editor").exists());
    assert_eq!(installed.routines, p.routines);
    let (mut session, _) = luna_core::Session::start(installed, None).unwrap();
    session.command("wait").unwrap();
    assert_eq!(
        session.routine_view()[0].wait.as_ref().unwrap().remaining,
        2
    );
    let mut changed = p.routines[0].clone();
    changed.name = "On-disk change".into();
    fs::write(
        root.path().join("routines/patrol.json"),
        serde_json::to_vec(&changed).unwrap(),
    )
    .unwrap();
    assert_ne!(revision(root.path()).unwrap(), rev);
    assert!(save_project(root.path(), &p, Some(&rev)).is_err());
}

#[test]
fn deletion_undo_and_partial_write_recovery_manage_routine_files() {
    let root = tempfile::tempdir().unwrap();
    let mut p = fixture::project();
    let rev = save_project(root.path(), &p, None).unwrap();
    let unused = p.routines.pop().unwrap();
    let rev = save_project(root.path(), &p, Some(&rev)).unwrap();
    assert!(!root.path().join("routines/unused.json").exists());
    p.routines.push(unused);
    save_project(root.path(), &p, Some(&rev)).unwrap();
    let path = root.path().join("routines/patrol.json");
    let before = fs::read_to_string(&path).unwrap();
    p.routines[0].name = "Recovered routine".into();
    let after = serde_json::to_string_pretty(&p.routines[0]).unwrap();
    fs::write(
        root.path().join(".luna-transaction.json"),
        serde_json::to_vec(&serde_json::json!({
            "changes":[{"path":"routines/patrol.json","before":before,"after":after}]
        }))
        .unwrap(),
    )
    .unwrap();
    assert_eq!(load_project(root.path()).unwrap(), p);
    assert!(!root.path().join(".luna-transaction.json").exists());
}

#[test]
fn old_and_future_headers_never_overwrite_routine_content() {
    let root = tempfile::tempdir().unwrap();
    let mut p = fixture::project();
    let rev = save_project(root.path(), &p, None).unwrap();
    let path = root.path().join("routines/patrol.json");
    let original = fs::read(&path).unwrap();
    p.game.format_version = 6;
    assert!(save_project(root.path(), &p, Some(&rev)).is_err());
    assert!(export_bundle(root.path(), &p).is_err());
    assert_eq!(fs::read(&path).unwrap(), original);
    assert_eq!(revision(root.path()).unwrap(), rev);
    p.game.format_version = 999;
    fs::write(
        root.path().join("game.json"),
        serde_json::to_vec(&p.game).unwrap(),
    )
    .unwrap();
    fs::write(&path, b"future routine shape").unwrap();
    assert!(
        load_project(root.path())
            .unwrap_err()
            .to_string()
            .contains("Unsupported game format 999")
    );
    assert_eq!(fs::read(&path).unwrap(), b"future routine shape");
}

#[test]
fn canonical_reopen_uses_persisted_author_order_instead_of_filenames() {
    let root = tempfile::tempdir().unwrap();
    let mut p = fixture::project();
    p.routines[0].order = 20;
    p.routines[1].order = 0;
    p.routines.swap(0, 1);
    save_project(root.path(), &p, None).unwrap();
    let reopened = load_project(root.path()).unwrap();
    assert_eq!(reopened.routines, p.routines);
    assert_eq!(reopened.routines[0].id, "unused");
    let stage = tempfile::tempdir().unwrap();
    let exported = extract_bundle(&export_bundle(root.path(), &p).unwrap(), stage.path()).unwrap();
    assert_eq!(exported.routines, p.routines);
}
