//! Native proxy validation plus strict, non-replaying candidate-state checks.
use super::*;
use serde::de::{MapAccess, Visitor};
use std::fmt;

pub(super) fn unique_runs<'de, D: serde::Deserializer<'de>>(
    decoder: D,
) -> std::result::Result<BTreeMap<String, Status>, D::Error> {
    struct Entries;
    impl<'de> Visitor<'de> for Entries {
        type Value = BTreeMap<String, Status>;
        fn expecting(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
            f.write_str("bounded, unique routine identities")
        }
        fn visit_map<M: MapAccess<'de>>(
            self,
            mut map: M,
        ) -> std::result::Result<Self::Value, M::Error> {
            let mut result = BTreeMap::new();
            while let Some((id, value)) = map.next_entry::<String, Status>()? {
                if result.len() >= ROUTINE_LIMIT || result.insert(id, value).is_some() {
                    return Err(serde::de::Error::custom(
                        "Duplicate or excessive routine progress",
                    ));
                }
            }
            Ok(result)
        }
    }
    decoder.deserialize_map(Entries)
}
pub(super) fn compile(mut project: Project, program: &Program) -> Result<Project> {
    ensure!(
        project.game.turns.is_some() && project.game.format_version >= 6,
        "Routines require an enabled native clock"
    );
    ensure!(
        program.routines.len() <= ROUTINE_LIMIT,
        "Too many routine definitions"
    );
    let mut ids = BTreeSet::new();
    let mut orders = BTreeSet::new();
    let mut automatic = BTreeSet::new();
    for r in &program.routines {
        ensure!(
            safe_id(&r.id) && ids.insert(&r.id) && !r.name.trim().is_empty(),
            "Invalid or duplicate routine identity/name"
        );
        ensure!(orders.insert(r.order), "Duplicate routine author order");
        ensure!(
            project.characters.iter().any(|c| c.id == r.character),
            "Unknown routine owner"
        );
        ensure!(
            !r.steps.is_empty() && r.steps.len() <= STEP_LIMIT,
            "Invalid routine step count"
        );
        if !matches!(r.start, Start::Blocks) {
            ensure!(
                automatic.insert(&r.character),
                "Multiple automatic routines for one character"
            );
        }
        let mut root_conditions = vec![Condition::False];
        if let Start::When { condition } = &r.start {
            root_conditions.push(condition.clone());
        }
        if let Repeat::While { condition } | Repeat::Until { condition } = &r.repeat {
            root_conditions.push(condition.clone());
        }
        project.game.triggers.push(Trigger {
            id: r.id.clone(),
            name: r.name.clone(),
            event: Event::Turn,
            condition: Condition::All {
                conditions: root_conditions,
            },
            ..Default::default()
        });
        for s in &r.steps {
            ensure!(
                safe_id(&s.id) && ids.insert(&s.id) && !s.name.trim().is_empty(),
                "Invalid or duplicate step identity/name"
            );
            let mut effects = s.effects.clone();
            if let Some(wait) = &s.wait {
                if let NumericOperand::Literal { value } = wait {
                    ensure!(*value > 0, "Nonpositive routine wait");
                }
                project
                    .game
                    .variables
                    .entry("routine_proof_operand".into())
                    .or_insert(Value::Integer(0));
                effects.push(Effect::UpdateVariable {
                    name: "routine_proof_operand".into(),
                    op: ArithmeticOperation::Add,
                    operand: wait.clone(),
                });
            }
            project.game.triggers.push(Trigger {
                id: s.id.clone(),
                name: s.name.clone(),
                event: Event::Turn,
                condition: Condition::All {
                    conditions: vec![Condition::False, s.condition.clone()],
                },
                effects,
                ..Default::default()
            });
        }
    }
    for control in program.controls.values() {
        program.definition(control.routine())?;
    }
    for (marker, (id, _)) in &program.queries {
        program.definition(id)?;
        ensure!(
            !project.game.variables.contains_key(marker),
            "Query marker shadows a variable"
        );
        project
            .game
            .variables
            .insert(marker.clone(), Value::Bool(true));
    }
    let diagnostics = validate(&project);
    ensure!(
        !has_errors(&diagnostics),
        "Invalid native candidate fixture: {diagnostics:#?}"
    );
    Ok(project)
}
pub(super) fn state(program: &Program, world: &GameState, progress: &Progress) -> Result<()> {
    let turn = world.turns.as_ref().context("Missing routine clock")?.turn;
    ensure!(
        progress.runs.len() <= ROUTINE_LIMIT,
        "Too many routine states"
    );
    let mut active = BTreeSet::new();
    for (id, status) in &progress.runs {
        let definition = program.definition(id)?;
        let Some(cursor) = status.cursor() else {
            continue;
        };
        ensure!(world.ending.is_none(), "Ended game has active routines");
        ensure!(
            active.insert(&definition.character),
            "More than one active routine for a character"
        );
        ensure!(cursor.after <= turn, "Future routine readiness origin");
        let step = definition
            .steps
            .iter()
            .find(|s| s.id == cursor.step)
            .context("Missing or foreign routine step")?;
        if let Some(wait) = &cursor.wait {
            ensure!(step.wait.is_some(), "Wait stored on an immediate step");
            ensure!(
                wait.captured <= i32::MAX as u32
                    && wait.remaining > 0
                    && wait.remaining < wait.captured,
                "Invalid captured routine wait"
            );
        }
    }
    Ok(())
}
