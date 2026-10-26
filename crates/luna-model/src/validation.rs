use crate::*;
use serde_json::json;
use sha2::{Digest, Sha256};
use std::collections::{BTreeMap, BTreeSet};

#[derive(Debug, Clone, Serialize, Deserialize, TS, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum Severity {
    Error,
    Warning,
}
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
pub struct Diagnostic {
    pub severity: Severity,
    pub subject: String,
    pub field: String,
    pub message: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub warning_key: Option<String>,
}
pub fn normalize(input: &str) -> String {
    input
        .chars()
        .flat_map(char::to_lowercase)
        .map(|c| if c.is_alphanumeric() { c } else { ' ' })
        .collect::<String>()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}
pub fn reserved(input: &str) -> bool {
    let n = normalize(input);
    RESERVED.contains(&n.as_str())
        || n.starts_with("save ")
        || n.starts_with("load ")
        || n.starts_with("help ")
        || n.starts_with("hint ")
}
pub fn safe_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 120
        && id != "."
        && id != ".."
        && id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || "-_.".contains(c))
}
pub fn safe_asset(path: &str) -> bool {
    path.starts_with("assets/")
        && !path.contains('\\')
        && path
            .split('/')
            .all(|s| !s.is_empty() && s != "." && s != ".." && !s.chars().any(char::is_control))
}
pub fn has_errors(diagnostics: &[Diagnostic]) -> bool {
    diagnostics.iter().any(|d| d.severity == Severity::Error)
}
fn flow_warning_context(project: &Project, id: &str) -> serde_json::Value {
    for (owner, actions, triggers) in project.owners() {
        if let Some(action) = actions.iter().find(|action| action.id == id) {
            return json!([
                owner,
                action.verb,
                action.pattern,
                action.priority,
                action.requirements
            ]);
        }
        if let Some(trigger) = triggers.iter().find(|trigger| trigger.id == id) {
            return json!([
                owner,
                trigger.event,
                trigger.watch,
                trigger.priority,
                trigger.condition
            ]);
        }
    }
    for room in &project.locations {
        if let Some(exit) = room.exits.iter().find(|exit| exit.id == id) {
            return json!([
                room.id,
                exit.verb,
                exit.pattern,
                exit.name,
                exit.aliases,
                exit.priority,
                exit.visible,
                exit.available
            ]);
        }
    }
    serde_json::Value::Null
}
struct Check<'a> {
    p: &'a Project,
    diagnostics: Vec<Diagnostic>,
    ids: BTreeSet<String>,
    item_input: bool,
}
impl Check<'_> {
    fn report(
        &mut self,
        severity: Severity,
        subject: &str,
        field: &str,
        message: impl Into<String>,
        warning_key: Option<String>,
    ) {
        self.diagnostics.push(Diagnostic {
            severity,
            subject: subject.into(),
            field: field.into(),
            message: message.into(),
            warning_key,
        })
    }
    fn error(&mut self, s: &str, f: &str, m: impl Into<String>) {
        self.report(Severity::Error, s, f, m, None)
    }
    fn warn(
        &mut self,
        code: &str,
        s: &str,
        f: &str,
        m: impl Into<String>,
        context: serde_json::Value,
    ) {
        let message = m.into();
        // Scope acknowledgement to this warning and its cause, excluding editor metadata
        // and unrelated authoring edits. Version the identity if a rule changes meaning.
        let key = format!(
            "{:x}",
            Sha256::digest(json!(["warning-v1", code, s, f, message, context]).to_string())
        );
        self.report(Severity::Warning, s, f, message, Some(key))
    }
    fn id(&mut self, id: &str, field: &str) {
        if !safe_id(id) {
            self.error(
                id,
                field,
                "ID must contain 1–120 ASCII letters, digits, hyphens, underscores, or dots",
            )
        }
        if !self.ids.insert(id.into()) {
            self.error(id, field, format!("Duplicate stable ID: {id}"))
        }
    }
    fn text(&mut self, s: &str, f: &str, t: &str) {
        if let Err(e) = text::format(t, |reference| {
            self.p
                .initial_text_value(reference)
                .map(ToString::to_string)
                .ok_or_else(|| anyhow::anyhow!("Unknown message value: %{reference}%"))
        }) {
            self.error(s, f, e.to_string())
        }
    }
    fn entity(&mut self, s: &str, f: &str, id: &str) {
        if self.p.entity_name(id).is_none() {
            self.error(s, f, format!("Missing entity: {id}"))
        }
    }
    fn object(&mut self, s: &str, f: &str, id: &str) {
        if !self.p.objects.iter().any(|e| e.id == id) {
            self.error(s, f, format!("Missing object: {id}"))
        }
    }
    fn character(&mut self, s: &str, f: &str, id: &str) {
        if !self.p.characters.iter().any(|e| e.id == id) {
            self.error(s, f, format!("Missing character: {id}"))
        }
    }
    fn location(&mut self, s: &str, f: &str, id: &str) {
        if !self.p.locations.iter().any(|e| e.id == id) {
            self.error(s, f, format!("Missing location: {id}"))
        }
    }
    fn v2(&mut self, s: &str, f: &str) {
        if self.p.game.format_version < 2 {
            self.error(
                s,
                f,
                "This feature requires an explicit upgrade to content format 2",
            );
        }
    }
    fn target(&mut self, s: &str, f: &str, target: &ObjectTarget) {
        match target {
            ObjectTarget::Fixed(id) => self.object(s, f, id),
            ObjectTarget::Input { .. } if !self.item_input => {
                self.error(s, f, "Command item is not declared by this action")
            }
            ObjectTarget::Input { .. } => {}
        }
    }
    fn parent(&mut self, s: &str, f: &str, id: &str, relation: ContentRelation) {
        self.object(s, f, id);
        if let Some(parent) = self.p.objects.iter().find(|o| o.id == id)
            && match relation {
                ContentRelation::Inside => parent.storage.unwrap_or_default().container.is_none(),
                ContentRelation::On => !parent.storage.unwrap_or_default().surface,
            }
        {
            self.error(
                s,
                f,
                if relation == ContentRelation::Inside {
                    "Target cannot contain items"
                } else {
                    "Target has no top surface"
                },
            );
        }
    }
    fn placement(&mut self, s: &str, f: &str, placement: &Placement, scripted: bool) {
        match placement {
            Placement::Location { location } if scripted && location == "@current" => {}
            Placement::Location { location } => self.location(s, f, location),
            Placement::Character { character } => self.character(s, f, character),
            Placement::Inside { object } => {
                self.v2(s, f);
                self.parent(s, f, object, ContentRelation::Inside);
            }
            Placement::On { object } => {
                self.v2(s, f);
                self.parent(s, f, object, ContentRelation::On);
            }
            Placement::Absent if scripted => {
                self.error(s, f, "Use REMOVE to park an object offstage")
            }
            Placement::Inventory | Placement::Absent => {}
        }
    }
    fn value(
        &mut self,
        s: &str,
        f: &str,
        schema: Option<&Value>,
        value: &Value,
        op: Option<Comparison>,
    ) {
        match schema {
            None => self.error(s, f, "Unknown variable/property"),
            Some(v) if !v.same_type(value) => self.error(s, f, "Value has an incompatible type"),
            _ => {}
        }
        if op.is_some_and(|o| !matches!(o, Comparison::Eq | Comparison::Ne))
            && !matches!(value, Value::Integer(_))
        {
            self.error(s, f, "Ordered comparisons require integers")
        }
    }
    fn integer(&mut self, s: &str, f: &str, schema: Option<&Value>) {
        match schema {
            None => self.error(s, f, "Unknown variable/property"),
            Some(Value::Integer(_)) => {}
            Some(_) => self.error(s, f, "Arithmetic requires integers"),
        }
    }
    fn operand(&mut self, s: &str, f: &str, op: ArithmeticOperation, operand: &NumericOperand) {
        let f = format!("{f}.operand");
        match operand {
            NumericOperand::Literal { value: 0 } if op == ArithmeticOperation::Divide => {
                self.error(s, &f, "Cannot divide by zero")
            }
            NumericOperand::Literal { .. } => {}
            NumericOperand::Variable { name } => {
                self.integer(s, &f, self.p.game.variables.get(name))
            }
            NumericOperand::Property { entity, name } => {
                self.integer(s, &f, self.p.state_schema(entity).and_then(|m| m.get(name)))
            }
        }
    }
    fn condition(&mut self, s: &str, f: &str, c: &Condition) {
        match c {
            Condition::True | Condition::False => {}
            Condition::HintUsed { hint } => {
                if !self
                    .p
                    .hint_owners()
                    .iter()
                    .any(|(_, hints)| hints.iter().any(|h| h.id == *hint))
                {
                    self.error(s, f, format!("Missing hint set: {hint}"));
                }
            }
            Condition::All { conditions } | Condition::Any { conditions } => {
                for (index, c) in conditions.iter().enumerate() {
                    self.condition(s, &format!("{f}.conditions.{index}"), c)
                }
            }
            Condition::Not { condition } => self.condition(s, &format!("{f}.condition"), condition),
            Condition::Variable { name, op, value } => {
                self.value(s, f, self.p.game.variables.get(name), value, Some(*op))
            }
            Condition::Property {
                entity,
                name,
                op,
                value,
            } => self.value(
                s,
                f,
                self.p.state_schema(entity).and_then(|m| m.get(name)),
                value,
                Some(*op),
            ),
            Condition::CharacterCarrying { character, object } => {
                self.character(s, f, character);
                self.object(s, f, object);
            }
            Condition::Carrying { object }
            | Condition::Exists { object }
            | Condition::Opened { object } => self.object(s, f, object),
            Condition::At { location } => self.location(s, f, location),
            Condition::Visited {
                location, count, ..
            } => {
                self.location(s, f, location);
                if *count < 0 {
                    self.error(s, f, "Visit counts cannot be negative")
                }
            }
            Condition::Visible { entity } => self.entity(s, f, entity),
            Condition::Possesses { object, character } => {
                self.v2(s, f);
                self.target(s, f, object);
                if let Some(character) = character {
                    self.character(s, f, character);
                }
            }
            Condition::Reachable { object } => {
                self.v2(s, f);
                self.target(s, f, object);
            }
            Condition::InObject {
                object,
                parent,
                relation,
            } => {
                self.v2(s, f);
                self.target(s, f, object);
                self.parent(s, f, parent, *relation);
            }
            Condition::CanTransfer { object, placement } => {
                self.v2(s, f);
                self.target(s, f, object);
                self.placement(s, f, placement, true);
            }
        }
    }
    fn effects(&mut self, s: &str, f: &str, effects: &[Effect]) {
        for (i, e) in effects.iter().enumerate() {
            let f = format!("{f}.{i}");
            match e {
                Effect::Say { text } => self.text(s, &f, text),
                Effect::SayWithInputs {
                    text: message,
                    references,
                } => {
                    self.v2(s, &f);
                    for (key, reference) in references {
                        if key.is_empty()
                            || key.trim() != key
                            || key.contains('%')
                            || self.p.text_reference(key).is_some()
                        {
                            self.error(s, &format!("{f}.references"), "Message-local names must be nonempty, unambiguous, and must not shadow a variable/property");
                        }
                        match reference {
                            InputTextReference::ItemName if !self.item_input => {
                                self.error(s, &f, "Command item name is not available in this flow")
                            }
                            InputTextReference::EntityName { entity } => self.entity(s, &f, entity),
                            _ => {}
                        }
                    }
                    if let Err(error) = text::format(message, |key| match references.get(key) {
                        Some(InputTextReference::ItemName) => Ok("item".into()),
                        Some(InputTextReference::EntityName { entity }) => self
                            .p
                            .entity_name(entity)
                            .map(str::to_owned)
                            .ok_or_else(|| anyhow::anyhow!("Missing name entity: {entity}")),
                        None => self
                            .p
                            .initial_text_value(key)
                            .map(ToString::to_string)
                            .ok_or_else(|| anyhow::anyhow!("Unknown message value: %{key}%")),
                    }) {
                        self.error(s, &f, error.to_string());
                    }
                }
                Effect::Transfer { object, placement } => {
                    self.v2(s, &f);
                    self.target(s, &f, object);
                    self.placement(s, &f, placement, true);
                }
                Effect::ListContents { object, relation } => {
                    self.v2(s, &f);
                    self.parent(s, &f, object, *relation);
                }
                Effect::CharacterSays { character, text } => {
                    self.character(s, &format!("{f}.character"), character);
                    self.text(s, &format!("{f}.text"), text);
                }
                Effect::PrintDescription { entity } => self.entity(s, &f, entity),
                Effect::Respond {
                    id,
                    responses,
                    fallback,
                    on_exhausted,
                    ..
                } => {
                    self.id(id, &f);
                    if responses.is_empty() {
                        self.error(s, &f, "A response sequence requires at least one response")
                    }
                    for (index, t) in responses.iter().enumerate() {
                        self.text(s, &format!("{f}.responses.{index}"), t)
                    }
                    self.text(s, &format!("{f}.fallback"), fallback);
                    self.effects(s, &format!("{f}.on_exhausted"), on_exhausted)
                }
                Effect::ResetResponses { sequence } => {
                    if !all_effects(self.p)
                        .iter()
                        .any(|e| matches!(e, Effect::Respond { id, .. } if id == sequence))
                    {
                        self.error(s, &f, format!("Missing response sequence: {sequence}"))
                    }
                }
                Effect::SetVariable { name, value } => {
                    self.value(s, &f, self.p.game.variables.get(name), value, None)
                }
                Effect::SetProperty {
                    entity,
                    name,
                    value,
                } => self.value(
                    s,
                    &f,
                    self.p.state_schema(entity).and_then(|m| m.get(name)),
                    value,
                    None,
                ),
                Effect::UpdateVariable { name, op, operand } => {
                    self.integer(s, &format!("{f}.name"), self.p.game.variables.get(name));
                    self.operand(s, &f, *op, operand);
                }
                Effect::UpdateProperty {
                    entity,
                    name,
                    op,
                    operand,
                } => {
                    self.integer(
                        s,
                        &format!("{f}.name"),
                        self.p.state_schema(entity).and_then(|m| m.get(name)),
                    );
                    self.operand(s, &f, *op, operand);
                }
                Effect::GiveCharacter { object, character } => {
                    self.object(s, &f, object);
                    self.character(s, &f, character);
                }
                Effect::Give { object }
                | Effect::Remove { object }
                | Effect::Consume { object }
                | Effect::Open { object }
                | Effect::Close { object } => self.object(s, &f, object),
                Effect::Place { object, location } => {
                    self.object(s, &f, object);
                    if location != "@current" {
                        self.location(s, &f, location)
                    }
                }
                Effect::Reveal { entity } | Effect::Hide { entity } => {
                    self.entity(s, &f, entity);
                    if self.p.locations.iter().any(|l| l.id == *entity) {
                        self.error(s,&f,"Reveal/hide targets must be objects or characters; use exit visibility conditions for routes")
                    }
                }
                Effect::Move { location } => self.location(s, &f, location),
                Effect::MoveCharacter {
                    character,
                    location,
                } => {
                    self.character(s, &format!("{f}.character"), character);
                    if location != "@current" {
                        self.location(s, &format!("{f}.location"), location);
                    }
                }
                Effect::Combine {
                    first,
                    second,
                    result,
                    ..
                } => {
                    for id in [first, second, result] {
                        self.object(s, &f, id)
                    }
                    if first == second || first == result || second == result {
                        self.error(
                            s,
                            &f,
                            "Combination inputs and result must be distinct objects",
                        )
                    }
                }
                Effect::If {
                    condition,
                    then,
                    otherwise,
                } => {
                    self.condition(s, &format!("{f}.condition"), condition);
                    self.effects(s, &format!("{f}.then"), then);
                    self.effects(s, &format!("{f}.otherwise"), otherwise)
                }
                Effect::End { ending } => {
                    if !self.p.game.endings.iter().any(|e| e.id == *ending) {
                        self.error(s, &f, format!("Missing ending: {ending}"))
                    }
                }
                Effect::Stop => {}
            }
        }
    }
    fn pattern(&mut self, s: &str, verb: &str, pattern: &[PatternPart]) {
        if !self.p.vocabulary.iter().any(|v| v.id == verb) {
            self.error(s, "verb", format!("Missing verb: {verb}"))
        }
        for (index, part) in pattern.iter().enumerate() {
            match part {
                PatternPart::Literal { text } => {
                    if normalize(text).is_empty() {
                        self.error(
                            s,
                            &format!("pattern.{index}"),
                            "Pattern literals cannot be empty",
                        )
                    }
                }
                PatternPart::Entity { entity } => {
                    self.entity(s, &format!("pattern.{index}"), entity)
                }
                PatternPart::ObjectInput => {
                    self.v2(s, "pattern");
                    if !self.item_input {
                        self.error(
                            s,
                            "pattern",
                            "Command item requires a standard interaction that declares it",
                        );
                    }
                }
            }
        }
    }
}
pub fn walk_effects<'a>(effects: &'a [Effect], out: &mut Vec<&'a Effect>) {
    for e in effects {
        out.push(e);
        match e {
            Effect::If {
                then, otherwise, ..
            } => {
                walk_effects(then, out);
                walk_effects(otherwise, out)
            }
            Effect::Respond { on_exhausted, .. } => walk_effects(on_exhausted, out),
            _ => {}
        }
    }
}
fn constant(condition: &Condition) -> Option<bool> {
    match condition {
        Condition::True => Some(true),
        Condition::False => Some(false),
        Condition::Not { condition } => constant(condition).map(|v| !v),
        Condition::All { conditions } => {
            if conditions.iter().any(|c| constant(c) == Some(false)) {
                Some(false)
            } else if conditions.iter().all(|c| constant(c) == Some(true)) {
                Some(true)
            } else {
                None
            }
        }
        Condition::Any { conditions } => {
            if conditions.iter().any(|c| constant(c) == Some(true)) {
                Some(true)
            } else if conditions.iter().all(|c| constant(c) == Some(false)) {
                Some(false)
            } else {
                None
            }
        }
        _ => None,
    }
}
fn possible_effects<'a>(effects: &'a [Effect], out: &mut Vec<&'a Effect>) {
    for effect in effects {
        out.push(effect);
        match effect {
            Effect::If {
                condition,
                then,
                otherwise,
            } => {
                if constant(condition) != Some(false) {
                    possible_effects(then, out);
                }
                if constant(condition) != Some(true) {
                    possible_effects(otherwise, out);
                }
            }
            Effect::Stop | Effect::End { .. } => break,
            Effect::Respond {
                mode: SequenceMode::Fallback,
                on_exhausted,
                ..
            } => {
                possible_effects(on_exhausted, out);
            }
            _ => {}
        }
    }
}
pub fn all_effects(p: &Project) -> Vec<&Effect> {
    let mut out = vec![];
    for (_, actions, triggers) in p.owners() {
        for a in actions {
            walk_effects(&a.effects, &mut out)
        }
        for t in triggers {
            walk_effects(&t.effects, &mut out)
        }
    }
    for l in &p.locations {
        for e in &l.exits {
            walk_effects(&e.effects, &mut out)
        }
    }
    out
}

