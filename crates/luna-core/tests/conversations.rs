#[path = "../../../tests/support/conversations.rs"]
mod fixture;
use fixture::{action, increment, project};
use luna_core::{
    CommandResult, CommandStatus, ConversationView, NarrativeOperation, Session, TraceKind,
};
use luna_model::*;
fn plain(r: &CommandResult) -> String {
    r.messages
        .iter()
        .map(|m| text::plain(m))
        .collect::<Vec<_>>()
        .join("\n")
}
fn start() -> Session {
    Session::start(project(), None).unwrap().0
}
fn run(s: &mut Session, input: &str) -> CommandResult {
    let r = s.command(input).unwrap();
    assert_eq!(r.status, CommandStatus::Ok, "{input}: {}", plain(&r));
    s.definition().validate_state(s.state()).unwrap();
    r
}
fn offer(s: &Session) -> ConversationView {
    s.conversation_view().unwrap().clone()
}
fn value(s: &Session, name: &str) -> Value {
    s.state().variables[name].clone()
}
fn node<'a>(p: &'a mut Project, id: &str) -> &'a mut ConversationNode {
    p.conversations[0]
        .nodes
        .iter_mut()
        .find(|n| n.id == id)
        .unwrap()
}
fn reply<'a>(p: &'a mut Project, id: &str) -> &'a mut ConversationReply {
    p.conversations[0]
        .nodes
        .iter_mut()
        .flat_map(|n| &mut n.replies)
        .find(|r| r.id == id)
        .unwrap()
}
fn start_effect() -> Effect {
    Effect::StartConversation {
        conversation: "conversation".into(),
    }
}
fn pause_effect() -> Effect {
    Effect::PauseConversation {
        conversation: "conversation".into(),
    }
}
fn end_effect() -> Effect {
    Effect::EndConversation {
        conversation: "conversation".into(),
    }
}
fn finish(s: &mut Session) {
    for c in [
        "talk keeper",
        "1",
        "take brass key",
        "talk keeper",
        "reply 2",
        "1",
    ] {
        run(s, c);
    }
}

#[test]
fn native_predefined_choices_complete_the_quest_and_return_to_a_distinct_terminal_acknowledgement()
{
    assert_eq!(
        project(),
        serde_json::from_str::<Project>(include_str!(
            "../../../tests/fixtures/narrative/conversations5.json"
        ))
        .unwrap()
    );
    let mut s = start();
    let result = run(&mut s, "talk keeper");
    assert!(plain(&result).contains("1. Yes, I'll find it."));
    assert_eq!(
        offer(&s)
            .replies
            .iter()
            .map(|r| r.id.as_str())
            .collect::<Vec<_>>(),
        ["accept", "decline"]
    );
    run(&mut s, "1");
    assert_eq!(offer(&s).replies.len(), 1);
    run(&mut s, "take brass key");
    assert!(s.conversation_view().is_none());
    run(&mut s, "talk keeper");
    run(&mut s, "reply 2");
    assert_eq!(value(&s, "coins"), Value::Integer(10));
    assert_eq!(offer(&s).node, "thanks-node");
    run(&mut s, "1");
    assert!(s.conversation_view().is_none());
    for _ in 0..3 {
        let r = run(&mut s, "talk keeper");
        assert!(plain(&r).contains("Thank you again"));
        assert!(!plain(&r).contains("ten coins"));
        assert!(s.conversation_view().is_none());
    }
    assert_eq!(value(&s, "rewards"), Value::Integer(1));
    assert_eq!(s.state().narrative.quests["missing"].journal.len(), 4);
    assert!(
        s.state().narrative.conversations["conversation"]
            .checkpoint
            .is_none()
    );
}

#[test]
fn foreign_future_consumed_and_stale_reply_ids_cannot_skip_or_reward() {
    let mut s = start();
    run(&mut s, "talk keeper");
    let first = offer(&s);
    for id in ["handover", "farewell", "unknown"] {
        let before = s.state().clone();
        let r = s.select_reply(&first.offer_token, id).unwrap();
        assert_eq!(r.status, CommandStatus::Unmatched);
        assert_eq!(s.state(), &before);
    }
    s.select_reply(&first.offer_token, "accept").unwrap();
    let before = s.state().clone();
    for (token, id) in [
        (&first.offer_token, "accept"),
        (&offer(&s).offer_token, "handover"),
    ] {
        assert_eq!(
            s.select_reply(token, id).unwrap().status,
            CommandStatus::Unmatched
        );
        assert_eq!(s.state(), &before);
    }
    assert_eq!(value(&s, "rewards"), Value::Integer(0));
}

#[test]
fn numbers_are_strict_and_dialogue_words_never_select_a_response() {
    let mut s = start();
    run(&mut s, "talk keeper");
    let before = s.state().clone();
    let token = offer(&s).offer_token;
    for command in [
        "reply",
        "reply 0",
        "reply -1",
        "reply +1",
        "reply 1!",
        "reply 1 extra",
        "reply 999999999999999999999999999999",
        "0",
        "99",
        "yes",
        "no",
        "ask key",
        "Yes, I'll find it.",
    ] {
        let r = s.command(command).unwrap();
        assert_eq!(r.status, CommandStatus::Unmatched, "{command}");
        assert_eq!(s.state(), &before);
        assert_eq!(offer(&s).offer_token, token);
    }
    run(&mut s, "  RePlY\t01  ");
    assert_eq!(s.state().narrative.status("missing"), QuestStatus::Active);
}

