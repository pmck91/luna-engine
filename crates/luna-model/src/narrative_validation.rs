//! Narrative ownership, prerequisites and native hook validation.
use super::*;
impl Check<'_> {
    fn v5(&mut self, subject: &str, field: &str) {
        if self.p.game.format_version < 5 {
            self.error(
                subject,
                field,
                "This feature requires an explicit upgrade to content format 5",
            );
        }
    }
    pub(super) fn conversation_ref(&mut self, s: &str, f: &str, id: &str) {
        self.v5(s, f);
        if !self.p.conversations.iter().any(|c| c.id == id) {
            self.error(s, f, format!("Missing conversation: {id}"));
        }
    }
    pub(super) fn quest_ref(&mut self, s: &str, f: &str, id: &str) {
        self.v5(s, f);
        if !self.p.quests.iter().any(|q| q.id == id) {
            self.error(s, f, format!("Missing quest: {id}"));
        }
    }
    pub(super) fn node_ref(&mut self, s: &str, f: &str, conversation: &str, node: &str) {
        self.conversation_ref(s, f, conversation);
        if !self
            .p
            .conversations
            .iter()
            .filter(|c| c.id == conversation)
            .any(|c| c.nodes.iter().any(|n| n.id == node))
        {
            self.error(
                s,
                f,
                format!("Node {node} does not belong to conversation {conversation}"),
            );
        }
    }
    pub(super) fn reply_ref(&mut self, s: &str, f: &str, conversation: &str, reply: &str) {
        self.conversation_ref(s, f, conversation);
        if !self
            .p
            .conversations
            .iter()
            .filter(|c| c.id == conversation)
            .flat_map(|c| &c.nodes)
            .any(|n| n.replies.iter().any(|r| r.id == reply))
        {
            self.error(
                s,
                f,
                format!("Reply {reply} does not belong to conversation {conversation}"),
            );
        }
    }
    pub(super) fn stage_ref(&mut self, s: &str, f: &str, quest: &str, stage: &str) {
        self.quest_ref(s, f, quest);
        if !self
            .p
            .quests
            .iter()
            .filter(|q| q.id == quest)
            .any(|q| q.stages.iter().any(|s| s.id == stage))
        {
            self.error(
                s,
                f,
                format!("Stage {stage} does not belong to quest {quest}"),
            );
        }
    }
    pub(super) fn narratives(&mut self) {
        for c in &self.p.conversations {
            self.v5(&c.id, "conversation");
            self.id(&c.id, "id");
            if c.name.trim().is_empty() {
                self.error(&c.id, "name", "A conversation name is required");
            }
            self.character(&c.id, "character", &c.character);
            self.condition(&c.id, "available", &c.available);
            self.node_ref(&c.id, "default_entry", &c.id, &c.default_entry);
            for (i, entry) in c.entries.iter().enumerate() {
                self.node_ref(&c.id, &format!("entries.{i}.node"), &c.id, &entry.node);
                self.condition(&c.id, &format!("entries.{i}.condition"), &entry.condition);
            }
            for n in &c.nodes {
                self.id(&n.id, "id");
                if n.name.trim().is_empty() {
                    self.error(&n.id, "name", "A dialogue name is required");
                }
                self.text(&n.id, "text", &n.text);
                if n.terminal && !n.replies.is_empty() {
                    self.error(
                        &n.id,
                        "replies",
                        "Terminal dialogue cannot also offer replies",
                    );
                }
                if n.replies.len() > CONVERSATION_REPLY_LIMIT {
                    self.error(&n.id, "replies", "A dialogue can have at most 256 replies");
                }
                for r in &n.replies {
                    self.id(&r.id, "id");
                    if r.text.trim().is_empty() {
                        self.error(&r.id, "text", "A response text is required");
                    }
                    self.text(&r.id, "text", &r.text);
                    self.condition(&r.id, "condition", &r.condition);
                    if let Some(node) = &r.destination {
                        self.node_ref(&r.id, "destination", &c.id, node);
                    }
                }
            }
            let nodes: BTreeMap<_, _> = c.nodes.iter().map(|n| (n.id.as_str(), n)).collect();
            let mut pending = vec![c.default_entry.as_str()];
            pending.extend(
                c.entries
                    .iter()
                    .filter(|e| constant(&e.condition) != Some(false))
                    .map(|e| e.node.as_str()),
            );
            let mut seen = BTreeSet::new();
            while let Some(id) = pending.pop() {
                if !seen.insert(id) {
                    continue;
                }
                if let Some(n) = nodes.get(id) {
                    pending.extend(
                        n.replies
                            .iter()
                            .filter(|r| constant(&r.condition) != Some(false))
                            .filter_map(|r| r.destination.as_deref()),
                    );
                }
            }
            for n in &c.nodes {
                if !seen.contains(n.id.as_str()) {
                    self.warn(
                        "unreachable_dialogue",
                        &n.id,
                        "replies",
                        "Dialogue is structurally unreachable from this conversation's entries",
                        json!([c.id, c.default_entry, c.entries]),
                    );
                }
                if !n.terminal && n.replies.is_empty() {
                    self.warn("dialogue_without_replies", &n.id, "replies", "Dialogue has no replies and will close after its line; consider marking it terminal", json!(c.id));
                }
            }
        }
        for q in &self.p.quests {
            self.v5(&q.id, "quest");
            self.id(&q.id, "id");
            if normalize(&q.title).is_empty() {
                self.error(&q.id, "title", "A quest title is required");
            }
            let mut aliases = BTreeSet::from([normalize(&q.title)]);
            for alias in &q.aliases {
                if normalize(alias).is_empty() || !aliases.insert(normalize(alias)) {
                    self.error(
                        &q.id,
                        "aliases",
                        "Quest aliases must be nonempty and unique within the quest",
                    );
                }
            }
            for (field, text) in [
                ("introduction", &q.introduction),
                ("completion", &q.completion),
                ("failure", &q.failure),
            ] {
                self.text(&q.id, field, text);
            }
            for s in &q.stages {
                self.id(&s.id, "id");
                if s.name.trim().is_empty() {
                    self.error(&s.id, "name", "A stage name is required");
                }
                self.text(&s.id, "text", &s.text);
                self.condition(&s.id, "condition", &s.condition);
                let mut prerequisites = BTreeSet::new();
                for id in &s.prerequisites {
                    self.stage_ref(&s.id, "prerequisites", &q.id, id);
                    if !prerequisites.insert(id) {
                        self.error(&s.id, "prerequisites", "Duplicate stage prerequisite");
                    }
                }
            }
            // Kahn's algorithm: bounded by authored stages/edges, not path count.
            let mut degrees = BTreeMap::new();
            let mut dependents = BTreeMap::<&str, Vec<&str>>::new();
            for s in &q.stages {
                degrees.insert(s.id.as_str(), s.prerequisites.len());
                for id in &s.prerequisites {
                    dependents.entry(id).or_default().push(&s.id);
                }
            }
            let mut ready: Vec<_> = degrees
                .iter()
                .filter(|(_, n)| **n == 0)
                .map(|(id, _)| *id)
                .collect();
            let mut done = 0;
            while let Some(id) = ready.pop() {
                done += 1;
                for child in dependents.get(id).into_iter().flatten() {
                    if let Some(n) = degrees.get_mut(child) {
                        *n = n.saturating_sub(1);
                        if *n == 0 {
                            ready.push(child);
                        }
                    }
                }
            }
            if done != q.stages.len() {
                self.error(
                    &q.id,
                    "stages",
                    "Quest prerequisites contain a cycle or missing stage",
                );
            }
            for h in [&q.on_start, &q.on_complete, &q.on_fail] {
                self.id(&h.id, "id");
            }
        }
        for (id, body) in self.p.narrative_roots() {
            self.narrative_root = Some(id);
            self.effects(id, "effects", body);
        }
        self.narrative_root = None;
    }
}

/// Version-specific prefixes; legacy reserved() deliberately remains unchanged.
pub fn narrative_reserved(input: &str) -> bool {
    matches!(
        normalize(input).split_whitespace().next(),
        Some("reply" | "quest" | "quests")
    )
}
/// Report dormant vocabulary as well as live exact bye commands before upgrading.
pub fn narrative_command_conflicts(p: &Project) -> Vec<String> {
    let mut out: Vec<_> = p
        .vocabulary
        .iter()
        .filter(|v| {
            std::iter::once(&v.canonical)
                .chain(&v.synonyms)
                .any(|s| narrative_reserved(s))
        })
        .map(|v| v.id.clone())
        .collect();
    for (_, actions, _) in p.owners() {
        for a in actions {
            if a.pattern.is_empty()
                && p.vocabulary
                    .iter()
                    .filter(|v| v.id == a.verb)
                    .flat_map(|v| std::iter::once(&v.canonical).chain(&v.synonyms))
                    .any(|s| normalize(s) == "bye")
            {
                out.push(a.id.clone());
            }
        }
    }
    out.sort();
    out.dedup();
    out
}
