//! Production Session regression scenarios promoted from the P1 matcher proof.
use super::*;
use crate::{InputResolution, runtime::resolution::InteractionContext as Context};
use luna_model::*;
use std::ops::{Deref, DerefMut};
const MAX_CHOICES: usize = 20;

#[derive(Debug, Default, PartialEq, Eq)]
enum Resolution {
    #[default]
    Ordinary,
    Waiting {
        slot: usize,
        choices: Vec<String>,
    },
    Selected {
        flow: String,
        nouns: Vec<String>,
    },
    AuthorAmbiguity,
    TooMany,
    Unavailable,
    Cancelled,
}
struct Outcome {
    result: CommandResult,
    resolution: Resolution,
}
// This adapter only projects public result metadata for the historical cases;
// it contains no matching, coordination, effects, or transaction implementation.
struct Proof {
    session: Session,
    clarify: bool,
    pronouns: bool,
}
impl Deref for Proof {
    type Target = Session;
    fn deref(&self) -> &Session {
        &self.session
    }
}
impl DerefMut for Proof {
    fn deref_mut(&mut self) -> &mut Session {
        &mut self.session
    }
}
impl Proof {
    fn new(project: Project) -> Self {
        let settings = project.game.command_assistance.clone().unwrap_or_default();
        Self {
            session: Session::start(project, None).unwrap().0,
            clarify: settings.clarification,
            pronouns: settings.recent_objects,
        }
    }
    fn attempt(&mut self, input: &str, explain: bool) -> (Outcome, Option<anyhow::Error>) {
        let mut settings = self
            .session
            .project()
            .game
            .command_assistance
            .clone()
            .unwrap_or_default();
        if settings.clarification != self.clarify || settings.recent_objects != self.pronouns {
            settings.clarification = self.clarify;
            settings.recent_objects = self.pronouns;
            let mut project = self.session.project().clone();
            project.game.command_assistance = Some(settings);
            self.session = Session::restore(project, self.session.state().clone()).unwrap();
        }
        let (result, error) = if explain {
            let result = self.session.command_explained(input);
            let error = (result.status == CommandStatus::Error).then(|| {
                anyhow::anyhow!(
                    result
                        .explanation
                        .as_ref()
                        .and_then(|trace| trace.error.clone())
                        .unwrap_or_default()
                )
            });
            (result, error)
        } else {
            match self.session.command(input) {
                Ok(result) => (result, None),
                Err(error) => (
                    CommandResult {
                        status: CommandStatus::Error,
                        ..Default::default()
                    },
                    Some(error),
                ),
            }
        };
        let resolution = match result.input_resolution.as_ref() {
            Some(InputResolution::Pending { question, .. }) => Resolution::Waiting {
                slot: self.session.context.pending.as_ref().unwrap().slot,
                choices: question
                    .choices
                    .iter()
                    .map(|choice| choice.entity.clone())
                    .collect(),
            },
            Some(InputResolution::Resolved { bindings, .. }) if result.selected_flow.is_some() => {
                Resolution::Selected {
                    flow: result.selected_flow.clone().unwrap(),
                    nouns: bindings
                        .iter()
                        .map(|binding| binding.entity.clone())
                        .collect(),
                }
            }
            Some(InputResolution::AuthorAmbiguity { .. }) => Resolution::AuthorAmbiguity,
            Some(InputResolution::TooMany { .. }) => Resolution::TooMany,
            Some(InputResolution::Unresolved { .. }) => Resolution::Unavailable,
            Some(InputResolution::Cancelled { .. }) => Resolution::Cancelled,
            _ => Resolution::Ordinary,
        };
        (Outcome { result, resolution }, error)
    }
    fn command(&mut self, input: &str) -> Result<Outcome> {
        let (outcome, error) = self.attempt(input, false);
        if let Some(error) = error {
            return Err(error);
        }
        Ok(outcome)
    }
    fn replace_state(&mut self, state: GameState) -> Result<()> {
        self.session.replace_state(state)
    }
}

fn increment(name: &str) -> Effect {
    Effect::UpdateVariable {
        name: name.into(),
        op: ArithmeticOperation::Add,
        operand: NumericOperand::Literal { value: 1 },
    }
}