#[test]
fn readonly_controls_and_failed_requirements_preserve_offer_and_do_not_replay_entry() {
    let mut s = start();
    run(&mut s, "talk keeper");
    let before = s.state().clone();
    let original = offer(&s);
    for command in [
        "look",
        "inventory",
        "help",
        "help keeper",
        "quests",
        "quest unknown",
        "save checkpoint",
        "saves",
        "load checkpoint",
        "nonsense",
        "use blocked",
    ] {
        s.command(command).unwrap();
        assert_eq!(s.state(), &before, "{command}");
        assert_eq!(offer(&s), original, "{command}");
    }
    assert_eq!(value(&s, "entries"), Value::Integer(1));
    let old_commands = value(&s, "commands");
    run(&mut s, "talk keeper");
    assert_eq!(
        value(&s, "commands"),
        Value::Integer(match old_commands {
            Value::Integer(n) => n + 1,
            _ => unreachable!(),
        })
    );
    assert_eq!(value(&s, "entries"), Value::Integer(1));
    assert_eq!(offer(&s).offer_token, original.offer_token);
}

#[test]
fn noun_clarification_owns_numbers_and_blocks_explicit_and_button_replies() {
    let mut s = start();
    run(&mut s, "talk keeper");
    let original = offer(&s);
    let waiting = s.command("take key").unwrap();
    assert_eq!(waiting.status, CommandStatus::Ambiguous);
    assert!(!plain(&waiting).contains("1. Yes, I'll find it."));
    let question = s.pending_clarification();
    assert!(!offer(&s).selection_enabled);
    assert_eq!(offer(&s).offer_token, original.offer_token);
    let before = s.state().clone();
    assert_eq!(
        s.command("reply 1").unwrap().status,
        CommandStatus::Unmatched
    );
    assert_eq!(
        s.select_reply(&original.offer_token, "accept")
            .unwrap()
            .status,
        CommandStatus::Unmatched
    );
    assert_eq!(s.state(), &before);
    assert_eq!(s.pending_clarification(), question);
    s.command("quests").unwrap();
    assert_eq!(s.pending_clarification(), question);
    run(&mut s, "1");
    assert!(s.pending_clarification().is_none());
    assert!(s.conversation_view().is_none());
    assert_eq!(s.state().objects["key"].placement, Placement::Inventory);
    assert_eq!(
        s.state().narrative.status("missing"),
        QuestStatus::Undiscovered
    );
    run(&mut s, "talk keeper");
    run(&mut s, "reply 1");
    assert!(
        s.state().narrative.quests["missing"]
            .stages
            .contains("found-stage")
    );
}

#[test]
fn clarification_cancel_restores_selection_without_rebinding_its_offer() {
    let mut s = start();
    run(&mut s, "talk keeper");
    let old = offer(&s);
    s.command("take key").unwrap();
    s.command("cancel").unwrap();
    assert_eq!(offer(&s), old);
    assert!(s.pending_clarification().is_none());
    run(&mut s, "1");
    assert_eq!(s.state().narrative.status("missing"), QuestStatus::Active);
}

#[test]
fn failed_world_command_restores_pending_question_offer_state_and_output() {
    let mut s = start();
    run(&mut s, "talk keeper");
    s.command("take key").unwrap();
    let before = s.state().clone();
    let old = offer(&s);
    let pending = s.pending_clarification();
    let r = s.command_explained("use risk");
    assert_eq!(r.status, CommandStatus::Error);
    assert!(r.messages.is_empty());
    assert_eq!(s.state(), &before);
    assert_eq!(offer(&s), old);
    assert_eq!(s.pending_clarification(), pending);
    assert_eq!(r.conversation, Some(old));
    run(&mut s, "1");
}

#[test]
fn hint_progress_refreshes_reply_identity_without_replaying_dialogue() {
    let mut p = project();
    p.locations[0].hints.push(HintSet {
        id: "hint".into(),
        name: "Study clue".into(),
        stages: vec![HintStage {
            id: "hint-stage".into(),
            clues: vec!["Try the desk.".into()],
            ..Default::default()
        }],
        ..Default::default()
    });
    reply(&mut p, "accept").condition = Condition::Not {
        condition: Box::new(Condition::HintUsed {
            hint: "hint".into(),
        }),
    };
    let mut s = Session::start(p, None).unwrap().0;
    run(&mut s, "talk keeper");
    let old = offer(&s);
    let commands = value(&s, "commands");
    run(&mut s, "hint Study");
    assert_eq!(
        offer(&s)
            .replies
            .iter()
            .map(|r| r.id.as_str())
            .collect::<Vec<_>>(),
        ["decline"]
    );
    assert_ne!(offer(&s).offer_token, old.offer_token);
    assert_eq!(value(&s, "entries"), Value::Integer(1));
    assert_eq!(value(&s, "commands"), commands);
    let before = s.state().clone();
    assert_eq!(
        s.select_reply(&old.offer_token, "accept").unwrap().status,
        CommandStatus::Unmatched
    );
    assert_eq!(s.state(), &before);
}

