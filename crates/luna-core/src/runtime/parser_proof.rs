//! P1 feasibility proof, compiled only in tests; not a shipping parser mode.
//!
//! Interpretations come from the indexed matcher. Selected actions/exits use
//! the ordinary dispatcher inside Session's real commit/explanation boundary.
//! Only the pending-choice/reference coordinator is experimental here. This
//! does not install settings, public metadata, migrations, or a second executor.
use super::{Candidate, Handler, Owner, Run, word_prefix};
use crate::{CommandResult, CommandStatus, GameState, Session};
use anyhow::{Result, ensure};
use luna_model::{
    Action, ArithmeticOperation, Character, Condition, ContainerOpening, Effect, Ending, Event,
    Exit, Location, NumericOperand, Object, ObjectStorage, PatternPart, Placement, Project,
    StandardInteraction, Trigger, TriggerWatch, Value, ValueTarget, WatchMode, normalize,
    standard_action, text,
};
use std::collections::{BTreeMap, BTreeSet};

const MAX_CHOICES: usize = 20;
const MAX_INTERPRETATIONS: usize = 256;
const MAX_NOUNS: usize = 32;
type Filters = BTreeMap<usize, BTreeSet<String>>;
type Identity = (String, Option<String>, Vec<String>);

#[derive(Clone, Debug, Default, PartialEq, Eq)]
struct Context {
    recent: Option<String>,
    pending: Option<Pending>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
struct Pending {
    input: String,
    reference: Option<String>,
    filters: Filters,
    slot: usize,
    choices: Vec<String>,
    alternatives: BTreeSet<Identity>,
}

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

struct Proof {
    session: Session,
    context: Context,
    clarify: bool,
    pronouns: bool,
}

impl Proof {
    fn new(project: Project) -> Self {
        Self {
            session: Session::start(project, None).unwrap().0,
            context: Context::default(),
            clarify: true,
            pronouns: true,
        }
    }

    fn attempt(&mut self, input: &str, explain: bool) -> (Outcome, Option<anyhow::Error>) {
        let mut context = self.context.clone();
        let mut resolution = Resolution::Ordinary;
        let (result, error) = self.session.execute_with(input, explain, |run| {
            resolution = advance(run, &mut context, input, self.clarify, self.pronouns)?;
            Ok(())
        });
        if error.is_none() {
            self.context = context;
        }
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
        self.session.replace_state(state)?;
        self.context = Context::default();
        Ok(())
    }
}

// Projected noun IDs are sufficient for narrowing; no display-name substitution
// or copied/generated action is needed. P2 will retain typed slot provenance.
fn nouns(candidate: Candidate<'_>) -> Vec<String> {
    let pattern = match candidate.handler {
        Handler::Action(action) => &action.pattern,
        Handler::Exit(exit) => &exit.pattern,
    };
    pattern
        .iter()
        .filter_map(|part| match part {
            PatternPart::Entity { entity } => Some(entity.clone()),
            PatternPart::ObjectInput => candidate.item.map(str::to_owned),
            PatternPart::Literal { .. } => None,
        })
        .collect()
}

fn identity(candidate: Candidate<'_>) -> Identity {
    (
        candidate.id.into(),
        candidate.item.map(str::to_owned),
        nouns(candidate),
    )
}

fn shape(candidate: Candidate<'_>) -> Vec<String> {
    let pattern = match candidate.handler {
        Handler::Action(action) => &action.pattern,
        Handler::Exit(exit) => &exit.pattern,
    };
    pattern
        .iter()
        .map(|part| match part {
            PatternPart::Literal { text } => format!("literal:{}", normalize(text)),
            _ => "noun".into(),
        })
        .collect()
}

fn matches<'a>(run: &Run<'a>, input: &str, reference: Option<&str>) -> Result<Vec<Candidate<'a>>> {
    let mut candidates = run.candidates(input, None)?;
    // Preserve actual aliases/literals before considering the recent reference.
    if candidates.is_empty() && reference.is_some() {
        candidates = run.candidates_with_reference(input, None, reference)?;
    }
    if let Some(best) = candidates.first().copied() {
        candidates
            .retain(|candidate| candidate.rank == best.rank && candidate.fallback == best.fallback);
    }
    candidates.dedup_by(|a, b| a.id == b.id && a.item == b.item);
    Ok(candidates)
}

fn choices(run: &Run<'_>, candidates: &[Candidate<'_>], slot: usize) -> Vec<String> {
    let mut ids = candidates
        .iter()
        .map(|candidate| nouns(*candidate)[slot].clone())
        .collect::<BTreeSet<_>>()
        .into_iter()
        .collect::<Vec<_>>();
    ids.sort_by_cached_key(|id| (normalize(run.entity_name(id).unwrap()), id.clone()));
    ids
}

fn waiting(run: &mut Run<'_>, context: &mut Context, pending: Pending) -> Resolution {
    run.result.status = CommandStatus::Ambiguous;
    run.literal("Which do you mean?");
    for (index, id) in pending.choices.iter().enumerate() {
        run.literal(&format!("{}. {}", index + 1, run.entity_name(id).unwrap()));
    }
    let result = Resolution::Waiting {
        slot: pending.slot,
        choices: pending.choices.clone(),
    };
    context.pending = Some(pending);
    result
}

