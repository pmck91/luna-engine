//! Command patterns, candidate ranking, and the same matching rules used by full help.
use super::{
    Run, explanation,
    index::{Owner, Part, Pattern},
};
use crate::TraceKind;
use anyhow::{Context, Result};
use luna_model::{Action, Exit, PatternPart};

// C0 experiment only: no new model variants, handlers, or wire formats ship here.
#[cfg(test)]
#[path = "container_proof.rs"]
mod container_proof;

#[derive(Clone, Copy)]
pub(super) enum Handler<'a> {
    Action(&'a Action),
    Exit(&'a Exit),
}
#[derive(Clone, Copy)]
pub(super) struct Candidate<'a> {
    pub(super) id: &'a str,
    pub(super) name: &'a str,
    pub(super) owner: &'a str,
    pub(super) rank: (usize, usize, u8, i32),
    pub(super) handler: Handler<'a>,
    pub(super) item: Option<&'a str>,
    pub(super) fallback: bool,
    pub(super) recent_nouns: u32,
}

impl<'a> Run<'a> {
    pub(super) fn candidate_trace(&mut self, candidates: &[Candidate<'_>]) {
        for m in candidates {
            self.result.trace.push(format!("Candidate '{}' [{}]: literal specificity {}, bound targets {}, scope {}, priority {}", m.name, m.id, m.rank.0, m.rank.1, match m.rank.2 { 2 => "object/character", 1 => "location", _ => "global" }, m.rank.3));
        }
    }

    fn pattern_bindings(
        &self,
        tokens: &[&str],
        pattern: &Pattern,
        route_destination: Option<&str>,
        named_route: bool,
        reference: Option<&str>,
    ) -> Vec<(Option<&'a str>, u32)> {
        let mut positions = std::collections::BTreeSet::from([(0usize, None, 0u32)]);
        let mut noun_index = 0u32;
        for part in &pattern.parts {
            let noun_bit = if matches!(part, Part::Entity(_) | Part::ObjectInput) {
                let bit = 1u32.checked_shl(noun_index).unwrap_or(0);
                noun_index += 1;
                bit
            } else {
                0
            };
            if matches!(part, Part::ObjectInput) {
                let mut next = std::collections::BTreeSet::new();
                if let Some(names) = &self.index.object_names {
                    for &(position, bound, provenance) in &positions {
                        for start in self.entity_words.starts(tokens, position) {
                            for (end, index) in names.matches(tokens, start) {
                                let id = self.p.objects[index].id.as_str();
                                if self.available(id) && bound.is_none_or(|prior| prior == id) {
                                    next.insert((end, Some(id), provenance));
                                }
                            }
                            if noun_bit != 0
                                && tokens.get(start) == Some(&"it")
                                && let Some(Owner::Object(index)) =
                                    reference.and_then(|id| self.index.entities.get(id))
                            {
                                let id = self.p.objects[*index].id.as_str();
                                if self.available(id) && bound.is_none_or(|prior| prior == id) {
                                    next.insert((start + 1, Some(id), provenance | noun_bit));
                                }
                            }
                        }
                    }
                }
                positions = next;
                continue;
            }
            let alternatives = match part {
                Part::Literal(words) => std::slice::from_ref(words),
                Part::Entity(entity) => {
                    if !self.available(entity) && route_destination != Some(entity.as_str()) {
                        return vec![];
                    }
                    self.index.names.get(entity).map_or(&[][..], Vec::as_slice)
                }
                Part::ObjectInput => unreachable!(),
            };
            let mut next = std::collections::BTreeSet::new();
            if let Part::Entity(entity) = part
                && noun_bit != 0
                && reference == Some(entity.as_str())
                && matches!(self.index.entities.get(entity), Some(Owner::Object(_)))
            {
                for &(position, bound, provenance) in &positions {
                    for start in self.entity_words.starts(tokens, position) {
                        if tokens.get(start) == Some(&"it") {
                            next.insert((start + 1, bound, provenance | noun_bit));
                        }
                    }
                }
            }
            for words in alternatives {
                if words.is_empty() {
                    continue;
                }
                for &(position, bound, provenance) in &positions {
                    let starts = if named_route || matches!(part, Part::Entity(_)) {
                        self.entity_words.starts(tokens, position)
                    } else {
                        position..=position
                    };
                    for start in starts {
                        if word_prefix(&tokens[start..], words) {
                            next.insert((start + words.len(), bound, provenance));
                        }
                    }
                }
            }
            if next.is_empty() {
                return vec![];
            }
            positions = next;
        }
        positions
            .into_iter()
            .filter_map(|(end, bound, provenance)| {
                (end == tokens.len()).then_some((bound, provenance))
            })
            .collect()
    }

    fn match_bindings(
        &self,
        tokens: &[&str],
        verb: &str,
        pattern: &Pattern,
        reference: Option<&str>,
    ) -> Vec<(Option<&'a str>, u32)> {
        let mut bindings = std::collections::BTreeSet::new();
        if let Some(verb) = self.index.verbs.get(verb) {
            for phrase in &verb.phrases {
                if word_prefix(tokens, phrase) {
                    bindings.extend(self.pattern_bindings(
                        &tokens[phrase.len()..],
                        pattern,
                        None,
                        false,
                        reference,
                    ));
                }
            }
        }
        bindings.into_iter().collect()
    }

    pub(super) fn entity_matches(&self, tokens: &[&str], id: &str) -> bool {
        self.available(id)
            && self.index.names.get(id).is_some_and(|names| {
                names.iter().any(|words| {
                    !words.is_empty()
                        && self.entity_words.starts(tokens, 0).any(|start| {
                            tokens.len() - start == words.len()
                                && word_prefix(&tokens[start..], words)
                        })
                })
            })
    }

    fn route_binding(
        &self,
        tokens: &[&str],
        verb: &str,
        pattern: &Pattern,
        route_destination: Option<&str>,
        named_route: bool,
        reference: Option<&str>,
    ) -> Option<u32> {
        self.index
            .verbs
            .get(verb)?
            .phrases
            .iter()
            .find_map(|phrase| {
                if !word_prefix(tokens, phrase) {
                    return None;
                }
                self.pattern_bindings(
                    &tokens[phrase.len()..],
                    pattern,
                    route_destination,
                    named_route,
                    reference,
                )
                .first()
                .map(|binding| binding.1)
            })
    }

    #[cfg(test)]
    fn matches(
        &self,
        tokens: &[&str],
        verb: &str,
        pattern: &Pattern,
        route_destination: Option<&str>,
        named_route: bool,
        reference: Option<&str>,
    ) -> bool {
        self.route_binding(
            tokens,
            verb,
            pattern,
            route_destination,
            named_route,
            reference,
        )
        .is_some()
    }

    pub(super) fn command_phrase(&self, verb: &str, pattern: &[PatternPart]) -> Option<String> {
        self.command_phrase_with_item(verb, pattern, None)
    }
    pub(super) fn command_phrase_with_item(
        &self,
        verb: &str,
        pattern: &[PatternPart],
        item: Option<&str>,
    ) -> Option<String> {
        let mut words = vec![self.verb(verb)?.canonical.trim()];
        for part in pattern {
            words.push(match part {
                PatternPart::Literal { text } => text.trim(),
                PatternPart::Entity { entity } => self.entity_name(entity)?.trim(),
                PatternPart::ObjectInput => {
                    item.and_then(|id| self.entity_name(id)).unwrap_or("<item>")
                }
            });
        }
        Some(words.join(" "))
    }

    pub(super) fn concerns_entity(owner: &str, pattern: &[PatternPart], entity: &str) -> bool {
        owner == entity
            || pattern.iter().any(
                |part| matches!(part, PatternPart::Entity { entity: target } if target == entity),
            )
    }

    pub(super) fn candidates(
        &self,
        input: &str,
        recorder: Option<&mut explanation::Recorder>,
    ) -> Result<Vec<Candidate<'a>>> {
        self.candidates_with_reference(input, recorder, None)
    }