fn entity(id: &str) -> PatternPart {
    PatternPart::Entity { entity: id.into() }
}
fn literal(text: &str) -> PatternPart {
    PatternPart::Literal { text: text.into() }
}

fn action(id: &str, verb: &str, pattern: Vec<PatternPart>) -> Action {
    Action {
        id: id.into(),
        name: id.into(),
        verb: verb.into(),
        pattern,
        effects: vec![
            increment("runs"),
            Effect::Say {
                text: "Done.".into(),
            },
        ],
        ..Default::default()
    }
}

fn world() -> Project {
    let mut p = Project::blank("Parser P1 proof");
    p.game.id = "parser-proof".into();
    p.game.starting_location = "study".into();
    p.locations[0].id = "study".into();
    p.locations[0].name = "Study".into();
    p.locations[0].actions.clear();
    p.locations.push(Location {
        id: "garden".into(),
        name: "Garden".into(),
        ..Default::default()
    });
    for name in ["runs", "commands", "watches"] {
        p.game.variables.insert(name.into(), Value::Integer(0));
    }
    p.game.triggers = vec![
        Trigger {
            id: "count-command".into(),
            event: Event::Command,
            effects: vec![increment("commands")],
            ..Default::default()
        },
        Trigger {
            id: "count-watch".into(),
            watch: Some(TriggerWatch {
                target: ValueTarget::Variable {
                    name: "runs".into(),
                },
                mode: WatchMode::EachChange,
            }),
            effects: vec![increment("watches")],
            ..Default::default()
        },
    ];
    for (id, name, alias) in [
        ("brass", "Brass key", "key"),
        ("silver", "Silver key", "key"),
        ("wooden", "Wooden box", "box"),
        ("iron", "Iron box", "box"),
        ("chest", "Chest", "chest"),
    ] {
        let storage = matches!(id, "wooden" | "iron" | "chest").then_some(ObjectStorage {
            container: Some(if id == "chest" {
                ContainerOpening::Openable
            } else {
                ContainerOpening::AlwaysOpen
            }),
            surface: true,
        });
        p.objects.push(Object {
            id: id.into(),
            name: name.into(),
            aliases: vec![alias.into(), alias.into()],
            portable: true,
            placement: if storage.is_some() {
                Placement::Location {
                    location: "study".into(),
                }
            } else {
                Placement::Inventory
            },
            storage,
            open: id != "chest",
            actions: vec![
                action(&format!("examine-{id}"), "examine", vec![entity(id)]),
                action(&format!("take-{id}"), "take", vec![entity(id)]),
            ],
            ..Default::default()
        });
    }
    p.characters.push(Character {
        id: "keeper".into(),
        name: "Keeper".into(),
        location: "study".into(),
        ..Default::default()
    });
    for (id, placement, hidden) in [
        ("hidden", Placement::Inventory, true),
        (
            "closed",
            Placement::Inside {
                object: "chest".into(),
            },
            false,
        ),
        (
            "private",
            Placement::Character {
                character: "keeper".into(),
            },
            false,
        ),
        (
            "remote",
            Placement::Location {
                location: "garden".into(),
            },
            false,
        ),
        ("absent", Placement::Absent, false),
    ] {
        p.objects.push(Object {
            id: id.into(),
            name: format!("Secret {id} key"),
            aliases: vec!["key".into()],
            placement,
            hidden,
            actions: vec![action(&format!("take-{id}"), "take", vec![entity(id)])],
            ..Default::default()
        });
    }
    p
}

fn counts(proof: &Proof, expected: i32) {
    for name in ["runs", "commands", "watches"] {
        assert_eq!(
            proof.session.state().variables[name],
            Value::Integer(expected),
            "{name}"
        );
    }
}

