#[path = "../../../tests/support/quests.rs"]
mod fixture;
use fixture::{action, increment, project, stage};
use luna_core::{
    CommandResult, CommandStatus, NarrativeOperation, Session, TraceKind, TraceOutcome,
};
use luna_model::*;

fn plain(result: &CommandResult) -> String {
    result
        .messages
        .iter()
        .map(|s| text::plain(s))
        .collect::<Vec<_>>()
        .join("\n")
}
fn run(session: &mut Session, commands: &[&str]) {
    for command in commands {
        assert_eq!(
            session.command(command).unwrap().status,
            CommandStatus::Ok,
            "{command}"
        );
    }
}
fn check_state(session: &Session) {
    session
        .definition()
        .validate_state(session.state())
        .unwrap();
}
fn risk() -> Effect {
    Effect::UpdateVariable {
        name: "coins".into(),
        op: ArithmeticOperation::Divide,
        operand: NumericOperand::Variable {
            name: "divisor".into(),
        },
    }
}

#[test]
fn explicit_native_progress_and_early_discovery_keep_rewards_once_only() {
    assert_eq!(
        project(),
        serde_json::from_str::<Project>(include_str!(
            "../../../tests/fixtures/narrative/quests5.json"
        ))
        .unwrap()
    );
    for early in [false, true] {
        let (mut s, _) = Session::start(project(), None).unwrap();
        assert!(s.quest_log().is_empty());
        if early {
            run(&mut s, &["use find"]);
        }
        assert!(s.quest_log().is_empty());
        run(&mut s, &["use accept", "use accept"]);
        if !early {
            run(&mut s, &["use find"]);
        }
        run(&mut s, &["use return", "use return"]);
        assert_eq!(s.state().narrative.status("missing"), QuestStatus::Active);
        run(
            &mut s,
            &[
                "use complete",
                "use complete",
                "use fail",
                "use accept",
                "use return",
            ],
        );
        let progress = &s.state().narrative.quests["missing"];
        assert_eq!(progress.status, QuestStatus::Completed);
        assert_eq!(progress.journal.len(), 4);
        for counter in ["starts", "found", "returns", "rewards"] {
            assert_eq!(s.state().variables[counter], Value::Integer(1));
        }
        assert_eq!(s.state().variables["coins"], Value::Integer(10));
        assert_eq!(s.state().variables["failures"], Value::Integer(0));
        assert_eq!(
            s.state().objects["key"].placement,
            Placement::Character {
                character: "keeper".into()
            }
        );
        let path = ProcedurePath {
            root: "quest-complete".into(),
            calls: vec!["quest-reward-call".into()],
            sequence: "reward-response".into(),
        };
        assert_eq!(s.state().procedure_sequences[&path], 1);
        assert!(s.state().sequences.is_empty());
        check_state(&s);
        let bytes = serde_json::to_vec(s.state()).unwrap();
        let mut restored =
            Session::restore(project(), serde_json::from_slice(&bytes).unwrap()).unwrap();
        run(&mut restored, &["use accept", "use complete", "use fail"]);
        assert_eq!(restored.state(), s.state());
        assert_eq!(restored.quest_log(), s.quest_log());
    }
}

#[test]
fn inactive_prerequisites_and_false_stage_conditions_are_traceable_noops() {
    let mut p = project();
    action(&mut p, "found-stage", vec![stage("found-stage")]);
    let (mut s, _) = Session::start(p, None).unwrap();
    run(&mut s, &["use return", "use complete", "use fail"]);
    assert!(s.state().narrative.is_empty());
    run(&mut s, &["use accept"]);
    for command in ["use return", "use found-stage", "use complete"] {
        let before = s.state().clone();
        let result = s.command_explained(command);
        assert_eq!(s.state(), &before);
        assert!(!result.state_changed);
        assert!(
            result
                .trace
                .iter()
                .any(|t| t.contains("Quest stage") || t.contains("Required quest stages"))
        );
        let explanation = result.explanation.unwrap();
        assert!(
            explanation
                .steps
                .iter()
                .any(|step| matches!(step.kind, TraceKind::Narrative { applied: false, .. }))
        );
    }
    check_state(&s);
}

