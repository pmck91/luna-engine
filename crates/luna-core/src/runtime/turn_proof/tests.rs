use super::*;
use crate::CommandStatus;
#[path = "../../../../../tests/support/conversations.rs"]
mod narrative_fixture;

fn say(text: &str) -> Effect {
    Effect::Say { text: text.into() }
}
fn literal(value: i32) -> NumericOperand {
    NumericOperand::Literal { value }
}
fn set(name: &str, value: i32) -> Effect {
    Effect::SetVariable {
        name: name.into(),
        value: Value::Integer(value),
    }
}
fn inc(name: &str) -> Effect {
    Effect::UpdateVariable {
        name: name.into(),
        op: ArithmeticOperation::Add,
        operand: literal(1),
    }
}
fn broken() -> Effect {
    Effect::UpdateVariable {
        name: "count".into(),
        op: ArithmeticOperation::Divide,
        operand: NumericOperand::Variable {
            name: "divisor".into(),
        },
    }
}
fn action(id: &str, effects: Vec<Effect>) -> Action {
    Action {
        id: format!("action-{id}"),
        name: id.into(),
        verb: "use".into(),
        pattern: vec![PatternPart::Literal { text: id.into() }],
        effects,
        ..Default::default()
    }
}
fn timer(id: &str, effects: Vec<Effect>) -> Timer {
    Timer {
        id: id.into(),
        name: id.into(),
        priority: 0,
        order: 0,
        guard: Condition::True,
        effects,
    }
}
fn schedule(id: &str, after: i32) -> Operation {
    Operation::Schedule {
        timer: id.into(),
        after: literal(after),
        pending: PendingPolicy::Restart,
    }
}
fn program() -> Program {
    Program {
        enabled: true,
        timers: vec![timer(
            "door-closes",
            vec![inc("count"), say("The door shuts.")],
        )],
        operations: [
            ("schedule".into(), schedule("door-closes", 3)),
            (
                "cancel-timer".into(),
                Operation::Cancel {
                    timer: "door-closes".into(),
                },
            ),
        ]
        .into(),
        conditions: [("timer_pending".into(), "door-closes".into())].into(),
        ..Default::default()
    }
}
fn project() -> Project {
    let mut p = Project::blank("Turn proof");
    p.game.id = "turn-proof".into();
    p.game.variables = [
        ("count".into(), Value::Integer(0)),
        ("delay".into(), Value::Integer(3)),
        ("divisor".into(), Value::Integer(0)),
    ]
    .into();
    p.game.actions = vec![
        action("open", vec![say("schedule")]),
        action("secure", vec![say("cancel-timer")]),
        action("message", vec![say("Nothing changes.")]),
        action("blocked", vec![inc("count")]),
    ];
    p.game.actions[3].requirements = Condition::False;
    p.game.endings.push(Ending {
        id: "finish".into(),
        name: "Finished".into(),
        text: "Finished.".into(),
        outcome: None,
    });
    p
}
fn start(p: Project, g: Program) -> Harness {
    Harness::start(p, g).unwrap().0
}
fn output(r: &CommandResult) -> String {
    r.messages
        .iter()
        .map(|m| text::plain(m))
        .collect::<Vec<_>>()
        .join("\n")
}
fn remaining(h: &Harness) -> u32 {
    h.clock.pending["door-closes"].deadline - h.clock.turn
}
fn count(h: &Harness) -> i32 {
    match h.session.state().variables["count"] {
        Value::Integer(n) => n,
        _ => panic!("integer count"),
    }
}
fn due_next(h: &mut Harness) {
    let deadline = h.clock.turn + 1;
    h.clock.pending.get_mut("door-closes").unwrap().deadline = deadline;
}
fn error(h: &mut Harness, input: &str) -> CommandResult {
    let before = h.session.state().clone();
    let clock = h.clock.clone();
    let context = h.session.pending_clarification();
    let offer = h.session.conversation_view().cloned();
    let (r, e) = h.attempt(input, None, true);
    assert!(e.is_some());
    assert_eq!(r.status, CommandStatus::Error);
    assert!(r.messages.is_empty());
    assert!(!r.state_changed);
    assert_eq!(h.session.state(), &before);
    assert_eq!(h.clock, clock);
    assert_eq!(h.session.pending_clarification(), context);
    assert_eq!(h.session.conversation_view(), offer.as_ref());
    r
}

#[test]
fn three_subsequent_turns_exclude_the_scheduling_action() {
    let mut h = start(project(), program());
    h.command("use open");
    assert_eq!(h.clock.turn, 1);
    assert_eq!(remaining(&h), 3);
    for input in [
        "look",
        "help",
        "inventory",
        "hint",
        "nonsense",
        "use blocked",
        "save checkpoint",
        "quests",
    ] {
        h.command(input);
        assert_eq!(h.clock.turn, 1, "{input}");
        assert_eq!(remaining(&h), 3);
    }
    h.command("WAIT");
    h.command("wait!");
    assert_eq!((h.clock.turn, remaining(&h), count(&h)), (3, 1, 0));
    assert!(output(&h.command("wait")).contains("The door shuts."));
    assert_eq!((h.clock.turn, count(&h)), (4, 1));
    assert!(h.clock.pending.is_empty());
}

