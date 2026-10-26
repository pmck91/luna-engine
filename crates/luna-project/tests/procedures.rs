#[path = "../../../tests/support/procedures.rs"]
mod fixture;
use luna_core::Session;
use luna_model::*;
use luna_project::*;
use std::fs;
#[test]
fn canonical_reopen_save_as_revision_and_export_include_unused_definitions() {
    let root = tempfile::tempdir().unwrap();
    let copy = tempfile::tempdir().unwrap();
    let staging = tempfile::tempdir().unwrap();
    let p = fixture::project();
    let original = save_project(root.path(), &p, None).unwrap();
    assert_eq!(load_project(root.path()).unwrap(), p);
    assert!(root.path().join("procedures/award.json").is_file());
    assert!(root.path().join("procedures/unused.json").is_file());
    save_project(copy.path(), &p, None).unwrap();
    assert_eq!(load_project(copy.path()).unwrap(), p);
    let bytes = export_bundle(root.path(), &p).unwrap();
    let exported = extract_bundle(&bytes, staging.path()).unwrap();
    assert_eq!(exported, p);
    let mut session = Session::start(exported, None).unwrap().0;
    session.command("use reward").unwrap();
    assert_eq!(session.state().variables["rewards"], Value::Integer(1));
    assert_eq!(session.state().procedure_sequences.len(), 1);
    let mut changed = p.procedures[1].clone();
    changed.name = "Changed on disk".into();
    fs::write(
        root.path().join("procedures/unused.json"),
        serde_json::to_vec(&changed).unwrap(),
    )
    .unwrap();
    assert_ne!(revision(root.path()).unwrap(), original);
    assert!(save_project(root.path(), &p, Some(&original)).is_err());
    assert_eq!(
        load_project(root.path()).unwrap().procedures[1].name,
        "Changed on disk"
    );
}
#[test]
fn legacy_headers_require_an_explicit_upgrade_without_changing_existing_files() {
    let root = tempfile::tempdir().unwrap();
    let mut p = fixture::project();
    let before = save_project(root.path(), &p, None).unwrap();
    let body = fs::read(root.path().join("procedures/award.json")).unwrap();
    p.game.format_version = 3;
    assert!(
        save_project(root.path(), &p, Some(&before))
            .unwrap_err()
            .to_string()
            .contains("format 4")
    );
    assert_eq!(revision(root.path()).unwrap(), before);
    assert_eq!(
        fs::read(root.path().join("procedures/award.json")).unwrap(),
        body
    );
    assert!(export_bundle(root.path(), &p).is_err());
    for version in [1, 2, 3] {
        let root = tempfile::tempdir().unwrap();
        let staging = tempfile::tempdir().unwrap();
        let mut p = Project::blank("Legacy");
        p.game.format_version = version;
        if version < 3 {
            p.game.command_assistance = None;
        }
        save_project(root.path(), &p, None).unwrap();
        assert_eq!(load_project(root.path()).unwrap(), p);
        assert!(!root.path().join("procedures").exists());
        let serialized = serde_json::to_value(&p).unwrap();
        assert!(serialized.get("procedures").is_none());
        let bundle = export_bundle(root.path(), &p).unwrap();
        assert_eq!(extract_bundle(&bundle, staging.path()).unwrap(), p);
    }
}
#[test]
fn future_header_precedes_procedure_deserialization_and_preserves_files() {
    let root = tempfile::tempdir().unwrap();
    let p = fixture::project();
    save_project(root.path(), &p, None).unwrap();
    let mut game = serde_json::to_value(&p.game).unwrap();
    game["format_version"] = (FORMAT_VERSION + 1).into();
    fs::write(
        root.path().join("game.json"),
        serde_json::to_vec(&game).unwrap(),
    )
    .unwrap();
    let bytes = b"invalid future procedure schema";
    fs::write(root.path().join("procedures/award.json"), bytes).unwrap();
    assert!(
        load_project(root.path())
            .unwrap_err()
            .to_string()
            .contains("Unsupported game format")
    );
    assert_eq!(
        fs::read(root.path().join("procedures/award.json")).unwrap(),
        bytes
    );
}

#[test]
fn editing_deleting_and_restoring_procedures_updates_existing_managed_files() {
    let root = tempfile::tempdir().unwrap();
    let mut p = fixture::project();
    let original = p.procedures[1].clone();
    let revision = save_project(root.path(), &p, None).unwrap();
    p.procedures[0].name = "Renamed reward".into();
    p.procedures[0].effects.push(Effect::Say {
        text: "Edited body".into(),
    });
    let revision = save_project(root.path(), &p, Some(&revision)).unwrap();
    assert_eq!(load_project(root.path()).unwrap(), p);
    p.procedures.retain(|procedure| procedure.id != original.id);
    let revision = save_project(root.path(), &p, Some(&revision)).unwrap();
    assert!(!root.path().join("procedures/unused.json").exists());
    assert_eq!(load_project(root.path()).unwrap(), p);
    p.procedures.push(original);
    save_project(root.path(), &p, Some(&revision)).unwrap();
    assert_eq!(load_project(root.path()).unwrap(), p);
}
