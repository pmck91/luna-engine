//! Shared canonical fixture for project/editor/installed-save boundaries.
use luna_model::*;
pub fn project() -> Project {
    let mut p = Project::blank("Procedure persistence");
    p.game.variables.insert("rewards".into(), Value::Integer(0));
    p.game
        .variables
        .insert("commands".into(), Value::Integer(0));
    p.procedures = vec![
        Procedure {
            id: "award".into(),
            name: "Award reward".into(),
            description: String::new(),
            inputs: vec![ProcedureInput {
                id: "amount".into(),
                name: "amount".into(),
                kind: InputKind::Integer,
                required_properties: Default::default(),
            }],
            effects: vec![
                Effect::UpdateVariable {
                    name: "rewards".into(),
                    op: ArithmeticOperation::Add,
                    operand: NumericOperand::Input {
                        input: "amount".into(),
                    },
                },
                Effect::Respond {
                    id: "shared-reply".into(),
                    responses: vec!["First reply".into(), "Second reply".into()],
                    mode: SequenceMode::Loop,
                    fallback: "".into(),
                    exhaustion: ExhaustionMode::Once,
                    on_exhausted: vec![],
                },
            ],
        },
        Procedure {
            id: "unused".into(),
            name: "Unused definition".into(),
            description: String::new(),
            inputs: vec![],
            effects: vec![Effect::Say {
                text: "Unused".into(),
            }],
        },
    ];
    for (id, word) in [("reward-action", "reward"), ("other-action", "other")] {
        p.game.actions.push(Action {
            id: id.into(),
            verb: "use".into(),
            pattern: vec![PatternPart::Literal { text: word.into() }],
            effects: vec![Effect::Call {
                id: format!("{id}-call"),
                procedure: "award".into(),
                arguments: [(
                    "amount".into(),
                    Argument::Literal {
                        value: Value::Integer(1),
                    },
                )]
                .into(),
            }],
            ..Default::default()
        });
    }
    p.game.triggers.push(Trigger {
        id: "command-count".into(),
        name: "Command count".into(),
        event: Event::Command,
        effects: vec![Effect::UpdateVariable {
            name: "commands".into(),
            op: ArithmeticOperation::Add,
            operand: NumericOperand::Literal { value: 1 },
        }],
        ..Default::default()
    });
    p
}
