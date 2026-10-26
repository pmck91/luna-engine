use luna_core::{CommandResult, Session};
use luna_model::*;

fn say(text: &str) -> Effect {
    Effect::Say { text: text.into() }
}
fn punch() -> Effect {
    Effect::UpdateVariable {
        name: "punches".into(),
        op: ArithmeticOperation::Add,
        operand: NumericOperand::Literal { value: 1 },
    }
}
fn world(mode: SequenceMode, exhaustion: ExhaustionMode, follow_up: Vec<Effect>) -> Project {
    let mut p = Project::blank("Response follow-ups");
    p.game.variables.insert("punches".into(), Value::Integer(0));
    p.vocabulary.push(Verb {
        id: "poke".into(),
        canonical: "poke".into(),
        ..Default::default()
    });
    p.characters.push(Character {
        id: "keeper".into(),
        name: "keeper".into(),
        location: p.game.starting_location.clone(),
        actions: vec![Action {
            id: "poke-keeper".into(),
            verb: "poke".into(),
            pattern: vec![PatternPart::Entity {
                entity: "keeper".into(),
            }],
            effects: vec![Effect::Respond {
                id: "replies".into(),
                responses: vec![
                    "First warning.".into(),
                    "Second warning.".into(),
                    "Last warning.".into(),
                ],
                mode,
                fallback: "Enough!".into(),
                exhaustion,
                on_exhausted: follow_up,
            }],
            ..Default::default()
        }],
        ..Default::default()
    });
    p.game.actions.push(Action {
        id: "reset-replies".into(),
        verb: "use".into(),
        pattern: vec![PatternPart::Literal {
            text: "reset".into(),
        }],
        effects: vec![Effect::ResetResponses {
            sequence: "replies".into(),
        }],
        ..Default::default()
    });
    p
}
fn output(result: CommandResult) -> String {
    result
        .messages
        .iter()
        .map(|m| text::plain(m))
        .collect::<Vec<_>>()
        .join("\n")
}
fn exhaust(s: &mut Session) {
    for reply in ["First warning.", "Second warning.", "Last warning."] {
        assert_eq!(output(s.command("poke keeper").unwrap()), reply);
        assert_eq!(s.state().variables["punches"], Value::Integer(0));
    }
}

#[test]
fn fourth_poke_runs_once_or_repeating_follow_ups_and_preserves_completion() {
    for exhaustion in [ExhaustionMode::Once, ExhaustionMode::Repeat] {
        let p = world(
            SequenceMode::Fallback,
            exhaustion,
            vec![punch(), say("The keeper punches you.")],
        );
        let (mut s, _) = Session::start(p, None).unwrap();
        exhaust(&mut s);
        assert_eq!(s.state().sequences["replies"], 3);
        for interaction in 1..=3 {
            // Exercise serialization on both sides of the first follow-up.
            let state = serde_json::from_slice(&serde_json::to_vec(s.state()).unwrap()).unwrap();
            s = Session::restore_with_definition(s.definition().clone(), state).unwrap();
            let result = s.command("poke keeper").unwrap();
            let should_run = interaction == 1 || exhaustion == ExhaustionMode::Repeat;
            assert_eq!(result.state_changed, should_run);
            assert_eq!(
                output(result),
                if should_run {
                    "Enough!\nThe keeper punches you."
                } else {
                    "Enough!"
                }
            );
            assert_eq!(s.state().sequences["replies"], 4);
            assert_eq!(
                s.state().variables["punches"],
                Value::Integer(if exhaustion == ExhaustionMode::Once {
                    1
                } else {
                    interaction
                })
            );
        }
    }
}

#[test]
fn repeat_last_and_loop_never_run_follow_ups() {
    for mode in [SequenceMode::RepeatLast, SequenceMode::Loop] {
        let p = world(mode.clone(), ExhaustionMode::Repeat, vec![punch()]);
        let (mut s, _) = Session::start(p, None).unwrap();
        exhaust(&mut s);
        for _ in 0..4 {
            let result = output(s.command("poke keeper").unwrap());
            if mode == SequenceMode::RepeatLast {
                assert_eq!(result, "Last warning.");
            }
            assert_eq!(s.state().variables["punches"], Value::Integer(0));
        }
        Session::restore_with_definition(s.definition().clone(), s.state().clone()).unwrap();
    }
}