#[test]
fn fixed_nouns_ask_once_and_do_not_reveal_unavailable_aliases() {
    let mut proof = Proof::new(world());
    let before = proof.session.state().clone();
    let waiting = proof.command("TAKE the key!").unwrap();
    assert_eq!(
        waiting.resolution,
        Resolution::Waiting {
            slot: 0,
            choices: vec!["brass".into(), "silver".into()]
        }
    );
    assert_eq!(proof.session.state(), &before);
    assert!(!waiting.result.state_changed);
    assert!(waiting.result.selected_flow.is_none());
    let output = waiting
        .result
        .messages
        .iter()
        .map(|line| text::plain(line))
        .collect::<String>();
    assert!(!output.contains("Secret"));
    for invalid in ["nothing", "0", "999999999999999999999999999", "key", "the"] {
        proof.command(invalid).unwrap();
        counts(&proof, 0);
    }
    let result = proof.command("the BRASS").unwrap();
    assert_eq!(result.result.selected_flow.as_deref(), Some("take-brass"));
    counts(&proof, 1);
    proof.command("examine it").unwrap();
    counts(&proof, 2);
    assert_eq!(proof.context.recent.as_deref(), Some("brass"));
}

#[test]
fn dynamic_item_bindings_and_two_noun_slots_are_resolved_without_expansion() {
    let mut p = world();
    for id in ["wooden", "iron"] {
        let object = p.objects.iter_mut().find(|object| object.id == id).unwrap();
        // Moving between two carried surfaces preserves possession; otherwise
        // the second standard PUT correctly refuses a now room-owned item.
        object.placement = Placement::Inventory;
        let mut standard = standard_action(object, StandardInteraction::PutOn, "use");
        standard.effects.push(increment("runs"));
        object.actions.push(standard);
    }
    let actions = p
        .owners()
        .iter()
        .map(|(_, actions, _)| actions.len())
        .sum::<usize>();
    let mut proof = Proof::new(p);
    proof.command("use key on box").unwrap();
    proof.command("brass").unwrap();
    assert_eq!(proof.context.pending.as_ref().unwrap().slot, 1);
    assert_eq!(proof.context.recent, None);
    counts(&proof, 0);
    let chosen = proof.command("iron").unwrap();
    assert_eq!(chosen.result.status, CommandStatus::Ok);
    assert_eq!(
        proof.session.state().objects["brass"].placement,
        Placement::On {
            object: "iron".into()
        }
    );
    assert_eq!(proof.context.recent.as_deref(), Some("brass"));
    counts(&proof, 1);
    assert_eq!(
        proof
            .session
            .project()
            .owners()
            .iter()
            .map(|(_, actions, _)| actions.len())
            .sum::<usize>(),
        actions
    );
    // The same typed input accepts a recent object without rewriting literals.
    proof.command("use it on wooden box").unwrap();
    assert_eq!(
        proof.session.state().objects["brass"].placement,
        Placement::On {
            object: "wooden".into()
        }
    );
    counts(&proof, 2);
}

#[test]
fn failed_requirements_do_not_bias_choices_and_still_update_recent_object() {
    let mut p = world();
    p.objects[0].actions[1].requirements = Condition::False;
    p.objects[0].actions[1].failure_text = "A story rule prevents this.".into();
    let mut proof = Proof::new(p);
    proof.command("take key").unwrap();
    assert_eq!(proof.context.pending.as_ref().unwrap().choices.len(), 2);
    let result = proof.command("1").unwrap();
    assert_eq!(result.result.status, CommandStatus::RequirementsFailed);
    assert_eq!(proof.context.recent.as_deref(), Some("brass"));
    counts(&proof, 0);
    proof.command("inspect it").unwrap();
    counts(&proof, 1);
}

#[test]
fn custom_action_and_explicit_priority_keep_precedence_before_requirements() {
    let mut p = world();
    let object = &mut p.objects[2];
    object
        .actions
        .push(standard_action(object, StandardInteraction::PutOn, "use"));
    let mut custom = action(
        "custom",
        "use",
        vec![entity("brass"), literal("on"), entity("wooden")],
    );
    custom.requirements = Condition::False;
    p.game.actions.push(custom);
    let mut proof = Proof::new(p);
    let result = proof.command("use key on box").unwrap();
    assert_eq!(result.result.selected_flow.as_deref(), Some("custom"));
    assert_eq!(result.result.status, CommandStatus::RequirementsFailed);
    assert!(proof.context.pending.is_none());
    counts(&proof, 0);
    let mut p = world();
    p.objects[1].actions[1].priority = 1;
    let mut proof = Proof::new(p);
    assert_eq!(
        proof
            .command("take key")
            .unwrap()
            .result
            .selected_flow
            .as_deref(),
        Some("take-silver")
    );
    counts(&proof, 1);
}

