//! Candidate structural checks; canonical storage/visitors remain N2 work.
use super::*;
use crate::GameDefinition;
use luna_model::{Action, PatternPart, SequenceMode};
impl Program {
    fn bodies(&self) -> BTreeMap<&str, &[Step]> {
        let mut bodies: BTreeMap<_, _> = self
            .flows
            .iter()
            .map(|(id, body)| (id.as_str(), body.as_slice()))
            .collect();
        for c in &self.conversations {
            for n in &c.nodes {
                bodies.insert(&n.id, &n.effects);
                for r in &n.replies {
                    bodies.insert(&r.id, &r.effects);
                }
            }
        }
        for q in &self.quests {
            for h in [&q.on_start, &q.on_complete, &q.on_fail] {
                bodies.insert(&h.id, &h.effects);
            }
            for s in &q.stages {
                bodies.insert(&s.id, &s.effects);
            }
        }
        bodies
    }
    pub(super) fn sequence_owners(&self) -> Result<BTreeMap<String, String>> {
        let mut owners = BTreeMap::new();
        for (root, body) in self
            .bodies()
            .into_iter()
            .filter(|(root, _)| self.narrative_root(root))
        {
            for step in body {
                if let Step::Native { effect } = step {
                    let mut effects = vec![];
                    luna_model::walk_effects(std::slice::from_ref(effect), &mut effects);
                    for effect in effects {
                        if let Effect::Respond { id, .. } = effect {
                            ensure!(
                                owners.insert(id.clone(), root.into()).is_none(),
                                "Duplicate narrative sequence ID"
                            );
                        }
                    }
                }
            }
        }
        Ok(owners)
    }
    fn validate_gate(&self, p: &Project, gate: &Gate, depth: usize) -> Result<()> {
        ensure!(depth < 64, "Narrative condition nesting exceeded 64");
        match gate {
            Gate::Native { condition } => ensure!(
                !luna_model::has_errors(&luna_model::validate_condition(p, condition)),
                "Invalid native narrative condition"
            ),
            Gate::Quest { quest, .. } => {
                self.quest(quest)?;
            }
            Gate::Stage { quest, stage } => {
                self.stage(self.quest(quest)?, stage)?;
            }
            Gate::Visited { conversation, node } => {
                self.node(self.conversation(conversation)?, node)?;
            }
            Gate::Chosen {
                conversation,
                reply,
            } => ensure!(
                self.conversation(conversation)?
                    .nodes
                    .iter()
                    .any(|n| n.replies.iter().any(|r| r.id == *reply)),
                "Reply history belongs to another conversation"
            ),
            Gate::All { conditions } => {
                for c in conditions {
                    self.validate_gate(p, c, depth + 1)?;
                }
            }
            Gate::Not { condition } => self.validate_gate(p, condition, depth + 1)?,
        }
        Ok(())
    }
    pub(super) fn conflicts(&self, p: &Project) -> Vec<String> {
        if !self.enabled {
            return vec![];
        }
        // Audit unused vocabulary too: a later action must not turn a dormant
        // reserved prefix into an unreachable authored command after upgrading.
        let mut conflicts: Vec<_> = p
            .vocabulary
            .iter()
            .filter(|verb| {
                std::iter::once(&verb.canonical)
                    .chain(&verb.synonyms)
                    .any(|phrase| {
                        ["reply", "quest", "quests"].contains(
                            &luna_model::normalize(phrase)
                                .split_whitespace()
                                .next()
                                .unwrap_or(""),
                        )
                    })
            })
            .map(|verb| verb.id.clone())
            .collect();
        for (_, actions, _) in p.owners() {
            for a in actions {
                if p.vocabulary
                    .iter()
                    .filter(|v| v.id == a.verb)
                    .flat_map(|v| std::iter::once(&v.canonical).chain(&v.synonyms))
                    .any(|phrase| {
                        let normalized = luna_model::normalize(phrase);
                        let first = normalized.split_whitespace().next().unwrap_or("");
                        ["reply", "quest", "quests"].contains(&first)
                            || (normalized == "bye"
                                && a.pattern.is_empty()
                                && !self.conversations.is_empty())
                    })
                {
                    conflicts.push(a.id.clone());
                }
            }
        }
        for l in &p.locations {
            for exit in &l.exits {
                if p.vocabulary
                    .iter()
                    .filter(|v| v.id == exit.verb)
                    .flat_map(|v| std::iter::once(&v.canonical).chain(&v.synonyms))
                    .any(|phrase| {
                        ["reply", "quest", "quests"].contains(
                            &luna_model::normalize(phrase)
                                .split_whitespace()
                                .next()
                                .unwrap_or(""),
                        )
                    })
                {
                    conflicts.push(exit.id.clone());
                }
            }
        }
        conflicts.sort();
        conflicts.dedup();
        conflicts
    }
    pub(super) fn validate(&self, p: &Project) -> Result<()> {
        let mut ids: BTreeSet<_> = std::iter::once(p.game.id.clone())
            .chain(p.vocabulary.iter().map(|v| v.id.clone()))
            .chain(p.locations.iter().map(|l| l.id.clone()))
            .chain(p.objects.iter().map(|o| o.id.clone()))
            .chain(p.characters.iter().map(|c| c.id.clone()))
            .chain(p.game.endings.iter().map(|e| e.id.clone()))
            .chain(p.procedures.iter().map(|p| p.id.clone()))
            .collect();
        for (_, actions, triggers) in p.owners() {
            ids.extend(actions.iter().map(|a| a.id.clone()));
            ids.extend(triggers.iter().map(|t| t.id.clone()));
        }
        ids.extend(
            p.locations
                .iter()
                .flat_map(|l| l.exits.iter().map(|e| e.id.clone())),
        );
        for e in luna_model::all_effects(p) {
            match e {
                Effect::Call { id, .. } | Effect::Respond { id, .. } => {
                    ids.insert(id.clone());
                }
                _ => {}
            }
        }
        let mut insert = |id: &str| -> Result<()> {
            ensure!(
                luna_model::safe_id(id) && ids.insert(id.into()),
                "Invalid/duplicate narrative identity: {id}"
            );
            ensure!(
                !self.flows.contains_key(id),
                "Narrative identity collides with native flow overlay"
            );
            Ok(())
        };
        for c in &self.conversations {
            insert(&c.id)?;
            for n in &c.nodes {
                insert(&n.id)?;
                for r in &n.replies {
                    insert(&r.id)?;
                }
            }
        }
        for q in &self.quests {
            insert(&q.id)?;
            for h in [&q.on_start, &q.on_complete, &q.on_fail] {
                insert(&h.id)?;
            }
            for s in &q.stages {
                insert(&s.id)?;
            }
        }
        ensure!(
            self.conflicts(p).is_empty(),
            "Narrative reserved command collisions: {:?}",
            self.conflicts(p)
        );
        for c in &self.conversations {
            ensure!(
                p.characters
                    .iter()
                    .any(|character| character.id == c.character),
                "Conversation speaker must be a character"
            );
            self.node(c, &c.default_entry)?;
            self.validate_gate(p, &c.available, 0)?;
            for entry in &c.entries {
                self.node(c, &entry.node)?;
                self.validate_gate(p, &entry.condition, 0)?;
            }
            for n in &c.nodes {
                ensure!(
                    !n.terminal || n.replies.is_empty(),
                    "Terminal dialogue cannot have replies"
                );
                ensure!(n.replies.len() <= REPLY_LIMIT, "Too many replies at a node");
                for r in &n.replies {
                    ensure!(!r.text.trim().is_empty(), "Empty player response");
                    self.validate_gate(p, &r.condition, 0)?;
                    if let Some(destination) = &r.destination {
                        self.node(c, destination)?;
                    }
                }
            }
        }
        for q in &self.quests {
            ensure!(
                !luna_model::normalize(&q.title).is_empty(),
                "Empty quest title"
            );
            let mut completed = BTreeSet::new();
            for s in &q.stages {
                self.validate_gate(p, &s.condition, 0)?;
                ensure!(
                    s.prerequisites.iter().collect::<BTreeSet<_>>().len() == s.prerequisites.len(),
                    "Duplicate stage prerequisite"
                );
                for prerequisite in &s.prerequisites {
                    self.stage(q, prerequisite)?;
                }
            }
            loop {
                let ready: Vec<_> = q
                    .stages
                    .iter()
                    .filter(|s| {
                        !completed.contains(&s.id)
                            && s.prerequisites.iter().all(|id| completed.contains(id))
                    })
                    .map(|s| s.id.clone())
                    .collect();
                if ready.is_empty() {
                    break;
                }
                completed.extend(ready);
            }
            ensure!(
                completed.len() == q.stages.len(),
                "Quest stage prerequisite cycle"
            );
        }
        let sequence_owners = self.sequence_owners()?;
        for (root, body) in self.bodies() {
            for step in body {
                match step {
                    Step::Start { conversation }
                    | Step::Pause { conversation }
                    | Step::End { conversation } => {
                        self.conversation(conversation)?;
                    }
                    Step::StartQuest { quest }
                    | Step::CompleteQuest { quest }
                    | Step::FailQuest { quest } => {
                        self.quest(quest)?;
                    }
                    Step::RecordStage { quest, stage } => {
                        self.stage(self.quest(quest)?, stage)?;
                    }
                    Step::Native { effect } => {
                        let mut effects = vec![];
                        luna_model::walk_effects(std::slice::from_ref(effect), &mut effects);
                        for e in effects {
                            if let Effect::ResetResponses { sequence } = e
                                && let Some(owner) = sequence_owners.get(sequence)
                            {
                                ensure!(
                                    owner == root,
                                    "External reset into another narrative root"
                                );
                            }
                        }
                    }
                }
            }
        }
        let native = self.native_project(p)?;
        let diagnostics = luna_model::validate(&native);
        ensure!(
            !luna_model::has_errors(&diagnostics),
            "Invalid native proof definition: {diagnostics:?}"
        );
        GameDefinition::new(native)?;
        Ok(())
    }
    pub(super) fn native_project(&self, original: &Project) -> Result<Project> {
        let mut p = original.clone();
        for (root, body) in self.bodies() {
            let mut effects: Vec<Effect> = body
                .iter()
                .filter_map(|s| {
                    if let Step::Native { effect } = s {
                        Some(effect.clone())
                    } else {
                        None
                    }
                })
                .collect();
            // Include dialogue/journal strings in the real message validator.
            for c in &self.conversations {
                for n in &c.nodes {
                    if n.id == root {
                        effects.push(Effect::Say {
                            text: n.text.clone().into(),
                        });
                    }
                    for r in &n.replies {
                        if r.id == root {
                            effects.push(Effect::Say {
                                text: r.text.clone().into(),
                            });
                        }
                    }
                }
            }
            for q in &self.quests {
                let t = if q.on_start.id == root {
                    Some(&q.introduction)
                } else if q.on_complete.id == root {
                    Some(&q.completion)
                } else if q.on_fail.id == root {
                    Some(&q.failure)
                } else {
                    q.stages.iter().find(|s| s.id == root).map(|s| &s.text)
                };
                if let Some(t) = t {
                    effects.push(Effect::Say {
                        text: t.clone().into(),
                    });
                }
            }
            let mut found = false;
            for a in &mut p.game.actions {
                if a.id == root {
                    a.effects = effects.clone();
                    found = true;
                }
            }
            for t in &mut p.game.triggers {
                if t.id == root {
                    t.effects = effects.clone();
                    found = true;
                }
            }
            for c in &mut p.characters {
                for t in &mut c.triggers {
                    if t.id == root {
                        t.effects = effects.clone();
                        found = true;
                    }
                }
            }
            if !found {
                p.game.actions.push(Action {
                    id: root.into(),
                    verb: "use".into(),
                    pattern: vec![PatternPart::Literal {
                        text: format!("proof-only-{root}"),
                    }],
                    requirements: Condition::False,
                    effects,
                    ..Default::default()
                });
            }
        }
        Ok(p)
    }
    pub(super) fn validate_story(
        &self,
        p: &Project,
        world: &luna_model::GameState,
        story: &Story,
    ) -> Result<()> {
        ensure!(
            story.progress_entries() <= PROGRESS_LIMIT && story.text_bytes() <= JOURNAL_BYTES,
            "Narrative progress exceeds resource bounds"
        );
        for (id, history) in &story.conversations {
            let c = self.conversation(id)?;
            for node in &history.visited {
                self.node(c, node)?;
            }
            for reply in &history.chosen {
                ensure!(
                    c.nodes.iter().any(|n| history.visited.contains(&n.id)
                        && n.replies.iter().any(|r| r.id == *reply)),
                    "Unknown/cross-conversation chosen reply or unvisited reply owner"
                );
            }
            if let Some(checkpoint) = &history.checkpoint {
                let node = self.node(c, checkpoint.node())?;
                if let Checkpoint::Entered { prompt, .. } = checkpoint {
                    ensure!(
                        history.visited.contains(&node.id) && !node.terminal,
                        "Invalid entered checkpoint"
                    );
                    valid_spans(prompt)?;
                }
            }
        }
        if let Some(active) = &story.active {
            let c = self.conversation(active)?;
            ensure!(
                world.ending.is_none(),
                "Ended game retains active conversation"
            );
            ensure!(
                matches!(
                    story
                        .conversations
                        .get(active)
                        .and_then(|c| c.checkpoint.as_ref()),
                    Some(Checkpoint::Entered { .. })
                ),
                "Active conversation has no entered checkpoint"
            );
            let character = world
                .characters
                .get(&c.character)
                .context("Missing active speaker")?;
            ensure!(
                !character.hidden && character.location == world.location,
                "Active speaker is out of scope"
            );
        }
        if world.ending.is_some() {
            ensure!(
                story.conversations.values().all(|c| c.checkpoint.is_none()),
                "Ended game retains unfinished checkpoints"
            );
        }
        let mut bytes = 0usize;
        let mut entries = 0usize;
        for (id, progress) in &story.quests {
            let q = self.quest(id)?;
            let mut stages = BTreeSet::new();
            for (index, entry) in progress.journal.iter().enumerate() {
                valid_spans(&entry.text)?;
                bytes += entry.text.iter().map(|span| span.text.len()).sum::<usize>();
                entries += 1;
                match &entry.kind {
                    JournalKind::Started => ensure!(
                        index == 0 && progress.status != QuestStatus::Undiscovered,
                        "Invalid quest introduction ordering"
                    ),
                    JournalKind::Stage { stage } => {
                        let s = self.stage(q, stage)?;
                        ensure!(
                            index > 0
                                && matches!(progress.journal[0].kind, JournalKind::Started)
                                && stages.insert(stage.clone()),
                            "Duplicate/unstarted journal milestone"
                        );
                        ensure!(
                            s.prerequisites.iter().all(|id| stages.contains(id)),
                            "Journal stage precedes prerequisite"
                        );
                    }
                    JournalKind::Completed => ensure!(
                        progress.status == QuestStatus::Completed
                            && index + 1 == progress.journal.len()
                            && index > 0,
                        "Invalid quest completion journal"
                    ),
                    JournalKind::Failed => ensure!(
                        progress.status == QuestStatus::Failed
                            && index + 1 == progress.journal.len()
                            && index > 0,
                        "Invalid quest failure journal"
                    ),
                }
            }
            ensure!(
                stages == progress.stages,
                "Quest milestones and journal differ"
            );
            match progress.status {
                QuestStatus::Undiscovered => ensure!(
                    progress.journal.is_empty() && progress.stages.is_empty(),
                    "Undiscovered quest has progress"
                ),
                QuestStatus::Active => ensure!(
                    matches!(
                        progress.journal.first().map(|e| &e.kind),
                        Some(JournalKind::Started)
                    ) && progress.journal.iter().all(|e| matches!(
                        e.kind,
                        JournalKind::Started | JournalKind::Stage { .. }
                    )),
                    "Active quest has terminal/invalid history"
                ),
                QuestStatus::Completed => ensure!(
                    matches!(
                        progress.journal.first().map(|e| &e.kind),
                        Some(JournalKind::Started)
                    ) && matches!(
                        progress.journal.last().map(|e| &e.kind),
                        Some(JournalKind::Completed)
                    ) && q
                        .stages
                        .iter()
                        .filter(|s| s.required)
                        .all(|s| stages.contains(&s.id)),
                    "Completed quest lacks required milestones"
                ),
                QuestStatus::Failed => ensure!(
                    matches!(
                        progress.journal.first().map(|e| &e.kind),
                        Some(JournalKind::Started)
                    ) && matches!(
                        progress.journal.last().map(|e| &e.kind),
                        Some(JournalKind::Failed)
                    ),
                    "Failed quest has invalid history"
                ),
            }
        }
        ensure!(
            bytes <= JOURNAL_BYTES && entries <= PROGRESS_LIMIT,
            "Narrative journal exceeds bounds"
        );
        let owners = self.sequence_owners()?;
        for (id, cursor) in &story.sequences {
            let root = owners
                .get(id)
                .context("Unknown narrative response cursor")?;
            let mut found = None;
            for step in self.body(root).unwrap() {
                if let Step::Native { effect } = step {
                    let mut effects = vec![];
                    luna_model::walk_effects(std::slice::from_ref(effect), &mut effects);
                    for effect in effects {
                        if let Effect::Respond {
                            id: sequence,
                            responses,
                            mode,
                            on_exhausted,
                            ..
                        } = effect
                            && sequence == id
                        {
                            let max = match mode {
                                SequenceMode::Loop | SequenceMode::RepeatLast => {
                                    responses.len().saturating_sub(1)
                                }
                                SequenceMode::Fallback => {
                                    responses.len() + usize::from(!on_exhausted.is_empty())
                                }
                            };
                            found = Some(max);
                        }
                    }
                }
            }
            ensure!(
                found.is_some_and(|max| *cursor <= max),
                "Invalid narrative response cursor"
            );
        }
        GameDefinition::new(self.native_project(p)?)?.validate_state(world)?;
        Ok(())
    }
}
fn valid_spans(spans: &[text::Span]) -> Result<()> {
    for span in spans {
        ensure!(
            span.colour
                .as_deref()
                .is_none_or(|colour| text::COLOURS.contains(&colour))
                && !span
                    .text
                    .chars()
                    .any(|c| c.is_control() && c != '\n' && c != '\t'),
            "Unsafe narrative text span"
        );
    }
    Ok(())
}
