use luna_core::{HintProgress, Session, validate_state};
use luna_model::*;

fn world() -> Project {
    let mut p = Project::blank("Puzzle hints");
    let room = p.game.starting_location.clone();
    p.game.variables = [
        ("solved".into(), Value::Bool(false)),
        ("commands".into(), Value::Integer(0)),
        ("chances".into(), Value::Integer(3)),
    ]
    .into();
    p.objects.push(Object {
        id: "key".into(),
        name: "brass key".into(),
        aliases: vec!["key".into()],
        portable: true,
        placement: Placement::Location {
            location: room.clone(),
        },
        ..Default::default()
    });
    p.objects[0].actions = starter_actions(&p.objects[0]);
    p.objects.push(Object {
        id: "door".into(),
        name: "oak door".into(),
        aliases: vec!["door".into()],
        placement: Placement::Location { location: room },
        actions: vec![description_action("door")],
        hints: vec![HintSet {
            id: "door-puzzle".into(),
            name: "The locked door".into(),
            solved: Condition::Variable {
                name: "solved".into(),
                op: Comparison::Eq,
                value: Value::Bool(true),
            },
            stages: vec![
                HintStage {
                    id: "have-key".into(),
                    name: "Unlocking".into(),
                    condition: Condition::Carrying {
                        object: "key".into(),
                    },
                    clues: vec![
                        "<green>Check what you carry.</green> You have %chances% chances.".into(),
                        "A small metal object may fit the lock.".into(),
                    ],
                    solution: Some("Try use brass key on oak door.".into()),
                },
                HintStage {
                    id: "find-key".into(),
                    name: "Finding the key".into(),
                    condition: Condition::True,
                    clues: vec![
                        "Explore the room carefully.".into(),
                        "Something small may help.".into(),
                    ],
                    solution: None,
                },
            ],
            ..Default::default()
        }],
        ..Default::default()
    });
    p.game.triggers.push(Trigger {
        id: "commands-trigger".into(),
        event: Event::Command,
        effects: vec![Effect::UpdateVariable {
            name: "commands".into(),
            op: ArithmeticOperation::Add,
            operand: NumericOperand::Literal { value: 1 },
        }],
        ..Default::default()
    });
    p
}
fn output(s: &mut Session, command: &str) -> (String, bool) {
    let result = s.command(command).unwrap();
    (
        result
            .messages
            .iter()
            .map(|m| text::plain(m))
            .collect::<Vec<_>>()
            .join("\n"),
        result.state_changed,
    )
}

#[test]
fn hints_advance_and_repeat_only_authored_clues_without_gameplay_side_effects() {
    let (mut s, _) = Session::start(world(), None).unwrap();
    let before = s.state.clone();
    assert!(output(&mut s, "hint").0.contains("oak door"));
    assert_eq!(s.state, before);
    assert!(
        output(&mut s, "hint the door")
            .0
            .contains("Explore the room carefully.")
    );
    assert_eq!(s.state.hints["find-key"].clues_seen, 1);
    assert!(
        output(&mut s, "hint door")
            .0
            .contains("Something small may help.")
    );
    assert_eq!(s.state.hints["find-key"].clues_seen, 2);
    let second = s.state.clone();
    let (last, changed) = output(&mut s, "hint door");
    assert!(last.contains("Something small may help."));
    assert!(!changed);
    assert_eq!(s.state, second);
    assert_eq!(s.state.variables, before.variables);
    assert_eq!(s.state.objects, before.objects);
    assert_eq!(s.state.visits, before.visits);
    assert_eq!(s.state.sequences, before.sequences);
    assert!(!output(&mut s, "hint door solution").1);
    assert_eq!(s.state, second);
}

#[test]
fn stages_follow_live_progress_and_solutions_require_an_explicit_request() {
    let (mut s, _) = Session::start(world(), None).unwrap();
    output(&mut s, "hint door");
    s.command("take key").unwrap();
    let result = s.command("hint door").unwrap();
    assert!(result.state_changed);
    assert!(
        result
            .messages
            .iter()
            .flatten()
            .any(|span| span.text.contains("Check what you carry.")
                && span.colour.as_deref() == Some("green"))
    );
    assert!(
        result
            .messages
            .iter()
            .map(|m| text::plain(m))
            .any(|m| m.contains("3 chances"))
    );
    assert_eq!(s.state.hints["find-key"].clues_seen, 1);
    assert_eq!(s.state.hints["have-key"].clues_seen, 1);
    let (last, _) = output(&mut s, "hint door");
    assert!(last.contains("hint oak door solution"));
    assert!(!last.contains("use brass key on oak door"));
    assert!(!s.state.hints["have-key"].solution_seen);
    let (solution, changed) = output(&mut s, "hint door solution");
    assert!(solution.contains("Try use brass key on oak door."));
    assert!(changed);
    assert!(s.state.hints["have-key"].solution_seen);
    assert!(!output(&mut s, "hint door solution").1);
    let after = s.state.clone();
    let mut restored =
        Session::restore_with_definition(s.definition().clone(), after.clone()).unwrap();
    assert_eq!(restored.state, after);
    assert!(!output(&mut restored, "hint door").1);
    restored.command("drop key").unwrap();
    assert!(
        output(&mut restored, "hint door")
            .0
            .contains("Something small may help.")
    );
    assert_eq!(restored.state.hints["find-key"].clues_seen, 2);
    assert!(restored.state.hints["have-key"].solution_seen);
    restored.command("take key").unwrap();
    assert!(!output(&mut restored, "hint door").1);
}

