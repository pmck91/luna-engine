use luna_core::{Session, validate_state};
use luna_model::*;

fn movement(location: &str) -> Effect {
    Effect::MoveCharacter {
        character: "keeper".into(),
        location: location.into(),
    }
}
fn speech(message: &str) -> Effect {
    Effect::CharacterSays {
        character: "keeper".into(),
        text: message.into(),
    }
}
fn world(effects: Vec<Effect>) -> Project {
    let mut p = Project::blank("Character effects");
    p.game.variables.insert("chances".into(), Value::Integer(3));
    p.locations.push(Location {
        id: "garden".into(),
        name: "Garden".into(),
        ..Default::default()
    });
    p.characters.push(Character {
        id: "keeper".into(),
        name: "Keeper".into(),
        name_colour: Some("yellow".into()),
        description: "An attentive keeper.".into(),
        location: p.game.starting_location.clone(),
        state: [("health".into(), Value::Integer(7))].into(),
        actions: vec![description_action("keeper")],
        ..Default::default()
    });
    let mut key = Object {
        id: "key".into(),
        name: "brass key".into(),
        aliases: vec!["key".into()],
        portable: true,
        placement: Placement::Character {
            character: "keeper".into(),
        },
        ..Default::default()
    };
    key.actions = starter_actions(&key);
    p.objects.push(key);
    for (id, effects) in [
        ("scene", effects),
        ("recall", vec![movement("@current")]),
        (
            "follow",
            vec![Effect::Move {
                location: "garden".into(),
            }],
        ),
    ] {
        p.game.actions.push(Action {
            id: id.into(),
            verb: "use".into(),
            pattern: vec![PatternPart::Literal { text: id.into() }],
            effects,
            ..Default::default()
        });
    }
    p
}

#[test]
fn movement_changes_command_scope_preserves_ownership_and_restores_without_events() {
    let p = world(vec![movement("garden")]);
    let (mut session, _) = Session::start(p, None).unwrap();
    assert_eq!(session.command("examine Keeper").unwrap().status, "ok");
    let player = session.state.location.clone();
    let visits = session.state.visits.clone();
    let key = session.state.objects["key"].clone();
    let result = session.command("use scene").unwrap();
    assert!(result.state_changed);
    assert!(result.messages.is_empty());
    assert_eq!(session.state.characters["keeper"].location, "garden");
    assert_eq!(session.state.location, player);
    assert_eq!(session.state.visits, visits);
    assert_eq!(session.state.objects["key"], key);
    assert_eq!(
        session.command("examine Keeper").unwrap().status,
        "unmatched"
    );
    assert_eq!(session.command("take key").unwrap().status, "unmatched");
    assert!(!session.command("use scene").unwrap().state_changed);

    let encoded = serde_json::to_vec(&session.state).unwrap();
    let saved = serde_json::from_slice(&encoded).unwrap();
    validate_state(&session.project, &saved).unwrap();
    session = Session::restore(session.project, saved).unwrap();
    assert_eq!(session.state.characters["keeper"].location, "garden");
    assert_eq!(session.state.objects["key"], key);
    session.command("use follow").unwrap();
    assert_eq!(session.command("examine Keeper").unwrap().status, "ok");
    assert_eq!(session.command("take key").unwrap().status, "unmatched");

    // @current is resolved when the effect executes, including earlier player moves.
    session.project.game.actions[0].effects = vec![
        Effect::Move {
            location: player.clone(),
        },
        movement("@current"),
    ];
    session.command("use scene").unwrap();
    assert_eq!(session.state.characters["keeper"].location, player);
    assert_eq!(session.command("examine Keeper").unwrap().status, "ok");
}

#[test]
fn movement_and_speech_do_not_fire_player_movement_inventory_or_speak_events() {
    let mut p = world(vec![
        movement("garden"),
        speech("Goodbye."),
        movement("@current"),
    ]);
    p.game.variables.insert("events".into(), Value::Integer(0));
    for (index, event) in [
        Event::Enter,
        Event::FirstEnter,
        Event::Leave,
        Event::Take,
        Event::Drop,
        Event::Speak,
    ]
    .into_iter()
    .enumerate()
    {
        let trigger = Trigger {
            id: format!("event-{index}"),
            event,
            effects: vec![Effect::UpdateVariable {
                name: "events".into(),
                op: ArithmeticOperation::Add,
                operand: NumericOperand::Literal { value: 1 },
            }],
            ..Default::default()
        };
        p.game.triggers.push(trigger.clone());
        p.characters[0].triggers.push(Trigger {
            id: format!("character-{index}"),
            ..trigger
        });
    }
    let (mut session, _) = Session::start(p, None).unwrap();
    let events = session.state.variables["events"].clone();
    let visits = session.state.visits.clone();
    let result = session.command("use scene").unwrap();
    assert_eq!(
        result
            .messages
            .iter()
            .map(|s| text::plain(s))
            .collect::<Vec<_>>(),
        ["Keeper says: Goodbye."]
    );
    assert_eq!(session.state.variables["events"], events);
    assert_eq!(session.state.visits, visits);
    assert!(
        result
            .trace
            .iter()
            .all(|line| !line.starts_with("Trigger "))
    );
    session.state.characters.get_mut("keeper").unwrap().hidden = true;
    session.command("use scene").unwrap();
    assert!(session.state.characters["keeper"].hidden);
}