#[test]
fn parallel_required_and_optional_stages_complete_in_either_order() {
    for order in [["first", "second"], ["second", "first"]] {
        let mut p = project();
        p.quests[0].stages = ["first", "second", "optional"]
            .into_iter()
            .map(|id| QuestStage {
                id: id.into(),
                name: id.into(),
                text: id.into(),
                required: id != "optional",
                ..Default::default()
            })
            .collect();
        p.quests[0].on_start.effects.clear();
        p.game
            .actions
            .retain(|a| !matches!(a.id.as_str(), "action-find" | "action-return"));
        for id in ["first", "second", "optional"] {
            action(&mut p, id, vec![stage(id)]);
        }
        let (mut s, _) = Session::start(p, None).unwrap();
        run(
            &mut s,
            &["use accept", &format!("use {}", order[0]), "use complete"],
        );
        assert_eq!(s.state().narrative.status("missing"), QuestStatus::Active);
        run(&mut s, &[&format!("use {}", order[1])]);
        assert_eq!(s.state().narrative.status("missing"), QuestStatus::Active);
        run(&mut s, &["use complete", "use optional"]);
        assert_eq!(
            s.state().narrative.status("missing"),
            QuestStatus::Completed
        );
        assert!(
            !s.state().narrative.quests["missing"]
                .stages
                .contains("optional")
        );
        let history = &s.state().narrative.quests["missing"].journal;
        assert_eq!(
            history[1].kind,
            JournalKind::Stage {
                stage: order[0].into()
            }
        );
        check_state(&s);
    }
}

#[test]
fn failure_is_terminal_and_keeps_only_earned_history() {
    let (mut s, _) = Session::start(project(), None).unwrap();
    run(
        &mut s,
        &[
            "use accept",
            "use find",
            "use fail",
            "use fail",
            "use accept",
            "use return",
            "use complete",
        ],
    );
    assert_eq!(s.state().narrative.status("missing"), QuestStatus::Failed);
    assert_eq!(s.state().narrative.quests["missing"].journal.len(), 3);
    assert_eq!(s.state().variables["failures"], Value::Integer(1));
    assert_eq!(s.state().variables["rewards"], Value::Integer(0));
    assert!(!plain(&s.command("quests").unwrap()).contains("Returned"));
    check_state(&s);
}

#[test]
fn transitions_are_marked_before_reentrant_hooks_and_value_watch_callbacks() {
    let mut p = project();
    p.quests[0].on_start.effects.insert(
        0,
        Effect::StartQuest {
            quest: "missing".into(),
        },
    );
    p.quests[0].stages[0]
        .effects
        .insert(0, stage("found-stage"));
    p.quests[0].stages[1].effects.insert(0, stage("returned"));
    p.quests[0].on_complete.effects.push(Effect::CompleteQuest {
        quest: "missing".into(),
    });
    p.game.triggers.push(Trigger {
        id: "reward-watch".into(),
        name: "Reward watch".into(),
        watch: Some(TriggerWatch {
            target: ValueTarget::Variable {
                name: "coins".into(),
            },
            mode: WatchMode::EachChange,
        }),
        effects: vec![Effect::CompleteQuest {
            quest: "missing".into(),
        }],
        ..Default::default()
    });
    let (mut s, _) = Session::start(p, None).unwrap();
    run(
        &mut s,
        &["use accept", "use find", "use return", "use complete"],
    );
    assert_eq!(s.state().narrative.quests["missing"].journal.len(), 4);
    assert_eq!(s.state().variables["rewards"], Value::Integer(1));
    assert_eq!(s.state().variables["coins"], Value::Integer(10));
    check_state(&s);
}