#[test]
fn reset_rearms_once_only_follow_ups_and_a_new_session_resets_everything() {
    let p = world(SequenceMode::Fallback, ExhaustionMode::Once, vec![punch()]);
    let (mut s, _) = Session::start(p, None).unwrap();
    for count in [1, 2] {
        for _ in 0..3 {
            s.command("poke keeper").unwrap();
        }
        assert_eq!(s.state().variables["punches"], Value::Integer(count - 1));
        s.command("poke keeper").unwrap();
        assert_eq!(s.state().variables["punches"], Value::Integer(count));
        s.command("use reset").unwrap();
        assert_eq!(s.state().sequences["replies"], 0);
        s = Session::restore_with_definition(s.definition().clone(), s.state().clone()).unwrap();
    }
    let (restarted, _) = Session::start_with_definition(s.definition().clone(), None).unwrap();
    assert_eq!(restarted.state().sequences["replies"], 0);
    assert_eq!(restarted.state().variables["punches"], Value::Integer(0));
}

#[test]
fn a_follow_up_can_reset_its_own_sequence() {
    let p = world(
        SequenceMode::Fallback,
        ExhaustionMode::Once,
        vec![
            punch(),
            Effect::ResetResponses {
                sequence: "replies".into(),
            },
        ],
    );
    let (mut s, _) = Session::start(p, None).unwrap();
    exhaust(&mut s);
    s.command("poke keeper").unwrap();
    assert_eq!(s.state().sequences["replies"], 0);
    assert_eq!(output(s.command("poke keeper").unwrap()), "First warning.");
}

#[test]
fn nested_sequences_and_conditions_use_live_state_and_independent_progress() {
    let inner = Effect::Respond {
        id: "inner".into(),
        responses: vec!["An extra warning.".into()],
        mode: SequenceMode::Fallback,
        fallback: String::new().into(),
        exhaustion: ExhaustionMode::Once,
        on_exhausted: vec![punch()],
    };
    let p = world(
        SequenceMode::Fallback,
        ExhaustionMode::Repeat,
        vec![Effect::If {
            condition: Condition::Variable {
                name: "punches".into(),
                op: Comparison::Eq,
                value: Value::Integer(0),
            },
            then: vec![inner],
            otherwise: vec![say("You have already been punched %punches% times.")],
        }],
    );
    let (mut s, _) = Session::start(p, None).unwrap();
    assert_eq!(s.state().sequences["inner"], 0);
    exhaust(&mut s);
    assert_eq!(
        output(s.command("poke keeper").unwrap()),
        "Enough!\nAn extra warning."
    );
    s = Session::restore_with_definition(s.definition().clone(), s.state().clone()).unwrap();
    s.command("poke keeper").unwrap();
    assert_eq!(s.state().variables["punches"], Value::Integer(1));
    assert_eq!(
        output(s.command("poke keeper").unwrap()),
        "Enough!\nYou have already been punched 1 times."
    );
    s.command("use reset").unwrap();
    assert_eq!(
        s.state().sequences["inner"],
        2,
        "Reset affects only the selected sequence"
    );
}

#[test]
fn nested_trigger_reentry_does_not_repeat_a_once_only_follow_up() {
    let mut p = world(
        SequenceMode::Fallback,
        ExhaustionMode::Once,
        vec![
            punch(),
            Effect::Close {
                object: "box".into(),
            },
            Effect::Open {
                object: "box".into(),
            },
        ],
    );
    let sequence = p.characters[0].actions[0].effects.remove(0);
    p.characters[0].actions[0].effects = vec![
        Effect::Close {
            object: "box".into(),
        },
        Effect::Open {
            object: "box".into(),
        },
    ];
    p.objects.push(Object {
        id: "box".into(),
        name: "box".into(),
        placement: Placement::Location {
            location: p.game.starting_location.clone(),
        },
        triggers: vec![Trigger {
            id: "open-box".into(),
            event: Event::Open,
            effects: vec![say("Opened."), sequence],
            ..Default::default()
        }],
        ..Default::default()
    });
    let (mut s, _) = Session::start(p, None).unwrap();
    for _ in 0..3 {
        s.command("poke keeper").unwrap();
    }
    assert_eq!(
        output(s.command("poke keeper").unwrap()),
        "Opened.\nEnough!\nOpened.\nEnough!"
    );
    assert_eq!(s.state().variables["punches"], Value::Integer(1));
}

