//! Shared runtime behaviour regressions.
use super::*;
use luna_model::*;
#[test]
fn print_description_uses_current_descriptions_for_every_entity_kind() {
    let mut p = Project::blank("Descriptions");
    p.objects.push(Object {
        id: "coin".into(),
        name: "coin".into(),
        description: "Old description".into(),
        placement: Placement::Location {
            location: p.game.starting_location.clone(),
        },
        actions: vec![description_action("coin")],
        ..Default::default()
    });
    p.characters.push(Character {
        id: "keeper".into(),
        name: "keeper".into(),
        description: "An attentive keeper.".into(),
        location: p.game.starting_location.clone(),
        actions: vec![description_action("keeper")],
        ..Default::default()
    });
    let (mut s, _) = Session::start(p, None).unwrap();
    let mut project = s.project().clone();
    project.objects[0].description = "A <green>gleaming</green> coin.".into();
    s = Session::restore(project, s.state).unwrap();
    assert_eq!(
        output(s.command("inspect the coin").unwrap()),
        "A gleaming coin."
    );
    assert_eq!(
        output(s.command("examine keeper").unwrap()),
        "An attentive keeper."
    );
    assert_eq!(
        output(s.command("look at the starting location").unwrap()),
        "Your adventure begins here."
    );
    let mut project = s.project().clone();
    project.objects[0].description.clear();
    s = Session::restore(project, s.state).unwrap();
    let result = s.command("inspect coin").unwrap();
    assert!(result.messages.is_empty());
    assert!(!result.state_changed);
}
#[test]
fn messages_expand_live_variables_properties_and_sequences() {
    let mut p = Project::blank("Messages");
    let room = p.locations[0].id.clone();
    p.game.variables.insert("chances".into(), Value::Integer(3));
    p.game.variables.insert("ready".into(), Value::Bool(true));
    p.game
        .variables
        .insert("word".into(), Value::Text("<red>& %chances%</red>".into()));
    p.locations[0]
        .state
        .insert("charges".into(), Value::Integer(7));
    p.locations[0].description = "Current chances: %chances%.".into();
    p.game.actions.push(Action {
        id: "pull-lever".into(),
        verb: "pull".into(),
        pattern: vec![PatternPart::Literal {
            text: "lever".into(),
        }],
        effects: vec![
            Effect::Say {
                text: format!("<green>%chances% / %{room}.charges% / %ready% / %word%</green>"),
            },
            Effect::SetVariable {
                name: "chances".into(),
                value: Value::Integer(1),
            },
            Effect::SetProperty {
                entity: room.clone(),
                name: "charges".into(),
                value: Value::Integer(5),
            },
            Effect::Respond {
                id: "replies".into(),
                responses: vec![format!("%chances% / %{room}.charges%")],
                mode: SequenceMode::Fallback,
                fallback: "No more than %chances%.".into(),
                exhaustion: ExhaustionMode::Once,
                on_exhausted: vec![],
            },
            Effect::PrintDescription { entity: room },
        ],
        ..Default::default()
    });
    let (mut s, _) = Session::start(p, None).unwrap();
    let r = s.command("pull lever").unwrap();
    assert_eq!(
        r.messages[0],
        vec![text::Span {
            text: "3 / 7 / true / <red>& %chances%</red>".into(),
            colour: Some("green".into())
        }]
    );
    assert_eq!(text::plain(&r.messages[1]), "1 / 5");
    assert_eq!(text::plain(&r.messages[2]), "Current chances: 1.");
    let state = s.state.clone();
    let mut restored =
        Session::restore_with_definition(s.definition().clone(), state.clone()).unwrap();
    assert_eq!(
        text::plain(&restored.command("pull lever").unwrap().messages[1]),
        "No more than 1."
    );
    let mut invalid = s.project().clone();
    invalid.game.actions[0].effects = vec![
        Effect::SetVariable {
            name: "chances".into(),
            value: Value::Integer(99),
        },
        Effect::Say {
            text: "%deleted%".into(),
        },
    ];
    assert!(GameDefinition::new(invalid).is_err());
    assert_eq!(s.state, state);
}
#[test]
fn optional_entity_words_apply_to_names_aliases_characters_and_locations() {
    let mut p = world();
    p.objects[0].name = "The old painting".into();
    p.objects[0].aliases.push("the portrait".into());
    p.objects[0].actions[0].effects = vec![Effect::Say {
        text: "Painting".into(),
    }];
    let location = p.game.starting_location.clone();
    p.locations[0].actions = vec![Action {
        id: "inspect-room".into(),
        verb: "examine".into(),
        pattern: vec![PatternPart::Entity {
            entity: location.clone(),
        }],
        effects: vec![Effect::Say {
            text: "Room".into(),
        }],
        ..Default::default()
    }];
    p.characters.push(Character {
        id: "keeper".into(),
        name: "The Keeper".into(),
        location,
        actions: vec![Action {
            id: "talk-keeper".into(),
            verb: "talk".into(),
            pattern: vec![PatternPart::Entity {
                entity: "keeper".into(),
            }],
            effects: vec![Effect::Say {
                text: "Hello".into(),
            }],
            ..Default::default()
        }],
        ..Default::default()
    });
    let (mut session, _) = Session::start(p, None).unwrap();
    for command in [
        "inspect painting",
        "inspect THE painting",
        "look at an old painting",
        "inspect portrait",
        "inspect the portrait",
    ] {
        assert_eq!(
            output(session.command(command).unwrap()),
            "Painting",
            "{command}"
        );
    }
    assert_eq!(
        output(session.command("speak to the keeper").unwrap()),
        "Hello"
    );
    assert_eq!(
        output(session.command("inspect the starting location").unwrap()),
        "Room"
    );
    session.state.objects.get_mut("painting").unwrap().hidden = true;
    assert_eq!(
        session.command("inspect the painting").unwrap().status,
        "unmatched"
    );
}
#[test]
fn optional_words_work_at_each_entity_boundary_without_removing_literals() {
    let mut p = Project::blank("Place");
    p.game.ignored_words.push("on".into());
    p.vocabulary.push(Verb {
        id: "place".into(),
        canonical: "place".into(),
        synonyms: vec![],
        event: None,
    });
    for (id, name) in [("book", "The book of the moon"), ("table", "table")] {
        p.objects.push(Object {
            id: id.into(),
            name: name.into(),
            aliases: vec![id.into()],
            placement: Placement::Inventory,
            ..Default::default()
        });
    }
    p.game.actions.push(Action {
        id: "place-book".into(),
        verb: "place".into(),
        pattern: vec![
            PatternPart::Entity {
                entity: "book".into(),
            },
            PatternPart::Literal { text: "on".into() },
            PatternPart::Entity {
                entity: "table".into(),
            },
        ],
        effects: vec![Effect::Say {
            text: "Placed".into(),
        }],
        ..Default::default()
    });
    let (mut session, _) = Session::start(p, None).unwrap();
    for command in [
        "place book on table",
        "place the book on the table",
        "place the book of the moon on a table",
    ] {
        assert_eq!(
            output(session.command(command).unwrap()),
            "Placed",
            "{command}"
        );
    }
    for command in [
        "the place book on table",
        "place book the on table",
        "place book table",
        "place book on table the",
        "place book of moon on table",
    ] {
        assert_eq!(
            session.command(command).unwrap().status,
            "unmatched",
            "{command}"
        );
    }
}
#[test]
fn optional_words_apply_to_named_routes_and_explicit_destination_patterns() {
    for explicit in [false, true] {
        let mut p = world();
        p.locations.push(Location {
            id: "garden".into(),
            name: "The garden".into(),
            aliases: vec!["the courtyard".into()],
            ..Default::default()
        });
        p.locations[0].exits.push(Exit {
            id: "garden-route".into(),
            name: "the garden".into(),
            aliases: vec!["courtyard".into()],
            verb: "go".into(),
            destination: "garden".into(),
            pattern: if explicit {
                vec![PatternPart::Entity {
                    entity: "garden".into(),
                }]
            } else {
                vec![]
            },
            ..Default::default()
        });
        for command in [
            "go garden",
            "go the garden",
            "go courtyard",
            "go the courtyard",
        ] {
            let (mut session, _) = Session::start(p.clone(), None).unwrap();
            assert_eq!(session.command(command).unwrap().status, "ok", "{command}");
            assert_eq!(session.state.location, "garden", "{command}");
        }
    }
}
#[test]
fn configurable_ignored_words_preserve_ambiguity_and_host_control_text() {
    let mut p = world();
    p.game.ignored_words = vec!["this".into()];
    let (mut session, _) = Session::start(p.clone(), None).unwrap();
    assert_eq!(
        output(session.command("inspect this painting").unwrap()),
        "First"
    );
    assert_eq!(
        session.command("inspect the painting").unwrap().status,
        "unmatched"
    );
    p.game.ignored_words.clear();
    let (mut session, _) = Session::start(p, None).unwrap();
    assert_eq!(
        session.command("inspect this painting").unwrap().status,
        "unmatched"
    );
    assert_eq!(
        output(session.command("inspect painting").unwrap()),
        "First"
    );
    assert_eq!(
        session.command("save the garden").unwrap().control,
        Some(HostControl::Save {
            name: Some("the garden".into())
        })
    );
    let mut p = world();
    let mut other = p.objects[0].clone();
    other.id = "other".into();
    other.name = "the painting".into();
    other.aliases.clear();
    other.actions[0].id = "inspect-other".into();
    other.actions[0].pattern = vec![PatternPart::Entity {
        entity: "other".into(),
    }];
    other.actions[0].effects = vec![Effect::Say {
        text: "Other".into(),
    }];
    p.objects.push(other);
    let (mut session, _) = Session::start(p, None).unwrap();
    let before = session.state.clone();
    assert_eq!(
        session.command("inspect the painting").unwrap().status,
        "ambiguous"
    );
    assert_eq!(session.state, before);
}
#[test]
fn named_exits_bind_destination_aliases_without_exposing_remote_objects() {
    let mut p = world();
    p.locations.push(Location {
        id: "garden".into(),
        name: "Garden".into(),
        aliases: vec!["sunlit garden".into()],
        ..Default::default()
    });
    p.locations[0].exits.push(Exit {
        id: "garden-route".into(),
        name: "garden route".into(),
        verb: "go".into(),
        pattern: vec![PatternPart::Entity {
            entity: "garden".into(),
        }],
        destination: "garden".into(),
        ..Default::default()
    });
    let (mut s, _) = Session::start(p, None).unwrap();
    s.command("go sunlit garden").unwrap();
    assert_eq!(s.state.location, "garden");
    assert_eq!(s.command("examine painting").unwrap().status, "unmatched");
}
#[test]
fn looping_and_fallback_sequences() {
    for (mode, expected) in [
        (SequenceMode::Loop, ["First", "Second", "First", "Second"]),
        (
            SequenceMode::Fallback,
            ["First", "Second", "Fallback", "Fallback"],
        ),
    ] {
        let mut p = world();
        if let Effect::Respond {
            mode: target,
            fallback,
            ..
        } = &mut p.objects[0].actions[0].effects[0]
        {
            *target = mode;
            *fallback = "Fallback".into();
        }
        let (mut session, _) = Session::start(p, None).unwrap();
        for text in expected {
            assert_eq!(output(session.command("examine painting").unwrap()), text);
        }
        Session::restore_with_definition(session.definition().clone(), session.state.clone())
            .unwrap();
    }
}
#[test]
fn combinations_preserve_or_consume_each_input() {
    for consume_first in [false, true] {
        let mut p = Project::blank("Combine");
        for (id, placement) in [
            ("a", Placement::Inventory),
            ("b", Placement::Inventory),
            ("result", Placement::Absent),
        ] {
            p.objects.push(Object {
                id: id.into(),
                name: id.into(),
                placement,
                ..Default::default()
            });
        }
        p.game.actions.push(Action {
            id: "combine-action".into(),
            verb: "use".into(),
            pattern: vec![
                PatternPart::Entity { entity: "a".into() },
                PatternPart::Literal { text: "on".into() },
                PatternPart::Entity { entity: "b".into() },
            ],
            effects: vec![Effect::Combine {
                first: "a".into(),
                second: "b".into(),
                consume_first,
                consume_second: true,
                result: "result".into(),
            }],
            ..Default::default()
        });
        let (mut session, _) = Session::start(p, None).unwrap();
        session.command("use a on b").unwrap();
        assert_eq!(session.state.objects["a"].consumed, consume_first);
        assert!(session.state.objects["b"].consumed);
        assert!(!session.state.objects["b"].exists);
        assert_eq!(
            session.state.objects["result"].placement,
            Placement::Inventory
        );
        let state: GameState =
            serde_json::from_slice(&serde_json::to_vec(&session.state).unwrap()).unwrap();
        assert_eq!(
            Session::restore_with_definition(session.definition().clone(), state)
                .unwrap()
                .state,
            session.state
        );
    }
}
#[test]
fn first_entries_repeat_entries_and_look() {
    let mut p = world();
    let start = p.game.starting_location.clone();
    p.locations.push(Location {
        id: "garden".into(),
        name: "Garden".into(),
        ..Default::default()
    });
    p.locations[0].exits.push(Exit {
        id: "east".into(),
        name: "east".into(),
        verb: "go".into(),
        destination: "garden".into(),
        ..Default::default()
    });
    p.locations[1].exits.push(Exit {
        id: "west".into(),
        name: "west".into(),
        verb: "go".into(),
        destination: start.clone(),
        ..Default::default()
    });
    for (id, event, text) in [
        ("first", Event::FirstEnter, "First visit"),
        ("every", Event::Enter, "Every visit"),
    ] {
        p.locations[0].triggers.push(Trigger {
            id: id.into(),
            event,
            effects: vec![Effect::Say { text: text.into() }],
            ..Default::default()
        });
    }
    let (mut session, initial) = Session::start(p, None).unwrap();
    assert!(output(initial).contains("First visit"));
    let state = session.state.clone();
    assert!(!output(session.command("look").unwrap()).contains("visit"));
    assert_eq!(session.state, state);
    session.command("go east").unwrap();
    let back = output(session.command("go west").unwrap());
    assert!(back.contains("Every visit"));
    assert!(!back.contains("First visit"));
    assert_eq!(session.state.visits[&start], 2);
}
#[test]
fn parser_scope_priority_and_specificity() {
    let mut p = world();
    p.objects[0].actions[0].effects = vec![Effect::Say {
        text: "object".into(),
    }];
    let mut global = p.objects[0].actions[0].clone();
    global.id = "global".into();
    global.priority = 99;
    global.effects = vec![Effect::Say {
        text: "global".into(),
    }];
    p.game.actions.push(global);
    let (mut session, _) = Session::start(p.clone(), None).unwrap();
    assert_eq!(
        output(session.command("examine painting").unwrap()),
        "object"
    );
    let mut higher = p.objects[0].actions[0].clone();
    higher.id = "higher".into();
    higher.priority = 1;
    higher.effects = vec![Effect::Say {
        text: "higher".into(),
    }];
    p.objects[0].actions.push(higher);
    let (mut session, _) = Session::start(p.clone(), None).unwrap();
    assert_eq!(
        output(session.command("examine painting").unwrap()),
        "higher"
    );
    p.game.actions[0].pattern = vec![PatternPart::Literal {
        text: "painting".into(),
    }];
    let (mut session, _) = Session::start(p, None).unwrap();
    assert_eq!(
        output(session.command("examine painting").unwrap()),
        "global"
    );
}
fn world() -> Project {
    let mut p = Project::blank("Test");
    let mut o = Object {
        id: "painting".into(),
        name: "old painting".into(),
        aliases: vec!["painting".into()],
        placement: Placement::Location {
            location: p.game.starting_location.clone(),
        },
        ..Default::default()
    };
    o.actions.push(Action {
        id: "examine-painting".into(),
        name: "Examine painting".into(),
        verb: "examine".into(),
        pattern: vec![PatternPart::Entity {
            entity: o.id.clone(),
        }],
        effects: vec![Effect::Respond {
            id: "replies".into(),
            responses: vec!["First".into(), "Second".into()],
            mode: SequenceMode::RepeatLast,
            fallback: String::new(),
            exhaustion: ExhaustionMode::Once,
            on_exhausted: vec![],
        }],
        ..Default::default()
    });
    p.objects.push(o);
    p
}
fn output(r: CommandResult) -> String {
    r.messages
        .iter()
        .map(|m| text::plain(m))
        .collect::<Vec<_>>()
        .join("\n")
}
#[test]
fn responses_restore_and_inspection() {
    let (mut s, _) = Session::start(world(), None).unwrap();
    assert_eq!(output(s.command("INSPECT, painting!").unwrap()), "First");
    let saved = s.state.clone();
    let mut loaded = Session::restore_with_definition(s.definition().clone(), saved).unwrap();
    assert_eq!(
        output(loaded.command("look at old painting").unwrap()),
        "Second"
    );
    assert!(!loaded.command("examine painting").unwrap().state_changed);
    let old = loaded.state.clone();
    loaded.command("look").unwrap();
    assert_eq!(old, loaded.state);
}
#[test]
fn ties_and_failures_have_no_side_effects() {
    let mut p = world();
    let mut a = p.objects[0].actions[0].clone();
    a.id = "duplicate".into();
    a.effects = vec![Effect::Say {
        text: "Other".into(),
    }];
    p.objects[0].actions.push(a);
    let (mut s, _) = Session::start(p, None).unwrap();
    let before = s.state.clone();
    assert_eq!(s.command("examine painting").unwrap().status, "ambiguous");
    assert_eq!(before, s.state);
    assert!(!s.command("unknown").unwrap().state_changed);
}
#[test]
fn cycles_roll_back_output_and_state() {
    let mut p = world();
    let a = p.game.starting_location.clone();
    p.locations.push(Location {
        id: "other".into(),
        name: "Other".into(),
        ..Default::default()
    });
    for (i, to) in [(0, "other".to_owned()), (1, a)] {
        p.locations[i].triggers.push(Trigger {
            id: format!("cycle-{i}"),
            event: Event::Enter,
            effects: vec![Effect::Move { location: to }],
            ..Default::default()
        })
    }
    assert!(Session::start(p, None).is_err());
    let mut p = world();
    p.locations.push(Location {
        id: "other".into(),
        name: "Other".into(),
        triggers: vec![Trigger {
            id: "self-cycle".into(),
            event: Event::Enter,
            effects: vec![Effect::Move {
                location: "other".into(),
            }],
            ..Default::default()
        }],
        ..Default::default()
    });
    p.objects[0].actions[0].effects = vec![
        Effect::Say {
            text: "discard me".into(),
        },
        Effect::Move {
            location: "other".into(),
        },
    ];
    let (mut s, _) = Session::start(p, None).unwrap();
    let old = s.state.clone();
    assert!(s.command("examine painting").is_err());
    assert_eq!(old, s.state);
}
#[test]
fn failed_requirements_do_not_fall_through() {
    let mut p = world();
    p.objects[0].actions[0].requirements = Condition::False;
    p.objects[0].actions[0].failure_text = "No.".into();
    let (mut s, _) = Session::start(p, None).unwrap();
    let old = s.state.clone();
    assert_eq!(output(s.command("examine painting").unwrap()), "No.");
    assert_eq!(old, s.state);
}
#[test]
fn full_state_validation() {
    let (mut s, _) = Session::start(world(), None).unwrap();
    s.state.sequences.insert("replies".into(), usize::MAX);
    assert!(validate_state(s.project(), &s.state).is_err())
}