#[test]
fn restore_and_equal_state_replacement_reissue_authority_without_replaying_prompts_or_hooks() {
    let mut s = start();
    run(&mut s, "talk keeper");
    let old = offer(&s);
    let state = s.state().clone();
    let mut restored = Session::restore(
        project(),
        serde_json::from_slice(&serde_json::to_vec(&state).unwrap()).unwrap(),
    )
    .unwrap();
    assert_eq!(restored.state(), &state);
    assert_ne!(offer(&restored).offer_token, old.offer_token);
    let messages = restored.resume_messages().unwrap();
    assert!(
        messages
            .iter()
            .any(|m| text::plain(m).contains("Will you find my key"))
    );
    assert_eq!(restored.state(), &state);
    assert_eq!(
        restored
            .select_reply(&old.offer_token, "accept")
            .unwrap()
            .status,
        CommandStatus::Unmatched
    );
    restored.command("take key").unwrap();
    let old = offer(&restored);
    let question = restored.pending_clarification();
    let mut invalid = restored.state().clone();
    invalid.characters.get_mut("keeper").unwrap().hidden = true;
    assert!(restored.replace_state(invalid).is_err());
    assert_eq!(offer(&restored), old);
    assert_eq!(restored.pending_clarification(), question);
    restored.replace_state(restored.state().clone()).unwrap();
    assert!(restored.pending_clarification().is_none());
    assert_ne!(offer(&restored).offer_token, old.offer_token);
}

#[test]
fn movement_pause_and_bye_resume_an_entered_snapshot_without_replaying_response_cursors() {
    let mut s = start();
    run(&mut s, "talk keeper");
    let old = offer(&s);
    let cursor = s.state().narrative.sequences["greeting-response"];
    for command in ["bye", "use garden"] {
        run(&mut s, command);
        assert!(s.conversation_view().is_none());
        if command == "use garden" {
            run(&mut s, "use study");
        }
        let state = s.state().clone();
        s = Session::restore(project(), state).unwrap();
        run(&mut s, "talk keeper");
        assert_eq!(offer(&s).prompt, old.prompt);
        assert_eq!(value(&s, "entries"), Value::Integer(1));
        assert_eq!(s.state().narrative.sequences["greeting-response"], cursor);
    }
}

#[test]
fn reply_speaker_removal_saves_pending_destination_and_enters_it_once_on_resume() {
    let mut p = project();
    reply(&mut p, "accept").effects.push(Effect::MoveCharacter {
        character: "keeper".into(),
        location: "garden".into(),
    });
    action(
        &mut p,
        "return-keeper",
        vec![Effect::MoveCharacter {
            character: "keeper".into(),
            location: "study".into(),
        }],
    );
    node(&mut p, "progress").effects.push(increment("tail"));
    let mut s = Session::start(p.clone(), None).unwrap().0;
    run(&mut s, "talk keeper");
    run(&mut s, "1");
    assert!(s.conversation_view().is_none());
    assert_eq!(value(&s, "tail"), Value::Integer(0));
    assert!(
        matches!(&s.state().narrative.conversations["conversation"].checkpoint,Some(ConversationCheckpoint::Pending { node }) if node=="progress")
    );
    s = Session::restore(p, s.state().clone()).unwrap();
    run(&mut s, "use return-keeper");
    run(&mut s, "talk keeper");
    run(&mut s, "talk keeper");
    assert_eq!(offer(&s).node, "progress");
    assert_eq!(value(&s, "tail"), Value::Integer(1));
    assert_eq!(value(&s, "starts"), Value::Integer(1));
}

#[test]
fn entry_speaker_hiding_preserves_entered_prompt_without_replaying_its_hook() {
    let mut p = project();
    node(&mut p, "progress").effects = vec![
        increment("tail"),
        Effect::Hide {
            entity: "keeper".into(),
        },
    ];
    action(
        &mut p,
        "reveal-keeper",
        vec![Effect::Reveal {
            entity: "keeper".into(),
        }],
    );
    let mut s = Session::start(p.clone(), None).unwrap().0;
    run(&mut s, "talk keeper");
    run(&mut s, "1");
    assert!(s.conversation_view().is_none());
    assert_eq!(value(&s, "tail"), Value::Integer(1));
    assert!(
        matches!(&s.state().narrative.conversations["conversation"].checkpoint,Some(ConversationCheckpoint::Entered { node,prompt }) if node=="progress" && !prompt.is_empty())
    );
    s = Session::restore(p, s.state().clone()).unwrap();
    run(&mut s, "use reveal-keeper");
    run(&mut s, "talk keeper");
    assert_eq!(offer(&s).node, "progress");
    assert_eq!(value(&s, "tail"), Value::Integer(1));
}

#[test]
fn pause_start_callbacks_inside_entry_do_not_reenter_or_leave_an_empty_prompt() {
    for immediate in [false, true] {
        let mut p = project();
        node(&mut p, "greeting").effects.push(pause_effect());
        if immediate {
            node(&mut p, "greeting").effects.push(start_effect());
        }
        let mut s = Session::start(p.clone(), None).unwrap().0;
        run(&mut s, "talk keeper");
        assert_eq!(s.conversation_view().is_some(), immediate);
        assert_eq!(value(&s, "entries"), Value::Integer(1));
        assert!(
            matches!(&s.state().narrative.conversations["conversation"].checkpoint,Some(ConversationCheckpoint::Entered { prompt,.. }) if !prompt.is_empty())
        );
        s = Session::restore(p, s.state().clone()).unwrap();
        run(&mut s, "talk keeper");
        assert_eq!(offer(&s).node, "greeting");
        assert_eq!(value(&s, "entries"), Value::Integer(1));
    }
}

