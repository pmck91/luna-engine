#[path = "../../../tests/support/narrative.rs"]
mod fixture;
use luna_core::{GameDefinition, Session};
use luna_model::*;
fn captured(p: &Project) -> GameState {
    fixture::checkpoint(Session::start(p.clone(), None).unwrap().0.into_state())
}
#[test]
fn canonical_progress_restores_without_hooks_and_reads_through_native_conditions() {
    let p = fixture::project();
    let state = captured(&p);
    let encoded = serde_json::to_vec(&state).unwrap();
    let decoded: GameState = serde_json::from_slice(&encoded).unwrap();
    let mut session = Session::restore(p, decoded).unwrap();
    assert_eq!(session.state(), &state);
    assert_eq!(session.state().variables["coins"], Value::Integer(0));
    for c in [
        Condition::ConversationNodeVisited {
            conversation: "conversation".into(),
            node: "greeting".into(),
        },
        Condition::ConversationReplyChosen {
            conversation: "conversation".into(),
            reply: "accept".into(),
        },
        Condition::QuestStatus {
            quest: "missing".into(),
            status: QuestStatus::Active,
        },
        Condition::QuestStageCompleted {
            quest: "missing".into(),
            stage: "found".into(),
        },
    ] {
        assert!(session.test_condition(&c));
        assert!(!session.test_condition(&Condition::Not {
            condition: Box::new(c)
        }));
    }
    assert!(!session.test_condition(&Condition::QuestStatus {
        quest: "unknown".into(),
        status: QuestStatus::Undiscovered
    }));
    let result = session.command_explained("use story");
    assert!(!result.state_changed);
    assert!(
        result
            .messages
            .iter()
            .any(|m| text::plain(m) == "The key was found.")
    );
    assert_eq!(session.state(), &state);
    assert!(result.explanation.unwrap().committed);
}
#[test]
fn hooks_use_stable_native_roots_but_never_extend_the_legacy_sequence_schema() {
    let p = fixture::project();
    let definition = GameDefinition::new(p.clone()).unwrap();
    let state = captured(&p);
    assert!(!state.sequences.contains_key("greeting-sequence"));
    assert!(!state.sequences.contains_key("stage-sequence"));
    definition.validate_state(&state).unwrap();
    for path in state.procedure_sequences.keys() {
        let mut bad = state.clone();
        let cursor = bad.procedure_sequences.remove(path).unwrap();
        let mut invalid = path.clone();
        invalid.root = "progress".into();
        bad.procedure_sequences.insert(invalid, cursor);
        assert!(definition.validate_state(&bad).is_err());
    }
    let mut bad = state;
    bad.narrative
        .sequences
        .insert("greeting-sequence".into(), 4);
    assert!(definition.validate_state(&bad).is_err());
}
#[test]
fn malformed_snapshots_and_incompatible_edits_preserve_the_live_session() {
    let p = fixture::project();
    let original = captured(&p);
    let mut session = Session::restore(p.clone(), original.clone()).unwrap();
    let changes: [fn(&mut GameState); 12] = [
        |s| {
            s.narrative.active = Some("missing-conversation".into());
        },
        |s| {
            s.narrative
                .conversations
                .get_mut("conversation")
                .unwrap()
                .visited
                .insert("foreign-node".into());
        },
        |s| {
            s.narrative
                .conversations
                .get_mut("conversation")
                .unwrap()
                .chosen
                .insert("unknown-reply".into());
        },
        |s| {
            s.narrative
                .conversations
                .get_mut("conversation")
                .unwrap()
                .visited
                .remove("greeting");
        },
        |s| {
            s.narrative
                .conversations
                .get_mut("conversation")
                .unwrap()
                .checkpoint = Some(ConversationCheckpoint::Pending {
                node: "progress".into(),
            });
        },
        |s| {
            s.characters.get_mut("keeper").unwrap().hidden = true;
        },
        |s| {
            s.narrative.quests.get_mut("missing").unwrap().status = QuestStatus::Completed;
        },
        |s| {
            s.narrative
                .quests
                .get_mut("missing")
                .unwrap()
                .journal
                .swap(0, 1);
        },
        |s| {
            s.narrative
                .quests
                .get_mut("missing")
                .unwrap()
                .stages
                .insert("returned".into());
        },
        |s| {
            s.narrative.quests.get_mut("missing").unwrap().journal[1].text[0].colour =
                Some("unknown".into());
        },
        |s| {
            s.narrative.sequences.insert("award-sequence".into(), 0);
        },
        |s| {
            s.narrative.quests.get_mut("missing").unwrap().journal[0].text[0]
                .text
                .push('\u{1b}');
        },
    ];
    for change in changes {
        let mut bad = original.clone();
        change(&mut bad);
        assert!(session.replace_state(bad).is_err());
        assert_eq!(session.state(), &original);
    }
    let mut changed = p;
    changed.conversations[0].nodes[1].id = "replacement-node".into();
    changed.conversations[0].nodes[0].replies[0].destination = Some("replacement-node".into());
    assert!(
        GameDefinition::new(changed)
            .unwrap()
            .validate_state(&original)
            .is_err()
    );
}
#[test]
fn pending_and_terminal_quest_snapshots_are_distinct_and_consistent() {
    let p = fixture::project();
    let mut state = captured(&p);
    state.narrative.active = None;
    state
        .narrative
        .conversations
        .get_mut("conversation")
        .unwrap()
        .checkpoint = Some(ConversationCheckpoint::Pending {
        node: "revisit".into(),
    });
    let definition = GameDefinition::new(p.clone()).unwrap();
    definition.validate_state(&state).unwrap();
    for status in [QuestStatus::Completed, QuestStatus::Failed] {
        let mut ended = state.clone();
        let quest = ended.narrative.quests.get_mut("missing").unwrap();
        if status == QuestStatus::Completed {
            quest.stages.insert("returned".into());
            quest.journal.push(JournalEntry {
                kind: JournalKind::Stage {
                    stage: "returned".into(),
                },
                text: text::parse("Returned key.").unwrap(),
            });
        }
        quest.status = status;
        quest.journal.push(JournalEntry {
            kind: if status == QuestStatus::Completed {
                JournalKind::Completed
            } else {
                JournalKind::Failed
            },
            text: vec![],
        });
        definition.validate_state(&ended).unwrap();
        let restored = Session::restore(p.clone(), ended.clone()).unwrap();
        assert_eq!(restored.state(), &ended);
    }
}
#[test]
fn resource_limits_apply_to_canonical_restore() {
    let p = fixture::project();
    let mut state = captured(&p);
    let definition = GameDefinition::new(p).unwrap();
    state.narrative.quests.get_mut("missing").unwrap().journal[0].text[0].text =
        "x".repeat(NARRATIVE_TEXT_LIMIT + 1);
    assert!(
        definition
            .validate_state(&state)
            .unwrap_err()
            .to_string()
            .contains("resource bounds")
    );
    state.narrative.quests.clear();
    state.narrative.sequences = (0..=NARRATIVE_PROGRESS_LIMIT)
        .map(|n| (format!("cursor-{n}"), 0))
        .collect();
    assert!(
        definition
            .validate_state(&state)
            .unwrap_err()
            .to_string()
            .contains("resource bounds")
    );
}
#[test]
fn legacy_world_states_get_empty_narrative_without_losing_required_cursors() {
    for version in 1..=4 {
        let p = fixture::project();
        let mut legacy = p.clone();
        legacy.game.format_version = version;
        legacy.conversations.clear();
        legacy.quests.clear();
        legacy.procedures.clear();
        legacy.game.actions.clear();
        if version < 3 {
            legacy.game.command_assistance = None;
        }
        let old = Session::start(legacy.clone(), None).unwrap().0.into_state();
        let raw = serde_json::to_value(&old).unwrap();
        assert!(raw.get("narrative").is_none());
        let decoded: GameState = serde_json::from_value(raw).unwrap();
        let restored = Session::restore(p, decoded).unwrap();
        assert!(restored.state().narrative.is_empty());
        assert_eq!(restored.state().variables, old.variables);
        let mut bad = restored.state().clone();
        bad.narrative
            .quests
            .insert("missing".into(), QuestProgress::default());
        assert!(
            GameDefinition::new(legacy)
                .unwrap()
                .validate_state(&bad)
                .is_err()
        );
    }
    let p = fixture::project();
    let mut state = captured(&p);
    state.narrative = NarrativeProgress::default();
    state.procedure_sequences.clear();
    Session::restore(p, state).unwrap();
}
