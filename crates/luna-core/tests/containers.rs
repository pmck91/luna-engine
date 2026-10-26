use luna_core::{CommandResult, CommandStatus, GameDefinition, Session, TraceKind};
use luna_model::*;
use std::collections::BTreeMap;

fn target(id: &str) -> ObjectTarget {
    ObjectTarget::Fixed(id.into())
}
fn increment(name: &str) -> Effect {
    Effect::UpdateVariable {
        name: name.into(),
        op: ArithmeticOperation::Add,
        operand: NumericOperand::Literal { value: 1 },
    }
}
fn script(p: &mut Project, name: &str, effects: Vec<Effect>) {
    p.game.actions.push(Action {
        id: name.into(),
        verb: "use".into(),
        name: name.into(),
        pattern: vec![PatternPart::Literal { text: name.into() }],
        effects,
        ..Default::default()
    });
}
fn world() -> Project {
    let mut p = Project::blank("Packing the Study");
    p.locations[0].name = "Study".into();
    let room = p.locations[0].id.clone();
    p.game.help_mode = HelpMode::Full;
    for name in ["takes", "drops", "opens", "starts"] {
        p.game.variables.insert(name.into(), Value::Integer(0));
    }
    p.game.triggers.push(Trigger {
        id: "started".into(),
        event: Event::Start,
        effects: vec![increment("starts")],
        ..Default::default()
    });
    p.vocabulary.extend([
        Verb {
            id: "put".into(),
            canonical: "put".into(),
            synonyms: vec!["place carefully".into()],
            event: None,
        },
        Verb {
            id: "look-in".into(),
            canonical: "look in".into(),
            synonyms: vec!["look inside".into()],
            event: None,
        },
    ]);
    p.objects = vec![
        Object {
            id: "chest".into(),
            name: "Wooden chest".into(),
            aliases: vec!["chest".into()],
            placement: Placement::Location {
                location: room.clone(),
            },
            storage: Some(ObjectStorage {
                container: Some(ContainerOpening::Openable),
                surface: true,
            }),
            ..Default::default()
        },
        Object {
            id: "bag".into(),
            name: "Canvas bag".into(),
            aliases: vec!["bag".into()],
            placement: Placement::Inventory,
            portable: true,
            open: true,
            storage: Some(ObjectStorage {
                container: Some(ContainerOpening::Openable),
                surface: false,
            }),
            ..Default::default()
        },
        Object {
            id: "box".into(),
            name: "Small box".into(),
            aliases: vec!["box".into()],
            placement: Placement::Inside {
                object: "chest".into(),
            },
            portable: true,
            open: true,
            storage: Some(ObjectStorage {
                container: Some(ContainerOpening::AlwaysOpen),
                surface: false,
            }),
            ..Default::default()
        },
        Object {
            id: "key".into(),
            name: "Brass key".into(),
            aliases: vec!["key".into()],
            description: "A brass key.".into(),
            placement: Placement::Inside {
                object: "chest".into(),
            },
            portable: true,
            ..Default::default()
        },
        Object {
            id: "letter".into(),
            name: "Letter".into(),
            placement: Placement::On {
                object: "chest".into(),
            },
            portable: true,
            ..Default::default()
        },
        Object {
            id: "token".into(),
            name: "Tiny token".into(),
            aliases: vec!["token".into()],
            placement: Placement::Inside {
                object: "box".into(),
            },
            portable: true,
            ..Default::default()
        },
        Object {
            id: "secret".into(),
            name: "Secret gem".into(),
            aliases: vec!["gem".into()],
            hidden: true,
            placement: Placement::Inside {
                object: "chest".into(),
            },
            portable: true,
            ..Default::default()
        },
    ];
    p.characters.push(Character {
        id: "keeper".into(),
        name: "Keeper".into(),
        location: room,
        ..Default::default()
    });
    for object in &mut p.objects {
        object.actions.push(description_action(&object.id));
        let storage = object.storage.unwrap_or_default();
        if storage.container == Some(ContainerOpening::Openable) {
            object
                .actions
                .push(standard_action(object, StandardInteraction::Open, "open"));
            object
                .actions
                .push(standard_action(object, StandardInteraction::Close, "close"));
        }
        if storage.container.is_some() {
            object.actions.push(standard_action(
                object,
                StandardInteraction::LookInside,
                "look-in",
            ));
            object.actions.push(standard_action(
                object,
                StandardInteraction::PutInside,
                "put",
            ));
        }
        if storage.surface {
            object
                .actions
                .push(standard_action(object, StandardInteraction::PutOn, "put"));
        }
        if !storage.is_empty() {
            object.actions.push(standard_action(
                object,
                StandardInteraction::TakeFrom,
                "take",
            ));
        }
        if object.portable {
            object
                .actions
                .push(standard_action(object, StandardInteraction::Take, "take"));
            object
                .actions
                .push(standard_action(object, StandardInteraction::Drop, "drop"));
        }
    }
    p.objects
        .iter_mut()
        .find(|o| o.id == "key")
        .unwrap()
        .triggers = vec![
        Trigger {
            id: "key-taken".into(),
            event: Event::Take,
            effects: vec![increment("takes")],
            ..Default::default()
        },
        Trigger {
            id: "key-dropped".into(),
            event: Event::Drop,
            effects: vec![increment("drops")],
            ..Default::default()
        },
    ];
    p.objects[0].triggers.push(Trigger {
        id: "chest-opened".into(),
        event: Event::Open,
        effects: vec![increment("opens")],
        ..Default::default()
    });
    p
}
fn start(p: Project) -> Session {
    let errors = validate(&p)
        .into_iter()
        .filter(|d| d.severity == Severity::Error)
        .collect::<Vec<_>>();
    assert!(errors.is_empty(), "{errors:#?}");
    Session::start(p, None).unwrap().0
}
fn text(result: &CommandResult) -> String {
    result
        .messages
        .iter()
        .map(|s| text::plain(s))
        .collect::<Vec<_>>()
        .join("\n")
}
fn run(session: &mut Session, command: &str) -> CommandResult {
    let result = session.command(command).unwrap();
    assert_eq!(
        result.status,
        CommandStatus::Ok,
        "{command}: {}",
        text(&result)
    );
    result
}
fn reachable(id: &str) -> Condition {
    Condition::Reachable { object: target(id) }
}
fn has(id: &str) -> Condition {
    Condition::Possesses {
        object: target(id),
        character: None,
    }
}

