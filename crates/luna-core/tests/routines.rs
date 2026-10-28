use anyhow::{Result, ensure};
use luna_core::{CommandResult, CommandStatus, Session};
use luna_model::*;
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
include!("routines/support.rs");

fn say(text: &str) -> Effect {
    Effect::Say { text: text.into() }
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
        operand: NumericOperand::Literal { value: 1 },
    }
}
fn integer(value: i32) -> NumericOperand {
    NumericOperand::Literal { value }
}
fn step(id: &str, effects: Vec<Effect>) -> Step {
    Step {
        id: id.into(),
        name: id.into(),
        condition: Condition::True,
        blocked: Blocked::Retry,
        wait: None,
        effects,
    }
}
fn routine(id: &str, effects: Vec<Effect>) -> Routine {
    Routine {
        id: id.into(),
        name: id.into(),
        character: "keeper".into(),
        order: 0,
        start: Start::Initial,
        repeat: Repeat::Finish,
        hold_conversation: true,
        steps: vec![step(&format!("{id}-step"), effects)],
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
fn world() -> Project {
    let mut p = Project::blank("Routine proof");
    p.game.id = "routine-proof".into();
    p.game.turns = Some(TurnPolicy::default());
    p.locations[0].id = "study".into();
    p.locations[0].name = "Study".into();
    p.locations[0].actions.clear();
    p.game.starting_location = "study".into();
    p.locations.push(Location {
        id: "garden".into(),
        name: "Garden".into(),
        ..Default::default()
    });
    p.locations.push(Location {
        id: "offstage".into(),
        name: "Offstage".into(),
        ..Default::default()
    });
    for id in ["keeper", "other"] {
        p.characters.push(Character {
            id: id.into(),
            name: id.into(),
            location: "study".into(),
            ..Default::default()
        });
    }
    for name in ["count", "delay", "divisor", "second"] {
        p.game.variables.insert(
            name.into(),
            Value::Integer(if name == "delay" { 2 } else { 0 }),
        );
    }
    p.game.variables.insert("ready".into(), Value::Bool(false));
    p.game.actions = vec![
        action("noop", vec![]),
        action(
            "ready",
            vec![Effect::SetVariable {
                name: "ready".into(),
                value: Value::Bool(true),
            }],
        ),
        action("delay", vec![set("delay", 10)]),
    ];
    p.game.endings.push(Ending {
        id: "finish".into(),
        name: "Finish".into(),
        text: "Finished.".into(),
        outcome: None,
    });
    p
}
fn program(r: Routine) -> Program {
    Program {
        routines: vec![r],
        ..Default::default()
    }
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
fn count(h: &Harness, name: &str) -> i32 {
    let Value::Integer(value) = h.session.state().variables[name] else {
        panic!("integer variable");
    };
    value
}
fn turn(h: &Harness) -> u32 {
    h.session.state().turns.as_ref().unwrap().turn
}
fn tick(h: &mut Harness) -> CommandResult {
    h.command("wait").unwrap()
}
fn cursor<'a>(h: &'a Harness, id: &str) -> &'a Cursor {
    h.session.state().routines.as_ref().unwrap().runs[id]
        .cursor()
        .unwrap()
}
fn control(g: &mut Program, p: &mut Project, name: &str, operation: Control, free: bool) {
    g.controls.insert(name.into(), operation);
    let mut a = action(name, vec![say(name)]);
    if free {
        a.turn_cost = Some(ActionTurnCost {
            success: TurnCost::Free,
            ..Default::default()
        });
    }
    p.game.actions.push(a);
}

#[test]
fn first_step_waits_for_first_charged_boundary() {
    let mut h = start(world(), program(routine("patrol", vec![inc("count")])));
    assert_eq!(count(&h, "count"), 0);
    for input in [
        "look",
        "help",
        "inventory",
        "unknown",
        "save checkpoint",
        "quests",
    ] {
        h.command(input).unwrap();
        assert_eq!(turn(&h), 0);
    }
    tick(&mut h);
    assert_eq!(count(&h, "count"), 1);
    assert_eq!(
        h.session.state().routines.as_ref().unwrap().runs["patrol"],
        Status::Completed
    );
    tick(&mut h);
    assert_eq!(count(&h, "count"), 1);
}

#[test]
fn two_turn_wait_occupies_two_turns_then_next_step_waits() {
    let mut r = routine("patrol", vec![inc("count")]);
    r.steps = vec![
        Step {
            wait: Some(integer(2)),
            ..step("wait-step", vec![inc("count")])
        },
        step("next-step", vec![inc("second")]),
    ];
    let mut h = start(world(), program(r));
    tick(&mut h);
    assert_eq!(cursor(&h, "patrol").wait.as_ref().unwrap().remaining, 1);
    assert_eq!(count(&h, "count"), 0);
    tick(&mut h);
    assert_eq!(count(&h, "count"), 1);
    assert_eq!(count(&h, "second"), 0);
    assert_eq!(cursor(&h, "patrol").step, "next-step");
    tick(&mut h);
    assert_eq!(count(&h, "second"), 1);
}

fn ready() -> Condition {
    Condition::Variable {
        name: "ready".into(),
        op: Comparison::Eq,
        value: Value::Bool(true),
    }
}
fn move_keeper(location: &str) -> Effect {
    Effect::MoveCharacter {
        character: "keeper".into(),
        location: location.into(),
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
fn failed(h: &mut Harness, input: &str) -> CommandResult {
    let before = h.snapshot(7);
    let offer = h.session.conversation_view().cloned();
    let question = h.session.pending_clarification();
    let (result, error) = h.attempt(input, None, true);
    assert!(error.is_some(), "expected error for {input}");
    assert_eq!(result.status, CommandStatus::Error);
    assert!(result.messages.is_empty());
    assert!(!result.state_changed);
    assert_eq!(h.snapshot(7), before);
    assert_eq!(h.session.conversation_view(), offer.as_ref());
    assert_eq!(h.session.pending_clarification(), question);
    assert!(!result.explanation.as_ref().unwrap().committed);
    result
}

#[test]
fn direct_movement_keeps_player_visits_hooks_and_carried_items_intact() {
    let mut p = world();
    p.objects.push(Object {
        id: "held".into(),
        name: "Held item".into(),
        placement: Placement::Character {
            character: "keeper".into(),
        },
        ..Default::default()
    });
    p.locations[1].triggers.push(Trigger {
        id: "player-enter".into(),
        event: Event::Enter,
        effects: vec![inc("count")],
        ..Default::default()
    });
    let mut h = start(p, program(routine("patrol", vec![move_keeper("offstage")])));
    let visits = h.session.state().visits.clone();
    tick(&mut h);
    assert_eq!(h.session.state().location, "study");
    assert_eq!(h.session.state().characters["keeper"].location, "offstage");
    assert_eq!(h.session.state().visits, visits);
    assert_eq!(
        h.session.state().objects["held"].placement,
        Placement::Character {
            character: "keeper".into()
        }
    );
    assert_eq!(count(&h, "count"), 0);
}

#[test]
fn scoped_speech_completes_silently_but_explicit_global_speech_keeps_semantics() {
    let speech = Effect::CharacterSays {
        character: "keeper".into(),
        text: "Secret line.".into(),
    };
    let mut r = routine("patrol", vec![move_keeper("offstage")]);
    r.steps.extend([
        step(
            "scoped",
            vec![Effect::If {
                condition: Condition::Visible {
                    entity: "keeper".into(),
                },
                then: vec![speech.clone()],
                otherwise: vec![],
            }],
        ),
        step("global", vec![speech]),
    ]);
    let mut h = start(world(), program(r));
    tick(&mut h);
    assert!(!output(&tick(&mut h)).contains("Secret line"));
    assert_eq!(cursor(&h, "patrol").step, "global");
    assert!(output(&tick(&mut h)).contains("Secret line"));
}

#[test]
fn live_wait_is_captured_once_and_guard_is_not_retested_after_entry() {
    let mut r = routine("patrol", vec![]);
    r.steps[0].condition = ready();
    r.steps[0].wait = Some(NumericOperand::Variable {
        name: "delay".into(),
    });
    r.steps[0].effects = vec![inc("count")];
    let mut p = world();
    p.game.actions.push(action(
        "change",
        vec![
            set("delay", 20),
            Effect::SetVariable {
                name: "ready".into(),
                value: Value::Bool(false),
            },
        ],
    ));
    let mut h = start(p, program(r));
    tick(&mut h);
    assert!(cursor(&h, "patrol").wait.is_none());
    h.command("use ready").unwrap();
    assert_eq!(
        cursor(&h, "patrol").wait.as_ref().unwrap(),
        &Waiting {
            captured: 2,
            remaining: 1
        }
    );
    h.command("use change").unwrap();
    assert_eq!(count(&h, "count"), 1);
    assert_eq!(
        h.session.state().routines.as_ref().unwrap().runs["patrol"],
        Status::Completed
    );
}

#[test]
fn nonpositive_live_wait_rolls_back_the_initiating_assignment_and_turn() {
    let mut p = world();
    p.game.actions.push(action("zero", vec![set("delay", 0)]));
    let mut r = routine("patrol", vec![inc("count")]);
    r.steps[0].wait = Some(NumericOperand::Variable {
        name: "delay".into(),
    });
    let mut h = start(p, program(r));
    assert!(
        failed(&mut h, "use zero")
            .explanation
            .unwrap()
            .error
            .unwrap()
            .contains("positive")
    );
    assert_eq!(count(&h, "delay"), 2);
    assert_eq!(turn(&h), 0);
}

#[test]
fn skip_consumes_one_step_and_pause_retries_only_after_explicit_resume() {
    for policy in [Blocked::Skip, Blocked::Pause] {
        let mut p = world();
        let mut r = routine("patrol", vec![inc("count")]);
        r.steps[0].condition = ready();
        r.steps[0].blocked = policy;
        r.steps.push(step("next", vec![inc("second")]));
        let mut g = program(r);
        control(
            &mut g,
            &mut p,
            "resume",
            Control::Resume {
                routine: "patrol".into(),
            },
            false,
        );
        let mut h = start(p, g);
        tick(&mut h);
        assert_eq!(count(&h, "count"), 0);
        assert_eq!(count(&h, "second"), 0);
        if policy == Blocked::Pause {
            assert!(matches!(
                h.session.state().routines.as_ref().unwrap().runs["patrol"],
                Status::Paused { .. }
            ));
            h.command("use ready").unwrap();
            assert!(matches!(
                h.session.state().routines.as_ref().unwrap().runs["patrol"],
                Status::Paused { .. }
            ));
            h.command("use resume").unwrap();
            assert_eq!(count(&h, "count"), 0);
            tick(&mut h);
            assert_eq!(count(&h, "count"), 1);
        }
        tick(&mut h);
        assert_eq!(count(&h, "second"), 1);
    }
}

#[test]
fn starting_free_or_spending_excludes_the_starting_input_and_survives_restore() {
    for free in [true, false] {
        let mut p = world();
        let mut r = routine("patrol", vec![inc("count")]);
        r.start = Start::Blocks;
        let mut g = program(r);
        control(
            &mut g,
            &mut p,
            "start",
            Control::Start {
                routine: "patrol".into(),
                replace: false,
            },
            free,
        );
        let mut h = start(p, g);
        let result = h.command("use start").unwrap();
        assert!(result.state_changed);
        assert_eq!(turn(&h), u32::from(!free));
        assert_eq!(cursor(&h, "patrol").after, turn(&h));
        assert_eq!(count(&h, "count"), 0);
        h.restore(&h.snapshot(7), 7).unwrap();
        assert_eq!(count(&h, "count"), 0);
        tick(&mut h);
        assert_eq!(count(&h, "count"), 1);
    }
}

#[test]
fn keep_preserves_a_paused_run_and_replacement_stops_it_explicitly() {
    let mut p = world();
    let mut patrol = routine("patrol", vec![]);
    patrol.steps[0].wait = Some(integer(5));
    let mut rest = routine("rest", vec![move_keeper("offstage")]);
    rest.start = Start::Blocks;
    rest.order = 1;
    let mut g = program(patrol);
    g.routines.push(rest);
    for (name, op) in [
        (
            "pause",
            Control::Pause {
                routine: "patrol".into(),
            },
        ),
        (
            "keep",
            Control::Start {
                routine: "rest".into(),
                replace: false,
            },
        ),
        (
            "replace",
            Control::Start {
                routine: "rest".into(),
                replace: true,
            },
        ),
    ] {
        control(&mut g, &mut p, name, op, true);
    }
    let mut h = start(p, g);
    tick(&mut h);
    h.command("use pause").unwrap();
    let paused = h.session.state().routines.as_ref().unwrap().clone();
    h.command("use keep").unwrap();
    assert_eq!(h.session.state().routines.as_ref().unwrap(), &paused);
    h.command("use replace").unwrap();
    assert_eq!(
        h.session.state().routines.as_ref().unwrap().runs["patrol"],
        Status::Stopped
    );
    assert!(matches!(
        h.session.state().routines.as_ref().unwrap().runs["rest"],
        Status::Running { .. }
    ));
    assert_eq!(h.session.state().characters["keeper"].location, "study");
    tick(&mut h);
    assert_eq!(h.session.state().characters["keeper"].location, "offstage");
}

#[test]
fn controls_for_another_definition_never_pause_resume_or_stop_current_run() {
    let mut p = world();
    let mut r = routine("patrol", vec![]);
    r.repeat = Repeat::Loop;
    let mut other = routine("rest", vec![]);
    other.start = Start::Blocks;
    other.order = 1;
    let mut g = program(r);
    g.routines.push(other);
    for (name, op) in [
        (
            "pause",
            Control::Pause {
                routine: "rest".into(),
            },
        ),
        (
            "resume",
            Control::Resume {
                routine: "rest".into(),
            },
        ),
        (
            "stop",
            Control::Stop {
                routine: "rest".into(),
            },
        ),
    ] {
        control(&mut g, &mut p, name, op, true);
    }
    let mut h = start(p, g);
    let before = h.session.state().routines.as_ref().unwrap().clone();
    for name in ["pause", "resume", "stop"] {
        h.command(&format!("use {name}")).unwrap();
        assert_eq!(h.session.state().routines.as_ref().unwrap(), &before);
    }
}

#[test]
fn self_pause_consumes_effects_before_resume_without_repeating_rewards() {
    let mut p = world();
    let mut r = routine(
        "patrol",
        vec![inc("count"), say("pause-self"), inc("second")],
    );
    r.steps.push(step("next", vec![inc("count")]));
    let mut g = program(r);
    g.controls.insert(
        "pause-self".into(),
        Control::Pause {
            routine: "patrol".into(),
        },
    );
    control(
        &mut g,
        &mut p,
        "resume",
        Control::Resume {
            routine: "patrol".into(),
        },
        false,
    );
    let mut h = start(p, g);
    tick(&mut h);
    assert!(matches!(
        h.session.state().routines.as_ref().unwrap().runs["patrol"],
        Status::Paused { .. }
    ));
    assert_eq!(cursor(&h, "patrol").step, "next");
    assert_eq!((count(&h, "count"), count(&h, "second")), (1, 1));
    h.command("use resume").unwrap();
    assert_eq!(count(&h, "count"), 1);
    tick(&mut h);
    assert_eq!((count(&h, "count"), count(&h, "second")), (2, 1));
}

#[test]
fn self_replacement_invalidates_old_completion_and_does_not_execute_twice() {
    let mut r = routine("patrol", vec![inc("count"), say("replace-self")]);
    r.steps.push(step("old-tail", vec![inc("second")]));
    let mut g = program(r);
    g.controls.insert(
        "replace-self".into(),
        Control::Start {
            routine: "patrol".into(),
            replace: true,
        },
    );
    let mut h = start(world(), g);
    for expected in 1..=3 {
        tick(&mut h);
        assert_eq!(count(&h, "count"), expected);
        assert_eq!(count(&h, "second"), 0);
        assert_eq!(cursor(&h, "patrol").step, "patrol-step");
    }
}

#[test]
fn ordinary_stop_ends_the_step_flow_and_advances_on_a_later_turn() {
    let mut r = routine("patrol", vec![inc("count"), Effect::Stop, inc("second")]);
    r.steps.push(step("next", vec![inc("second")]));
    let mut h = start(world(), program(r));
    tick(&mut h);
    assert_eq!((count(&h, "count"), count(&h, "second")), (1, 0));
    tick(&mut h);
    assert_eq!(count(&h, "second"), 1);
}

#[test]
fn two_characters_follow_persisted_order_instead_of_ids_or_load_order() {
    let mut first = routine("z-first", vec![say("FIRST")]);
    first.order = 2;
    let mut second = routine("a-second", vec![say("SECOND")]);
    second.character = "other".into();
    second.order = 10;
    let g = Program {
        routines: vec![second, first],
        ..Default::default()
    };
    let mut h = start(
        world(),
        serde_json::from_slice(&serde_json::to_vec(&g).unwrap()).unwrap(),
    );
    let output = output(&tick(&mut h));
    assert!(output.find("FIRST").unwrap() < output.find("SECOND").unwrap());
}

#[test]
fn earlier_pause_resume_invalidates_later_candidate_and_defers_it() {
    let mut p = world();
    let first = routine("first", vec![say("pause-later"), say("resume-later")]);
    let mut later = routine("later", vec![inc("count")]);
    later.order = 1;
    later.character = "other".into();
    let mut g = program(first);
    g.routines.push(later);
    g.controls.insert(
        "pause-later".into(),
        Control::Pause {
            routine: "later".into(),
        },
    );
    g.controls.insert(
        "resume-later".into(),
        Control::Resume {
            routine: "later".into(),
        },
    );
    control(
        &mut g,
        &mut p,
        "resume",
        Control::Resume {
            routine: "later".into(),
        },
        true,
    );
    let mut h = start(p, g);
    tick(&mut h);
    assert_eq!(count(&h, "count"), 0);
    assert_eq!(cursor(&h, "later").after, 1);
    tick(&mut h);
    assert_eq!(count(&h, "count"), 1);
}

fn add_timer(p: &mut Project, body: Vec<Effect>) {
    p.timers.push(ScheduledTrigger {
        id: "callback".into(),
        name: "Callback".into(),
        order: 0,
        priority: 0,
        condition: Condition::True,
        effects: body,
    });
    p.game.actions.push(action(
        "schedule",
        vec![Effect::ScheduleTimer {
            timer: "callback".into(),
            after: integer(1),
            pending: TimerPendingPolicy::Restart,
        }],
    ));
}

#[test]
fn due_timers_update_guards_before_routine_attempts() {
    let mut p = world();
    add_timer(
        &mut p,
        vec![Effect::SetVariable {
            name: "ready".into(),
            value: Value::Bool(true),
        }],
    );
    let mut r = routine("patrol", vec![inc("count")]);
    r.steps[0].condition = ready();
    let mut h = start(p, program(r));
    h.command("use schedule").unwrap();
    assert_eq!(count(&h, "count"), 0);
    tick(&mut h);
    assert_eq!(count(&h, "count"), 1);
}

#[test]
fn timer_started_routine_waits_for_a_later_turn() {
    let mut p = world();
    add_timer(&mut p, vec![say("timer-start")]);
    let mut r = routine("patrol", vec![inc("count")]);
    r.start = Start::Blocks;
    let mut g = program(r);
    g.controls.insert(
        "timer-start".into(),
        Control::Start {
            routine: "patrol".into(),
            replace: false,
        },
    );
    let mut h = start(p, g);
    h.command("use schedule").unwrap();
    tick(&mut h);
    assert_eq!(cursor(&h, "patrol").after, 2);
    assert_eq!(count(&h, "count"), 0);
    tick(&mut h);
    assert_eq!(count(&h, "count"), 1);
}

#[test]
fn routines_schedule_native_timers_with_real_step_lexical_sources() {
    let mut p = world();
    add_timer(&mut p, vec![inc("second")]);
    let r = routine(
        "patrol",
        vec![Effect::ScheduleTimer {
            timer: "callback".into(),
            after: integer(2),
            pending: TimerPendingPolicy::Restart,
        }],
    );
    let mut h = start(p, program(r));
    tick(&mut h);
    let pending = &h.session.state().turns.as_ref().unwrap().pending["callback"];
    assert_eq!(pending.deadline, 3);
    assert_eq!(pending.source.root, "patrol-step");
    assert_eq!(pending.source.subject, "patrol-step");
    assert_eq!(pending.source.path, "effects.0");
    h.session
        .definition()
        .validate_state(h.session.state())
        .unwrap();
    tick(&mut h);
    assert_eq!(count(&h, "second"), 0);
    tick(&mut h);
    assert_eq!(count(&h, "second"), 1);
}

#[test]
fn conditional_start_is_once_only_and_excludes_the_matching_input() {
    let mut r = routine("patrol", vec![inc("count")]);
    r.start = Start::When { condition: ready() };
    let mut h = start(world(), program(r));
    assert!(h.session.state().routines.as_ref().unwrap().runs.is_empty());
    h.command("use ready").unwrap();
    assert_eq!(count(&h, "count"), 0);
    assert_eq!(cursor(&h, "patrol").after, 1);
    tick(&mut h);
    assert_eq!(count(&h, "count"), 1);
    for _ in 0..4 {
        tick(&mut h);
    }
    assert_eq!(count(&h, "count"), 1);
    h.restore(&h.snapshot(7), 7).unwrap();
    tick(&mut h);
    assert_eq!(count(&h, "count"), 1);
}

#[test]
fn conditional_start_at_startup_arms_without_effects() {
    let mut r = routine("patrol", vec![inc("count")]);
    r.start = Start::When {
        condition: Condition::True,
    };
    let mut h = start(world(), program(r));
    assert_eq!(count(&h, "count"), 0);
    assert_eq!(cursor(&h, "patrol").after, 0);
    tick(&mut h);
    assert_eq!(count(&h, "count"), 1);
}

#[test]
fn conditional_start_never_preempts_an_active_run() {
    let mut p = world();
    p.game.triggers.push(Trigger {
        id: "start-rest".into(),
        event: Event::Start,
        effects: vec![say("rest-start")],
        ..Default::default()
    });
    let mut auto = routine("auto", vec![inc("count")]);
    auto.start = Start::When { condition: ready() };
    let mut rest = routine("rest", vec![]);
    rest.start = Start::Blocks;
    rest.order = 1;
    rest.steps = vec![
        Step {
            wait: Some(integer(2)),
            ..step("rest-wait", vec![])
        },
        step("rest-end", vec![]),
    ];
    let mut g = program(auto);
    g.routines.push(rest);
    g.controls.insert(
        "rest-start".into(),
        Control::Start {
            routine: "rest".into(),
            replace: false,
        },
    );
    let mut h = start(p, g);
    h.command("use ready").unwrap();
    assert!(
        !h.session
            .state()
            .routines
            .as_ref()
            .unwrap()
            .runs
            .contains_key("auto")
    );
    tick(&mut h);
    tick(&mut h);
    assert_eq!(
        h.session.state().routines.as_ref().unwrap().runs["rest"],
        Status::Completed
    );
    tick(&mut h);
    assert_eq!(count(&h, "count"), 0);
    assert_eq!(cursor(&h, "auto").after, 4);
    tick(&mut h);
    assert_eq!(count(&h, "count"), 1);
}

#[test]
fn explicit_start_and_stop_consume_automatic_activation_without_rearming() {
    let mut p = world();
    let mut r = routine("patrol", vec![inc("count")]);
    r.start = Start::When { condition: ready() };
    let mut g = program(r);
    control(
        &mut g,
        &mut p,
        "start",
        Control::Start {
            routine: "patrol".into(),
            replace: false,
        },
        true,
    );
    control(
        &mut g,
        &mut p,
        "stop",
        Control::Stop {
            routine: "patrol".into(),
        },
        true,
    );
    let mut h = start(p, g);
    h.command("use start").unwrap();
    h.command("use stop").unwrap();
    h.command("use ready").unwrap();
    assert_eq!(
        h.session.state().routines.as_ref().unwrap().runs["patrol"],
        Status::Stopped
    );
    assert_eq!(count(&h, "count"), 0);
    h.command("use start").unwrap();
    tick(&mut h);
    assert_eq!(count(&h, "count"), 1);
}

#[test]
fn while_and_until_check_after_last_step_effects_and_never_chain_cycles() {
    for (repeat, expected_running) in [
        (Repeat::While { condition: ready() }, true),
        (Repeat::Until { condition: ready() }, false),
        (
            Repeat::While {
                condition: Condition::False,
            },
            false,
        ),
        (
            Repeat::Until {
                condition: Condition::False,
            },
            true,
        ),
    ] {
        let mut r = routine(
            "patrol",
            vec![
                inc("count"),
                Effect::SetVariable {
                    name: "ready".into(),
                    value: Value::Bool(true),
                },
            ],
        );
        r.repeat = repeat;
        let mut h = start(world(), program(r));
        tick(&mut h);
        assert_eq!(count(&h, "count"), 1);
        assert_eq!(
            matches!(
                h.session.state().routines.as_ref().unwrap().runs["patrol"],
                Status::Running { .. }
            ),
            expected_running
        );
        tick(&mut h);
        assert_eq!(count(&h, "count"), if expected_running { 2 } else { 1 });
    }
}

#[test]
fn until_does_not_interrupt_a_wait_mid_cycle() {
    let mut r = routine("patrol", vec![inc("count")]);
    r.repeat = Repeat::Until { condition: ready() };
    r.steps[0].wait = Some(integer(3));
    let mut h = start(world(), program(r));
    tick(&mut h);
    h.command("use ready").unwrap();
    assert_eq!(cursor(&h, "patrol").wait.as_ref().unwrap().remaining, 1);
    assert_eq!(count(&h, "count"), 0);
    tick(&mut h);
    assert_eq!(count(&h, "count"), 1);
    assert_eq!(
        h.session.state().routines.as_ref().unwrap().runs["patrol"],
        Status::Completed
    );
}

#[test]
fn late_failure_rolls_back_action_prior_routine_world_progress_and_output() {
    let mut p = world();
    p.game
        .actions
        .push(action("mutate", vec![set("delay", 99)]));
    let first = routine("first", vec![inc("count"), say("Discard this line.")]);
    let mut later = routine("later", vec![move_keeper("offstage"), broken()]);
    later.character = "other".into();
    later.order = 1;
    let mut g = program(first);
    g.routines.push(later);
    let mut h = start(p, g);
    let result = failed(&mut h, "use mutate");
    assert!(
        result
            .explanation
            .unwrap()
            .discarded_messages
            .iter()
            .any(|m| text::plain(m).contains("Discard"))
    );
    assert_eq!(count(&h, "delay"), 2);
    assert_eq!(count(&h, "count"), 0);
    assert_eq!(turn(&h), 0);
}

#[test]
fn native_operation_budget_bounds_step_effects_and_rolls_back() {
    let r = routine("patrol", (0..2200).map(|_| inc("count")).collect());
    let mut h = start(world(), program(r));
    assert!(
        failed(&mut h, "wait")
            .explanation
            .unwrap()
            .error
            .unwrap()
            .contains("operations")
    );
    assert_eq!(count(&h, "count"), 0);
}

#[test]
fn native_watch_depth_budget_is_shared_with_routine_effects() {
    let mut p = world();
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
    let mut h = start(p, program(routine("patrol", vec![inc("count")])));
    assert!(
        failed(&mut h, "wait")
            .explanation
            .unwrap()
            .error
            .unwrap()
            .contains("nested")
    );
}

#[test]
fn public_restore_preserves_captured_wait_without_replay() {
    for version in [7, 5] {
        let mut r = routine("patrol", vec![inc("count"), say("Wait finished once.")]);
        r.steps[0].wait = Some(integer(3));
        let mut h = start(world(), program(r));
        tick(&mut h);
        let saved = h.snapshot(version);
        let before = h.session.state().clone();
        h.restore(&saved, version).unwrap();
        assert_eq!(h.session.state(), &before);
        assert_eq!(cursor(&h, "patrol").wait.as_ref().unwrap().remaining, 2);
        assert!(
            !output(
                &h.session
                    .resume_messages()
                    .map(|messages| CommandResult {
                        messages,
                        ..Default::default()
                    })
                    .unwrap()
            )
            .contains("Wait finished once")
        );
        tick(&mut h);
        assert_eq!(count(&h, "count"), 0);
        assert!(output(&tick(&mut h)).contains("Wait finished once"));
        assert_eq!(count(&h, "count"), 1);
    }
}

#[test]
fn malformed_saved_progress_rejects_without_mutating_world_or_bytes() {
    let mut r = routine("patrol", vec![inc("count")]);
    r.steps[0].wait = Some(integer(3));
    let mut h = start(world(), program(r));
    tick(&mut h);
    let good = h.snapshot(7);
    let original: serde_json::Value = serde_json::from_slice(&good).unwrap();
    for change in [0, 1, 2, 3, 4, 5, 6] {
        let mut value = original.clone();
        match change {
            0 => {
                value["world"]["routines"]["runs"]["patrol"]["cursor"]["step"] =
                    "foreign-step".into()
            }
            1 => value["world"]["routines"]["runs"]["patrol"]["cursor"]["after"] = 2.into(),
            2 => {
                value["world"]["routines"]["runs"]["patrol"]["cursor"]["wait"]["remaining"] =
                    0.into()
            }
            3 => {
                value["world"]["routines"]["runs"]["patrol"]["cursor"]["wait"]["remaining"] =
                    3.into()
            }
            4 => {
                value["world"]["routines"]["runs"]["foreign"] =
                    serde_json::json!({"type":"stopped"})
            }
            5 => value["world"]["routines"]["runs"]["patrol"]["surprise"] = true.into(),
            _ => value["version"] = 99.into(),
        }
        let bytes = serde_json::to_vec(&value).unwrap();
        let retained = bytes.clone();
        assert!(h.restore(&bytes, 7).is_err(), "mutation {change}");
        assert_eq!(bytes, retained);
        assert_eq!(h.snapshot(7), good);
    }
    let duplicate = r#"{"runs":{"patrol":{"type":"stopped"},"patrol":{"type":"completed"}}}"#;
    assert!(serde_json::from_str::<Progress>(duplicate).is_err());
}

#[test]
fn state_rejects_multiple_active_runs_for_a_character_and_ended_work() {
    let mut p = world();
    let mut other = routine("rest", vec![]);
    other.start = Start::Blocks;
    other.order = 1;
    let mut g = program(routine("patrol", vec![]));
    g.routines.push(other);
    control(
        &mut g,
        &mut p,
        "rest",
        Control::Start {
            routine: "rest".into(),
            replace: true,
        },
        true,
    );
    let mut h = start(p, g);
    let mut progress = h.session.state().routines.as_ref().unwrap().clone();
    progress.runs.insert(
        "rest".into(),
        Status::Running {
            cursor: Cursor {
                step: "rest-step".into(),
                after: 0,
                wait: None,
            },
        },
    );
    let mut invalid = h.session.state().clone();
    invalid.routines = Some(progress);
    assert!(h.session.definition().validate_state(&invalid).is_err());
    let mut ended = h.session.state().clone();
    ended.ending = Some("finish".into());
    assert!(h.session.definition().validate_state(&ended).is_err());
    h.command("use rest").unwrap();
}

#[test]
fn definition_validation_rejects_bad_ownership_order_counts_waits_and_scope() {
    let g = program(routine("patrol", vec![]));
    for mutation in 0..8 {
        let mut invalid = g.clone();
        match mutation {
            0 => invalid.routines[0].character = "missing".into(),
            1 => invalid.routines[0].steps.clear(),
            2 => invalid.routines[0].steps[0].wait = Some(integer(0)),
            3 => {
                invalid.routines[0].steps[0].wait = Some(NumericOperand::Input {
                    input: "unbound".into(),
                })
            }
            4 => {
                let mut duplicate = invalid.routines[0].clone();
                duplicate.id = "duplicate".into();
                duplicate.steps[0].id = "duplicate-step".into();
                duplicate.character = "other".into();
                invalid.routines.push(duplicate);
            }
            5 => {
                let duplicate = invalid.routines[0].steps[0].clone();
                invalid.routines[0].steps.push(duplicate);
            }
            6 => {
                invalid.routines[0].steps = (0..=STEP_LIMIT)
                    .map(|n| step(&format!("s{n}"), vec![]))
                    .collect()
            }
            _ => {
                let mut duplicate = invalid.routines[0].clone();
                duplicate.id = "duplicate".into();
                duplicate.steps[0].id = "duplicate-step".into();
                duplicate.order = 1;
                invalid.routines.push(duplicate);
            }
        }
        assert!(
            Harness::start(world(), invalid).is_err(),
            "mutation {mutation}"
        );
    }
}

#[test]
fn native_clock_overflow_does_not_advance_or_corrupt_routine_progress() {
    let mut h = start(world(), program(routine("patrol", vec![inc("count")])));
    let mut state = h.session.state().clone();
    state.turns.as_mut().unwrap().turn = u32::MAX;
    h.session.replace_state(state).unwrap();
    failed(&mut h, "wait");
    assert_eq!(count(&h, "count"), 0);
}

fn conversation(p: &mut Project, terminal: bool) {
    p.conversations.push(Conversation {
        id: "encounter".into(),
        name: "Keeper encounter".into(),
        character: "keeper".into(),
        default_entry: "greeting".into(),
        nodes: vec![
            ConversationNode {
                id: "greeting".into(),
                name: "Greeting".into(),
                text: "Can I help?".into(),
                terminal,
                replies: if terminal {
                    vec![]
                } else {
                    vec![ConversationReply {
                        id: "finish-reply".into(),
                        text: "Thank you.".into(),
                        destination: Some("farewell".into()),
                        ..Default::default()
                    }]
                },
                ..Default::default()
            },
            ConversationNode {
                id: "farewell".into(),
                name: "Farewell".into(),
                text: "Goodbye.".into(),
                terminal: true,
                ..Default::default()
            },
        ],
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
}

#[test]
fn opening_and_terminal_reply_hold_the_speaker_for_the_whole_input() {
    let mut p = world();
    conversation(&mut p, false);
    let mut h = start(p, program(routine("patrol", vec![move_keeper("garden")])));
    h.command("talk").unwrap();
    assert_eq!(h.session.state().characters["keeper"].location, "study");
    assert!(h.session.conversation_view().is_some());
    h.command("1").unwrap();
    assert!(h.session.conversation_view().is_none());
    assert_eq!(h.session.state().characters["keeper"].location, "study");
    tick(&mut h);
    assert_eq!(h.session.state().characters["keeper"].location, "garden");
}

#[test]
fn terminal_opening_still_holds_the_speaker_for_that_turn() {
    let mut p = world();
    conversation(&mut p, true);
    let mut h = start(p, program(routine("patrol", vec![move_keeper("garden")])));
    h.command("talk").unwrap();
    assert!(h.session.conversation_view().is_none());
    assert_eq!(h.session.state().characters["keeper"].location, "study");
    tick(&mut h);
    assert_eq!(h.session.state().characters["keeper"].location, "garden");
}

#[test]
fn reply_selection_api_and_stale_replies_use_the_native_clock_classification() {
    let mut p = world();
    conversation(&mut p, false);
    let mut h = start(p, program(routine("patrol", vec![inc("count")])));
    h.command("talk").unwrap();
    let offer = h.session.conversation_view().unwrap().clone();
    let (rejected, error) = h.attempt("[selected reply]", Some(("stale", "finish-reply")), true);
    assert!(error.is_none());
    assert_eq!(rejected.status, CommandStatus::Unmatched);
    assert_eq!(turn(&h), 1);
    assert_eq!(count(&h, "count"), 0);
    let (accepted, error) = h.attempt(
        "[selected reply]",
        Some((&offer.offer_token, "finish-reply")),
        true,
    );
    assert!(error.is_none());
    assert_eq!(accepted.status, CommandStatus::Ok);
    assert_eq!(turn(&h), 2);
    assert_eq!(count(&h, "count"), 0);
    tick(&mut h);
    assert_eq!(count(&h, "count"), 1);
}

#[test]
fn conversation_and_manual_pause_independently_preserve_a_wait_remainder() {
    let mut p = world();
    conversation(&mut p, false);
    let mut r = routine("patrol", vec![inc("count")]);
    r.steps[0].wait = Some(integer(3));
    let mut g = program(r);
    control(
        &mut g,
        &mut p,
        "pause",
        Control::Pause {
            routine: "patrol".into(),
        },
        true,
    );
    control(
        &mut g,
        &mut p,
        "resume",
        Control::Resume {
            routine: "patrol".into(),
        },
        true,
    );
    let mut h = start(p, g);
    tick(&mut h);
    assert_eq!(cursor(&h, "patrol").wait.as_ref().unwrap().remaining, 2);
    h.command("talk").unwrap();
    tick(&mut h);
    assert_eq!(cursor(&h, "patrol").wait.as_ref().unwrap().remaining, 2);
    h.command("use pause").unwrap();
    h.command("bye").unwrap();
    assert!(matches!(
        h.session.state().routines.as_ref().unwrap().runs["patrol"],
        Status::Paused { .. }
    ));
    h.restore(&h.snapshot(5), 5).unwrap();
    h.command("use resume").unwrap();
    assert_eq!(cursor(&h, "patrol").wait.as_ref().unwrap().remaining, 2);
    tick(&mut h);
    assert_eq!(cursor(&h, "patrol").wait.as_ref().unwrap().remaining, 1);
    tick(&mut h);
    assert_eq!(count(&h, "count"), 1);
}

#[test]
fn opt_out_movement_interrupts_dialogue_using_existing_checkpoints() {
    let mut p = world();
    conversation(&mut p, false);
    let mut r = routine("patrol", vec![move_keeper("garden")]);
    r.hold_conversation = false;
    let mut h = start(p, program(r));
    h.command("talk").unwrap();
    assert_eq!(h.session.state().characters["keeper"].location, "garden");
    assert!(h.session.state().narrative.active.is_none());
    assert!(h.session.conversation_view().is_none());
    assert!(matches!(
        h.session.state().narrative.conversations["encounter"].checkpoint,
        Some(ConversationCheckpoint::Entered { .. })
    ));
}

#[test]
fn conversation_started_by_an_earlier_routine_holds_a_later_character() {
    let mut p = world();
    conversation(&mut p, false);
    let mut first = routine(
        "first",
        vec![Effect::StartConversation {
            conversation: "encounter".into(),
        }],
    );
    first.character = "other".into();
    let mut later = routine("later", vec![move_keeper("garden")]);
    later.order = 1;
    let mut g = program(first);
    g.routines.push(later);
    let mut h = start(p, g);
    tick(&mut h);
    assert_eq!(h.session.state().characters["keeper"].location, "study");
    assert!(h.session.conversation_view().is_some());
}

#[test]
fn timer_started_terminal_dialogue_holds_a_routine_even_after_it_closes() {
    let mut p = world();
    conversation(&mut p, true);
    add_timer(
        &mut p,
        vec![
            Effect::SetVariable {
                name: "ready".into(),
                value: Value::Bool(true),
            },
            Effect::StartConversation {
                conversation: "encounter".into(),
            },
        ],
    );
    let mut r = routine("patrol", vec![move_keeper("garden")]);
    r.steps[0].condition = ready();
    let mut h = start(p, program(r));
    h.command("use schedule").unwrap();
    tick(&mut h);
    assert!(h.session.conversation_view().is_none());
    assert_eq!(h.session.state().characters["keeper"].location, "study");
    tick(&mut h);
    assert_eq!(h.session.state().characters["keeper"].location, "garden");
}

#[test]
fn late_routine_error_preserves_conversation_offer_and_reply_history() {
    let mut p = world();
    conversation(&mut p, false);
    let mut r = routine("patrol", vec![broken()]);
    r.hold_conversation = false;
    r.steps[0].condition = ready();
    let mut h = start(p, program(r));
    h.command("talk").unwrap();
    let before = h.session.conversation_view().unwrap().clone();
    failed(&mut h, "use ready");
    assert_eq!(h.session.conversation_view(), Some(&before));
    assert!(
        h.session.state().narrative.conversations["encounter"]
            .chosen
            .is_empty()
    );
}

#[test]
fn ending_clears_work_before_hooks_and_cannot_revive_a_routine() {
    let mut p = world();
    let mut first = routine(
        "first",
        vec![Effect::End {
            ending: "finish".into(),
        }],
    );
    first.character = "other".into();
    let mut later = routine("later", vec![inc("count")]);
    later.order = 1;
    let mut g = program(first);
    g.routines.push(later);
    g.controls.insert(
        "revive".into(),
        Control::Start {
            routine: "later".into(),
            replace: true,
        },
    );
    g.queries
        .insert("routine_running".into(), ("later".into(), Query::Running));
    p.game.triggers.push(Trigger {
        id: "ending-hook".into(),
        event: Event::Ending,
        effects: vec![
            Effect::If {
                condition: Condition::Variable {
                    name: "routine_running".into(),
                    op: Comparison::Eq,
                    value: Value::Bool(true),
                },
                then: vec![inc("count")],
                otherwise: vec![inc("second")],
            },
            say("revive"),
        ],
        ..Default::default()
    });
    let mut h = start(p, g);
    tick(&mut h);
    assert_eq!(count(&h, "count"), 0);
    assert_eq!(count(&h, "second"), 1);
    assert!(
        h.session
            .state()
            .routines
            .as_ref()
            .unwrap()
            .runs
            .values()
            .all(|s| s.cursor().is_none())
    );
    h.restore(&h.snapshot(7), 7).unwrap();
    assert_eq!(h.command("wait").unwrap().status, CommandStatus::Ended);
}

#[test]
fn ending_hook_failure_rolls_back_the_ending_and_all_routine_statuses() {
    let mut p = world();
    p.game.triggers.push(Trigger {
        id: "ending-fails".into(),
        event: Event::Ending,
        effects: vec![broken()],
        ..Default::default()
    });
    let mut h = start(
        p,
        program(routine(
            "patrol",
            vec![Effect::End {
                ending: "finish".into(),
            }],
        )),
    );
    failed(&mut h, "wait");
    assert!(h.session.state().ending.is_none());
    assert!(matches!(
        h.session.state().routines.as_ref().unwrap().runs["patrol"],
        Status::Running { .. }
    ));
}

#[test]
fn response_and_call_progress_are_independent_between_steps_and_survive_restart() {
    let mut p = world();
    p.procedures.push(Procedure {
        id: "shared".into(),
        name: "Shared response".into(),
        description: String::new(),
        inputs: vec![],
        effects: vec![Effect::Respond {
            id: "shared-sequence".into(),
            responses: vec!["First.".into(), "Next.".into()],
            mode: SequenceMode::Fallback,
            fallback: "Done.".into(),
            exhaustion: ExhaustionMode::Once,
            on_exhausted: vec![inc("count")],
        }],
    });
    let call = |id: &str| Effect::Call {
        id: id.into(),
        procedure: "shared".into(),
        arguments: BTreeMap::new(),
    };
    let mut first = routine("first", vec![call("call-first")]);
    first.repeat = Repeat::Loop;
    let mut later = routine("later", vec![call("call-later")]);
    later.character = "other".into();
    later.order = 1;
    later.repeat = Repeat::Loop;
    let mut g = program(first);
    g.routines.push(later);
    control(
        &mut g,
        &mut p,
        "restart",
        Control::Start {
            routine: "first".into(),
            replace: true,
        },
        true,
    );
    let mut h = start(p, g);
    assert_eq!(output(&tick(&mut h)).matches("First.").count(), 2);
    h.restore(&h.snapshot(7), 7).unwrap();
    h.command("use restart").unwrap();
    assert_eq!(output(&tick(&mut h)).matches("Next.").count(), 2);
    assert_eq!(h.session.state().procedure_sequences.len(), 2);
    tick(&mut h);
    assert_eq!(count(&h, "count"), 2);
}

#[test]
fn typed_procedure_bindings_and_wait_property_operands_use_native_rules() {
    let mut p = world();
    p.characters[0]
        .state
        .insert("delay".into(), Value::Integer(2));
    p.procedures.push(Procedure {
        id: "award".into(),
        name: "Award".into(),
        description: String::new(),
        inputs: vec![ProcedureInput {
            id: "amount".into(),
            name: "Amount".into(),
            kind: InputKind::Integer,
            required_properties: BTreeMap::new(),
        }],
        effects: vec![Effect::UpdateVariable {
            name: "count".into(),
            op: ArithmeticOperation::Add,
            operand: NumericOperand::Input {
                input: "amount".into(),
            },
        }],
    });
    let mut r = routine(
        "patrol",
        vec![Effect::Call {
            id: "award-call".into(),
            procedure: "award".into(),
            arguments: [(
                "amount".into(),
                Argument::Literal {
                    value: Value::Integer(4),
                },
            )]
            .into(),
        }],
    );
    r.steps[0].wait = Some(NumericOperand::Property {
        entity: "keeper".into(),
        name: "delay".into(),
    });
    let mut h = start(p, program(r));
    tick(&mut h);
    assert_eq!(count(&h, "count"), 0);
    tick(&mut h);
    assert_eq!(count(&h, "count"), 4);
}

#[test]
fn normal_and_explained_execution_commit_identical_world_and_routine_progress() {
    let mut r = routine("patrol", vec![inc("count"), move_keeper("garden")]);
    r.steps[0].wait = Some(integer(2));
    r.repeat = Repeat::Until { condition: ready() };
    let p = world();
    let g = program(r);
    let mut normal = start(p.clone(), g.clone());
    let mut explained = start(p, g);
    for input in ["look", "use noop", "wait", "wait", "use ready", "wait"] {
        let a = normal.command(input).unwrap();
        let (b, e) = explained.attempt(input, None, true);
        assert!(e.is_none());
        assert_eq!(a.messages, b.messages);
        assert_eq!(a.status, b.status);
        assert_eq!(a.state_changed, b.state_changed);
        assert_eq!(normal.session.state(), explained.session.state());
        assert_eq!(
            normal.session.state().routines.as_ref().unwrap(),
            explained.session.state().routines.as_ref().unwrap()
        );
    }
}

#[test]
fn noun_clarification_and_wait_keep_native_context_and_charge_once_on_selection() {
    let mut p = world();
    for id in ["brass", "silver"] {
        p.objects.push(Object {
            id: id.into(),
            name: format!("{id} key"),
            aliases: vec!["key".into()],
            portable: true,
            placement: Placement::Location {
                location: "study".into(),
            },
            actions: vec![Action {
                id: format!("take-{id}"),
                verb: "take".into(),
                pattern: vec![PatternPart::Entity { entity: id.into() }],
                effects: vec![Effect::Give { object: id.into() }],
                ..Default::default()
            }],
            ..Default::default()
        });
    }
    let mut r = routine("patrol", vec![inc("count")]);
    r.repeat = Repeat::Loop;
    let mut h = start(p, program(r));
    h.command("take key").unwrap();
    assert!(h.session.pending_clarification().is_some());
    assert_eq!(turn(&h), 0);
    tick(&mut h);
    assert!(h.session.pending_clarification().is_some());
    assert_eq!(count(&h, "count"), 1);
    h.command("brass").unwrap();
    assert_eq!(turn(&h), 2);
    assert_eq!(count(&h, "count"), 2);
    assert!(h.session.pending_clarification().is_none());
}

#[test]
fn routine_status_queries_are_read_only_and_distinguish_manual_pause_from_blocking() {
    let mut p = world();
    let mut r = routine("patrol", vec![]);
    r.steps[0].condition = Condition::False;
    let mut g = program(r);
    g.queries
        .insert("is_running".into(), ("patrol".into(), Query::Running));
    g.queries
        .insert("is_paused".into(), ("patrol".into(), Query::Paused));
    p.game.actions.push(action(
        "inspect-status",
        vec![Effect::If {
            condition: Condition::Variable {
                name: "is_running".into(),
                op: Comparison::Eq,
                value: Value::Bool(true),
            },
            then: vec![say("RUNNING")],
            otherwise: vec![],
        }],
    ));
    control(
        &mut g,
        &mut p,
        "pause",
        Control::Pause {
            routine: "patrol".into(),
        },
        true,
    );
    let mut h = start(p, g);
    tick(&mut h);
    assert!(output(&h.command("use inspect-status").unwrap()).contains("RUNNING"));
    h.command("use pause").unwrap();
    assert!(matches!(
        h.session.state().routines.as_ref().unwrap().runs["patrol"],
        Status::Paused { .. }
    ));
}

#[test]
fn decoded_program_and_new_native_definition_resume_the_same_snapshot() {
    let mut r = routine("patrol", vec![inc("count")]);
    r.steps[0].wait = Some(integer(3));
    let p = world();
    let g = program(r);
    let mut first = start(p.clone(), g.clone());
    tick(&mut first);
    let saved = first.snapshot(7);
    let decoded: Program = serde_json::from_slice(&serde_json::to_vec(&g).unwrap()).unwrap();
    let mut second = start(
        serde_json::from_slice(&serde_json::to_vec(&p).unwrap()).unwrap(),
        decoded,
    );
    second.restore(&saved, 7).unwrap();
    assert_eq!(first.session.state(), second.session.state());
    assert_eq!(
        first.session.state().routines.as_ref().unwrap(),
        second.session.state().routines.as_ref().unwrap()
    );
    for _ in 0..2 {
        tick(&mut first);
        tick(&mut second);
    }
    assert_eq!(first.session.state(), second.session.state());
    assert_eq!(
        first.session.state().routines.as_ref().unwrap(),
        second.session.state().routines.as_ref().unwrap()
    );
    assert_eq!(count(&second, "count"), 1);
}

#[test]
fn native_views_and_typed_observations_report_wait_guard_pause_and_source() {
    use luna_core::{RoutineOperation, TraceKind};
    let mut r = routine("patrol", vec![inc("count")]);
    r.steps[0].wait = Some(integer(3));
    let mut h = start(world(), program(r));
    let result = h.session.command_explained("wait");
    assert_eq!(result.routines, h.session.routine_view());
    assert_eq!(
        result.routines[0].wait,
        Some(RoutineWait {
            captured: 3,
            remaining: 2
        })
    );
    assert_eq!(result.routines[0].blocked, None);
    let explanation = result.explanation.unwrap();
    assert!(explanation.steps.iter().any(|s| {
        matches!(
            &s.kind,
            TraceKind::Routine {
                operation: RoutineOperation::Wait {
                    captured: 3,
                    remaining: 2,
                    ..
                }
            }
        ) && s
            .source
            .as_ref()
            .is_some_and(|s| s.subject == "patrol-step" && s.path == "wait")
    }));
    assert!(
        explanation
            .changes
            .iter()
            .any(|c| c.path.first().is_some_and(|s| s == "routines"))
    );
    let mut state = h.session.state().clone();
    let cursor = state.routines.as_ref().unwrap().runs["patrol"]
        .cursor()
        .unwrap()
        .clone();
    state
        .routines
        .as_mut()
        .unwrap()
        .runs
        .insert("patrol".into(), RoutineRun::Paused { cursor });
    h.session.replace_state(state).unwrap();
    assert_eq!(h.session.routine_view()[0].status, RoutineStatus::Paused);
    let before = h.session.state().clone();
    h.session.routine_view();
    assert_eq!(h.session.state(), &before);
}

#[test]
fn routines_require_format_seven_enabled_turns_and_present_progress() {
    let mut p = world();
    p.routines = vec![routine("patrol", vec![])];
    p.game.format_version = 6;
    assert_eq!(p.minimum_format(), 7);
    assert!(Session::start(p.clone(), None).is_err());
    p.game.format_version = 7;
    p.game.turns = None;
    assert!(Session::start(p.clone(), None).is_err());
    p.game.turns = Some(TurnPolicy::default());
    let (mut s, _) = Session::start(p, None).unwrap();
    let before = s.state().clone();
    let mut missing = before.clone();
    missing.routines = None;
    assert!(s.replace_state(missing).is_err());
    assert_eq!(s.state(), &before);
}

#[test]
fn automatic_and_explicit_routine_effects_participate_in_reachability_diagnostics() {
    let mut p = world();
    p.routines = vec![routine(
        "patrol",
        vec![Effect::If {
            condition: Condition::True,
            then: vec![Effect::End {
                ending: "finish".into(),
            }],
            otherwise: vec![],
        }],
    )];
    p.game.require_ending = true;
    assert!(
        !validate(&p)
            .iter()
            .any(|d| d.message.contains("reachable") && d.message.contains("ending"))
    );
    p.routines[0].start = RoutineStart::Blocks;
    assert!(
        validate(&p)
            .iter()
            .any(|d| d.message.contains("reachable") && d.message.contains("ending"))
    );
    p.game.actions.push(action(
        "start",
        vec![Effect::StartRoutine {
            routine: "patrol".into(),
            busy: RoutineBusyPolicy::Keep,
        }],
    ));
    assert!(
        !validate(&p)
            .iter()
            .any(|d| d.message.contains("reachable") && d.message.contains("ending"))
    );
}
