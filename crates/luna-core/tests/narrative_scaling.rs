//! Larger immutable definitions and boundary-sized offers use the shipping executor.
use luna_core::{CommandStatus, GameDefinition, Session};
use luna_model::*;
use std::time::Instant;

fn speaker(p: &mut Project) {
    p.characters.push(Character {
        id: "keeper".into(),
        name: "Keeper".into(),
        location: p.game.starting_location.clone(),
        ..Default::default()
    });
}
fn action(p: &mut Project, id: &str, verb: &str, words: &str, effects: Vec<Effect>) {
    p.game.actions.push(Action {
        id: id.into(),
        name: words.into(),
        verb: verb.into(),
        pattern: vec![PatternPart::Literal { text: words.into() }],
        effects,
        ..Default::default()
    });
}

#[test]
fn large_definition_reuses_indexes_across_reply_commands_quest_progress_and_restore() {
    const COLLECTIONS: usize = 250;
    const PARTS: usize = 24;
    const SELECTIONS: usize = 1000;
    let mut p = Project::blank("Narrative scaling");
    speaker(&mut p);
    p.game.variables.insert("rewards".into(), Value::Integer(0));
    for i in 0..COLLECTIONS {
        let quest = format!("quest-{i}");
        p.quests.push(Quest {
            id: quest.clone(),
            title: format!("Quest {i}"),
            stages: (0..PARTS)
                .map(|j| QuestStage {
                    id: format!("stage-{i}-{j}"),
                    name: format!("Stage {j}"),
                    text: format!("Recorded stage {j}."),
                    prerequisites: if j == 0 {
                        vec![]
                    } else {
                        vec![format!("stage-{i}-{}", j - 1)]
                    },
                    ..Default::default()
                })
                .collect(),
            on_start: NarrativeHook {
                id: format!("start-{i}"),
                effects: vec![],
            },
            on_complete: NarrativeHook {
                id: format!("complete-{i}"),
                effects: vec![Effect::UpdateVariable {
                    name: "rewards".into(),
                    op: ArithmeticOperation::Add,
                    operand: NumericOperand::Literal { value: 1 },
                }],
            },
            on_fail: NarrativeHook {
                id: format!("fail-{i}"),
                effects: vec![],
            },
            ..Default::default()
        });
        let conversation = format!("conversation-{i}");
        p.conversations.push(Conversation {
            id: conversation.clone(),
            name: format!("Conversation {i}"),
            character: "keeper".into(),
            default_entry: format!("node-{i}-0"),
            nodes: (0..PARTS)
                .map(|j| ConversationNode {
                    id: format!("node-{i}-{j}"),
                    name: format!("Dialogue {j}"),
                    text: format!("Dialogue {i}/{j}."),
                    replies: vec![ConversationReply {
                        id: format!("reply-{i}-{j}"),
                        text: "Continue.".into(),
                        condition: Condition::All {
                            conditions: vec![
                                Condition::QuestStatus {
                                    quest: quest.clone(),
                                    status: QuestStatus::Undiscovered,
                                },
                                Condition::Not {
                                    condition: Box::new(Condition::QuestStageCompleted {
                                        quest: quest.clone(),
                                        stage: format!("stage-{i}-0"),
                                    }),
                                },
                            ],
                        },
                        destination: Some(format!("node-{i}-{}", (j + 1) % PARTS)),
                        ..Default::default()
                    }],
                    ..Default::default()
                })
                .collect(),
            ..Default::default()
        });
        action(
            &mut p,
            &format!("talk-{i}"),
            "talk",
            &format!("topic {i}"),
            vec![Effect::StartConversation { conversation }],
        );
    }
    let quest = format!("quest-{}", COLLECTIONS - 1);
    let mut effects = vec![Effect::StartQuest {
        quest: quest.clone(),
    }];
    effects.extend((0..PARTS).map(|j| Effect::CompleteQuestStage {
        quest: quest.clone(),
        stage: format!("stage-{}-{j}", COLLECTIONS - 1),
    }));
    effects.push(Effect::CompleteQuest { quest });
    action(&mut p, "finish", "use", "finish", effects);
    let began = Instant::now();
    let definition = GameDefinition::new(p).unwrap();
    let compiled = began.elapsed();
    let (mut session, _) = Session::start_with_definition(definition.clone(), None).unwrap();
    for i in 0..COLLECTIONS {
        if i > 0 {
            session.command("bye").unwrap();
        }
        session.command(&format!("talk topic {i}")).unwrap();
    }
    assert_eq!(session.state().narrative.conversations.len(), COLLECTIONS);
    let began = Instant::now();
    for j in 0..SELECTIONS {
        let view = session.conversation_view().unwrap().clone();
        assert_eq!(view.node, format!("node-249-{}", j % PARTS));
        let result = if j % 2 == 0 {
            session
                .select_reply(&view.offer_token, &view.replies[0].id)
                .unwrap()
        } else {
            session.command("reply 1").unwrap()
        };
        assert_eq!(result.status, CommandStatus::Ok);
    }
    let selected = began.elapsed();
    let state = session.state().clone();
    assert_eq!(
        state.narrative.conversations["conversation-249"]
            .visited
            .len(),
        PARTS
    );
    assert_eq!(
        state.narrative.conversations["conversation-249"]
            .chosen
            .len(),
        PARTS
    );
    let began = Instant::now();
    let mut restored = Session::restore_with_definition(definition.clone(), state.clone()).unwrap();
    let restore = began.elapsed();
    assert_eq!(restored.state(), &state);
    let old = session.conversation_view().unwrap();
    assert_ne!(
        restored.conversation_view().unwrap().offer_token,
        old.offer_token
    );
    assert_eq!(
        restored
            .select_reply(&old.offer_token, &old.replies[0].id)
            .unwrap()
            .status,
        CommandStatus::Unmatched
    );
    assert_eq!(restored.state(), &state);
    let completed = session.command("use finish").unwrap();
    assert_eq!(completed.status, CommandStatus::Ok);
    let log = session.quest_log();
    assert_eq!(
        log.len(),
        1,
        "Undiscovered quests must not leak into the log"
    );
    assert_eq!(log[0].status, QuestStatus::Completed);
    assert_eq!(log[0].journal.len(), PARTS + 2);
    assert_eq!(session.state().variables["rewards"], Value::Integer(1));
    session.command("use finish").unwrap();
    assert_eq!(session.state().variables["rewards"], Value::Integer(1));
    let ended = Session::restore_with_definition(definition, session.state().clone()).unwrap();
    assert_eq!(ended.state(), session.state());
    assert_eq!(ended.quest_log(), log);
    // Observational timings, with no hardware-dependent CI threshold.
    eprintln!(
        "250 conversations / 6000 nodes / 6000 replies / 250 quests / 6000 stages / \
         251 actions: compile={compiled:?}, {SELECTIONS} selections={selected:?}, restore={restore:?}"
    );
}