#[test]
fn free_opening_and_delay_one_use_the_correct_origin() {
    let mut g = program();
    g.success.insert("action-open".into(), Cost::Free);
    g.operations
        .insert("schedule".into(), schedule("door-closes", 1));
    let mut h = start(project(), g);
    h.command("use open");
    assert_eq!((h.clock.turn, remaining(&h)), (0, 1));
    h.command("wait");
    assert_eq!((h.clock.turn, count(&h)), (1, 1));
}

#[test]
fn successful_message_only_action_spends_and_wait_only_changes_clock() {
    let mut h = start(project(), program());
    let before = h.session.state().clone();
    assert!(h.command("use message").state_changed);
    assert_eq!(h.session.state(), &before);
    assert_eq!(h.clock.turn, 1);
    assert!(h.command("wait").state_changed);
    assert_eq!(h.session.state(), &before);
    assert_eq!(h.clock.turn, 2);
}

#[test]
fn independent_success_failure_defaults_and_overrides_are_typed() {
    let mut g = program();
    g.policy.actions = false;
    g.policy.failed = true;
    g.success.insert("action-open".into(), Cost::Spend);
    g.failure.insert("action-blocked".into(), Cost::Free);
    let mut h = start(project(), g);
    h.command("use message");
    assert_eq!(h.clock.turn, 0);
    h.command("use open");
    h.command("use blocked");
    assert_eq!(h.clock.turn, 1);
    let mut p = project();
    p.game.actions.push(action("other-blocked", vec![]));
    p.game.actions.last_mut().unwrap().requirements = Condition::False;
    let mut g = program();
    g.policy.failed = true;
    let mut h = start(p, g);
    assert_eq!(
        h.command("use other-blocked").status,
        CommandStatus::RequirementsFailed
    );
    assert_eq!(h.clock.turn, 1);
}

#[test]
fn look_and_hint_defaults_charge_without_deriving_cost_from_mutation() {
    let mut p = project();
    p.locations[0].hints.push(HintSet {
        id: "puzzle".into(),
        name: "Door puzzle".into(),
        stages: vec![HintStage {
            id: "clue".into(),
            name: "Clue".into(),
            clues: vec!["Wait.".into()],
            ..Default::default()
        }],
        ..Default::default()
    });
    let room = p.locations[0].name.clone();
    let mut h = start(p.clone(), program());
    assert!(h.command(&format!("hint {room}")).state_changed);
    assert_eq!(h.clock.turn, 0);
    assert_eq!(h.session.state().hints["clue"].clues_seen, 1);
    let mut g = program();
    g.policy.look = true;
    g.policy.hints = true;
    let mut h = start(p, g);
    h.command("look");
    h.command("hint");
    assert_eq!(h.clock.turn, 2);
}

#[test]
fn stop_spends_once_and_skips_later_schedule() {
    let mut p = project();
    p.game.actions[0].effects = vec![Effect::Stop, say("schedule")];
    let mut h = start(p, program());
    h.command("use open");
    assert_eq!(h.clock.turn, 1);
    assert!(h.clock.pending.is_empty());
}

#[test]
fn exit_success_failure_and_override_share_the_action_policy() {
    let mut p = project();
    p.locations.push(Location {
        id: "garden".into(),
        name: "Garden".into(),
        ..Default::default()
    });
    p.locations[0].exits.push(Exit {
        id: "route".into(),
        name: "garden".into(),
        verb: "go".into(),
        destination: "garden".into(),
        effects: vec![say("schedule")],
        ..Default::default()
    });
    let mut g = program();
    g.success.insert("route".into(), Cost::Free);
    let mut h = start(p.clone(), g);
    h.command("go garden");
    assert_eq!(h.session.state().location, "garden");
    assert_eq!((h.clock.turn, remaining(&h)), (0, 3));
    p.locations[0].exits[0].available = Condition::False;
    let mut g = program();
    g.failure.insert("route".into(), Cost::Spend);
    let mut h = start(p, g);
    assert_eq!(
        h.command("go garden").status,
        CommandStatus::RequirementsFailed
    );
    assert_eq!(h.clock.turn, 1);
    assert!(h.clock.pending.is_empty());
}

#[test]
fn wait_does_not_dispatch_the_authored_turn_verb_event_or_command_events() {
    let mut p = project();
    p.game.actions.push(Action {
        id: "turn-action".into(),
        verb: "turn".into(),
        ..Default::default()
    });
    p.game.triggers.push(Trigger {
        id: "turn-event".into(),
        event: Event::Turn,
        effects: vec![inc("count")],
        ..Default::default()
    });
    p.game.triggers.push(Trigger {
        id: "command-event".into(),
        event: Event::Command,
        effects: vec![inc("count")],
        ..Default::default()
    });
    let mut h = start(p, program());
    h.command("wait");
    assert_eq!(count(&h), 0);
    h.command("turn");
    assert_eq!((count(&h), h.clock.turn), (2, 2));
}