#[test]
fn journal_snapshots_keep_literal_values_colours_and_pre_hook_values() {
    let mut p = project();
    p.game
        .variables
        .insert("label".into(), Value::Text("<red>%coins%</red>".into()));
    p.characters[0]
        .state
        .insert("health".into(), Value::Integer(9));
    p.quests[0].introduction = "<cyan>%label%</cyan> at %keeper.health%".into();
    p.quests[0].on_start.effects.push(Effect::SetVariable {
        name: "label".into(),
        value: Value::Text("changed".into()),
    });
    let (mut s, _) = Session::start(p, None).unwrap();
    run(
        &mut s,
        &["use accept", "use find", "use return", "use complete"],
    );
    let journal = &s.quest_log()[0].journal;
    assert_eq!(text::plain(&journal[0].text), "<red>%coins%</red> at 9");
    assert_eq!(journal[0].text[0].colour.as_deref(), Some("cyan"));
    assert_eq!(
        text::plain(&journal.last().unwrap().text),
        "Returned the key. Coins before reward: 0."
    );
    let before = s.state().clone();
    let viewed = plain(&s.command("quest key").unwrap());
    assert!(viewed.contains("<red>%coins%</red> at 9"));
    assert!(viewed.contains("before reward: 0"));
    assert_eq!(s.state(), &before);
    check_state(&s);
}

#[test]
fn late_hook_failure_rolls_back_quest_world_cursors_and_output() {
    let mut p = project();
    p.quests[0].on_complete.effects.push(risk());
    let (mut normal, _) = Session::start(p.clone(), None).unwrap();
    let (mut explained, _) = Session::start(p, None).unwrap();
    for s in [&mut normal, &mut explained] {
        run(s, &["use accept", "use find", "use return"]);
    }
    let before = normal.state().clone();
    assert!(normal.command("use complete").is_err());
    let result = explained.command_explained("use complete");
    assert_eq!(result.status, CommandStatus::Error);
    assert!(!result.state_changed);
    assert!(result.messages.is_empty());
    assert_eq!(normal.state(), &before);
    assert_eq!(explained.state(), &before);
    let trace = result.explanation.unwrap();
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
            operation: NarrativeOperation::CompleteQuest { .. },
            applied: true
        }
    ) && step.outcome == TraceOutcome::Failed));
    assert!(
        trace
            .changes
            .iter()
            .any(|change| change.path.first().is_some_and(|p| p == "narrative"))
    );
    assert!(trace.changes.iter().any(|change| {
        change
            .path
            .first()
            .is_some_and(|p| p == "procedure_sequences")
    }));
}

#[test]
fn startup_and_native_command_events_can_run_quest_hooks() {
    let mut p = project();
    p.game.triggers.push(Trigger {
        id: "start-story".into(),
        name: "Start story".into(),
        event: Event::Start,
        effects: vec![Effect::StartQuest {
            quest: "missing".into(),
        }],
        ..Default::default()
    });
    p.game.triggers.push(Trigger {
        id: "command-story".into(),
        name: "Find story".into(),
        event: Event::Command,
        condition: Condition::Carrying {
            object: "key".into(),
        },
        effects: vec![stage("found-stage")],
        ..Default::default()
    });
    let (mut s, _) = Session::start(p, None).unwrap();
    assert_eq!(s.state().narrative.status("missing"), QuestStatus::Active);
    run(&mut s, &["use find"]);
    assert_eq!(s.state().variables["found"], Value::Integer(1));
    check_state(&s);
}

#[test]
fn stop_in_hook_returns_to_caller_but_end_propagates_and_log_stays_readable() {
    for ending in [false, true] {
        let mut p = project();
        p.game.endings.push(Ending {
            id: "done".into(),
            name: "Done".into(),
            text: "Finished.".into(),
            ..Default::default()
        });
        p.quests[0].on_start.effects = vec![
            increment("starts"),
            if ending {
                Effect::End {
                    ending: "done".into(),
                }
            } else {
                Effect::Stop
            },
            increment("found"),
        ];
        p.game.actions[0].effects.push(increment("returns"));
        let (mut s, _) = Session::start(p, None).unwrap();
        run(&mut s, &["use accept"]);
        assert_eq!(s.state().variables["found"], Value::Integer(0));
        assert_eq!(
            s.state().variables["returns"],
            Value::Integer(if ending { 0 } else { 1 })
        );
        assert_eq!(s.state().ending.is_some(), ending);
        let before = s.state().clone();
        assert!(plain(&s.command("quest key").unwrap()).contains("Find the Keeper's key"));
        assert_eq!(s.state(), &before);
        check_state(&s);
    }
}

