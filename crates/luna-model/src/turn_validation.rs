use super::*;
impl Check<'_> {
    fn turn_feature(&mut self, subject: &str, field: &str) {
        if self.p.game.format_version < 6 {
            self.error(
                subject,
                field,
                "Turns require an explicit upgrade to content format 6",
            );
        }
        if self.p.game.turns.is_none() {
            self.error(
                subject,
                field,
                "Enable turns before using timers or turn-cost overrides",
            );
        }
    }
    pub(super) fn timer_ref(&mut self, subject: &str, field: &str, id: &str) {
        self.turn_feature(subject, field);
        if !self.p.timers.iter().any(|t| t.id == id) {
            self.error(subject, field, format!("Missing timer: {id}"));
        }
    }
    pub(super) fn turns(&mut self) {
        if self.p.game.turns.is_some() {
            self.turn_feature(&self.p.game.id, "turns");
        }
        let mut orders = BTreeSet::new();
        self.item_input = false;
        self.procedure = None;
        for timer in &self.p.timers {
            self.turn_feature(&timer.id, "timer");
            self.id(&timer.id, "id");
            if timer.name.trim().is_empty() {
                self.error(&timer.id, "name", "A timer name is required");
            }
            if !orders.insert(timer.order) {
                self.error(&timer.id, "order", "Timer order must be unique");
            }
            self.condition(&timer.id, "condition", &timer.condition);
            self.effects(&timer.id, "effects", &timer.effects);
        }
        for (_, actions, _) in self.p.owners() {
            for action in actions {
                if action.turn_cost.as_ref().is_some_and(|c| !c.is_default()) {
                    self.turn_feature(&action.id, "turn_cost");
                }
            }
        }
        for l in &self.p.locations {
            for e in &l.exits {
                if e.turn_cost.as_ref().is_some_and(|c| !c.is_default()) {
                    self.turn_feature(&e.id, "turn_cost");
                }
            }
        }
        for reply in self
            .p
            .conversations
            .iter()
            .flat_map(|c| &c.nodes)
            .flat_map(|n| &n.replies)
        {
            if !reply.turn_cost.is_default() {
                self.turn_feature(&reply.id, "turn_cost");
            }
        }
        if self.p.game.turns.is_some() {
            for id in wait_command_conflicts(self.p) {
                self.error(&id, "pattern", "The exact command WAIT is reserved while turns are enabled. Repair this command before enabling turns.");
            }
        }
    }
}