#[test]
fn live_variable_and_property_delay_is_captured_once() {
    for property in [false, true] {
        let mut p = project();
        p.locations[0]
            .state
            .insert("delay".into(), Value::Integer(3));
        let mut g = program();
        let after = if property {
            NumericOperand::Property {
                entity: p.game.starting_location.clone().into(),
                name: "delay".into(),
            }
        } else {
            NumericOperand::Variable {
                name: "delay".into(),
            }
        };
        g.operations.insert(
            "schedule".into(),
            Operation::Schedule {
                timer: "door-closes".into(),
                after,
                pending: PendingPolicy::Restart,
            },
        );
        p.game.actions[0].effects.push(set("delay", 1));
        let mut h = start(p, g);
        h.command("use open");
        assert_eq!(remaining(&h), 3);
    }
}

#[test]
fn invalid_delay_values_and_types_roll_back_everything() {
    for operand in [
        literal(0),
        literal(-1),
        NumericOperand::Variable {
            name: "missing".into(),
        },
        NumericOperand::Variable {
            name: "bool".into(),
        },
    ] {
        let mut p = project();
        p.game.variables.insert("bool".into(), Value::Bool(true));
        p.game.actions[0].effects.insert(0, inc("count"));
        let mut g = program();
        g.operations.insert(
            "schedule".into(),
            Operation::Schedule {
                timer: "door-closes".into(),
                after: operand,
                pending: PendingPolicy::Restart,
            },
        );
        let mut h = start(p, g);
        error(&mut h, "use open");
    }
}

#[test]
fn integer_and_deadline_boundaries_are_checked() {
    let mut h = start(project(), program());
    h.clock.turn = u32::MAX;
    error(&mut h, "wait");
    h.clock.turn = u32::MAX - 3;
    error(&mut h, "use open"); // provisional T+3 fits; charged B+3 does not.
    assert_eq!(h.clock.turn, u32::MAX - 3);
}

#[test]
fn native_start_and_entry_triggers_schedule_from_zero_without_a_turn() {
    let mut p = project();
    p.game.triggers.push(Trigger {
        id: "startup".into(),
        effects: vec![say("schedule")],
        ..Default::default()
    });
    let mut g = program();
    g.operations
        .insert("schedule".into(), schedule("door-closes", 1));
    let mut h = start(p, g);
    assert_eq!((h.clock.turn, remaining(&h)), (0, 1));
    h.command("wait");
    assert_eq!(count(&h), 1);
}

#[test]
fn nested_call_delay_uses_real_typed_local_then_current_boundary() {
    let mut p = project();
    p.procedures.push(Procedure {
        id: "scheduler".into(),
        name: "Scheduler".into(),
        description: String::new(),
        inputs: vec![ProcedureInput {
            id: "amount".into(),
            name: "amount".into(),
            kind: InputKind::Integer,
            required_properties: BTreeMap::new(),
        }],
        effects: vec![say("schedule"), Effect::Stop, inc("count")],
    });
    p.game.actions[0].effects = vec![
        Effect::Call {
            id: "schedule-call".into(),
            procedure: "scheduler".into(),
            arguments: [(
                "amount".into(),
                Argument::Literal {
                    value: Value::Integer(2),
                },
            )]
            .into(),
        },
        say("Returned."),
    ];
    let mut g = program();
    g.operations.insert(
        "schedule".into(),
        Operation::Schedule {
            timer: "door-closes".into(),
            after: NumericOperand::Input {
                input: "amount".into(),
            },
            pending: PendingPolicy::Restart,
        },
    );
    let mut h = start(p, g);
    assert!(output(&h.command("use open")).contains("Returned."));
    assert_eq!((h.clock.turn, remaining(&h), count(&h)), (1, 2, 0));
}

#[test]
fn native_watch_scheduling_shares_the_one_initiating_turn() {
    let mut p = project();
    p.game.actions[0].effects = vec![inc("count")];
    p.game.triggers.push(Trigger {
        id: "watch".into(),
        watch: Some(TriggerWatch {
            target: ValueTarget::Variable {
                name: "count".into(),
            },
            mode: WatchMode::BecomesTrue,
        }),
        condition: Condition::Variable {
            name: "count".into(),
            op: Comparison::Eq,
            value: Value::Integer(1),
        },
        effects: vec![say("schedule")],
        ..Default::default()
    });
    let mut h = start(p, program());
    h.command("use open");
    assert_eq!((h.clock.turn, remaining(&h)), (1, 3));
}

#[test]
fn keep_restart_and_cancel_have_independent_per_site_meanings() {
    for keep in [false, true] {
        let mut g = program();
        if keep {
            g.operations.insert(
                "schedule".into(),
                Operation::Schedule {
                    timer: "door-closes".into(),
                    after: literal(3),
                    pending: PendingPolicy::Keep,
                },
            );
        }
        let mut h = start(project(), g);
        h.command("use open");
        h.command("wait");
        h.command("use open");
        assert_eq!(h.clock.turn, 3);
        assert_eq!(remaining(&h), if keep { 1 } else { 3 });
        h.command("use secure");
        assert!(h.clock.pending.is_empty());
        h.command("use secure"); // absent cancellation is harmless.
        assert_eq!(h.clock.turn, 5);
    }
}

