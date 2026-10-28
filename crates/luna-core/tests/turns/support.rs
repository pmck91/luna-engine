// Fixture construction only: lower T1 marker data to canonical variants BEFORE
// validation/start. Every attempted command uses public production Session APIs.
type Clock = TurnProgress;
type Timer = ScheduledTrigger;
type Cost = TurnCost;
type PendingPolicy = TimerPendingPolicy;
const MAX_PENDING: usize = PENDING_TIMER_LIMIT;
const SAVE_VERSION: u32 = 6;
const SETUP_VERSION: u32 = 4;
#[derive(Debug, Clone, Serialize, Deserialize)]
enum Operation {
    Schedule {
        timer: String,
        after: NumericOperand,
        pending: TimerPendingPolicy,
    },
    Cancel {
        timer: String,
    },
}
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
struct Program {
    enabled: bool,
    policy: TurnPolicy,
    success: BTreeMap<String, TurnCost>,
    failure: BTreeMap<String, TurnCost>,
    replies: BTreeMap<String, TurnCost>,
    timers: Vec<ScheduledTrigger>,
    operations: BTreeMap<String, Operation>,
    conditions: BTreeMap<String, String>,
}
fn convert_condition(c: &mut Condition, g: &Program) {
    match c {
        Condition::Variable {
            name,
            op: Comparison::Eq,
            value: Value::Bool(true),
        } if g.conditions.contains_key(name) => {
            *c = Condition::TimerPending {
                timer: g.conditions[name].clone(),
            };
        }
        Condition::All { conditions } | Condition::Any { conditions } => {
            for c in conditions {
                convert_condition(c, g);
            }
        }
        Condition::Not { condition } => convert_condition(condition, g),
        _ => {}
    }
}
fn convert_effects(body: &mut [Effect], g: &Program) {
    for effect in body {
        if let Effect::Say {
            text: MessageText::Plain(site),
        } = effect
            && let Some(op) = g.operations.get(site)
        {
            *effect = match op {
                Operation::Schedule {
                    timer,
                    after,
                    pending,
                } => Effect::ScheduleTimer {
                    timer: timer.clone(),
                    after: after.clone(),
                    pending: *pending,
                },
                Operation::Cancel { timer } => Effect::CancelTimer {
                    timer: timer.clone(),
                },
            };
        }
        match effect {
            Effect::If {
                condition,
                then,
                otherwise,
            } => {
                convert_condition(condition, g);
                convert_effects(then, g);
                convert_effects(otherwise, g);
            }
            Effect::Respond { on_exhausted, .. } => convert_effects(on_exhausted, g),
            _ => {}
        }
    }
}
fn compile_fixture(mut p: Project, g: Program) -> Project {
    if g.enabled {
        p.game.format_version = 6;
    }
    p.game.turns = g.enabled.then(|| g.policy.clone());
    p.timers = g.timers.clone();
    fn actions(body: &mut [Action], g: &Program) {
        for a in body {
            if g.success.contains_key(&a.id) || g.failure.contains_key(&a.id) {
                a.turn_cost = Some(ActionTurnCost {
                    success: g.success.get(&a.id).copied().unwrap_or_default(),
                    failed_requirements: g.failure.get(&a.id).copied().unwrap_or_default(),
                });
            }
            convert_condition(&mut a.requirements, g);
            convert_effects(&mut a.effects, g);
        }
    }
    fn triggers(body: &mut [Trigger], g: &Program) {
        for t in body {
            convert_condition(&mut t.condition, g);
            convert_effects(&mut t.effects, g);
        }
    }
    actions(&mut p.game.actions, &g);
    triggers(&mut p.game.triggers, &g);
    for l in &mut p.locations {
        actions(&mut l.actions, &g);
        triggers(&mut l.triggers, &g);
        for e in &mut l.exits {
            if g.success.contains_key(&e.id) || g.failure.contains_key(&e.id) {
                e.turn_cost = Some(ActionTurnCost {
                    success: g.success.get(&e.id).copied().unwrap_or_default(),
                    failed_requirements: g.failure.get(&e.id).copied().unwrap_or_default(),
                });
            }
            convert_condition(&mut e.available, &g);
            convert_condition(&mut e.visible, &g);
            convert_effects(&mut e.effects, &g);
        }
    }
    for o in &mut p.objects {
        actions(&mut o.actions, &g);
        triggers(&mut o.triggers, &g);
    }
    for c in &mut p.characters {
        actions(&mut c.actions, &g);
        triggers(&mut c.triggers, &g);
    }
    for t in &mut p.timers {
        convert_condition(&mut t.condition, &g);
        convert_effects(&mut t.effects, &g);
    }
    for procedure in &mut p.procedures {
        convert_effects(&mut procedure.effects, &g);
    }
    for c in &mut p.conversations {
        convert_condition(&mut c.available, &g);
        for e in &mut c.entries {
            convert_condition(&mut e.condition, &g);
        }
        for n in &mut c.nodes {
            convert_effects(&mut n.effects, &g);
            for r in &mut n.replies {
                r.turn_cost = g.replies.get(&r.id).copied().unwrap_or_default();
                convert_condition(&mut r.condition, &g);
                convert_effects(&mut r.effects, &g);
            }
        }
    }
    for q in &mut p.quests {
        for hook in [&mut q.on_start, &mut q.on_complete, &mut q.on_fail] {
            convert_effects(&mut hook.effects, &g);
        }
        for stage in &mut q.stages {
            convert_condition(&mut stage.condition, &g);
            convert_effects(&mut stage.effects, &g);
        }
    }
    p
}
struct Harness {
    session: Session,
}
#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Snapshot {
    version: u32,
    world: GameState,
}
impl Harness {
    fn start(p: Project, g: Program) -> Result<(Self, CommandResult)> {
        let p = compile_fixture(p, g);
        let diagnostics = validate(&p);
        ensure!(
            !has_errors(&diagnostics),
            "Invalid fixture: {diagnostics:#?}"
        );
        let (session, result) = Session::start(p, None)?;
        Ok((Self { session }, result))
    }
    fn clock(&self) -> TurnProgress {
        self.session.state().turns.clone().unwrap_or_default()
    }
    fn edit_clock(&mut self, change: impl FnOnce(&mut TurnProgress)) {
        let mut state = self.session.state().clone();
        change(state.turns.as_mut().unwrap());
        self.session.replace_state(state).unwrap();
    }
    fn command(&mut self, input: &str) -> CommandResult {
        let result = self.session.command(input).unwrap();
        self.session
            .definition()
            .validate_state(self.session.state())
            .unwrap();
        result
    }
    fn attempt(
        &mut self,
        input: &str,
        selection: Option<(&str, &str)>,
        explain: bool,
    ) -> (CommandResult, Option<anyhow::Error>) {
        if explain {
            let result = if let Some((token, id)) = selection {
                self.session.select_reply_explained(token, id)
            } else {
                self.session.command_explained(input)
            };
            let error = (result.status == CommandStatus::Error)
                .then(|| anyhow::anyhow!("Execution failed"));
            (result, error)
        } else {
            match if let Some((token, id)) = selection {
                self.session.select_reply(token, id)
            } else {
                self.session.command(input)
            } {
                Ok(r) => (r, None),
                Err(e) => (
                    CommandResult {
                        status: CommandStatus::Error,
                        ..Default::default()
                    },
                    Some(e),
                ),
            }
        }
    }
    fn snapshot(&self, version: u32) -> Vec<u8> {
        serde_json::to_vec(&Snapshot {
            version,
            world: self.session.state().clone(),
        })
        .unwrap()
    }
    fn restore(&mut self, bytes: &[u8], expected: u32) -> Result<()> {
        let snapshot: Snapshot = serde_json::from_slice(bytes)?;
        ensure!(
            matches!(expected, SAVE_VERSION | SETUP_VERSION) && snapshot.version == expected,
            "Unsupported snapshot"
        );
        self.session =
            Session::restore_with_definition(self.session.definition().clone(), snapshot.world)?;
        Ok(())
    }
}