fn select<'a>(
    run: &mut Run<'a>,
    context: &mut Context,
    input: &str,
    candidates: Vec<Candidate<'a>>,
    filters: Filters,
    reference: Option<String>,
    clarify: bool,
) -> Result<Resolution> {
    if let [candidate] = candidates.as_slice() {
        let candidate = *candidate;
        let ids = nouns(candidate);
        let result = Resolution::Selected {
            flow: candidate.id.into(),
            nouns: ids.clone(),
        };
        let recent = ids
            .iter()
            .find(|id| matches!(run.index.entities.get(id.as_str()), Some(Owner::Object(_))))
            .cloned();
        context.pending = None;
        run.dispatch(candidate, input)?;
        if recent.is_some() {
            context.recent = recent;
        }
        return Ok(result);
    }
    let Some(first) = candidates.first().copied() else {
        context.pending = None;
        run.result.status = CommandStatus::Unmatched;
        run.literal("That command is no longer available.");
        return Ok(Resolution::Unavailable);
    };
    let first_shape = shape(first);
    if candidates.len() > MAX_INTERPRETATIONS || nouns(first).len() > MAX_NOUNS {
        context.pending = None;
        run.result.status = CommandStatus::Ambiguous;
        run.literal("Too many interpretations. Please type a more specific complete command.");
        return Ok(Resolution::TooMany);
    }
    let compatible = candidates
        .iter()
        .all(|candidate| shape(*candidate) == first_shape);
    let slot = compatible
        .then(|| (0..nouns(first).len()).find(|&slot| choices(run, &candidates, slot).len() > 1))
        .flatten();
    if !clarify || slot.is_none() {
        context.pending = None;
        run.result.status = CommandStatus::Ambiguous;
        run.literal("Please use a more specific command; nothing has changed.");
        return Ok(Resolution::AuthorAmbiguity);
    }
    let slot = slot.unwrap();
    let offered = choices(run, &candidates, slot);
    if offered.len() > MAX_CHOICES {
        context.pending = None;
        run.result.status = CommandStatus::Ambiguous;
        run.literal("Too many matches. Please type a more specific complete command.");
        return Ok(Resolution::TooMany);
    }
    Ok(waiting(
        run,
        context,
        Pending {
            input: input.into(),
            reference,
            filters,
            slot,
            choices: offered,
            alternatives: candidates
                .iter()
                .map(|candidate| identity(*candidate))
                .collect(),
        },
    ))
}

fn reply(run: &Run<'_>, pending: &Pending, input: &str) -> BTreeSet<String> {
    if input.bytes().all(|b| b.is_ascii_digit()) {
        return input
            .parse::<usize>()
            .ok()
            .and_then(|n| n.checked_sub(1))
            .and_then(|index| pending.choices.get(index))
            .cloned()
            .into_iter()
            .collect();
    }
    let tokens = input.split_whitespace().collect::<Vec<_>>();
    let named = pending
        .choices
        .iter()
        .filter(|id| run.entity_matches(&tokens, id))
        .cloned()
        .collect::<BTreeSet<_>>();
    if !named.is_empty() {
        return named;
    }
    if input == "it" {
        return pending
            .reference
            .as_ref()
            .filter(|id| run.available(id) && pending.choices.contains(id))
            .cloned()
            .into_iter()
            .collect();
    }
    pending
        .choices
        .iter()
        .filter(|id| {
            run.index.names[*id].iter().any(|name| {
                run.entity_words.starts(&tokens, 0).any(|start| {
                    let fragment = &tokens[start..];
                    !fragment.is_empty()
                        && name.windows(fragment.len()).any(|words| {
                            words
                                .iter()
                                .zip(fragment)
                                .all(|(word, token)| word == token)
                        })
                })
            })
        })
        .cloned()
        .collect()
}

fn known_verb(run: &Run<'_>, input: &str) -> bool {
    let tokens = input.split_whitespace().collect::<Vec<_>>();
    run.index.verbs.values().any(|verb| {
        verb.phrases
            .iter()
            .any(|phrase| word_prefix(&tokens, phrase))
    })
}