#[test]
fn terminal_entry_speaks_and_closes_even_if_it_hides_its_speaker() {
    let mut p = project();
    node(&mut p, "revisit").effects.push(Effect::Hide {
        entity: "keeper".into(),
    });
    let mut s = Session::start(p.clone(), None).unwrap().0;
    finish(&mut s);
    let result = run(&mut s, "talk keeper");
    assert!(plain(&result).contains("Thank you again"));
    assert!(s.conversation_view().is_none());
    assert!(
        s.state().narrative.conversations["conversation"]
            .checkpoint
            .is_none()
    );
    Session::restore(p, s.into_state()).unwrap();
}

#[test]
fn stop_in_reply_still_transitions_but_pause_end_and_replacement_supersede_it() {
    for mode in ["stop", "pause", "end", "replace"] {
        let mut p = project();
        reply(&mut p, "accept").effects.push(match mode {
            "stop" => Effect::Stop,
            "pause" => pause_effect(),
            _ => end_effect(),
        });
        if mode == "replace" {
            p.conversations[0].entries.insert(
                0,
                ConversationEntry {
                    condition: Condition::QuestStatus {
                        quest: "missing".into(),
                        status: QuestStatus::Active,
                    },
                    node: "thanks-node".into(),
                },
            );
            reply(&mut p, "accept").effects.push(start_effect());
        }
        reply(&mut p, "accept").effects.push(increment("tail"));
        let mut s = Session::start(p, None).unwrap().0;
        run(&mut s, "talk keeper");
        run(&mut s, "1");
        match mode {
            "stop" => {
                assert_eq!(offer(&s).node, "progress");
                assert_eq!(value(&s, "tail"), Value::Integer(0));
            }
            "replace" => assert_eq!(offer(&s).node, "thanks-node"),
            _ => assert!(s.conversation_view().is_none()),
        }
        if mode == "pause" {
            assert!(
                matches!(&s.state().narrative.conversations["conversation"].checkpoint,Some(ConversationCheckpoint::Entered { node,.. }) if node=="greeting")
            );
        }
        if mode == "end" {
            assert!(
                s.state().narrative.conversations["conversation"]
                    .checkpoint
                    .is_none()
            );
        }
    }
}

#[test]
fn starting_another_encounter_requires_pause_or_end_and_entry_ownership_survives_callbacks() {
    for paused in [false, true] {
        let mut p = project();
        if paused {
            reply(&mut p, "accept").effects.push(pause_effect());
        }
        reply(&mut p, "accept")
            .effects
            .push(Effect::StartConversation {
                conversation: "other-conversation".into(),
            });
        let mut s = Session::start(p, None).unwrap().0;
        run(&mut s, "talk keeper");
        let before = s.state().clone();
        let old = offer(&s);
        let result = s.command_explained("1");
        if paused {
            assert_eq!(result.status, CommandStatus::Ok);
            assert!(plain(&result).contains("Another conversation"));
            assert!(s.conversation_view().is_none());
            assert!(
                !s.state().narrative.conversations["conversation"]
                    .visited
                    .contains("progress")
            );
        } else {
            assert_eq!(result.status, CommandStatus::Error);
            assert_eq!(s.state(), &before);
            assert_eq!(offer(&s), old);
        }
    }
    let mut p = project();
    p.game
        .variables
        .insert("replaced".into(), Value::Bool(false));
    node(&mut p, "greeting").effects.push(Effect::If {
        condition: Condition::Variable {
            name: "replaced".into(),
            op: Comparison::Eq,
            value: Value::Bool(false),
        },
        then: vec![
            Effect::SetVariable {
                name: "replaced".into(),
                value: Value::Bool(true),
            },
            end_effect(),
            start_effect(),
        ],
        otherwise: vec![],
    });
    p.conversations[0].entries.insert(
        0,
        ConversationEntry {
            condition: Condition::Variable {
                name: "replaced".into(),
                op: Comparison::Eq,
                value: Value::Bool(true),
            },
            node: "progress".into(),
        },
    );
    let mut s = Session::start(p, None).unwrap().0;
    run(&mut s, "talk keeper");
    assert_eq!(offer(&s).node, "progress");
    assert!(!text::plain(&offer(&s).prompt).contains("Will you find"));
}

#[test]
fn game_end_from_reply_procedure_or_watch_clears_all_checkpoints_and_keeps_journal() {
    for procedure in [false, true] {
        let mut p = project();
        p.game.endings.push(Ending {
            id: "done".into(),
            name: "Done".into(),
            text: "The story ends.".into(),
            ..Default::default()
        });
        let end = Effect::End {
            ending: "done".into(),
        };
        if procedure {
            p.procedures.push(Procedure {
                id: "finish-story".into(),
                name: "Finish story".into(),
                description: String::new(),
                inputs: vec![],
                effects: vec![end, increment("tail")],
            });
            reply(&mut p, "accept").effects.push(Effect::Call {
                id: "finish-call".into(),
                procedure: "finish-story".into(),
                arguments: Default::default(),
            });
        } else {
            p.game.triggers.push(Trigger {
                id: "end-watch".into(),
                name: "End watch".into(),
                watch: Some(TriggerWatch {
                    target: ValueTarget::Variable {
                        name: "starts".into(),
                    },
                    mode: WatchMode::EachChange,
                }),
                effects: vec![end],
                ..Default::default()
            });
        }
        let mut s = Session::start(p.clone(), None).unwrap().0;
        run(&mut s, "talk keeper");
        run(&mut s, "1");
        assert_eq!(s.state().ending.as_deref(), Some("done"));
        assert!(s.conversation_view().is_none());
        assert!(
            s.state()
                .narrative
                .conversations
                .values()
                .all(|h| h.checkpoint.is_none())
        );
        assert_eq!(value(&s, "tail"), Value::Integer(0));
        let before = s.state().clone();
        assert!(plain(&run(&mut s, "quests")).contains("Find the Keeper"));
        assert_eq!(s.state(), &before);
        Session::restore(p, s.into_state()).unwrap();
    }
}

