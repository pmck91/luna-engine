//! Retained offers must be resolved before reconciling a separately changed world.
use super::Run;
use crate::{CommandStatus, Session};
use luna_model::*;

#[test]
fn stale_number_does_not_rebind_when_live_eligibility_changes_before_refresh() {
    let mut p = Project::blank("Stale offer");
    p.game.variables.insert("ready".into(), Value::Bool(true));
    p.game
        .variables
        .insert("selected".into(), Value::Bool(false));
    p.characters.push(Character {
        id: "speaker".into(),
        name: "Speaker".into(),
        location: p.game.starting_location.clone(),
        ..Default::default()
    });
    let response = |id: &str, condition| ConversationReply {
        id: id.into(),
        text: id.into(),
        condition,
        effects: vec![Effect::SetVariable {
            name: "selected".into(),
            value: Value::Bool(true),
        }],
        ..Default::default()
    };
    p.conversations.push(Conversation {
        id: "encounter".into(),
        name: "Encounter".into(),
        character: "speaker".into(),
        default_entry: "node".into(),
        nodes: vec![ConversationNode {
            id: "node".into(),
            name: "Node".into(),
            text: "Choose".into(),
            replies: vec![
                response(
                    "first",
                    Condition::Variable {
                        name: "ready".into(),
                        op: Comparison::Eq,
                        value: Value::Bool(true),
                    },
                ),
                response("second", Condition::True),
            ],
            ..Default::default()
        }],
        ..Default::default()
    });
    p.game.actions.push(Action {
        id: "talk-action".into(),
        verb: "talk".into(),
        effects: vec![Effect::StartConversation {
            conversation: "encounter".into(),
        }],
        ..Default::default()
    });
    let (mut session, _) = Session::start(p, None).unwrap();
    session.command("talk").unwrap();
    let old_offer = session.conversation_view().unwrap().clone();
    let mut live = session.state().clone();
    live.variables.insert("ready".into(), Value::Bool(false));
    let mut run = Run::new(session.definition(), live.clone());
    run.offer = Some(old_offer.clone());
    run.command("1").unwrap();
    run.finish_conversation().unwrap();
    assert_eq!(run.result.status, CommandStatus::Unmatched);
    assert_eq!(*run.state, live);
    let offered = run.offer.unwrap();
    assert_eq!(offered.replies[0].id, "second");
    assert_ne!(offered.offer_token, old_offer.offer_token);
}
