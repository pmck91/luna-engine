//! Production regressions promoted from the R1 coordinator: canonical content,
//! public Session calls, real state/progress, and no alternate execution path.
use luna_core::{
    CommandResult, CommandStatus, GameDefinition, ProcedureReturn, Session, TraceKind,
};
use luna_model::*;
use std::collections::BTreeMap;
fn local(id: &str) -> Argument {
    Argument::Input { input: id.into() }
}
fn literal(value: i32) -> Argument {
    Argument::Literal {
        value: Value::Integer(value),
    }
}
fn entity(kind: InputKind, id: &str) -> Argument {
    Argument::Entity {
        kind,
        id: id.into(),
    }
}
fn reference(id: &str) -> EntityRef {
    EntityRef::Input {
        procedure_input: id.into(),
    }
}
fn input(id: &str, kind: InputKind) -> ProcedureInput {
    ProcedureInput {
        id: id.into(),
        name: id.into(),
        kind,
        required_properties: BTreeMap::new(),
    }
}
fn call(
    id: &str,
    procedure: &str,
    arguments: impl IntoIterator<Item = (&'static str, Argument)>,
) -> Effect {
    Effect::Call {
        id: id.into(),
        procedure: procedure.into(),
        arguments: arguments
            .into_iter()
            .map(|(id, value)| (id.into(), value))
            .collect(),
    }
}
fn award(id: &str, recipient: Argument, amount: Argument) -> Effect {
    call(id, "award", [("recipient", recipient), ("amount", amount)])
}
fn say(text: &str) -> Effect {
    Effect::Say { text: text.into() }
}
fn message(
    text: &str,
    inputs: impl IntoIterator<Item = (&'static str, &'static str)>,
) -> MessageText {
    MessageText::Bound {
        text: text.into(),
        references: inputs
            .into_iter()
            .map(|(key, input)| {
                (
                    key.into(),
                    InputTextReference::ProcedureInput {
                        input: input.into(),
                    },
                )
            })
            .collect(),
    }
}
fn respond(id: &str) -> Effect {
    Effect::Respond {
        id: id.into(),
        responses: vec!["Reply one".into(), "Reply two".into()],
        mode: SequenceMode::Loop,
        fallback: "".into(),
        exhaustion: ExhaustionMode::Once,
        on_exhausted: vec![],
    }
}
fn increment(name: &str) -> Effect {
    Effect::UpdateVariable {
        name: name.into(),
        op: ArithmeticOperation::Add,
        operand: NumericOperand::Literal { value: 1 },
    }
}
fn procedure(id: &str, effects: Vec<Effect>) -> Procedure {
    Procedure {
        id: id.into(),
        name: id.into(),
        description: String::new(),
        inputs: vec![],
        effects,
    }
}
fn flow(p: &mut Project, id: &str, effects: Vec<Effect>) {
    p.game
        .actions
        .iter_mut()
        .find(|action| action.id == id)
        .unwrap()
        .effects = effects;
}
fn world() -> Project {
    let mut p = Project::blank("Procedures");
    p.locations[0].id = "room".into();
    p.locations[0].actions.clear();
    p.game.starting_location = "room".into();
    p.game.variables = [
        ("amount".into(), Value::Integer(999)),
        ("runs".into(), Value::Integer(0)),
        ("commands".into(), Value::Integer(0)),
    ]
    .into();
    for (id, name) in [("keeper", "Keeper <red> & %amount%"), ("guide", "Guide")] {
        p.characters.push(Character {
            id: id.into(),
            name: name.into(),
            location: "room".into(),
            state: [("coins".into(), Value::Integer(0))].into(),
            ..Default::default()
        });
    }
    for id in ["bonus", "other", "reset", "fail"] {
        p.game.actions.push(Action {
            id: id.into(),
            verb: "use".into(),
            pattern: vec![PatternPart::Literal { text: id.into() }],
            ..Default::default()
        });
    }
    let mut recipient = input("recipient", InputKind::Character);
    recipient
        .required_properties
        .insert("coins".into(), InputKind::Integer);
    p.procedures.push(Procedure {
        id: "award".into(),
        name: "Award coins".into(),
        description: String::new(),
        inputs: vec![recipient, input("amount", InputKind::Integer)],
        effects: vec![
            Effect::UpdateProperty {
                entity: reference("recipient"),
                name: "coins".into(),
                op: ArithmeticOperation::Add,
                operand: NumericOperand::Input {
                    input: "amount".into(),
                },
            },
            Effect::Say {
                text: message(
                    "%recipient-ref% receives %amount-ref%. Global %amount%.",
                    [("recipient-ref", "recipient"), ("amount-ref", "amount")],
                ),
            },
            respond("award-reply"),
        ],
    });
    flow(
        &mut p,
        "bonus",
        vec![award(
            "bonus-call",
            entity(InputKind::Character, "keeper"),
            literal(5),
        )],
    );
    flow(
        &mut p,
        "other",
        vec![award(
            "other-call",
            entity(InputKind::Character, "keeper"),
            literal(5),
        )],
    );
    p
}
fn start(p: Project) -> Session {
    let diagnostics = validate(&p);
    assert!(!has_errors(&diagnostics), "{diagnostics:#?}");
    Session::start(p, None).unwrap().0
}
fn output(result: &CommandResult) -> String {
    result
        .messages
        .iter()
        .map(|line| text::plain(line))
        .collect::<Vec<_>>()
        .join("\n")
}
fn command(session: &mut Session, input: &str) -> CommandResult {
    let result = session.command_explained(input);
    assert_ne!(
        result.status,
        CommandStatus::Error,
        "{:?}",
        result.explanation
    );
    result
}

#[test]
fn two_callers_share_one_definition_and_keep_independent_progress_with_identical_arguments() {
    let mut s = start(world());
    let first = command(&mut s, "use bonus");
    let other = command(&mut s, "use other");
    let second = command(&mut s, "use bonus");
    assert!(output(&first).contains("Reply one"));
    assert!(output(&other).contains("Reply one"));
    assert!(output(&second).contains("Reply two"));
    assert_eq!(s.state().properties["keeper"]["coins"], Value::Integer(15));
    assert_eq!(s.state().variables["amount"], Value::Integer(999));
    assert!(output(&first).contains("Keeper <red> & %amount% receives 5. Global 999."));
    assert_eq!(s.state().procedure_sequences.len(), 2);
    assert!(s.state().sequences.is_empty());
    let trace = first.explanation.unwrap();
    let step = trace
        .steps
        .iter()
        .find(|step| matches!(step.kind, TraceKind::Call { .. }))
        .unwrap();
    assert_eq!(step.source.as_ref().unwrap().subject, "bonus");
    assert_eq!(step.source.as_ref().unwrap().path, "effects.0");
    assert!(
        matches!(&step.kind, TraceKind::Call { definition, arguments, returned: Some(ProcedureReturn::Returned), .. } if definition.subject == "award" && arguments.len() == 2)
    );
}
#[test]
fn nested_forwarding_includes_the_full_path_and_restores_parent_bindings() {
    let mut p = world();
    let mut outer = procedure(
        "outer",
        vec![
            award("inner-call", local("recipient"), local("amount")),
            Effect::Say {
                text: message("Parent %parent-ref%.", [("parent-ref", "amount")]),
            },
        ],
    );
    outer.inputs = p.procedures[0].inputs.clone();
    p.procedures.push(outer);
    flow(
        &mut p,
        "bonus",
        vec![call(
            "outer-one",
            "outer",
            [
                ("recipient", entity(InputKind::Character, "keeper")),
                ("amount", literal(3)),
            ],
        )],
    );
    flow(
        &mut p,
        "other",
        vec![call(
            "outer-two",
            "outer",
            [
                ("recipient", entity(InputKind::Character, "keeper")),
                ("amount", literal(3)),
            ],
        )],
    );
    let mut s = start(p);
    assert!(output(&command(&mut s, "use bonus")).ends_with("Reply one\nParent 3."));
    assert!(output(&command(&mut s, "use other")).contains("Reply one"));
    assert!(output(&command(&mut s, "use bonus")).contains("Reply two"));
    assert!(
        s.state()
            .procedure_sequences
            .keys()
            .all(|path| path.calls.len() == 2)
    );
}
#[test]
fn input_rename_and_reorder_preserve_arguments_messages_and_saved_progress() {
    let p = world();
    let mut s = start(p.clone());
    command(&mut s, "use bonus");
    let state = s.into_state();
    let mut renamed = p;
    renamed.procedures[0].name = "Award reward".into();
    renamed.procedures[0].inputs[1].name = "reward".into();
    renamed.procedures[0].inputs.reverse();
    let mut s = Session::restore(renamed, state).unwrap();
    assert!(output(&command(&mut s, "use bonus")).contains("receives 5. Global 999.\nReply two"));
}
#[test]
fn changing_arguments_at_one_occurrence_keeps_its_cursor() {
    let mut p = world();
    let mut s = start(p.clone());
    command(&mut s, "use bonus");
    let state = s.into_state();
    flow(
        &mut p,
        "bonus",
        vec![award(
            "bonus-call",
            entity(InputKind::Character, "guide"),
            literal(2),
        )],
    );
    let mut s = Session::restore(p, state).unwrap();
    assert!(output(&command(&mut s, "use bonus")).contains("Reply two"));
    assert_eq!(s.state().properties["guide"]["coins"], Value::Integer(2));
    assert!(output(&command(&mut s, "use other")).contains("Reply one"));
}
#[test]
fn stop_in_a_native_if_returns_from_only_the_current_procedure() {
    let mut p = world();
    p.procedures.extend([
        procedure(
            "inner",
            vec![
                Effect::If {
                    condition: Condition::True,
                    then: vec![Effect::Stop],
                    otherwise: vec![],
                },
                say("UNREACHABLE inner"),
            ],
        ),
        procedure(
            "outer",
            vec![
                call("nested", "inner", []),
                say("Outer resumed"),
                Effect::Stop,
                say("UNREACHABLE outer"),
            ],
        ),
    ]);
    flow(
        &mut p,
        "bonus",
        vec![call("outer-call", "outer", []), say("Caller resumed")],
    );
    flow(
        &mut p,
        "other",
        vec![Effect::Stop, say("UNREACHABLE caller")],
    );
    let mut s = start(p);
    let result = command(&mut s, "use bonus");
    assert_eq!(output(&result), "Outer resumed\nCaller resumed");
    assert!(output(&command(&mut s, "use other")).is_empty());
    assert_eq!(
        result
            .explanation
            .unwrap()
            .steps
            .iter()
            .filter(|step| matches!(
                step.kind,
                TraceKind::Call {
                    returned: Some(ProcedureReturn::Stopped),
                    ..
                }
            ))
            .count(),
        2
    );
}
#[test]
fn endings_propagate_and_ending_handlers_can_call_a_different_procedure() {
    let mut p = world();
    p.game.endings.push(Ending {
        id: "finish".into(),
        name: "Finish".into(),
        text: "The end.".into(),
        outcome: None,
    });
    p.procedures.extend([
        procedure(
            "end-inner",
            vec![
                Effect::End {
                    ending: "finish".into(),
                },
                increment("runs"),
            ],
        ),
        procedure(
            "end-outer",
            vec![call("end-inner-call", "end-inner", []), increment("runs")],
        ),
        procedure("finalize", vec![increment("commands")]),
    ]);
    flow(
        &mut p,
        "bonus",
        vec![call("end-outer-call", "end-outer", []), increment("runs")],
    );
    p.game.triggers.push(Trigger {
        id: "ending-hook".into(),
        name: "Ending".into(),
        event: Event::Ending,
        effects: vec![call("finalize-call", "finalize", [])],
        ..Default::default()
    });
    let mut s = start(p);
    assert_eq!(output(&command(&mut s, "use bonus")), "The end.");
    assert_eq!(s.state().ending.as_deref(), Some("finish"));
    assert_eq!(s.state().variables["runs"], Value::Integer(0));
    assert_eq!(s.state().variables["commands"], Value::Integer(1));
}
#[test]
fn callers_and_numeric_body_uses_are_checked_before_start() {
    for recipient in [
        literal(5),
        entity(InputKind::Object, "keeper"),
        entity(InputKind::Character, "missing"),
    ] {
        let mut p = world();
        flow(
            &mut p,
            "bonus",
            vec![award("bad-call", recipient, literal(1))],
        );
        assert!(GameDefinition::new(p).is_err());
    }
    let mut p = world();
    p.characters[0]
        .state
        .insert("coins".into(), Value::Text("wrong type".into()));
    assert!(GameDefinition::new(p).is_err());
    let mut p = world();
    p.procedures[0].inputs[1].kind = InputKind::Text;
    assert!(GameDefinition::new(p).is_err());
    let mut p = world();
    p.procedures[0].inputs[0].required_properties.clear();
    assert!(
        GameDefinition::new(p).is_err(),
        "Body property access must declare a contract"
    );
}
#[test]
fn forwarding_requires_a_declared_property_contract() {
    let mut p = world();
    let mut weak = procedure(
        "weak",
        vec![award("forward", local("recipient"), local("amount"))],
    );
    weak.inputs = p.procedures[0].inputs.clone();
    weak.inputs[0].required_properties.clear();
    p.procedures.push(weak);
    flow(
        &mut p,
        "bonus",
        vec![call(
            "weak-call",
            "weak",
            [
                ("recipient", entity(InputKind::Character, "keeper")),
                ("amount", literal(1)),
            ],
        )],
    );
    assert!(GameDefinition::new(p).is_err());
}
#[test]
fn all_six_input_kinds_and_variable_property_arguments_preserve_literal_text() {
    let mut p = world();
    p.objects.push(Object {
        id: "token".into(),
        name: "Token".into(),
        placement: Placement::Inventory,
        ..Default::default()
    });
    p.game.variables.insert("flag".into(), Value::Bool(true));
    let mut typed = procedure(
        "typed",
        vec![Effect::Say {
            text: message(
                "%o% %c% %l% %b% %n% %t%.",
                [
                    ("o", "o"),
                    ("c", "c"),
                    ("l", "l"),
                    ("b", "b"),
                    ("n", "n"),
                    ("t", "t"),
                ],
            ),
        }],
    );
    typed.inputs = [
        ("o", InputKind::Object),
        ("c", InputKind::Character),
        ("l", InputKind::Location),
        ("b", InputKind::Boolean),
        ("n", InputKind::Integer),
        ("t", InputKind::Text),
    ]
    .into_iter()
    .map(|(id, kind)| input(id, kind))
    .collect();
    p.procedures.push(typed);
    flow(
        &mut p,
        "bonus",
        vec![call(
            "typed-call",
            "typed",
            [
                ("o", entity(InputKind::Object, "token")),
                ("c", entity(InputKind::Character, "guide")),
                ("l", entity(InputKind::Location, "room")),
                (
                    "b",
                    Argument::Variable {
                        name: "flag".into(),
                    },
                ),
                (
                    "n",
                    Argument::Property {
                        entity: "keeper".into(),
                        name: "coins".into(),
                    },
                ),
                (
                    "t",
                    Argument::Literal {
                        value: Value::Text("<red> & %amount%".into()),
                    },
                ),
            ],
        )],
    );
    let mut s = start(p);
    let output = output(&command(&mut s, "use bonus"));
    assert!(output.starts_with("Token Guide "));
    assert!(output.ends_with("true 0 <red> & %amount%."));
}
#[test]
fn scalar_capture_and_live_entity_properties_survive_value_watch_calls() {
    let mut p = world();
    flow(
        &mut p,
        "bonus",
        vec![award(
            "bonus-call",
            entity(InputKind::Character, "keeper"),
            Argument::Variable {
                name: "amount".into(),
            },
        )],
    );
    p.game.triggers.push(Trigger {
        id: "watch".into(),
        name: "Coins".into(),
        watch: Some(TriggerWatch {
            target: ValueTarget::Property {
                entity: "keeper".into(),
                name: "coins".into(),
            },
            mode: WatchMode::EachChange,
        }),
        effects: vec![
            Effect::SetVariable {
                name: "amount".into(),
                value: Value::Integer(1),
            },
            say("Event global %amount%."),
            call("event-call", "event", []),
        ],
        ..Default::default()
    });
    p.procedures
        .push(procedure("event", vec![respond("event-reply")]));
    p.procedures[0].effects.push(Effect::Say {
        text: MessageText::Bound {
            text: "Live %live%.".into(),
            references: [(
                "live".into(),
                InputTextReference::ProcedureProperty {
                    input: "recipient".into(),
                    name: "coins".into(),
                },
            )]
            .into(),
        },
    });
    let mut s = start(p);
    let output = output(&command(&mut s, "use bonus"));
    assert!(output.contains("Event global 1.\nReply one"));
    assert!(output.contains("receives 999. Global 1."));
    assert!(output.ends_with("Live 999."));
    assert!(
        s.state()
            .procedure_sequences
            .keys()
            .any(|path| path.root == "watch" && path.calls == ["event-call"])
    );
}
#[test]
fn event_handlers_and_callees_cannot_capture_implicit_local_or_command_inputs() {
    let mut p = world();
    p.game.triggers.push(Trigger {
        id: "escaped".into(),
        name: "Escaped".into(),
        event: Event::Command,
        effects: vec![Effect::Say {
            text: message("%escaped%", [("escaped", "amount")]),
        }],
        ..Default::default()
    });
    assert!(GameDefinition::new(p).is_err());
    let mut p = world();
    p.procedures[0].effects.push(Effect::Transfer {
        object: ObjectTarget::command_item(),
        placement: ScopedPlacement::Inventory,
    });
    assert!(GameDefinition::new(p).is_err());
}
#[test]
fn command_item_is_explicitly_forwarded_and_restored_for_the_caller() {
    let mut p = world();
    p.vocabulary.push(Verb {
        id: "put".into(),
        canonical: "put".into(),
        ..Default::default()
    });
    let mut table = Object {
        id: "table".into(),
        name: "Table".into(),
        placement: Placement::Inventory,
        storage: Some(ObjectStorage {
            surface: true,
            ..Default::default()
        }),
        ..Default::default()
    };
    let mut action = standard_action(&table, StandardInteraction::PutOn, "put");
    action.effects.insert(
        0,
        call("item-call", "item", [("item", Argument::CommandItem)]),
    );
    table.actions.push(action);
    p.objects.push(table);
    p.objects.push(Object {
        id: "coin".into(),
        name: "Coin".into(),
        placement: Placement::Inventory,
        portable: true,
        ..Default::default()
    });
    let mut item = procedure(
        "item",
        vec![Effect::Say {
            text: message("%name%", [("name", "item")]),
        }],
    );
    item.inputs.push(input("item", InputKind::Object));
    p.procedures.push(item);
    let mut s = start(p);
    assert!(output(&command(&mut s, "put coin on table")).starts_with("Coin\n"));
    assert_eq!(
        s.state().objects["coin"].placement,
        Placement::On {
            object: "table".into()
        }
    );
}
#[test]
fn callback_reentry_errors_and_rolls_back_the_whole_command() {
    let mut p = world();
    p.procedures[0].effects.insert(0, say("Discard this."));
    p.game.triggers.push(Trigger {
        id: "watch".into(),
        name: "Recursive watch".into(),
        watch: Some(TriggerWatch {
            target: ValueTarget::Property {
                entity: "keeper".into(),
                name: "coins".into(),
            },
            mode: WatchMode::EachChange,
        }),
        effects: vec![award(
            "watch-call",
            entity(InputKind::Character, "keeper"),
            literal(1),
        )],
        ..Default::default()
    });
    let mut s = start(p);
    let before = s.state().clone();
    let result = s.command_explained("use bonus");
    assert_eq!(result.status, CommandStatus::Error);
    assert_eq!(s.state(), &before);
    assert!(result.messages.is_empty());
    let trace = result.explanation.unwrap();
    assert!(trace.error.unwrap().contains("re-entry"));
    assert!(!trace.discarded_messages.is_empty());
}
#[test]
fn direct_indirect_and_conditionally_unreachable_recursion_are_rejected() {
    let mut p = world();
    p.procedures.push(procedure(
        "cycle",
        vec![Effect::If {
            condition: Condition::False,
            then: vec![call("self-call", "cycle", [])],
            otherwise: vec![],
        }],
    ));
    assert!(GameDefinition::new(p).is_err());
    let mut p = world();
    p.procedures.extend([
        procedure("cycle-a", vec![call("ab", "cycle-b", [])]),
        procedure("cycle-b", vec![call("ba", "cycle-a", [])]),
    ]);
    assert!(GameDefinition::new(p).is_err());
}
#[test]
fn calls_and_effects_share_the_operation_budget_without_expanding_large_dags() {
    let mut p = world();
    p.procedures.push(procedure("noop", vec![]));
    flow(
        &mut p,
        "bonus",
        (0..2050)
            .map(|i| call(&format!("noop-{i}"), "noop", []))
            .collect(),
    );
    let mut s = start(p);
    let before = s.state().clone();
    assert!(
        s.command("use bonus")
            .unwrap_err()
            .to_string()
            .contains("2048 operations")
    );
    assert_eq!(s.state(), &before);
    let mut p = world();
    for i in 0..30 {
        let effects = if i == 29 {
            vec![]
        } else {
            (0..2)
                .map(|j| call(&format!("call-{i}-{j}"), &format!("proc-{}", i + 1), []))
                .collect()
        };
        p.procedures.push(procedure(&format!("proc-{i}"), effects));
    }
    let s = start(p);
    assert!(s.state().procedure_sequences.is_empty());
}
#[test]
fn call_depth_is_bounded_by_the_same_event_nesting_limit() {
    let mut p = world();
    for i in 0..65 {
        let effects = if i == 64 {
            vec![]
        } else {
            vec![call(&format!("nested-{i}"), &format!("proc-{}", i + 1), [])]
        };
        p.procedures.push(procedure(&format!("proc-{i}"), effects));
    }
    flow(&mut p, "bonus", vec![call("depth-root", "proc-0", [])]);
    let mut s = start(p);
    let before = s.state().clone();
    assert!(
        s.command("use bonus")
            .unwrap_err()
            .to_string()
            .contains("64 nested")
    );
    assert_eq!(s.state(), &before);
}
#[test]
fn duplicate_call_ids_missing_extra_arguments_and_coercion_are_rejected() {
    let mut p = world();
    flow(
        &mut p,
        "other",
        vec![award(
            "bonus-call",
            entity(InputKind::Character, "keeper"),
            literal(1),
        )],
    );
    assert!(GameDefinition::new(p).is_err());
    let mut p = world();
    flow(&mut p, "bonus", vec![call("missing", "award", [])]);
    assert!(GameDefinition::new(p).is_err());
    let mut p = world();
    flow(
        &mut p,
        "bonus",
        vec![award(
            "coercion",
            entity(InputKind::Character, "keeper"),
            Argument::Literal {
                value: Value::Text("5".into()),
            },
        )],
    );
    assert!(GameDefinition::new(p).is_err());
    let mut p = world();
    if let Effect::Call { arguments, .. } = &mut p.game.actions[0].effects[0] {
        arguments.insert("extra".into(), literal(1));
    }
    assert!(GameDefinition::new(p).is_err());
}
#[test]
fn typed_comparisons_assignments_and_local_speech_use_the_existing_effect_chain() {
    let mut p = world();
    p.procedures[0].effects = vec![Effect::If {
        condition: Condition::Compare {
            left: local("amount"),
            op: Comparison::Gt,
            right: literal(0),
        },
        then: vec![
            Effect::Assign {
                target: ScopedValueTarget::Property {
                    entity: reference("recipient"),
                    name: "coins".into(),
                },
                value: local("amount"),
            },
            Effect::Assign {
                target: ScopedValueTarget::Variable {
                    name: "runs".into(),
                },
                value: local("amount"),
            },
            Effect::CharacterSays {
                character: reference("recipient"),
                text: message("Thanks for %reward%.", [("reward", "amount")]),
            },
        ],
        otherwise: vec![say("No reward.")],
    }];
    let mut s = start(p);
    assert!(
        output(&command(&mut s, "use bonus"))
            .contains("Keeper <red> & %amount% says: Thanks for 5.")
    );
    assert_eq!(s.state().variables["runs"], Value::Integer(5));
    assert_eq!(s.state().properties["keeper"]["coins"], Value::Integer(5));
}
#[test]
fn nested_responses_exhaustion_and_reset_are_scoped_to_the_current_invocation() {
    let mut p = world();
    p.procedures[0].effects = vec![Effect::If {
        condition: Condition::True,
        then: vec![Effect::Respond {
            id: "nested-reply".into(),
            responses: vec!["First".into()],
            mode: SequenceMode::Fallback,
            fallback: "Reset".into(),
            exhaustion: ExhaustionMode::Once,
            on_exhausted: vec![
                Effect::ResetResponses {
                    sequence: "nested-reply".into(),
                },
                call("exhaustion-call", "followup", []),
            ],
        }],
        otherwise: vec![],
    }];
    p.procedures
        .push(procedure("followup", vec![increment("runs")]));
    let mut s = start(p.clone());
    for (input, expected) in [
        ("use bonus", "First"),
        ("use other", "First"),
        ("use bonus", "Reset"),
        ("use bonus", "First"),
        ("use other", "Reset"),
    ] {
        assert_eq!(output(&command(&mut s, input)), expected);
    }
    assert_eq!(s.state().variables["runs"], Value::Integer(2));
    s.definition().validate_state(s.state()).unwrap();
    flow(
        &mut p,
        "reset",
        vec![Effect::ResetResponses {
            sequence: "nested-reply".into(),
        }],
    );
    assert!(GameDefinition::new(p).is_err());
}
#[test]
fn structured_progress_survives_json_and_rejects_removed_paths_or_corruption() {
    let p = world();
    let mut s = start(p.clone());
    command(&mut s, "use bonus");
    let bytes = serde_json::to_vec(s.state()).unwrap();
    let state: GameState = serde_json::from_slice(&bytes).unwrap();
    let mut restored = Session::restore(p.clone(), state).unwrap();
    assert!(output(&command(&mut restored, "use bonus")).contains("Reply two"));
    assert!(output(&command(&mut restored, "use other")).contains("Reply one"));
    for kind in 0..5 {
        let mut raw: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
        match kind {
            0 => raw["procedure_sequences"][0]["cursor"] = 999.into(),
            1 => raw["procedure_sequences"][0]["path"]["root"] = "missing".into(),
            2 => raw["procedure_sequences"][0]["path"]["calls"][0] = "missing".into(),
            3 => raw["procedure_sequences"][0]["path"]["sequence"] = "missing".into(),
            _ => {
                let duplicate = raw["procedure_sequences"][0].clone();
                raw["procedure_sequences"]
                    .as_array_mut()
                    .unwrap()
                    .push(duplicate);
            }
        };
        match serde_json::from_value::<GameState>(raw) {
            Ok(state) => assert!(Session::restore(p.clone(), state).is_err()),
            Err(_) => assert_eq!(kind, 4),
        }
    }
    let mut incompatible = p;
    incompatible.game.actions[0].effects.clear();
    assert!(Session::restore(incompatible, serde_json::from_slice(&bytes).unwrap()).is_err());
    assert_eq!(bytes, serde_json::to_vec(s.state()).unwrap());
}
#[test]
fn failed_reply_rolls_back_progress_output_world_and_parser_context() {
    for explained in [false, true] {
        let mut p = world();
        for (id, name) in [("brass", "Brass key"), ("iron", "Iron key")] {
            p.objects.push(Object {
                id: id.into(),
                name: name.into(),
                aliases: vec!["key".into()],
                placement: Placement::Inventory,
                actions: vec![Action {
                    id: format!("examine-{id}"),
                    verb: "examine".into(),
                    pattern: vec![PatternPart::Entity { entity: id.into() }],
                    effects: if id == "brass" {
                        vec![
                            award(
                                "bad-call",
                                entity(InputKind::Character, "keeper"),
                                literal(5),
                            ),
                            Effect::UpdateVariable {
                                name: "runs".into(),
                                op: ArithmeticOperation::Divide,
                                operand: NumericOperand::Variable {
                                    name: "runs".into(),
                                },
                            },
                        ]
                    } else {
                        vec![]
                    },
                    ..Default::default()
                }],
                ..Default::default()
            });
        }
        let mut s = start(p);
        command(&mut s, "examine key");
        let question = s.pending_clarification();
        assert!(question.is_some());
        let before = s.state().clone();
        if explained {
            let result = s.command_explained("brass");
            assert_eq!(result.status, CommandStatus::Error);
            assert!(result.messages.is_empty());
            assert!(!result.explanation.unwrap().discarded_messages.is_empty());
        } else {
            assert!(s.command("brass").is_err());
        }
        assert_eq!(s.state(), &before);
        assert_eq!(s.pending_clarification(), question);
    }
}
#[test]
fn startup_restore_parity_and_once_only_command_events_use_public_sessions() {
    let mut p = world();
    p.game.triggers.push(Trigger {
        id: "start-hook".into(),
        name: "Start".into(),
        event: Event::Start,
        effects: vec![award(
            "start-call",
            entity(InputKind::Character, "keeper"),
            literal(1),
        )],
        ..Default::default()
    });
    p.game.triggers.push(Trigger {
        id: "command-hook".into(),
        name: "Command".into(),
        event: Event::Command,
        effects: vec![increment("commands")],
        ..Default::default()
    });
    let (mut ordinary, _) = Session::start(p.clone(), None).unwrap();
    assert_eq!(
        ordinary.state().properties["keeper"]["coins"],
        Value::Integer(1)
    );
    let snapshot = ordinary.state().clone();
    let mut explained = Session::restore(p.clone(), snapshot.clone()).unwrap();
    assert_eq!(explained.state(), &snapshot);
    explained.resume_messages().unwrap();
    assert_eq!(explained.state(), &snapshot);
    for input in ["use bonus", "use other", "use bonus"] {
        let a = ordinary.command(input).unwrap();
        let b = command(&mut explained, input);
        assert_eq!(a.messages, b.messages);
        assert_eq!(ordinary.state(), explained.state());
    }
    assert_eq!(ordinary.state().variables["commands"], Value::Integer(3));
    let mut punctuation = p;
    punctuation.procedures.extend([
        procedure("leaf", vec![respond("reply.a.b")]),
        procedure("one", vec![call("c", "leaf", [])]),
        procedure("two", vec![call("b.c", "leaf", [])]),
    ]);
    flow(
        &mut punctuation,
        "bonus",
        vec![call("a.b", "one", []), call("a", "two", [])],
    );
    let mut s = start(punctuation);
    assert!(output(&command(&mut s, "use bonus")).contains("Reply one\nReply one"));
    assert_eq!(s.state().procedure_sequences.len(), 3);
    s.definition().validate_state(s.state()).unwrap();
}

#[test]
fn cursor_only_calls_change_state_and_native_event_sequences_keep_their_ordinary_map() {
    let mut p = world();
    p.procedures[0].effects = vec![respond("award-reply")];
    p.game.triggers.push(Trigger {
        id: "native-event".into(),
        name: "Native event".into(),
        event: Event::Command,
        effects: vec![respond("ordinary-reply")],
        ..Default::default()
    });
    let mut s = start(p);
    let result = command(&mut s, "use bonus");
    assert!(result.state_changed);
    assert_eq!(s.state().sequences["ordinary-reply"], 1);
    assert_eq!(s.state().procedure_sequences.len(), 1);
    command(&mut s, "use other");
    assert_eq!(s.state().sequences["ordinary-reply"], 0);
    assert_eq!(s.state().procedure_sequences.len(), 2);
    s.definition().validate_state(s.state()).unwrap();
}
