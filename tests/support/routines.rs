//! Canonical CR2 cross-host specimen; existing authored examples stay untouched.
#[path = "conversations.rs"]
mod conversations;
pub use conversations::{action, increment};
use luna_model::*;

pub fn project() -> Project {
    let mut p = conversations::project();
    p.game.format_version = 7;
    p.game.id = "routine-integration".into();
    p.game.title = "Routine integration".into();
    p.game.turns = Some(TurnPolicy::default());
    p.game.endings.push(Ending {
        id: "finish".into(),
        name: "Finished".into(),
        text: "Finished.".into(),
        outcome: None,
    });
    p.game
        .variables
        .insert("patrol_count".into(), Value::Integer(0));
    p.game.variables.insert("bells".into(), Value::Integer(0));
    p.game.variables.insert("delay".into(), Value::Integer(3));
    p.procedures.push(Procedure {
        id: "routine-reward".into(),
        name: "Routine reward".into(),
        description: String::new(),
        inputs: vec![],
        effects: vec![
            increment("patrol_count"),
            Effect::Respond {
                id: "patrol-response".into(),
                responses: vec!["Patrol reward once.".into()],
                mode: SequenceMode::Fallback,
                fallback: "Patrol complete.".into(),
                exhaustion: ExhaustionMode::Once,
                on_exhausted: vec![],
            },
        ],
    });
    p.routines = vec![CharacterRoutine {
        id: "patrol".into(),
        name: "Evening patrol".into(),
        character: "keeper".into(),
        order: 0,
        start: RoutineStart::Initial,
        repeat: RoutineRepeat::Finish,
        hold_conversation: true,
        steps: vec![
            RoutineStep {
                id: "patrol-wait".into(),
                name: "Wait for patrol".into(),
                condition: Condition::True,
                blocked: RoutineBlocked::Retry,
                wait: Some(NumericOperand::Variable {
                    name: "delay".into(),
                }),
                effects: vec![Effect::Call {
                    id: "patrol-reward-call".into(),
                    procedure: "routine-reward".into(),
                    arguments: Default::default(),
                }],
            },
            RoutineStep {
                id: "patrol-move".into(),
                name: "Move to Garden".into(),
                condition: Condition::True,
                blocked: RoutineBlocked::Retry,
                wait: None,
                effects: vec![
                    Effect::MoveCharacter {
                        character: "keeper".into(),
                        location: "garden".into(),
                    },
                    Effect::ScheduleTimer {
                        timer: "routine-bell".into(),
                        after: NumericOperand::Literal { value: 1 },
                        pending: TimerPendingPolicy::Restart,
                    },
                ],
            },
        ],
    }];
    let mut unused = p.routines[0].clone();
    unused.id = "unused".into();
    unused.name = "Unused routine".into();
    unused.order = 10;
    unused.start = RoutineStart::Blocks;
    unused.steps = vec![RoutineStep {
        id: "unused-step".into(),
        name: "Unused step".into(),
        condition: Condition::True,
        blocked: RoutineBlocked::Retry,
        wait: None,
        effects: vec![],
    }];
    p.routines.push(unused);
    p.timers.push(ScheduledTrigger {
        id: "routine-bell".into(),
        name: "Routine bell".into(),
        order: 0,
        priority: 0,
        condition: Condition::True,
        effects: vec![
            increment("bells"),
            Effect::Say {
                text: "Bell after patrol.".into(),
            },
        ],
    });
    for (word, effect) in [
        (
            "pausepatrol",
            Effect::PauseRoutine {
                routine: "patrol".into(),
            },
        ),
        (
            "resumepatrol",
            Effect::ResumeRoutine {
                routine: "patrol".into(),
            },
        ),
        (
            "stoppatrol",
            Effect::StopRoutine {
                routine: "patrol".into(),
            },
        ),
    ] {
        action(&mut p, word, vec![effect]);
        p.game.actions.last_mut().unwrap().turn_cost = Some(ActionTurnCost {
            success: TurnCost::Free,
            ..Default::default()
        });
    }
    p.locations.sort_by(|a, b| a.id.cmp(&b.id));
    p.objects.sort_by(|a, b| a.id.cmp(&b.id));
    p.characters.sort_by(|a, b| a.id.cmp(&b.id));
    p.procedures.sort_by(|a, b| a.id.cmp(&b.id));
    p.conversations.sort_by(|a, b| a.id.cmp(&b.id));
    p
}