#[test]
fn normal_and_explained_paths_share_truthful_transition_sources_and_state() {
    let p = project();
    let (mut normal, _) = Session::start(p.clone(), None).unwrap();
    let (mut explained, _) = Session::start(p, None).unwrap();
    for command in [
        "quests",
        "use accept",
        "use return",
        "use find",
        "use return",
        "use complete",
        "use complete",
        "quest key",
    ] {
        let a = normal.command(command).unwrap();
        let b = explained.command_explained(command);
        assert_eq!(a.messages, b.messages);
        assert_eq!(a.status, b.status);
        assert_eq!(a.state_changed, b.state_changed);
        assert_eq!(normal.state(), explained.state());
        let trace = b.explanation.unwrap();
        if command == "use find" {
            assert!(trace.steps.iter().any(|step| {
                matches!(step.kind, TraceKind::Narrative { applied: true, .. })
                    && step
                        .source
                        .as_ref()
                        .is_some_and(|source| source.subject == "found-stage")
            }));
        }
    }
}

#[test]
fn log_controls_hide_future_content_order_statuses_and_never_fire_commands_or_hints() {
    let mut p = project();
    for (id, title) in [
        ("z-active", "Later quest"),
        ("a-secret", "Secret solution"),
        ("failed", "Failed quest"),
    ] {
        p.quests.push(Quest {
            id: id.into(),
            title: title.into(),
            aliases: vec!["key".into()],
            introduction: "Earned introduction".into(),
            completion: "Future reward".into(),
            failure: "Earned failure".into(),
            on_start: NarrativeHook {
                id: format!("{id}-start"),
                effects: vec![],
            },
            on_complete: NarrativeHook {
                id: format!("{id}-complete"),
                effects: vec![],
            },
            on_fail: NarrativeHook {
                id: format!("{id}-fail"),
                effects: vec![],
            },
            ..Default::default()
        });
    }
    action(
        &mut p,
        "others",
        vec![
            Effect::StartQuest {
                quest: "failed".into(),
            },
            Effect::FailQuest {
                quest: "failed".into(),
            },
            Effect::StartQuest {
                quest: "z-active".into(),
            },
        ],
    );
    p.game.triggers.push(Trigger {
        id: "count-commands".into(),
        name: "Count commands".into(),
        event: Event::Command,
        effects: vec![increment("commands")],
        ..Default::default()
    });
    let (mut s, _) = Session::start(p, None).unwrap();
    run(
        &mut s,
        &[
            "use accept",
            "use find",
            "use return",
            "use complete",
            "use others",
        ],
    );
    let before = s.state().clone();
    let views = s.quest_log();
    assert_eq!(
        views.iter().map(|q| q.quest.as_str()).collect::<Vec<_>>(),
        ["z-active", "missing", "failed"]
    );
    for query in [
        "quests",
        "quest",
        "QuEsT   THE missing KEY",
        "quest key",
        "quest secret solution",
        "quests key",
    ] {
        let result = s.command_explained(query);
        let output = plain(&result);
        assert!(!output.contains("Secret solution"));
        assert!(!output.contains("Future reward"));
        assert_eq!(s.state(), &before);
        assert!(result.selected_flow.is_none());
        assert!(!result.state_changed);
        assert!(
            result
                .explanation
                .unwrap()
                .steps
                .iter()
                .all(|step| !matches!(
                    step.kind,
                    TraceKind::Trigger { .. } | TraceKind::Effect { .. }
                ))
        );
        if query == "quest key" {
            assert_eq!(result.status, CommandStatus::Ambiguous);
            assert!(!output.contains("1."));
            assert!(s.pending_clarification().is_none());
        }
        if query == "quest secret solution" || query == "quests key" {
            assert_eq!(result.status, CommandStatus::Unmatched);
        }
    }
}