#[test]
fn closed_interiors_and_hidden_items_never_leak_but_surfaces_stay_accessible() {
    let mut session = start(world());
    let look = text(&run(&mut session, "look"));
    assert!(look.contains("Wooden chest"));
    assert!(look.contains("On Wooden chest: Letter."));
    for hidden in ["Brass key", "Small box", "Tiny token", "Secret gem"] {
        assert!(!look.contains(hidden), "{look}");
    }
    for command in ["take key", "take gem from chest", "help key", "hint key"] {
        let result = session.command(command).unwrap();
        assert_eq!(result.status, CommandStatus::Unmatched, "{command}");
    }
    let help = text(&run(&mut session, "help chest"));
    assert!(!help.contains("Brass key"));
    run(&mut session, "take letter");
    run(&mut session, "open chest");
    assert!(session.test_condition(&reachable("token")));
    assert!(!session.test_condition(&reachable("secret")));
    let look = text(&run(&mut session, "look"));
    assert!(look.contains("Inside Wooden chest: Brass key, Small box."));
    assert!(look.contains("Inside Small box: Tiny token."));
    assert!(!look.contains("Secret gem"));
    run(&mut session, "close chest");
    assert!(!session.test_condition(&reachable("token")));
}

#[test]
fn standard_inputs_transfer_any_suitable_item_and_distinguish_possession_from_access() {
    let mut session = start(world());
    run(&mut session, "open chest");
    run(&mut session, "pick up the brass key from the chest");
    assert_eq!(session.state().variables["takes"], Value::Integer(1));
    run(&mut session, "PLACE CAREFULLY the key in the bag!");
    assert!(session.test_condition(&has("key")));
    assert!(session.test_condition(&reachable("key")));
    assert!(!session.test_condition(&Condition::Carrying {
        object: "key".into()
    }));
    assert_eq!(session.state().variables["drops"], Value::Integer(0));
    run(&mut session, "close bag");
    assert!(session.test_condition(&has("key")));
    assert!(!session.test_condition(&reachable("key")));
    assert!(!text(&run(&mut session, "inventory")).contains("Brass key"));
    run(&mut session, "open bag");
    assert!(text(&run(&mut session, "inventory")).contains("Inside Canvas bag: Brass key."));
    run(&mut session, "take key from bag");
    assert_eq!(session.state().variables["takes"], Value::Integer(1));
    run(&mut session, "put key on chest");
    assert_eq!(session.state().variables["drops"], Value::Integer(1));
    assert!(session.test_condition(&Condition::InObject {
        object: target("key"),
        parent: "chest".into(),
        relation: ContentRelation::On
    }));
    run(&mut session, "take letter from chest");
    assert_eq!(
        session.state().objects["letter"].placement,
        Placement::Inventory
    );
}

