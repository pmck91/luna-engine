use luna_core::{Session, validate_state};
use luna_model::*;

fn held(character: &str) -> Placement {
    Placement::Character {
        character: character.into(),
    }
}
fn give(character: &str) -> Effect {
    Effect::GiveCharacter {
        object: "key".into(),
        character: character.into(),
    }
}
fn world(effects: Vec<Effect>) -> Project {
    let mut p = Project::blank("Inventories");
    p.locations.push(Location {
        id: "garden".into(),
        name: "Garden".into(),
        ..Default::default()
    });
    for (id, name) in [("keeper", "Keeper"), ("gardener", "Gardener")] {
        p.characters.push(Character {
            id: id.into(),
            name: name.into(),
            location: p.game.starting_location.clone(),
            actions: vec![description_action(id)],
            ..Default::default()
        });
    }
    let mut key = Object {
        id: "key".into(),
        name: "brass key".into(),
        aliases: vec!["key".into()],
        portable: true,
        description: "A brass key.".into(),
        placement: held("keeper"),
        ..Default::default()
    };
    key.actions = starter_actions(&key);
    p.objects.push(key);
    p.game.actions.push(Action {
        id: "transfer".into(),
        verb: "use".into(),
        pattern: vec![PatternPart::Literal {
            text: "transfer".into(),
        }],
        effects,
        ..Default::default()
    });
    p.game.actions.push(Action {
        id: "check".into(),
        verb: "use".into(),
        pattern: vec![PatternPart::Literal {
            text: "check".into(),
        }],
        effects: vec![
            Effect::If {
                condition: Condition::CharacterCarrying {
                    character: "keeper".into(),
                    object: "key".into(),
                },
                then: vec![Effect::Say {
                    text: "Keeper holds key.".into(),
                }],
                otherwise: vec![Effect::Say {
                    text: "Keeper has no key.".into(),
                }],
            },
            Effect::If {
                condition: Condition::Carrying {
                    object: "key".into(),
                },
                then: vec![Effect::Say {
                    text: "Player holds key.".into(),
                }],
                otherwise: vec![],
            },
        ],
        ..Default::default()
    });
    p
}
fn output(session: &mut Session, command: &str) -> String {
    session
        .command(command)
        .unwrap()
        .messages
        .iter()
        .map(|m| text::plain(m))
        .collect::<Vec<_>>()
        .join("\n")
}

#[test]
fn characters_own_items_without_exposing_them_to_player_commands() {
    let (mut session, initial) = Session::start(
        world(vec![Effect::Give {
            object: "key".into(),
        }]),
        None,
    )
    .unwrap();
    assert_eq!(session.state.objects["key"].placement, held("keeper"));
    assert!(
        initial
            .messages
            .iter()
            .all(|m| !text::plain(m).contains("brass key"))
    );
    assert_eq!(
        output(&mut session, "inventory"),
        "You are carrying nothing."
    );
    assert_eq!(output(&mut session, "use check"), "Keeper holds key.");
    for command in ["examine key", "take key"] {
        let before = session.state.clone();
        let result = session.command(command).unwrap();
        assert_eq!(result.status, "unmatched");
        assert_eq!(session.state, before);
    }
    output(&mut session, "use transfer");
    assert_eq!(
        output(&mut session, "use check"),
        "Keeper has no key.\nPlayer holds key."
    );
    assert_eq!(
        output(&mut session, "inventory"),
        "You are carrying: brass key."
    );
    assert_eq!(output(&mut session, "examine key"), "A brass key.");
}

#[test]
fn every_transfer_replaces_the_single_owner_and_removal_has_an_explicit_destination() {
    for source in [
        held("keeper"),
        held("gardener"),
        Placement::Inventory,
        Placement::Location {
            location: "garden".into(),
        },
        Placement::Absent,
    ] {
        for (effect, expected, consumed) in [
            (give("keeper"), held("keeper"), false),
            (give("gardener"), held("gardener"), false),
            (
                Effect::Give {
                    object: "key".into(),
                },
                Placement::Inventory,
                false,
            ),
            (
                Effect::Place {
                    object: "key".into(),
                    location: "garden".into(),
                },
                Placement::Location {
                    location: "garden".into(),
                },
                false,
            ),
            (
                Effect::Remove {
                    object: "key".into(),
                },
                Placement::Absent,
                false,
            ),
            (
                Effect::Consume {
                    object: "key".into(),
                },
                Placement::Absent,
                true,
            ),
        ] {
            let mut p = world(vec![effect]);
            p.objects[0].placement = source.clone();
            let (mut s, _) = Session::start(p, None).unwrap();
            output(&mut s, "use transfer");
            assert_eq!(s.state.objects["key"].placement, expected);
            assert_eq!(s.state.objects["key"].exists, expected != Placement::Absent);
            assert_eq!(s.state.objects["key"].consumed, consumed);
            validate_state(s.project(), &s.state).unwrap();
        }
    }
    let (mut s, _) = Session::start(
        world(vec![Effect::Place {
            object: "key".into(),
            location: "@current".into(),
        }]),
        None,
    )
    .unwrap();
    output(&mut s, "use transfer");
    assert_eq!(
        s.state.objects["key"].placement,
        Placement::Location {
            location: s.state.location.clone()
        }
    );
}

