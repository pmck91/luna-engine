use super::*;
use luna_model::*;

#[path = "../../../../tests/support/routines.rs"]
mod routines;
#[path = "../../../../tests/support/turns.rs"]
mod timers;

// Keep one shared fixture module: the routine specimen already contains the
// conversation/quest specimen. Remove only its extra routine/clock controls.
fn conversation_project() -> Project {
    let mut p = routines::project();
    p.game.turns = None;
    p.routines.clear();
    p.timers.clear();
    p.game.actions.retain(|a| {
        !matches!(
            a.id.as_str(),
            "action-pausepatrol" | "action-resumepatrol" | "action-stoppatrol"
        )
    });
    p
}

fn simple() -> Project {
    let mut p = Project::blank("Undo proof");
    p.game.id = "undo-proof".into();
    p.game.variables = [
        ("count".into(), Value::Integer(0)),
        ("divisor".into(), Value::Integer(0)),
    ]
    .into();
    for (word, effects) in [
        ("change", vec![routines::increment("count")]),
        ("nothing", vec![]),
        (
            "text",
            vec![Effect::Say {
                text: "Only text.".into(),
            }],
        ),
        (
            "fail",
            vec![
                routines::increment("count"),
                Effect::UpdateVariable {
                    name: "count".into(),
                    op: ArithmeticOperation::Divide,
                    operand: NumericOperand::Variable {
                        name: "divisor".into(),
                    },
                },
            ],
        ),
    ] {
        routines::action(&mut p, word, effects);
    }
    p
}
fn start(p: Project) -> Session {
    let findings = validate(&p);
    assert!(!has_errors(&findings), "{findings:?}");
    let mut s = Session::start(p, None).unwrap().0;
    s.proof_enable_undo(HintPolicy::KeepKnown).unwrap();
    s
}
fn run(s: &mut Session, command: &str, explained: bool) -> CommandResult {
    if explained {
        s.command_explained(command)
    } else {
        s.command(command).unwrap()
    }
}
fn view(s: &Session) -> View {
    s.proof_undo_view().unwrap()
}

#[test]
fn free_changes_are_whole_points_and_noops_and_views_preserve_them() {
    for explained in [false, true] {
        let mut s = start(simple());
        let before = s.state().clone();
        run(&mut s, "use change", explained);
        assert_eq!(view(&s).available, 1);
        let history = view(&s);
        for input in [
            "look",
            "help",
            "inventory",
            "quests",
            "use nothing",
            "use text",
            "nonsense",
            "save checkpoint",
            "saves",
            "load checkpoint",
        ] {
            let state = s.state().clone();
            run(&mut s, input, explained);
            assert_eq!(s.state(), &state, "{input}");
            assert_eq!(view(&s), history, "{input}");
        }
        let result = run(&mut s, " UNDO! ", explained);
        assert!(result.state_changed);
        assert_eq!(s.state(), &before);
        assert_eq!(view(&s).available, 0);
        assert!(text::plain(&result.messages[0]).contains("use change"));
    }
}

#[test]
fn count_eviction_is_oldest_first_and_payload_accounting_is_exact() {
    let mut s = start(simple());
    for i in 0..25 {
        s.command("use change").unwrap();
        assert_eq!(view(&s).available, (i + 1).min(POINT_LIMIT));
        let h = s.undo_proof.as_ref().unwrap();
        assert_eq!(
            h.payload_bytes,
            h.points.iter().map(|p| p.bytes.len()).sum::<usize>()
        );
        assert!(h.payload_bytes <= BYTE_LIMIT);
    }
    for i in (5..25).rev() {
        assert!(s.proof_undo().unwrap().is_some());
        assert_eq!(s.state().variables["count"], Value::Integer(i));
    }
    assert_eq!(view(&s).payload_bytes, 0);
    assert_eq!(s.proof_undo().unwrap(), None);
}