#[test]
fn holder_movement_and_character_ownership_preserve_the_subtree_without_child_events() {
    let mut p = world();
    script(
        &mut p,
        "handover",
        vec![Effect::GiveCharacter {
            object: "bag".into(),
            character: "keeper".into(),
        }],
    );
    script(
        &mut p,
        "returnbag",
        vec![Effect::Give {
            object: "bag".into(),
        }],
    );
    let mut session = start(p);
    run(&mut session, "open chest");
    run(&mut session, "take key");
    run(&mut session, "put key in bag");
    let child = session.state().objects["key"].clone();
    run(&mut session, "drop bag");
    assert_eq!(session.state().objects["key"], child);
    assert!(!session.test_condition(&has("key")));
    assert!(session.test_condition(&reachable("key")));
    run(&mut session, "take bag");
    run(&mut session, "use handover");
    assert!(session.test_condition(&Condition::Possesses {
        object: target("key"),
        character: Some("keeper".into())
    }));
    assert!(!session.test_condition(&reachable("key")));
    run(&mut session, "use returnbag");
    assert_eq!(session.state().objects["key"], child);
    assert!(session.test_condition(&has("key")));
    assert_eq!(session.state().variables["takes"], Value::Integer(1));
    assert_eq!(session.state().variables["drops"], Value::Integer(0));
}

#[test]
fn a_failed_custom_handler_never_tries_a_standard_and_input_ambiguity_changes_nothing() {
    let mut p = world();
    p.objects[0].actions.push(Action {
        id: "custom-open".into(),
        name: "Custom open".into(),
        verb: "open".into(),
        pattern: vec![PatternPart::Entity {
            entity: "chest".into(),
        }],
        requirements: Condition::False,
        failure_text: "Find the combination first.".into(),
        ..Default::default()
    });
    let mut session = start(p);
    let before = session.state().clone();
    let result = session.command("open chest").unwrap();
    assert_eq!(result.status, CommandStatus::RequirementsFailed);
    assert_eq!(result.selected_flow.as_deref(), Some("custom-open"));
    assert_eq!(text(&result), "Find the combination first.");
    assert_eq!(session.state(), &before);
    let mut p = world();
    let mut silver = p.objects.iter().find(|o| o.id == "key").unwrap().clone();
    silver.id = "silver-key".into();
    silver.name = "Silver key".into();
    silver.actions.clear();
    silver.triggers.clear();
    p.objects.push(silver);
    let mut session = start(p);
    run(&mut session, "open chest");
    let before = session.state().clone();
    let result = session.command("take key from chest").unwrap();
    assert_eq!(result.status, CommandStatus::Ambiguous);
    assert!(text(&result).contains("Brass key"));
    assert!(text(&result).contains("Silver key"));
    assert_eq!(session.state(), &before);
    run(&mut session, "take silver key from chest");
}

#[test]
fn physical_requirements_refuse_while_scripted_placement_can_stage_a_closed_holder() {
    let mut p = world();
    script(
        &mut p,
        "stage",
        vec![Effect::Transfer {
            object: target("letter"),
            placement: Placement::Inside {
                object: "chest".into(),
            },
        }],
    );
    let mut session = start(p);
    run(&mut session, "take letter");
    let before = session.state().clone();
    assert_eq!(
        session.command("put letter in chest").unwrap().status,
        CommandStatus::RequirementsFailed
    );
    assert_eq!(session.state(), &before);
    run(&mut session, "use stage");
    assert_eq!(
        session.state().objects["letter"].placement,
        Placement::Inside {
            object: "chest".into()
        }
    );
    assert!(!session.test_condition(&reachable("letter")));
}

#[test]
fn cycle_errors_nonempty_consumption_and_later_effect_failure_roll_back_everything() {
    let mut p = world();
    p.game
        .variables
        .insert("overflow".into(), Value::Integer(i32::MAX));
    script(
        &mut p,
        "cycle",
        vec![Effect::Transfer {
            object: target("chest"),
            placement: Placement::Inside {
                object: "box".into(),
            },
        }],
    );
    script(
        &mut p,
        "eat",
        vec![Effect::Consume {
            object: "chest".into(),
        }],
    );
    script(
        &mut p,
        "badclose",
        vec![Effect::Close {
            object: "box".into(),
        }],
    );
    script(
        &mut p,
        "overflow",
        vec![
            Effect::Say {
                text: "discard me".into(),
            },
            Effect::Transfer {
                object: target("key"),
                placement: Placement::Inventory,
            },
            increment("overflow"),
        ],
    );
    let mut session = start(p);
    for command in ["use cycle", "use eat", "use badclose", "use overflow"] {
        let before = session.state().clone();
        let result = session.command_explained(command);
        assert_eq!(result.status, CommandStatus::Error, "{command}");
        assert!(result.messages.is_empty());
        assert_eq!(session.state(), &before);
    }
}