#[test]
fn pending_is_visible_within_the_same_native_if_chain() {
    let mut p = project();
    let pending = Condition::Variable {
        name: "timer_pending".into(),
        op: Comparison::Eq,
        value: Value::Bool(true),
    };
    p.game.actions[0].effects = vec![
        say("schedule"),
        Effect::If {
            condition: pending.clone(),
            then: vec![inc("count"), say("cancel-timer")],
            otherwise: vec![],
        },
        Effect::If {
            condition: pending,
            then: vec![broken()],
            otherwise: vec![say("Cancelled.")],
        },
    ];
    let mut h = start(p, program());
    assert!(output(&h.command("use open")).contains("Cancelled."));
    assert_eq!(count(&h), 1);
    assert!(h.clock.pending.is_empty());
}

fn simultaneous(first: Vec<Effect>) -> (Project, Program) {
    let mut p = project();
    p.game.actions[0].effects = vec![say("schedule"), say("schedule-other")];
    let mut g = program();
    g.operations
        .insert("schedule".into(), schedule("door-closes", 1));
    g.operations
        .insert("schedule-other".into(), schedule("other", 1));
    g.operations.insert(
        "cancel-other".into(),
        Operation::Cancel {
            timer: "other".into(),
        },
    );
    g.timers[0].effects = first;
    g.timers.push(timer("other", vec![say("Second.")]));
    g.timers[1].order = 1;
    (p, g)
}

#[test]
fn simultaneous_order_is_priority_then_stable_author_order_not_random_id() {
    for high_second in [false, true] {
        let (p, mut g) = simultaneous(vec![say("First.")]);
        g.timers[1].priority = if high_second { 1 } else { 0 };
        let mut h = start(p, g);
        h.command("use open");
        let out = output(&h.command("wait"));
        assert_eq!(
            out.find("Second.").unwrap() < out.find("First.").unwrap(),
            high_second
        );
    }
}

#[test]
fn earlier_callback_cancel_or_restart_prevents_stale_due_firing() {
    for effect in [say("cancel-other"), say("schedule-other")] {
        let (p, g) = simultaneous(vec![effect]);
        let mut h = start(p, g);
        h.command("use open");
        assert!(!output(&h.command("wait")).contains("Second."));
        if h.clock.pending.contains_key("other") {
            assert!(output(&h.command("wait")).contains("Second."));
        }
    }
}

#[test]
fn keeping_an_already_due_ticket_does_not_skip_its_firing() {
    let (p, mut g) = simultaneous(vec![say("schedule-other")]);
    g.operations.insert(
        "schedule-other".into(),
        Operation::Schedule {
            timer: "other".into(),
            after: literal(1),
            pending: PendingPolicy::Keep,
        },
    );
    let mut h = start(p, g);
    h.command("use open");
    assert!(output(&h.command("wait")).contains("Second."));
}

#[test]
fn self_schedule_runs_on_the_next_boundary_and_guard_sees_consumed_state() {
    let mut g = program();
    g.operations
        .insert("schedule".into(), schedule("door-closes", 1));
    g.timers[0].guard = Condition::Not {
        condition: Box::new(Condition::Variable {
            name: "timer_pending".into(),
            op: Comparison::Eq,
            value: Value::Bool(true),
        }),
    };
    g.timers[0].effects = vec![inc("count"), say("schedule")];
    let mut h = start(project(), g);
    h.command("use open");
    for turn in 2..5 {
        h.command("wait");
        assert_eq!(
            (h.clock.turn, count(&h), remaining(&h)),
            (turn, (turn - 1) as i32, 1)
        );
    }
}

#[test]
fn false_guard_consumes_and_does_not_retry_implicitly() {
    let mut g = program();
    g.timers[0].guard = Condition::False;
    let mut h = start(project(), g);
    h.command("use open");
    due_next(&mut h);
    h.command("wait");
    h.command("wait");
    assert!(h.clock.pending.is_empty());
    assert_eq!(count(&h), 0);
}

#[test]
fn timer_stop_is_local_and_later_timers_still_run() {
    let (p, g) = simultaneous(vec![say("First."), Effect::Stop, broken()]);
    let mut h = start(p, g);
    h.command("use open");
    let out = output(&h.command("wait"));
    assert!(out.contains("First.") && out.contains("Second."));
}

#[test]
fn repeated_timer_responses_and_call_cursors_reuse_the_timer_root() {
    let mut p = project();
    p.procedures.push(Procedure {
        id: "reply-procedure".into(),
        name: "Reply".into(),
        description: String::new(),
        inputs: vec![],
        effects: vec![Effect::Respond {
            id: "call-response".into(),
            responses: vec!["Call one.".into(), "Call two.".into()],
            mode: SequenceMode::RepeatLast,
            fallback: "".into(),
            exhaustion: ExhaustionMode::Once,
            on_exhausted: vec![],
        }],
    });
    let mut g = program();
    g.operations
        .insert("schedule".into(), schedule("door-closes", 1));
    g.timers[0].effects = vec![
        Effect::Respond {
            id: "timer-response".into(),
            responses: vec!["Timer one.".into(), "Timer two.".into()],
            mode: SequenceMode::RepeatLast,
            fallback: "".into(),
            exhaustion: ExhaustionMode::Once,
            on_exhausted: vec![],
        },
        Effect::Call {
            id: "timer-call".into(),
            procedure: "reply-procedure".into(),
            arguments: BTreeMap::new(),
        },
    ];
    let mut h = start(p, g);
    h.command("use open");
    let first = output(&h.command("wait"));
    assert!(first.contains("Timer one.") && first.contains("Call one."));
    h.command("use open");
    let second = output(&h.command("wait"));
    assert!(second.contains("Timer two.") && second.contains("Call two."));
    assert_eq!(h.session.state().procedure_sequences.len(), 1);
    assert_eq!(
        h.session
            .state()
            .procedure_sequences
            .keys()
            .next()
            .unwrap()
            .root,
        "door-closes"
    );
}

