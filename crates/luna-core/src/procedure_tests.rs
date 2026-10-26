//! R1 candidate regressions. R2 promotes these through public canonical content.
use super::*;
use crate::runtime::procedure_proof::*;
use luna_model::*;
use serde::{Deserialize, Serialize};
use std::{collections::BTreeMap, sync::Arc};

struct Proof {
    session: Session,
    program: Arc<Program>,
    progress: Progress,
}
#[derive(Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Snapshot {
    state: GameState,
    procedure_sequences: Vec<Cursor>,
}
impl Proof {
    fn new(project: Project, program: Program) -> Self {
        program.validate().unwrap();
        Self {
            session: Session::start(project, None).unwrap().0,
            program: Arc::new(program),
            progress: BTreeMap::new(),
        }
    }
    fn attempt(&mut self, input: &str, explain: bool) -> (CommandResult, Option<anyhow::Error>) {
        let mut progress = self.progress.clone();
        let program = self.program.clone();
        let (result, error) = self.session.execute_with(input, explain, |run| {
            run.procedures = Some(Execution::new(program, progress.clone()));
            let result = run.command(input);
            progress = run.procedures.take().unwrap().progress;
            result
        });
        // Candidate progress lives outside v3 state. Its commit is explicitly
        // contingent on the SAME Session result. R2 puts it into GameState.
        if error.is_none() {
            self.progress = progress;
        }
        (result, error)
    }
    fn command(&mut self, input: &str) -> CommandResult {
        let (result, error) = self.attempt(input, true);
        assert!(error.is_none(), "{error:?}");
        result
    }
    fn snapshot(&self) -> Snapshot {
        Snapshot {
            state: self.session.state().clone(),
            procedure_sequences: rows(&self.progress),
        }
    }
    fn restore(project: Project, program: Program, snapshot: Snapshot) -> Result<Self> {
        program.validate()?;
        let progress = program.validate_progress(&snapshot.procedure_sequences)?;
        let session = Session::restore(project, snapshot.state)?;
        Ok(Self {
            session,
            program: Arc::new(program),
            progress,
        })
    }
}
fn respond(id: &str) -> Step {
    native(Effect::Respond {
        id: id.into(),
        responses: vec!["Reply one".into(), "Reply two".into()],
        mode: SequenceMode::Loop,
        fallback: String::new(),
        exhaustion: ExhaustionMode::Once,
        on_exhausted: vec![],
    })
}
fn bonus_call(id: &str, recipient: Argument, amount: Argument) -> Step {
    call(id, "award", [("recipient", recipient), ("amount", amount)])
}
fn program() -> Program {
    let mut recipient = input("recipient", Kind::Character);
    recipient
        .required_properties
        .insert("coins".into(), Kind::Integer);
    Program {
        definitions: [(
            "award".into(),
            Procedure {
                id: "award".into(),
                name: "Award coins".into(),
                inputs: vec![recipient, input("amount", Kind::Integer)],
                effects: vec![
                    Step::AddProperty {
                        entity: local("recipient"),
                        name: "coins".into(),
                        amount: local("amount"),
                    },
                    Step::Say {
                        text: "%local-recipient% receives %local-amount%. Global %amount%.".into(),
                        references: [
                            ("local-recipient".into(), local("recipient")),
                            ("local-amount".into(), local("amount")),
                        ]
                        .into(),
                    },
                    respond("reply.with.dots"),
                ],
            },
        )]
        .into(),
        flows: [
            (
                "bonus".into(),
                vec![bonus_call(
                    "action-call",
                    entity(Kind::Character, "keeper"),
                    literal(5),
                )],
            ),
            (
                "other".into(),
                vec![bonus_call(
                    "other-call",
                    entity(Kind::Character, "keeper"),
                    literal(5),
                )],
            ),
        ]
        .into(),
    }
}
fn transcript(result: &CommandResult) -> String {
    result
        .messages
        .iter()
        .map(|line| text::plain(line))
        .collect::<Vec<_>>()
        .join("\n")
}
fn increment(name: &str) -> Step {
    native(Effect::UpdateVariable {
        name: name.into(),
        op: ArithmeticOperation::Add,
        operand: NumericOperand::Literal { value: 1 },
    })
}
fn no_input(id: &str, effects: Vec<Step>) -> Procedure {
    Procedure {
        id: id.into(),
        name: id.into(),
        inputs: vec![],
        effects,
    }
}