#[test]
fn nested_late_failure_rolls_back_reply_quest_rewards_cursors_messages_and_offer() {
    let mut p = project();
    node(&mut p, "thanks-node")
        .effects
        .push(Effect::UpdateVariable {
            name: "coins".into(),
            op: ArithmeticOperation::Divide,
            operand: NumericOperand::Variable {
                name: "divisor".into(),
            },
        });
    let mut s = Session::start(p, None).unwrap().0;
    for c in ["talk keeper", "1", "take brass key", "talk keeper"] {
        run(&mut s, c);
    }
    let before = s.state().clone();
    let old = offer(&s);
    let r = s.select_reply_explained(&old.offer_token, "handover");
    assert_eq!(r.status, CommandStatus::Error);
    assert!(r.messages.is_empty());
    assert_eq!(s.state(), &before);
    assert_eq!(offer(&s), old);
    assert_eq!(r.conversation, Some(old));
    let trace = r.explanation.unwrap();
    assert!(!trace.committed);
    assert!(
        trace
            .discarded_messages
            .iter()
            .any(|m| text::plain(m).contains("Ten coins"))
    );
    assert!(trace.steps.iter().any(|step| matches!(
        step.kind,
        TraceKind::Narrative {
            operation: NarrativeOperation::SelectReply { .. },
            applied: true
        }
    )));
    assert!(
        trace
            .changes
            .iter()
            .any(|c| c.path.first().is_some_and(|p| p == "procedure_sequences"))
    );
}

#[test]
fn normal_number_button_and_explained_selection_share_state_and_player_output() {
    let mut number = start();
    let mut button = start();
    let mut explained = start();
    for command in [
        "talk keeper",
        "1",
        "take brass key",
        "talk keeper",
        "reply 2",
        "1",
        "talk keeper",
    ] {
        let a = run(&mut number, command);
        let select = match command {
            "1" => Some(0),
            "reply 2" => Some(1),
            _ => None,
        };
        let b = if let Some(i) = select {
            let o = offer(&button);
            button
                .select_reply(&o.offer_token, &o.replies[i].id)
                .unwrap()
        } else {
            button.command(command).unwrap()
        };
        let c = if let Some(i) = select {
            let o = offer(&explained);
            explained.select_reply_explained(&o.offer_token, &o.replies[i].id)
        } else {
            explained.command_explained(command)
        };
        assert_eq!(a.messages, b.messages);
        assert_eq!(b.messages, c.messages);
        assert_eq!(a.status, c.status);
        assert_eq!(number.state(), button.state());
        assert_eq!(button.state(), explained.state());
        assert!(c.explanation.unwrap().committed);
    }
}

#[test]
fn repeated_entries_use_real_native_lazy_cursors_exhaustion_resets_and_history_conditions() {
    let mut p = project();
    node(&mut p, "greeting").replies.push(ConversationReply {
        id: "again".into(),
        text: "Say that again.".into(),
        destination: Some("greeting".into()),
        ..Default::default()
    });
    let mut s = Session::start(p.clone(), None).unwrap().0;
    run(&mut s, "talk keeper");
    for _ in 0..4 {
        run(&mut s, "3");
    }
    assert_eq!(s.state().narrative.sequences["greeting-response"], 3);
    assert_eq!(value(&s, "exhausted"), Value::Integer(1));
    assert!(s.state().sequences.is_empty());
    assert!(s.test_condition(&Condition::ConversationNodeVisited {
        conversation: "conversation".into(),
        node: "greeting".into()
    }));
    assert!(s.test_condition(&Condition::ConversationReplyChosen {
        conversation: "conversation".into(),
        reply: "again".into()
    }));
    let old = offer(&s);
    s = Session::restore(p, s.state().clone()).unwrap();
    assert_eq!(offer(&s).prompt, old.prompt);
    assert_eq!(value(&s, "entries"), Value::Integer(5));
}

#[test]
fn conditional_returns_without_a_quest_and_dead_ends_do_not_offer_hidden_topics() {
    let mut p = project();
    p.conversations[0].entries.insert(
        0,
        ConversationEntry {
            condition: Condition::ConversationReplyChosen {
                conversation: "conversation".into(),
                reply: "decline".into(),
            },
            node: "revisit".into(),
        },
    );
    let mut s = Session::start(p, None).unwrap().0;
    run(&mut s, "talk keeper");
    run(&mut s, "2");
    let r = run(&mut s, "talk keeper");
    assert!(plain(&r).contains("Thank you again"));
    assert!(s.quest_log().is_empty());
    let mut p = project();
    node(&mut p, "greeting")
        .replies
        .iter_mut()
        .for_each(|r| r.condition = Condition::False);
    let mut s = Session::start(p, None).unwrap().0;
    let r = run(&mut s, "talk keeper");
    assert!(plain(&r).contains("Will you find"));
    assert!(s.conversation_view().is_none());
    assert!(
        s.state().narrative.conversations["conversation"]
            .checkpoint
            .is_none()
    );
}