#[test]
fn late_failure_rolls_back_the_player_action_all_timers_and_discarded_output() {
    let (mut p, mut g) = simultaneous(vec![inc("count"), say("Discard me.")]);
    p.game.actions.push(action("mutate", vec![inc("count")]));
    g.timers[1].effects = vec![inc("count"), broken()];
    let mut h = start(p, g);
    h.command("use open");
    let r = error(&mut h, "use mutate");
    assert!(
        r.explanation
            .unwrap()
            .discarded_messages
            .iter()
            .any(|m| text::plain(m).contains("Discard me."))
    );
    assert_eq!(count(&h), 0);
    assert_eq!(h.clock.pending.len(), 2);
}

#[test]
fn end_in_action_clears_queue_and_ending_hooks_cannot_revive_it() {
    let mut p = project();
    p.game.actions.push(action(
        "end",
        vec![
            Effect::End {
                ending: "finish".into(),
            },
            broken(),
        ],
    ));
    p.game.triggers.push(Trigger {
        id: "ending-hook".into(),
        event: Event::Ending,
        effects: vec![say("schedule")],
        ..Default::default()
    });
    let mut h = start(p, program());
    h.command("use open");
    due_next(&mut h);
    h.command("use end");
    assert_eq!(h.session.state().ending.as_deref(), Some("finish"));
    assert_eq!(h.clock.turn, 2);
    assert!(h.clock.pending.is_empty());
    h.command("wait");
    assert_eq!((h.clock.turn, count(&h)), (2, 0));
}

#[test]
fn end_in_timer_skips_later_callbacks_and_clears_schedules_from_hooks() {
    let (p, g) = simultaneous(vec![
        Effect::End {
            ending: "finish".into(),
        },
        broken(),
    ]);
    let mut h = start(p, g);
    h.command("use open");
    let out = output(&h.command("wait"));
    assert!(out.contains("Finished.") && !out.contains("Second."));
    assert!(h.clock.pending.is_empty());
}

#[test]
fn original_budget_is_shared_between_player_effects_and_all_due_timers() {
    let mut p = project();
    p.game
        .actions
        .push(action("costly", vec![set("count", 1); 1100]));
    let mut g = program();
    g.timers[0].effects = vec![set("count", 2); 1100];
    let mut h = start(p, g);
    h.command("use open");
    due_next(&mut h);
    let r = error(&mut h, "use costly");
    assert!(r.explanation.unwrap().error.unwrap().contains("2048"));
}

#[test]
fn native_watch_depth_limit_is_not_reset_inside_timer_callbacks() {
    let mut p = project();
    p.game.triggers.push(Trigger {
        id: "recursive-watch".into(),
        watch: Some(TriggerWatch {
            target: ValueTarget::Variable {
                name: "count".into(),
            },
            mode: WatchMode::EachChange,
        }),
        effects: vec![inc("count")],
        ..Default::default()
    });
    let mut h = start(p, program());
    h.command("use open");
    due_next(&mut h);
    let r = error(&mut h, "wait");
    assert!(r.explanation.unwrap().error.unwrap().contains("64"));
}

#[test]
fn save_and_setup_candidate_restore_does_not_fire_or_spend() {
    for version in [SAVE_VERSION, SETUP_VERSION] {
        let mut h = start(project(), program());
        h.command("use open");
        h.command("wait");
        let bytes = h.snapshot(version);
        let clock = h.clock.clone();
        let world = h.session.state().clone();
        h.command("wait");
        h.command("wait");
        assert_eq!(count(&h), 1);
        h.restore(&bytes, version).unwrap();
        assert_eq!(h.clock, clock);
        assert_eq!(h.session.state(), &world);
        h.command("wait");
        assert_eq!(count(&h), 0);
        h.command("wait");
        assert_eq!(count(&h), 1);
    }
}

