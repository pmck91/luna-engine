//! Production catalogue, queue and aggregate transaction boundaries without timing gates.
#[path = "../../../tests/support/turn_scaling.rs"]
mod fixture;
use luna_core::{CommandStatus, GameDefinition, Session};
use luna_model::{PENDING_TIMER_LIMIT, Value};

#[test]
fn large_catalogue_and_maximum_future_queue_keep_dispatch_clock_and_restore_consistent() {
    let definition =
        GameDefinition::new(fixture::world(5000, 5000, PENDING_TIMER_LIMIT, 10000)).unwrap();
    let (mut session, _) = Session::start_with_definition(definition.clone(), None).unwrap();
    session.command("use arm").unwrap();
    assert_eq!(
        session.turn_view().unwrap().pending.len(),
        PENDING_TIMER_LIMIT
    );
    for i in 0..100 {
        session.command(&format!("use token {}", i * 49)).unwrap();
    }
    session.command("wait").unwrap();
    let before = session.state().clone();
    assert_eq!(
        session.command("missing command").unwrap().status,
        CommandStatus::Unmatched
    );
    session.command("help").unwrap();
    assert_eq!(session.state(), &before);
    let view = session.turn_view().unwrap();
    assert_eq!(view.turn, 101);
    assert!(
        view.pending
            .iter()
            .all(|t| t.deadline == 10000 && t.remaining == 9899)
    );
    assert_eq!(session.state().variables["runs"], Value::Integer(100));
    assert_eq!(session.state().variables["firings"], Value::Integer(0));
    let restored = Session::restore_with_definition(definition, session.state().clone()).unwrap();
    assert_eq!(restored.state(), session.state());
    assert_eq!(restored.turn_view(), session.turn_view());
}
#[test]
fn due_batches_respect_one_shared_budget_and_oversized_batches_roll_back_atomically() {
    for count in [256, PENDING_TIMER_LIMIT] {
        let (mut session, _) = Session::start(fixture::world(100, count, count, 1), None).unwrap();
        session.command("use arm").unwrap();
        let before = session.state().clone();
        let result = session.command_explained("wait");
        if count == 256 {
            assert_eq!(result.status, CommandStatus::Ok);
            assert_eq!(session.state().variables["firings"], Value::Integer(256));
            assert!(session.turn_view().unwrap().pending.is_empty());
            assert_eq!(session.turn_view().unwrap().turn, 1);
        } else {
            assert_eq!(result.status, CommandStatus::Error);
            assert_eq!(session.state(), &before);
            assert!(result.messages.is_empty());
            assert!(!result.explanation.unwrap().committed);
            assert!(session.command("wait").is_err());
            assert_eq!(session.state(), &before);
        }
    }
}
