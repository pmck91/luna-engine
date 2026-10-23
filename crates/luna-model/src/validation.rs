use crate::*;
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
struct Check<'a> {
    p: &'a Project,
    diagnostics: Vec<Diagnostic>,
    ids: BTreeSet<String>,
}
impl Check<'_> {
    fn report(
        &mut self,
        severity: Severity,
        subject: &str,
        field: &str,
        message: impl Into<String>,
    ) {
        self.diagnostics.push(Diagnostic {
            severity,
            subject: subject.into(),
            field: field.into(),
            message: message.into(),
        })
    }
    fn error(&mut self, s: &str, f: &str, m: impl Into<String>) {
        self.report(Severity::Error, s, f, m)
    }
    fn warn(&mut self, s: &str, f: &str, m: impl Into<String>) {
        self.report(Severity::Warning, s, f, m)
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
                for c in conditions {
                    self.condition(s, f, c)
                }
            }
            Condition::Not { condition } => self.condition(s, f, condition),
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
        }
    }
    fn effects(&mut self, s: &str, f: &str, effects: &[Effect]) {
        for (i, e) in effects.iter().enumerate() {
            let f = format!("{f}.{i}");
            match e {
                Effect::Say { text } => self.text(s, &f, text),
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
                    for t in responses {
                        self.text(s, &f, t)
                    }
                    self.text(s, &f, fallback);
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
                    self.condition(s, &f, condition);
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
        for part in pattern {
            match part {
                PatternPart::Literal { text } => {
                    if normalize(text).is_empty() {
                        self.error(s, "pattern", "Pattern literals cannot be empty")
                    }
                }
                PatternPart::Entity { entity } => self.entity(s, "pattern", entity),
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
pub fn validate(p: &Project) -> Vec<Diagnostic> {
    let mut c = Check {
        p,
        diagnostics: vec![],
        ids: BTreeSet::new(),
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
                &game.id,
                "ignored_words",
                format!("Ignored word '{word}' is repeated"),
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
    if game.format_version != FORMAT_VERSION {
        c.error(
            &game.id,
            "format_version",
            format!(
                "Unsupported format {}; supported: {FORMAT_VERSION}",
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
            if let Some(old) = words.insert(n, v.id.clone()) {
                c.warn(&v.id, "synonyms", format!("Vocabulary overlaps with {old}"))
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
        match &o.placement {
            Placement::Location { location } => c.location(&o.id, "placement", location),
            Placement::Character { character } => c.character(&o.id, "placement", character),
            Placement::Inventory | Placement::Absent => {}
        }
    }
    for ch in &p.characters {
        c.id(&ch.id, "id");
        c.text(&ch.id, "description", &ch.description);
        c.location(&ch.id, "location", &ch.location)
    }
    let mut patterns = BTreeMap::new();
    let mut overlaps = BTreeSet::new();
    let mut trigger_keys = BTreeMap::new();
    for (owner, actions, triggers) in p.owners() {
        for a in actions {
            c.id(&a.id, "actions.id");
            c.pattern(&a.id, &a.verb, &a.pattern);
            c.condition(&a.id, "requirements", &a.requirements);
            c.text(&a.id, "failure_text", &a.failure_text);
            c.effects(&a.id, "effects", &a.effects);
            for command in command_forms(p, &a.verb, &a.pattern, false) {
                if let Some(old) = patterns.insert(command.clone(), a.id.clone())
                    && old != a.id
                    && overlaps.insert((old.clone(), a.id.clone()))
                {
                    c.warn(&a.id, "pattern", format!("Command '{command}' overlaps with {old}; inspect scope, requirements, and priority"));
                }
            }
        }
        for t in triggers {
            c.id(&t.id, "triggers.id");
            c.condition(&t.id, "condition", &t.condition);
            c.effects(&t.id, "effects", &t.effects);
            let key = format!("{owner}:{:?}:{}", t.event, t.priority);
            if let Some(old) = trigger_keys.insert(key, t.id.clone()) {
                c.warn(
                    &t.id,
                    "event",
                    format!("Overlapping trigger {old}; both run in stable ID order"),
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
                    c.warn(&exit.id, "pattern", format!("Exit command '{command}' overlaps with {old}; inspect scope and priority"));
                }
            }
        }
    }
    for asset in &game.assets {
        if !safe_asset(asset) {
            c.error(&game.id, "assets", format!("Unsafe asset path: {asset}"))
        }
    }
    let mut reachable = BTreeSet::from([game.starting_location.clone()]);
    let mut reachable_endings = BTreeSet::new();
    loop {
        let before = reachable.len();
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
                || p.characters
                    .iter()
                    .any(|ch| ch.id == owner && reachable.contains(&ch.location));
            if active {
                let mut effects = vec![];
                for a in actions {
                    if constant(&a.requirements) != Some(false) {
                        possible_effects(&a.effects, &mut effects)
                    }
                }
                for t in triggers {
                    if t.event != Event::Ending && constant(&t.condition) != Some(false) {
                        possible_effects(&t.effects, &mut effects)
                    }
                }
                for e in effects {
                    match e {
                        Effect::Move { location } => {
                            reachable.insert(location.clone());
                        }
                        Effect::End { ending } => {
                            reachable_endings.insert(ending.clone());
                        }
                        _ => {}
                    }
                }
            }
        }
        for l in &p.locations {
            if reachable.contains(&l.id) {
                for e in &l.exits {
                    if constant(&e.visible) != Some(false) && constant(&e.available) != Some(false)
                    {
                        reachable.insert(e.destination.clone());
                        let mut effects = vec![];
                        possible_effects(&e.effects, &mut effects);
                        for ef in effects {
                            match ef {
                                Effect::Move { location } => {
                                    reachable.insert(location.clone());
                                }
                                Effect::End { ending } => {
                                    reachable_endings.insert(ending.clone());
                                }
                                _ => {}
                            }
                        }
                    }
                }
            }
        }
        if before == reachable.len() {
            break;
        }
    }
    for l in &p.locations {
        if !reachable.contains(&l.id) {
            c.warn(
                &l.id,
                "exits",
                "Location is structurally unreachable from the start",
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
            c.warn(&ending.id, "text", "Ending is structurally unreachable")
        }
    }
    let mut graph = BTreeMap::<String, Vec<String>>::new();
    for l in &p.locations {
        for t in &l.triggers {
            if t.event == Event::Enter && constant(&t.condition) == Some(true) {
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
            c.warn(&l.id,"triggers","Entry triggers contain a movement cycle; runtime safeguards will roll back runaway commands")
        }
    }
    c.diagnostics
}

#[cfg(test)]
mod tests {
    use super::*;
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
