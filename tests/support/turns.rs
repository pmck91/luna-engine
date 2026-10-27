//! Canonical timer integration specimen; separate from the authored T4 example.
use luna_model::*;
pub fn say(text: &str) -> Effect {
    Effect::Say { text: text.into() }
}
fn schedule(timer: &str, after: i32) -> Effect {
    Effect::ScheduleTimer {
        timer: timer.into(),
        after: NumericOperand::Literal { value: after },
        pending: TimerPendingPolicy::Restart,
    }
}
pub fn project() -> Project {
    let mut p = Project::blank("Timer integration");
    p.game.id = "timer-integration".into();
    p.game.turns = Some(TurnPolicy::default());
    p.locations[0].id = "study".into();
    p.locations[0].name = "Study".into();
    p.locations[0].actions.clear();
    p.game.starting_location = "study".into();
    p.game.variables = [
        ("firings".into(), Value::Integer(0)),
        ("divisor".into(), Value::Integer(0)),
    ]
    .into();
    p.game.endings.push(Ending {
        id: "finish".into(),
        name: "Finished".into(),
        text: "Finished.".into(),
        outcome: None,
    });
    p.objects.push(Object {
        id: "door".into(),
        name: "stone door".into(),
        placement: Placement::Location {
            location: "study".into(),
        },
        ..Default::default()
    });
    p.procedures.push(Procedure {
        id: "arm-door".into(),
        name: "Arm door".into(),
        description: String::new(),
        inputs: vec![],
        effects: vec![schedule("door-closes", 3)],
    });
    p.game.actions = vec![
        Action {
            id: "open-door".into(),
            verb: "open".into(),
            pattern: vec![PatternPart::Entity {
                entity: "door".into(),
            }],
            effects: vec![
                Effect::Open {
                    object: "door".into(),
                },
                Effect::Call {
                    id: "arm-call".into(),
                    procedure: "arm-door".into(),
                    arguments: Default::default(),
                },
            ],
            ..Default::default()
        },
        Action {
            id: "secure-door".into(),
            verb: "use".into(),
            pattern: vec![PatternPart::Literal {
                text: "secure".into(),
            }],
            effects: vec![Effect::CancelTimer {
                timer: "door-closes".into(),
            }],
            ..Default::default()
        },
        Action {
            id: "both".into(),
            verb: "use".into(),
            pattern: vec![PatternPart::Literal {
                text: "both".into(),
            }],
            effects: vec![schedule("z-first", 1), schedule("a-second", 1)],
            ..Default::default()
        },
        Action {
            id: "ending".into(),
            verb: "use".into(),
            pattern: vec![PatternPart::Literal {
                text: "finish".into(),
            }],
            effects: vec![Effect::End {
                ending: "finish".into(),
            }],
            ..Default::default()
        },
    ];
    p.timers = vec![
        ScheduledTrigger {
            id: "door-closes".into(),
            name: "Door closes".into(),
            order: 0,
            priority: 0,
            condition: Condition::Opened {
                object: "door".into(),
            },
            effects: vec![
                Effect::Close {
                    object: "door".into(),
                },
                Effect::UpdateVariable {
                    name: "firings".into(),
                    op: ArithmeticOperation::Add,
                    operand: NumericOperand::Literal { value: 1 },
                },
                say("The door swings shut."),
            ],
        },
        ScheduledTrigger {
            id: "z-first".into(),
            name: "First".into(),
            order: 1,
            priority: 0,
            condition: Condition::True,
            effects: vec![say("First timer.")],
        },
        ScheduledTrigger {
            id: "a-second".into(),
            name: "Second".into(),
            order: 2,
            priority: 0,
            condition: Condition::True,
            effects: vec![say("Second timer.")],
        },
        ScheduledTrigger {
            id: "unused".into(),
            name: "Unused".into(),
            order: 3,
            priority: 0,
            condition: Condition::True,
            effects: vec![],
        },
    ];
    p
}
