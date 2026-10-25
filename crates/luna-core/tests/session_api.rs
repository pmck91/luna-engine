use luna_core::{CommandResult, CommandStatus, HostControl, Session};
use luna_model::*;
use serde_json::json;

#[test]
fn typed_command_statuses_preserve_the_existing_json_contract() {
    for (status, wire) in [
        (CommandStatus::Ok, "ok"),
        (CommandStatus::Control, "control"),
        (CommandStatus::Unmatched, "unmatched"),
        (CommandStatus::Ambiguous, "ambiguous"),
        (CommandStatus::RequirementsFailed, "requirements_failed"),
        (CommandStatus::Ended, "ended"),
        (CommandStatus::Error, "error"),
    ] {
        let result = CommandResult {
            status,
            ..Default::default()
        };
        let encoded = serde_json::to_value(&result).unwrap();
        assert_eq!(
            encoded,
            json!({
                "messages": [], "trace": [], "state_changed": false,
                "status": wire, "control": null, "selected_flow": null,
            })
        );
        let restored: CommandResult = serde_json::from_value(encoded).unwrap();
        assert_eq!(restored.status, status);
    }
    assert_eq!(CommandResult::default().status, CommandStatus::Ok);
    assert!(serde_json::from_value::<CommandStatus>(json!("unknown_status")).is_err());
}

#[test]
fn command_outcomes_preserve_rejections_controls_and_transactional_errors() {
    let mut project = Project::blank("Command outcomes");
    project.game.variables = [
        ("count".into(), Value::Integer(1)),
        ("divisor".into(), Value::Integer(0)),
    ]
    .into();
    let action = |id: &str, phrase: &str, effects: Vec<Effect>| Action {
        id: id.into(),
        verb: "use".into(),
        name: id.into(),
        pattern: vec![PatternPart::Literal {
            text: phrase.into(),
        }],
        effects,
        ..Default::default()
    };
    let mut blocked = action("blocked", "blocked", vec![]);
    blocked.requirements = Condition::False;
    project.game.actions = vec![
        blocked,
        action("choice-one", "choice", vec![]),
        action("choice-two", "choice", vec![]),
        action(
            "broken",
            "broken",
            vec![
                Effect::Say {
                    text: "Discard this attempted output.".into(),
                },
                Effect::SetVariable {
                    name: "count".into(),
                    value: Value::Integer(42),
                },
                Effect::UpdateVariable {
                    name: "count".into(),
                    op: ArithmeticOperation::Divide,
                    operand: NumericOperand::Variable {
                        name: "divisor".into(),
                    },
                },
            ],
        ),
        action(
            "finish-action",
            "finish",
            vec![Effect::End {
                ending: "finish".into(),
            }],
        ),
    ];
    project.game.endings.push(Ending {
        id: "finish".into(),
        name: "Finish".into(),
        text: "Done.".into(),
        outcome: None,
    });
    let (mut session, _) = Session::start(project, None).unwrap();
    let before = session.state().clone();
    for (input, status) in [
        ("look", CommandStatus::Ok),
        ("nonsense", CommandStatus::Unmatched),
        ("use blocked", CommandStatus::RequirementsFailed),
        ("use choice", CommandStatus::Ambiguous),
        ("save checkpoint", CommandStatus::Control),
    ] {
        let result = session.command(input).unwrap();
        assert_eq!(result.status, status, "{input}");
        assert!(!result.state_changed);
        assert_eq!(session.state(), &before);
        if status == CommandStatus::Control {
            assert_eq!(
                result.control,
                Some(HostControl::Save {
                    name: Some("checkpoint".into())
                })
            );
        }
    }
    assert!(
        session
            .command("use broken")
            .unwrap_err()
            .to_string()
            .contains("zero")
    );
    assert_eq!(session.state(), &before);
    let explained = session.command_explained("use broken");
    assert_eq!(explained.status, CommandStatus::Error);
    assert!(!explained.state_changed);
    assert!(explained.messages.is_empty());
    assert!(explained.control.is_none());
    let explanation = explained.explanation.unwrap();
    assert!(!explanation.committed);
    assert!(explanation.error.unwrap().contains("zero"));
    assert_eq!(
        text::plain(&explanation.discarded_messages[0]),
        "Discard this attempted output."
    );
    assert_eq!(session.state(), &before);
    assert_eq!(
        session.command("use finish").unwrap().status,
        CommandStatus::Ok
    );
    assert_eq!(
        session.command("nonsense").unwrap().status,
        CommandStatus::Ended
    );
    assert_eq!(session.command("look").unwrap().status, CommandStatus::Ok);
    assert_eq!(
        session.command("save checkpoint").unwrap().status,
        CommandStatus::Control
    );
}
