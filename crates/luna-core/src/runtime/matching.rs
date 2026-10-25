//! Command patterns, candidate ranking, and the same matching rules used by full help.
use super::{
    Run, explanation,
    index::{Part, Pattern},
};
use crate::TraceKind;
use anyhow::{Context, Result};
use luna_model::{Action, Exit, PatternPart};

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
}

impl<'a> Run<'a> {
    fn pattern_matches(
        &self,
        tokens: &[&str],
        pattern: &Pattern,
        route_destination: Option<&str>,
        named_route: bool,
    ) -> bool {
        let mut positions = std::collections::BTreeSet::from([0usize]);
        for part in &pattern.parts {
            let alternatives = match part {
                Part::Literal(words) => std::slice::from_ref(words),
                Part::Entity(entity) => {
                    if !self.available(entity) && route_destination != Some(entity.as_str()) {
                        return false;
                    }
                    self.index.names.get(entity).map_or(&[][..], Vec::as_slice)
                }
            };
            let mut next = std::collections::BTreeSet::new();
            for words in alternatives {
                if words.is_empty() {
                    continue;
                }
                for &position in &positions {
                    let starts = if named_route || matches!(part, Part::Entity(_)) {
                        self.entity_words.starts(tokens, position)
                    } else {
                        position..=position
                    };
                    for start in starts {
                        if word_prefix(&tokens[start..], words) {
                            next.insert(start + words.len());
                        }
                    }
                }
            }
            if next.is_empty() {
                return false;
            }
            positions = next;
        }
        positions.contains(&tokens.len())
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

    fn matches(
        &self,
        tokens: &[&str],
        verb: &str,
        pattern: &Pattern,
        route_destination: Option<&str>,
        named_route: bool,
    ) -> bool {
        self.index.verbs.get(verb).is_some_and(|verb| {
            verb.phrases.iter().any(|phrase| {
                word_prefix(tokens, phrase)
                    && self.pattern_matches(
                        &tokens[phrase.len()..],
                        pattern,
                        route_destination,
                        named_route,
                    )
            })
        })
    }

    pub(super) fn command_phrase(&self, verb: &str, pattern: &[PatternPart]) -> Option<String> {
        let mut words = vec![self.verb(verb)?.canonical.trim()];
        for part in pattern {
            words.push(match part {
                PatternPart::Literal { text } => text.trim(),
                PatternPart::Entity { entity } => self.entity_name(entity)?.trim(),
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
        mut recorder: Option<&mut explanation::Recorder>,
    ) -> Result<Vec<Candidate<'a>>> {
        let tokens = input.split_whitespace().collect::<Vec<_>>();
        let mut matches = vec![];
        for entry in self.index.actions(input, recorder.is_some()) {
            let owner = entry.owner.id(self.p);
            let available = self.available(owner);
            if !available && recorder.is_none() {
                continue;
            }
            let scope = entry.owner.scope();
            let a = &entry.owner.actions(self.p)[entry.position];
            let matched = available && self.matches(&tokens, &a.verb, &entry.pattern, None, false);
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
            if matched {
                matches.push(Candidate {
                    id: &a.id,
                    name: &a.name,
                    owner,
                    rank: (literals, entities, scope, a.priority),
                    handler: Handler::Action(a),
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
                if self.matches(
                    &tokens,
                    &exit.verb,
                    pattern,
                    Some(&exit.destination),
                    exit.pattern.is_empty(),
                ) {
                    let (literals, entities) = pattern.specificity;
                    matches.push(Candidate {
                        id: &exit.id,
                        name: &exit.name,
                        owner: &location.id,
                        rank: (literals, entities, 1, exit.priority),
                        handler: Handler::Exit(exit),
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
        matches.sort_by(|a, b| b.rank.cmp(&a.rank).then_with(|| a.id.cmp(b.id)));
        Ok(matches)
    }
}

fn word_prefix(tokens: &[&str], words: &[String]) -> bool {
    tokens.len() >= words.len() && tokens.iter().zip(words).all(|(token, word)| *token == word)
}