#[test]
fn byte_limit_evicts_complete_points_and_allows_an_exact_fit() {
    let mut s = start(simple());
    let size = serde_json::to_vec(s.state()).unwrap().len();
    s.undo_proof.as_mut().unwrap().byte_limit = size * 2;
    for _ in 0..3 {
        s.command("use change").unwrap();
    }
    assert_eq!(view(&s).available, 2);
    assert_eq!(view(&s).payload_bytes, size * 2);
    let mut s = start(simple());
    s.undo_proof.as_mut().unwrap().byte_limit = size;
    s.command("use change").unwrap();
    assert_eq!(view(&s).available, 1);
    assert_eq!(view(&s).payload_bytes, size);
}

#[test]
fn oversized_and_capture_failure_barriers_keep_gameplay_and_clear_older_points() {
    for fault in [false, true] {
        let mut s = start(simple());
        s.command("use change").unwrap();
        let h = s.undo_proof.as_mut().unwrap();
        if fault {
            h.capture_failure = true;
        } else {
            h.byte_limit = 1;
        }
        let result = s.command("use change").unwrap();
        assert!(result.state_changed);
        assert_eq!(s.state().variables["count"], Value::Integer(2));
        assert_eq!(view(&s).available, 0);
        assert_eq!(
            view(&s).reason,
            if fault {
                Reason::CaptureFailed
            } else {
                Reason::Oversized
            }
        );
        assert_eq!(s.proof_undo().unwrap(), None);
    }
}

#[test]
fn failed_gameplay_never_attempts_capture_or_evicts_existing_points() {
    for explained in [false, true] {
        let mut s = start(simple());
        s.command("use change").unwrap();
        let before = s.state().clone();
        let history = view(&s);
        let captures = s.undo_proof.as_ref().unwrap().captures;
        s.undo_proof.as_mut().unwrap().capture_failure = true;
        if explained {
            let result = s.command_explained("use fail");
            assert_eq!(result.status, CommandStatus::Error);
            assert!(result.messages.is_empty());
        } else {
            assert!(s.command("use fail").is_err());
        }
        assert_eq!(s.state(), &before);
        assert_eq!(view(&s), history);
        assert_eq!(s.undo_proof.as_ref().unwrap().captures, captures);
    }
}

#[test]
fn charged_look_wait_and_failed_requirements_are_points_but_free_failure_is_not() {
    for paid in [false, true] {
        let mut p = simple();
        p.game.turns = Some(TurnPolicy {
            look: paid,
            failed_requirements: paid,
            ..Default::default()
        });
        routines::action(&mut p, "blocked", vec![]);
        p.game.actions.last_mut().unwrap().requirements = Condition::False;
        let mut s = start(p);
        for input in ["look", "use blocked", "wait"] {
            let before = s.state().clone();
            s.command(input).unwrap();
            let expected = usize::from(paid || input == "wait");
            assert_eq!(view(&s).available, expected, "{input}");
            if expected > 0 {
                s.proof_undo().unwrap();
            }
            assert_eq!(s.state(), &before);
        }
    }
}

#[test]
fn pending_questions_are_preserved_on_unavailable_undo_and_cleared_on_success() {
    let mut s = start(conversation_project());
    s.command("take key").unwrap();
    let context = s.context.clone();
    assert!(context.pending.is_some());
    s.command("undo").unwrap();
    assert_eq!(s.context, context);
    s.command("brass").unwrap();
    assert_eq!(view(&s).latest.as_deref(), Some("take brass key"));
    assert_eq!(s.context.recent.as_deref(), Some("key"));
    s.command("take key").unwrap();
    s.command("undo").unwrap();
    assert_eq!(s.context, InteractionContext::default());
    assert!(matches!(
        s.command("examine it").unwrap().input_resolution,
        Some(crate::InputResolution::Unresolved {
            reason: crate::UnresolvedInputReason::MissingReference,
            ..
        })
    ));
}