#[test]
fn indexed_world_interruption_covers_actions_on_all_owners_exits_and_procedure_starters() {
    let mut p = project();
    for (id, owner) in [("room", 0), ("object", 1), ("character", 2)] {
        let a = Action {
            id: format!("owned-{id}"),
            verb: "use".into(),
            pattern: vec![PatternPart::Literal { text: id.into() }],
            effects: vec![increment("tail")],
            ..Default::default()
        };
        match owner {
            0 => p.locations[0].actions.push(a),
            1 => p.objects[0].actions.push(a),
            _ => p.characters[0].actions.push(a),
        }
    }
    p.locations[0].exits.push(Exit {
        id: "exit-garden".into(),
        name: "garden".into(),
        verb: "go".into(),
        destination: "garden".into(),
        ..Default::default()
    });
    p.procedures.push(Procedure {
        id: "talk-definition".into(),
        name: "Talk definition".into(),
        description: String::new(),
        inputs: vec![],
        effects: vec![start_effect()],
    });
    action(
        &mut p,
        "through-call",
        vec![Effect::Call {
            id: "talk-call".into(),
            procedure: "talk-definition".into(),
            arguments: Default::default(),
        }],
    );
    for command in ["use room", "use object", "use character", "go garden"] {
        let mut s = Session::start(p.clone(), None).unwrap().0;
        run(&mut s, "talk keeper");
        run(&mut s, command);
        assert!(s.conversation_view().is_none(), "{command}");
    }
    let mut s = Session::start(p, None).unwrap().0;
    run(&mut s, "use through-call");
    let old = offer(&s);
    run(&mut s, "use through-call");
    assert_eq!(offer(&s), old);
    assert_eq!(value(&s, "entries"), Value::Integer(1));
}

#[test]
fn recursive_entry_and_long_reply_hooks_share_native_depth_and_operation_limits() {
    for depth in [true, false] {
        let mut p = project();
        if depth {
            node(&mut p, "greeting")
                .effects
                .extend([end_effect(), start_effect()]);
        } else {
            reply(&mut p, "accept")
                .effects
                .extend((0..2050).map(|_| increment("tail")));
        }
        let mut s = Session::start(p, None).unwrap().0;
        if !depth {
            run(&mut s, "talk keeper");
        }
        let before = s.state().clone();
        let old = s.conversation_view().cloned();
        let r = s.command_explained(if depth { "talk keeper" } else { "1" });
        assert_eq!(r.status, CommandStatus::Error);
        assert!(r.messages.is_empty());
        assert_eq!(s.state(), &before);
        assert_eq!(s.conversation_view().cloned(), old);
        assert!(r.explanation.unwrap().error.unwrap().contains(if depth {
            "64 nested"
        } else {
            "2048 operations"
        }));
    }
}

#[test]
fn startup_conversations_and_unavailable_starts_use_ordinary_scopes_and_limits() {
    let mut p = project();
    p.game.triggers.push(Trigger {
        id: "startup-talk".into(),
        name: "Startup talk".into(),
        event: Event::Start,
        effects: vec![start_effect()],
        ..Default::default()
    });
    let (s, result) = Session::start(p, None).unwrap();
    assert_eq!(offer(&s).node, "greeting");
    assert!(result.conversation.is_some());
    assert_eq!(value(&s, "entries"), Value::Integer(1));
    let mut p = project();
    p.conversations[0].available = Condition::False;
    let mut s = Session::start(p, None).unwrap().0;
    run(&mut s, "talk keeper");
    assert!(s.state().narrative.is_empty());
    assert!(s.conversation_view().is_none());
}

#[test]
fn speaker_names_and_historical_prompts_are_literal_and_offered_text_uses_live_values() {
    let mut p = project();
    p.characters[0].name = "Keeper <red> & %coins%".into();
    p.characters[0].aliases = vec!["keeper".into()];
    p.characters[0].name_colour = Some("cyan".into());
    reply(&mut p, "accept").text = "Yes; I have %coins% coins.".into();
    let mut s = Session::start(p, None).unwrap().0;
    run(&mut s, "talk keeper");
    let old = offer(&s);
    assert_eq!(old.prompt[0].text, "Keeper <red> & %coins%");
    assert_eq!(old.prompt[0].colour.as_deref(), Some("cyan"));
    let mut changed = s.state().clone();
    changed.variables.insert("coins".into(), Value::Integer(9));
    s.replace_state(changed).unwrap();
    assert_eq!(offer(&s).prompt, old.prompt);
    assert_eq!(
        text::plain(&offer(&s).replies[0].text),
        "Yes; I have 9 coins."
    );
    assert_ne!(offer(&s).offer_token, old.offer_token);
    assert_eq!(
        s.select_reply(&old.offer_token, "accept").unwrap().status,
        CommandStatus::Unmatched
    );
}