#[test]
fn speech_uses_literal_current_names_independent_colours_and_live_message_values() {
    for colour in std::iter::once(None).chain(text::COLOURS.iter().copied().map(Some)) {
        let mut p = world(vec![
            Effect::SetVariable {
                name: "chances".into(),
                value: Value::Integer(5),
            },
            Effect::SetProperty {
                entity: "keeper".into(),
                name: "health".into(),
                value: Value::Integer(9),
            },
            speech("<green>%chances% chances; %keeper.health%; %words%</green> %%name%%."),
        ]);
        p.characters[0].name = "Keeper <&> %chances%".into();
        p.characters[0].name_colour = colour.map(str::to_owned);
        p.game
            .variables
            .insert("words".into(), Value::Text("<red>& %chances%</red>".into()));
        let (mut session, _) = Session::start(p, None).unwrap();
        let result = session.command("use scene").unwrap();
        let spans = &result.messages[0];
        assert_eq!(
            spans[0],
            text::Span {
                text: "Keeper <&> %chances%".into(),
                colour: colour.map(str::to_owned)
            }
        );
        assert_eq!(
            spans[1],
            text::Span {
                text: " says: ".into(),
                colour: None
            }
        );
        assert_eq!(
            spans[2],
            text::Span {
                text: "5 chances; 9; <red>& %chances%</red>".into(),
                colour: Some("green".into())
            }
        );
        assert_eq!(
            text::plain(spans),
            "Keeper <&> %chances% says: 5 chances; 9; <red>& %chances%</red> %name%."
        );
        assert!(!text::render(spans, false).contains('\x1b'));
        session.project.characters[0].name = "Renamed Keeper".into();
        assert!(
            text::plain(&session.command("use scene").unwrap().messages[0])
                .starts_with("Renamed Keeper says: ")
        );
    }
}

#[test]
fn failed_later_effects_roll_back_character_movement_speech_and_values() {
    let p = world(vec![
        speech("Leaving."),
        movement("garden"),
        Effect::SetProperty {
            entity: "keeper".into(),
            name: "health".into(),
            value: Value::Integer(2),
        },
        Effect::UpdateVariable {
            name: "chances".into(),
            op: ArithmeticOperation::Divide,
            operand: NumericOperand::Variable {
                name: "zero".into(),
            },
        },
    ]);
    let mut p = p;
    p.game.variables.insert("zero".into(), Value::Integer(0));
    let (mut session, _) = Session::start(p, None).unwrap();
    let before = session.state.clone();
    assert!(
        session
            .command("use scene")
            .unwrap_err()
            .to_string()
            .contains("zero")
    );
    assert_eq!(session.state, before);
}

#[test]
fn legacy_colours_default_and_invalid_character_effect_references_are_rejected() {
    let p = world(vec![movement("garden"), speech("Hello.")]);
    let mut legacy = serde_json::to_value(&p).unwrap();
    legacy["characters"][0]
        .as_object_mut()
        .unwrap()
        .remove("name_colour");
    let legacy: Project = serde_json::from_value(legacy).unwrap();
    assert_eq!(legacy.characters[0].name_colour, None);
    assert!(!has_errors(&validate(&legacy)));
    for effect in [
        Effect::CharacterSays {
            character: "key".into(),
            text: "Hi".into(),
        },
        Effect::CharacterSays {
            character: "missing".into(),
            text: "Hi".into(),
        },
        speech("%missing%"),
        speech("<invalid>Hello</invalid>"),
        Effect::MoveCharacter {
            character: "key".into(),
            location: "garden".into(),
        },
        movement("missing"),
    ] {
        let mut invalid = p.clone();
        invalid.game.actions[0].effects = vec![effect];
        assert!(has_errors(&validate(&invalid)));
        assert!(Session::start(invalid, None).is_err());
    }
    let mut invalid = p;
    invalid.characters[0].name_colour = Some("purple".into());
    assert!(
        validate(&invalid)
            .iter()
            .any(|d| d.field == "name_colour" && d.severity == Severity::Error)
    );
}

#[test]
fn moving_a_remote_character_can_make_an_ending_reachable_without_visiting_their_room() {
    let mut p = world(vec![movement("@current")]);
    p.game.actions.retain(|a| a.id == "scene");
    p.game.require_ending = true;
    p.game.endings.push(Ending {
        id: "finish".into(),
        text: "Done.".into(),
        ..Default::default()
    });
    p.characters[0].location = "garden".into();
    p.characters[0].actions[0].effects = vec![Effect::End {
        ending: "finish".into(),
    }];
    let diagnostics = validate(&p);
    assert!(!has_errors(&diagnostics), "{diagnostics:?}");
    assert!(
        diagnostics
            .iter()
            .any(|d| d.subject == "garden" && d.message.contains("unreachable"))
    );
    let (mut session, _) = Session::start(p, None).unwrap();
    session.command("use scene").unwrap();
    session.command("examine Keeper").unwrap();
    assert_eq!(session.state.ending.as_deref(), Some("finish"));
    assert_eq!(session.state.visits["garden"], 0);
}
