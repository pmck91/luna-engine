//! Native N4 Keeper specimen, sharing the N3 quest executor and reward procedure.
#[path = "quests.rs"]
mod quests;
use luna_model::*;
pub use quests::{action, increment};

pub fn project() -> Project {
    let mut p = quests::project();
    p.game.id = "conversation-runtime".into();
    p.game.title = "Keeper conversation runtime".into();
    p.locations[0].name = "Study".into();
    p.locations.push(Location {
        id: "garden".into(),
        name: "Garden".into(),
        ..Default::default()
    });
    for name in ["entries", "thanks", "acknowledgements", "tail", "exhausted"] {
        p.game.variables.insert(name.into(), Value::Integer(0));
    }
    p.objects[0].name = "brass key".into();
    p.objects[0].aliases = vec!["key".into()];
    p.objects[0].portable = true;
    p.objects.push(Object {
        id: "iron".into(),
        name: "iron key".into(),
        aliases: vec!["key".into()],
        portable: true,
        placement: Placement::Location {
            location: "study".into(),
        },
        ..Default::default()
    });
    let status = |status| Condition::QuestStatus {
        quest: "missing".into(),
        status,
    };
    p.conversations = vec![
        Conversation {
            id: "conversation".into(),
            name: "The Keeper's key".into(),
            character: "keeper".into(),
            default_entry: "greeting".into(),
            entries: vec![
                ConversationEntry {
                    condition: status(QuestStatus::Completed),
                    node: "revisit".into(),
                },
                ConversationEntry {
                    condition: status(QuestStatus::Failed),
                    node: "failed-node".into(),
                },
                ConversationEntry {
                    condition: status(QuestStatus::Active),
                    node: "progress".into(),
                },
            ],
            nodes: vec![
                ConversationNode {
                    id: "greeting".into(),
                    name: "Greeting".into(),
                    text: "Will you find my key? You have %coins% coins.".into(),
                    effects: vec![
                        increment("entries"),
                        Effect::Respond {
                            id: "greeting-response".into(),
                            responses: vec![
                                "The Keeper looks worried.".into(),
                                "The Keeper waits.".into(),
                            ],
                            mode: SequenceMode::Fallback,
                            fallback: "Still waiting.".into(),
                            exhaustion: ExhaustionMode::Once,
                            on_exhausted: vec![increment("exhausted")],
                        },
                    ],
                    replies: vec![
                        ConversationReply {
                            id: "accept".into(),
                            text: "Yes, I'll find it.".into(),
                            condition: status(QuestStatus::Undiscovered),
                            once: true,
                            destination: Some("progress".into()),
                            effects: vec![Effect::StartQuest {
                                quest: "missing".into(),
                            }],
                        },
                        ConversationReply {
                            id: "decline".into(),
                            text: "Not now.".into(),
                            ..Default::default()
                        },
                    ],
                    ..Default::default()
                },
                ConversationNode {
                    id: "progress".into(),
                    name: "Progress".into(),
                    text: "Any news?".into(),
                    replies: vec![
                        ConversationReply {
                            id: "later".into(),
                            text: "I'll keep looking.".into(),
                            ..Default::default()
                        },
                        ConversationReply {
                            id: "handover".into(),
                            text: "Here is your key.".into(),
                            once: true,
                            condition: Condition::Carrying {
                                object: "key".into(),
                            },
                            destination: Some("thanks-node".into()),
                            effects: vec![
                                quests::stage("returned"),
                                Effect::CompleteQuest {
                                    quest: "missing".into(),
                                },
                            ],
                        },
                    ],
                    ..Default::default()
                },
                ConversationNode {
                    id: "thanks-node".into(),
                    name: "Reward exchange".into(),
                    text: "My key! Thank you. Here are ten coins for your trouble.".into(),
                    effects: vec![increment("thanks")],
                    replies: vec![ConversationReply {
                        id: "farewell".into(),
                        text: "You're welcome.".into(),
                        ..Default::default()
                    }],
                    ..Default::default()
                },
                ConversationNode {
                    id: "revisit".into(),
                    name: "On return".into(),
                    text: "Thank you again for finding my key.".into(),
                    terminal: true,
                    effects: vec![increment("acknowledgements")],
                    ..Default::default()
                },
                ConversationNode {
                    id: "failed-node".into(),
                    name: "On failure".into(),
                    text: "The key is lost.".into(),
                    terminal: true,
                    ..Default::default()
                },
            ],
            ..Default::default()
        },
        Conversation {
            id: "other-conversation".into(),
            name: "Other encounter".into(),
            character: "keeper".into(),
            default_entry: "other-node".into(),
            nodes: vec![ConversationNode {
                id: "other-node".into(),
                name: "Other greeting".into(),
                text: "Another conversation.".into(),
                terminal: true,
                ..Default::default()
            }],
            ..Default::default()
        },
    ];
    p.characters[0].actions.push(Action {
        id: "talk-keeper".into(),
        name: "Talk Keeper".into(),
        verb: "talk".into(),
        pattern: vec![PatternPart::Entity {
            entity: "keeper".into(),
        }],
        effects: vec![Effect::StartConversation {
            conversation: "conversation".into(),
        }],
        ..Default::default()
    });
    for id in ["key", "iron"] {
        p.game.actions.push(Action {
            id: format!("take-{id}"),
            verb: "take".into(),
            pattern: vec![PatternPart::Entity { entity: id.into() }],
            effects: vec![
                Effect::Give { object: id.into() },
                Effect::If {
                    condition: status(QuestStatus::Active),
                    then: if id == "key" {
                        vec![quests::stage("found-stage")]
                    } else {
                        vec![]
                    },
                    otherwise: vec![],
                },
            ],
            ..Default::default()
        });
        p.game.actions.push(Action {
            id: format!("examine-{id}"),
            verb: "examine".into(),
            pattern: vec![PatternPart::Entity { entity: id.into() }],
            effects: vec![Effect::Say { text: id.into() }],
            ..Default::default()
        });
    }
    action(
        &mut p,
        "garden",
        vec![Effect::Move {
            location: "garden".into(),
        }],
    );
    action(
        &mut p,
        "study",
        vec![Effect::Move {
            location: "study".into(),
        }],
    );
    action(
        &mut p,
        "risk",
        vec![Effect::UpdateVariable {
            name: "coins".into(),
            op: ArithmeticOperation::Divide,
            operand: NumericOperand::Variable {
                name: "divisor".into(),
            },
        }],
    );
    action(&mut p, "blocked", vec![]);
    p.game.actions.last_mut().unwrap().requirements = Condition::False;
    p.game.triggers.push(Trigger {
        id: "count-commands".into(),
        name: "Count commands".into(),
        event: Event::Command,
        effects: vec![increment("commands")],
        ..Default::default()
    });
    p
}
