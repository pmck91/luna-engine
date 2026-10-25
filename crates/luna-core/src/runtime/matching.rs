//! Command patterns, candidate ranking, and the same matching rules used by full help.
use super::{Run, explanation};
use crate::TraceKind;
use anyhow::{Context, Result};
use luna_model::{Action, Exit, PatternPart, normalize};

#[derive(Clone)]
pub(super) enum Handler {
    Action(Action),
    Exit(Exit),
}
#[derive(Clone)]
pub(super) struct Candidate {
    pub(super) id: String,
    pub(super) name: String,
    pub(super) owner: String,
    pub(super) rank: (usize, usize, u8, i32),
    pub(super) handler: Handler,
}

impl<'a> Run<'a> {
    pub(super) fn pattern_matches(
        &self,
        tokens: &[&str],
        pattern: &[PatternPart],
        route_destination: Option<&str>,
        named_route: bool,
    ) -> bool {
        let mut positions = std::collections::BTreeSet::from([0usize]);
        for part in pattern {
            let alternatives = match part {
                PatternPart::Literal { text } => vec![if named_route {
                    self.entity_words.name(text)
                } else {
                    normalize(text)
                }],
                PatternPart::Entity { entity } => {
                    if !self.available(entity) && route_destination != Some(entity.as_str()) {
                        return false;
                    }
                    self.p
                        .entity_aliases(entity)
                        .into_iter()
                        .map(|name| self.entity_words.name(name))
                        .collect()
                }
            };
            let mut next = std::collections::BTreeSet::new();
            for alt in &alternatives {
                let words = alt.split_whitespace().collect::<Vec<_>>();
                if !words.is_empty() {
                    for position in &positions {
                        let starts = if named_route || matches!(part, PatternPart::Entity { .. }) {
                            self.entity_words.starts(tokens, *position)
                        } else {
                            *position..=*position
                        };
                        for start in starts {
                            if tokens[start..].starts_with(&words) {
                                next.insert(start + words.len());
                            }
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

    fn matches(
        &self,
        input: &str,
        verb: &str,
        pattern: &[PatternPart],
        route_destination: Option<&str>,
        named_route: bool,
    ) -> bool {
        self.verb(verb).is_some_and(|v| {
            std::iter::once(&v.canonical)
                .chain(&v.synonyms)
                .any(|name| {
                    let n = normalize(name);
                    if input == n {
                        self.pattern_matches(&[], pattern, route_destination, named_route)
                    } else {
                        input.strip_prefix(&(n + " ")).is_some_and(|rest| {
                            self.pattern_matches(
                                &rest.split_whitespace().collect::<Vec<_>>(),
                                pattern,
                                route_destination,
                                named_route,
                            )
                        })
                    }
                })
        })
    }

    pub(super) fn command_phrase(&self, verb: &str, pattern: &[PatternPart]) -> Option<String> {
        let mut words = vec![self.verb(verb)?.canonical.trim()];
        for part in pattern {
            words.push(match part {
                PatternPart::Literal { text } => text.trim(),
                PatternPart::Entity { entity } => self.p.entity_name(entity)?.trim(),
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
    ) -> Result<Vec<Candidate>> {
        let mut matches = vec![];
        for (owner, actions, _) in self.p.owners() {
            let available = self.available(owner);
            if !available && recorder.is_none() {
                continue;
            }
            let scope = if owner == self.p.game.id {
                0
            } else if self.location(owner).is_some() {
                1
            } else {
                2
            };
            for a in actions {
                let matched = available && self.matches(input, &a.verb, &a.pattern, None, false);
                if !matched && recorder.is_none() {
                    continue;
                }
                let (literals, entities) = specificity(&a.pattern);
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
                        id: a.id.clone(),
                        name: a.name.clone(),
                        owner: owner.into(),
                        rank: (literals, entities, scope, a.priority),
                        handler: Handler::Action(a.clone()),
                    });
                }
            }
        }
        let location = self
            .location(&self.state.location)
            .context("Unknown location")?;
        for exit in &location.exits {
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
            let patterns = if exit.pattern.is_empty() {
                std::iter::once(&exit.name)
                    .chain(&exit.aliases)
                    .map(|n| vec![PatternPart::Literal { text: n.clone() }])
                    .collect()
            } else {
                vec![exit.pattern.clone()]
            };
            for pattern in patterns {
                if self.matches(
                    input,
                    &exit.verb,
                    &pattern,
                    Some(&exit.destination),
                    exit.pattern.is_empty(),
                ) {
                    let (literals, entities) = if exit.pattern.is_empty() {
                        let PatternPart::Literal { text } = &pattern[0] else {
                            unreachable!()
                        };
                        (self.entity_words.name(text).split_whitespace().count(), 0)
                    } else {
                        specificity(&pattern)
                    };
                    matches.push(Candidate {
                        id: exit.id.clone(),
                        name: exit.name.clone(),
                        owner: location.id.clone(),
                        rank: (literals, entities, 1, exit.priority),
                        handler: Handler::Exit(exit.clone()),
                    });
                    matched_rank = Some((literals, entities));
                    break;
                }
            }
            if let Some(recorder) = recorder.as_deref_mut() {
                let (literals, targets) =
                    matched_rank.unwrap_or_else(|| specificity(&exit.pattern));
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
        matches.sort_by(|a, b| b.rank.cmp(&a.rank).then_with(|| a.id.cmp(&b.id)));
        Ok(matches)
    }
}

fn specificity(pattern: &[PatternPart]) -> (usize, usize) {
    pattern.iter().fold((0, 0), |(l, e), p| match p {
        PatternPart::Literal { text } => (l + normalize(text).split_whitespace().count(), e),
        PatternPart::Entity { .. } => (l, e + 1),
    })
}