#[test]
fn numeric_world_commands_are_available_only_when_an_encounter_does_not_own_input() {
    let mut p = project();
    p.vocabulary.push(Verb {
        id: "one".into(),
        canonical: "1".into(),
        ..Default::default()
    });
    p.game.actions.push(Action {
        id: "numeric-command".into(),
        verb: "one".into(),
        effects: vec![increment("tail")],
        ..Default::default()
    });
    let mut s = Session::start(p, None).unwrap().0;
    run(&mut s, "1");
    assert_eq!(value(&s, "tail"), Value::Integer(1));
    run(&mut s, "talk keeper");
    run(&mut s, "1");
    assert_eq!(value(&s, "tail"), Value::Integer(1));
    assert_eq!(s.state().narrative.status("missing"), QuestStatus::Active);
    run(&mut s, "bye");
    run(&mut s, "1");
    assert_eq!(value(&s, "tail"), Value::Integer(2));
}

#[test]
fn replacement_keeps_progress_exact_and_next_attempt_reconciles_unavailable_offers_without_hooks() {
    let mut p = project();
    p.game.variables.insert("ready".into(), Value::Bool(true));
    p.conversations[0].available = Condition::Variable {
        name: "ready".into(),
        op: Comparison::Eq,
        value: Value::Bool(true),
    };
    let mut s = Session::start(p, None).unwrap().0;
    run(&mut s, "talk keeper");
    let mut changed = s.state().clone();
    changed.variables.insert("ready".into(), Value::Bool(false));
    s.replace_state(changed.clone()).unwrap();
    assert_eq!(s.state(), &changed);
    assert!(s.conversation_view().is_none());
    assert!(s.state().narrative.active.is_some());
    assert_eq!(
        s.command("reply 1").unwrap().status,
        CommandStatus::Unmatched
    );
    assert!(s.state().narrative.active.is_none());
    assert_eq!(value(&s, "entries"), Value::Integer(1));
}

#[test]
fn history_is_marked_before_entry_and_once_reply_callbacks_can_observe_it() {
    let mut p = project();
    reply(&mut p, "accept").condition = Condition::True;
    reply(&mut p, "accept").destination = Some("greeting".into());
    reply(&mut p, "accept").effects.push(start_effect());
    node(&mut p, "greeting").effects.push(Effect::If {
        condition: Condition::ConversationReplyChosen {
            conversation: "conversation".into(),
            reply: "accept".into(),
        },
        then: vec![increment("tail")],
        otherwise: vec![],
    });
    let mut s = Session::start(p, None).unwrap().0;
    run(&mut s, "talk keeper");
    run(&mut s, "1");
    assert_eq!(
        offer(&s)
            .replies
            .iter()
            .map(|r| r.id.as_str())
            .collect::<Vec<_>>(),
        ["decline"]
    );
    assert_eq!(value(&s, "entries"), Value::Integer(2));
    assert_eq!(value(&s, "tail"), Value::Integer(1));
    let o = offer(&s);
    assert_eq!(
        s.select_reply(&o.offer_token, "accept").unwrap().status,
        CommandStatus::Unmatched
    );
    assert_eq!(value(&s, "starts"), Value::Integer(1));
}

#[test]
fn availability_changes_during_entry_keep_a_snapshot_that_resumes_without_replay() {
    let mut p = project();
    p.game.variables.insert("ready".into(), Value::Bool(true));
    p.conversations[0].available = Condition::Variable {
        name: "ready".into(),
        op: Comparison::Eq,
        value: Value::Bool(true),
    };
    node(&mut p, "greeting").effects.push(Effect::SetVariable {
        name: "ready".into(),
        value: Value::Bool(false),
    });
    action(
        &mut p,
        "ready",
        vec![Effect::SetVariable {
            name: "ready".into(),
            value: Value::Bool(true),
        }],
    );
    let mut s = Session::start(p, None).unwrap().0;
    run(&mut s, "talk keeper");
    assert!(s.conversation_view().is_none());
    assert_eq!(value(&s, "entries"), Value::Integer(1));
    run(&mut s, "use ready");
    run(&mut s, "talk keeper");
    assert_eq!(offer(&s).node, "greeting");
    assert_eq!(value(&s, "entries"), Value::Integer(1));
}

#[test]
fn native_calls_into_and_out_of_entry_keep_their_own_lexical_inputs_and_stop_scope() {
    let mut p = project();
    let input = |id: &str| ProcedureInput {
        id: id.into(),
        name: id.into(),
        kind: InputKind::Integer,
        required_properties: Default::default(),
    };
    let assign = |name: &str, id: &str| Effect::Assign {
        target: ScopedValueTarget::Variable { name: name.into() },
        value: Argument::Input { input: id.into() },
    };
    p.procedures.push(Procedure {
        id: "caller".into(),
        name: "Caller".into(),
        description: String::new(),
        inputs: vec![input("caller-amount")],
        effects: vec![
            start_effect(),
            assign("coins", "caller-amount"),
            Effect::Stop,
            increment("tail"),
        ],
    });
    p.procedures.push(Procedure {
        id: "entry-work".into(),
        name: "Entry work".into(),
        description: String::new(),
        inputs: vec![input("entry-amount")],
        effects: vec![
            assign("found", "entry-amount"),
            Effect::Stop,
            increment("tail"),
        ],
    });
    node(&mut p, "greeting").effects.push(Effect::Call {
        id: "entry-call".into(),
        procedure: "entry-work".into(),
        arguments: [(
            "entry-amount".into(),
            Argument::Literal {
                value: Value::Integer(3),
            },
        )]
        .into(),
    });
    action(
        &mut p,
        "scope",
        vec![
            Effect::Call {
                id: "caller-call".into(),
                procedure: "caller".into(),
                arguments: [(
                    "caller-amount".into(),
                    Argument::Literal {
                        value: Value::Integer(7),
                    },
                )]
                .into(),
            },
            increment("returns"),
        ],
    );
    let mut s = Session::start(p, None).unwrap().0;
    run(&mut s, "use scope");
    assert_eq!(value(&s, "coins"), Value::Integer(7));
    assert_eq!(value(&s, "found"), Value::Integer(3));
    assert_eq!(value(&s, "tail"), Value::Integer(0));
    assert_eq!(value(&s, "returns"), Value::Integer(1));
    assert!(text::plain(&offer(&s).prompt).contains("0 coins"));
}

