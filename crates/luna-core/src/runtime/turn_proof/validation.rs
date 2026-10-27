use super::*;
use serde::de::{MapAccess, Visitor};
use std::fmt;

pub(super) fn pending_map<'de, D: serde::Deserializer<'de>>(
    d: D,
) -> std::result::Result<BTreeMap<String, Pending>, D::Error> {
    struct Entries;
    impl<'de> Visitor<'de> for Entries {
        type Value = BTreeMap<String, Pending>;
        fn expecting(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
            f.write_str("unique pending timer IDs")
        }
        fn visit_map<M: MapAccess<'de>>(
            self,
            mut m: M,
        ) -> std::result::Result<Self::Value, M::Error> {
            let mut entries = BTreeMap::new();
            while let Some((id, pending)) = m.next_entry::<String, Pending>()? {
                if entries.len() >= MAX_PENDING || entries.insert(id, pending).is_some() {
                    return Err(serde::de::Error::custom(
                        "Duplicate or excessive pending timers",
                    ));
                }
            }
            Ok(entries)
        }
    }
    d.deserialize_map(Entries)
}

impl Program {
    pub(super) fn validate(&self, p: &Project) -> Result<()> {
        ensure!(
            self.enabled
                || (self.timers.is_empty()
                    && self.operations.is_empty()
                    && self.conditions.is_empty()
                    && self.success.is_empty()
                    && self.failure.is_empty()
                    && self.replies.is_empty()),
            "Remove timers and overrides before disabling turns"
        );
        let mut ids = BTreeSet::new();
        let mut orders = BTreeSet::new();
        for timer in &self.timers {
            ensure!(
                safe_id(&timer.id)
                    && ids.insert(&timer.id)
                    && orders.insert(timer.order)
                    && !timer.name.trim().is_empty(),
                "Invalid or duplicate timer definition"
            );
        }
        for op in self.operations.values() {
            let id = match op {
                Operation::Schedule { timer, .. } | Operation::Cancel { timer } => timer,
            };
            ensure!(ids.contains(id), "Missing timer reference");
        }
        for (name, id) in &self.conditions {
            ensure!(
                ids.contains(id) && !p.game.variables.contains_key(name),
                "Missing timer or overlapping proxy condition"
            );
        }
        let roots = p
            .owners()
            .into_iter()
            .flat_map(|(_, actions, _)| actions.iter().map(|a| a.id.as_str()))
            .chain(
                p.locations
                    .iter()
                    .flat_map(|l| l.exits.iter().map(|e| e.id.as_str())),
            )
            .collect::<BTreeSet<_>>();
        ensure!(
            self.success
                .keys()
                .chain(self.failure.keys())
                .all(|id| roots.contains(id.as_str())),
            "Turn override must name an action or exit"
        );
        let replies = p
            .conversations
            .iter()
            .flat_map(|c| &c.nodes)
            .flat_map(|n| &n.replies)
            .map(|r| r.id.as_str())
            .collect::<BTreeSet<_>>();
        ensure!(
            self.replies.keys().all(|id| replies.contains(id.as_str())),
            "Unknown reply turn override"
        );
        if self.enabled {
            ensure!(
                wait_conflicts(p).is_empty(),
                "WAIT command conflicts require explicit repair"
            );
        }
        Ok(())
    }
    pub(super) fn validate_clock(&self, clock: &Clock, ended: bool) -> Result<()> {
        ensure!(
            self.enabled || clock == &Clock::default(),
            "Disabled clock must be empty"
        );
        ensure!(
            clock.pending.len() <= MAX_PENDING && (!ended || clock.pending.is_empty()),
            "Invalid pending queue"
        );
        for (id, pending) in &clock.pending {
            ensure!(
                self.timers.iter().any(|t| &t.id == id),
                "Unknown pending timer"
            );
            ensure!(
                pending.deadline > clock.turn,
                "Overdue timer in committed snapshot"
            );
            ensure!(
                matches!(self.operations.get(&pending.source), Some(Operation::Schedule { timer, .. }) if timer == id),
                "Unknown or foreign scheduling source"
            );
        }
        Ok(())
    }
}

// Whole WAIT only. Valid native verbs and pattern parts each consume at least
// one token. Named exits also consume a nonempty route name after their verb;
// `go wait` and `wait door` therefore remain ordinary authored commands.
pub(super) fn wait_conflicts(p: &Project) -> Vec<String> {
    let forms = |verb: &str| {
        p.vocabulary
            .iter()
            .find(|v| v.id == verb)
            .into_iter()
            .flat_map(|v| std::iter::once(&v.canonical).chain(&v.synonyms))
            .map(|s| normalize(s))
            .collect::<Vec<_>>()
    };
    let matches = |verb: &str, pattern: &[PatternPart]| {
        pattern.is_empty() && forms(verb).iter().any(|s| s == "wait")
    };
    let mut conflicts = p
        .owners()
        .into_iter()
        .flat_map(|(_, actions, _)| actions)
        .filter(|a| matches(&a.verb, &a.pattern))
        .map(|a| a.id.clone())
        .collect::<Vec<_>>();
    conflicts.sort();
    conflicts.dedup();
    conflicts
}