#[test]
fn replies_restore_native_checkpoints_without_entry_hooks_and_refresh_offer_authority() {
    for explained in [false, true] {
        let mut s = start(conversation_project());
        s.command("talk keeper").unwrap();
        let before = s.state().clone();
        let old = s.conversation_view().unwrap().clone();
        let reply = if explained {
            s.select_reply_explained(&old.offer_token, "accept")
        } else {
            s.select_reply(&old.offer_token, "accept").unwrap()
        };
        assert!(reply.state_changed);
        assert_eq!(view(&s).latest.as_deref(), Some("Yes, I'll find it."));
        run(&mut s, "undo", explained);
        assert_eq!(s.state(), &before);
        let fresh = s.conversation_view().unwrap().clone();
        assert_ne!(fresh.offer_token, old.offer_token);
        assert_eq!(fresh.replies, old.replies);
        assert_eq!(fresh.prompt, old.prompt);
        let history = view(&s);
        let result = s.select_reply(&old.offer_token, "accept").unwrap();
        assert_eq!(result.status, CommandStatus::Unmatched);
        assert_eq!(s.state(), &before);
        assert_eq!(view(&s), history);
        assert_eq!(
            s.conversation_view().unwrap().offer_token,
            fresh.offer_token
        );
    }
}

#[test]
fn numeric_replies_and_bye_share_the_native_boundary_even_without_a_clock() {
    for input in ["1", "reply 1", "bye"] {
        let mut s = start(conversation_project());
        s.command("talk keeper").unwrap();
        let before = s.state().clone();
        s.command(input).unwrap();
        assert_eq!(view(&s).available, 2);
        s.command("undo").unwrap();
        assert_eq!(s.state(), &before);
    }
}

#[test]
fn decode_validation_and_presentation_failures_preserve_everything() {
    for fault in 0..3 {
        let mut s = start(conversation_project());
        s.command("talk keeper").unwrap();
        s.command("1").unwrap();
        s.command("take key").unwrap();
        let h = s.undo_proof.as_mut().unwrap();
        if fault == 0 {
            h.points.back_mut().unwrap().bytes = b"invalid".to_vec().into_boxed_slice();
        }
        if fault == 1 {
            let point = h.points.back_mut().unwrap();
            let mut state: GameState = serde_json::from_slice(&point.bytes).unwrap();
            state.game_id = "foreign".into();
            point.bytes = serde_json::to_vec(&state).unwrap().into_boxed_slice();
        }
        if fault == 2 {
            h.prepare_failure = true;
        }
        let before = s.state().clone();
        let context = s.context.clone();
        let offer = s.offer.clone();
        let history = view(&s);
        assert!(s.command("undo").is_err());
        assert_eq!(s.state(), &before);
        assert_eq!(s.context, context);
        assert_eq!(s.offer, offer);
        assert_eq!(view(&s), history);
    }
}

#[test]
fn valid_replacement_clears_history_and_invalid_replacement_preserves_it() {
    let mut s = start(simple());
    s.command("use change").unwrap();
    let history = view(&s);
    let mut invalid = s.state().clone();
    invalid.variables.clear();
    assert!(s.replace_state(invalid).is_err());
    assert_eq!(view(&s), history);
    s.replace_state(s.state().clone()).unwrap();
    assert_eq!(view(&s).available, 0);
    assert_eq!(view(&s).reason, Reason::StateReplaced);
    let mut restored = Session::restore(s.project().clone(), s.state().clone()).unwrap();
    restored.proof_enable_undo(HintPolicy::KeepKnown).unwrap();
    assert_eq!(view(&restored).available, 0);
}

#[test]
fn ending_recovery_restores_pending_sources_and_does_not_replay_hooks() {
    let mut s = start(timers::project());
    s.command("open stone door").unwrap();
    let before = s.state().clone();
    s.command("use finish").unwrap();
    assert!(s.state().ending.is_some());
    s.command("undo").unwrap();
    assert_eq!(s.state(), &before);
    assert!(s.state().ending.is_none());
    assert_eq!(view(&s).available, 1);
}

