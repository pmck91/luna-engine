//! Synthetic catalogues shared by functional boundary checks and release measurements.
use luna_model::*;

pub fn world(commands: usize, definitions: usize, pending: usize, delay: i32) -> Project {
    assert!(pending <= definitions);
    let mut p = Project::blank("Turn scaling");
    p.game.id = format!("turn-scale-{commands}-{definitions}-{pending}");
    p.game.turns = (definitions > 0).then(TurnPolicy::default);
    p.game.variables = [
        ("runs".into(), Value::Integer(0)),
        ("firings".into(), Value::Integer(0)),
    ]
    .into();
    p.game.actions = (0..commands)
        .map(|i| Action {
            id: format!("command-{i}"),
            name: format!("Command {i}"),
            verb: "use".into(),
            pattern: vec![PatternPart::Literal {
                text: format!("token {i}"),
            }],
            effects: vec![Effect::UpdateVariable {
                name: "runs".into(),
                op: ArithmeticOperation::Add,
                operand: NumericOperand::Literal { value: 1 },
            }],
            ..Default::default()
        })
        .collect();
    p.timers = (0..definitions)
        .map(|i| ScheduledTrigger {
            id: format!("timer-{i}"),
            name: format!("Timer {i}"),
            order: i as u32,
            priority: (i % 3) as i32,
            condition: Condition::True,
            effects: vec![Effect::UpdateVariable {
                name: "firings".into(),
                op: ArithmeticOperation::Add,
                operand: NumericOperand::Literal { value: 1 },
            }],
        })
        .collect();
    if pending > 0 {
        p.game.actions.push(Action {
            id: "arm".into(),
            name: "Arm the pending set".into(),
            verb: "use".into(),
            pattern: vec![PatternPart::Literal { text: "arm".into() }],
            turn_cost: Some(ActionTurnCost {
                success: TurnCost::Free,
                ..Default::default()
            }),
            effects: (0..pending)
                .map(|i| Effect::ScheduleTimer {
                    timer: format!("timer-{i}"),
                    after: NumericOperand::Literal { value: delay },
                    pending: TimerPendingPolicy::Restart,
                })
                .collect(),
            ..Default::default()
        });
    }
    p
}