    // Only noun slots can consume the supplied object reference. Callers must
    // prefer ordinary matches first so literal/name matches keep their meaning.
    pub(super) fn candidates_with_reference(
        &self,
        input: &str,
        mut recorder: Option<&mut explanation::Recorder>,
        reference: Option<&str>,
    ) -> Result<Vec<Candidate<'a>>> {
        let tokens = input.split_whitespace().collect::<Vec<_>>();
        let mut matches = vec![];
        for entry in self.index.actions(input, recorder.is_some()) {
            let owner = entry.owner.id(self.p);
            let a = &entry.owner.actions(self.p)[entry.position];
            let available = self.available(owner) && a.standard.as_ref().is_none_or(|s| s.enabled);
            if !available && recorder.is_none() {
                continue;
            }
            let scope = entry.owner.scope();
            let bindings = if available {
                self.match_bindings(&tokens, &a.verb, &entry.pattern, reference)
            } else {
                vec![]
            };
            let matched = !bindings.is_empty();
            if !matched && recorder.is_none() {
                continue;
            }
            let (literals, entities) = entry.pattern.specificity;
            if let Some(recorder) = recorder.as_deref_mut() {
                recorder.candidate(
                    &a.id,
                    "pattern",
                    TraceKind::Candidate {
                        name: a.name.clone(),
                        matched,
                        reason: if !available {
                            "Owner is outside the current command scope"
                        } else if matched {
                            "Verb, pattern, and target scope matched"
                        } else {
                            "Verb, pattern, or target scope did not match"
                        }
                        .into(),
                        literals,
                        targets: entities,
                        scope: match scope {
                            2 => "object/character",
                            1 => "location",
                            _ => "global",
                        }
                        .into(),
                        priority: a.priority,
                    },
                );
            }
            let mut prior = None;
            for (item, recent_nouns) in bindings {
                if prior == Some(item) {
                    continue;
                }
                prior = Some(item);
                matches.push(Candidate {
                    id: &a.id,
                    name: &a.name,
                    owner,
                    rank: (literals, entities, scope, a.priority),
                    handler: Handler::Action(a),
                    item,
                    fallback: a.standard.is_some(),
                    recent_nouns,
                });
            }
        }
        let location = self
            .location(&self.state.location)
            .context("Unknown location")?;
        let super::index::Owner::Location(location_index) = self.index.entities[&location.id]
        else {
            unreachable!("validated location index")
        };
        for (exit_index, exit) in location.exits.iter().enumerate() {
            if !self.condition(&exit.visible) {
                if let Some(recorder) = recorder.as_deref_mut() {
                    recorder.candidate(
                        &exit.id,
                        "visible",
                        TraceKind::Candidate {
                            name: exit.name.clone(),
                            matched: false,
                            reason: "Exit is hidden".into(),
                            literals: 0,
                            targets: 0,
                            scope: "location".into(),
                            priority: exit.priority,
                        },
                    );
                }
                continue;
            }
            let mut matched_rank = None;
            let patterns = &self.index.exits[location_index][exit_index];
            for pattern in patterns {
                if let Some(recent_nouns) = self.route_binding(
                    &tokens,
                    &exit.verb,
                    pattern,
                    Some(&exit.destination),
                    exit.pattern.is_empty(),
                    reference,
                ) {
                    let (literals, entities) = pattern.specificity;
                    matches.push(Candidate {
                        id: &exit.id,
                        name: &exit.name,
                        owner: &location.id,
                        rank: (literals, entities, 1, exit.priority),
                        handler: Handler::Exit(exit),
                        item: None,
                        fallback: false,
                        recent_nouns,
                    });
                    matched_rank = Some((literals, entities));
                    break;
                }
            }
            if let Some(recorder) = recorder.as_deref_mut() {
                let (literals, targets) = matched_rank.unwrap_or_else(|| {
                    if exit.pattern.is_empty() {
                        (0, 0)
                    } else {
                        patterns[0].specificity
                    }
                });
                recorder.candidate(
                    &exit.id,
                    "pattern",
                    TraceKind::Candidate {
                        name: exit.name.clone(),
                        matched: matched_rank.is_some(),
                        reason: if matched_rank.is_some() {
                            "Verb, route, and target scope matched"
                        } else {
                            "Verb, route, or target scope did not match"
                        }
                        .into(),
                        literals,
                        targets,
                        scope: "location".into(),
                        priority: exit.priority,
                    },
                );
            }
        }
        matches.sort_by(|a, b| {
            a.fallback
                .cmp(&b.fallback)
                .then_with(|| b.rank.cmp(&a.rank))
                .then_with(|| a.id.cmp(b.id))
                .then_with(|| a.item.cmp(&b.item))
        });
        Ok(matches)
    }
}

fn word_prefix(tokens: &[&str], words: &[String]) -> bool {
    tokens.len() >= words.len() && tokens.iter().zip(words).all(|(token, word)| *token == word)
}