#[test]
fn watch_entry_callbacks_retain_active_procedure_recursion_guards_and_rollback() {
    let mut p = project();
    p.procedures.push(Procedure {
        id: "callback".into(),
        name: "Callback".into(),
        description: String::new(),
        inputs: vec![],
        effects: vec![increment("coins")],
    });
    action(
        &mut p,
        "callback",
        vec![Effect::Call {
            id: "callback-call".into(),
            procedure: "callback".into(),
            arguments: Default::default(),
        }],
    );
    p.game.triggers.push(Trigger {
        id: "entry-watch".into(),
        name: "Entry watch".into(),
        watch: Some(TriggerWatch {
            target: ValueTarget::Variable {
                name: "coins".into(),
            },
            mode: WatchMode::EachChange,
        }),
        effects: vec![start_effect()],
        ..Default::default()
    });
    node(&mut p, "greeting").effects.push(Effect::Call {
        id: "reentry-call".into(),
        procedure: "callback".into(),
        arguments: Default::default(),
    });
    let mut s = Session::start(p, None).unwrap().0;
    let before = s.state().clone();
    assert!(
        s.command("use callback")
            .unwrap_err()
            .to_string()
            .contains("Recursive procedure re-entry")
    );
    assert_eq!(s.state(), &before);
    assert!(s.conversation_view().is_none());
}

#[test]
fn ending_from_entry_or_ordinary_world_action_clears_paused_as_well_as_active_checkpoints() {
    for entry in [true, false] {
        let mut p = project();
        p.game.endings.push(Ending {
            id: "done".into(),
            name: "Done".into(),
            text: "Finished".into(),
            ..Default::default()
        });
        if entry {
            node(&mut p, "greeting").effects.push(Effect::End {
                ending: "done".into(),
            });
        } else {
            action(
                &mut p,
                "finish",
                vec![Effect::End {
                    ending: "done".into(),
                }],
            );
        }
        let mut s = Session::start(p.clone(), None).unwrap().0;
        let result = run(&mut s, "talk keeper");
        if entry {
            assert!(!plain(&result).contains("Will you find"));
        } else {
            run(&mut s, "bye");
            run(&mut s, "use finish");
        }
        assert!(s.conversation_view().is_none());
        assert!(
            s.state()
                .narrative
                .conversations
                .values()
                .all(|h| h.checkpoint.is_none())
        );
        Session::restore(p, s.into_state()).unwrap();
    }
}

#[test]
fn prompt_byte_budget_applies_before_commit_and_replacement_releases_the_previous_prompt() {
    for exceeds in [false, true] {
        let mut p = project();
        let len = NARRATIVE_TEXT_LIMIT - "Keeper says: ".len() + usize::from(exceeds);
        p.game
            .variables
            .insert("large".into(), Value::Text("x".repeat(len)));
        node(&mut p, "greeting").text = "%large%".into();
        node(&mut p, "greeting").replies.push(ConversationReply {
            id: "again".into(),
            text: "Again".into(),
            destination: Some("greeting".into()),
            ..Default::default()
        });
        let mut s = Session::start(p, None).unwrap().0;
        if exceeds {
            let before = s.state().clone();
            assert!(
                s.command("talk keeper")
                    .unwrap_err()
                    .to_string()
                    .contains("resource bounds")
            );
            assert_eq!(s.state(), &before);
        } else {
            run(&mut s, "talk keeper");
            assert_eq!(s.state().narrative.text_bytes(), NARRATIVE_TEXT_LIMIT);
            run(&mut s, "3");
            assert_eq!(s.state().narrative.text_bytes(), NARRATIVE_TEXT_LIMIT);
            run(&mut s, "2");
            assert_eq!(s.state().narrative.text_bytes(), 0);
        }
    }
}

#[test]
fn legacy_reply_and_bye_vocabulary_stays_usable_and_new_formats_keep_unreserved_verbs() {
    for format in 1..=5 {
        let mut p = Project::blank("Command controls");
        p.game.format_version = format;
        if format < 3 {
            p.game.command_assistance = None;
        }
        let words = if format < 5 {
            vec!["reply", "bye", "1", "yes", "no", "ask"]
        } else {
            vec!["1", "yes", "no", "ask"]
        };
        for word in &words {
            p.vocabulary.push(Verb {
                id: format!("verb-{word}"),
                canonical: (*word).into(),
                ..Default::default()
            });
            p.game.actions.push(Action {
                id: format!("command-{word}"),
                verb: format!("verb-{word}"),
                effects: vec![Effect::Say {
                    text: "Authored".into(),
                }],
                ..Default::default()
            });
        }
        let mut s = Session::start(p, None).unwrap().0;
        for word in words {
            assert!(plain(&run(&mut s, word)).contains("Authored"));
        }
    }
}