#[test]
fn two_callers_share_definition_but_not_cursor_or_parameter_values() {
    let mut proof = Proof::new(project(), program());
    let first = proof.command("use bonus");
    let other = proof.command("use other");
    let second = proof.command("use bonus");
    assert!(transcript(&first).contains("Reply one"));
    assert!(transcript(&other).contains("Reply one"));
    assert!(transcript(&second).contains("Reply two"));
    assert_eq!(
        proof.session.state.properties["keeper"]["coins"],
        Value::Integer(15)
    );
    assert_eq!(proof.session.state.variables["amount"], Value::Integer(999));
    assert!(transcript(&first).contains("Keeper <red> & %amount% receives 5. Global 999."));
    assert_eq!(proof.progress.len(), 2);
    assert!(proof.session.state.sequences.is_empty());
    assert!(first.explanation.unwrap().steps.iter().any(|step| matches!(&step.kind, crate::TraceKind::Effect { effect } if effect.starts_with("CALL Award coins"))));
}
#[test]
fn nested_forwarding_uses_full_stable_path_and_restores_parent_bindings() {
    let mut program = program();
    let inputs = program.definitions["award"].inputs.clone();
    program.definitions.insert(
        "outer".into(),
        Procedure {
            id: "outer".into(),
            name: "Outer".into(),
            inputs,
            effects: vec![
                bonus_call("inner-call", local("recipient"), local("amount")),
                Step::Say {
                    text: "Parent %parent%.".into(),
                    references: [("parent".into(), local("amount"))].into(),
                },
            ],
        },
    );
    for (flow, id) in [("bonus", "outer-one"), ("other", "outer-two")] {
        program.flows.insert(
            flow.into(),
            vec![call(
                id,
                "outer",
                [
                    ("recipient", entity(Kind::Character, "keeper")),
                    ("amount", literal(3)),
                ],
            )],
        );
    }
    let mut proof = Proof::new(project(), program);
    assert!(transcript(&proof.command("use bonus")).contains("Reply one\nParent 3."));
    assert!(transcript(&proof.command("use other")).contains("Reply one"));
    assert!(transcript(&proof.command("use bonus")).contains("Reply two"));
    assert!(proof.progress.keys().all(|path| path.calls.len() == 2));
}
#[test]
fn stop_returns_from_only_current_procedure_and_native_if_propagates_it() {
    let mut program = Program::default();
    program.definitions.insert(
        "inner".into(),
        no_input(
            "inner",
            vec![
                native(Effect::If {
                    condition: Condition::True,
                    then: vec![Effect::Stop],
                    otherwise: vec![],
                }),
                native(Effect::Say {
                    text: "UNREACHABLE inner".into(),
                }),
            ],
        ),
    );
    program.definitions.insert(
        "outer".into(),
        no_input(
            "outer",
            vec![
                call("nested", "inner", []),
                native(Effect::Say {
                    text: "Outer resumed".into(),
                }),
                native(Effect::Stop),
                native(Effect::Say {
                    text: "UNREACHABLE outer".into(),
                }),
            ],
        ),
    );
    program.flows.insert(
        "bonus".into(),
        vec![
            call("outer-call", "outer", []),
            native(Effect::Say {
                text: "Caller resumed".into(),
            }),
        ],
    );
    program.flows.insert(
        "other".into(),
        vec![
            native(Effect::Stop),
            native(Effect::Say {
                text: "UNREACHABLE caller".into(),
            }),
        ],
    );
    let mut proof = Proof::new(project(), program);
    assert_eq!(
        transcript(&proof.command("use bonus")),
        "Outer resumed\nCaller resumed"
    );
    assert!(transcript(&proof.command("use other")).is_empty());
}
#[test]
fn ending_propagates_and_finalization_can_call_a_separate_procedure() {
    let mut project = project();
    project.game.endings.push(Ending {
        id: "finish".into(),
        name: "Finished".into(),
        text: "The end.".into(),
        outcome: None,
    });
    project.game.triggers.push(Trigger {
        id: "ending-hook".into(),
        name: "Ending".into(),
        event: Event::Ending,
        ..Default::default()
    });
    let mut program = Program::default();
    program.definitions.insert(
        "inner".into(),
        no_input(
            "inner",
            vec![
                native(Effect::End {
                    ending: "finish".into(),
                }),
                increment("runs"),
            ],
        ),
    );
    program.definitions.insert(
        "outer".into(),
        no_input(
            "outer",
            vec![call("inner-call", "inner", []), increment("runs")],
        ),
    );
    program.definitions.insert(
        "finalize".into(),
        no_input("finalize", vec![increment("commands")]),
    );
    program.flows.insert(
        "bonus".into(),
        vec![call("outer-call", "outer", []), increment("runs")],
    );
    program.flows.insert(
        "ending-hook".into(),
        vec![call("finalize-call", "finalize", [])],
    );
    let mut proof = Proof::new(project, program);
    let result = proof.command("use bonus");
    assert_eq!(proof.session.state.ending.as_deref(), Some("finish"));
    assert_eq!(proof.session.state.variables["runs"], Value::Integer(0));
    assert_eq!(proof.session.state.variables["commands"], Value::Integer(1));
    assert_eq!(transcript(&result), "The end.");
}
#[test]
fn typed_arguments_property_contracts_and_forwarded_guarantees_fail_atomically() {
    let cases = [
        literal(5),
        entity(Kind::Object, "keeper"),
        entity(Kind::Character, "missing"),
    ];
    for recipient in cases {
        let mut program = program();
        program.flows.insert(
            "bonus".into(),
            vec![bonus_call("bad-call", recipient, literal(1))],
        );
        let mut proof = Proof::new(project(), program);
        let before = proof.snapshot();
        assert!(proof.attempt("use bonus", true).1.is_some());
        assert_eq!(proof.snapshot(), before);
    }
    let mut project = project();
    project.characters[0]
        .state
        .insert("coins".into(), Value::Text("wrong type".into()));
    let mut proof = Proof::new(project, program());
    assert!(proof.attempt("use bonus", true).1.is_some());
    let mut program = program();
    let mut inputs = program.definitions["award"].inputs.clone();
    inputs[0].required_properties.clear();
    program.definitions.insert(
        "weak".into(),
        Procedure {
            id: "weak".into(),
            name: "Weak".into(),
            inputs,
            effects: vec![bonus_call("forward", local("recipient"), local("amount"))],
        },
    );
    program.flows.insert(
        "bonus".into(),
        vec![call(
            "weak-call",
            "weak",
            [
                ("recipient", entity(Kind::Character, "keeper")),
                ("amount", literal(1)),
            ],
        )],
    );
    let mut proof = Proof::new(crate::runtime::procedure_proof::project(), program);
    assert!(
        format!("{:#}", proof.attempt("use bonus", true).1.unwrap())
            .contains("Forwarded property contract")
    );
}
#[test]
fn scalar_values_capture_at_entry_entity_properties_stay_live_and_events_are_lexical() {
    let mut project = project();
    project.game.triggers.push(Trigger {
        id: "watch".into(),
        name: "Coins changed".into(),
        watch: Some(TriggerWatch {
            target: ValueTarget::Property {
                entity: "keeper".into(),
                name: "coins".into(),
            },
            mode: WatchMode::EachChange,
        }),
        ..Default::default()
    });
    let mut program = program();
    program.flows.insert(
        "bonus".into(),
        vec![bonus_call(
            "action-call",
            entity(Kind::Character, "keeper"),
            Argument::Variable {
                name: "amount".into(),
            },
        )],
    );
    program.flows.insert(
        "watch".into(),
        vec![
            native(Effect::SetVariable {
                name: "amount".into(),
                value: Value::Integer(1),
            }),
            native(Effect::Say {
                text: "Event global %amount%.".into(),
            }),
            call("event-call", "event", []),
        ],
    );
    program.definitions.insert(
        "event".into(),
        no_input("event", vec![respond("event-response")]),
    );
    program
        .definitions
        .get_mut("award")
        .unwrap()
        .effects
        .push(Step::Say {
            text: "Live %live%.".into(),
            references: [(
                "live".into(),
                Argument::Property {
                    entity: Box::new(local("recipient")),
                    name: "coins".into(),
                },
            )]
            .into(),
        });
    let mut proof = Proof::new(project, program);
    let result = proof.command("use bonus");
    let output = transcript(&result);
    assert!(output.contains("Event global 1.\nReply one"));
    assert!(output.contains("receives 999. Global 1."));
    assert!(output.contains("Live 999."));
    assert!(
        proof
            .progress
            .keys()
            .any(|path| path.root == "watch" && path.calls == ["event-call"])
    );
    let mut program = (*proof.program).clone();
    program.flows.insert(
        "watch".into(),
        vec![Step::Say {
            text: "%escaped%.".into(),
            references: [("escaped".into(), local("amount"))].into(),
        }],
    );
    let mut proof = Proof::new(proof.session.project().clone(), program);
    let before = proof.snapshot();
    assert!(proof.attempt("use bonus", true).1.is_some());
    assert_eq!(proof.snapshot(), before);
}
#[test]
fn event_recursion_is_rejected_even_when_the_static_call_graph_is_acyclic() {
    let mut project = project();
    project.game.triggers.push(Trigger {
        id: "watch".into(),
        name: "Recursive watch".into(),
        watch: Some(TriggerWatch {
            target: ValueTarget::Property {
                entity: "keeper".into(),
                name: "coins".into(),
            },
            mode: WatchMode::EachChange,
        }),
        ..Default::default()
    });
    let mut program = program();
    program.flows.insert(
        "watch".into(),
        vec![bonus_call(
            "event-call",
            entity(Kind::Character, "keeper"),
            literal(1),
        )],
    );
    let mut proof = Proof::new(project, program);
    let before = proof.snapshot();
    assert!(format!("{:#}", proof.attempt("use bonus", true).1.unwrap()).contains("re-entry"));
    assert_eq!(proof.snapshot(), before);
}
#[test]
fn direct_indirect_recursion_duplicate_ids_and_missing_arguments_are_rejected() {
    let mut direct = Program::default();
    direct
        .definitions
        .insert("a".into(), no_input("a", vec![call("self", "a", [])]));
    assert!(direct.validate().is_err());
    let mut indirect = Program::default();
    indirect
        .definitions
        .insert("a".into(), no_input("a", vec![call("ab", "b", [])]));
    indirect
        .definitions
        .insert("b".into(), no_input("b", vec![call("ba", "a", [])]));
    assert!(indirect.validate().is_err());
    let mut duplicate = program();
    duplicate.flows.insert(
        "outer".into(),
        vec![bonus_call(
            "action-call",
            entity(Kind::Character, "keeper"),
            literal(1),
        )],
    );
    assert!(duplicate.validate().is_err());
    let mut missing = program();
    missing
        .flows
        .insert("bonus".into(), vec![call("missing", "award", [])]);
    assert!(missing.validate().is_err());
}
#[test]
fn command_item_must_be_passed_explicitly_and_is_not_an_implicit_callee_binding() {
    let mut project = project();
    project.vocabulary.push(Verb {
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
    let action = standard_action(&table, StandardInteraction::PutOn, "put");
    let flow = action.id.clone();
    table.actions.push(action);
    project.objects.push(table);
    project.objects.push(Object {
        id: "coin".into(),
        name: "Coin".into(),
        placement: Placement::Inventory,
        portable: true,
        ..Default::default()
    });
    let mut program = Program::default();
    program.definitions.insert(
        "item".into(),
        Procedure {
            id: "item".into(),
            name: "Item".into(),
            inputs: vec![input("item", Kind::Object)],
            effects: vec![Step::Say {
                text: "%local-item%.".into(),
                references: [("local-item".into(), local("item"))].into(),
            }],
        },
    );
    program.flows.insert(
        flow.clone(),
        vec![
            call("item-call", "item", [("item", Argument::CommandItem)]),
            native(Effect::Transfer {
                object: ObjectTarget::command_item(),
                placement: Placement::On {
                    object: "table".into(),
                },
            }),
        ],
    );
    let mut proof = Proof::new(project, program);
    assert_eq!(transcript(&proof.command("put coin on table")), "Coin.");
    assert_eq!(
        proof.session.state.objects["coin"].placement,
        Placement::On {
            object: "table".into()
        }
    );
    let mut program = (*proof.program).clone();
    program
        .definitions
        .get_mut("item")
        .unwrap()
        .effects
        .push(native(Effect::Transfer {
            object: ObjectTarget::command_item(),
            placement: Placement::Inventory,
        }));
    let mut proof = Proof::new(proof.session.project().clone(), program);
    assert!(proof.attempt("put coin on table", true).1.is_some());
}
#[test]
fn errors_rollback_state_messages_progress_and_pending_parser_context() {
    for explain in [false, true] {
        let mut project = project();
        for (id, name) in [("brass", "Brass key"), ("iron", "Iron key")] {
            project.objects.push(Object {
                id: id.into(),
                name: name.into(),
                aliases: vec!["key".into()],
                placement: Placement::Inventory,
                actions: vec![Action {
                    id: format!("examine-{id}"),
                    verb: "examine".into(),
                    pattern: vec![PatternPart::Entity { entity: id.into() }],
                    ..Default::default()
                }],
                ..Default::default()
            });
        }
        let mut program = program();
        program.flows.insert(
            "examine-brass".into(),
            vec![
                bonus_call("bad-call", entity(Kind::Character, "keeper"), literal(5)),
                native(Effect::UpdateVariable {
                    name: "runs".into(),
                    op: ArithmeticOperation::Divide,
                    operand: NumericOperand::Literal { value: 0 },
                }),
            ],
        );
        let mut proof = Proof::new(project, program);
        proof.command("examine key");
        let before = proof.snapshot();
        let context = proof.session.context.clone();
        assert!(proof.session.pending_clarification().is_some());
        let (result, error) = proof.attempt("brass", explain);
        assert!(error.is_some());
        assert_eq!(proof.snapshot(), before);
        assert_eq!(proof.session.context, context);
        if explain {
            assert!(result.messages.is_empty());
            assert!(
                !result
                    .explanation
                    .as_ref()
                    .unwrap()
                    .discarded_messages
                    .is_empty()
            );
        }
    }
}
#[test]
fn calls_and_native_effects_share_the_operation_and_event_depth_budgets() {
    let mut program = Program::default();
    program
        .definitions
        .insert("noop".into(), no_input("noop", vec![]));
    program.flows.insert(
        "bonus".into(),
        (0..2050)
            .map(|i| call(&format!("call-{i}"), "noop", []))
            .collect(),
    );
    let mut proof = Proof::new(project(), program);
    assert!(
        format!("{:#}", proof.attempt("use bonus", false).1.unwrap()).contains("2048 operations")
    );
    let mut program = Program::default();
    for i in 0..65 {
        let effects = if i == 64 {
            vec![]
        } else {
            vec![call(&format!("nested-{i}"), &format!("proc-{}", i + 1), [])]
        };
        let id = format!("proc-{i}");
        program
            .definitions
            .insert(id.clone(), no_input(&id, effects));
    }
    program
        .flows
        .insert("bonus".into(), vec![call("root", "proc-0", [])]);
    let mut proof = Proof::new(project(), program);
    assert!(
        format!("{:#}", proof.attempt("use bonus", false).1.unwrap())
            .contains("64 nested events/calls")
    );
}
#[test]
fn reset_is_scoped_to_current_path_and_external_reset_is_rejected() {
    let mut program = program();
    program
        .definitions
        .get_mut("award")
        .unwrap()
        .effects
        .push(native(Effect::ResetResponses {
            sequence: "reply.with.dots".into(),
        }));
    program.flows.insert(
        "reset".into(),
        vec![native(Effect::ResetResponses {
            sequence: "reply.with.dots".into(),
        })],
    );
    let mut proof = Proof::new(project(), program);
    assert!(transcript(&proof.command("use bonus")).contains("Reply one"));
    assert!(transcript(&proof.command("use bonus")).contains("Reply one"));
    proof.command("use other");
    assert_eq!(proof.progress.len(), 2);
    let before = proof.snapshot();
    assert!(proof.attempt("use reset", true).1.is_some());
    assert_eq!(proof.snapshot(), before);
}
#[test]
fn structured_progress_roundtrips_without_replay_and_rejects_removed_paths_or_corruption() {
    let project = project();
    let program = program();
    let mut proof = Proof::new(project.clone(), program.clone());
    proof.command("use bonus");
    let bytes = serde_json::to_vec(&proof.snapshot()).unwrap();
    // Simulate an independent process: definitions and snapshot are separately
    // deserialized; restore executes no calls or opening/entry/ending effects.
    let program: Program = serde_json::from_slice(&serde_json::to_vec(&program).unwrap()).unwrap();
    let snapshot: Snapshot = serde_json::from_slice(&bytes).unwrap();
    let before = snapshot.state.clone();
    let mut restored = Proof::restore(project.clone(), program.clone(), snapshot).unwrap();
    assert_eq!(restored.session.state(), &before);
    assert!(transcript(&restored.command("use bonus")).contains("Reply two"));
    assert!(transcript(&restored.command("use other")).contains("Reply one"));
    for corrupt in [0, 1, 2, 3] {
        let mut snapshot: Snapshot = serde_json::from_slice(&bytes).unwrap();
        match corrupt {
            0 => snapshot.procedure_sequences[0].cursor = usize::MAX,
            1 => snapshot.procedure_sequences[0].path.calls[0] = "removed".into(),
            2 => snapshot
                .procedure_sequences
                .push(snapshot.procedure_sequences[0].clone()),
            _ => snapshot.procedure_sequences[0].path.sequence = "missing".into(),
        };
        assert!(Proof::restore(project.clone(), program.clone(), snapshot).is_err());
    }
    assert_eq!(
        bytes,
        serde_json::to_vec(&proof.snapshot()).unwrap(),
        "Failed loads cannot rewrite the saved bytes"
    );
    let mut renamed = program.clone();
    renamed.definitions.get_mut("award").unwrap().name = "Renamed".into();
    renamed
        .definitions
        .get_mut("award")
        .unwrap()
        .inputs
        .reverse();
    assert!(
        Proof::restore(
            project.clone(),
            renamed,
            serde_json::from_slice(&bytes).unwrap()
        )
        .is_ok()
    );
    let mut removed = program.clone();
    removed.flows.remove("bonus");
    assert!(Proof::restore(project, removed, serde_json::from_slice(&bytes).unwrap()).is_err());
}
#[test]
fn structured_ids_do_not_alias_and_large_dags_have_no_eager_progress() {
    let program = program();
    let mut proof = Proof::new(project(), program.clone());
    proof.command("use bonus");
    let snapshot = proof.snapshot();
    let mut rows = snapshot.procedure_sequences;
    rows[0].path.calls = vec!["a.b".into(), "c".into()];
    let mut other = rows[0].clone();
    other.path.calls = vec!["a".into(), "b.c".into()];
    assert_ne!(
        serde_json::to_string(&rows[0].path).unwrap(),
        serde_json::to_string(&other.path).unwrap()
    );
    let mut program = Program::default();
    for i in 0..30 {
        let mut effects = vec![];
        if i < 29 {
            for j in 0..2 {
                effects.push(call(
                    &format!("call-{i}-{j}"),
                    &format!("proc-{}", i + 1),
                    [],
                ));
            }
        }
        let id = format!("proc-{i}");
        program
            .definitions
            .insert(id.clone(), no_input(&id, effects));
    }
    program
        .flows
        .insert("bonus".into(), vec![call("root", "proc-0", [])]);
    let proof = Proof::new(project(), program);
    assert!(
        proof.progress.is_empty(),
        "Over a billion potential paths must not be preallocated"
    );
}
#[test]
fn explained_and_ordinary_commands_match_and_calls_do_not_multiply_command_events() {
    let mut project = project();
    project.game.triggers.push(Trigger {
        id: "command-hook".into(),
        name: "Command".into(),
        event: Event::Command,
        effects: vec![Effect::UpdateVariable {
            name: "commands".into(),
            op: ArithmeticOperation::Add,
            operand: NumericOperand::Literal { value: 1 },
        }],
        ..Default::default()
    });
    let mut ordinary = Proof::new(project.clone(), program());
    let mut explained = Proof::new(project, program());
    for input in ["use bonus", "use other", "use bonus"] {
        let (a, error) = ordinary.attempt(input, false);
        assert!(error.is_none());
        let b = explained.command(input);
        assert_eq!(a.messages, b.messages);
        assert_eq!(a.status, b.status);
        assert_eq!(ordinary.snapshot(), explained.snapshot());
    }
    assert_eq!(
        ordinary.session.state.variables["commands"],
        Value::Integer(3)
    );
}

#[test]
fn compile_checks_body_and_callers_including_forwarded_property_contracts() {
    let project = project();
    let valid = program();
    valid.validate_contracts(&project).unwrap();
    let mut external = valid.clone();
    external.flows.insert(
        "reset".into(),
        vec![native(Effect::ResetResponses {
            sequence: "reply.with.dots".into(),
        })],
    );
    assert!(external.validate_contracts(&project).is_err());
    let mut changed = valid.clone();
    changed.definitions.get_mut("award").unwrap().inputs[1].kind = Kind::Text;
    assert!(changed.validate_contracts(&project).is_err());
    let mut changed = valid.clone();
    changed.definitions.get_mut("award").unwrap().inputs[0]
        .required_properties
        .clear();
    assert!(
        changed.validate_contracts(&project).is_err(),
        "Body property use must require a declared contract"
    );
    let mut changed = valid.clone();
    changed.flows.insert(
        "bonus".into(),
        vec![bonus_call(
            "bad",
            entity(Kind::Character, "keeper"),
            Argument::Literal {
                value: Value::Text("5".into()),
            },
        )],
    );
    assert!(
        changed.validate_contracts(&project).is_err(),
        "There is no implicit numeric coercion"
    );
    let mut changed = valid.clone();
    changed
        .definitions
        .get_mut("award")
        .unwrap()
        .effects
        .push(Step::Say {
            text: "%item%.".into(),
            references: [("item".into(), Argument::CommandItem)].into(),
        });
    assert!(
        changed.validate_contracts(&project).is_err(),
        "Callee cannot capture a caller's command item"
    );
}
#[test]
fn all_six_input_kinds_accept_matching_values_and_reject_escaped_scope() {
    let mut project = project();
    project.objects.push(Object {
        id: "token".into(),
        name: "Token".into(),
        placement: Placement::Inventory,
        ..Default::default()
    });
    project
        .game
        .variables
        .insert("flag".into(), Value::Bool(true));
    let mut program = Program::default();
    program.definitions.insert(
        "typed".into(),
        Procedure {
            id: "typed".into(),
            name: "Typed".into(),
            inputs: vec![
                input("o", Kind::Object),
                input("c", Kind::Character),
                input("l", Kind::Location),
                input("b", Kind::Boolean),
                input("n", Kind::Integer),
                input("t", Kind::Text),
            ],
            effects: vec![Step::Say {
                text: "%o% %c% %l% %b% %n% %t%.".into(),
                references: ["o", "c", "l", "b", "n", "t"]
                    .into_iter()
                    .map(|id| (id.into(), local(id)))
                    .collect(),
            }],
        },
    );
    let mut c = call(
        "typed-call",
        "typed",
        [
            ("o", entity(Kind::Object, "token")),
            ("c", entity(Kind::Character, "guide")),
            ("l", entity(Kind::Location, &project.locations[0].id)),
            (
                "b",
                Argument::Variable {
                    name: "flag".into(),
                },
            ),
            (
                "n",
                Argument::Property {
                    entity: Box::new(entity(Kind::Character, "keeper")),
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
    );
    program.flows.insert("bonus".into(), vec![c.clone()]);
    program.validate_contracts(&project).unwrap();
    let mut proof = Proof::new(project.clone(), program.clone());
    let output = transcript(&proof.command("use bonus"));
    assert!(output.starts_with("Token Guide "));
    assert!(output.ends_with("true 0 <red> & %amount%."));
    if let Step::Call { call } = &mut c {
        call.arguments.insert("n".into(), local("n"));
    }
    program.flows.insert("bonus".into(), vec![c]);
    assert!(program.validate_contracts(&project).is_err());
}
#[test]
fn fallback_exhaustion_once_uses_existing_executor_and_keeps_each_call_independent() {
    let mut program = program();
    program.definitions.get_mut("award").unwrap().effects[2] = native(Effect::Respond {
        id: "fallback".into(),
        responses: vec!["First".into()],
        mode: SequenceMode::Fallback,
        fallback: "Last".into(),
        exhaustion: ExhaustionMode::Once,
        on_exhausted: vec![Effect::UpdateVariable {
            name: "runs".into(),
            op: ArithmeticOperation::Add,
            operand: NumericOperand::Literal { value: 1 },
        }],
    });
    let mut proof = Proof::new(project(), program);
    for input in [
        "use bonus",
        "use bonus",
        "use bonus",
        "use other",
        "use other",
        "use other",
    ] {
        proof.command(input);
    }
    assert_eq!(proof.session.state.variables["runs"], Value::Integer(2));
    assert_eq!(
        proof.progress.values().copied().collect::<Vec<_>>(),
        vec![2, 2]
    );
    proof
        .program
        .validate_progress(&rows(&proof.progress))
        .unwrap();
}
#[test]
fn imported_punctuation_is_validated_as_structured_paths_with_no_aliases() {
    let mut program = Program::default();
    program
        .definitions
        .insert("leaf".into(), no_input("leaf", vec![respond("reply.a.b")]));
    program
        .definitions
        .insert("one".into(), no_input("one", vec![call("c", "leaf", [])]));
    program
        .definitions
        .insert("two".into(), no_input("two", vec![call("b.c", "leaf", [])]));
    program.flows.insert(
        "bonus".into(),
        vec![call("a.b", "one", []), call("a", "two", [])],
    );
    let mut proof = Proof::new(project(), program);
    assert_eq!(
        transcript(&proof.command("use bonus")),
        "Reply one\nReply one"
    );
    assert_eq!(proof.progress.len(), 2);
    proof
        .program
        .validate_progress(&rows(&proof.progress))
        .unwrap();
    assert_eq!(
        transcript(&proof.command("use bonus")),
        "Reply two\nReply two"
    );
}

#[test]
fn native_nested_response_exhaustion_reset_keeps_its_current_invocation_path() {
    let mut program = program();
    program.definitions.get_mut("award").unwrap().effects = vec![native(Effect::If {
        condition: Condition::True,
        then: vec![Effect::Respond {
            id: "nested-response".into(),
            responses: vec!["First".into()],
            mode: SequenceMode::Fallback,
            fallback: "Reset".into(),
            exhaustion: ExhaustionMode::Once,
            on_exhausted: vec![Effect::ResetResponses {
                sequence: "nested-response".into(),
            }],
        }],
        otherwise: vec![],
    })];
    let mut proof = Proof::new(project(), program);
    assert_eq!(transcript(&proof.command("use bonus")), "First");
    assert_eq!(transcript(&proof.command("use other")), "First");
    assert_eq!(transcript(&proof.command("use bonus")), "Reset");
    assert_eq!(transcript(&proof.command("use bonus")), "First");
    assert_eq!(transcript(&proof.command("use other")), "Reset");
    proof
        .program
        .validate_progress(&rows(&proof.progress))
        .unwrap();
}
#[test]
fn native_event_sequences_keep_their_plain_progress_inside_procedure_calls() {
    let mut project = project();
    let Step::Native { effect } = respond("ordinary-event-sequence") else {
        unreachable!()
    };
    project.game.triggers.push(Trigger {
        id: "native-watch".into(),
        name: "Native watch".into(),
        watch: Some(TriggerWatch {
            target: ValueTarget::Property {
                entity: "keeper".into(),
                name: "coins".into(),
            },
            mode: WatchMode::EachChange,
        }),
        effects: vec![effect],
        ..Default::default()
    });
    let mut proof = Proof::new(project, program());
    assert_eq!(proof.session.state.sequences.len(), 1);
    proof.command("use bonus");
    assert_eq!(proof.session.state.sequences["ordinary-event-sequence"], 1);
    proof.command("use other");
    assert_eq!(proof.session.state.sequences["ordinary-event-sequence"], 0);
    assert_eq!(proof.progress.len(), 2);
    assert!(
        proof
            .progress
            .keys()
            .all(|path| path.sequence == "reply.with.dots")
    );
}
#[test]
fn changing_arguments_at_the_same_occurrence_keeps_progress_and_copies_start_fresh() {
    let mut proof = Proof::new(project(), program());
    proof.command("use bonus");
    let mut program = (*proof.program).clone();
    program.flows.insert(
        "bonus".into(),
        vec![bonus_call(
            "action-call",
            entity(Kind::Character, "guide"),
            literal(2),
        )],
    );
    let mut restored =
        Proof::restore(proof.session.project().clone(), program, proof.snapshot()).unwrap();
    assert!(transcript(&restored.command("use bonus")).contains("Reply two"));
    assert_eq!(
        restored.session.state.properties["guide"]["coins"],
        Value::Integer(2)
    );
    assert!(transcript(&restored.command("use other")).contains("Reply one"));
}