#[test]
fn quest_queries_preserve_pending_noun_questions_and_recent_objects() {
    let mut p = project();
    p.game.command_assistance = Some(CommandAssistance::new_game());
    p.objects[0].name = "brass key".into();
    p.objects[0].aliases = vec!["key".into()];
    p.objects.push(Object {
        id: "iron".into(),
        name: "iron key".into(),
        aliases: vec!["key".into()],
        placement: Placement::Location {
            location: "study".into(),
        },
        ..Default::default()
    });
    for id in ["key", "iron"] {
        p.game.actions.push(Action {
            id: format!("examine-{id}"),
            verb: "examine".into(),
            pattern: vec![PatternPart::Entity { entity: id.into() }],
            effects: vec![Effect::Say {
                text: format!("Examined {id}.").into(),
            }],
            ..Default::default()
        });
    }
    let (mut s, _) = Session::start(p, None).unwrap();
    run(&mut s, &["use accept"]);
    assert_eq!(
        s.command("examine key").unwrap().status,
        CommandStatus::Ambiguous
    );
    let question = s.pending_clarification().unwrap();
    for query in ["quests", "quest key", "quest unknown", "quests extra"] {
        s.command(query).unwrap();
        assert_eq!(s.pending_clarification(), Some(question.clone()));
    }
    assert!(plain(&s.command("1").unwrap()).contains("Examined key"));
    let before = s.state().clone();
    s.command("quest key").unwrap();
    assert!(plain(&s.command("examine it").unwrap()).contains("Examined key"));
    assert_eq!(s.state(), &before);
}

#[test]
fn legacy_authored_quest_prefixes_still_run_and_new_content_reserves_them() {
    for version in 1..=4 {
        let mut p = Project::blank("Old quest vocabulary");
        p.game.format_version = version;
        if version < 3 {
            p.game.command_assistance = None;
        }
        p.vocabulary.push(Verb {
            id: "quest-verb".into(),
            canonical: "quest".into(),
            synonyms: vec!["quests".into()],
            ..Default::default()
        });
        p.game.actions.push(Action {
            id: "old-quest".into(),
            verb: "quest-verb".into(),
            effects: vec![Effect::Say {
                text: "Old authored command.".into(),
            }],
            ..Default::default()
        });
        let (mut s, _) = Session::start(p.clone(), None).unwrap();
        assert!(plain(&s.command("quest").unwrap()).contains("Old authored command"));
        assert!(plain(&s.command("quests").unwrap()).contains("Old authored command"));
        p.game.format_version = 5;
        assert!(Session::start(p, None).is_err());
    }
}

#[test]
fn direct_hook_and_procedure_sequences_have_independent_stable_cursors_and_local_resets() {
    for repeat in [ExhaustionMode::Once, ExhaustionMode::Repeat] {
        let mut p = project();
        p.quests[0].on_start.effects = vec![
            Effect::Respond {
                id: "start-response".into(),
                responses: vec!["First".into(), "Second".into()],
                mode: SequenceMode::Fallback,
                fallback: "Done".into(),
                exhaustion: repeat,
                on_exhausted: vec![increment("starts")],
            },
            Effect::ResetResponses {
                sequence: "start-response".into(),
            },
        ];
        let (mut s, _) = Session::start(p.clone(), None).unwrap();
        run(&mut s, &["use accept"]);
        assert_eq!(s.state().narrative.sequences["start-response"], 0);
        let mut snapshot = s.state().clone();
        snapshot
            .narrative
            .sequences
            .insert("start-response".into(), 2);
        snapshot.narrative.quests.clear();
        s.replace_state(snapshot).unwrap();
        run(&mut s, &["use accept"]);
        assert_eq!(s.state().variables["starts"], Value::Integer(1));
        assert_eq!(s.state().narrative.sequences["start-response"], 0);
        // A deliberately captured sparse cursor at N+1 remains valid. Once
        // skips its follow-up; Repeat reruns it. Neither touches legacy rows.
        let mut snapshot = s.state().clone();
        snapshot
            .narrative
            .sequences
            .insert("start-response".into(), 3);
        snapshot.narrative.quests.clear();
        s.replace_state(snapshot).unwrap();
        run(
            &mut s,
            &["use accept", "use find", "use return", "use complete"],
        );
        assert_eq!(
            s.state().variables["starts"],
            Value::Integer(if repeat == ExhaustionMode::Repeat {
                2
            } else {
                1
            })
        );
        assert_eq!(s.state().procedure_sequences.len(), 1);
        assert!(s.state().sequences.is_empty());
        check_state(&s);
    }
}

