//! Bounded, transactional noun clarification and recent object resolution.
use super::{
    Run,
    index::Owner,
    matching::{Candidate, Handler},
};
use crate::{
    ClarificationChoice, ClarificationQuestion, CommandStatus, InputResolution, NounBinding,
    NounOrigin, TraceSource, UnresolvedInputReason,
};
use anyhow::{Result, ensure};
use luna_model::{CommandAssistance, PatternPart, Placement, normalize};
use std::collections::{BTreeMap, BTreeSet};

const MAX_CHOICES: usize = 20;
const MAX_INTERPRETATIONS: usize = 256;
const MAX_NOUNS: usize = 32;
type Filters = BTreeMap<usize, BTreeSet<String>>;
type Identity = (String, Option<String>, Vec<String>);

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub(crate) struct InteractionContext {
    pub(crate) recent: Option<String>,
    pub(crate) pending: Option<Pending>,
}

impl InteractionContext {
    pub(crate) fn question(&self) -> Option<ClarificationQuestion> {
        self.pending
            .as_ref()
            .map(|pending| pending.question.clone())
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
struct Request {
    input: String,
    raw: String,
    reference: Option<String>,
    filters: Filters,
    replies: Vec<String>,
    history_truncated: bool,
}

impl Request {
    fn answer(&mut self, raw: &str) {
        self.replies.push(raw.to_owned());
        while self.replies.len() > 64
            || self.replies.iter().map(String::len).sum::<usize>() > 16 * 1024
        {
            self.replies.remove(0);
            self.history_truncated = true;
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct Pending {
    request: Request,
    pub(crate) slot: usize,
    pub(crate) choices: Vec<String>,
    alternatives: BTreeSet<Identity>,
    question: ClarificationQuestion,
}

fn pattern(candidate: Candidate<'_>) -> &[PatternPart] {
    match candidate.handler {
        Handler::Action(action) => &action.pattern,
        Handler::Exit(exit) => &exit.pattern,
    }
}

pub(super) fn bindings(candidate: Candidate<'_>) -> Vec<NounBinding> {
    let mut noun_index = 0;
    pattern(candidate)
        .iter()
        .enumerate()
        .filter_map(|(pattern_index, part)| {
            let (entity, command_item) = match part {
                PatternPart::Entity { entity } => (entity.as_str(), false),
                PatternPart::ObjectInput => (candidate.item?, true),
                PatternPart::Literal { .. } => return None,
            };
            let origin = if candidate.recent_nouns & 1u32.checked_shl(noun_index).unwrap_or(0) != 0
            {
                NounOrigin::RecentObject
            } else {
                NounOrigin::Name
            };
            noun_index += 1;
            Some(NounBinding {
                pattern_index,
                entity: entity.into(),
                command_item,
                origin,
            })
        })
        .collect()
}

fn nouns(candidate: Candidate<'_>) -> Vec<String> {
    bindings(candidate)
        .into_iter()
        .map(|binding| binding.entity)
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
    pattern(candidate)
        .iter()
        .map(|part| match part {
            PatternPart::Literal { text } => format!("literal:{}", normalize(text)),
            _ => "noun".into(),
        })
        .collect()
}

fn matches<'a>(
    run: &mut Run<'a>,
    input: &str,
    reference: Option<&str>,
) -> Result<Vec<Candidate<'a>>> {
    let mut recorder = run.recording.take();
    let result = (|| {
        let mut candidates = run.candidates(input, recorder.as_mut())?;
        if candidates.is_empty() && reference.is_some() {
            candidates = run.candidates_with_reference(input, recorder.as_mut(), reference)?;
        }
        run.candidate_trace(&candidates);
        if let Some(best) = candidates.first().copied() {
            candidates.retain(|candidate| {
                candidate.rank == best.rank && candidate.fallback == best.fallback
            });
        }
        candidates.dedup_by(|a, b| a.id == b.id && a.item == b.item);
        Ok(candidates)
    })();
    run.recording = recorder;
    result
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

fn qualification(run: &Run<'_>, id: &str) -> Option<String> {
    match &run.state.objects.get(id)?.placement {
        Placement::Inventory => Some("carried".into()),
        Placement::Inside { object } | Placement::On { object } if run.available(object) => {
            let relation = if matches!(run.state.objects[id].placement, Placement::Inside { .. }) {
                "inside"
            } else {
                "on"
            };
            Some(format!("{relation} {}", run.entity_name(object)?))
        }
        Placement::Location { location } if location == &run.state.location => {
            Some(format!("in {}", run.entity_name(location)?))
        }
        _ => None,
    }
}

fn question(
    run: &Run<'_>,
    request: &Request,
    offered: &[String],
    pattern_index: usize,
) -> ClarificationQuestion {
    let choices = offered
        .iter()
        .map(|id| {
            let name = run.entity_name(id).unwrap();
            let repeated = offered
                .iter()
                .filter(|other| normalize(run.entity_name(other).unwrap()) == normalize(name))
                .count()
                > 1;
            ClarificationChoice {
                entity: id.clone(),
                name: name.into(),
                qualification: repeated.then(|| qualification(run, id)).flatten(),
            }
        })
        .collect();
    ClarificationQuestion {
        original_command: request.raw.clone(),
        pattern_index,
        choices,
    }
}

fn waiting(
    run: &mut Run<'_>,
    context: &mut InteractionContext,
    pending: Pending,
    settings: &CommandAssistance,
    retry: bool,
) -> Result<()> {
    run.result.status = CommandStatus::Ambiguous;
    run.say(if retry {
        &settings.retry_text
    } else {
        &settings.clarification_text
    })?;
    for (index, choice) in pending.question.choices.iter().enumerate() {
        run.literal(&format!(
            "{}. {}{}",
            index + 1,
            choice.name,
            choice
                .qualification
                .as_ref()
                .map(|cue| format!(" · {cue}"))
                .unwrap_or_default()
        ));
    }
    run.literal("Reply with a name or number, type cancel, or enter a new command.");
    run.result.input_resolution = Some(InputResolution::Pending {
        question: pending.question.clone(),
        replies: pending.request.replies.clone(),
        history_truncated: pending.request.history_truncated,
    });
    context.pending = Some(pending);
    Ok(())
}

fn unavailable(
    run: &mut Run<'_>,
    input: &str,
    reason: UnresolvedInputReason,
    settings: &CommandAssistance,
) -> Result<()> {
    run.result.status = CommandStatus::Unmatched;
    if reason == UnresolvedInputReason::StaleQuestion {
        run.literal("That command has changed. Please type a new complete command.");
    } else {
        run.say(&settings.unavailable_reference_text)?;
    }
    run.result.input_resolution = Some(InputResolution::Unresolved {
        original_command: input.into(),
        reason,
    });
    Ok(())
}

fn too_many(run: &mut Run<'_>, request: Request, limit: &str) {
    run.result.status = CommandStatus::Ambiguous;
    run.literal("Too many matches. Please type a more specific complete command.");
    run.result.input_resolution = Some(InputResolution::TooMany {
        original_command: request.raw,
        limit: limit.into(),
    });
}

fn select<'a>(
    run: &mut Run<'a>,
    context: &mut InteractionContext,
    candidates: Vec<Candidate<'a>>,
    request: Request,
    settings: &CommandAssistance,
) -> Result<()> {
    context.pending = None;
    if let [candidate] = candidates.as_slice() {
        let candidate = *candidate;
        let mut bindings = bindings(candidate);
        for (slot, binding) in bindings.iter_mut().enumerate() {
            if request.filters.contains_key(&slot) {
                binding.origin = NounOrigin::Clarification;
            }
        }
        let recent = bindings
            .iter()
            .find(|binding| {
                matches!(
                    run.index.entities.get(&binding.entity),
                    Some(Owner::Object(_))
                )
            })
            .map(|binding| binding.entity.clone());
        run.result.input_resolution = Some(InputResolution::Resolved {
            original_command: request.raw,
            replies: request.replies,
            history_truncated: request.history_truncated,
            bindings,
        });
        run.dispatch(candidate, &request.input)?;
        if settings.recent_objects && recent.is_some() {
            context.recent = recent;
        }
        return Ok(());
    }
    let Some(first) = candidates.first().copied() else {
        return unavailable(
            run,
            &request.raw,
            UnresolvedInputReason::StaleQuestion,
            settings,
        );
    };
    if candidates.len() > MAX_INTERPRETATIONS {
        too_many(run, request, "interpretations");
        return Ok(());
    }
    if nouns(first).len() > MAX_NOUNS {
        too_many(run, request, "noun_slots");
        return Ok(());
    }
    let first_shape = shape(first);
    let compatible = candidates
        .iter()
        .all(|candidate| shape(*candidate) == first_shape);
    let slot = compatible
        .then(|| (0..nouns(first).len()).find(|&slot| choices(run, &candidates, slot).len() > 1))
        .flatten();
    if !settings.clarification || slot.is_none() {
        run.result.status = CommandStatus::Ambiguous;
        if !settings.clarification {
            run.literal(&format!("Please clarify your command: {}. Type a more specific command; nothing has changed.", candidates.iter().map(|candidate| match candidate.item { Some(id) => format!("{} ({})", candidate.name, run.entity_name(id).unwrap_or(id)), None => candidate.name.into() }).collect::<Vec<_>>().join(" or ")));
        } else {
            run.literal(
                "Please clarify your command. No action was selected; try a more specific command.",
            );
        }
        run.result.input_resolution = Some(InputResolution::AuthorAmbiguity {
            original_command: request.raw,
            flows: candidates
                .iter()
                .map(|candidate| TraceSource {
                    subject: candidate.id.into(),
                    path: "pattern".into(),
                })
                .collect(),
        });
        return Ok(());
    }
    let slot = slot.unwrap();
    let offered = choices(run, &candidates, slot);
    if offered.len() > MAX_CHOICES {
        too_many(run, request, "choices");
        return Ok(());
    }
    let view = question(run, &request, &offered, bindings(first)[slot].pattern_index);
    let alternatives = candidates
        .iter()
        .map(|candidate| identity(*candidate))
        .collect();
    waiting(
        run,
        context,
        Pending {
            request,
            slot,
            choices: offered,
            alternatives,
            question: view,
        },
        settings,
        false,
    )
}

fn reply(run: &Run<'_>, pending: &Pending, input: &str) -> BTreeSet<String> {
    if input.bytes().all(|byte| byte.is_ascii_digit()) {
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
            .request
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
        verb.phrases.iter().any(|phrase| {
            tokens.len() >= phrase.len()
                && tokens
                    .iter()
                    .zip(phrase)
                    .all(|(token, word)| *token == word)
        })
    })
}

pub(super) fn advance(
    run: &mut Run<'_>,
    context: &mut InteractionContext,
    raw: &str,
    settings: &CommandAssistance,
) -> Result<()> {
    let input = normalize(raw);
    // Read-only built-ins share entity resolution, but never choose new focus.
    run.context.recent = context.recent.clone();
    if input.is_empty()
        || super::host_control(raw).is_some()
        || matches!(input.as_str(), "look" | "inventory" | "help")
        || input.starts_with("help ")
    {
        run.command_explicit(raw)?;
        original_query(&mut run.result.input_resolution, raw);
        return Ok(());
    }
    if settings.clarification && input == "cancel" {
        ensure!(raw.len() <= 4096, "Command is too long");
        let original = context.pending.take().map(|pending| pending.request.raw);
        run.literal(if original.is_some() {
            "Command cancelled."
        } else {
            "No command is waiting for a choice."
        });
        run.result.input_resolution = Some(InputResolution::Cancelled {
            original_command: original,
        });
        return Ok(());
    }
    if input == "hint" || input.starts_with("hint ") || run.state.ending.is_some() {
        context.pending = None;
        run.command_explicit(raw)?;
        original_query(&mut run.result.input_resolution, raw);
        return Ok(());
    }
    ensure!(raw.len() <= 4096, "Command is too long");
    let reference = settings
        .recent_objects
        .then_some(context.recent.clone())
        .flatten();
    let candidates = matches(run, &input, reference.as_deref())?;
    if !candidates.is_empty() {
        let request = Request {
            input,
            raw: raw.into(),
            reference,
            filters: Filters::new(),
            replies: vec![],
            history_truncated: false,
        };
        return select(run, context, candidates, request, settings);
    }
    if let Some(mut pending) = context.pending.take() {
        let current = matches(
            run,
            &pending.request.input,
            pending.request.reference.as_deref(),
        )?;
        let candidates =
            current
                .into_iter()
                .filter(|candidate| {
                    let ids = nouns(*candidate);
                    pending.request.filters.iter().all(|(slot, allowed)| {
                        ids.get(*slot).is_some_and(|id| allowed.contains(id))
                    })
                })
                .collect::<Vec<_>>();
        if candidates.is_empty()
            || candidates
                .iter()
                .any(|candidate| !pending.alternatives.contains(&identity(*candidate)))
        {
            return unavailable(
                run,
                &pending.request.raw,
                UnresolvedInputReason::StaleQuestion,
                settings,
            );
        }
        let current = choices(run, &candidates, pending.slot);
        if current != pending.choices {
            pending.choices = current;
            pending.question = question(
                run,
                &pending.request,
                &pending.choices,
                pending.question.pattern_index,
            );
            return waiting(run, context, pending, settings, false);
        }
        let selected = reply(run, &pending, &input);
        if !selected.is_empty() {
            let candidates = candidates
                .into_iter()
                .filter(|candidate| selected.contains(&nouns(*candidate)[pending.slot]))
                .collect();
            pending.request.filters.insert(pending.slot, selected);
            pending.request.answer(raw);
            return select(run, context, candidates, pending.request, settings);
        }
        if !known_verb(run, &input) {
            return waiting(run, context, pending, settings, true);
        }
    }
    if settings.recent_objects
        && known_verb(run, &input)
        && input.split_whitespace().any(|word| word == "it")
    {
        if context.recent.is_none() {
            return unavailable(run, raw, UnresolvedInputReason::MissingReference, settings);
        }
        if context.recent.as_ref().is_some_and(|id| !run.available(id)) {
            return unavailable(run, raw, UnresolvedInputReason::OutOfScope, settings);
        }
    }
    run.command_explicit(raw)
}

fn original_query(resolution: &mut Option<InputResolution>, raw: &str) {
    if let Some(
        InputResolution::Resolved {
            original_command, ..
        }
        | InputResolution::Unresolved {
            original_command, ..
        },
    ) = resolution
    {
        *original_command = raw.into();
    }
}
