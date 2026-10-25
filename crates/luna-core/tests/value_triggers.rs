use luna_core::Session;
use luna_model::*;

fn target(name: &str) -> ValueTarget {
    ValueTarget::Variable { name: name.into() }
}
fn variable(name: &str, op: Comparison, value: i32) -> Condition {
    Condition::Variable {
        name: name.into(),
        op,
        value: Value::Integer(value),
    }
}
fn set(name: &str, value: i32) -> Effect {
    Effect::SetVariable {
        name: name.into(),
        value: Value::Integer(value),
    }
}
fn watch(id: &str, target: ValueTarget, condition: Condition, effects: Vec<Effect>) -> Trigger {
    Trigger {
        id: id.into(),
        name: id.into(),
        watch: Some(TriggerWatch {
            target,
            mode: WatchMode::BecomesTrue,
        }),
        condition,
        effects,
        ..Default::default()
    }
}
fn action(id: &str, effects: Vec<Effect>) -> Action {
    Action {
        id: id.into(),
        verb: "use".into(),
        pattern: vec![PatternPart::Literal { text: id.into() }],
        effects,
        ..Default::default()
    }
}
fn world() -> Project {
    let mut p = Project::blank("Value triggers");
    p.game.variables = [
        ("health".into(), Value::Integer(10)),
        ("deaths".into(), Value::Integer(0)),
    ]
    .into();
    p.game.actions = vec![
        action(
            "hurt",
            vec![Effect::UpdateVariable {
                name: "health".into(),
                op: ArithmeticOperation::Subtract,
                operand: NumericOperand::Literal { value: 6 },
            }],
        ),
        action("heal", vec![set("health", 10)]),
        action("unrelated", vec![set("deaths", 5)]),
    ];
    p
}
fn text(result: luna_core::CommandResult) -> String {
    result
        .messages
        .into_iter()
        .flatten()
        .map(|span| span.text)
        .collect::<Vec<_>>()
        .join(" ")
}
#[test]
fn threshold_crossings_rearm_without_repeating_and_restore_without_replaying() {
    let mut p = world();
    p.game.triggers.push(watch(
        "death",
        target("health"),
        variable("health", Comparison::Le, 0),
        vec![Effect::Say {
            text: "Defeated.".into(),
        }],
    ));
    let (mut s, initial) = Session::start(p.clone(), None).unwrap();
    assert!(!text(initial).contains("Defeated."));
    assert!(!text(s.command("use hurt").unwrap()).contains("Defeated."));
    assert!(text(s.command("use hurt").unwrap()).contains("Defeated."));
    assert!(!text(s.command("use hurt").unwrap()).contains("Defeated."));
    let saved = serde_json::to_vec(s.state()).unwrap();
    let mut restored = Session::restore(p, serde_json::from_slice(&saved).unwrap()).unwrap();
    assert!(!text(restored.command("look").unwrap()).contains("Defeated."));
    assert!(!text(restored.command("use hurt").unwrap()).contains("Defeated."));
    restored.command("use heal").unwrap();
    restored.command("use hurt").unwrap();
    assert!(text(restored.command("use hurt").unwrap()).contains("Defeated."));
}
#[test]
fn watched_character_properties_work_remotely_and_do_not_fire_as_ordinary_events() {
    let mut p = world();
    p.locations.push(Location {
        id: "elsewhere".into(),
        name: "Elsewhere".into(),
        ..Default::default()
    });
    p.characters.push(Character {
        id: "goblin".into(),
        name: "Goblin".into(),
        location: "elsewhere".into(),
        state: [("health".into(), Value::Integer(5))].into(),
        ..Default::default()
    });
    let watched = ValueTarget::Property {
        entity: "goblin".into(),
        name: "health".into(),
    };
    p.characters[0].triggers.push(watch(
        "defeat-goblin",
        watched,
        Condition::Property {
            entity: "goblin".into(),
            name: "health".into(),
            op: Comparison::Le,
            value: Value::Integer(0),
        },
        vec![Effect::Hide {
            entity: "goblin".into(),
        }],
    ));
    p.game.actions.push(action(
        "attack",
        vec![Effect::UpdateProperty {
            entity: "goblin".into(),
            name: "health".into(),
            op: ArithmeticOperation::Subtract,
            operand: NumericOperand::Literal { value: 10 },
        }],
    ));
    p.game.actions.push(action(
        "restore",
        vec![
            Effect::SetProperty {
                entity: "goblin".into(),
                name: "health".into(),
                value: Value::Integer(5),
            },
            Effect::Reveal {
                entity: "goblin".into(),
            },
        ],
    ));
    p.game.actions.push(action(
        "finish",
        vec![Effect::SetProperty {
            entity: "goblin".into(),
            name: "health".into(),
            value: Value::Integer(0),
        }],
    ));
    let (mut s, _) = Session::start(p, None).unwrap();
    assert!(!s.state().characters["goblin"].hidden);
    s.command("use unrelated").unwrap();
    assert!(!s.state().characters["goblin"].hidden);
    s.command("use attack").unwrap();
    assert!(s.state().characters["goblin"].hidden);
    s.command("use restore").unwrap();
    assert!(!s.state().characters["goblin"].hidden);
    s.command("use finish").unwrap();
    assert!(s.state().characters["goblin"].hidden);
}
#[test]
fn actual_changes_only_and_each_change_mode_support_boolean_and_text_values() {
    let mut p = world();
    p.game.variables.insert("flag".into(), Value::Bool(false));
    p.game
        .variables
        .insert("text".into(), Value::Text("old".into()));
    for name in ["flag", "text"] {
        let mut t = watch(
            name,
            target(name),
            Condition::True,
            vec![Effect::Say {
                text: format!("Changed {name}."),
            }],
        );
        t.watch.as_mut().unwrap().mode = WatchMode::EachChange;
        p.game.triggers.push(t);
    }
    p.game.actions.push(action(
        "change",
        vec![
            Effect::SetVariable {
                name: "flag".into(),
                value: Value::Bool(true),
            },
            Effect::SetVariable {
                name: "text".into(),
                value: Value::Text("new".into()),
            },
        ],
    ));
    let (mut s, _) = Session::start(p, None).unwrap();
    let output = text(s.command("use change").unwrap());
    assert!(output.contains("Changed flag."));
    assert!(output.contains("Changed text."));
    assert!(!text(s.command("use change").unwrap()).contains("Changed"));
}
#[test]
fn death_ends_the_current_effect_chain_and_runs_ending_handlers_once() {
    let mut p = world();
    p.game.endings.push(Ending {
        id: "death-ending".into(),
        name: "Death".into(),
        text: "Game over.".into(),
        outcome: Some(Outcome::Loss),
    });
    p.game.triggers.push(watch(
        "death",
        target("health"),
        variable("health", Comparison::Le, 0),
        vec![Effect::End {
            ending: "death-ending".into(),
        }],
    ));
    p.game.triggers.push(Trigger {
        id: "cleanup".into(),
        event: Event::Ending,
        effects: vec![Effect::Say {
            text: "Cleanup.".into(),
        }],
        ..Default::default()
    });
    p.game
        .actions
        .push(action("die", vec![set("health", -5), set("deaths", 99)]));
    let (mut s, _) = Session::start(p, None).unwrap();
    let output = text(s.command("use die").unwrap());
    assert_eq!(s.state().ending.as_deref(), Some("death-ending"));
    assert_eq!(s.state().variables["deaths"], Value::Integer(0));
    assert_eq!(output.matches("Cleanup.").count(), 1);
    assert_eq!(output.matches("Game over.").count(), 1);
}
#[test]
fn priority_chains_and_errors_remain_transactional() {
    let mut p = world();
    let mut first = watch(
        "first",
        target("health"),
        variable("health", Comparison::Le, 0),
        vec![
            Effect::Say {
                text: "First.".into(),
            },
            set("deaths", 1),
        ],
    );
    first.priority = 10;
    p.game.triggers = vec![
        watch(
            "second",
            target("health"),
            variable("health", Comparison::Le, 0),
            vec![Effect::Say {
                text: "Second.".into(),
            }],
        ),
        first,
        watch(
            "chained",
            target("deaths"),
            variable("deaths", Comparison::Ge, 1),
            vec![Effect::Say {
                text: "Chained.".into(),
            }],
        ),
    ];
    let (mut s, _) = Session::start(p.clone(), None).unwrap();
    s.command("use hurt").unwrap();
    let output = text(s.command("use hurt").unwrap());
    assert!(output.find("First.").unwrap() < output.find("Chained.").unwrap());
    assert!(output.find("Chained.").unwrap() < output.find("Second.").unwrap());
    p.game.triggers[2].effects = vec![Effect::UpdateVariable {
        name: "health".into(),
        op: ArithmeticOperation::Divide,
        operand: NumericOperand::Variable {
            name: "deaths".into(),
        },
    }];
    p.game.triggers[1].effects = vec![
        set("deaths", 0),
        Effect::UpdateVariable {
            name: "health".into(),
            op: ArithmeticOperation::Divide,
            operand: NumericOperand::Variable {
                name: "deaths".into(),
            },
        },
    ];
    let (mut s, _) = Session::start(p, None).unwrap();
    s.command("use hurt").unwrap();
    let before = s.state().clone();
    assert!(
        s.command("use hurt")
            .unwrap_err()
            .to_string()
            .contains("zero")
    );
    assert_eq!(s.state(), &before);
}
#[test]
fn recursive_watchers_roll_back_and_old_trigger_content_defaults_safely() {
    let mut p = world();
    let mut t = watch(
        "loop",
        target("health"),
        Condition::True,
        vec![Effect::If {
            condition: variable("health", Comparison::Eq, 0),
            then: vec![set("health", 1)],
            otherwise: vec![set("health", 0)],
        }],
    );
    t.watch.as_mut().unwrap().mode = WatchMode::EachChange;
    p.game.triggers.push(t);
    let (mut s, _) = Session::start(p, None).unwrap();
    let before = s.state().clone();
    assert!(
        s.command("use hurt")
            .unwrap_err()
            .to_string()
            .contains("rolled back")
    );
    assert_eq!(s.state(), &before);
    let old: Trigger = serde_json::from_str(
        r#"{"id":"old","event":"start","condition":{"type":"true"},"effects":[]}"#,
    )
    .unwrap();
    assert_eq!(old.name, "");
    assert!(old.watch.is_none());
    let mut p = world();
    p.game
        .triggers
        .push(watch("broken", target("missing"), Condition::True, vec![]));
    assert!(
        validate(&p)
            .iter()
            .any(|d| d.field == "watch.target" && d.severity == Severity::Error)
    );
}