#[test]
fn removal_parks_contents_and_restoration_does_not_replay_them() {
    let mut p = world();
    script(
        &mut p,
        "park",
        vec![Effect::Remove {
            object: "chest".into(),
        }],
    );
    let room = p.game.starting_location.clone();
    script(
        &mut p,
        "restore",
        vec![Effect::Place {
            object: "chest".into(),
            location: room,
        }],
    );
    let mut session = start(p);
    run(&mut session, "open chest");
    let key = session.state().objects["key"].clone();
    run(&mut session, "use park");
    assert!(session.test_condition(&Condition::Exists {
        object: "key".into()
    }));
    assert!(!session.test_condition(&reachable("key")));
    session
        .definition()
        .validate_state(session.state())
        .unwrap();
    let mut restored =
        Session::restore_with_definition(session.definition().clone(), session.state().clone())
            .unwrap();
    assert_eq!(restored.state(), session.state());
    run(&mut restored, "use restore");
    assert_eq!(restored.state().objects["key"], key);
    assert!(restored.test_condition(&reachable("key")));
    assert_eq!(restored.state().variables["takes"], Value::Integer(0));
    assert_eq!(restored.state().variables["starts"], Value::Integer(1));
}

#[test]
fn invalid_graphs_capabilities_and_saved_snapshots_are_rejected_atomically() {
    let mut session = start(world());
    let original = session.state().clone();
    for variant in 0..5 {
        let mut state = original.clone();
        match variant {
            0 => {
                state.objects.get_mut("chest").unwrap().placement = Placement::Inside {
                    object: "box".into(),
                };
            }
            1 => {
                state.objects.get_mut("key").unwrap().placement = Placement::On {
                    object: "bag".into(),
                };
            }
            2 => {
                state.objects.get_mut("box").unwrap().open = false;
            }
            3 => {
                let parent = state.objects.get_mut("chest").unwrap();
                parent.placement = Placement::Absent;
                parent.exists = false;
                parent.consumed = true;
            }
            _ => {
                state.objects.get_mut("key").unwrap().placement = Placement::Inside {
                    object: "missing".into(),
                };
            }
        }
        assert!(session.replace_state(state).is_err(), "variant {variant}");
        assert_eq!(session.state(), &original);
    }
    let mut p = world();
    p.objects[0].placement = Placement::Inside {
        object: "box".into(),
    };
    assert!(validate(&p).iter().any(|d| d.message.contains("cycle")));
    let mut p = world();
    p.objects[0].storage = None;
    assert!(has_errors(&validate(&p)));
}

#[test]
fn scoped_messages_preserve_literal_names_global_variables_and_context_boundaries() {
    let mut p = world();
    p.game
        .variables
        .insert("item".into(), Value::Text("GLOBAL".into()));
    let key = p.objects.iter_mut().find(|o| o.id == "key").unwrap();
    key.name = "<red>key</red> & %item%".into();
    key.actions
        .iter_mut()
        .find(|a| {
            a.standard
                .as_ref()
                .is_some_and(|s| s.interaction == StandardInteraction::Take)
        })
        .unwrap()
        .effects
        .push(Effect::Say {
            text: "%item%".into(),
        });
    let mut session = start(p);
    run(&mut session, "open chest");
    let result = run(&mut session, "take key from chest");
    assert!(text(&result).contains("<red>key</red> & %item%"));
    assert!(!session.test_condition(&Condition::Reachable {
        object: ObjectTarget::command_item()
    }));
    let mut p = world();
    p.game.triggers.push(Trigger {
        id: "invalid-input".into(),
        effects: vec![Effect::Transfer {
            object: ObjectTarget::command_item(),
            placement: Placement::Inventory,
        }],
        ..Default::default()
    });
    assert!(
        validate(&p)
            .iter()
            .any(|d| d.message.contains("not declared"))
    );
    let mut p = world();
    p.game.variables.insert("item".into(), Value::Integer(1));
    script(
        &mut p,
        "shadow",
        vec![Effect::SayWithInputs {
            text: "%item%".into(),
            references: BTreeMap::from([(
                "item".into(),
                InputTextReference::EntityName {
                    entity: "key".into(),
                },
            )]),
        }],
    );
    assert!(validate(&p).iter().any(|d| d.message.contains("shadow")));
}