fn advance(
    run: &mut Run<'_>,
    context: &mut Context,
    raw: &str,
    clarify: bool,
    pronouns: bool,
) -> Result<Resolution> {
    let input = normalize(raw);
    if !clarify && !pronouns {
        *context = Context::default();
        run.command(raw)?;
        return Ok(Resolution::Ordinary);
    }
    let control = super::super::host_control(raw);
    if input.is_empty()
        || control.is_some()
        || matches!(input.as_str(), "look" | "inventory" | "help")
        || input.starts_with("help ")
    {
        run.command(raw)?;
        return Ok(Resolution::Ordinary);
    }
    if input == "hint" || input.starts_with("hint ") || run.state.ending.is_some() {
        context.pending = None;
        run.command(raw)?;
        return Ok(Resolution::Ordinary);
    }
    ensure!(raw.len() <= 4096, "Command is too long");
    if clarify && input == "cancel" {
        context.pending = None;
        run.literal("Command cancelled.");
        return Ok(Resolution::Cancelled);
    }
    let reference = pronouns.then_some(context.recent.clone()).flatten();
    let candidates = matches(run, &input, reference.as_deref())?;
    if !candidates.is_empty() {
        return select(
            run,
            context,
            &input,
            candidates,
            Filters::new(),
            reference,
            clarify,
        );
    }
    if let Some(mut pending) = context.pending.take() {
        let current = matches(run, &pending.input, pending.reference.as_deref())?;
        let candidates = current
            .into_iter()
            .filter(|candidate| {
                let ids = nouns(*candidate);
                pending
                    .filters
                    .iter()
                    .all(|(slot, allowed)| ids.get(*slot).is_some_and(|id| allowed.contains(id)))
            })
            .collect::<Vec<_>>();
        if candidates
            .iter()
            .any(|candidate| !pending.alternatives.contains(&identity(*candidate)))
        {
            run.result.status = CommandStatus::Unmatched;
            run.literal("That command has changed. Please type a new complete command.");
            return Ok(Resolution::Unavailable);
        }
        if candidates.is_empty() {
            run.result.status = CommandStatus::Unmatched;
            run.literal("That command is no longer available.");
            return Ok(Resolution::Unavailable);
        }
        // Never reinterpret a displayed number after the offered scope changes.
        let current = choices(run, &candidates, pending.slot);
        if current != pending.choices {
            pending.choices = current;
            return Ok(waiting(run, context, pending));
        }
        let selected = reply(run, &pending, &input);
        if !selected.is_empty() {
            let candidates = candidates
                .into_iter()
                .filter(|candidate| selected.contains(&nouns(*candidate)[pending.slot]))
                .collect();
            pending.filters.insert(pending.slot, selected);
            return select(
                run,
                context,
                &pending.input,
                candidates,
                pending.filters,
                pending.reference,
                clarify,
            );
        }
        if !known_verb(run, &input) {
            return Ok(waiting(run, context, pending));
        }
    }
    if pronouns && known_verb(run, &input) && input.split_whitespace().any(|word| word == "it") {
        run.result.status = CommandStatus::Unmatched;
        run.literal("I can't tell what “it” refers to here. Use its full name.");
        return Ok(Resolution::Unavailable);
    }
    run.command(raw)?;
    Ok(Resolution::Ordinary)
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
    proof.session.replace_state(state).unwrap();
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
    let mut p = world();
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
    proof.command("take key").unwrap();
    assert_eq!(
        proof.command("cancel").unwrap().resolution,
        Resolution::Cancelled
    );
    assert!(proof.context.pending.is_none());
    counts(&proof, 0);
    proof.clarify = false;
    proof.command("cancel").unwrap();
    counts(&proof, 1);
}

#[test]
fn a_changed_offered_set_never_reuses_old_number_meanings() {
    let mut proof = Proof::new(world());
    proof.command("take key").unwrap();
    let mut state = proof.session.state().clone();
    state.objects.get_mut("brass").unwrap().hidden = true;
    proof.session.replace_state(state).unwrap();
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
    proof.session.replace_state(state).unwrap();
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
        proof.session.replace_state(state).unwrap();
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
    let p = world();
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
        context: Context::default(),
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

#[test]
#[ignore = "release-only measurements; no timing assertions"]
fn scaling() {
    use std::{hint::black_box, time::Instant};
    fn measure<T>(mut operation: impl FnMut() -> T) -> f64 {
        let start = Instant::now();
        for _ in 0..30 {
            black_box(operation());
        }
        start.elapsed().as_secs_f64() * 1000.0 / 30.0
    }
    println!("objects,measurement,milliseconds");
    for count in [100, 1000, 5000] {
        let mut p = world();
        for index in 0..count - p.objects.len() {
            let id = format!("token-{index}");
            p.objects.push(Object {
                id: id.clone(),
                name: format!("Token {index}"),
                aliases: vec!["key".into()],
                placement: Placement::Inventory,
                actions: vec![action(&format!("take-{id}"), "take", vec![entity(&id)])],
                ..Default::default()
            });
        }
        let mut proof = Proof::new(p);
        let run = Run::view(proof.session.definition(), proof.session.state());
        let baseline = measure(|| run.candidates("take brass key", None).unwrap());
        let explicit = measure(|| matches(&run, "take brass key", Some("silver")).unwrap());
        let reference = measure(|| matches(&run, "take it", Some("brass")).unwrap());
        let crowded = measure(|| matches(&run, "take key", None).unwrap());
        let question = measure(|| {
            assert_eq!(
                proof.command("take key").unwrap().resolution,
                Resolution::TooMany
            )
        });
        for (label, timing) in [
            ("explicit_match", baseline),
            ("explicit_assisted_match", explicit),
            ("reference_match", reference),
            ("ambiguous_match", crowded),
            ("bounded_question_transaction", question),
        ] {
            println!("{count},{label},{timing:.6}");
        }
    }
}
