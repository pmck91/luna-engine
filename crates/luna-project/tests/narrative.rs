#[path = "../../../tests/support/narrative.rs"]
#[allow(dead_code)]
mod fixture;
use luna_model::*;
use luna_project::*;
use std::fs;
#[test]
fn canonical_collections_survive_reopen_save_as_revision_and_exact_bundle_export() {
    let root = tempfile::tempdir().unwrap();
    let copy = tempfile::tempdir().unwrap();
    let stage = tempfile::tempdir().unwrap();
    let p = fixture::project();
    let before = save_project(root.path(), &p, None).unwrap();
    assert_eq!(load_project(root.path()).unwrap(), p);
    for name in [
        "conversations/conversation.json",
        "conversations/unused-conversation.json",
        "quests/missing.json",
    ] {
        assert!(root.path().join(name).is_file());
    }
    save_project(copy.path(), &p, None).unwrap();
    assert_eq!(load_project(copy.path()).unwrap(), p);
    let bytes = export_bundle(root.path(), &p).unwrap();
    assert_eq!(extract_bundle(&bytes, stage.path()).unwrap(), p);
    let mut changed = p.quests[0].clone();
    changed.title = "Edited on disk".into();
    fs::write(
        root.path().join("quests/missing.json"),
        serde_json::to_vec(&changed).unwrap(),
    )
    .unwrap();
    assert_ne!(revision(root.path()).unwrap(), before);
    assert!(save_project(root.path(), &p, Some(&before)).is_err());
    assert_eq!(
        load_project(root.path()).unwrap().quests[0].title,
        "Edited on disk"
    );
}
#[test]
fn delete_undo_and_partial_write_recovery_include_both_managed_collections() {
    let root = tempfile::tempdir().unwrap();
    let mut p = fixture::project();
    let rev = save_project(root.path(), &p, None).unwrap();
    let removed = p.conversations.pop().unwrap();
    let rev = save_project(root.path(), &p, Some(&rev)).unwrap();
    assert!(
        !root
            .path()
            .join("conversations/unused-conversation.json")
            .exists()
    );
    p.conversations.push(removed);
    save_project(root.path(), &p, Some(&rev)).unwrap();
    let quest_path = root.path().join("quests/missing.json");
    let conv_path = root.path().join("conversations/conversation.json");
    let before_quest = fs::read_to_string(&quest_path).unwrap();
    let before_conv = fs::read_to_string(&conv_path).unwrap();
    p.quests[0].title = "Recovered quest".into();
    p.conversations[0].name = "Recovered conversation".into();
    let after_quest = serde_json::to_string_pretty(&p.quests[0]).unwrap();
    let after_conv = serde_json::to_string_pretty(&p.conversations[0]).unwrap();
    fs::write(
        root.path().join(".luna-transaction.json"),
        serde_json::to_vec(&serde_json::json!({"changes":[
            {"path":"quests/missing.json","before":before_quest,"after":after_quest},
            {"path":"conversations/conversation.json","before":before_conv,"after":after_conv}
        ]}))
        .unwrap(),
    )
    .unwrap();
    fs::write(&quest_path, after_quest).unwrap(); // Simulate interruption after one file.
    assert_eq!(load_project(root.path()).unwrap(), p);
    assert!(!root.path().join(".luna-transaction.json").exists());
}
#[test]
fn legacy_writes_and_future_headers_never_flatten_or_overwrite_new_content() {
    let root = tempfile::tempdir().unwrap();
    let mut p = fixture::project();
    let before = save_project(root.path(), &p, None).unwrap();
    let original = fs::read(root.path().join("quests/missing.json")).unwrap();
    p.game.format_version = 4;
    assert!(
        save_project(root.path(), &p, Some(&before))
            .unwrap_err()
            .to_string()
            .contains("format 5")
    );
    assert!(export_bundle(root.path(), &p).is_err());
    assert_eq!(revision(root.path()).unwrap(), before);
    assert_eq!(
        fs::read(root.path().join("quests/missing.json")).unwrap(),
        original
    );
    let mut game = serde_json::to_value(&p.game).unwrap();
    game["format_version"] = 999.into();
    fs::write(
        root.path().join("game.json"),
        serde_json::to_vec(&game).unwrap(),
    )
    .unwrap();
    fs::write(
        root.path().join("quests/missing.json"),
        b"future-schema-not-current-json",
    )
    .unwrap();
    assert!(
        load_project(root.path())
            .unwrap_err()
            .to_string()
            .contains("Unsupported game format 999")
    );
    assert_eq!(
        fs::read(root.path().join("quests/missing.json")).unwrap(),
        b"future-schema-not-current-json"
    );
    for version in 1..=4 {
        let root = tempfile::tempdir().unwrap();
        let stage = tempfile::tempdir().unwrap();
        let mut p = Project::blank("Legacy");
        p.game.format_version = version;
        if version < 3 {
            p.game.command_assistance = None;
        }
        save_project(root.path(), &p, None).unwrap();
        assert!(!root.path().join("conversations").exists());
        assert!(!root.path().join("quests").exists());
        assert_eq!(load_project(root.path()).unwrap(), p);
        assert_eq!(
            extract_bundle(&export_bundle(root.path(), &p).unwrap(), stage.path()).unwrap(),
            p
        );
    }
}
#[test]
fn runtime_bundle_excludes_layout_and_captured_progress_but_retains_unused_definitions() {
    let root = tempfile::tempdir().unwrap();
    let stage = tempfile::tempdir().unwrap();
    let mut p = fixture::project();
    p.editor
        .positions
        .insert("greeting".into(), Point { x: 21.0, y: 42.0 });
    let runtime = extract_bundle(&export_bundle(root.path(), &p).unwrap(), stage.path()).unwrap();
    assert_eq!(runtime.conversations, p.conversations);
    assert_eq!(runtime.quests, p.quests);
    assert_eq!(runtime.editor, EditorLayout::default());
    assert!(!stage.path().join("editor").exists());
}
