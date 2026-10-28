use super::*;
impl Check<'_> {
    fn routine_feature(&mut self, subject: &str, field: &str) {
        if self.p.game.format_version < 7 {
            self.error(
                subject,
                field,
                "Routines require an explicit upgrade to content format 7",
            );
        }
        if self.p.game.turns.is_none() {
            self.error(subject, field, "Enable turns before using routines");
        }
    }
    pub(super) fn routine_ref(&mut self, subject: &str, field: &str, id: &str) {
        self.routine_feature(subject, field);
        if !self.p.routines.iter().any(|r| r.id == id) {
            self.error(subject, field, format!("Missing routine: {id}"));
        }
    }
    pub(super) fn routines(&mut self) {
        if self.p.routines.len() > ROUTINE_LIMIT {
            self.error(
                &self.p.game.id,
                "routines",
                "Too many routines (maximum 1024)",
            );
        }
        self.item_input = false;
        self.procedure = None;
        let mut orders = BTreeSet::new();
        let mut automatic = BTreeSet::new();
        for r in &self.p.routines {
            self.routine_feature(&r.id, "routine");
            self.id(&r.id, "id");
            if r.name.trim().is_empty() {
                self.error(&r.id, "name", "A routine name is required");
            }
            self.character(&r.id, "character", &r.character);
            if !orders.insert(r.order) {
                self.error(&r.id, "order", "Routine order must be unique");
            }
            if !matches!(r.start, RoutineStart::Blocks) && !automatic.insert(&r.character) {
                self.error(
                    &r.id,
                    "start",
                    "Only one automatic routine is allowed per character",
                );
            }
            if let RoutineStart::When { condition } = &r.start {
                self.condition(&r.id, "start.condition", condition);
            }
            if let RoutineRepeat::While { condition } | RoutineRepeat::Until { condition } =
                &r.repeat
            {
                self.condition(&r.id, "repeat.condition", condition);
            }
            if r.steps.is_empty() || r.steps.len() > ROUTINE_STEP_LIMIT {
                self.error(&r.id, "steps", "A routine requires 1 through 256 steps");
            }
            for step in &r.steps {
                self.id(&step.id, "id");
                if step.name.trim().is_empty() {
                    self.error(&step.id, "name", "A step name is required");
                }
                self.condition(&step.id, "condition", &step.condition);
                if let Some(wait) = &step.wait {
                    self.operand_at(&step.id, "wait", ArithmeticOperation::Add, wait);
                    if matches!(wait, NumericOperand::Literal { value } if *value <= 0) {
                        self.error(&step.id, "wait", "A routine wait must be positive");
                    }
                }
                self.effects(&step.id, "effects", &step.effects);
            }
        }
    }
}
