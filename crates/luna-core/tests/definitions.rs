use luna_core::{GameDefinition, GameState, Session, validate_state};
use luna_model::*;

fn project() -> Project {
    let mut project = Project::blank("Definition checks");
    project.game.id = "definition-checks".into();
    project.game.starting_location = "room".into();
    project.locations[0].id = "room".into();
    project.locations[0].name = "Room".into();
    project.locations[0].actions.clear();
    project.locations[0].state = [("health".into(), Value::Integer(10))].into();
    project.game.variables = [
        ("score".into(), Value::Integer(0)),
        ("label".into(), Value::Text("Safe text".into())),
    ]
    .into();
    project.objects.push(Object {
        id: "key".into(),
        name: "Key".into(),
        placement: Placement::Location {
            location: "room".into(),
        },
        ..Default::default()
    });
    project.characters.push(Character {
        id: "keeper".into(),
        name: "Keeper".into(),
        location: "room".into(),
        ..Default::default()
    });
    project.locations[0].hints.push(HintSet {
        id: "puzzle".into(),
        name: "Puzzle".into(),
        stages: vec![HintStage {
            id: "clues".into(),
            name: "Clues".into(),
            clues: vec!["Look around.".into()],
            ..Default::default()
        }],
        ..Default::default()
    });
    project.game.endings.push(Ending {
        id: "finish".into(),
        name: "Finish".into(),
        text: "Done.".into(),
        outcome: None,
    });
    project.game.triggers.push(Trigger {
        id: "start-counter".into(),
        event: Event::Start,
        effects: vec![Effect::UpdateVariable {
            name: "score".into(),
            op: ArithmeticOperation::Add,
            operand: NumericOperand::Literal { value: 1 },
        }],
        ..Default::default()
    });
    project.game.actions.push(Action {
        id: "reply".into(),
        verb: "use".into(),
        pattern: vec![PatternPart::Literal {
            text: "reply".into(),
        }],
        effects: vec![Effect::Respond {
            id: "responses".into(),
            responses: vec!["First.".into(), "Second.".into()],
            mode: SequenceMode::Fallback,
            fallback: "Finished.".into(),
            exhaustion: ExhaustionMode::Once,
            on_exhausted: vec![Effect::Respond {
                id: "nested".into(),
                responses: vec!["Again.".into()],
                mode: SequenceMode::Loop,
                fallback: String::new().into(),
                exhaustion: ExhaustionMode::Once,
                on_exhausted: vec![],
            }],
        }],
        ..Default::default()
    });
    project
}

#[test]
fn immutable_definitions_share_content_but_changed_projects_are_revalidated() {
    let definition = GameDefinition::new(project()).unwrap();
    let (mut session, _) = Session::start_with_definition(definition.clone(), None).unwrap();
    session.command("use reply").unwrap();
    session.command("hint room").unwrap();
    let before = session.state().clone();
    let resumed = Session::restore_with_definition(definition.clone(), before.clone()).unwrap();
    assert!(std::ptr::eq(definition.project(), resumed.project()));
    assert_eq!(resumed.state(), &before);
    assert_eq!(resumed.state().variables["score"], Value::Integer(1));
    assert_eq!(resumed.state().visits["room"], 1);
    assert_eq!(resumed.state().sequences["responses"], 1);
    assert_eq!(resumed.state().hints["clues"].clues_seen, 1);

    let mut changed = definition.project().clone();
    changed.game.title = "Changed title".into();
    let compatible = GameDefinition::new(changed.clone()).unwrap();
    compatible.validate_state(&before).unwrap();
    assert_eq!(definition.project().game.title, "Definition checks");
    changed
        .game
        .variables
        .insert("score".into(), Value::Bool(false));
    // Removing the now-invalid integer update leaves valid content with an
    // incompatible saved-state schema under the same published identity.
    changed.game.triggers.clear();
    let incompatible = GameDefinition::new(changed).unwrap();
    assert!(incompatible.validate_state(&before).is_err());
    assert!(Session::restore_with_definition(incompatible, before.clone()).is_err());
    definition.validate_state(&before).unwrap();

    let mut invalid = definition.project().clone();
    invalid.game.starting_location = "missing".into();
    assert!(GameDefinition::new(invalid.clone()).is_err());
    assert!(Session::start(invalid.clone(), None).is_err());
    assert!(Session::restore(invalid.clone(), before.clone()).is_err());
    assert!(validate_state(&invalid, &before).is_err());
    assert!(Session::start_with_definition(definition, Some("missing")).is_err());
}