#[test]
fn duplicate_handlers_for_identical_nouns_are_not_offered_as_player_choices() {
    let mut p = world();
    let mut duplicate = p.objects[0].actions[1].clone();
    duplicate.id = "duplicate".into();
    p.objects[0].actions.push(duplicate);
    let mut proof = Proof::new(p);
    assert_eq!(
        proof.command("take brass key").unwrap().resolution,
        Resolution::AuthorAmbiguity
    );
    assert!(proof.context.pending.is_none());
    counts(&proof, 0);
}

#[test]
fn literal_it_and_entities_named_it_keep_exact_matching_precedence() {
    let mut p = world();
    p.game
        .actions
        .push(action("literal-it", "use", vec![literal("it")]));
    p.objects[2].aliases.push("it".into());
    let mut proof = Proof::new(p);
    proof.command("take brass key").unwrap();
    assert_eq!(
        proof
            .command("use it")
            .unwrap()
            .result
            .selected_flow
            .as_deref(),
        Some("literal-it")
    );
    assert_eq!(proof.context.recent.as_deref(), Some("brass"));
    assert_eq!(
        proof
            .command("examine it")
            .unwrap()
            .result
            .selected_flow
            .as_deref(),
        Some("examine-wooden")
    );
    assert_eq!(proof.context.recent.as_deref(), Some("wooden"));
    counts(&proof, 3);
}

#[test]
fn references_never_replace_literals_or_bypass_object_scope() {
    let mut p = world();
    p.game.actions.push(action(
        "use-literal",
        "use",
        vec![entity("brass"), literal("with it")],
    ));
    let mut proof = Proof::new(p);
    proof.command("take brass key").unwrap();
    assert_eq!(
        proof
            .command("use it with it")
            .unwrap()
            .result
            .selected_flow
            .as_deref(),
        Some("use-literal")
    );
    counts(&proof, 2);
    // Simulate state changing between input observations without using the
    // replacement API, to prove matching rechecks scope even for a retained ID.
    let mut state = proof.session.state().clone();
    state.objects.get_mut("brass").unwrap().hidden = true;
    proof.session.definition().validate_state(&state).unwrap();
    proof.session.state = state;
    let result = proof.command("examine it").unwrap();
    assert_eq!(result.resolution, Resolution::Unavailable);
    assert!(
        !result
            .result
            .messages
            .iter()
            .any(|line| text::plain(line).contains("Brass"))
    );
    counts(&proof, 2);
}

#[test]
fn control_commands_preserve_questions_and_fresh_commands_replace_them() {
    let mut proof = Proof::new(world());
    proof.command("take key").unwrap();
    let pending = proof.context.clone();
    for input in [
        "",
        "look",
        "inventory",
        "help",
        "help brass key",
        "save Before!",
        "saves",
        "load Missing",
    ] {
        proof.command(input).unwrap();
        assert_eq!(proof.context, pending, "{input}");
        counts(&proof, 0);
    }
    proof.command("take wooden box").unwrap();
    assert!(proof.context.pending.is_none());
    assert_eq!(proof.context.recent.as_deref(), Some("wooden"));
    counts(&proof, 1);
    proof.command("take key").unwrap();
    proof.command("take an unknown thing").unwrap();
    assert!(proof.context.pending.is_none());
    counts(&proof, 1);
    proof.command("take key").unwrap();
    proof.command("hint").unwrap();
    assert!(proof.context.pending.is_none());
    counts(&proof, 1);
}

