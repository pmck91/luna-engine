use luna_core::Session;
use luna_model::*;

fn world(initial: i32, source: i32, effects: Vec<Effect>) -> Project {
    let mut p = Project::blank("Arithmetic");
    p.game.starting_location = "room".into();
    p.locations[0].id = "room".into();
    p.locations[0].actions = vec![description_action("room")];
    let state = [
        ("amount".into(), Value::Integer(initial)),
        ("source".into(), Value::Integer(source)),
    ]
    .into();
    p.game.variables = state;
    p.locations[0].state = p.game.variables.clone();
    p.objects.push(Object {
        id: "object".into(),
        name: "counter".into(),
        state: p.game.variables.clone(),
        ..Default::default()
    });
    p.characters.push(Character {
        id: "character".into(),
        name: "Keeper".into(),
        location: "room".into(),
        state: p.game.variables.clone(),
        ..Default::default()
    });
    p.game.actions.push(Action {
        id: "calculate".into(),
        verb: "use".into(),
        pattern: vec![PatternPart::Literal {
            text: "math".into(),
        }],
        effects,
        ..Default::default()
    });
    p
}
fn update(target: &str, op: ArithmeticOperation, operand: NumericOperand) -> Effect {
    if target == "variable" {
        Effect::UpdateVariable {
            name: "amount".into(),
            op,
            operand,
        }
    } else {
        Effect::UpdateProperty {
            entity: target.into(),
            name: "amount".into(),
            op,
            operand,
        }
    }
}
fn literal(value: i32) -> NumericOperand {
    NumericOperand::Literal { value }
}
fn variable(name: &str) -> NumericOperand {
    NumericOperand::Variable { name: name.into() }
}

#[test]
fn every_operation_target_and_operand_reads_integer_state() {
    for (op, expected) in [
        (ArithmeticOperation::Add, 10),
        (ArithmeticOperation::Subtract, 4),
        (ArithmeticOperation::Multiply, 21),
        (ArithmeticOperation::Divide, 2),
    ] {
        for target in ["variable", "room", "object", "character"] {
            for operand in [
                literal(3),
                variable("source"),
                NumericOperand::Property {
                    entity: "room".into(),
                    name: "source".into(),
                },
                NumericOperand::Property {
                    entity: "object".into(),
                    name: "source".into(),
                },
                NumericOperand::Property {
                    entity: "character".into(),
                    name: "source".into(),
                },
            ] {
                let p = world(7, 3, vec![update(target, op, operand)]);
                let (mut session, _) = Session::start(p, None).unwrap();
                session.command("use math").unwrap();
                let result = if target == "variable" {
                    &session.state().variables["amount"]
                } else {
                    &session.state().properties[target]["amount"]
                };
                assert_eq!(result, &Value::Integer(expected), "{op:?} {target}");
            }
        }
    }
}

#[test]
fn signed_division_truncates_toward_zero_and_boundaries_are_supported() {
    for (a, op, b, expected) in [
        (7, ArithmeticOperation::Divide, 2, 3),
        (-7, ArithmeticOperation::Divide, 2, -3),
        (7, ArithmeticOperation::Divide, -2, -3),
        (-7, ArithmeticOperation::Divide, -2, 3),
        (0, ArithmeticOperation::Multiply, i32::MAX, 0),
        (0, ArithmeticOperation::Subtract, 1, -1),
        (i32::MIN, ArithmeticOperation::Add, 0, i32::MIN),
        (i32::MAX, ArithmeticOperation::Multiply, 1, i32::MAX),
    ] {
        let (mut session, _) = Session::start(
            world(a, b, vec![update("variable", op, variable("source"))]),
            None,
        )
        .unwrap();
        session.command("use math").unwrap();
        assert_eq!(
            session.state().variables["amount"],
            Value::Integer(expected)
        );
    }
}