#[test]
fn timer_and_routine_failures_after_an_action_do_not_leak_history() {
    for routine_failure in [false, true] {
        let mut p = routines::project();
        p.routines[0].steps[0].wait = None;
        if routine_failure {
            p.routines[0].steps[0].effects.push(Effect::UpdateVariable {
                name: "coins".into(),
                op: ArithmeticOperation::Divide,
                operand: NumericOperand::Variable {
                    name: "divisor".into(),
                },
            });
        } else {
            for routine in &mut p.routines {
                routine.start = RoutineStart::Blocks;
            }
            p.timers[0].effects.push(Effect::UpdateVariable {
                name: "coins".into(),
                op: ArithmeticOperation::Divide,
                operand: NumericOperand::Variable {
                    name: "divisor".into(),
                },
            });
            routines::action(
                &mut p,
                "arm",
                vec![Effect::ScheduleTimer {
                    timer: "routine-bell".into(),
                    after: NumericOperand::Literal { value: 1 },
                    pending: TimerPendingPolicy::Restart,
                }],
            );
        }
        let mut s = start(p);
        // A free durable change leaves an older point while routines/timers wait.
        s.command("use pausepatrol").unwrap();
        if routine_failure {
            s.command("use resumepatrol").unwrap();
        } else {
            s.command("use arm").unwrap();
        }
        let before = s.state().clone();
        let history = view(&s);
        assert!(s.command("take brass key").is_err());
        assert_eq!(s.state(), &before);
        assert_eq!(view(&s), history);
    }
}

#[test]
fn hint_policies_and_repeated_paid_hints_are_explicit() {
    for policy in [HintPolicy::KeepKnown, HintPolicy::Restore] {
        let mut p = simple();
        p.game.turns = Some(TurnPolicy {
            hints: true,
            ..Default::default()
        });
        p.locations[0].name = "Study".into();
        p.locations[0].hints.push(HintSet {
            id: "hints".into(),
            name: "Puzzle".into(),
            stages: vec![HintStage {
                id: "clue".into(),
                clues: vec!["A clue.".into()],
                solution: Some("The answer.".into()),
                ..Default::default()
            }],
            ..Default::default()
        });
        let mut s = start(p);
        s.undo_proof.as_mut().unwrap().policy = policy;
        s.command("use change").unwrap();
        let before = s.state().clone();
        s.command("hint study").unwrap();
        assert_eq!(
            view(&s).available,
            if policy == HintPolicy::KeepKnown {
                0
            } else {
                2
            }
        );
        if policy == HintPolicy::Restore {
            s.command("undo").unwrap();
            assert_eq!(s.state(), &before);
            s.command("hint study").unwrap();
        }
        let known = s.state().clone();
        s.command("hint study").unwrap();
        assert_eq!(s.state().hints, known.hints);
        s.command("undo").unwrap();
        assert_eq!(s.state(), &known);
        s.command("hint study solution").unwrap();
        assert!(s.state().hints["clue"].solution_seen);
        if policy == HintPolicy::KeepKnown {
            assert_eq!(view(&s).available, 0);
        }
    }
}

#[test]
fn labels_are_literal_player_commands_bounded_on_utf8_and_exclude_private_flow_names() {
    let mut p = simple();
    p.game.actions[0].name = "SECRET reward solution".into();
    let mut s = start(p);
    s.command("use change").unwrap();
    assert_eq!(view(&s).latest.as_deref(), Some("use change"));
    let label = bounded_label(&format!("{}\n\tsecret", "é".repeat(200)));
    assert_eq!(label.len(), LABEL_LIMIT);
    assert!(!label.contains('\n'));
}

#[test]
fn disabled_legacy_undo_and_longer_authored_commands_keep_their_meaning() {
    let mut p = simple();
    p.vocabulary.push(Verb {
        id: "rewind".into(),
        canonical: "rewind".into(),
        synonyms: vec!["undo".into()],
        ..Default::default()
    });
    p.game.actions.push(Action {
        id: "legacy-undo".into(),
        verb: "rewind".into(),
        effects: vec![routines::increment("count")],
        ..Default::default()
    });
    let mut legacy = Session::start(p.clone(), None).unwrap().0;
    legacy.command("undo").unwrap();
    assert_eq!(legacy.state().variables["count"], Value::Integer(1));
    assert!(legacy.proof_enable_undo(HintPolicy::KeepKnown).is_err());
    p.game.actions.last_mut().unwrap().pattern = vec![PatternPart::Literal {
        text: "lever".into(),
    }];
    let mut s = start(p);
    s.command("undo lever").unwrap();
    assert_eq!(s.state().variables["count"], Value::Integer(1));
    s.command("undo").unwrap();
    assert_eq!(s.state().variables["count"], Value::Integer(0));
}