#[test]
fn cancel_is_reserved_only_for_assisted_games_and_never_runs_effects() {
    let mut proof = Proof::new(world());
    proof.command("take key").unwrap();
    assert_eq!(
        proof.command("cancel").unwrap().resolution,
        Resolution::Cancelled
    );
    assert!(proof.context.pending.is_none());
    counts(&proof, 0);
    let mut p = world();
    p.game.command_assistance.as_mut().unwrap().clarification = false;
    p.vocabulary.push(luna_model::Verb {
        id: "cancel".into(),
        canonical: "cancel".into(),
        synonyms: vec![],
        event: None,
    });
    p.game
        .actions
        .push(action("authored-cancel", "cancel", vec![]));
    let mut proof = Proof::new(p);
    proof.command("cancel").unwrap();
    counts(&proof, 1);
}

#[test]
fn a_changed_offered_set_never_reuses_old_number_meanings() {
    let mut proof = Proof::new(world());
    proof.command("take key").unwrap();
    let mut state = proof.session.state().clone();
    state.objects.get_mut("brass").unwrap().hidden = true;
    proof.session.definition().validate_state(&state).unwrap();
    proof.session.state = state;
    let result = proof.command("1").unwrap();
    assert_eq!(
        result.resolution,
        Resolution::Waiting {
            slot: 0,
            choices: vec!["silver".into()]
        }
    );
    counts(&proof, 0);
    proof.command("1").unwrap();
    assert_eq!(proof.context.recent.as_deref(), Some("silver"));
    counts(&proof, 1);
}

#[test]
fn newly_available_handlers_cannot_capture_a_reply_to_an_old_question() {
    let mut p = world();
    p.objects.push(Object {
        id: "late-handler-owner".into(),
        name: "Later object".into(),
        placement: Placement::Inventory,
        hidden: true,
        actions: vec![action("replacement", "take", vec![literal("key")])],
        ..Default::default()
    });
    let mut proof = Proof::new(p);
    proof.command("take key").unwrap();
    let mut state = proof.session.state().clone();
    state.objects.get_mut("late-handler-owner").unwrap().hidden = false;
    proof.session.definition().validate_state(&state).unwrap();
    proof.session.state = state;
    assert_eq!(
        proof.command("1").unwrap().resolution,
        Resolution::Unavailable
    );
    counts(&proof, 0);
    assert!(proof.context.pending.is_none());
    assert_eq!(
        proof
            .command("take key")
            .unwrap()
            .result
            .selected_flow
            .as_deref(),
        Some("replacement")
    );
    counts(&proof, 1);
}

#[test]
fn incompatible_noun_shapes_and_duplicate_handlers_after_narrowing_stay_author_errors() {
    let mut p = world();
    p.objects[1].aliases.push("in".into());
    p.game.actions = vec![
        action(
            "noun-first",
            "use",
            vec![entity("brass"), literal("in"), entity("wooden")],
        ),
        action(
            "literal-first",
            "use",
            vec![literal("key"), entity("silver"), entity("iron")],
        ),
    ];
    let mut proof = Proof::new(p);
    assert_eq!(
        proof.command("use key in box").unwrap().resolution,
        Resolution::AuthorAmbiguity
    );
    assert!(proof.context.pending.is_none());
    counts(&proof, 0);
    let mut p = world();
    let mut duplicate = p.objects[0].actions[1].clone();
    duplicate.id = "duplicate-brass".into();
    p.objects[0].actions.push(duplicate);
    let mut proof = Proof::new(p);
    proof.command("take key").unwrap();
    assert_eq!(
        proof.command("brass").unwrap().resolution,
        Resolution::AuthorAmbiguity
    );
    counts(&proof, 0);
}

#[test]
fn identical_names_remain_selectable_by_number_and_modes_are_independent() {
    let mut p = world();
    p.objects[0].name = "Key".into();
    p.objects[1].name = "Key".into();
    let mut proof = Proof::new(p);
    proof.pronouns = false;
    proof.command("take key").unwrap();
    assert_eq!(
        proof.command("2").unwrap().result.selected_flow.as_deref(),
        Some("take-silver")
    );
    assert_eq!(
        proof.command("examine it").unwrap().result.status,
        CommandStatus::Unmatched
    );
    counts(&proof, 1);
    let mut proof = Proof::new(world());
    proof.clarify = false;
    proof.command("take brass key").unwrap();
    proof.command("examine it").unwrap();
    counts(&proof, 2);
    proof.command("take key").unwrap();
    assert!(proof.context.pending.is_none());
    counts(&proof, 2);
}