#[test]
fn hints_respect_scope_availability_solved_conditions_and_game_settings() {
    let mut p = world();
    p.game.hints_enabled = false;
    let (mut s, _) = Session::start(p, None).unwrap();
    for input in ["hint", "hint door", "hint missing"] {
        assert_eq!(
            output(&mut s, input),
            ("Puzzle hints are disabled for this game.".into(), false)
        );
    }
    let mut project = s.project().clone();
    project.game.hints_enabled = true;
    project.objects[1].hints[0].available = Condition::False;
    s = Session::restore(project, s.state).unwrap();
    assert!(!output(&mut s, "hint").0.contains("oak door"));
    assert!(
        output(&mut s, "hint door")
            .0
            .contains("No puzzle hints are available")
    );
    let mut project = s.project().clone();
    project.objects[1].hints[0].available = Condition::True;
    s = Session::restore(project, s.state).unwrap();
    s.state.objects.get_mut("door").unwrap().hidden = true;
    assert!(!output(&mut s, "hint").0.contains("oak door"));
    assert!(output(&mut s, "hint door").0.contains("can't find"));
    s.state.objects.get_mut("door").unwrap().hidden = false;
    s.state.variables.insert("solved".into(), Value::Bool(true));
    assert!(!output(&mut s, "hint").0.contains("oak door"));
    assert!(
        output(&mut s, "hint door")
            .0
            .contains("No puzzle hints are available")
    );
    assert!(s.state.hints.is_empty());
}

#[test]
fn hint_used_conditions_allow_authored_scoring_without_running_command_triggers() {
    let mut p = world();
    p.game.actions.push(Action {
        id: "check-hints".into(),
        verb: "use".into(),
        pattern: vec![PatternPart::Literal {
            text: "check".into(),
        }],
        effects: vec![Effect::If {
            condition: Condition::HintUsed {
                hint: "door-puzzle".into(),
            },
            then: vec![Effect::Say {
                text: "Assisted".into(),
            }],
            otherwise: vec![Effect::Say {
                text: "Unassisted".into(),
            }],
        }],
        ..Default::default()
    });
    let (mut s, _) = Session::start(p, None).unwrap();
    assert!(output(&mut s, "use check").0.contains("Unassisted"));
    let before = s.state.variables.clone();
    output(&mut s, "hint door");
    assert_eq!(s.state.variables, before);
    assert!(output(&mut s, "use check").0.contains("Assisted"));
}

#[test]
fn unknown_and_ambiguous_hint_targets_never_advance_history() {
    let mut p = world();
    p.characters.push(Character {
        id: "other-door".into(),
        name: "other door".into(),
        aliases: vec!["door".into()],
        location: p.game.starting_location.clone(),
        ..Default::default()
    });
    let (mut s, _) = Session::start(p, None).unwrap();
    assert_eq!(s.command("hint door").unwrap().status, "ambiguous");
    assert_eq!(s.command("hint missing").unwrap().status, "unmatched");
    assert_eq!(
        s.command("hint missing solution").unwrap().status,
        "unmatched"
    );
    assert!(s.state.hints.is_empty());
    assert!(s.command(&format!("hint {}", "x".repeat(4096))).is_err());
}

#[test]
fn saves_validate_hint_ids_cursors_and_solution_progress_and_accept_legacy_state() {
    let (s, _) = Session::start(world(), None).unwrap();
    let mut old = serde_json::to_value(&s.state).unwrap();
    old.as_object_mut().unwrap().remove("hints");
    let old = serde_json::from_value(old).unwrap();
    validate_state(s.project(), &old).unwrap();
    for (id, progress) in [
        (
            "missing",
            HintProgress {
                clues_seen: 1,
                solution_seen: false,
            },
        ),
        (
            "find-key",
            HintProgress {
                clues_seen: 99,
                solution_seen: false,
            },
        ),
        (
            "find-key",
            HintProgress {
                clues_seen: 0,
                solution_seen: true,
            },
        ),
    ] {
        let mut state = s.state.clone();
        state.hints.insert(id.into(), progress);
        assert!(validate_state(s.project(), &state).is_err());
    }
}

#[test]
fn hint_content_validates_conditions_markup_placeholders_and_ids() {
    let p = world();
    assert!(!has_errors(&validate(&p)));
    for case in 0..6 {
        let mut bad = p.clone();
        let hint = &mut bad.objects[1].hints[0];
        match case {
            0 => hint.stages.clear(),
            1 => hint.stages[0].clues.clear(),
            2 => hint.stages[0].clues[0] = "%missing%".into(),
            3 => hint.stages[0].solution = Some("<unknown>bad</unknown>".into()),
            4 => {
                hint.stages[0].condition = Condition::Carrying {
                    object: "missing".into(),
                }
            }
            _ => hint.stages[0].id = "key".into(),
        }
        assert!(has_errors(&validate(&bad)), "case {case}");
    }
}