#[test]
fn unexpected_committed_mutations_form_a_barrier_instead_of_skipping_a_change() {
    let mut s = start(simple());
    s.command("use change").unwrap();
    let (_, error) = s.execute_with("unclassified test initiator", false, |run| {
        run.state
            .to_mut()
            .variables
            .insert("count".into(), Value::Integer(99));
        Ok(())
    });
    assert!(error.is_none());
    assert_eq!(s.state().variables["count"], Value::Integer(99));
    assert_eq!(view(&s).reason, Reason::Unclassified);
    assert_eq!(view(&s).available, 0);
}

#[test]
fn nested_rewards_watches_timers_routines_and_activation_latches_restore_together() {
    let mut p = routines::project();
    p.game.variables.insert("watches".into(), Value::Integer(0));
    p.characters[0]
        .state
        .insert("health".into(), Value::Integer(10));
    let rewarded = Condition::Variable {
        name: "coins".into(),
        op: Comparison::Ge,
        value: Value::Integer(10),
    };
    p.routines[0].steps[0].condition = rewarded.clone();
    p.routines[0].steps[0].wait = None;
    p.routines[1].start = RoutineStart::When {
        condition: rewarded.clone(),
    };
    p.characters.push(Character {
        id: "other".into(),
        name: "Other".into(),
        location: "study".into(),
        ..Default::default()
    });
    p.routines[1].character = "other".into();
    p.game.triggers.push(Trigger {
        id: "reward-watch".into(),
        watch: Some(TriggerWatch {
            target: ValueTarget::Variable {
                name: "coins".into(),
            },
            mode: WatchMode::BecomesTrue,
        }),
        condition: rewarded,
        effects: vec![
            routines::increment("watches"),
            Effect::SetProperty {
                entity: "keeper".into(),
                name: "health".into(),
                value: Value::Integer(9),
            },
        ],
        ..Default::default()
    });
    routines::action(
        &mut p,
        "arm",
        vec![Effect::ScheduleTimer {
            timer: "routine-bell".into(),
            after: NumericOperand::Literal { value: 1 },
            pending: TimerPendingPolicy::Restart,
        }],
    );
    routines::action(
        &mut p,
        "compound",
        vec![
            Effect::StartQuest {
                quest: "missing".into(),
            },
            Effect::Give {
                object: "key".into(),
            },
            Effect::CompleteQuestStage {
                quest: "missing".into(),
                stage: "found-stage".into(),
            },
            Effect::CompleteQuestStage {
                quest: "missing".into(),
                stage: "returned".into(),
            },
            Effect::CompleteQuest {
                quest: "missing".into(),
            },
            Effect::Move {
                location: "garden".into(),
            },
        ],
    );
    let mut normal = start(p.clone());
    let mut explained = start(p);
    for s in [&mut normal, &mut explained] {
        s.command("use arm").unwrap();
    }
    let before = normal.state().clone();
    assert_eq!(before, *explained.state());
    normal.command("use compound").unwrap();
    let result = explained.command_explained("use compound");
    assert_eq!(result.status, CommandStatus::Ok);
    assert_eq!(normal.state(), explained.state());
    assert_eq!(normal.state().variables["coins"], Value::Integer(10));
    assert_eq!(normal.state().variables["watches"], Value::Integer(1));
    assert_eq!(normal.state().variables["bells"], Value::Integer(1));
    assert_eq!(normal.state().variables["patrol_count"], Value::Integer(1));
    assert_eq!(
        normal.state().properties["keeper"]["health"],
        Value::Integer(9)
    );
    assert!(matches!(
        normal.state().objects["key"].placement,
        Placement::Character { .. }
    ));
    assert_eq!(normal.state().location, "garden");
    assert!(
        normal
            .state()
            .routines
            .as_ref()
            .unwrap()
            .runs
            .contains_key("unused")
    );
    assert_eq!(view(&normal), view(&explained));
    assert_eq!(view(&normal).available, 2);
    normal.command("undo").unwrap();
    explained.command_explained("undo");
    assert_eq!(normal.state(), &before);
    assert_eq!(explained.state(), &before);
    assert_eq!(view(&normal), view(&explained));
    normal.command("use compound").unwrap();
    assert_eq!(normal.state().variables["rewards"], Value::Integer(1));
}