fn command_forms(
    p: &Project,
    verb: &str,
    pattern: &[PatternPart],
    named_route: bool,
) -> Vec<String> {
    let Some(verb) = p.vocabulary.iter().find(|v| v.id == verb) else {
        return vec![];
    };
    let entity_words = EntityWords::new(&p.game.ignored_words);
    let mut forms = std::iter::once(&verb.canonical)
        .chain(&verb.synonyms)
        .map(|v| normalize(v))
        .take(256)
        .collect::<Vec<_>>();
    for part in pattern {
        let alternatives = match part {
            PatternPart::Literal { text } => {
                if named_route {
                    entity_words.forms(text)
                } else {
                    vec![normalize(text)]
                }
            }
            PatternPart::Entity { entity } => p
                .entity_aliases(entity)
                .into_iter()
                .flat_map(|name| entity_words.forms(name))
                .collect(),
            PatternPart::ObjectInput => vec!["<item>".into()],
        };
        forms = forms
            .iter()
            .flat_map(|prefix| {
                alternatives
                    .iter()
                    .map(move |word| format!("{prefix} {word}"))
            })
            .take(256)
            .collect();
    }
    forms
}
fn contains_control(value: &serde_json::Value) -> bool {
    match value {
        serde_json::Value::String(s) => s.chars().any(|c| c.is_control() && c != '\n' && c != '\t'),
        serde_json::Value::Array(values) => values.iter().any(contains_control),
        serde_json::Value::Object(values) => values
            .iter()
            .any(|(key, value)| key.chars().any(char::is_control) || contains_control(value)),
        _ => false,
    }
}
/// Validate an editor check's condition against the ordinary game schema.
pub fn validate_condition(p: &Project, condition: &Condition) -> Vec<Diagnostic> {
    let mut check = Check {
        p,
        diagnostics: vec![],
        ids: BTreeSet::new(),
        item_input: false,
    };
    check.condition(&p.game.id, "expectation", condition);
    check.diagnostics
}
pub fn validate(p: &Project) -> Vec<Diagnostic> {
    let mut c = Check {
        p,
        diagnostics: vec![],
        ids: BTreeSet::new(),
        item_input: false,
    };
    let game = &p.game;
    for (owner, hints) in p.hint_owners() {
        for hint in hints {
            c.id(&hint.id, "hints.id");
            if hint.name.trim().is_empty() {
                c.error(owner, "hints.name", "A puzzle name is required");
            }
            c.condition(&hint.id, "available", &hint.available);
            c.condition(&hint.id, "solved", &hint.solved);
            if hint.stages.is_empty() {
                c.error(&hint.id, "stages", "A hint set requires at least one stage");
            }
            for stage in &hint.stages {
                c.id(&stage.id, "hints.stages.id");
                c.condition(&stage.id, "condition", &stage.condition);
                if stage.clues.is_empty() {
                    c.error(
                        &stage.id,
                        "clues",
                        "A hint stage requires at least one clue",
                    );
                }
                for (index, clue) in stage.clues.iter().enumerate() {
                    if clue.trim().is_empty() {
                        c.error(
                            &stage.id,
                            &format!("clues.{index}"),
                            "A clue cannot be empty",
                        );
                    }
                    c.text(&stage.id, &format!("clues.{index}"), clue);
                }
                if let Some(solution) = &stage.solution {
                    if solution.trim().is_empty() {
                        c.error(&stage.id, "solution", "A solution cannot be empty");
                    }
                    c.text(&stage.id, "solution", solution);
                }
            }
        }
    }
    let mut ignored_words = BTreeSet::new();
    for word in &game.ignored_words {
        let normalized = normalize(word);
        if normalized.split_whitespace().count() != 1 {
            c.error(
                &game.id,
                "ignored_words",
                "Each ignored entry must be a single word",
            );
        } else if !ignored_words.insert(normalized) {
            c.warn(
                "repeated_ignored_word",
                &game.id,
                "ignored_words",
                format!("Ignored word '{word}' is repeated"),
                json!([
                    normalize(word),
                    game.ignored_words
                        .iter()
                        .filter(|entry| normalize(entry) == normalize(word))
                        .count()
                ]),
            );
        }
    }
    if let Ok(mut runtime) = serde_json::to_value(p) {
        runtime.as_object_mut().unwrap().remove("editor");
        if contains_control(&runtime) {
            c.error(
                &game.id,
                "content",
                "Game content contains unsupported control characters or terminal escapes",
            );
        }
    }
    for (id, _, _) in p.owners().into_iter().filter(|(id, _, _)| *id != game.id) {
        if p.entity_name(id).is_some_and(|name| name.trim().is_empty()) {
            c.error(id, "name", "A display name is required");
        }
    }
    c.id(&game.id, "id");
    if !supported_format(game.format_version) {
        c.error(
            &game.id,
            "format_version",
            format!(
                "Unsupported format {}; supported: 1 through {FORMAT_VERSION}",
                game.format_version
            ),
        )
    }
    let version_parts = game.content_version.split('.').collect::<Vec<_>>();
    if version_parts.len() != 3
        || version_parts
            .iter()
            .any(|v| v.is_empty() || v.parse::<u32>().is_err())
    {
        c.error(
            &game.id,
            "content_version",
            "Content version must be three nonnegative integers, such as 0.1.0",
        )
    }
    if game.title.trim().is_empty() {
        c.error(&game.id, "title", "A game title is required")
    }
    for (f, t) in [
        ("title", &game.title),
        ("opening_text", &game.opening_text),
        ("help_text", &game.help_text),
        ("unknown_command_text", &game.unknown_command_text),
    ] {
        c.text(&game.id, f, t)
    }
    c.location(&game.id, "starting_location", &game.starting_location);
    let mut words = BTreeMap::<String, String>::new();
    for v in &p.vocabulary {
        c.id(&v.id, "vocabulary.id");
        for word in std::iter::once(&v.canonical).chain(&v.synonyms) {
            let n = normalize(word);
            if n.is_empty() {
                c.error(&v.id, "canonical", "Verb names cannot be empty")
            }
            if reserved(&n) {
                c.error(
                    &v.id,
                    "canonical",
                    format!("Reserved session command: {word}"),
                )
            }
            if let Some(old) = words.insert(n.clone(), v.id.clone()) {
                c.warn(
                    "vocabulary_overlap",
                    &v.id,
                    "synonyms",
                    format!("Vocabulary overlaps with {old}"),
                    json!([n, old]),
                )
            }
        }
    }
    for e in &game.endings {
        c.id(&e.id, "endings.id");
        c.text(&e.id, "text", &e.text)
    }
    for l in &p.locations {
        c.id(&l.id, "id");
        c.text(&l.id, "description", &l.description);
        for e in &l.exits {
            c.id(&e.id, "exits.id");
            c.location(&e.id, "destination", &e.destination);
            c.pattern(&e.id, &e.verb, &e.pattern);
            if e.pattern.is_empty() && normalize(&e.name).is_empty() {
                c.error(&e.id, "name", "Exit requires a name or command pattern")
            }
            c.condition(&e.id, "visible", &e.visible);
            c.condition(&e.id, "available", &e.available);
            c.text(&e.id, "blocked_text", &e.blocked_text);
            c.text(&e.id, "text", &e.text);
            c.effects(&e.id, "effects", &e.effects);
        }
    }
    for o in &p.objects {
        c.id(&o.id, "id");
        c.text(&o.id, "description", &o.description);
        c.placement(&o.id, "placement", &o.placement, false);
        if o.storage.is_some() {
            c.v2(&o.id, "storage");
        }
        if o.storage.unwrap_or_default().container == Some(ContainerOpening::AlwaysOpen) && !o.open
        {
            c.error(&o.id, "open", "An always-open container must start open");
        }
    }
    if p.objects
        .iter()
        .any(|o| o.placement.parent_object().is_some())
    {
        for cycle in placement_cycles(p.objects.iter().map(|o| (o.id.as_str(), &o.placement))) {
            c.error(
                cycle[0],
                "placement",
                format!("Object placement forms a cycle: {}", cycle.join(" → ")),
            );
        }
    }
    for ch in &p.characters {
        c.id(&ch.id, "id");
        if let Some(colour) = &ch.name_colour
            && !text::COLOURS.contains(&colour.as_str())
        {
            c.error(
                &ch.id,
                "name_colour",
                format!("Unknown character name colour: {colour}"),
            );
        }
        c.text(&ch.id, "description", &ch.description);
        c.location(&ch.id, "location", &ch.location)
    }
    let mut patterns = BTreeMap::new();
    let mut overlaps = BTreeSet::new();
    let mut trigger_keys = BTreeMap::new();
    for (owner, actions, triggers) in p.owners() {
        for a in actions {
            c.item_input = a
                .standard
                .as_ref()
                .is_some_and(|standard| standard.interaction.takes_item());
            if let Some(standard) = &a.standard {
                c.v2(&a.id, "standard");
                if let Some(object) = p.objects.iter().find(|o| o.id == owner) {
                    let storage = object.storage.unwrap_or_default();
                    let kind = standard.interaction;
                    let valid = match kind {
                        StandardInteraction::Open | StandardInteraction::Close => {
                            storage.container == Some(ContainerOpening::Openable)
                        }
                        StandardInteraction::LookInside | StandardInteraction::PutInside => {
                            storage.container.is_some()
                        }
                        StandardInteraction::PutOn => storage.surface,
                        StandardInteraction::TakeFrom => !storage.is_empty(),
                        StandardInteraction::Take | StandardInteraction::Drop => object.portable,
                    };
                    if !valid {
                        c.error(
                            &a.id,
                            "standard",
                            "Standard interaction does not match the owner's capabilities",
                        );
                    }
                    if !a.pattern.iter().any(
                        |part| matches!(part, PatternPart::Entity { entity } if entity == owner),
                    ) {
                        c.error(
                            &a.id,
                            "pattern",
                            "A standard interaction must name its owning object",
                        );
                    }
                } else {
                    c.error(
                        &a.id,
                        "standard",
                        "Standard interactions must belong to an object",
                    );
                }
            }
            if a.pattern
                .iter()
                .filter(|part| matches!(part, PatternPart::ObjectInput))
                .count()
                != usize::from(c.item_input)
            {
                c.error(
                    &a.id,
                    "pattern",
                    "This interaction must declare exactly its supported command item input",
                );
            }
            c.id(&a.id, "actions.id");
            c.pattern(&a.id, &a.verb, &a.pattern);
            c.condition(&a.id, "requirements", &a.requirements);
            c.text(&a.id, "failure_text", &a.failure_text);
            c.effects(&a.id, "effects", &a.effects);
            c.item_input = false;
            for command in command_forms(p, &a.verb, &a.pattern, false) {
                if let Some(old) = patterns.insert(command.clone(), a.id.clone())
                    && old != a.id
                    && overlaps.insert((old.clone(), a.id.clone()))
                {
                    c.warn("command_overlap", &a.id, "pattern", format!("Command '{command}' overlaps with {old}; inspect scope, requirements, and priority"), json!([command, old, flow_warning_context(p, &a.id), flow_warning_context(p, &old)]));
                }
            }
        }
        for t in triggers {
            c.id(&t.id, "triggers.id");
            c.condition(&t.id, "condition", &t.condition);
            c.effects(&t.id, "effects", &t.effects);
            if let Some(watch) = &t.watch {
                let schema = match &watch.target {
                    ValueTarget::Variable { name } => p.game.variables.get(name),
                    ValueTarget::Property { entity, name } => {
                        p.state_schema(entity).and_then(|state| state.get(name))
                    }
                };
                if schema.is_none() {
                    c.error(
                        &t.id,
                        "watch.target",
                        "Watched variable/property does not exist",
                    );
                }
            }
            let key = format!("{owner}:{:?}:{:?}:{}", t.event, t.watch, t.priority);
            if let Some(old) = trigger_keys.insert(key, t.id.clone()) {
                c.warn(
                    "trigger_overlap",
                    &t.id,
                    "event",
                    format!("Overlapping trigger {old}; both run in stable ID order"),
                    json!([
                        old,
                        flow_warning_context(p, &t.id),
                        flow_warning_context(p, &old)
                    ]),
                )
            }
        }
    }
    for location in &p.locations {
        for exit in &location.exits {
            let forms = if exit.pattern.is_empty() {
                std::iter::once(&exit.name)
                    .chain(&exit.aliases)
                    .flat_map(|name| {
                        command_forms(
                            p,
                            &exit.verb,
                            &[PatternPart::Literal { text: name.clone() }],
                            true,
                        )
                    })
                    .collect::<Vec<_>>()
            } else {
                command_forms(p, &exit.verb, &exit.pattern, false)
            };
            for command in forms {
                if let Some(old) = patterns.insert(command.clone(), exit.id.clone())
                    && old != exit.id
                    && overlaps.insert((old.clone(), exit.id.clone()))
                {
                    c.warn("exit_overlap", &exit.id, "pattern", format!("Exit command '{command}' overlaps with {old}; inspect scope and priority"), json!([command, old, flow_warning_context(p, &exit.id), flow_warning_context(p, &old)]));
                }
            }
        }
    }
    for asset in &game.assets {
        if !safe_asset(asset) {
            c.error(&game.id, "assets", format!("Unsafe asset path: {asset}"))
        }
    }
    fn follow_effects(
        effects: Vec<&Effect>,
        locations: &mut BTreeSet<String>,
        endings: &mut BTreeSet<String>,
        characters: &mut BTreeMap<String, BTreeSet<String>>,
    ) {
        for effect in effects {
            match effect {
                Effect::Move { location } => {
                    locations.insert(location.clone());
                }
                Effect::MoveCharacter {
                    character,
                    location,
                } => {
                    if let Some(positions) = characters.get_mut(character) {
                        if location == "@current" {
                            positions.extend(locations.iter().cloned());
                        } else {
                            positions.insert(location.clone());
                        }
                    }
                }
                Effect::End { ending } => {
                    endings.insert(ending.clone());
                }
                _ => {}
            }
        }
    }
    let mut reachable = BTreeSet::from([game.starting_location.clone()]);
    let mut reachable_endings = BTreeSet::new();
    let mut character_locations = p
        .characters
        .iter()
        .map(|ch| (ch.id.clone(), BTreeSet::from([ch.location.clone()])))
        .collect::<BTreeMap<_, _>>();
    loop {
        let before = reachable.len()
            + character_locations
                .values()
                .map(BTreeSet::len)
                .sum::<usize>();
        for (owner, actions, triggers) in p.owners() {
            let active = owner == game.id
                || reachable.contains(owner)
                || p.objects.iter().any(|o| {
                    o.id == owner
                        && match &o.placement {
                            Placement::Location { location } => reachable.contains(location),
                            _ => true,
                        }
                })
                || character_locations
                    .get(owner)
                    .is_some_and(|positions| positions.iter().any(|id| reachable.contains(id)));
            let mut effects = vec![];
            if active {
                for a in actions {
                    if constant(&a.requirements) != Some(false) {
                        possible_effects(&a.effects, &mut effects)
                    }
                }
            }
            for t in triggers {
                if (t.watch.is_some() || (active && t.event != Event::Ending))
                    && constant(&t.condition) != Some(false)
                {
                    possible_effects(&t.effects, &mut effects)
                }
            }
            follow_effects(
                effects,
                &mut reachable,
                &mut reachable_endings,
                &mut character_locations,
            );
        }
        for l in &p.locations {
            if reachable.contains(&l.id) {
                for e in &l.exits {
                    if constant(&e.visible) != Some(false) && constant(&e.available) != Some(false)
                    {
                        reachable.insert(e.destination.clone());
                        let mut effects = vec![];
                        possible_effects(&e.effects, &mut effects);
                        follow_effects(
                            effects,
                            &mut reachable,
                            &mut reachable_endings,
                            &mut character_locations,
                        );
                    }
                }
            }
        }
        if before
            == reachable.len()
                + character_locations
                    .values()
                    .map(BTreeSet::len)
                    .sum::<usize>()
        {
            break;
        }
    }
    for l in &p.locations {
        if !reachable.contains(&l.id) {
            c.warn(
                "unreachable_location",
                &l.id,
                "exits",
                "Location is structurally unreachable from the start",
                json!(game.starting_location),
            )
        }
    }
    if game.require_ending && reachable_endings.is_empty() {
        c.error(
            &game.id,
            "endings",
            "Game requires an ending, but none is structurally reachable",
        )
    }
    for ending in &game.endings {
        if !reachable_endings.contains(&ending.id) {
            c.warn(
                "unreachable_ending",
                &ending.id,
                "text",
                "Ending is structurally unreachable",
                json!(game.starting_location),
            )
        }
    }
    let mut graph = BTreeMap::<String, Vec<String>>::new();
    for l in &p.locations {
        for t in &l.triggers {
            if t.watch.is_none() && t.event == Event::Enter && constant(&t.condition) == Some(true)
            {
                for effect in &t.effects {
                    if let Effect::Move { location } = effect {
                        graph
                            .entry(l.id.clone())
                            .or_default()
                            .push(location.clone())
                    }
                }
            }
        }
    }
    // Repeatedly remove sinks. Remaining nodes can reach a cycle, without recursive DFS.
    let mut degrees = p
        .locations
        .iter()
        .map(|l| (l.id.clone(), graph.get(&l.id).map_or(0, Vec::len)))
        .collect::<BTreeMap<_, _>>();
    let mut reverse = BTreeMap::<String, Vec<String>>::new();
    for (source, targets) in &graph {
        for target in targets {
            reverse
                .entry(target.clone())
                .or_default()
                .push(source.clone());
        }
    }
    let mut sinks = degrees
        .iter()
        .filter(|(_, degree)| **degree == 0)
        .map(|(id, _)| id.clone())
        .collect::<Vec<_>>();
    while let Some(sink) = sinks.pop() {
        if let Some(parents) = reverse.get(&sink) {
            for parent in parents {
                if let Some(degree) = degrees.get_mut(parent) {
                    *degree = degree.saturating_sub(1);
                    if *degree == 0 {
                        sinks.push(parent.clone());
                    }
                }
            }
        }
    }
    for l in &p.locations {
        if degrees.get(&l.id).is_some_and(|degree| *degree > 0) {
            let mut pending = vec![l.id.clone()];
            let mut context = BTreeMap::new();
            while let Some(id) = pending.pop() {
                if context.contains_key(&id) {
                    continue;
                }
                let targets = graph
                    .get(&id)
                    .into_iter()
                    .flatten()
                    .cloned()
                    .collect::<BTreeSet<_>>();
                pending.extend(targets.iter().cloned());
                context.insert(id, targets);
            }
            c.warn("entry_movement_cycle", &l.id,"triggers","Entry triggers contain a movement cycle; runtime safeguards will roll back runaway commands", json!(context))
        }
    }
    c.diagnostics
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn unknown_command_messages_default_for_older_projects_and_round_trip() {
        let mut value = serde_json::to_value(Project::blank("Legacy reply")).unwrap();
        value["game"]
            .as_object_mut()
            .unwrap()
            .remove("unknown_command_text");
        let mut project: Project = serde_json::from_value(value).unwrap();
        assert_eq!(
            project.game.unknown_command_text,
            default_unknown_command_text()
        );
        assert_eq!(
            Project::blank("New reply").game.unknown_command_text,
            default_unknown_command_text()
        );
        project.game.unknown_command_text = "The forest has no answer for that.".into();
        let restored: Project =
            serde_json::from_slice(&serde_json::to_vec(&project).unwrap()).unwrap();
        assert_eq!(
            restored.game.unknown_command_text,
            project.game.unknown_command_text
        );
    }
    #[test]
    fn unknown_command_messages_validate_colours_and_value_references() {
        let mut project = Project::blank("Reply validation");
        project
            .game
            .variables
            .insert("chances".into(), Value::Integer(3));
        project.locations[0]
            .state
            .insert("charges".into(), Value::Integer(7));
        project.game.unknown_command_text = format!(
            "<green>%chances% chances, %{}.charges% charges.</green>",
            project.locations[0].id
        );
        assert!(!has_errors(&validate(&project)));
        for invalid in ["%missing%", "<green>Unclosed", "Bad\u{1b}control"] {
            project.game.unknown_command_text = invalid.into();
            assert!(validate(&project).iter().any(|diagnostic| {
                diagnostic.subject == project.game.id
                    && diagnostic.field == "unknown_command_text"
                    && diagnostic.severity == Severity::Error
            }));
        }
        project.game.unknown_command_text.clear();
        assert!(!has_errors(&validate(&project)));
    }
    #[test]
    fn diagnostics_identify_nested_conditions_and_individual_replies() {
        let mut p = Project::blank("Precise findings");
        p.game.actions.push(serde_json::from_value(serde_json::json!({
            "id": "inspect", "name": "Inspect", "verb": p.vocabulary[0].id,
            "pattern": [{"type":"literal", "text":""}, {"type":"entity", "entity":"missing"}], "priority": 0, "requirements": {"type":"true"}, "failure_text":"",
            "effects": [
                {"type":"if", "condition":{"type":"true"}, "then":[], "otherwise":[
                    {"type":"if", "condition":{"type":"all", "conditions":[{"type":"true"},{"type":"not", "condition":{"type":"carrying", "object":"missing"}}]}, "then":[], "otherwise":[]}
                ]},
                {"type":"respond", "id":"replies", "responses":["Valid", "%missing%"], "mode":"repeat_last", "fallback":"", "exhaustion":"once", "on_exhausted":[]}
            ]
        })).unwrap());
        let diagnostics = validate(&p);
        assert!(
            diagnostics
                .iter()
                .any(|d| d.field == "pattern.0" && d.message.contains("empty"))
        );
        assert!(
            diagnostics
                .iter()
                .any(|d| d.field == "pattern.1" && d.message.contains("Missing entity"))
        );
        assert!(diagnostics.iter().any(|d| d.subject == "inspect"
            && d.field == "effects.0.otherwise.0.condition.conditions.1.condition"
            && d.message.contains("Missing object")));
        assert!(diagnostics.iter().any(|d| d.subject == "inspect"
            && d.field == "effects.1.responses.1"
            && d.message.contains("missing")));
    }
    #[test]
    fn descriptions_and_message_values_validate_references() {
        let mut p = Project::blank("Messages");
        p.game.variables.insert("chances".into(), Value::Integer(3));
        p.locations[0]
            .state
            .insert("charges".into(), Value::Integer(7));
        p.locations[0].description = format!(
            "%chances% / %{}.charges% / %%not-a-variable%%",
            p.locations[0].id
        );
        assert!(!has_errors(&validate(&p)));
        p.locations[0].state.clear();
        assert!(
            validate(&p)
                .iter()
                .any(|d| d.field == "description" && d.message.contains("charges"))
        );
        p.locations[0].description = "%missing%".into();
        p.locations[0].actions[0].effects = vec![Effect::PrintDescription {
            entity: "deleted".into(),
        }];
        let diagnostics = validate(&p);
        assert!(
            diagnostics
                .iter()
                .any(|d| d.field == "description" && d.message.contains("%missing%"))
        );
        assert!(
            diagnostics
                .iter()
                .any(|d| d.field == "effects.0" && d.message.contains("Missing entity: deleted"))
        );
    }
    #[test]
    fn ignored_words_have_backwards_compatible_defaults_and_validate_entries() {
        let mut value = serde_json::to_value(Project::blank("Legacy")).unwrap();
        value["game"]
            .as_object_mut()
            .unwrap()
            .remove("ignored_words");
        let mut project: Project = serde_json::from_value(value).unwrap();
        assert_eq!(project.game.ignored_words, default_ignored_words());
        project.game.ignored_words = vec!["the old".into()];
        assert!(
            validate(&project)
                .iter()
                .any(|d| d.field == "ignored_words" && d.severity == Severity::Error)
        );
        project.game.ignored_words = vec!["the".into(), "THE".into()];
        assert!(
            validate(&project)
                .iter()
                .any(|d| d.field == "ignored_words" && d.severity == Severity::Warning)
        );
        project.game.ignored_words.clear();
        let restored: Project =
            serde_json::from_slice(&serde_json::to_vec(&project).unwrap()).unwrap();
        assert!(restored.game.ignored_words.is_empty());
    }
    #[test]
    fn entity_prefixes_are_accounted_for_in_command_overlap_validation() {
        let mut p = Project::blank("Overlaps");
        for (id, name) in [("first", "painting"), ("second", "the painting")] {
            let mut object = Object {
                id: id.into(),
                name: name.into(),
                placement: Placement::Inventory,
                ..Default::default()
            };
            object.actions = starter_actions(&object);
            p.objects.push(object);
        }
        assert!(
            validate(&p)
                .iter()
                .any(|d| d.field == "pattern" && d.message.contains("overlaps"))
        );
        p.game.ignored_words.clear();
        assert!(
            !validate(&p)
                .iter()
                .any(|d| d.field == "pattern" && d.message.contains("overlaps"))
        );
    }
    #[test]
    fn alias_overlaps_and_false_endings_are_diagnosed() {
        let mut p = Project::blank("Test");
        for name in ["first", "second"] {
            let o = Object {
                id: name.into(),
                name: name.into(),
                aliases: vec!["token".into()],
                placement: Placement::Inventory,
                ..Default::default()
            };
            let mut o = o;
            o.actions = starter_actions(&o);
            p.objects.push(o);
        }
        assert!(validate(&p).iter().any(|d| d.message.contains("overlaps")));
        p.game.require_ending = true;
        p.game.endings.push(Ending {
            id: "end".into(),
            ..Default::default()
        });
        p.game.actions.push(Action {
            id: "impossible".into(),
            verb: "use".into(),
            effects: vec![Effect::If {
                condition: Condition::False,
                then: vec![Effect::End {
                    ending: "end".into(),
                }],
                otherwise: vec![],
            }],
            ..Default::default()
        });
        assert!(
            validate(&p)
                .iter()
                .any(|d| d.severity == Severity::Error && d.field == "endings")
        );
    }
    #[test]
    fn unknown_features_and_terminal_controls_are_rejected() {
        let p = Project::blank("Test");
        let mut value = serde_json::to_value(&p).unwrap();
        value["game"]["unknown_feature"] = serde_json::json!(true);
        assert!(serde_json::from_value::<Project>(value).is_err());
        let mut p = p;
        p.game
            .variables
            .insert("text".into(), Value::Text("\x1b[31m".into()));
        assert!(has_errors(&validate(&p)));
    }
    #[test]
    fn blank_valid() {
        assert!(!has_errors(&validate(&Project::blank("Test"))))
    }
    #[test]
    fn ids_references_and_types() {
        let mut p = Project::blank("Test");
        p.game.variables.insert("ready".into(), Value::Bool(false));
        p.game.actions.push(Action {
            id: p.locations[0].id.clone(),
            verb: "examine".into(),
            effects: vec![
                Effect::SetVariable {
                    name: "ready".into(),
                    value: Value::Text("no".into()),
                },
                Effect::Move {
                    location: "missing".into(),
                },
            ],
            ..Default::default()
        });
        let d = validate(&p);
        assert!(d.iter().any(|d| d.message.contains("Duplicate")));
        assert!(d.iter().any(|d| d.message.contains("incompatible")));
        assert!(d.iter().any(|d| d.message.contains("Missing location")))
    }
    #[test]
    fn reserved_prefixes() {
        assert!(reserved("SAVE before garden"));
        assert!(reserved("Help the painting"));
        assert!(!reserved("helpful"));
        assert!(!reserved("look at"));
        assert!(!reserved("look painting"));
    }
}