#[test]
fn references_recheck_all_existing_container_and_ownership_scope_rules() {
    for scenario in [
        "hidden", "closed", "private", "remote", "absent", "consumed",
    ] {
        let mut proof = Proof::new(world());
        proof.command("take brass key").unwrap();
        let mut state = proof.session.state().clone();
        let item = state.objects.get_mut("brass").unwrap();
        match scenario {
            "hidden" => item.hidden = true,
            "closed" => {
                item.placement = Placement::Inside {
                    object: "chest".into(),
                }
            }
            "private" => {
                item.placement = Placement::Character {
                    character: "keeper".into(),
                }
            }
            "remote" => {
                item.placement = Placement::Location {
                    location: "garden".into(),
                }
            }
            _ => {
                item.placement = Placement::Absent;
                item.exists = false;
                item.consumed = scenario == "consumed";
            }
        }
        proof.session.definition().validate_state(&state).unwrap();
        proof.session.state = state;
        let result = proof.command("examine it").unwrap();
        assert_eq!(result.resolution, Resolution::Unavailable, "{scenario}");
        assert!(
            !result
                .result
                .messages
                .iter()
                .any(|line| text::plain(line).contains("Brass"))
        );
        counts(&proof, 1);
    }
}

#[test]
fn state_replacement_clears_context_only_after_success_even_for_equal_state() {
    let mut proof = Proof::new(world());
    proof.command("take brass key").unwrap();
    proof.command("take key").unwrap();
    let context = proof.context.clone();
    let state = proof.session.state().clone();
    let mut invalid = state.clone();
    invalid.variables.remove("runs");
    assert!(proof.replace_state(invalid).is_err());
    assert_eq!(proof.context, context);
    proof.replace_state(state.clone()).unwrap();
    assert_eq!(proof.context, Context::default());
    assert_eq!(proof.session.state(), &state);
    assert_eq!(
        proof.command("examine it").unwrap().resolution,
        Resolution::Unavailable
    );
    counts(&proof, 1);
}

#[test]
fn failed_effects_roll_back_story_output_and_context_in_both_entry_paths() {
    let mut p = world();
    p.game.variables.insert("zero".into(), Value::Integer(0));
    p.objects[0].actions[1]
        .effects
        .push(Effect::UpdateVariable {
            name: "runs".into(),
            op: ArithmeticOperation::Divide,
            operand: NumericOperand::Variable {
                name: "zero".into(),
            },
        });
    for explain in [false, true] {
        let mut proof = Proof::new(p.clone());
        proof.command("examine silver key").unwrap();
        proof.command("take key").unwrap();
        let context = proof.context.clone();
        let before = proof.session.state().clone();
        let (outcome, error) = proof.attempt("brass", explain);
        assert!(error.is_some());
        assert_eq!(outcome.result.status, CommandStatus::Error);
        assert_eq!(proof.session.state(), &before);
        assert_eq!(proof.context, context);
        if explain {
            let explanation = outcome.result.explanation.unwrap();
            assert!(!explanation.committed);
            assert!(!explanation.discarded_messages.is_empty());
            assert!(outcome.result.messages.is_empty());
        }
        counts(&proof, 1);
    }
}

#[test]
fn explanation_uses_the_real_reply_and_the_same_single_execution() {
    let mut normal = Proof::new(world());
    let mut explained = Proof::new(normal.session.project().clone());
    for input in ["take key", "brass", "examine it"] {
        let a = normal.command(input).unwrap();
        let (b, error) = explained.attempt(input, true);
        assert!(error.is_none());
        assert_eq!(a.resolution, b.resolution);
        assert_eq!(a.result.messages, b.result.messages);
        assert_eq!(normal.session.state(), explained.session.state());
        assert_eq!(normal.context, explained.context);
        let trace = b.result.explanation.unwrap();
        assert_eq!(trace.command, input);
        assert!(trace.committed);
    }
    counts(&normal, 2);
}