#[test]
fn undoing_a_quest_reply_restores_inventory_reward_cursors_and_hook_flags() {
    let mut s = start(conversation_project());
    for input in ["talk keeper", "1", "take brass key", "talk keeper"] {
        s.command(input).unwrap();
    }
    let before = s.state().clone();
    let offer = s.offer.clone().unwrap();
    s.select_reply(&offer.offer_token, "handover").unwrap();
    let rewarded = s.state().clone();
    assert_eq!(rewarded.variables["coins"], Value::Integer(10));
    s.command("undo").unwrap();
    assert_eq!(s.state(), &before);
    let offer = s.offer.clone().unwrap();
    s.select_reply(&offer.offer_token, "handover").unwrap();
    assert_eq!(s.state(), &rewarded);
}

#[test]
fn unavailable_undo_keeps_conversation_authority_and_invalid_selection_keeps_history() {
    let mut s = start(conversation_project());
    s.command("talk keeper").unwrap();
    let state = s.state().clone();
    s.proof_enable_undo(HintPolicy::KeepKnown).unwrap();
    let offer = s.offer.clone().unwrap();
    s.command("undo").unwrap();
    assert_eq!(s.offer.as_ref(), Some(&offer));
    assert_eq!(s.state(), &state);
    s.select_reply(&offer.offer_token, "accept").unwrap();
    let history = view(&s);
    let state = s.state().clone();
    s.select_reply(&offer.offer_token, "missing").unwrap();
    assert_eq!(view(&s), history);
    assert_eq!(s.state(), &state);
}

#[test]
fn free_action_with_an_active_clock_is_a_point_without_spending_a_turn() {
    let mut p = simple();
    p.game.turns = Some(TurnPolicy::default());
    p.game.actions[0].turn_cost = Some(ActionTurnCost {
        success: TurnCost::Free,
        ..Default::default()
    });
    let mut s = start(p);
    s.command("use change").unwrap();
    assert_eq!(s.state().turns.as_ref().unwrap().turn, 0);
    assert_eq!(view(&s).available, 1);
    s.command("undo").unwrap();
    assert_eq!(s.state().variables["count"], Value::Integer(0));
}

#[test]
fn hint_listing_keeps_existing_free_or_paid_pacing_without_becoming_a_new_hint_barrier() {
    for paid in [false, true] {
        let mut p = simple();
        p.game.turns = Some(TurnPolicy {
            hints: paid,
            ..Default::default()
        });
        let mut s = start(p);
        s.command("use change").unwrap();
        let before = s.state().clone();
        s.command("hint").unwrap();
        assert_eq!(view(&s).available, if paid { 2 } else { 1 });
        assert_ne!(view(&s).reason, Reason::NewHint);
        if paid {
            s.command("undo").unwrap();
        }
        assert_eq!(s.state(), &before);
    }
}

#[test]
fn a_late_timer_failure_rolls_back_new_hint_progress_and_preserves_history() {
    let mut p = timers::project();
    p.game.turns.as_mut().unwrap().hints = true;
    p.objects[0].hints.push(HintSet {
        id: "door-hints".into(),
        name: "Door puzzle".into(),
        stages: vec![HintStage {
            id: "door-clue".into(),
            clues: vec!["A clue.".into()],
            ..Default::default()
        }],
        ..Default::default()
    });
    p.timers[0].effects.push(Effect::UpdateVariable {
        name: "firings".into(),
        op: ArithmeticOperation::Divide,
        operand: NumericOperand::Variable {
            name: "divisor".into(),
        },
    });
    let mut s = start(p);
    for input in ["open stone door", "wait", "wait"] {
        s.command(input).unwrap();
    }
    let before = s.state().clone();
    let history = view(&s);
    assert!(s.command("hint stone door").is_err());
    assert_eq!(s.state(), &before);
    assert_eq!(view(&s), history);
}