#[test]
fn cached_checks_reject_malformed_state_without_weakening_the_untrusted_entry_point() {
    let definition = GameDefinition::new(project()).unwrap();
    let (mut session, _) = Session::start_with_definition(definition.clone(), None).unwrap();
    let before = session.state().clone();
    type StateMutation = fn(&mut GameState);
    let cases: &[(&str, StateMutation)] = &[
        ("game identity", |s| s.game_id = "other".into()),
        ("content version", |s| s.content_version = "2.0.0".into()),
        ("current room", |s| s.location = "missing".into()),
        ("ending", |s| s.ending = Some("missing".into())),
        ("missing variable", |s| {
            s.variables.remove("score");
        }),
        ("extra variable", |s| {
            s.variables.insert("extra".into(), Value::Bool(true));
        }),
        ("variable type", |s| {
            s.variables.insert("score".into(), Value::Bool(true));
        }),
        ("unsafe text", |s| {
            s.variables
                .insert("label".into(), Value::Text("\x1b[0m".into()));
        }),
        ("missing object", |s| {
            s.objects.clear();
        }),
        ("wrong object", |s| {
            let object = s.objects.remove("key").unwrap();
            s.objects.insert("other".into(), object);
        }),
        ("object room", |s| {
            s.objects.get_mut("key").unwrap().placement = Placement::Location {
                location: "missing".into(),
            };
        }),
        ("object owner", |s| {
            s.objects.get_mut("key").unwrap().placement = Placement::Character {
                character: "missing".into(),
            };
        }),
        ("object existence", |s| {
            s.objects.get_mut("key").unwrap().exists = false;
        }),
        ("absent existence", |s| {
            s.objects.get_mut("key").unwrap().placement = Placement::Absent;
        }),
        ("consumed existence", |s| {
            s.objects.get_mut("key").unwrap().consumed = true;
        }),
        ("missing character", |s| {
            s.characters.clear();
        }),
        ("wrong character", |s| {
            let character = s.characters.remove("keeper").unwrap();
            s.characters.insert("other".into(), character);
        }),
        ("character room", |s| {
            s.characters.get_mut("keeper").unwrap().location = "missing".into();
        }),
        ("property owner", |s| {
            let properties = s.properties.remove("room").unwrap();
            s.properties.insert("other".into(), properties);
        }),
        ("missing property", |s| {
            s.properties.get_mut("room").unwrap().clear();
        }),
        ("property type", |s| {
            s.properties
                .get_mut("room")
                .unwrap()
                .insert("health".into(), Value::Bool(false));
        }),
        ("extra property", |s| {
            s.properties
                .get_mut("room")
                .unwrap()
                .insert("extra".into(), Value::Integer(1));
        }),
        ("missing visit", |s| {
            s.visits.clear();
        }),
        ("wrong visit", |s| {
            s.visits.remove("room");
            s.visits.insert("other".into(), 1);
        }),
        ("extra visit", |s| {
            s.visits.insert("other".into(), 1);
        }),
        ("missing sequence", |s| {
            s.sequences.clear();
        }),
        ("wrong sequence", |s| {
            let cursor = s.sequences.remove("responses").unwrap();
            s.sequences.insert("other".into(), cursor);
        }),
        ("response cursor", |s| {
            s.sequences.insert("responses".into(), usize::MAX);
        }),
        ("loop cursor", |s| {
            s.sequences.insert("nested".into(), 1);
        }),
        ("hint stage", |s| {
            s.hints.insert(
                "missing".into(),
                HintProgress {
                    clues_seen: 0,
                    solution_seen: false,
                },
            );
        }),
        ("hint cursor", |s| {
            s.hints.insert(
                "clues".into(),
                HintProgress {
                    clues_seen: 2,
                    solution_seen: false,
                },
            );
        }),
        ("hint solution", |s| {
            s.hints.insert(
                "clues".into(),
                HintProgress {
                    clues_seen: 0,
                    solution_seen: true,
                },
            );
        }),
    ];
    for (label, change) in cases {
        let mut state = session.state().clone();
        change(&mut state);
        assert!(
            definition.validate_state(&state).is_err(),
            "Accepted {label}"
        );
        assert!(
            validate_state(definition.project(), &state).is_err(),
            "Untrusted path accepted {label}"
        );
        assert!(
            Session::restore_with_definition(definition.clone(), state.clone()).is_err(),
            "Restore accepted {label}"
        );
        assert!(
            session.replace_state(state).is_err(),
            "Replacement accepted {label}"
        );
        assert_eq!(
            session.state(),
            &before,
            "Rejected {label} changed current state"
        );
    }
    definition.validate_state(session.state()).unwrap();
}

