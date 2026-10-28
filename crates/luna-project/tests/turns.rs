#[path = "../../../tests/support/turns.rs"]
mod fixture;
use luna_model::*;
use luna_project::*;
use std::fs;

#[test]
fn timer_files_reopen_export_and_save_as_without_losing_author_order_or_unused_definitions() {
    let root = tempfile::tempdir().unwrap();
    let copy = tempfile::tempdir().unwrap();
    let stage = tempfile::tempdir().unwrap();
    let p = fixture::project();
    let rev = save_project(root.path(), &p, None).unwrap();
    assert_eq!(load_project(root.path()).unwrap(), p);
    assert!(root.path().join("timers/unused.json").exists());
    save_project(copy.path(), &p, None).unwrap();
    assert_eq!(load_project(copy.path()).unwrap(), p);
    let bytes = export_bundle(root.path(), &p).unwrap();
    let installed = extract_bundle(&bytes, stage.path()).unwrap();
    assert_eq!(installed, p);
    assert!(!stage.path().join("editor").exists());
    let (mut session, _) = luna_core::Session::start(installed, None).unwrap();
    session.command("use both").unwrap();
    let out = session
        .command("wait")
        .unwrap()
        .messages
        .iter()
        .map(|m| text::plain(m))
        .collect::<Vec<_>>()
        .join("\n");
    assert!(out.find("First timer.").unwrap() < out.find("Second timer.").unwrap());
    let mut changed = p.timers[0].clone();
    changed.name = "On-disk change".into();
    fs::write(
        root.path().join("timers/door-closes.json"),
        serde_json::to_vec(&changed).unwrap(),
    )
    .unwrap();
    assert_ne!(revision(root.path()).unwrap(), rev);
    assert!(save_project(root.path(), &p, Some(&rev)).is_err());
}

#[test]
fn deletion_undo_and_partial_write_recovery_manage_timer_files() {
    let root = tempfile::tempdir().unwrap();
    let mut p = fixture::project();
    let rev = save_project(root.path(), &p, None).unwrap();
    let unused = p.timers.pop().unwrap();
    let rev = save_project(root.path(), &p, Some(&rev)).unwrap();
    assert!(!root.path().join("timers/unused.json").exists());
    p.timers.push(unused);
    save_project(root.path(), &p, Some(&rev)).unwrap();
    let path = root.path().join("timers/door-closes.json");
    let before = fs::read_to_string(&path).unwrap();
    p.timers[0].name = "Recovered timer".into();
    let after = serde_json::to_string_pretty(&p.timers[0]).unwrap();
    fs::write(
        root.path().join(".luna-transaction.json"),
        serde_json::to_vec(&serde_json::json!({
            "changes":[{"path":"timers/door-closes.json","before":before,"after":after}]
        }))
        .unwrap(),
    )
    .unwrap();
    assert_eq!(load_project(root.path()).unwrap(), p);
    assert!(!root.path().join(".luna-transaction.json").exists());
}

#[test]
fn old_and_future_headers_never_overwrite_timer_content() {
    let root = tempfile::tempdir().unwrap();
    let mut p = fixture::project();
    let rev = save_project(root.path(), &p, None).unwrap();
    let path = root.path().join("timers/door-closes.json");
    let original = fs::read(&path).unwrap();
    p.game.format_version = 5;
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
    fs::write(&path, b"future timer shape").unwrap();
    assert!(
        load_project(root.path())
            .unwrap_err()
            .to_string()
            .contains("Unsupported game format 999")
    );
    assert_eq!(fs::read(&path).unwrap(), b"future timer shape");
}

#[test]
fn timer_construction_and_template_bindings_round_trip_only_as_editor_metadata() {
    let root = tempfile::tempdir().unwrap();
    let stage = tempfile::tempdir().unwrap();
    let mut p = fixture::project();
    p.editor.timer_drafts.push(ScheduledTrigger {
        id: "unfinished".into(),
        name: "Under construction".into(),
        order: 50,
        priority: 0,
        condition: Condition::True,
        effects: vec![],
    });
    p.editor.templates.push(BlockTemplate {
        routines: vec![],
        id: "timer-template".into(),
        name: "Countdown".into(),
        source_owner: None,
        entities: vec![],
        text_variables: vec![],
        narratives: vec![],
        timers: vec![TemplateTimerReference {
            id: "door-closes".into(),
            name: "Door closes".into(),
        }],
        content: TemplateContent::Effects {
            effects: vec![Effect::ScheduleTimer {
                timer: "door-closes".into(),
                after: NumericOperand::Literal { value: 3 },
                pending: TimerPendingPolicy::Restart,
            }],
        },
    });
    save_project(root.path(), &p, None).unwrap();
    assert_eq!(load_project(root.path()).unwrap(), p);
    assert!(!root.path().join("timers/unfinished.json").exists());
    let exported = extract_bundle(&export_bundle(root.path(), &p).unwrap(), stage.path()).unwrap();
    assert_eq!(exported.timers, p.timers);
    assert!(exported.editor.timer_drafts.is_empty());
    assert!(exported.editor.templates.is_empty());
    assert!(!stage.path().join("editor").exists());
}
