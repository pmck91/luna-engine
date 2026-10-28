#[path = "../../../tests/support/turns.rs"]
mod fixture;
use luna_model::*;

#[test]
fn turn_policy_and_cost_defaults_are_explicit_and_new_shapes_are_strict() {
    let p = Project::blank("No clock");
    assert!(p.game.turns.is_none());
    let policy: TurnPolicy = serde_json::from_str("{}").unwrap();
    assert!(
        policy.actions
            && policy.replies
            && !policy.failed_requirements
            && !policy.look
            && !policy.hints
    );
    assert!(serde_json::from_str::<TurnPolicy>(r#"{"mystery":true}"#).is_err());
    let turn_cost: ActionTurnCost = serde_json::from_str("{}").unwrap();
    assert!(turn_cost.is_default());
    let mut raw = serde_json::to_value(fixture::project()).unwrap();
    raw["timers"][0]["mystery"] = true.into();
    assert!(serde_json::from_value::<Project>(raw).is_err());
}

#[test]
fn turns_require_v6_and_disabled_games_reject_timer_definitions_and_costs() {
    let p = fixture::project();
    assert_eq!(p.minimum_format(), 6);
    assert!(!has_errors(&validate(&p)));
    let mut old = p.clone();
    old.game.format_version = 5;
    assert!(has_errors(&validate(&old)));
    let mut disabled = p.clone();
    disabled.game.turns = None;
    assert!(has_errors(&validate(&disabled)));
    let mut duplicate = p.clone();
    duplicate.timers[1].order = duplicate.timers[0].order;
    assert!(has_errors(&validate(&duplicate)));
    let mut missing = p.clone();
    missing.timers.clear();
    assert!(has_errors(&validate(&missing)));
    let mut escaped = p.clone();
    escaped.timers[0].effects = vec![Effect::ScheduleTimer {
        timer: "door-closes".into(),
        after: NumericOperand::Input {
            input: "unbound".into(),
        },
        pending: TimerPendingPolicy::Restart,
    }];
    assert!(has_errors(&validate(&escaped)));
    let mut cost = Project::blank("No clock");
    cost.locations[0].actions[0].turn_cost = Some(ActionTurnCost {
        success: TurnCost::Free,
        ..Default::default()
    });
    assert_eq!(cost.minimum_format(), 6);
    assert!(has_errors(&validate(&cost)));
}

#[test]
fn every_native_condition_and_effect_owner_validates_timer_refs_and_delay_addresses() {
    let mut p = fixture::project();
    p.procedures[0].effects[0] = Effect::ScheduleTimer {
        timer: "door-closes".into(),
        after: NumericOperand::Variable {
            name: "missing".into(),
        },
        pending: TimerPendingPolicy::Keep,
    };
    assert!(validate(&p).iter().any(|d| d.severity == Severity::Error
        && d.subject == "arm-door"
        && d.field == "effects.0.after"));
    p.procedures[0].effects[0] = Effect::If {
        condition: Condition::TimerPending {
            timer: "missing".into(),
        },
        then: vec![],
        otherwise: vec![],
    };
    assert!(
        validate(&p)
            .iter()
            .any(|d| d.severity == Severity::Error && d.subject == "arm-door")
    );
    let mut hidden = Project::blank("Upgrade");
    hidden.vocabulary.push(Verb {
        id: "linger".into(),
        canonical: "linger".into(),
        synonyms: vec!["Wait!".into()],
        event: None,
    });
    hidden.objects.push(Object {
        id: "hidden".into(),
        name: "Hidden".into(),
        placement: Placement::Absent,
        actions: vec![Action {
            id: "old-wait".into(),
            verb: "linger".into(),
            requirements: Condition::False,
            ..Default::default()
        }],
        ..Default::default()
    });
    assert!(!has_errors(&validate(&hidden)));
    hidden.game.turns = Some(TurnPolicy::default());
    assert_eq!(wait_command_conflicts(&hidden), ["old-wait"]);
    assert!(has_errors(&validate(&hidden)));
}

#[test]
fn structural_reachability_follows_scheduled_callbacks_without_counting_unused_or_false_timers() {
    let mut p = fixture::project();
    p.game.require_ending = true;
    p.game.actions.retain(|a| a.id == "open-door");
    p.timers[0].effects = vec![Effect::ScheduleTimer {
        timer: "finish-timer".into(),
        after: NumericOperand::Literal { value: 1 },
        pending: TimerPendingPolicy::Restart,
    }];
    p.timers.push(ScheduledTrigger {
        id: "finish-timer".into(),
        name: "Finish later".into(),
        order: 4,
        priority: 0,
        condition: Condition::True,
        effects: vec![
            Effect::ScheduleTimer {
                timer: "door-closes".into(),
                after: NumericOperand::Literal { value: 1 },
                pending: TimerPendingPolicy::Restart,
            },
            Effect::End {
                ending: "finish".into(),
            },
        ],
    });
    assert!(!has_errors(&validate(&p)), "{:?}", validate(&p));
    assert!(!validate(&p).iter().any(|d| d.subject == "finish"));
    p.timers.last_mut().unwrap().condition = Condition::False;
    assert!(
        validate(&p)
            .iter()
            .any(|d| d.field == "endings" && d.severity == Severity::Error)
    );
    p.timers.last_mut().unwrap().condition = Condition::True;
    p.timers[0].effects.clear();
    assert!(
        validate(&p)
            .iter()
            .any(|d| d.field == "endings" && d.severity == Severity::Error)
    );
}
