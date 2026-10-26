use luna_model::*;

#[test]
fn new_game_policy_and_legacy_serialization_are_explicit() {
    let mut project = Project::blank("New game");
    assert_eq!(project.game.format_version, 3);
    assert_eq!(project.minimum_format(), 3);
    let settings = project.game.command_assistance.as_ref().unwrap();
    assert!(settings.clarification && settings.recent_objects);
    assert!(!CommandAssistance::default().clarification);
    assert!(!CommandAssistance::default().recent_objects);
    for format in [1, 2] {
        project.game.format_version = format;
        project.game.command_assistance = None;
        let encoded = serde_json::to_string(&project).unwrap();
        assert!(!encoded.contains("command_assistance"));
        let restored: Project = serde_json::from_str(&encoded).unwrap();
        assert_eq!(restored, project);
        assert!(!has_errors(&validate(&restored)));
    }
    project.game.command_assistance = Some(CommandAssistance::default());
    assert_eq!(project.minimum_format(), 3);
    assert!(validate(&project).iter().any(
        |finding| finding.field == "command_assistance" && finding.severity == Severity::Error
    ));
}

#[test]
fn messages_validate_live_references_and_clarification_collisions_ignore_initial_scope() {
    let mut project = Project::blank("Validation");
    project.game.command_assistance.as_mut().unwrap().retry_text = "%missing%".into();
    assert!(
        validate(&project)
            .iter()
            .any(|finding| finding.field == "command_assistance.retry_text")
    );
    project.game.command_assistance.as_mut().unwrap().retry_text = "Retry".into();
    project.vocabulary.push(Verb {
        id: "abort".into(),
        canonical: "abort".into(),
        synonyms: vec!["CANCEL!".into()],
        event: None,
    });
    project.objects.push(Object {
        id: "hidden".into(),
        name: "Hidden".into(),
        hidden: true,
        actions: vec![Action {
            id: "cancel-action".into(),
            verb: "abort".into(),
            requirements: Condition::False,
            ..Default::default()
        }],
        ..Default::default()
    });
    assert_eq!(cancellation_conflicts(&project), ["cancel-action"]);
    assert!(
        validate(&project)
            .iter()
            .any(|finding| finding.subject == "cancel-action" && finding.field == "pattern")
    );
    project
        .game
        .command_assistance
        .as_mut()
        .unwrap()
        .clarification = false;
    assert!(!has_errors(&validate(&project)));
    project
        .game
        .command_assistance
        .as_mut()
        .unwrap()
        .clarification = true;
    project.objects[0].actions[0]
        .pattern
        .push(PatternPart::Literal {
            text: "spell".into(),
        });
    assert!(cancellation_conflicts(&project).is_empty());
    assert!(!has_errors(&validate(&project)));
}