#[test]
fn shared_watch_depth_budget_rejection_retains_the_last_valid_point() {
    let mut p = simple();
    p.game.triggers.push(Trigger {
        id: "recursive".into(),
        watch: Some(TriggerWatch {
            target: ValueTarget::Variable {
                name: "count".into(),
            },
            mode: WatchMode::EachChange,
        }),
        condition: Condition::Variable {
            name: "count".into(),
            op: Comparison::Gt,
            value: Value::Integer(1),
        },
        effects: vec![routines::increment("count")],
        ..Default::default()
    });
    let mut s = start(p);
    s.command("use change").unwrap();
    let before = s.state().clone();
    let history = view(&s);
    assert!(
        s.command("use change")
            .unwrap_err()
            .to_string()
            .contains("nested events")
    );
    assert_eq!(s.state(), &before);
    assert_eq!(view(&s), history);
}

#[test]
fn collision_scan_includes_hidden_scopes_synonyms_empty_literals_and_exits() {
    let mut p = simple();
    p.vocabulary.push(Verb {
        id: "rewind".into(),
        canonical: "rewind".into(),
        synonyms: vec!["UNDO!".into()],
        ..Default::default()
    });
    let action = Action {
        id: "local".into(),
        verb: "rewind".into(),
        pattern: vec![PatternPart::Literal { text: "".into() }],
        ..Default::default()
    };
    p.objects.push(Object {
        id: "hidden".into(),
        name: "Hidden".into(),
        hidden: true,
        actions: vec![action],
        ..Default::default()
    });
    p.locations.push(Location {
        id: "offstage".into(),
        name: "Offstage".into(),
        exits: vec![Exit {
            id: "route".into(),
            name: "Route".into(),
            verb: "rewind".into(),
            destination: p.game.starting_location.clone(),
            pattern: vec![PatternPart::Literal { text: "".into() }],
            visible: Condition::False,
            ..Default::default()
        }],
        ..Default::default()
    });
    assert_eq!(collisions(&p), ["local", "route"]);
    // Empty literal sockets are reviewable drafts, rejected by today's schema.
    // A validated hidden action with an actually empty pattern still conflicts.
    p.locations[1].exits.clear();
    p.objects[0].actions[0].pattern.clear();
    let mut s = Session::start(p, None).unwrap().0;
    assert!(s.proof_enable_undo(HintPolicy::KeepKnown).is_err());
    assert!(s.proof_undo_view().is_none());
}

#[test]
fn an_entity_named_undo_remains_selectable_by_a_number() {
    let mut p = conversation_project();
    p.objects.iter_mut().find(|o| o.id == "key").unwrap().name = "undo".into();
    let mut s = start(p);
    s.command("take key").unwrap();
    let question = s.pending_clarification().unwrap();
    let index = question
        .choices
        .iter()
        .position(|c| c.entity == "key")
        .unwrap()
        + 1;
    s.command("undo").unwrap();
    assert_eq!(s.pending_clarification().unwrap(), question);
    s.command(&index.to_string()).unwrap();
    assert_eq!(s.state().objects["key"].placement, Placement::Inventory);
    assert_eq!(view(&s).latest.as_deref(), Some("take undo"));
}

#[test]
fn oversized_control_input_does_not_bypass_limits_or_destroy_a_pending_question() {
    let mut s = start(conversation_project());
    s.command("talk keeper").unwrap();
    s.command("take key").unwrap();
    let state = s.state().clone();
    let context = s.context.clone();
    let offer = s.offer.clone();
    let history = view(&s);
    assert!(s.command(&format!("undo{}", "!".repeat(4096))).is_err());
    assert_eq!(s.state(), &state);
    assert_eq!(s.context, context);
    assert_eq!(s.offer, offer);
    assert_eq!(view(&s), history);
}