#[test]
fn arithmetic_uses_prior_effects_and_self_references() {
    let effects = vec![
        Effect::SetVariable {
            name: "source".into(),
            value: Value::Integer(2),
        },
        update(
            "variable",
            ArithmeticOperation::Multiply,
            variable("source"),
        ),
        update("variable", ArithmeticOperation::Add, variable("amount")),
        update("object", ArithmeticOperation::Add, variable("amount")),
        update(
            "object",
            ArithmeticOperation::Multiply,
            NumericOperand::Property {
                entity: "object".into(),
                name: "amount".into(),
            },
        ),
        Effect::Say {
            text: "%amount% / %object.amount%".into(),
        },
    ];
    let (mut session, _) = Session::start(world(3, 0, effects), None).unwrap();
    let result = session.command("use math").unwrap();
    assert_eq!(text::plain(&result.messages[0]), "12 / 225");
}

#[test]
fn zero_and_overflow_roll_back_the_entire_command() {
    for (a, op, b, message) in [
        (5, ArithmeticOperation::Divide, 0, "zero"),
        (i32::MAX, ArithmeticOperation::Add, 1, "overflow"),
        (i32::MIN, ArithmeticOperation::Subtract, 1, "overflow"),
        (i32::MAX, ArithmeticOperation::Multiply, 2, "overflow"),
        (i32::MIN, ArithmeticOperation::Divide, -1, "overflow"),
    ] {
        for target in ["variable", "room", "object", "character"] {
            let effects = vec![
                Effect::Say {
                    text: "Must be discarded".into(),
                },
                Effect::SetVariable {
                    name: "source".into(),
                    value: Value::Integer(b),
                },
                update(target, op, variable("source")),
            ];
            let (mut session, _) = Session::start(world(a, 42, effects), None).unwrap();
            let before = session.state().clone();
            assert!(
                session
                    .command("use math")
                    .unwrap_err()
                    .to_string()
                    .contains(message)
            );
            assert_eq!(session.state(), &before);
            let result = session.command("help").unwrap();
            assert!(
                result
                    .messages
                    .iter()
                    .all(|m| !text::plain(m).contains("Must be discarded"))
            );
        }
    }
}

#[test]
fn validation_checks_numeric_targets_references_and_literal_zero() {
    let valid = world(
        1,
        0,
        vec![update(
            "variable",
            ArithmeticOperation::Divide,
            variable("source"),
        )],
    );
    assert!(
        !validate(&valid)
            .iter()
            .any(|d| d.severity == Severity::Error)
    );
    let cases = [
        update("variable", ArithmeticOperation::Divide, literal(0)),
        update("missing", ArithmeticOperation::Add, literal(1)),
        update("variable", ArithmeticOperation::Add, variable("missing")),
        update(
            "variable",
            ArithmeticOperation::Add,
            NumericOperand::Property {
                entity: "missing".into(),
                name: "amount".into(),
            },
        ),
        update(
            "variable",
            ArithmeticOperation::Add,
            NumericOperand::Property {
                entity: "room".into(),
                name: "missing".into(),
            },
        ),
    ];
    for effect in cases {
        let p = world(1, 1, vec![effect]);
        assert!(validate(&p).iter().any(|d| d.severity == Severity::Error));
    }
    for value in [Value::Bool(true), Value::Text("2".into())] {
        for target in ["variable", "room", "object", "character"] {
            let mut p = world(
                1,
                1,
                vec![update(target, ArithmeticOperation::Add, literal(1))],
            );
            if target == "variable" {
                p.game.variables.insert("amount".into(), value.clone());
            } else if target == "room" {
                p.locations[0].state.insert("amount".into(), value.clone());
            } else if target == "object" {
                p.objects[0].state.insert("amount".into(), value.clone());
            } else {
                p.characters[0].state.insert("amount".into(), value.clone());
            }
            assert!(
                validate(&p)
                    .iter()
                    .any(|d| d.severity == Severity::Error && d.message.contains("integers"))
            );
        }
        for operand in [
            variable("source"),
            NumericOperand::Property {
                entity: "room".into(),
                name: "source".into(),
            },
        ] {
            let mut p = world(
                1,
                1,
                vec![update("variable", ArithmeticOperation::Add, operand)],
            );
            p.game.variables.insert("source".into(), value.clone());
            p.locations[0].state.insert("source".into(), value.clone());
            assert!(
                validate(&p)
                    .iter()
                    .any(|d| d.severity == Severity::Error && d.message.contains("integers"))
            );
        }
    }
}
