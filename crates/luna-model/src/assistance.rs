//! Authored parser assistance, with disabled defaults for legacy content.
use crate::*;

/// Optional content-3 parser behaviour and normally formatted response messages.
/// Missing settings retain legacy behaviour; new games opt in explicitly.
#[derive(Debug, Clone, Serialize, Deserialize, TS, PartialEq)]
#[serde(default, deny_unknown_fields)]
pub struct CommandAssistance {
    /// Ask for an entity choice before dispatching an ambiguous command.
    pub clarification: bool,
    /// Resolve `it` to the prior explicitly named object when still in scope.
    pub recent_objects: bool,
    /// Prompt preceding the generated literal numbered choices.
    pub clarification_text: String,
    /// Prompt used when an answer does not select an offered entity.
    pub retry_text: String,
    /// Generic response that does not disclose an unavailable object's identity.
    pub unavailable_reference_text: String,
}

impl Default for CommandAssistance {
    fn default() -> Self {
        Self {
            clarification: false,
            recent_objects: false,
            clarification_text: "Which do you mean?".into(),
            retry_text: "Please choose one of the listed items.".into(),
            unavailable_reference_text: "I can't tell what “it” refers to here. Use its full name."
                .into(),
        }
    }
}

impl CommandAssistance {
    /// Explicit new-game policy, distinct from missing/legacy settings.
    pub fn new_game() -> Self {
        Self {
            clarification: true,
            recent_objects: true,
            ..Self::default()
        }
    }
}

/// Flows whose whole input can be the assisted session command `cancel`.
/// Scope and requirements do not hide authoring collisions.
pub fn cancellation_conflicts(project: &Project) -> Vec<String> {
    project
        .owners()
        .into_iter()
        .flat_map(|(_, actions, _)| actions)
        .filter(|action| {
            action.pattern.is_empty()
                && project.vocabulary.iter().any(|verb| {
                    verb.id == action.verb
                        && std::iter::once(&verb.canonical)
                            .chain(&verb.synonyms)
                            .any(|phrase| normalize(phrase) == "cancel")
                })
        })
        .map(|action| action.id.clone())
        .collect()
}