#[test]
fn carrying_uses_live_ownership_independently_of_character_visibility_or_location() {
    let mut p = world(vec![give("keeper")]);
    p.characters[0].location = "garden".into();
    p.characters[0].hidden = true;
    let (mut s, _) = Session::start(p, None).unwrap();
    assert_eq!(output(&mut s, "use check"), "Keeper holds key.");
    s.state.characters.get_mut("keeper").unwrap().location = s.state.location.clone();
    assert_eq!(s.state.objects["key"].placement, held("keeper"));
    let mut project = s.project().clone();
    project.game.actions[0].effects = vec![Effect::Consume {
        object: "key".into(),
    }];
    s = Session::restore(project, s.state).unwrap();
    output(&mut s, "use transfer");
    assert_eq!(output(&mut s, "use check"), "Keeper has no key.");
    let mut project = s.project().clone();
    project.game.actions[0].effects = vec![give("keeper")];
    s = Session::restore(project, s.state).unwrap();
    output(&mut s, "use transfer");
    assert_eq!(output(&mut s, "use check"), "Keeper holds key.");
}

#[test]
fn take_and_drop_events_track_only_transfers_across_the_player_inventory() {
    let mut p = world(vec![
        give("gardener"),
        Effect::Give {
            object: "key".into(),
        },
        Effect::Give {
            object: "key".into(),
        },
        give("keeper"),
        give("keeper"),
        Effect::Place {
            object: "key".into(),
            location: "@current".into(),
        },
    ]);
    for (name, event) in [("takes", Event::Take), ("drops", Event::Drop)] {
        p.game.variables.insert(name.into(), Value::Integer(0));
        p.objects[0].triggers.push(Trigger {
            id: name.into(),
            event,
            effects: vec![Effect::UpdateVariable {
                name: name.into(),
                op: ArithmeticOperation::Add,
                operand: NumericOperand::Literal { value: 1 },
            }],
            ..Default::default()
        });
    }
    let (mut s, _) = Session::start(p, None).unwrap();
    output(&mut s, "use transfer");
    assert_eq!(s.state.variables["takes"], Value::Integer(1));
    assert_eq!(s.state.variables["drops"], Value::Integer(1));
}

#[test]
fn failed_commands_rollback_transfers_and_trigger_changes() {
    let mut p = world(vec![
        Effect::Give {
            object: "key".into(),
        },
        give("gardener"),
        Effect::Say {
            text: "Discard me".into(),
        },
        Effect::UpdateVariable {
            name: "count".into(),
            op: ArithmeticOperation::Divide,
            operand: NumericOperand::Variable {
                name: "zero".into(),
            },
        },
    ]);
    p.game.variables = [
        ("count".into(), Value::Integer(2)),
        ("zero".into(), Value::Integer(0)),
    ]
    .into();
    p.objects[0].triggers.push(Trigger {
        id: "take-changes-count".into(),
        event: Event::Take,
        effects: vec![Effect::SetVariable {
            name: "count".into(),
            value: Value::Integer(42),
        }],
        ..Default::default()
    });
    let (mut s, _) = Session::start(p, None).unwrap();
    let before = s.state.clone();
    assert!(s.command("use transfer").is_err());
    assert_eq!(s.state, before);
    assert_eq!(output(&mut s, "use check"), "Keeper holds key.");
}

#[test]
fn invalid_owners_and_inconsistent_saves_are_rejected() {
    let p = world(vec![]);
    for effect in [
        Effect::GiveCharacter {
            object: "key".into(),
            character: "key".into(),
        },
        Effect::GiveCharacter {
            object: "missing".into(),
            character: "keeper".into(),
        },
        Effect::If {
            condition: Condition::CharacterCarrying {
                character: "missing".into(),
                object: "key".into(),
            },
            then: vec![],
            otherwise: vec![],
        },
    ] {
        let bad = world(vec![effect]);
        assert!(has_errors(&validate(&bad)));
    }
    let mut bad = p.clone();
    bad.objects[0].placement = held("missing");
    assert!(has_errors(&validate(&bad)));
    let (s, _) = Session::start(p.clone(), None).unwrap();
    for (placement, exists, consumed) in [
        (held("missing"), true, false),
        (Placement::Absent, true, false),
        (held("keeper"), false, false),
        (held("keeper"), true, true),
    ] {
        let mut state = s.state.clone();
        let item = state.objects.get_mut("key").unwrap();
        item.placement = placement;
        item.exists = exists;
        item.consumed = consumed;
        assert!(validate_state(&p, &state).is_err());
    }
}

#[test]
fn old_placement_and_carrying_content_round_trips_unchanged() {
    for encoded in [
        r#"{"type":"inventory"}"#,
        r#"{"type":"absent"}"#,
        r#"{"type":"location","location":"garden"}"#,
    ] {
        let placement: Placement = serde_json::from_str(encoded).unwrap();
        assert_eq!(
            serde_json::to_value(placement).unwrap(),
            serde_json::from_str::<serde_json::Value>(encoded).unwrap()
        );
    }
    let carrying: Condition =
        serde_json::from_str(r#"{"type":"carrying","object":"key"}"#).unwrap();
    assert_eq!(
        carrying,
        Condition::Carrying {
            object: "key".into()
        }
    );
}