#[test]
fn native_watch_start_and_active_procedure_reentry_share_the_real_transaction() {
    let mut p = project();
    p.game.triggers.push(Trigger {
        id: "coins-story".into(),
        name: "Coins story".into(),
        watch: Some(TriggerWatch {
            target: ValueTarget::Variable {
                name: "coins".into(),
            },
            mode: WatchMode::EachChange,
        }),
        effects: vec![Effect::StartQuest {
            quest: "missing".into(),
        }],
        ..Default::default()
    });
    action(&mut p, "watch", vec![increment("coins")]);
    let (mut s, _) = Session::start(p.clone(), None).unwrap();
    run(&mut s, &["use watch"]);
    assert_eq!(s.state().narrative.status("missing"), QuestStatus::Active);
    assert_eq!(s.state().variables["starts"], Value::Integer(1));
    // Re-entering the calling procedure via a quest hook must retain the
    // existing recursion guard even as the hook changes lexical roots.
    p.procedures[0].effects = vec![increment("coins")];
    p.quests[0].on_start.effects.push(Effect::Call {
        id: "reentry".into(),
        procedure: "reward".into(),
        arguments: Default::default(),
    });
    action(
        &mut p,
        "callback",
        vec![Effect::Call {
            id: "callback-call".into(),
            procedure: "reward".into(),
            arguments: Default::default(),
        }],
    );
    let (mut s, _) = Session::start(p, None).unwrap();
    let before = s.state().clone();
    assert!(
        s.command("use callback")
            .unwrap_err()
            .to_string()
            .contains("Recursive procedure re-entry")
    );
    assert_eq!(s.state(), &before);
}

#[test]
fn hook_growth_obeys_both_shared_operation_and_depth_limits() {
    for depth_limit in [false, true] {
        let mut p = project();
        if depth_limit {
            p.quests[0].on_start.effects.clear();
            for n in 0..70 {
                p.quests.push(Quest {
                    id: format!("quest-{n}"),
                    title: format!("Quest {n}"),
                    on_start: NarrativeHook {
                        id: format!("start-{n}"),
                        effects: if n < 69 {
                            vec![Effect::StartQuest {
                                quest: format!("quest-{}", n + 1),
                            }]
                        } else {
                            vec![]
                        },
                    },
                    on_complete: NarrativeHook {
                        id: format!("complete-{n}"),
                        effects: vec![],
                    },
                    on_fail: NarrativeHook {
                        id: format!("fail-{n}"),
                        effects: vec![],
                    },
                    ..Default::default()
                });
            }
            p.quests[0].on_start.effects.push(Effect::StartQuest {
                quest: "quest-0".into(),
            });
        } else {
            // Neither nested quest execution nor explained recording gets a
            // fresh operation budget after native work consumes most of it.
            p.game.actions[0]
                .effects
                .splice(0..0, (0..2040).map(|_| increment("commands")));
            p.quests[0]
                .on_start
                .effects
                .extend((0..20).map(|_| increment("starts")));
        }
        let (mut s, _) = Session::start(p, None).unwrap();
        let before = s.state().clone();
        let result = s.command_explained("use accept");
        assert_eq!(result.status, CommandStatus::Error);
        let trace = result.explanation.unwrap();
        assert!(trace.error.unwrap().contains(if depth_limit {
            "64 nested"
        } else {
            "2048 operations"
        }));
        assert_eq!(s.state(), &before);
    }
}

