//! Populated worlds shared by routine boundary tests and release observations.
use anyhow::Result;
use luna_core::{GameDefinition, Session};
use luna_model::*;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Mode {
    Off,
    Empty,
    Idle,
    Paused,
    Waiting,
    Due,
}

pub fn world(size: usize, definitions: usize, mode: Mode) -> Project {
    assert!(size > 0 && definitions <= ROUTINE_LIMIT);
    let mut p = Project::blank("Routine scaling");
    p.game.id = format!("routine-scale-{size}-{definitions}-{mode:?}");
    p.game.turns = (mode != Mode::Off).then(TurnPolicy::default);
    p.game.starting_location = "room-0".into();
    p.game.variables = [
        ("runs".into(), Value::Integer(0)),
        ("firings".into(), Value::Integer(0)),
    ]
    .into();
    let rooms = (size / 50).max(1);
    p.locations = (0..rooms)
        .map(|i| Location {
            id: format!("room-{i}"),
            name: format!("Room {i}"),
            ..Default::default()
        })
        .collect();
    let increment = |name: &str| Effect::UpdateVariable {
        name: name.into(),
        op: ArithmeticOperation::Add,
        operand: NumericOperand::Literal { value: 1 },
    };
    p.game.actions = (0..size)
        .map(|i| Action {
            id: format!("command-{i}"),
            name: format!("Command {i}"),
            verb: "use".into(),
            pattern: vec![PatternPart::Literal {
                text: format!("token {i}"),
            }],
            effects: vec![increment("runs")],
            ..Default::default()
        })
        .collect();
    p.characters = (0..definitions)
        .map(|i| Character {
            id: format!("person-{i}"),
            name: format!("Person {i}"),
            location: format!("room-{}", i % rooms),
            hidden: true,
            state: [("health".into(), Value::Integer(10))].into(),
            ..Default::default()
        })
        .collect();
    p.objects = (0..size)
        .map(|i| Object {
            id: format!("item-{i}"),
            name: format!("Item {i}"),
            description: "An ordinary populated-world object.".into(),
            placement: if definitions > 0 && i % 5 == 0 {
                Placement::Character {
                    character: format!("person-{}", i % definitions),
                }
            } else {
                Placement::Location {
                    location: format!("room-{}", i % rooms),
                }
            },
            state: [
                ("weight".into(), Value::Integer(2)),
                ("seen".into(), Value::Bool(false)),
                ("note".into(), Value::Text("An authored property.".into())),
            ]
            .into(),
            ..Default::default()
        })
        .collect();
    p.routines = (0..definitions)
        .map(|i| CharacterRoutine {
            id: format!("routine-{i}"),
            name: format!("Routine {i}"),
            character: format!("person-{i}"),
            order: i as u32,
            start: if matches!(mode, Mode::Waiting | Mode::Due) {
                RoutineStart::Initial
            } else {
                RoutineStart::Blocks
            },
            repeat: RoutineRepeat::Finish,
            hold_conversation: true,
            steps: vec![RoutineStep {
                id: format!("step-{i}"),
                name: "One paced step".into(),
                condition: Condition::True,
                blocked: RoutineBlocked::Retry,
                wait: matches!(mode, Mode::Waiting | Mode::Paused)
                    .then_some(NumericOperand::Literal { value: 1_000_000 }),
                effects: vec![increment("firings")],
            }],
        })
        .collect();
    // Earn real journals through native startup effects, rather than empty narrative maps.
    p.quests = (0..32)
        .map(|i| Quest {
            id: format!("task-{i}"),
            title: format!("Task {i}"),
            introduction: "A started quest retained in populated saves.".into(),
            stages: vec![QuestStage {
                id: format!("task-stage-{i}"),
                name: "A pending stage".into(),
                text: "Progress is retained.".into(),
                ..Default::default()
            }],
            on_start: NarrativeHook {
                id: format!("task-start-{i}"),
                effects: vec![],
            },
            on_complete: NarrativeHook {
                id: format!("task-complete-{i}"),
                effects: vec![],
            },
            on_fail: NarrativeHook {
                id: format!("task-fail-{i}"),
                effects: vec![],
            },
            ..Default::default()
        })
        .collect();
    p.game.triggers = vec![Trigger {
        id: "start-journals".into(),
        name: "Populate native quest progress".into(),
        event: Event::Start,
        effects: p
            .quests
            .iter()
            .map(|q| Effect::StartQuest {
                quest: q.id.clone(),
            })
            .collect(),
        ..Default::default()
    }];
    p
}

/// Fixture preparation is outside measured ticks. Paused captures are validated
/// synthetic states; waiting captures are earned by one successful native WAIT.
pub fn session(definition: &GameDefinition, mode: Mode) -> Result<Session> {
    let (mut session, _) = Session::start_with_definition(definition.clone(), None)?;
    if mode == Mode::Waiting {
        session.command("wait")?;
    }
    if mode == Mode::Paused {
        let mut state = session.state().clone();
        state.turns.as_mut().unwrap().turn = 1;
        for r in &definition.project().routines {
            state.routines.as_mut().unwrap().runs.insert(
                r.id.clone(),
                RoutineRun::Paused {
                    cursor: RoutineCursor {
                        step: r.steps[0].id.clone(),
                        after: 0,
                        wait: Some(RoutineWait {
                            captured: 1_000_000,
                            remaining: 999_999,
                        }),
                    },
                },
            );
        }
        session = Session::restore_with_definition(definition.clone(), state)?;
    }
    Ok(session)
}
