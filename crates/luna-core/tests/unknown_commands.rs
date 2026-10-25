use luna_core::Session;
use luna_model::*;

#[test]
fn unknown_commands_format_live_values_without_changing_state_or_firing_triggers() {
    let mut project = Project::blank("A voice in the forest");
    let room = project.locations[0].id.clone();
    project
        .game
        .variables
        .insert("chances".into(), Value::Integer(3));
    project.locations[0]
        .state
        .insert("charges".into(), Value::Integer(7));
    project.game.unknown_command_text = format!(
        "<green>The forest is silent.</green> %chances% chances and %{room}.charges% charges remain."
    );
    project.game.triggers.push(Trigger {
        id: "command-counter".into(),
        event: Event::Command,
        effects: vec![Effect::SetVariable {
            name: "chances".into(),
            value: Value::Integer(0),
        }],
        ..Default::default()
    });
    let (mut session, _) = Session::start(project, None).unwrap();
    for (chances, charges) in [(3, 7), (5, 9)] {
        session
            .state
            .variables
            .insert("chances".into(), Value::Integer(chances));
        session
            .state
            .properties
            .get_mut(&room)
            .unwrap()
            .insert("charges".into(), Value::Integer(charges));
        let before = session.state.clone();
        let result = session.command("summon starlight").unwrap();
        assert_eq!(result.status, "unmatched");
        assert_eq!(result.selected_flow, None);
        assert!(!result.state_changed);
        assert_eq!(session.state, before);
        assert_eq!(result.messages.len(), 1);
        assert_eq!(
            text::plain(&result.messages[0]),
            format!("The forest is silent. {chances} chances and {charges} charges remain.")
        );
        assert_eq!(result.messages[0][0].colour.as_deref(), Some("green"));
        let explained = session.command_explained("use nonexistent object");
        assert_eq!(explained.status, "unmatched");
        assert_eq!(explained.messages, result.messages);
        assert!(explained.explanation.unwrap().changes.is_empty());
        assert_eq!(session.state, before);
    }
}

#[test]
fn custom_unknown_replies_leave_builtins_matched_commands_and_endings_alone() {
    let mut project = Project::blank("Reply boundaries");
    project.game.unknown_command_text = "The forest has no answer for that.".into();
    project.game.actions.push(Action {
        id: "locked-gate".into(),
        verb: "use".into(),
        pattern: vec![PatternPart::Literal {
            text: "gate".into(),
        }],
        requirements: Condition::False,
        failure_text: "The gate remains locked.".into(),
        ..Default::default()
    });
    for id in ["first-path", "second-path"] {
        project.game.actions.push(Action {
            id: id.into(),
            verb: "use".into(),
            pattern: vec![PatternPart::Literal {
                text: "path".into(),
            }],
            ..Default::default()
        });
    }
    project.game.endings.push(Ending {
        id: "finish".into(),
        ..Default::default()
    });
    let custom = project.game.unknown_command_text.clone();
    let (mut session, _) = Session::start(project, None).unwrap();
    for command in [
        "",
        "!!!",
        "look",
        "inventory",
        "help",
        "help nobody",
        "hint nobody",
        "inspect starting location",
    ] {
        let result = session.command(command).unwrap();
        assert!(
            result
                .messages
                .iter()
                .all(|message| text::plain(message) != custom),
            "{command}"
        );
    }
    let blocked = session.command("use gate").unwrap();
    assert_eq!(blocked.status, "requirements_failed");
    assert_eq!(
        text::plain(&blocked.messages[0]),
        "The gate remains locked."
    );
    let ambiguous = session.command("use path").unwrap();
    assert_eq!(ambiguous.status, "ambiguous");
    assert!(text::plain(&ambiguous.messages[0]).contains("Please clarify"));
    session.state.ending = Some("finish".into());
    let ended = session.command("summon starlight").unwrap();
    assert_eq!(ended.status, "ended");
    assert!(text::plain(&ended.messages[0]).contains("This playthrough has ended."));
}

#[test]
fn legacy_projects_keep_the_standard_reply_and_explicit_empty_replies_stay_empty() {
    let mut legacy = serde_json::to_value(Project::blank("Legacy")).unwrap();
    legacy["game"]
        .as_object_mut()
        .unwrap()
        .remove("unknown_command_text");
    let project = serde_json::from_value(legacy).unwrap();
    let (mut session, _) = Session::start(project, None).unwrap();
    let result = session.command("summon starlight").unwrap();
    assert_eq!(
        text::plain(&result.messages[0]),
        default_unknown_command_text()
    );
    session.project.game.unknown_command_text.clear();
    let result = session.command("summon starlight").unwrap();
    assert_eq!(result.status, "unmatched");
    assert!(result.messages.is_empty());
    assert!(!result.state_changed);
}