#[test]
fn visible_exit_destination_exception_does_not_widen_ordinary_noun_scope() {
    let mut p = world();
    p.locations[0].exits.push(Exit {
        id: "garden-exit".into(),
        name: "Garden route".into(),
        verb: "go".into(),
        destination: "garden".into(),
        pattern: vec![entity("garden")],
        effects: vec![increment("runs")],
        ..Default::default()
    });
    p.game
        .actions
        .push(action("inspect-garden", "examine", vec![entity("garden")]));
    let mut proof = Proof::new(p);
    assert_eq!(
        proof.command("examine garden").unwrap().result.status,
        CommandStatus::Unmatched
    );
    let result = proof.command("go garden").unwrap();
    assert_eq!(result.result.selected_flow.as_deref(), Some("garden-exit"));
    assert_eq!(proof.session.state().location, "garden");
    assert_eq!(proof.context.recent, None);
    counts(&proof, 1);
}

#[test]
fn optional_modes_and_restoration_leave_ordinary_games_unchanged() {
    let mut p = world();
    p.game.command_assistance = None;
    let mut ordinary = Session::start(p.clone(), None).unwrap().0;
    let mut proof = Proof::new(p);
    proof.clarify = false;
    proof.pronouns = false;
    for input in [
        "take brass key",
        "inspect it",
        "look",
        "take key",
        "take silver key",
    ] {
        let a = ordinary.command(input).unwrap();
        let b = proof.command(input).unwrap().result;
        assert_eq!(a.messages, b.messages);
        assert_eq!(a.status, b.status);
        assert_eq!(a.selected_flow, b.selected_flow);
        assert_eq!(ordinary.state(), proof.session.state());
    }
    proof.clarify = true;
    proof.pronouns = true;
    proof.command("take key").unwrap();
    let saved = serde_json::to_vec(proof.session.state()).unwrap();
    let restored = Session::restore(
        proof.session.project().clone(),
        serde_json::from_slice(&saved).unwrap(),
    )
    .unwrap();
    let mut restored = Proof {
        session: restored,
        clarify: true,
        pronouns: true,
    };
    assert_eq!(
        restored.command("examine it").unwrap().resolution,
        Resolution::Unavailable
    );
    counts(&restored, 2);
}

#[test]
fn ending_dispatch_clears_pending_and_prevents_a_reply_from_running_again() {
    let mut p = world();
    p.game.endings.push(Ending {
        id: "finished".into(),
        name: "Finished".into(),
        ..Default::default()
    });
    p.objects[0].actions[1].effects.push(Effect::End {
        ending: "finished".into(),
    });
    let mut proof = Proof::new(p);
    proof.command("take key").unwrap();
    proof.command("brass").unwrap();
    assert!(proof.context.pending.is_none());
    assert_eq!(proof.session.state().ending.as_deref(), Some("finished"));
    assert_eq!(
        proof.command("brass").unwrap().result.status,
        CommandStatus::Ended
    );
    // END GAME preserves the existing rule: no later command event is fired.
    assert_eq!(proof.session.state().variables["runs"], Value::Integer(1));
    assert_eq!(
        proof.session.state().variables["commands"],
        Value::Integer(0)
    );
}

#[test]
fn too_many_choices_and_overlong_replies_are_bounded_without_partial_selection() {
    let mut p = world();
    for index in 0..MAX_CHOICES {
        let id = format!("extra-{index}");
        p.objects.push(Object {
            id: id.clone(),
            name: format!("Key {index}"),
            aliases: vec!["key".into()],
            placement: Placement::Inventory,
            actions: vec![action(&format!("take-{id}"), "take", vec![entity(&id)])],
            ..Default::default()
        });
    }
    let mut proof = Proof::new(p);
    assert_eq!(
        proof.command("take key").unwrap().resolution,
        Resolution::TooMany
    );
    assert!(proof.context.pending.is_none());
    counts(&proof, 0);
    let mut proof = Proof::new(world());
    proof.command("take key").unwrap();
    let before = proof.context.clone();
    assert!(proof.command(&"x".repeat(4097)).is_err());
    assert_eq!(proof.context, before);
    counts(&proof, 0);
}
