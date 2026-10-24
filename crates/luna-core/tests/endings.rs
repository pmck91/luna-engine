use luna_core::Session;
use luna_model::*;
use serde_json::json;

#[test]
fn endings_with_omitted_null_or_explicit_outcomes_finalize_and_restore() {
    for outcome in [
        None,
        Some(json!(null)),
        Some(json!("victory")),
        Some(json!("loss")),
        Some(json!("neutral")),
    ] {
        let mut definition = json!({
            "id": "finish",
            "name": "An ending",
            "text": "Complete with <green>%finalizations%</green>."
        });
        if let Some(outcome) = &outcome {
            definition["outcome"] = outcome.clone();
        }
        let ending: Ending = serde_json::from_value(definition).unwrap();
        // Keep unset outcomes explicit on disk so old engines cannot default them to neutral.
        assert_eq!(
            serde_json::to_value(&ending).unwrap()["outcome"],
            outcome.unwrap_or(json!(null))
        );
        let outcome_text = ending
            .outcome
            .as_ref()
            .map(|value| format!("Outcome: {value:?}"));
        let mut p = Project::blank("Optional outcome");
        p.game.require_ending = true;
        p.game
            .variables
            .insert("finalizations".into(), Value::Integer(0));
        p.game
            .variables
            .insert("after_end".into(), Value::Bool(false));
        p.game.endings.push(ending);
        p.game.triggers.push(Trigger {
            id: "ending-finalizer".into(),
            event: Event::Ending,
            effects: vec![Effect::UpdateVariable {
                name: "finalizations".into(),
                op: ArithmeticOperation::Add,
                operand: NumericOperand::Literal { value: 1 },
            }],
            ..Default::default()
        });
        p.game.actions.push(Action {
            id: "finish-action".into(),
            verb: "use".into(),
            pattern: vec![PatternPart::Literal {
                text: "finish".into(),
            }],
            effects: vec![
                Effect::End {
                    ending: "finish".into(),
                },
                Effect::SetVariable {
                    name: "after_end".into(),
                    value: Value::Bool(true),
                },
            ],
            ..Default::default()
        });
        assert!(!has_errors(&validate(&p)));
        let (mut session, _) = Session::start(p.clone(), None).unwrap();
        let result = session.command("use finish").unwrap();
        assert!(result.state_changed);
        assert_eq!(session.state.ending.as_deref(), Some("finish"));
        assert_eq!(session.state.variables["finalizations"], Value::Integer(1));
        assert_eq!(session.state.variables["after_end"], Value::Bool(false));
        let mut expected = vec!["Complete with 1.".to_owned()];
        expected.extend(outcome_text);
        assert_eq!(
            result
                .messages
                .iter()
                .map(|message| text::plain(message))
                .collect::<Vec<_>>(),
            expected
        );
        assert!(
            result.messages[0]
                .iter()
                .any(|span| span.text == "1" && span.colour.as_deref() == Some("green"))
        );

        let saved = serde_json::to_vec(&session.state).unwrap();
        let mut restored = Session::restore(p, serde_json::from_slice(&saved).unwrap()).unwrap();
        assert_eq!(restored.state, session.state);
        let blocked = restored.command("use finish").unwrap();
        assert_eq!(blocked.status, "ended");
        assert!(!blocked.state_changed);
        assert_eq!(restored.state, session.state);
        assert!(!restored.command("look").unwrap().state_changed);
    }
}

#[test]
fn optional_outcomes_still_reject_unknown_or_malformed_values() {
    for outcome in [
        json!("none"),
        json!("win"),
        json!(""),
        json!(false),
        json!(0),
        json!({}),
    ] {
        assert!(serde_json::from_value::<Ending>(json!({"id":"end", "outcome":outcome})).is_err());
    }
    let mut p = Project::blank("Invalid ending reference");
    p.game.actions.push(Action {
        id: "missing-ending".into(),
        verb: "use".into(),
        effects: vec![Effect::End {
            ending: "missing".into(),
        }],
        ..Default::default()
    });
    assert!(has_errors(&validate(&p)));
}
