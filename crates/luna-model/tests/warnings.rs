use luna_model::*;

fn warning(project: &Project, subject: &str) -> Diagnostic {
    validate(project)
        .into_iter()
        .find(|finding| finding.subject == subject && finding.severity == Severity::Warning)
        .unwrap()
}

#[test]
fn acknowledgements_do_not_change_validation_and_warning_identity_tracks_its_cause() {
    let mut project = Project::blank("Intentional storage");
    project.locations.push(Location {
        id: "storage".into(),
        name: "Dev room".into(),
        ..Default::default()
    });
    let original = warning(&project, "storage");
    project.editor.warning_acknowledgements = Some(vec![WarningAcknowledgement {
        warning_key: original.warning_key.clone().unwrap(),
        subject: original.subject.clone(),
        field: original.field.clone(),
        message: original.message.clone(),
        reason: "Intentional storage for Tom and unused items.".into(),
    }]);
    project.game.description = "A new summary".into();
    project.locations[1].name = "Offstage".into();
    project.locations[1].description = "An intentional storage room.".into();
    project
        .editor
        .positions
        .insert("storage".into(), Point { x: 100.0, y: 200.0 });
    assert_eq!(
        warning(&project, "storage").warning_key,
        original.warning_key
    );
    project.locations.push(Location {
        id: "attic".into(),
        name: "Attic".into(),
        ..Default::default()
    });
    assert_eq!(
        warning(&project, "storage").warning_key,
        original.warning_key
    );
    assert_ne!(warning(&project, "attic").warning_key, original.warning_key);
    project.game.starting_location = "attic".into();
    let changed = warning(&project, "storage");
    assert_eq!(changed.message, original.message);
    assert_ne!(changed.warning_key, original.warning_key);
    project.game.starting_location = "storage".into();
    assert!(
        !validate(&project)
            .iter()
            .any(|finding| finding.subject == "storage")
    );
    // Acknowledgements are presentation metadata and cannot hide errors from validation.
    project.locations[1].description = "%missing%".into();
    let diagnostics = validate(&project);
    assert!(has_errors(&diagnostics));
    assert!(
        diagnostics
            .iter()
            .filter(|finding| finding.severity == Severity::Error)
            .all(|finding| finding.warning_key.is_none())
    );
}

#[test]
fn overlap_warning_keys_distinguish_changes_with_identical_display_text() {
    let mut project = Project::blank("Overlapping verbs");
    project.vocabulary.push(Verb {
        id: "collect".into(),
        canonical: "collect".into(),
        synonyms: vec!["take".into()],
        event: None,
    });
    let original = warning(&project, "collect");
    project.vocabulary.last_mut().unwrap().synonyms = vec!["get".into()];
    let changed = warning(&project, "collect");
    assert_eq!(changed.message, original.message);
    assert_ne!(changed.warning_key, original.warning_key);
    project.game.actions = ["first", "second"]
        .into_iter()
        .map(|id| Action {
            id: id.into(),
            verb: "use".into(),
            pattern: vec![PatternPart::Literal {
                text: "lever".into(),
            }],
            ..Default::default()
        })
        .collect();
    let original = warning(&project, "second");
    project.game.actions[0].priority = 5;
    assert_ne!(
        warning(&project, "second").warning_key,
        original.warning_key
    );
    let stable = warning(&project, "second");
    project.game.actions[0].effects.push(Effect::Say {
        text: "Pulled.".into(),
    });
    assert_eq!(warning(&project, "second").warning_key, stable.warning_key);
}

#[test]
fn movement_cycle_keys_ignore_unrelated_cycles_but_track_changed_routes() {
    let mut project = Project::blank("Cycles");
    project.locations[0].id = "start".into();
    project.locations[0].actions.clear();
    project.game.starting_location = "start".into();
    project.locations.push(Location {
        id: "other".into(),
        name: "Other".into(),
        ..Default::default()
    });
    let movement = |id: &str, destination: &str| Trigger {
        id: id.into(),
        event: Event::Enter,
        effects: vec![Effect::Move {
            location: destination.into(),
        }],
        ..Default::default()
    };
    project.locations[0]
        .triggers
        .push(movement("cycle", "start"));
    let original = warning(&project, "start");
    project.locations[1]
        .triggers
        .push(movement("unrelated", "other"));
    assert_eq!(warning(&project, "start").warning_key, original.warning_key);
    project.locations[0].triggers[0].effects = vec![Effect::Move {
        location: "other".into(),
    }];
    assert_ne!(warning(&project, "start").warning_key, original.warning_key);
}

#[test]
fn legacy_metadata_defaults_and_acknowledgement_reasons_are_optional() {
    let layout: EditorLayout = serde_json::from_str(r#"{"positions":{},"blocks":{}}"#).unwrap();
    assert!(layout.warning_acknowledgements.is_none());
    let record: WarningAcknowledgement = serde_json::from_value(serde_json::json!({
        "warning_key": "a-warning", "subject": "room", "field": "exits", "message": "Unreachable"
    }))
    .unwrap();
    assert!(record.reason.is_empty());
}