#[test]
fn failed_follow_ups_roll_back_output_changes_and_completion_before_retry() {
    let mut p = world(
        SequenceMode::Fallback,
        ExhaustionMode::Once,
        vec![
            punch(),
            Effect::UpdateVariable {
                name: "punches".into(),
                op: ArithmeticOperation::Divide,
                operand: NumericOperand::Variable {
                    name: "divisor".into(),
                },
            },
        ],
    );
    p.game.variables.insert("divisor".into(), Value::Integer(0));
    let (mut s, _) = Session::start(p, None).unwrap();
    exhaust(&mut s);
    let before = s.state().clone();
    assert!(
        s.command("poke keeper")
            .unwrap_err()
            .to_string()
            .contains("zero")
    );
    assert_eq!(s.state(), &before);
    let mut state = s.state().clone();
    state.variables.insert("divisor".into(), Value::Integer(1));
    s.replace_state(state).unwrap();
    assert_eq!(output(s.command("poke keeper").unwrap()), "Enough!");
    assert_eq!(s.state().variables["punches"], Value::Integer(1));
    s.command("poke keeper").unwrap();
    assert_eq!(s.state().variables["punches"], Value::Integer(1));
}

#[test]
fn follow_up_stop_and_end_propagate_to_the_enclosing_action() {
    for end in [false, true] {
        let mut p = world(
            SequenceMode::Fallback,
            ExhaustionMode::Once,
            vec![
                punch(),
                if end {
                    Effect::End {
                        ending: "punched".into(),
                    }
                } else {
                    Effect::Stop
                },
                say("Must not print inside."),
            ],
        );
        p.characters[0].actions[0]
            .effects
            .push(say("Must not print outside."));
        p.game.endings.push(Ending {
            id: "punched".into(),
            name: "Punched".into(),
            text: "Game over.".into(),
            outcome: Some(Outcome::Loss),
        });
        let (mut s, _) = Session::start(p, None).unwrap();
        for _ in 0..3 {
            s.command("poke keeper").unwrap();
        }
        let out = output(s.command("poke keeper").unwrap());
        assert!(!out.contains("Must not print"));
        assert_eq!(s.state().variables["punches"], Value::Integer(1));
        assert_eq!(s.state().ending.is_some(), end);
        if end {
            assert!(out.contains("Game over."));
        }
        Session::restore_with_definition(s.definition().clone(), s.state().clone()).unwrap();
    }
}

#[test]
fn old_responses_default_safely_and_saved_cursors_remain_strict() {
    let old: Effect = serde_json::from_value(serde_json::json!({
        "type":"respond", "id":"legacy", "responses":["Hello"],
        "mode":"fallback", "fallback":"Done"
    }))
    .unwrap();
    assert!(
        matches!(old, Effect::Respond { exhaustion: ExhaustionMode::Once, on_exhausted, .. } if on_exhausted.is_empty())
    );
    for with_follow_up in [false, true] {
        let p = world(
            SequenceMode::Fallback,
            ExhaustionMode::Once,
            if with_follow_up {
                vec![punch()]
            } else {
                vec![]
            },
        );
        let (s, _) = Session::start(p, None).unwrap();
        for cursor in [0, 2, 3, 4, 5, usize::MAX] {
            let mut state = s.state().clone();
            state.sequences.insert("replies".into(), cursor);
            assert_eq!(
                Session::restore_with_definition(s.definition().clone(), state).is_ok(),
                cursor <= 3 || (with_follow_up && cursor == 4)
            );
        }
    }
}

#[test]
fn validates_nested_text_references_sequence_ids_and_resets() {
    for follow_up in [
        say("%missing%"),
        Effect::ResetResponses {
            sequence: "missing".into(),
        },
        Effect::Give {
            object: "missing".into(),
        },
        Effect::Respond {
            id: "replies".into(),
            responses: vec!["duplicate".into()],
            mode: SequenceMode::Loop,
            fallback: String::new().into(),
            exhaustion: ExhaustionMode::Once,
            on_exhausted: vec![],
        },
    ] {
        let p = world(
            SequenceMode::Fallback,
            ExhaustionMode::Once,
            vec![follow_up],
        );
        assert!(has_errors(&validate(&p)));
        assert!(Session::start(p, None).is_err());
    }
}
