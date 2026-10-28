// Fixture lowering only. All startup, dispatch and restore use public Session APIs.
type Step = RoutineStep;
type Routine = CharacterRoutine;
type Start = RoutineStart;
type Repeat = RoutineRepeat;
type Blocked = RoutineBlocked;
type Progress = RoutineProgress;
type Status = RoutineRun;
type Cursor = RoutineCursor;
type Waiting = RoutineWait;
type Query = RoutineStatus;
const STEP_LIMIT: usize = ROUTINE_STEP_LIMIT;
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case", deny_unknown_fields)]
enum Control {
    Start { routine: String, replace: bool },
    Pause { routine: String },
    Resume { routine: String },
    Stop { routine: String },
}
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Program {
    routines: Vec<Routine>,
    controls: BTreeMap<String, Control>,
    queries: BTreeMap<String, (String, Query)>,
}
fn convert_condition(c: &mut Condition, g: &Program) {
    match c {
        Condition::Variable {
            name,
            op: Comparison::Eq,
            value: Value::Bool(true),
        } if g.queries.contains_key(name) => {
            let (routine, status) = &g.queries[name];
            *c = Condition::RoutineStatus { routine: routine.clone(), status: *status };
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
            && let Some(op) = g.controls.get(site)
        {
            *effect = match op {
                Control::Start { routine, replace } => Effect::StartRoutine { routine: routine.clone(), busy: if *replace { RoutineBusyPolicy::Replace } else { RoutineBusyPolicy::Keep } },
                Control::Pause { routine } => Effect::PauseRoutine { routine: routine.clone() },
                Control::Resume { routine } => Effect::ResumeRoutine { routine: routine.clone() },
                Control::Stop { routine } => Effect::StopRoutine { routine: routine.clone() },
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
    p.routines = g.routines.clone();
    fn actions(body: &mut [Action], g: &Program) {
        for a in body {
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
    for r in &mut p.routines {
        if let RoutineStart::When { condition } = &mut r.start { convert_condition(condition, &g); }
        if let RoutineRepeat::While { condition } | RoutineRepeat::Until { condition } = &mut r.repeat { convert_condition(condition, &g); }
        for s in &mut r.steps { convert_condition(&mut s.condition, &g); convert_effects(&mut s.effects, &g); }
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
    fn command(&mut self, input: &str) -> Result<CommandResult> {
        let result = self.session.command(input)?;
        self.session.definition().validate_state(self.session.state())?;
        Ok(result)
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
            matches!(expected, 7 | 5) && snapshot.version == expected,
            "Unsupported snapshot"
        );
        self.session =
            Session::restore_with_definition(self.session.definition().clone(), snapshot.world)?;
        Ok(())
    }
}
