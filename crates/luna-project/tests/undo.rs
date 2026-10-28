use luna_model::*;
use std::fs;

#[test]
fn explicit_upgrade_reopens_exports_and_save_as_without_history_or_legacy_rewrites() {
    let root = tempfile::tempdir().unwrap();
    let mut project = Project::blank("Undo content upgrade");
    project.game.format_version = 7;
    let revision = luna_project::save_project(root.path(), &project, None).unwrap();
    let original = fs::read(root.path().join("game.json")).unwrap();
    assert!(
        !serde_json::from_slice::<serde_json::Value>(&original)
            .unwrap()
            .as_object()
            .unwrap()
            .contains_key("allow_player_undo")
    );
    let legacy_bundle = luna_project::export_bundle(root.path(), &project).unwrap();
    project.game.allow_player_undo = true;
    assert!(luna_project::save_project(root.path(), &project, Some(&revision)).is_err());
    assert_eq!(fs::read(root.path().join("game.json")).unwrap(), original);
    project.game.format_version = 8;
    luna_project::save_project(root.path(), &project, Some(&revision)).unwrap();
    assert_eq!(luna_project::load_project(root.path()).unwrap(), project);
    let bundle = luna_project::export_bundle(root.path(), &project).unwrap();
    assert_ne!(bundle, legacy_bundle);
    let extract = tempfile::tempdir().unwrap();
    let exported = luna_project::extract_bundle(&bundle, extract.path()).unwrap();
    assert_eq!(exported.game, project.game);
    let manifest: luna_project::Manifest =
        serde_json::from_slice(&fs::read(extract.path().join("manifest.json")).unwrap()).unwrap();
    assert_eq!(manifest.format_version, 8);
    assert!(
        manifest
            .files
            .keys()
            .all(|p| !p.starts_with("editor/") && !p.contains("history"))
    );
    let copy = tempfile::tempdir().unwrap();
    luna_project::save_project(copy.path(), &project, None).unwrap();
    assert_eq!(luna_project::load_project(copy.path()).unwrap(), project);
    let (mut session, _) = luna_core::Session::start(exported, None).unwrap();
    assert!(session.undo_view().enabled);
    assert!(!session.undo().unwrap().state_changed);
    project.game.allow_player_undo = false;
    luna_project::save_project(root.path(), &project, None).unwrap();
    assert_eq!(project.game.format_version, 8);
}

#[test]
fn recovery_preserves_an_explicit_undo_upgrade_and_low_header_reads_reject_without_writes() {
    let root = tempfile::tempdir().unwrap();
    let mut project = Project::blank("Recovered undo opt in");
    project.game.format_version = 7;
    luna_project::save_project(root.path(), &project, None).unwrap();
    let path = root.path().join("game.json");
    let before = fs::read_to_string(&path).unwrap();
    project.game.format_version = 8;
    project.game.allow_player_undo = true;
    let after = serde_json::to_string_pretty(&project.game).unwrap();
    fs::write(
        root.path().join(".luna-transaction.json"),
        serde_json::to_vec(
            &serde_json::json!({"changes":[{"path":"game.json","before":before,"after":after}]}),
        )
        .unwrap(),
    )
    .unwrap();
    fs::write(&path, &after).unwrap();
    assert_eq!(luna_project::load_project(root.path()).unwrap(), project);
    assert!(!root.path().join(".luna-transaction.json").exists());
    let mut invalid: serde_json::Value = serde_json::from_slice(&fs::read(&path).unwrap()).unwrap();
    invalid["format_version"] = 7.into();
    let invalid = serde_json::to_vec(&invalid).unwrap();
    fs::write(&path, &invalid).unwrap();
    assert!(
        luna_project::load_project(root.path())
            .unwrap_err()
            .to_string()
            .contains("content format 8")
    );
    assert_eq!(fs::read(&path).unwrap(), invalid);
}
