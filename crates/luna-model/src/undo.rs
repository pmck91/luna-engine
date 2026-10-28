//! Authored opt-in validation; history itself is native session state, never content.
use crate::*;

/// Stable action/exit identities whose full normalized command is bare `undo`.
///
/// Inspect all scopes independently of visibility, availability and requirements.
/// Templates and drafts remain editable; their actions are checked on promotion.
/// Entity nouns and longer commands are distinct from the exact control.
pub fn player_undo_command_conflicts(project: &Project) -> Vec<String> {
    fn matches(project: &Project, verb: &str, pattern: &[PatternPart]) -> bool {
        let Some(verb) = project.vocabulary.iter().find(|v| v.id == verb) else {
            return false;
        };
        std::iter::once(&verb.canonical)
            .chain(&verb.synonyms)
            .any(|phrase| {
                let mut parts = vec![phrase.as_str()];
                for part in pattern {
                    match part {
                        PatternPart::Literal { text } => parts.push(text),
                        _ => return false,
                    }
                }
                normalize(&parts.join(" ")) == "undo"
            })
    }
    let mut result = vec![];
    for (_, actions, _) in project.owners() {
        result.extend(
            actions
                .iter()
                .filter(|a| matches(project, &a.verb, &a.pattern))
                .map(|a| a.id.clone()),
        );
    }
    for room in &project.locations {
        for exit in &room.exits {
            let pattern = if exit.pattern.is_empty() {
                vec![PatternPart::Literal {
                    text: exit.name.clone(),
                }]
            } else {
                exit.pattern.clone()
            };
            if matches(project, &exit.verb, &pattern) {
                result.push(exit.id.clone());
            }
        }
    }
    result.sort();
    result
}