#[test]
fn encoded_payload_bound_counts_json_escaping_and_utf8_bytes_exactly() {
    let mut s = start(simple());
    let mut state = s.state().clone();
    state
        .variables
        .insert("escaped".into(), Value::Text("é\n\\".repeat(100)));
    let exact = serde_json::to_vec(&state).unwrap();
    assert_eq!(&*capture(&state, exact.len()).unwrap(), &exact);
    assert_eq!(
        capture(&state, exact.len() - 1).unwrap_err(),
        Reason::Oversized
    );
    s.command("help").unwrap();
    assert_eq!(s.undo_proof.as_ref().unwrap().captures, 0);
}

#[test]
fn captured_routine_waits_restore_without_recapturing_duration() {
    let mut p = routines::project();
    routines::action(
        &mut p,
        "delay",
        vec![Effect::SetVariable {
            name: "delay".into(),
            value: Value::Integer(99),
        }],
    );
    p.game.actions.last_mut().unwrap().turn_cost = Some(ActionTurnCost {
        success: TurnCost::Free,
        ..Default::default()
    });
    let mut s = start(p);
    s.command("wait").unwrap();
    let before = s.state().clone();
    let wait = s
        .routine_view()
        .into_iter()
        .find(|v| v.routine == "patrol")
        .unwrap()
        .wait
        .unwrap();
    assert_eq!(wait.captured, 3);
    s.command("use delay").unwrap();
    assert_eq!(s.state().variables["delay"], Value::Integer(99));
    assert_eq!(
        s.routine_view()
            .into_iter()
            .find(|v| v.routine == "patrol")
            .unwrap()
            .wait
            .unwrap(),
        wait
    );
    s.command("undo").unwrap();
    assert_eq!(s.state(), &before);
    s.command("wait").unwrap();
    let advanced = s.state().clone();
    s.command("undo").unwrap();
    assert_eq!(s.state(), &before);
    s.command("wait").unwrap();
    assert_eq!(s.state(), &advanced);
}

#[test]
fn routine_ending_undo_has_no_end_hook_replay_or_runtime_execution_trace() {
    let mut p = routines::project();
    routines::action(
        &mut p,
        "finish",
        vec![Effect::End {
            ending: "finish".into(),
        }],
    );
    p.game.triggers.push(Trigger {
        id: "end-hook".into(),
        event: Event::Ending,
        effects: vec![routines::increment("bells")],
        ..Default::default()
    });
    let mut s = start(p);
    s.command("wait").unwrap();
    let before = s.state().clone();
    s.command("use finish").unwrap();
    let ended = s.state().clone();
    assert_eq!(ended.variables["bells"], Value::Integer(1));
    let result = s.command_explained("undo");
    assert_eq!(s.state(), &before);
    assert!(result.explanation.unwrap().steps.is_empty());
    assert!(result.selected_flow.is_none());
    let mut loaded = Session::restore(s.project().clone(), ended.clone()).unwrap();
    loaded.proof_enable_undo(HintPolicy::KeepKnown).unwrap();
    loaded.command("undo").unwrap();
    assert_eq!(loaded.state(), &ended);
}

#[test]
fn nested_containment_and_open_flags_are_owned_by_the_same_point() {
    let mut p = simple();
    p.objects = vec![
        Object {
            id: "chest".into(),
            name: "Chest".into(),
            open: true,
            placement: Placement::Inventory,
            storage: Some(ObjectStorage {
                container: Some(ContainerOpening::Openable),
                surface: true,
            }),
            ..Default::default()
        },
        Object {
            id: "key".into(),
            name: "Key".into(),
            placement: Placement::Inside {
                object: "chest".into(),
            },
            ..Default::default()
        },
    ];
    routines::action(
        &mut p,
        "stash",
        vec![
            Effect::Give {
                object: "key".into(),
            },
            Effect::Close {
                object: "chest".into(),
            },
        ],
    );
    let mut s = start(p);
    let before = s.state().clone();
    s.command("use stash").unwrap();
    assert!(!s.state().objects["chest"].open);
    assert_eq!(s.state().objects["key"].placement, Placement::Inventory);
    s.command("undo").unwrap();
    assert_eq!(s.state(), &before);
}
