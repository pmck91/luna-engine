//! Canonical N2 fixture; progress is captured explicitly, never inferred/run.
use luna_model::*;
pub fn project() -> Project {
    let mut p = Project::blank("Narrative persistence");
    p.game.id = "narrative-foundation".into();
    p.locations[0].id = "study".into();
    p.locations[0].actions.clear();
    p.game.starting_location = "study".into();
    p.game.variables.insert("coins".into(), Value::Integer(0));
    p.characters.push(Character {
        id: "keeper".into(),
        name: "Keeper".into(),
        location: p.game.starting_location.clone(),
        ..Default::default()
    });
    p.procedures.push(Procedure {
        id: "award".into(),
        name: "Award".into(),
        description: String::new(),
        inputs: vec![],
        effects: vec![
            Effect::UpdateVariable {
                name: "coins".into(),
                op: ArithmeticOperation::Add,
                operand: NumericOperand::Literal { value: 10 },
            },
            Effect::Respond {
                id: "award-sequence".into(),
                responses: vec!["First".into(), "Second".into()],
                mode: SequenceMode::Loop,
                fallback: "".into(),
                exhaustion: ExhaustionMode::Once,
                on_exhausted: vec![],
            },
        ],
    });
    let call = |id: &str| Effect::Call {
        id: id.into(),
        procedure: "award".into(),
        arguments: Default::default(),
    };
    p.conversations = vec![
        Conversation {
            id: "conversation".into(),
            name: "Missing key".into(),
            character: "keeper".into(),
            default_entry: "greeting".into(),
            entries: vec![ConversationEntry {
                condition: Condition::QuestStatus {
                    quest: "missing".into(),
                    status: QuestStatus::Completed,
                },
                node: "revisit".into(),
            }],
            nodes: vec![
                ConversationNode {
                    id: "greeting".into(),
                    name: "Greeting".into(),
                    text: "Will you help? You have %coins% coins.".into(),
                    effects: vec![call("greeting-call"), sequence("greeting-sequence")],
                    replies: vec![ConversationReply {
                        id: "accept".into(),
                        text: "Yes, I'll help.".into(),
                        once: true,
                        destination: Some("progress".into()),
                        effects: vec![Effect::StartQuest {
                            quest: "missing".into(),
                        }],
                        ..Default::default()
                    }],
                    ..Default::default()
                },
                ConversationNode {
                    id: "progress".into(),
                    name: "Progress".into(),
                    text: "Any news?".into(),
                    replies: vec![ConversationReply {
                        id: "goodbye".into(),
                        text: "Goodbye.".into(),
                        ..Default::default()
                    }],
                    ..Default::default()
                },
                ConversationNode {
                    id: "revisit".into(),
                    name: "On return".into(),
                    text: "Thank you again.".into(),
                    terminal: true,
                    ..Default::default()
                },
            ],
            ..Default::default()
        },
        Conversation {
            id: "unused-conversation".into(),
            name: "Unused conversation".into(),
            character: "keeper".into(),
            default_entry: "unused-node".into(),
            nodes: vec![ConversationNode {
                id: "unused-node".into(),
                name: "Unused node".into(),
                text: "A later story.".into(),
                terminal: true,
                ..Default::default()
            }],
            ..Default::default()
        },
    ];
    p.quests = vec![Quest {
        id: "missing".into(),
        title: "The Missing Key".into(),
        aliases: vec!["key".into()],
        introduction: "Find the Keeper's key.".into(),
        completion: "Returned the key; earned %coins% coins.".into(),
        failure: "The key is lost.".into(),
        on_start: NarrativeHook {
            id: "quest-start".into(),
            effects: vec![call("quest-start-call")],
        },
        on_complete: NarrativeHook {
            id: "quest-complete".into(),
            effects: vec![call("quest-complete-call")],
        },
        on_fail: NarrativeHook {
            id: "quest-fail".into(),
            effects: vec![],
        },
        stages: vec![
            QuestStage {
                id: "found".into(),
                name: "Find key".into(),
                text: "Found the key.".into(),
                effects: vec![sequence("stage-sequence")],
                ..Default::default()
            },
            QuestStage {
                id: "returned".into(),
                name: "Return key".into(),
                text: "Returned the key.".into(),
                prerequisites: vec!["found".into()],
                effects: vec![call("stage-call")],
                ..Default::default()
            },
        ],
    }];
    p.game.actions.push(Action {
        id: "inspect-story".into(),
        name: "Inspect story".into(),
        verb: "use".into(),
        pattern: vec![PatternPart::Literal {
            text: "story".into(),
        }],
        effects: vec![Effect::If {
            condition: Condition::QuestStageCompleted {
                quest: "missing".into(),
                stage: "found".into(),
            },
            then: vec![Effect::Say {
                text: "The key was found.".into(),
            }],
            otherwise: vec![],
        }],
        ..Default::default()
    });
    p
}
fn sequence(id: &str) -> Effect {
    Effect::Respond {
        id: id.into(),
        responses: vec!["First".into(), "Second".into()],
        mode: SequenceMode::Fallback,
        fallback: "Done".into(),
        exhaustion: ExhaustionMode::Repeat,
        on_exhausted: vec![Effect::Say {
            text: "Exhausted".into(),
        }],
    }
}
pub fn checkpoint(mut state: GameState) -> GameState {
    state.narrative.active = Some("conversation".into());
    state.narrative.conversations.insert(
        "conversation".into(),
        ConversationProgress {
            checkpoint: Some(ConversationCheckpoint::Entered {
                node: "progress".into(),
                prompt: text::parse("Keeper says: Any news?").unwrap(),
            }),
            visited: ["greeting".into(), "progress".into()].into(),
            chosen: ["accept".into()].into(),
        },
    );
    state.narrative.quests.insert(
        "missing".into(),
        QuestProgress {
            status: QuestStatus::Active,
            stages: ["found".into()].into(),
            journal: vec![
                JournalEntry {
                    kind: JournalKind::Started,
                    text: text::parse("Find the Keeper's key.").unwrap(),
                },
                JournalEntry {
                    kind: JournalKind::Stage {
                        stage: "found".into(),
                    },
                    text: text::parse("Found the key with <cyan>0</cyan> coins.").unwrap(),
                },
            ],
        },
    );
    state
        .narrative
        .sequences
        .insert("greeting-sequence".into(), 3);
    for (root, call) in [
        ("greeting", "greeting-call"),
        ("quest-start", "quest-start-call"),
        ("returned", "stage-call"),
    ] {
        state.procedure_sequences.insert(
            ProcedurePath {
                root: root.into(),
                calls: vec![call.into()],
                sequence: "award-sequence".into(),
            },
            1,
        );
    }
    state
}