#[test]
fn stored_text_and_aggregate_progress_caps_apply_before_runtime_commit_and_startup() {
    let mut p = project();
    p.game
        .variables
        .insert("huge".into(), Value::Text("x".repeat(NARRATIVE_TEXT_LIMIT)));
    p.quests[0].introduction = "%huge%".into();
    p.quests[0].on_start.effects.push(stage("found-stage"));
    let (mut s, _) = Session::start(p.clone(), None).unwrap();
    run(&mut s, &["use find"]);
    let before = s.state().clone();
    let result = s.command_explained("use accept");
    assert_eq!(result.status, CommandStatus::Error);
    assert!(
        result
            .explanation
            .unwrap()
            .error
            .unwrap()
            .contains("resource bounds")
    );
    assert_eq!(s.state(), &before);
    p.game.triggers.push(Trigger {
        id: "startup-limit".into(),
        name: "Startup limit".into(),
        event: Event::Start,
        effects: vec![
            Effect::Give {
                object: "key".into(),
            },
            Effect::StartQuest {
                quest: "missing".into(),
            },
        ],
        ..Default::default()
    });
    assert!(
        Session::start(p, None)
            .err()
            .unwrap()
            .to_string()
            .contains("resource bounds")
    );

    // Structurally valid captured/debug progress may sit exactly at the entry
    // cap even though no single command can execute 50,000 stage transitions.
    let mut p = project();
    p.quests[0].on_start.effects.clear();
    p.game.actions.retain(|a| a.id == "action-accept");
    p.quests[0].stages = (0..50_000)
        .map(|n| QuestStage {
            id: format!("stage-{n}"),
            name: format!("Stage {n}"),
            required: false,
            ..Default::default()
        })
        .collect();
    action(&mut p, "last", vec![stage("stage-49999")]);
    let (mut s, _) = Session::start(p, None).unwrap();
    run(&mut s, &["use accept"]);
    let mut captured = s.state().clone();
    let progress = captured.narrative.quests.get_mut("missing").unwrap();
    for n in 0..49_999 {
        let id = format!("stage-{n}");
        progress.stages.insert(id.clone());
        progress.journal.push(JournalEntry {
            kind: JournalKind::Stage { stage: id },
            text: vec![],
        });
    }
    assert_eq!(captured.narrative.entry_count(), NARRATIVE_PROGRESS_LIMIT);
    s.replace_state(captured.clone()).unwrap();
    assert!(
        s.command("use last")
            .unwrap_err()
            .to_string()
            .contains("resource bounds")
    );
    assert_eq!(s.state(), &captured);
}

#[test]
fn a_failing_complete_journey_discards_all_prior_progress_and_preserves_parser_context() {
    let mut p = project();
    p.game.command_assistance = Some(CommandAssistance::new_game());
    p.quests[0].on_complete.effects.push(risk());
    action(
        &mut p,
        "journey",
        vec![
            Effect::Say {
                text: "Attempted journey".into(),
            },
            Effect::Give {
                object: "key".into(),
            },
            Effect::StartQuest {
                quest: "missing".into(),
            },
            stage("returned"),
            Effect::CompleteQuest {
                quest: "missing".into(),
            },
        ],
    );
    for id in ["key", "second-key"] {
        if id == "second-key" {
            p.objects.push(Object {
                id: id.into(),
                name: "other key".into(),
                aliases: vec!["key".into()],
                placement: Placement::Location {
                    location: "study".into(),
                },
                ..Default::default()
            });
        }
        p.game.actions.push(Action {
            id: format!("inspect-{id}"),
            verb: "examine".into(),
            pattern: vec![PatternPart::Entity { entity: id.into() }],
            ..Default::default()
        });
    }
    let (mut s, _) = Session::start(p, None).unwrap();
    assert_eq!(
        s.command("examine key").unwrap().status,
        CommandStatus::Ambiguous
    );
    let question = s.pending_clarification();
    let before = s.state().clone();
    let result = s.command_explained("use journey");
    assert_eq!(result.status, CommandStatus::Error);
    assert_eq!(s.pending_clarification(), question);
    assert_eq!(s.state(), &before);
    assert!(s.state().narrative.is_empty());
    assert!(s.state().procedure_sequences.is_empty());
    assert!(result.messages.is_empty());
    let trace = result.explanation.unwrap();
    assert!(
        trace
            .steps
            .iter()
            .filter(|step| matches!(step.kind, TraceKind::Narrative { applied: true, .. }))
            .count()
            >= 4
    );
    assert_eq!(s.command("1").unwrap().status, CommandStatus::Ok);
}