#[test]
fn invalid_snapshot_leaves_current_state_context_and_input_bytes_untouched() {
    let mut h = start(project(), program());
    h.command("use open");
    let original = h.snapshot(SAVE_VERSION);
    for mutate in [
        |v: &mut serde_json::Value| v["version"] = 5.into(),
        |v: &mut serde_json::Value| v["clock"]["pending"]["door-closes"]["deadline"] = 1.into(),
        |v: &mut serde_json::Value| {
            v["clock"]["pending"]["door-closes"]["deadline"] = 4294967296u64.into()
        },
        |v: &mut serde_json::Value| {
            v["clock"]["pending"]["door-closes"]["source"] = "missing".into()
        },
        |v: &mut serde_json::Value| {
            v["clock"]["pending"]["foreign"] = v["clock"]["pending"]["door-closes"].clone()
        },
        |v: &mut serde_json::Value| v["clock"]["unexpected"] = true.into(),
        |v: &mut serde_json::Value| v["world"]["ending"] = "finish".into(),
    ] {
        let mut value: serde_json::Value = serde_json::from_slice(&original).unwrap();
        mutate(&mut value);
        let bytes = serde_json::to_vec(&value).unwrap();
        let unchanged = bytes.clone();
        assert!(h.restore(&bytes, SAVE_VERSION).is_err());
        assert_eq!(bytes, unchanged);
        assert_eq!(h.snapshot(SAVE_VERSION), original);
    }
    let duplicate = r#"{"turn":1,"pending":{"door-closes":{"deadline":4,"source":"schedule"},"door-closes":{"deadline":5,"source":"schedule"}}}"#;
    assert!(serde_json::from_str::<Clock>(duplicate).is_err());
}

#[test]
fn disabled_games_keep_authored_wait_and_opt_in_detects_hidden_owner_alias_conflicts() {
    let mut p = project();
    p.vocabulary.push(Verb {
        id: "pause-verb".into(),
        canonical: "pause".into(),
        synonyms: vec!["Wait!".into()],
        event: None,
    });
    p.objects.push(Object {
        id: "hidden".into(),
        name: "Hidden".into(),
        placement: Placement::Absent,
        actions: vec![Action {
            id: "legacy-wait".into(),
            verb: "pause-verb".into(),
            ..Default::default()
        }],
        ..Default::default()
    });
    assert_eq!(validation::wait_conflicts(&p), ["legacy-wait"]);
    assert!(Harness::start(p.clone(), program()).is_err());
    p.game.actions.push(Action {
        id: "global-wait".into(),
        verb: "pause-verb".into(),
        effects: vec![inc("count")],
        ..Default::default()
    });
    let mut h = start(p, Program::default());
    h.command("wait");
    assert_eq!((count(&h), h.clock.turn), (1, 0));
}

#[test]
fn wait_with_a_target_is_preserved_and_invalid_disabling_or_references_reject() {
    let mut p = project();
    p.vocabulary.push(Verb {
        id: "wait-verb".into(),
        canonical: "wait".into(),
        ..Default::default()
    });
    p.game.actions.push(Action {
        id: "wait-target".into(),
        verb: "wait-verb".into(),
        pattern: vec![PatternPart::Literal {
            text: "here".into(),
        }],
        effects: vec![inc("count")],
        ..Default::default()
    });
    let mut h = start(p, program());
    h.command("wait here");
    assert_eq!(count(&h), 1);
    let mut g = program();
    g.enabled = false;
    assert!(Harness::start(project(), g).is_err());
    let mut g = program();
    g.timers.clear();
    assert!(Harness::start(project(), g).is_err());
    let mut g = program();
    g.timers.push(g.timers[0].clone());
    assert!(Harness::start(project(), g).is_err());
}

fn narrative(g: Program) -> Harness {
    let mut p = narrative_fixture::project();
    p.game.variables.insert("count".into(), Value::Integer(0));
    p.game.actions.push(action("open", vec![say("schedule")]));
    start(p, g)
}

#[test]
fn accepted_number_and_button_reply_charge_once_and_stale_reply_is_free() {
    for buttons in [false, true] {
        let mut h = narrative(program());
        h.command("talk keeper");
        assert_eq!(h.clock.turn, 1);
        let offer = h.session.conversation_view().unwrap().clone();
        if buttons {
            let (_, e) = h.attempt("button", Some((&offer.offer_token, "accept")), false);
            assert!(e.is_none());
        } else {
            h.command("1");
        }
        assert_eq!(h.clock.turn, 2);
        assert_eq!(
            h.session.state().narrative.status("missing"),
            QuestStatus::Active
        );
        let (_, e) = h.attempt("button", Some((&offer.offer_token, "accept")), false);
        assert!(e.is_none());
        assert_eq!(h.clock.turn, 2);
        h.command("reply 99");
        h.command("bye");
        assert_eq!(h.clock.turn, 2);
    }
}

#[test]
fn reply_override_and_game_default_can_make_dialogue_free() {
    for override_reply in [false, true] {
        let mut g = program();
        if override_reply {
            g.replies.insert("accept".into(), Cost::Free);
        } else {
            g.policy.replies = false;
        }
        let mut h = narrative(g);
        h.command("talk keeper");
        h.command("1");
        assert_eq!(h.clock.turn, 1);
    }
}

#[test]
fn wait_preserves_dialogue_and_noun_question_then_clarified_action_charges_once() {
    let mut h = narrative(program());
    h.command("talk keeper");
    h.command("take key");
    let question = h.session.pending_clarification().unwrap();
    let offer = h.session.conversation_view().cloned();
    assert_eq!(h.clock.turn, 1);
    h.command("wait");
    assert_eq!(h.clock.turn, 2);
    assert_eq!(h.session.pending_clarification(), Some(question));
    assert_eq!(h.session.conversation_view(), offer.as_ref());
    h.command("brass");
    assert_eq!(h.clock.turn, 3);
    assert!(h.session.pending_clarification().is_none());
    assert_eq!(
        h.session.state().objects["key"].placement,
        Placement::Inventory
    );
}