#[test]
fn ending_reachability_includes_remote_watches_without_enabling_the_owners_actions() {
    let mut p = world();
    p.game.require_ending = true;
    p.game.endings.push(Ending {
        id: "death".into(),
        name: "Death".into(),
        text: "Defeated.".into(),
        outcome: Some(Outcome::Loss),
    });
    p.locations.push(Location {
        id: "remote".into(),
        name: "Remote".into(),
        ..Default::default()
    });
    p.characters.push(Character {
        id: "watcher".into(),
        name: "Watcher".into(),
        location: "remote".into(),
        triggers: vec![watch(
            "remote-watch",
            target("health"),
            variable("health", Comparison::Le, 0),
            vec![Effect::End {
                ending: "death".into(),
            }],
        )],
        ..Default::default()
    });
    assert!(!has_errors(&validate(&p)));
    let (mut s, _) = Session::start(p.clone(), None).unwrap();
    s.command("use hurt").unwrap();
    s.command("use hurt").unwrap();
    assert_eq!(s.state().ending.as_deref(), Some("death"));
    p.characters[0].triggers[0].effects.clear();
    p.characters[0].actions.push(action(
        "unreachable",
        vec![Effect::End {
            ending: "death".into(),
        }],
    ));
    assert!(has_errors(&validate(&p)));
}
