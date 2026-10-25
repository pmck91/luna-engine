use luna_core::{CommandStatus, Session, TraceKind, TraceOutcome};
use luna_model::*;
fn rule(id: &str, effects: Vec<Effect>) -> Action {
    Action {
        id: format!("rule-{id}"),
        name: id.into(),
        verb: "use".into(),
        pattern: vec![PatternPart::Literal { text: id.into() }],
        effects,
        ..Default::default()
    }
}
fn variable(name: &str, value: i32) -> Condition {
    Condition::Variable {
        name: name.into(),
        op: Comparison::Eq,
        value: Value::Integer(value),
    }
}
fn world() -> Project {
    let mut p = Project::blank("Explanations");
    p.game.variables = [
        ("health".into(), Value::Integer(3)),
        ("score".into(), Value::Integer(0)),
        ("zero".into(), Value::Integer(0)),
    ]
    .into();
    let room = p.game.starting_location.clone();
    p.objects.push(Object {
        id: "key".into(),
        name: "key".into(),
        placement: Placement::Location {
            location: room.clone(),
        },
        portable: true,
        ..Default::default()
    });
    p.characters.push(Character {
        id: "keeper".into(),
        name: "Keeper".into(),
        location: room,
        state: [("health".into(), Value::Integer(4))].into(),
        ..Default::default()
    });
    p.game.endings.push(Ending {
        id: "done".into(),
        name: "Done".into(),
        text: "Finished.".into(),
        outcome: None,
    });
    let mut unlock = rule(
        "unlock",
        vec![Effect::If {
            condition: Condition::All {
                conditions: vec![variable("health", 3), Condition::True],
            },
            then: vec![Effect::Say {
                text: "Unlocked.".into(),
            }],
            otherwise: vec![Effect::Say {
                text: "Other branch.".into(),
            }],
        }],
    );
    unlock.requirements = Condition::Carrying {
        object: "key".into(),
    };
    unlock.failure_text = "Carry the key first.".into();
    p.game.actions.push(unlock);
    p.game.actions.push(rule(
        "take",
        vec![Effect::Give {
            object: "key".into(),
        }],
    ));
    p.game.actions.push(rule(
        "hurt",
        vec![
            Effect::UpdateVariable {
                name: "health".into(),
                op: ArithmeticOperation::Subtract,
                operand: NumericOperand::Literal { value: 3 },
            },
            Effect::Say {
                text: "Must not run after ending.".into(),
            },
        ],
    ));
    p.game.actions.push(rule(
        "broken",
        vec![
            Effect::Say {
                text: "Discard this output.".into(),
            },
            Effect::SetVariable {
                name: "score".into(),
                value: Value::Integer(2),
            },
            Effect::UpdateVariable {
                name: "health".into(),
                op: ArithmeticOperation::Divide,
                operand: NumericOperand::Variable {
                    name: "zero".into(),
                },
            },
        ],
    ));
    p.game.actions.push(rule(
        "short",
        vec![Effect::If {
            condition: Condition::All {
                conditions: vec![Condition::False, variable("health", 3)],
            },
            then: vec![],
            otherwise: vec![Effect::Say {
                text: "Else.".into(),
            }],
        }],
    ));
    p.game.actions.push(rule(
        "reply",
        vec![Effect::Respond {
            id: "replies".into(),
            responses: vec!["First.".into()],
            mode: SequenceMode::Fallback,
            fallback: "Fallback.".into(),
            exhaustion: ExhaustionMode::Once,
            on_exhausted: vec![Effect::If {
                condition: Condition::True,
                then: vec![Effect::Say {
                    text: "Follow-up.".into(),
                }],
                otherwise: vec![],
            }],
        }],
    ));
    p.game.triggers.push(Trigger {
        id: "health-watch".into(),
        name: "Health reached zero".into(),
        condition: variable("health", 0),
        watch: Some(TriggerWatch {
            target: ValueTarget::Variable {
                name: "health".into(),
            },
            mode: WatchMode::BecomesTrue,
        }),
        effects: vec![
            Effect::SetVariable {
                name: "score".into(),
                value: Value::Integer(7),
            },
            Effect::End {
                ending: "done".into(),
            },
        ],
        ..Default::default()
    });
    p.characters[0].triggers.push(Trigger {
        id: "score-watch".into(),
        name: "Keeper defeated".into(),
        condition: variable("score", 7),
        watch: Some(TriggerWatch {
            target: ValueTarget::Variable {
                name: "score".into(),
            },
            mode: WatchMode::BecomesTrue,
        }),
        effects: vec![
            Effect::SetProperty {
                entity: "keeper".into(),
                name: "health".into(),
                value: Value::Integer(0),
            },
            Effect::Hide {
                entity: "keeper".into(),
            },
        ],
        ..Default::default()
    });
    assert!(!has_errors(&validate(&p)), "{:?}", validate(&p));
    p
}
#[test]
fn observations_preserve_gameplay_and_explain_requirements_branches_and_short_circuiting() {
    let p = world();
    let (mut normal, _) = Session::start(p.clone(), None).unwrap();
    let (mut traced, _) = Session::start(p, None).unwrap();
    for command in [
        "use unlock",
        "use take",
        "use unlock",
        "use short",
        "use reply",
        "use reply",
        "look",
        "inventory",
        "help",
        "not a command",
    ] {
        let expected = normal.command(command).unwrap();
        let mut actual = traced.command_explained(command);
        assert_eq!(normal.state(), traced.state(), "{command}");
        let explanation = actual.explanation.take().unwrap();
        assert!(explanation.committed);
        assert!(explanation.error.is_none());
        assert_eq!(
            serde_json::to_value(&actual).unwrap(),
            serde_json::to_value(expected).unwrap(),
            "{command}"
        );
        if command == "use unlock" && actual.status == CommandStatus::RequirementsFailed {
            assert!(explanation.steps.iter().any(|s| {
                matches!(s.kind, TraceKind::Condition { value: false, .. })
                    && s.source
                        .as_ref()
                        .is_some_and(|s| s.subject == "rule-unlock" && s.path == "requirements")
            }));
            assert!(
                !explanation
                    .steps
                    .iter()
                    .any(|s| matches!(s.kind, TraceKind::Effect { .. }))
            );
        }
        if command == "use unlock" && actual.status == CommandStatus::Ok {
            assert!(
                explanation
                    .steps
                    .iter()
                    .any(|s| matches!(s.kind, TraceKind::Branch { ref taken } if taken == "THEN"))
            );
            assert!(explanation.steps.iter().any(|s| {
                s.source
                    .as_ref()
                    .is_some_and(|s| s.path == "effects.0.then.0")
            }));
        }
        if command == "use short" {
            assert!(explanation.steps.iter().any(|s| {
                s.source
                    .as_ref()
                    .is_some_and(|s| s.path == "effects.0.condition.conditions.0")
            }));
            assert!(!explanation.steps.iter().any(|s| {
                s.source
                    .as_ref()
                    .is_some_and(|s| s.path == "effects.0.condition.conditions.1")
            }));
            assert!(explanation.steps.iter().any(|s| {
                s.source
                    .as_ref()
                    .is_some_and(|s| s.path == "effects.0.otherwise.0")
            }));
        }
        if command == "use reply" && traced.state().sequences["replies"] == 2 {
            assert!(explanation.steps.iter().any(|s| {
                s.source
                    .as_ref()
                    .is_some_and(|s| s.path == "effects.0.on_exhausted.0.then.0")
            }));
        }
    }
}
#[test]
fn value_trigger_chains_retain_order_sources_and_before_after_values() {
    let p = world();
    let (mut plain, _) = Session::start(p.clone(), None).unwrap();
    let (mut traced, _) = Session::start(p, None).unwrap();
    let plain_result = plain.command("use hurt").unwrap();
    let result = traced.command_explained("use hurt");
    assert_eq!(plain.state(), traced.state());
    assert_eq!(plain_result.messages, result.messages);
    assert_eq!(traced.state().ending.as_deref(), Some("done"));
    let explanation = result.explanation.unwrap();
    let fired = explanation
        .steps
        .iter()
        .filter_map(|s| match &s.kind {
            TraceKind::Trigger { fired: true, .. } => {
                Some(s.source.as_ref().unwrap().subject.as_str())
            }
            _ => None,
        })
        .collect::<Vec<_>>();
    assert_eq!(fired, ["health-watch", "score-watch"]);
    for (path, before, after) in [
        (vec!["variables", "health"], 3, 0),
        (vec!["variables", "score"], 0, 7),
        (vec!["properties", "keeper", "health"], 4, 0),
    ] {
        assert!(
            explanation
                .changes
                .iter()
                .any(|c| c.path == path && c.before == before && c.after == after)
        );
    }
    assert!(!explanation.steps.iter().any(|s| {
        s.source
            .as_ref()
            .is_some_and(|s| s.subject == "rule-hurt" && s.path == "effects.1")
    }));
    assert!(
        explanation
            .steps
            .iter()
            .enumerate()
            .all(|(i, s)| s.parent.is_none_or(|p| p < i))
    );
}
#[test]
fn failed_commands_retain_attempts_but_never_commit_output_or_state() {
    let p = world();
    let (mut normal, _) = Session::start(p.clone(), None).unwrap();
    let (mut traced, _) = Session::start(p, None).unwrap();
    let before = traced.state().clone();
    let expected = normal.command("use broken").unwrap_err();
    let result = traced.command_explained("use broken");
    assert_eq!(normal.state(), &before);
    assert_eq!(traced.state(), &before);
    assert!(result.messages.is_empty());
    assert!(!result.state_changed);
    let explanation = result.explanation.unwrap();
    assert!(!explanation.committed);
    assert_eq!(
        explanation.error.as_deref(),
        Some(expected.to_string().as_str())
    );
    assert_eq!(
        text::plain(&explanation.discarded_messages[0]),
        "Discard this output."
    );
    let failure = &explanation.steps[explanation.failed_step.unwrap()];
    assert_eq!(failure.outcome, TraceOutcome::Failed);
    assert_eq!(failure.source.as_ref().unwrap().path, "effects.2.operand");
    assert_eq!(failure.source.as_ref().unwrap().subject, "rule-broken");
    assert!(
        explanation
            .changes
            .iter()
            .any(|c| c.path == ["variables", "score"] && c.before == 0 && c.after == 2)
    );
    let next = traced.command_explained("use short");
    assert!(next.explanation.unwrap().committed);
    assert_eq!(traced.state(), &before);
}

#[test]
fn a_large_matching_record_is_bounded_without_stopping_execution() {
    let mut p = Project::blank("Many actions");
    p.game.variables.insert("count".into(), Value::Integer(0));
    for i in 0..8200 {
        p.game.actions.push(rule(&format!("noise-{i}"), vec![]));
    }
    p.game.actions.push(rule(
        "target",
        vec![Effect::SetVariable {
            name: "count".into(),
            value: Value::Integer(1),
        }],
    ));
    let (mut session, _) = Session::start(p, None).unwrap();
    let result = session.command_explained("use target");
    let trace = result.explanation.unwrap();
    assert!(trace.committed && trace.truncated);
    assert!(trace.steps.len() <= 8192);
    assert_eq!(session.state().variables["count"], Value::Integer(1));
    assert!(
        trace
            .changes
            .iter()
            .any(|c| c.path == ["variables", "count"] && c.after == 1)
    );
}