#[test]
fn timer_failure_rolls_back_clarification_and_recent_reference_changes() {
    let mut g = program();
    g.timers[0].effects = vec![broken()];
    let mut h = narrative(g);
    h.command("use open");
    due_next(&mut h);
    h.command("take key");
    error(&mut h, "brass");
    assert!(h.session.pending_clarification().is_some());
}

#[test]
fn reply_and_quest_hooks_roll_back_with_a_failed_due_timer_and_offer_token() {
    let mut g = program();
    g.timers[0].effects = vec![inc("count"), broken()];
    let mut h = narrative(g);
    h.command("use open");
    h.command("talk keeper");
    due_next(&mut h);
    let offer = h.session.conversation_view().cloned();
    error(&mut h, "1");
    assert_eq!(h.session.conversation_view(), offer.as_ref());
    assert_eq!(
        h.session.state().narrative.status("missing"),
        QuestStatus::Undiscovered
    );
}

#[test]
fn timer_runs_before_final_speaker_scope_reconciliation() {
    let mut g = program();
    g.timers[0].effects = vec![Effect::MoveCharacter {
        character: "keeper".into(),
        location: "garden".into(),
    }];
    let mut h = narrative(g);
    h.command("use open");
    h.command("talk keeper");
    due_next(&mut h);
    h.command("1");
    assert_eq!(h.clock.turn, 3);
    assert!(h.session.conversation_view().is_none());
    assert!(h.session.state().narrative.active.is_none());
    assert_eq!(h.session.state().characters["keeper"].location, "garden");
}

#[test]
fn normal_and_explained_native_attempts_commit_identical_story_and_clock() {
    let p = project();
    let mut a = start(p.clone(), program());
    let mut b = start(p, program());
    for input in ["use open", "look", "wait", "wait", "wait"] {
        let normal = a.command(input);
        let (explained, error) = b.attempt(input, None, true);
        assert!(error.is_none());
        assert_eq!(normal.messages, explained.messages);
        assert_eq!(a.clock, b.clock);
        assert_eq!(a.session.state(), b.session.state());
        assert!(explained.explanation.unwrap().committed);
    }
}

#[test]
fn pending_limit_and_aggregate_queue_work_fail_atomically() {
    let mut p = project();
    let mut g = Program {
        enabled: true,
        ..Default::default()
    };
    g.success.insert("action-open".into(), Cost::Free);
    p.game.actions[0].effects.clear();
    for n in 0..=MAX_PENDING {
        let id = format!("timer-{n}");
        let source = format!("schedule-{n}");
        g.timers.push(timer(&id, vec![]));
        g.timers.last_mut().unwrap().order = n as u32;
        g.operations.insert(source.clone(), schedule(&id, 1));
        p.game.actions[0].effects.push(say(&source));
    }
    let mut h = start(p.clone(), g.clone());
    error(&mut h, "use open");
    p.game.actions[0].effects.pop();
    let mut h = start(p, g);
    h.command("use open");
    assert_eq!(h.clock.pending.len(), MAX_PENDING);
    assert_eq!(h.clock.turn, 0);
    let r = error(&mut h, "wait");
    assert!(r.explanation.unwrap().error.unwrap().contains("2048"));
}

#[test]
fn ending_hook_failure_rolls_back_the_ending_and_clock() {
    let mut p = project();
    p.game.actions.push(action(
        "end",
        vec![Effect::End {
            ending: "finish".into(),
        }],
    ));
    p.game.triggers.push(Trigger {
        id: "bad-ending-hook".into(),
        event: Event::Ending,
        effects: vec![broken()],
        ..Default::default()
    });
    let mut h = start(p, program());
    h.command("use open");
    error(&mut h, "use end");
    assert!(h.session.state().ending.is_none());
    assert_eq!(remaining(&h), 3);
}

#[test]
fn independently_deserialized_definitions_restore_progress_without_running_hooks() {
    let mut h = narrative(program());
    h.command("use open");
    h.command("talk keeper");
    h.command("take key");
    assert!(h.session.pending_clarification().is_some());
    let world = h.session.state().clone();
    let clock = h.clock.clone();
    let old_token = h.session.conversation_view().unwrap().offer_token.clone();
    let project: Project =
        serde_json::from_slice(&serde_json::to_vec(h.session.project()).unwrap()).unwrap();
    let program: Program =
        serde_json::from_slice(&serde_json::to_vec(&*h.program).unwrap()).unwrap();
    let definition = GameDefinition::new(project).unwrap();
    let mut restored = Harness {
        session: Session::restore_with_definition(definition, world.clone()).unwrap(),
        program: Arc::new(program),
        clock: Clock::default(),
    };
    restored
        .restore(&h.snapshot(SAVE_VERSION), SAVE_VERSION)
        .unwrap();
    assert_eq!(restored.session.state(), &world);
    assert_eq!(restored.clock, clock);
    assert!(restored.session.pending_clarification().is_none());
    assert_ne!(
        restored.session.conversation_view().unwrap().offer_token,
        old_token
    );
    assert_eq!(count(&restored), 0);
}