#[test]
fn hooks_restore_the_callers_command_item_and_procedure_bindings() {
    let mut p = project();
    p.procedures.push(Procedure {
        id: "accept-scope".into(),
        name: "Accept with amount".into(),
        description: String::new(),
        inputs: vec![ProcedureInput {
            id: "amount".into(),
            name: "Amount".into(),
            kind: InputKind::Integer,
            required_properties: Default::default(),
        }],
        effects: vec![
            Effect::StartQuest {
                quest: "missing".into(),
            },
            Effect::Assign {
                target: ScopedValueTarget::Variable {
                    name: "coins".into(),
                },
                value: Argument::Input {
                    input: "amount".into(),
                },
            },
            Effect::Stop,
            increment("failures"),
        ],
    });
    action(
        &mut p,
        "scope",
        vec![
            Effect::Call {
                id: "accept-call".into(),
                procedure: "accept-scope".into(),
                arguments: [(
                    "amount".into(),
                    Argument::Literal {
                        value: Value::Integer(7),
                    },
                )]
                .into(),
            },
            increment("returns"),
        ],
    );
    p.objects[0].placement = Placement::On {
        object: "tray".into(),
    };
    p.objects.push(Object {
        id: "tray".into(),
        name: "tray".into(),
        placement: Placement::Location {
            location: "study".into(),
        },
        storage: Some(ObjectStorage {
            surface: true,
            ..Default::default()
        }),
        actions: vec![Action {
            id: "accept-item".into(),
            name: "Accept item".into(),
            verb: "use".into(),
            pattern: vec![
                PatternPart::ObjectInput,
                PatternPart::Literal {
                    text: "from".into(),
                },
                PatternPart::Entity {
                    entity: "tray".into(),
                },
            ],
            standard: Some(StandardAction {
                interaction: StandardInteraction::TakeFrom,
                enabled: true,
            }),
            effects: vec![
                Effect::StartQuest {
                    quest: "missing".into(),
                },
                Effect::Transfer {
                    object: ObjectTarget::command_item(),
                    placement: ScopedPlacement::Inventory,
                },
            ],
            ..Default::default()
        }],
        ..Default::default()
    });
    let (mut s, _) = Session::start(p.clone(), None).unwrap();
    run(&mut s, &["use scope"]);
    assert_eq!(s.state().variables["coins"], Value::Integer(7));
    assert_eq!(s.state().variables["returns"], Value::Integer(1));
    assert_eq!(s.state().variables["failures"], Value::Integer(0));
    let (mut s, _) = Session::start(p, None).unwrap();
    run(&mut s, &["use key from tray"]);
    assert_eq!(s.state().objects["key"].placement, Placement::Inventory);
    assert_eq!(s.state().variables["starts"], Value::Integer(1));
    check_state(&s);
}

#[test]
fn status_hooks_calling_the_same_definition_keep_distinct_paths_and_stop_returns() {
    let mut p = project();
    p.procedures[0].effects.push(Effect::Stop);
    p.procedures[0].effects.push(increment("failures"));
    p.quests[0].on_start.effects.push(Effect::Call {
        id: "start-reward".into(),
        procedure: "reward".into(),
        arguments: Default::default(),
    });
    p.quests[0].on_complete.effects.push(increment("returns"));
    let (mut s, _) = Session::start(p, None).unwrap();
    run(
        &mut s,
        &["use accept", "use find", "use return", "use complete"],
    );
    assert_eq!(s.state().procedure_sequences.len(), 2);
    for (root, call) in [
        ("quest-start", "start-reward"),
        ("quest-complete", "quest-reward-call"),
    ] {
        assert_eq!(
            s.state().procedure_sequences[&ProcedurePath {
                root: root.into(),
                calls: vec![call.into()],
                sequence: "reward-response".into()
            }],
            1
        );
    }
    assert_eq!(s.state().variables["returns"], Value::Integer(2));
    assert_eq!(s.state().variables["failures"], Value::Integer(0));
    check_state(&s);
}
