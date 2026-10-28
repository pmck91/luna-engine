//! No timing thresholds: assert catalogue/state limits and one shared transaction budget.
#[path = "../../../tests/support/routine_scaling.rs"]
mod fixture;
use fixture::{Mode, session, world};
use luna_core::{CommandStatus, GameDefinition, Session};
use luna_model::{ROUTINE_LIMIT, RoutineStatus, Value};

#[test]
fn maximum_idle_and_paused_catalogues_keep_populated_state_and_dispatch_restorable() {
    for mode in [Mode::Idle, Mode::Paused] {
        let definition = GameDefinition::new(world(5000, ROUTINE_LIMIT, mode)).unwrap();
        let mut current = session(&definition, mode).unwrap();
        let expected = if mode == Mode::Idle {
            RoutineStatus::NotStarted
        } else {
            RoutineStatus::Paused
        };
        let views = current.routine_view();
        assert_eq!(views.len(), ROUTINE_LIMIT);
        assert!(views.iter().all(|v| v.status == expected));
        for i in 0..20 {
            current.command(&format!("use token {}", i * 199)).unwrap();
        }
        current.command("wait").unwrap();
        assert_eq!(current.state().variables["runs"], Value::Integer(20));
        assert_eq!(current.state().variables["firings"], Value::Integer(0));
        let before = current.state().clone();
        current.command("look").unwrap();
        current.command("unknown input").unwrap();
        assert_eq!(current.state(), &before);
        let restored =
            Session::restore_with_definition(definition, current.state().clone()).unwrap();
        assert_eq!(restored.state(), &before);
        assert_eq!(restored.routine_view(), current.routine_view());
        assert_eq!(before.narrative.quests.len(), 32);
    }
}
#[test]
fn due_and_waiting_batches_share_one_budget_and_reject_an_oversized_tick_atomically() {
    for (count, mode) in [
        (256, Mode::Due),
        (256, Mode::Waiting),
        (ROUTINE_LIMIT, Mode::Due),
    ] {
        let definition = GameDefinition::new(world(100, count, mode)).unwrap();
        let mut current = session(&definition, mode).unwrap();
        let before = current.state().clone();
        let result = current.command_explained("wait");
        if count == ROUTINE_LIMIT {
            assert_eq!(result.status, CommandStatus::Error);
            assert_eq!(current.state(), &before);
            assert!(result.messages.is_empty());
            assert!(!result.explanation.unwrap().committed);
            assert!(current.command("wait").is_err());
            assert_eq!(current.state(), &before);
        } else {
            assert_eq!(result.status, CommandStatus::Ok);
            if mode == Mode::Due {
                assert_eq!(current.state().variables["firings"], Value::Integer(256));
            } else {
                assert!(
                    current
                        .routine_view()
                        .iter()
                        .all(|v| v.wait.as_ref().unwrap().remaining == 999_998)
                );
            }
        }
    }
    for mode in [Mode::Off, Mode::Empty] {
        let (mut current, _) = Session::start(world(100, 0, mode), None).unwrap();
        assert_eq!(
            current.command("wait").unwrap().status,
            if mode == Mode::Off {
                CommandStatus::Unmatched
            } else {
                CommandStatus::Ok
            }
        );
    }
}
