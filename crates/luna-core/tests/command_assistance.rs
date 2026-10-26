use luna_core::{CommandStatus, InputResolution, NounOrigin, Session};
use luna_model::*;

fn world() -> Project {
    let mut p = Project::blank("Assistance");
    p.game.variables.insert("tries".into(), Value::Integer(3));
    for (id, name) in [("brass", "Brass key"), ("silver", "Silver key")] {
        let mut object = Object {
            id: id.into(),
            name: name.into(),
            description: format!("Description of {name}."),
            aliases: vec!["key".into()],
            portable: true,
            placement: Placement::Inventory,
            ..Default::default()
        };
        object.actions = starter_actions(&object);
        object.hints.push(HintSet {
            id: format!("{id}-puzzle"),
            name: format!("{name} puzzle"),
            stages: vec![HintStage {
                id: format!("{id}-stage"),
                name: "First".into(),
                clues: vec!["A clue.".into()],
                solution: Some("The answer.".into()),
                ..Default::default()
            }],
            ..Default::default()
        });
        p.objects.push(object);
    }
    p
}

#[test]
fn public_results_keep_pending_questions_across_read_only_queries_and_controls() {
    let (mut session, _) = Session::start(world(), None).unwrap();
    session.command("examine brass key").unwrap();
    let before = session.state().clone();
    let first = session.command("take key").unwrap();
    let pending = first.pending_clarification.unwrap();
    for command in [
        "look",
        "inventory",
        "help",
        "help it",
        "save checkpoint",
        "saves",
        "load missing",
    ] {
        let result = session.command(command).unwrap();
        assert_eq!(
            result.pending_clarification.as_ref(),
            Some(&pending),
            "{command}"
        );
        assert_eq!(session.pending_clarification().as_ref(), Some(&pending));
        assert_eq!(session.state(), &before);
        if command == "help it" {
            assert!(matches!(
                result.input_resolution,
                Some(InputResolution::Resolved { .. })
            ));
        }
    }
    assert!(
        session
            .command("cancel")
            .unwrap()
            .pending_clarification
            .is_none()
    );
    assert!(session.pending_clarification().is_none());
}

#[test]
fn help_and_explicit_hint_solution_use_stable_recent_identity_without_changing_focus() {
    let (mut session, _) = Session::start(world(), None).unwrap();
    session.command("inspect brass key").unwrap();
    session.command("take key").unwrap();
    let hint = session.command("hint it").unwrap();
    assert!(hint.pending_clarification.is_none());
    assert_eq!(session.state().hints["brass-stage"].clues_seen, 1);
    assert!(!session.state().hints.contains_key("silver-stage"));
    session.command("hint it solution").unwrap();
    assert!(session.state().hints["brass-stage"].solution_seen);
    let result = session.command("help the it").unwrap();
    assert_eq!(result.status, CommandStatus::Ok);
    assert!(
        result
            .messages
            .iter()
            .any(|line| text::plain(line).contains("Brass key"))
    );
    let result = session.command("inspect it").unwrap();
    assert_eq!(
        text::plain(&result.messages[0]),
        "Description of Brass key."
    );
}

#[test]
fn matching_retains_exact_noun_positions_and_reference_provenance() {
    let mut p = world();
    p.game.actions.push(Action {
        id: "use-key".into(),
        verb: "use".into(),
        pattern: vec![
            PatternPart::Entity {
                entity: "brass".into(),
            },
            PatternPart::Literal {
                text: "with".into(),
            },
            PatternPart::Entity {
                entity: "silver".into(),
            },
        ],
        effects: vec![Effect::Say {
            text: "Done.".into(),
        }],
        ..Default::default()
    });
    let (mut session, _) = Session::start(p, None).unwrap();
    session.command("inspect brass key").unwrap();
    let result = session.command_explained("use it with silver key");
    let Some(InputResolution::Resolved {
        bindings,
        original_command,
        ..
    }) = result.input_resolution
    else {
        panic!("missing resolution");
    };
    assert_eq!(original_command, "use it with silver key");
    assert_eq!(
        bindings
            .iter()
            .map(|binding| (
                binding.pattern_index,
                binding.entity.as_str(),
                binding.origin
            ))
            .collect::<Vec<_>>(),
        [
            (0, "brass", NounOrigin::RecentObject),
            (2, "silver", NounOrigin::Name)
        ]
    );
    assert_eq!(
        result.explanation.unwrap().command,
        "use it with silver key"
    );
}