#[test]
fn replacing_state_preserves_progress_without_replaying_events_or_watches() {
    let mut project = project();
    project
        .game
        .variables
        .insert("health".into(), Value::Integer(10));
    project.game.triggers.push(Trigger {
        id: "health-watch".into(),
        watch: Some(TriggerWatch {
            target: ValueTarget::Variable {
                name: "health".into(),
            },
            mode: WatchMode::BecomesTrue,
        }),
        condition: Condition::Variable {
            name: "health".into(),
            op: Comparison::Eq,
            value: Value::Integer(0),
        },
        effects: vec![Effect::End {
            ending: "finish".into(),
        }],
        ..Default::default()
    });
    project.game.triggers.push(Trigger {
        id: "ending-score".into(),
        event: Event::Ending,
        effects: vec![Effect::UpdateVariable {
            name: "score".into(),
            op: ArithmeticOperation::Add,
            operand: NumericOperand::Literal { value: 100 },
        }],
        ..Default::default()
    });
    for (name, value) in [("heal", 5), ("hurt", 0)] {
        project.game.actions.push(Action {
            id: name.into(),
            verb: "use".into(),
            pattern: vec![PatternPart::Literal { text: name.into() }],
            effects: vec![Effect::SetVariable {
                name: "health".into(),
                value: Value::Integer(value),
            }],
            ..Default::default()
        });
    }
    let (mut session, _) = Session::start(project, None).unwrap();
    let mut edited = session.state().clone();
    edited.variables.insert("health".into(), Value::Integer(0));
    edited.sequences.insert("responses".into(), 2);
    edited.hints.insert(
        "clues".into(),
        HintProgress {
            clues_seen: 1,
            solution_seen: false,
        },
    );
    edited.objects.get_mut("key").unwrap().placement = Placement::Character {
        character: "keeper".into(),
    };
    session.replace_state(edited.clone()).unwrap();
    assert_eq!(session.state(), &edited);
    session.description().unwrap();
    session.resume_messages().unwrap();
    assert!(session.test_condition(&Condition::Variable {
        name: "health".into(),
        op: Comparison::Eq,
        value: Value::Integer(0)
    }));
    assert_eq!(session.state(), &edited);
    assert_eq!(session.state().variables["score"], Value::Integer(1));
    assert_eq!(session.state().visits["room"], 1);
    assert!(session.state().ending.is_none());

    let mut completed = edited.clone();
    completed.ending = Some("finish".into());
    session.replace_state(completed.clone()).unwrap();
    assert_eq!(session.state(), &completed);
    session.resume_messages().unwrap();
    assert_eq!(session.state().variables["score"], Value::Integer(1));
    session.replace_state(edited).unwrap();
    session.command("use heal").unwrap();
    session.command("use hurt").unwrap();
    assert_eq!(session.state().ending.as_deref(), Some("finish"));
    assert_eq!(session.state().variables["score"], Value::Integer(101));
    let expected = session.state().clone();
    let definition = session.definition().clone();
    let consumed = session.into_state();
    assert_eq!(consumed, expected);
    definition.validate_state(&consumed).unwrap();
}

#[test]
fn cached_response_bounds_retain_every_mode_and_exhaustion_boundary() {
    for mode in [
        SequenceMode::Loop,
        SequenceMode::RepeatLast,
        SequenceMode::Fallback,
    ] {
        for follow_up in [false, true] {
            let mut project = project();
            let Effect::Respond {
                mode: authored,
                on_exhausted,
                ..
            } = &mut project.game.actions[0].effects[0]
            else {
                unreachable!()
            };
            *authored = mode.clone();
            if !follow_up {
                on_exhausted.clear();
            }
            let (session, _) = Session::start(project, None).unwrap();
            let maximum = if mode == SequenceMode::Fallback {
                2 + usize::from(follow_up)
            } else {
                1
            };
            let mut state = session.state().clone();
            for cursor in 0..=maximum + 1 {
                state.sequences.insert("responses".into(), cursor);
                assert_eq!(
                    session.definition().validate_state(&state).is_ok(),
                    cursor <= maximum,
                    "{mode:?}, follow_up={follow_up}, cursor={cursor}"
                );
            }
        }
    }
}