#[test]
fn maximum_sized_offer_selects_the_last_stable_reply_and_rejects_oversized_content() {
    let mut p = Project::blank("Reply limit");
    speaker(&mut p);
    p.conversations.push(Conversation {
        id: "conversation".into(),
        name: "Conversation".into(),
        character: "keeper".into(),
        default_entry: "greeting".into(),
        nodes: vec![ConversationNode {
            id: "greeting".into(),
            name: "Greeting".into(),
            text: "Choose a reply.".into(),
            replies: (0..256)
                .map(|i| ConversationReply {
                    id: format!("reply-{i}"),
                    text: format!("Reply {i}."),
                    ..Default::default()
                })
                .collect(),
            ..Default::default()
        }],
        ..Default::default()
    });
    action(
        &mut p,
        "talk-action",
        "talk",
        "keeper",
        vec![Effect::StartConversation {
            conversation: "conversation".into(),
        }],
    );
    let (mut session, _) = Session::start(p.clone(), None).unwrap();
    session.command("talk keeper").unwrap();
    assert_eq!(session.conversation_view().unwrap().replies.len(), 256);
    assert_eq!(
        session.command("reply 256").unwrap().status,
        CommandStatus::Ok
    );
    assert!(session.conversation_view().is_none());
    assert_eq!(
        session.state().narrative.conversations["conversation"].chosen,
        ["reply-255".to_owned()].into()
    );
    p.conversations[0].nodes[0].replies.push(ConversationReply {
        id: "one-too-many".into(),
        text: "Overflow.".into(),
        ..Default::default()
    });
    assert!(GameDefinition::new(p).is_err());
}