#[test]
fn explanations_record_bound_items_and_ancestry_without_changing_execution() {
    let mut ordinary = start(world());
    run(&mut ordinary, "open chest");
    let mut explained =
        Session::restore_with_definition(ordinary.definition().clone(), ordinary.state().clone())
            .unwrap();
    let result = run(&mut ordinary, "take key from chest");
    let mut observed = explained.command_explained("take key from chest");
    let explanation = observed.explanation.take().unwrap();
    assert_eq!(
        serde_json::to_value(result).unwrap(),
        serde_json::to_value(observed).unwrap()
    );
    assert_eq!(ordinary.state(), explained.state());
    assert!(explanation.steps.iter().any(|step| matches!(&step.kind, TraceKind::Notice { text } if text.contains("Command item: Brass key [key]"))));
    assert!(explanation.steps.iter().any(|step| matches!(&step.kind, TraceKind::Condition { observed: Some(value), .. } if value.get("path").is_some())));
}

#[test]
fn configured_standard_verb_events_do_not_duplicate_transfer_events() {
    let mut p = world();
    p.vocabulary
        .iter_mut()
        .find(|v| v.id == "take")
        .unwrap()
        .event = Some(Event::Take);
    p.vocabulary
        .iter_mut()
        .find(|v| v.id == "open")
        .unwrap()
        .event = Some(Event::Open);
    let mut session = start(p);
    run(&mut session, "open chest");
    run(&mut session, "take key from chest");
    assert_eq!(session.state().variables["takes"], Value::Integer(1));
    assert_eq!(session.state().variables["opens"], Value::Integer(1));
}

#[test]
fn disabled_standards_do_not_match_and_legacy_content_requires_explicit_upgrade() {
    let mut p = world();
    p.objects[0]
        .actions
        .iter_mut()
        .find(|a| {
            a.standard
                .as_ref()
                .is_some_and(|s| s.interaction == StandardInteraction::Open)
        })
        .unwrap()
        .standard
        .as_mut()
        .unwrap()
        .enabled = false;
    let mut session = start(p);
    assert_eq!(
        session.command("open chest").unwrap().status,
        CommandStatus::Unmatched
    );
    let mut p = world();
    p.game.format_version = 1;
    p.game.command_assistance = None;
    assert!(
        validate(&p)
            .iter()
            .any(|d| d.message.contains("explicit upgrade"))
    );
    let mut legacy = Project::blank("Legacy");
    legacy.game.format_version = 1;
    legacy.game.command_assistance = None;
    legacy.objects.push(Object {
        id: "old-door".into(),
        name: "Old door".into(),
        placement: Placement::Inventory,
        ..Default::default()
    });
    let encoded = serde_json::to_string(&legacy).unwrap();
    assert!(!encoded.contains("\"storage\""));
    assert!(!encoded.contains("\"standard\""));
    let restored: Project = serde_json::from_str(&encoded).unwrap();
    assert_eq!(restored.game.format_version, 1);
    GameDefinition::new(restored).unwrap();
}

#[test]
fn deep_relationships_are_iterative_and_do_not_expand_actions_per_item_pair() {
    let mut p = Project::blank("Deep holders");
    p.locations[0].actions.clear();
    for i in 0..1200 {
        p.objects.push(Object {
            id: format!("holder-{i}"),
            name: format!("Holder {i}"),
            placement: if i == 0 {
                Placement::Inventory
            } else {
                Placement::Inside {
                    object: format!("holder-{}", i - 1),
                }
            },
            open: true,
            storage: Some(ObjectStorage {
                container: Some(ContainerOpening::AlwaysOpen),
                surface: false,
            }),
            ..Default::default()
        });
    }
    p.objects
        .last_mut()
        .unwrap()
        .actions
        .push(description_action("holder-1199"));
    let mut session = start(p);
    assert!(session.test_condition(&reachable("holder-1199")));
    run(&mut session, "examine holder 1199");
    assert_eq!(
        session
            .project()
            .owners()
            .iter()
            .map(|(_, a, _)| a.len())
            .sum::<usize>(),
        1
    );
    session
        .definition()
        .validate_state(session.state())
        .unwrap();
}