#[test]
fn formats_one_through_five_retain_disabled_clock_and_authored_wait() {
    for version in 1..=5 {
        let mut p = project();
        p.game.format_version = version;
        p.game.command_assistance = None;
        p.vocabulary.push(Verb {
            id: "legacy-wait-verb".into(),
            canonical: "wait".into(),
            ..Default::default()
        });
        p.game.actions.push(Action {
            id: "legacy-wait-action".into(),
            verb: "legacy-wait-verb".into(),
            effects: vec![inc("count")],
            ..Default::default()
        });
        let mut h = start(p, Program::default());
        h.command("wait");
        assert_eq!((h.clock.turn, count(&h)), (0, 1));
    }
}

#[test]
fn max_turn_free_inputs_remain_available_and_pending_keep_validates_delay() {
    let mut h = start(project(), program());
    h.clock.turn = u32::MAX;
    h.command("help");
    h.command("look");
    assert_eq!(h.clock.turn, u32::MAX);
    let mut g = program();
    g.operations.insert(
        "keep-invalid".into(),
        Operation::Schedule {
            timer: "door-closes".into(),
            after: literal(0),
            pending: PendingPolicy::Keep,
        },
    );
    let mut p = project();
    p.game
        .actions
        .push(action("bad-keep", vec![say("keep-invalid")]));
    let mut h = start(p, g);
    h.command("use open");
    error(&mut h, "use bad-keep");
}

#[test]
fn persisted_author_order_survives_a_changed_definition_load_order() {
    let (p, mut g) = simultaneous(vec![say("First.")]);
    g.timers.reverse();
    let mut h = start(p, g);
    h.command("use open");
    let out = output(&h.command("wait"));
    assert!(out.find("First.").unwrap() < out.find("Second.").unwrap());
}

#[test]
fn authored_reordering_is_explicit_and_duplicate_ordinals_are_rejected() {
    let (p, mut g) = simultaneous(vec![say("First.")]);
    g.timers[0].order = 1;
    g.timers[1].order = 0;
    let bytes = serde_json::to_vec(&g).unwrap();
    let reloaded: Program = serde_json::from_slice(&bytes).unwrap();
    let mut h = start(p.clone(), reloaded);
    h.command("use open");
    let out = output(&h.command("wait"));
    assert!(out.find("Second.").unwrap() < out.find("First.").unwrap());
    g.timers[1].order = 1;
    assert!(Harness::start(p, g).is_err());
}

#[test]
fn quest_hook_schedule_uses_the_reply_boundary_and_does_not_add_a_turn() {
    let mut p = narrative_fixture::project();
    p.game.variables.insert("count".into(), Value::Integer(0));
    p.quests[0].on_start.effects.push(say("schedule"));
    let mut h = start(p, program());
    h.command("talk keeper");
    h.command("1");
    assert_eq!((h.clock.turn, remaining(&h)), (2, 3));
}

#[test]
fn due_timer_can_start_native_dialogue_without_a_second_turn() {
    let mut g = program();
    g.timers[0].effects = vec![Effect::StartConversation {
        conversation: "conversation".into(),
    }];
    let mut h = narrative(g);
    h.command("use open");
    due_next(&mut h);
    h.command("wait");
    assert_eq!(h.clock.turn, 2);
    assert!(h.session.conversation_view().is_some());
    assert_eq!(h.session.state().variables["entries"], Value::Integer(1));
}

#[test]
fn due_guard_reads_state_after_the_initiating_action_and_rejects_invalid_refs() {
    let mut g = program();
    g.timers[0].guard = Condition::Variable {
        name: "count".into(),
        op: Comparison::Eq,
        value: Value::Integer(1),
    };
    let mut p = project();
    p.game.actions.push(action("increment", vec![inc("count")]));
    let mut h = start(p, g);
    h.command("use open");
    due_next(&mut h);
    h.command("use increment");
    assert_eq!(count(&h), 2);
    let mut g = program();
    g.timers[0].guard = Condition::Opened {
        object: "missing".into(),
    };
    assert!(Harness::start(project(), g).is_err());
}

#[test]
fn ending_hooks_observe_an_already_cleared_pending_queue() {
    let mut p = project();
    p.game.actions.push(action(
        "end",
        vec![Effect::End {
            ending: "finish".into(),
        }],
    ));
    p.game.triggers.push(Trigger {
        id: "ending-query".into(),
        event: Event::Ending,
        effects: vec![Effect::If {
            condition: Condition::Variable {
                name: "timer_pending".into(),
                op: Comparison::Eq,
                value: Value::Bool(true),
            },
            then: vec![broken()],
            otherwise: vec![say("No countdown remains.")],
        }],
        ..Default::default()
    });
    let mut h = start(p, program());
    h.command("use open");
    assert!(output(&h.command("use end")).contains("No countdown remains."));
    assert!(h.clock.pending.is_empty());
}