#[test]
fn prompts_format_values_and_do_not_apply_message_markup_to_entity_names() {
    let mut p = world();
    let settings = p.game.command_assistance.as_mut().unwrap();
    settings.clarification_text = "<green>Choose: %tries% chances.</green>".into();
    settings.retry_text = "Try again with %tries% chances.".into();
    p.objects[0].name = "<red>Brass key</red>".into();
    let (mut session, _) = Session::start(p, None).unwrap();
    let result = session.command("take key").unwrap();
    assert_eq!(result.messages[0][0].colour.as_deref(), Some("green"));
    assert_eq!(text::plain(&result.messages[0]), "Choose: 3 chances.");
    assert!(
        result
            .messages
            .iter()
            .flatten()
            .any(|span| span.text.contains("<red>") && span.colour.is_none())
    );
    let retry = session.command("maybe").unwrap();
    assert_eq!(text::plain(&retry.messages[0]), "Try again with 3 chances.");
    assert!(!retry.state_changed);
}

#[test]
fn a_valid_recent_object_without_the_requested_action_uses_the_unknown_reply() {
    let mut p = world();
    p.game.unknown_command_text = "The forest has no answer.".into();
    let (mut session, _) = Session::start(p, None).unwrap();
    session.command("examine brass key").unwrap();
    let result = session.command("open it").unwrap();
    assert_eq!(result.status, CommandStatus::Unmatched);
    assert_eq!(
        text::plain(&result.messages[0]),
        "The forest has no answer."
    );
}

#[test]
fn omitted_settings_are_disabled_and_restoration_never_replays_a_pending_choice() {
    let p = world();
    let mut encoded = serde_json::to_value(&p).unwrap();
    encoded["game"]
        .as_object_mut()
        .unwrap()
        .remove("command_assistance");
    let old: Project = serde_json::from_value(encoded).unwrap();
    assert!(old.game.command_assistance.is_none());
    assert!(
        !serde_json::to_string(&old.game)
            .unwrap()
            .contains("command_assistance")
    );
    let (mut legacy, _) = Session::start(old, None).unwrap();
    assert!(
        legacy
            .command("take key")
            .unwrap()
            .input_resolution
            .is_none()
    );
    let (mut session, _) = Session::start(p.clone(), None).unwrap();
    session.command("inspect brass key").unwrap();
    session.command("take key").unwrap();
    let state = session.state().clone();
    session.replace_state(state.clone()).unwrap();
    assert!(session.pending_clarification().is_none());
    assert_eq!(
        session.command("examine it").unwrap().status,
        CommandStatus::Unmatched
    );
    let mut restored = Session::restore(p, state.clone()).unwrap();
    assert!(restored.pending_clarification().is_none());
    assert_eq!(restored.state(), &state);
    assert_eq!(
        restored.command("1").unwrap().status,
        CommandStatus::Unmatched
    );
}

#[test]
fn cancellation_stays_read_only_after_an_ending() {
    let mut project = world();
    project.game.endings.push(Ending {
        id: "end".into(),
        name: "End".into(),
        ..Default::default()
    });
    project.game.actions.push(Action {
        id: "finish".into(),
        verb: "use".into(),
        pattern: vec![PatternPart::Literal {
            text: "finish".into(),
        }],
        effects: vec![Effect::End {
            ending: "end".into(),
        }],
        ..Default::default()
    });
    let (mut session, _) = Session::start(project, None).unwrap();
    session.command("use finish").unwrap();
    let before = session.state().clone();
    let result = session.command("cancel").unwrap();
    assert_eq!(result.status, CommandStatus::Ok);
    assert!(matches!(
        result.input_resolution,
        Some(InputResolution::Cancelled {
            original_command: None
        })
    ));
    assert_eq!(session.state(), &before);
}
