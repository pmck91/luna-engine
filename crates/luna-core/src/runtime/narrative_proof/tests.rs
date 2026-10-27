//! Shared Session regressions for the N1 candidate, promoted in N2–N4.
use super::*;
use crate::{CommandResult, Session};
use luna_model::*;
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Snapshot {
    world: GameState,
    #[serde(default)]
    narrative: Story,
}
struct Proof {
    session: Session,
    execution: Execution,
    original: Project,
}
impl Proof {
    fn new(original: Project, program: Program) -> Result<Self> {
        program.validate(&original)?;
        let session = Session::start(program.native_project(&original)?, None)?.0;
        Ok(Self {
            session,
            execution: Execution::new(Arc::new(program), Story::default()),
            original,
        })
    }
    fn attempt(&mut self, input: &str, explain: bool) -> (CommandResult, Option<anyhow::Error>) {
        let mut execution = self.execution.clone();
        let (mut result, error) = self.session.narrative_attempt(input, explain, |run| {
            run.narrative = Some(execution.clone());
            let result = run.command(input);
            execution = run.narrative.take().unwrap();
            result
        });
        if error.is_none() {
            result.state_changed |= execution.story != self.execution.story;
            self.execution = execution;
        }
        (result, error)
    }
    fn command(&mut self, input: &str) -> CommandResult {
        let (result, error) = self.attempt(input, true);
        assert!(error.is_none(), "{error:?}");
        result
    }
    fn select(&mut self, token: &str, reply: &str) -> CommandResult {
        let mut execution = self.execution.clone();
        let (mut result, error) = self
            .session
            .narrative_attempt("[selected reply]", true, |run| {
                run.narrative = Some(execution.clone());
                let result = run.narrative_select(token, reply);
                execution = run.narrative.take().unwrap();
                result
            });
        assert!(error.is_none(), "{error:?}");
        result.state_changed |= execution.story != self.execution.story;
        self.execution = execution;
        result
    }
    fn offer(&self) -> Offer {
        self.execution
            .offer
            .clone()
            .expect("expected active choices")
    }
    fn snapshot(&self) -> Snapshot {
        Snapshot {
            world: self.session.state().clone(),
            narrative: self.execution.story.clone(),
        }
    }
    fn restore(original: Project, program: Program, snapshot: Snapshot) -> Result<Self> {
        program.validate(&original)?;
        program.validate_story(&original, &snapshot.world, &snapshot.narrative)?;
        let session = Session::restore(program.native_project(&original)?, snapshot.world)?;
        let mut proof = Self {
            session,
            execution: Execution::new(Arc::new(program), snapshot.narrative),
            original,
        };
        // Reissue selection authority through a read-only view; no entry hooks.
        let mut run = Run::view(proof.session.definition(), proof.session.state());
        run.narrative = Some(proof.execution.clone());
        run.narrative_refresh()?;
        proof.execution.offer = run.narrative.take().unwrap().offer;
        Ok(proof)
    }
    fn value(&self, name: &str) -> i32 {
        match self.session.state().variables[name] {
            Value::Integer(value) => value,
            _ => panic!("integer variable"),
        }
    }
}
fn native(effect: Effect) -> Step {
    Step::Native { effect }
}
fn inc(name: &str) -> Step {
    native(Effect::UpdateVariable {
        name: name.into(),
        op: ArithmeticOperation::Add,
        operand: NumericOperand::Literal { value: 1 },
    })
}
fn say(text: &str) -> Step {
    native(Effect::Say { text: text.into() })
}
fn condition(condition: Condition) -> Gate {
    Gate::Native { condition }
}
fn status(status: QuestStatus) -> Gate {
    Gate::Quest {
        quest: "missing".into(),
        status,
    }
}
fn reply(id: &str, destination: Option<&str>, effects: Vec<Step>) -> Reply {
    Reply {
        id: id.into(),
        text: id.into(),
        condition: Gate::default(),
        once: false,
        destination: destination.map(str::to_owned),
        effects,
    }
}
fn call(id: &str) -> Step {
    native(Effect::Call {
        id: id.into(),
        procedure: "award".into(),
        arguments: BTreeMap::new(),
    })
}
fn response(id: &str) -> Step {
    native(Effect::Respond {
        id: id.into(),
        responses: vec!["One".into(), "Two".into()],
        mode: SequenceMode::Fallback,
        fallback: "Finished".into(),
        exhaustion: ExhaustionMode::Once,
        on_exhausted: vec![inc_native("exhausted")],
    })
}
fn inc_native(name: &str) -> Effect {
    if let Step::Native { effect } = inc(name) {
        effect
    } else {
        unreachable!()
    }
}
fn scene() -> (Project, Program) {
    let mut p = Project::blank("Narrative proof");
    p.locations[0].id = "study".into();
    p.locations[0].name = "Study".into();
    p.locations[0].actions.clear();
    p.game.starting_location = "study".into();
    p.locations.push(Location {
        id: "garden".into(),
        name: "Garden".into(),
        ..Default::default()
    });
    p.game.command_assistance = Some(CommandAssistance::new_game());
    p.game.variables = [
        "starts",
        "entries",
        "rewards",
        "coins",
        "found_hooks",
        "commands",
        "takes",
        "watches",
        "ending_events",
        "tail",
        "exhausted",
        "zero",
        "number",
    ]
    .into_iter()
    .map(|id| (id.into(), Value::Integer(0)))
    .collect();
    p.game
        .variables
        .insert("note".into(), Value::Text("<red> & %coins%".into()));
    p.characters = vec![Character {
        id: "keeper".into(),
        name: "Keeper <red> & %coins%".into(),
        name_colour: Some("cyan".into()),
        location: "study".into(),
        ..Default::default()
    }];
    for (id, name) in [("brass", "brass key"), ("iron", "iron key")] {
        p.objects.push(Object {
            id: id.into(),
            name: name.into(),
            aliases: vec!["key".into()],
            placement: Placement::Location {
                location: "study".into(),
            },
            portable: true,
            ..Default::default()
        });
        p.game.actions.push(Action {
            id: format!("take-{id}"),
            verb: "take".into(),
            pattern: vec![PatternPart::Entity { entity: id.into() }],
            effects: vec![Effect::Give { object: id.into() }],
            ..Default::default()
        });
        p.game.actions.push(Action {
            id: format!("examine-{id}"),
            verb: "examine".into(),
            pattern: vec![PatternPart::Entity { entity: id.into() }],
            effects: vec![Effect::Say { text: name.into() }],
            ..Default::default()
        });
    }
    for (id, verb, pattern) in [
        ("start-talk", "talk", "keeper"),
        ("use-test", "use", "test"),
        ("blocked", "use", "blocked"),
        ("risk", "use", "risk"),
        ("move-garden", "use", "garden"),
        ("return-room", "use", "study"),
    ] {
        p.game.actions.push(Action {
            id: id.into(),
            verb: verb.into(),
            pattern: vec![PatternPart::Literal {
                text: pattern.into(),
            }],
            requirements: if id == "blocked" {
                Condition::False
            } else {
                Condition::True
            },
            ..Default::default()
        });
    }
    p.game
        .actions
        .iter_mut()
        .find(|a| a.id == "move-garden")
        .unwrap()
        .effects = vec![Effect::Move {
        location: "garden".into(),
    }];
    p.game
        .actions
        .iter_mut()
        .find(|a| a.id == "return-room")
        .unwrap()
        .effects = vec![Effect::Move {
        location: "study".into(),
    }];
    p.game.triggers.push(Trigger {
        id: "command-hook".into(),
        event: Event::Command,
        effects: vec![inc_native("commands")],
        ..Default::default()
    });
    p.game.triggers.push(Trigger {
        id: "take-hook".into(),
        event: Event::Take,
        effects: vec![inc_native("takes")],
        ..Default::default()
    });
    p.game.triggers.push(Trigger {
        id: "coin-watch".into(),
        watch: Some(TriggerWatch {
            target: ValueTarget::Variable {
                name: "coins".into(),
            },
            mode: WatchMode::EachChange,
        }),
        effects: vec![inc_native("watches")],
        ..Default::default()
    });
    p.game.endings.push(Ending {
        id: "complete".into(),
        name: "Complete".into(),
        text: "Ended".into(),
        outcome: None,
    });
    p.game.triggers.push(Trigger {
        id: "end-hook".into(),
        event: Event::Ending,
        effects: vec![inc_native("ending_events")],
        ..Default::default()
    });
    p.procedures.push(Procedure {
        id: "award".into(),
        name: "Award coins".into(),
        description: String::new(),
        inputs: vec![],
        effects: vec![
            Effect::UpdateVariable {
                name: "coins".into(),
                op: ArithmeticOperation::Add,
                operand: NumericOperand::Literal { value: 10 },
            },
            inc_native("rewards"),
            if let Step::Native { effect } = response("award-sequence") {
                effect
            } else {
                unreachable!()
            },
        ],
    });
    let mut accept = reply(
        "accept",
        Some("progress"),
        vec![Step::StartQuest {
            quest: "missing".into(),
        }],
    );
    accept.once = true;
    let mut handover = reply(
        "handover",
        Some("thanks"),
        vec![
            native(Effect::GiveCharacter {
                object: "brass".into(),
                character: "keeper".into(),
            }),
            Step::RecordStage {
                quest: "missing".into(),
                stage: "returned".into(),
            },
            Step::CompleteQuest {
                quest: "missing".into(),
            },
        ],
    );
    handover.once = true;
    handover.condition = Gate::All {
        conditions: vec![
            status(QuestStatus::Active),
            condition(Condition::Carrying {
                object: "brass".into(),
            }),
        ],
    };
    let conversation = Conversation {
        id: "conversation".into(),
        character: "keeper".into(),
        available: Gate::default(),
        default_entry: "greeting".into(),
        entries: vec![
            Entry {
                condition: status(QuestStatus::Completed),
                node: "revisit".into(),
            },
            Entry {
                condition: status(QuestStatus::Active),
                node: "progress".into(),
            },
        ],
        nodes: vec![
            Node {
                id: "greeting".into(),
                text: "Will you find my key?".into(),
                terminal: false,
                effects: vec![inc("entries")],
                replies: vec![accept, reply("decline", None, vec![])],
            },
            Node {
                id: "progress".into(),
                text: "Have you found it?".into(),
                terminal: false,
                effects: vec![inc("entries")],
                replies: vec![
                    reply("ask", Some("clue"), vec![]),
                    handover,
                    reply("leave", None, vec![]),
                ],
            },
            Node {
                id: "clue".into(),
                text: "It is near the desk.".into(),
                terminal: false,
                effects: vec![inc("entries")],
                replies: vec![reply("back", Some("progress"), vec![])],
            },
            Node {
                id: "thanks".into(),
                text: "My key! Here are ten coins.".into(),
                terminal: false,
                effects: vec![inc("entries")],
                replies: vec![reply("goodbye", None, vec![])],
            },
            Node {
                id: "revisit".into(),
                text: "Thank you again for finding my key.".into(),
                terminal: true,
                effects: vec![inc("entries")],
                replies: vec![],
            },
        ],
    };
    let quest = Quest {
        id: "missing".into(),
        title: "The Missing Key".into(),
        aliases: vec!["key quest".into()],
        introduction: "The Keeper asked for help: %note%.".into(),
        completion: "The task is complete.".into(),
        failure: "The task failed.".into(),
        stages: vec![
            Stage {
                id: "found".into(),
                text: "Found it with %coins% coins.".into(),
                prerequisites: vec![],
                condition: condition(Condition::Carrying {
                    object: "brass".into(),
                }),
                required: true,
                effects: vec![inc("found_hooks")],
            },
            Stage {
                id: "returned".into(),
                text: "Returned the key.".into(),
                prerequisites: vec!["found".into()],
                condition: Gate::default(),
                required: true,
                effects: vec![],
            },
        ],
        on_start: Hook {
            id: "quest-start".into(),
            effects: vec![
                inc("starts"),
                Step::RecordStage {
                    quest: "missing".into(),
                    stage: "found".into(),
                },
            ],
        },
        on_complete: Hook {
            id: "quest-complete".into(),
            effects: vec![call("reward-call")],
        },
        on_fail: Hook {
            id: "quest-fail".into(),
            effects: vec![],
        },
    };
    let program = Program {
        enabled: true,
        conversations: vec![conversation],
        quests: vec![quest],
        flows: [
            (
                "start-talk".into(),
                vec![Step::Start {
                    conversation: "conversation".into(),
                }],
            ),
            (
                "take-brass".into(),
                vec![
                    native(Effect::Give {
                        object: "brass".into(),
                    }),
                    Step::RecordStage {
                        quest: "missing".into(),
                        stage: "found".into(),
                    },
                ],
            ),
        ]
        .into(),
        world_roots: [
            "start-talk",
            "take-brass",
            "take-iron",
            "examine-brass",
            "examine-iron",
            "use-test",
            "blocked",
            "risk",
            "move-garden",
            "return-room",
        ]
        .into_iter()
        .map(str::to_owned)
        .collect(),
        starters: ["start-talk".into()].into(),
    };
    (p, program)
}
fn proof() -> Proof {
    let (p, program) = scene();
    Proof::new(p, program).unwrap()
}
fn plain(result: &CommandResult) -> String {
    result
        .messages
        .iter()
        .map(|m| text::plain(m))
        .collect::<Vec<_>>()
        .join("\n")
}
#[test]
fn basic_current_node_and_terminal_return() {
    let mut p = proof();
    p.command("talk keeper");
    assert_eq!(
        p.offer()
            .choices
            .iter()
            .map(|r| r.id.as_str())
            .collect::<Vec<_>>(),
        ["accept", "decline"]
    );
    p.command("1");
    assert_eq!(p.value("starts"), 1);
    assert!(!p.offer().choices.iter().any(|r| r.id == "handover"));
    p.command("take brass key");
    assert!(p.execution.story.active.is_none());
    p.command("talk keeper");
    p.command("reply 2");
    assert_eq!(p.value("coins"), 10);
    assert_eq!(p.value("rewards"), 1);
    p.command("1");
    let result = p.command("talk keeper");
    assert!(plain(&result).contains("Thank you again"));
    assert!(!plain(&result).contains("ten coins"));
    assert!(p.execution.story.active.is_none());
    p.command("talk keeper");
    assert_eq!(p.value("coins"), 10);
}
fn node_mut<'a>(program: &'a mut Program, id: &str) -> &'a mut Node {
    program.conversations[0]
        .nodes
        .iter_mut()
        .find(|n| n.id == id)
        .unwrap()
}
fn reply_mut<'a>(program: &'a mut Program, id: &str) -> &'a mut Reply {
    program.conversations[0]
        .nodes
        .iter_mut()
        .flat_map(|n| &mut n.replies)
        .find(|r| r.id == id)
        .unwrap()
}
fn risk() -> Step {
    native(Effect::UpdateVariable {
        name: "coins".into(),
        op: ArithmeticOperation::Divide,
        operand: NumericOperand::Variable {
            name: "zero".into(),
        },
    })
}
fn complete(p: &mut Proof) {
    p.command("talk keeper");
    p.command("1");
    p.command("take brass key");
    p.command("talk keeper");
    p.command("2");
}
fn restore(p: &Proof) -> Proof {
    let encoded = serde_json::to_vec(&p.snapshot()).unwrap();
    Proof::restore(
        p.original.clone(),
        (*p.execution.program).clone(),
        serde_json::from_slice(&encoded).unwrap(),
    )
    .unwrap()
}
#[test]
fn future_ids_once_only_and_stale_choices_cannot_skip_the_graph() {
    let mut p = proof();
    p.command("talk keeper");
    let offer = p.offer();
    let before = p.snapshot();
    assert_eq!(
        p.select(&offer.token, "handover").status,
        CommandStatus::Unmatched
    );
    assert_eq!(p.snapshot(), before);
    p.select(&offer.token, "accept");
    let after = p.snapshot();
    assert_eq!(
        p.select(&offer.token, "accept").status,
        CommandStatus::Unmatched
    );
    assert_eq!(p.snapshot(), after);
    assert_eq!(p.value("starts"), 1);
    assert_eq!(
        p.command("use proof-only-handover").status,
        CommandStatus::RequirementsFailed
    );
    assert_eq!(p.snapshot(), after);
}
#[test]
fn invalid_numbers_and_dialogue_text_never_pick_a_reply() {
    let mut p = proof();
    p.command("talk keeper");
    let before = p.snapshot();
    let token = p.offer().token;
    for input in [
        "0",
        "999",
        "184467440737095516160",
        "reply",
        "reply yes",
        "reply -1",
        "reply +1",
        "reply 1.",
        "reply 1 2",
        "yes",
        "ask about key",
        "yesterday",
    ] {
        let result = p.command(input);
        assert_eq!(result.status, CommandStatus::Unmatched, "{input}");
        assert_eq!(p.snapshot(), before);
        assert_eq!(p.offer().token, token);
    }
}
#[test]
fn controls_and_inspection_preserve_story_offer_and_event_counts() {
    let mut p = proof();
    p.command("talk keeper");
    let before = p.snapshot();
    let token = p.offer().token;
    for input in [
        "look",
        "inventory",
        "help",
        "help Keeper",
        "quests",
        "quest secret",
        "save Checkpoint",
        "load Checkpoint",
        "saves",
        "quit",
        "",
    ] {
        let result = p.command(input);
        assert!(!result.state_changed, "{input}");
        assert_eq!(p.snapshot(), before, "{input}");
        assert_eq!(p.offer().token, token, "{input}");
    }
}
#[test]
fn noun_clarification_owns_numbers_and_rejected_explicit_replies_preserve_it() {
    let mut p = proof();
    p.command("talk keeper");
    let offer = p.offer();
    p.command("take key");
    let question = p.session.pending_clarification().unwrap();
    let before = p.snapshot();
    assert_eq!(p.command("reply 1").status, CommandStatus::Unmatched);
    assert_eq!(p.session.pending_clarification(), Some(question.clone()));
    assert_eq!(p.snapshot(), before);
    assert_eq!(
        p.select(&offer.token, "accept").status,
        CommandStatus::Unmatched
    );
    assert_eq!(p.session.pending_clarification(), Some(question));
    p.command("quests");
    assert!(p.session.pending_clarification().is_some());
    p.command("1");
    assert!(p.session.pending_clarification().is_none());
    assert!(p.execution.story.active.is_none());
    assert_eq!(p.value("starts"), 0);
    assert_eq!(p.value("takes"), 1);
}
#[test]
fn clarification_cancel_and_failed_requirements_preserve_the_encounter() {
    let mut p = proof();
    p.command("talk keeper");
    let before = p.snapshot();
    let token = p.offer().token;
    p.command("take key");
    p.command("cancel");
    assert!(p.session.pending_clarification().is_none());
    assert_eq!(p.snapshot(), before);
    assert_eq!(p.offer().token, token);
    assert_eq!(
        p.command("use blocked").status,
        CommandStatus::RequirementsFailed
    );
    assert_eq!(p.snapshot(), before);
    assert_eq!(p.offer().token, token);
}
#[test]
fn failed_world_command_restores_pending_question_encounter_and_output() {
    let (mut world, mut program) = scene();
    world
        .game
        .actions
        .iter_mut()
        .find(|a| a.id == "take-brass")
        .unwrap()
        .effects
        .clear();
    program.flows.insert(
        "take-brass".into(),
        vec![
            native(Effect::Give {
                object: "brass".into(),
            }),
            say("This is rolled back"),
            risk(),
        ],
    );
    let mut p = Proof::new(world, program).unwrap();
    p.command("talk keeper");
    p.command("take key");
    let before = p.snapshot();
    let question = p.session.pending_clarification();
    let (result, error) = p.attempt("brass", true);
    assert!(error.is_some());
    assert_eq!(result.status, CommandStatus::Error);
    assert!(result.messages.is_empty());
    assert_eq!(p.snapshot(), before);
    assert_eq!(p.session.pending_clarification(), question);
    assert!(!result.explanation.unwrap().discarded_messages.is_empty());
}
#[test]
fn stale_offer_after_new_conditional_list_does_not_rebind_the_old_number() {
    let (world, mut program) = scene();
    reply_mut(&mut program, "accept").condition = condition(Condition::Variable {
        name: "number".into(),
        op: Comparison::Eq,
        value: Value::Integer(0),
    });
    let mut p = Proof::new(world, program).unwrap();
    p.command("talk keeper");
    let old = p.offer();
    let mut state = p.session.state().clone();
    state.variables.insert("number".into(), Value::Integer(1));
    p.session.replace_state(state).unwrap();
    let before = p.snapshot();
    assert_eq!(
        p.select(&old.token, "accept").status,
        CommandStatus::Unmatched
    );
    assert_eq!(p.snapshot(), before);
    assert_eq!(
        p.offer()
            .choices
            .iter()
            .map(|r| r.id.as_str())
            .collect::<Vec<_>>(),
        ["decline"]
    );
    p.command("1");
    assert_eq!(p.value("starts"), 0);
    assert!(p.execution.story.active.is_none());
}
#[test]
fn resume_and_restore_do_not_replay_entered_nodes_or_accept_old_buttons() {
    let mut p = proof();
    p.command("talk keeper");
    p.command("1");
    let offer = p.offer();
    let before = p.snapshot();
    p.command("bye");
    p.command("talk keeper");
    assert_eq!(p.value("entries"), 2);
    assert_ne!(p.offer().token, offer.token);
    assert_eq!(p.snapshot().narrative, before.narrative);
    assert_eq!(p.value("starts"), 1);
    assert_eq!(p.value("commands"), 2); // Resuming uses an ordinary authored talk action.
    let before = p.snapshot();
    let mut resumed = restore(&p);
    assert_eq!(resumed.snapshot(), before);
    assert_eq!(resumed.value("entries"), 2);
    assert_eq!(
        resumed.select(&offer.token, "ask").status,
        CommandStatus::Unmatched
    );
    assert_eq!(resumed.snapshot(), before);
    assert_eq!(resumed.command("talk keeper").messages.len(), 0);
    assert_eq!(resumed.value("entries"), 2);
}
#[test]
fn interrupted_world_action_pauses_once_and_restore_keeps_recent_context_ephemeral() {
    let mut p = proof();
    p.command("talk keeper");
    p.command("1");
    p.command("examine brass key");
    assert!(p.execution.story.active.is_none());
    let entries = p.value("entries");
    assert_eq!(p.command("examine it").status, CommandStatus::Ok);
    let mut resumed = restore(&p);
    assert_eq!(
        resumed.command("examine it").status,
        CommandStatus::Unmatched
    );
    resumed.command("talk keeper");
    assert_eq!(resumed.value("entries"), entries);
}
#[test]
fn picking_up_the_key_before_accepting_does_not_infer_or_repeat_quest_progress() {
    let mut p = proof();
    p.command("take brass key");
    assert!(p.execution.story.quests.is_empty());
    p.command("talk keeper");
    p.command("1");
    assert_eq!(p.value("found_hooks"), 1);
    assert_eq!(p.execution.story.quests["missing"].stages.len(), 1);
    p.command("2");
    assert_eq!(p.value("rewards"), 1);
    assert_eq!(p.value("coins"), 10);
}
#[test]
fn journal_snapshots_keep_safe_semantic_text_after_values_change() {
    let mut p = proof();
    p.command("talk keeper");
    let prompt = p.offer().prompt;
    assert!(text::plain(&prompt).starts_with("Keeper <red> & %coins% says:"));
    assert!(
        prompt
            .iter()
            .any(|span| span.colour.as_deref() == Some("cyan"))
    );
    p.command("1");
    p.command("take brass key");
    let history = p.execution.story.quests["missing"].journal.clone();
    assert!(text::plain(&history[0].text).contains("<red> & %coins%"));
    let mut state = p.session.state().clone();
    state
        .variables
        .insert("note".into(), Value::Text("Different".into()));
    state.variables.insert("coins".into(), Value::Integer(99));
    p.session.replace_state(state).unwrap();
    let before = p.snapshot();
    let result = p.command("quest key quest");
    assert!(!result.state_changed);
    assert!(plain(&result).contains("Found it with 0 coins"));
    assert!(!plain(&result).contains("Different"));
    assert_eq!(p.snapshot(), before);
    assert_eq!(
        restore(&p).execution.story.quests["missing"].journal,
        history
    );
}
#[test]
fn once_only_marks_precede_reentrant_status_stage_and_reward_hooks() {
    let (world, mut program) = scene();
    program.quests[0].on_start.effects.push(Step::StartQuest {
        quest: "missing".into(),
    });
    program.quests[0].stages[0].effects.push(Step::RecordStage {
        quest: "missing".into(),
        stage: "found".into(),
    });
    program.quests[0]
        .on_complete
        .effects
        .push(Step::CompleteQuest {
            quest: "missing".into(),
        });
    let mut p = Proof::new(world, program).unwrap();
    complete(&mut p);
    assert_eq!(p.value("starts"), 1);
    assert_eq!(p.value("found_hooks"), 1);
    assert_eq!(p.value("rewards"), 1);
    assert_eq!(p.value("watches"), 1);
    assert_eq!(p.value("takes"), 1);
    assert_eq!(p.execution.story.quests["missing"].journal.len(), 4);
}
#[test]
fn incomplete_prerequisites_do_not_record_or_complete_and_do_not_abort_other_effects() {
    let (world, mut program) = scene();
    program.flows.insert(
        "use-test".into(),
        vec![
            Step::StartQuest {
                quest: "missing".into(),
            },
            Step::RecordStage {
                quest: "missing".into(),
                stage: "returned".into(),
            },
            Step::CompleteQuest {
                quest: "missing".into(),
            },
            inc("tail"),
        ],
    );
    let mut p = Proof::new(world, program).unwrap();
    let result = p.command("use test");
    assert_eq!(p.execution.status("missing"), QuestStatus::Active);
    assert!(p.execution.story.quests["missing"].stages.is_empty());
    assert_eq!(p.value("tail"), 1);
    assert_eq!(p.value("rewards"), 0);
    assert!(result.explanation.unwrap().steps.iter().any(
        |step| matches!(&step.kind, TraceKind::Notice { text } if text.contains("prerequisites"))
    ));
}
#[test]
fn optional_parallel_stages_and_terminal_failure_are_idempotent() {
    let (world, mut program) = scene();
    program.quests[0].stages.push(Stage {
        id: "optional".into(),
        text: "An optional discovery".into(),
        prerequisites: vec![],
        condition: Gate::default(),
        required: false,
        effects: vec![inc("tail")],
    });
    program.flows.insert(
        "use-test".into(),
        vec![
            Step::StartQuest {
                quest: "missing".into(),
            },
            Step::RecordStage {
                quest: "missing".into(),
                stage: "optional".into(),
            },
            Step::RecordStage {
                quest: "missing".into(),
                stage: "optional".into(),
            },
            Step::FailQuest {
                quest: "missing".into(),
            },
            Step::StartQuest {
                quest: "missing".into(),
            },
            Step::CompleteQuest {
                quest: "missing".into(),
            },
        ],
    );
    let mut p = Proof::new(world, program).unwrap();
    p.command("use test");
    let before = p.snapshot();
    assert_eq!(p.execution.status("missing"), QuestStatus::Failed);
    assert_eq!(p.value("tail"), 1);
    assert_eq!(p.value("starts"), 1);
    p.command("use test");
    assert_eq!(p.execution.story, before.narrative);
    assert_eq!(p.value("tail"), 1);
    assert_eq!(restore(&p).execution.status("missing"), QuestStatus::Failed);
}
#[test]
fn late_quest_hook_failure_rolls_back_world_quest_reply_cursors_and_messages() {
    let (world, mut program) = scene();
    program.quests[0]
        .on_complete
        .effects
        .extend([say("Discard this reward"), risk()]);
    let mut p = Proof::new(world, program).unwrap();
    p.command("talk keeper");
    p.command("1");
    p.command("take brass key");
    p.command("talk keeper");
    let before = p.snapshot();
    let offer = p.offer();
    let (result, error) = p.attempt("2", true);
    assert!(error.is_some());
    assert_eq!(p.snapshot(), before);
    assert_eq!(p.offer(), offer);
    assert!(result.messages.is_empty());
    let trace = result.explanation.unwrap();
    assert!(!trace.committed);
    assert!(
        trace
            .discarded_messages
            .iter()
            .any(|m| text::plain(m).contains("Discard this reward"))
    );
    assert!(
        trace
            .steps
            .iter()
            .any(|s| matches!(s.kind, TraceKind::Call { .. }))
    );
}
#[test]
fn native_watch_callback_runs_candidate_quest_hook_in_the_same_budget_and_transaction() {
    let (world, mut program) = scene();
    program.flows.insert(
        "coin-watch".into(),
        vec![
            inc("watches"),
            Step::CompleteQuest {
                quest: "missing".into(),
            },
        ],
    );
    let mut p = Proof::new(world, program).unwrap();
    complete(&mut p);
    assert_eq!(p.value("rewards"), 1);
    assert_eq!(p.value("watches"), 1);
    assert_eq!(p.execution.story.quests["missing"].journal.len(), 4);
}
#[test]
fn stop_returns_from_a_procedure_but_reply_stop_still_takes_its_transition() {
    let (mut world, mut program) = scene();
    world.procedures[0].effects = vec![Effect::Stop, inc_native("tail")];
    reply_mut(&mut program, "accept").effects = vec![
        call("stop-call"),
        inc("starts"),
        native(Effect::Stop),
        inc("tail"),
    ];
    let mut p = Proof::new(world, program).unwrap();
    p.command("talk keeper");
    p.command("1");
    assert_eq!(p.value("starts"), 1);
    assert_eq!(p.value("tail"), 0);
    assert_eq!(p.offer().node, "progress");
}
#[test]
fn end_and_pause_supersede_the_original_reply_transition() {
    for end in [false, true] {
        let (world, mut program) = scene();
        reply_mut(&mut program, "accept").effects = vec![
            if end {
                Step::End {
                    conversation: "conversation".into(),
                }
            } else {
                Step::Pause {
                    conversation: "conversation".into(),
                }
            },
            inc("tail"),
        ];
        let mut p = Proof::new(world, program).unwrap();
        p.command("talk keeper");
        p.command("1");
        assert!(p.execution.story.active.is_none());
        assert_eq!(p.value("tail"), 1);
        assert_eq!(p.value("entries"), 1);
        assert_eq!(
            p.execution.story.conversations["conversation"]
                .checkpoint
                .is_none(),
            end
        );
    }
}
#[test]
fn replacing_an_encounter_in_the_same_reply_does_not_take_the_old_transition() {
    let (world, mut program) = scene();
    reply_mut(&mut program, "accept").effects = vec![
        Step::End {
            conversation: "conversation".into(),
        },
        Step::Start {
            conversation: "conversation".into(),
        },
    ];
    let mut p = Proof::new(world, program).unwrap();
    p.command("talk keeper");
    p.command("1");
    assert_eq!(p.offer().node, "greeting");
    assert_eq!(p.value("entries"), 2);
    assert_eq!(
        p.offer()
            .choices
            .iter()
            .map(|c| c.id.as_str())
            .collect::<Vec<_>>(),
        ["decline"]
    );
}
#[test]
fn ending_propagates_through_reply_hook_and_procedure_and_keeps_journal_readable() {
    let (mut world, mut program) = scene();
    world.procedures[0].effects.extend([
        Effect::End {
            ending: "complete".into(),
        },
        inc_native("tail"),
    ]);
    program.quests[0].on_complete.effects.push(inc("tail"));
    let mut p = Proof::new(world, program).unwrap();
    complete(&mut p);
    assert_eq!(p.session.state().ending.as_deref(), Some("complete"));
    assert!(p.execution.story.active.is_none());
    assert!(
        p.execution
            .story
            .conversations
            .values()
            .all(|c| c.checkpoint.is_none())
    );
    assert_eq!(p.value("tail"), 0);
    assert_eq!(p.value("ending_events"), 1);
    let before = p.snapshot();
    let log = p.command("quest The Missing Key");
    assert!(!log.state_changed);
    assert!(plain(&log).contains("The task is complete"));
    assert_eq!(p.snapshot(), before);
    let mut restored = restore(&p);
    restored.command("quests");
    assert_eq!(restored.value("ending_events"), 1);
}
#[test]
fn speaker_removal_defers_destination_entry_until_a_valid_resume() {
    let (world, mut program) = scene();
    reply_mut(&mut program, "accept")
        .effects
        .push(native(Effect::Hide {
            entity: "keeper".into(),
        }));
    program.flows.insert(
        "use-test".into(),
        vec![native(Effect::Reveal {
            entity: "keeper".into(),
        })],
    );
    let mut p = Proof::new(world, program).unwrap();
    p.command("talk keeper");
    p.command("1");
    assert_eq!(p.value("entries"), 1);
    assert!(p.execution.story.active.is_none());
    assert!(
        matches!(&p.execution.story.conversations["conversation"].checkpoint, Some(Checkpoint::Pending { node }) if node == "progress")
    );
    let mut p = restore(&p);
    p.command("talk keeper");
    assert_eq!(p.value("entries"), 1);
    p.command("use test");
    p.command("talk keeper");
    assert_eq!(p.value("entries"), 2);
    assert_eq!(p.offer().node, "progress");
}
#[test]
fn node_entry_hiding_the_speaker_is_an_entered_checkpoint_without_replay() {
    let (world, mut program) = scene();
    node_mut(&mut program, "progress")
        .effects
        .push(native(Effect::Hide {
            entity: "keeper".into(),
        }));
    program.flows.insert(
        "use-test".into(),
        vec![native(Effect::Reveal {
            entity: "keeper".into(),
        })],
    );
    let mut p = Proof::new(world, program).unwrap();
    p.command("talk keeper");
    p.command("1");
    assert_eq!(p.value("entries"), 2);
    assert!(matches!(
        p.execution.story.conversations["conversation"].checkpoint,
        Some(Checkpoint::Entered { .. })
    ));
    let mut p = restore(&p);
    p.command("use test");
    p.command("talk keeper");
    assert_eq!(p.value("entries"), 2);
    assert_eq!(p.offer().node, "progress");
}
#[test]
fn ordinary_movement_pauses_and_reentry_keeps_the_entered_checkpoint() {
    let mut p = proof();
    p.command("talk keeper");
    p.command("use garden");
    assert!(p.execution.story.active.is_none());
    p.command("talk keeper");
    assert!(p.execution.offer.is_none());
    p.command("use study");
    p.command("talk keeper");
    assert_eq!(p.value("entries"), 1);
    assert_eq!(p.offer().node, "greeting");
}
#[test]
fn native_watch_reentry_into_active_procedure_errors_without_partial_narrative_progress() {
    let (world, mut program) = scene();
    program
        .flows
        .insert("coin-watch".into(), vec![call("recursive-award")]);
    let mut p = Proof::new(world, program).unwrap();
    p.command("talk keeper");
    p.command("1");
    p.command("take brass key");
    p.command("talk keeper");
    let before = p.snapshot();
    let (result, error) = p.attempt("2", true);
    assert!(error.is_some());
    assert_eq!(result.status, CommandStatus::Error);
    assert_eq!(p.snapshot(), before);
}
#[test]
fn native_and_narrative_work_share_the_operation_budget() {
    let (world, mut program) = scene();
    reply_mut(&mut program, "accept").effects = std::iter::once(Step::StartQuest {
        quest: "missing".into(),
    })
    .chain((0..2050).map(|_| inc("tail")))
    .collect();
    let mut p = Proof::new(world, program).unwrap();
    p.command("talk keeper");
    let before = p.snapshot();
    let (result, error) = p.attempt("1", true);
    assert!(error.unwrap().to_string().contains("operations"));
    assert_eq!(p.snapshot(), before);
    assert!(result.messages.is_empty());
    assert!(!result.explanation.unwrap().committed);
}
#[test]
fn nested_start_must_pause_or_end_the_existing_encounter() {
    let (world, mut program) = scene();
    let mut other = program.conversations[0].clone();
    other.id = "other-conversation".into();
    other.default_entry = "other-node".into();
    other.entries.clear();
    other.nodes = vec![Node {
        id: "other-node".into(),
        text: "Other".into(),
        terminal: true,
        effects: vec![],
        replies: vec![],
    }];
    program.conversations.push(other);
    reply_mut(&mut program, "accept").effects.push(Step::Start {
        conversation: "other-conversation".into(),
    });
    let mut p = Proof::new(world, program).unwrap();
    p.command("talk keeper");
    let before = p.snapshot();
    assert!(p.attempt("1", true).1.is_some());
    assert_eq!(p.snapshot(), before);
}
#[test]
fn lazy_narrative_sequences_reset_and_restore_without_advancing() {
    let (world, mut program) = scene();
    reply_mut(&mut program, "ask").effects = vec![response("reply-sequence")];
    let mut p = Proof::new(world, program).unwrap();
    assert!(p.execution.story.sequences.is_empty());
    p.command("talk keeper");
    p.command("1");
    p.command("1");
    assert_eq!(p.execution.story.sequences["reply-sequence"], 1);
    let mut p = restore(&p);
    assert_eq!(p.execution.story.sequences["reply-sequence"], 1);
    p.command("1");
    assert_eq!(
        plain(&p.command("1"))
            .lines()
            .filter(|s| *s == "Two")
            .count(),
        1
    );
    assert_eq!(p.execution.story.sequences["reply-sequence"], 2);
}
#[test]
fn local_sequence_reset_is_allowed_but_external_reset_is_rejected() {
    let (world, mut program) = scene();
    reply_mut(&mut program, "ask").effects = vec![
        response("local-sequence"),
        native(Effect::ResetResponses {
            sequence: "local-sequence".into(),
        }),
    ];
    let mut p = Proof::new(world.clone(), program.clone()).unwrap();
    p.command("talk keeper");
    p.command("1");
    p.command("1");
    assert_eq!(p.execution.story.sequences["local-sequence"], 0);
    program.flows.insert(
        "use-test".into(),
        vec![native(Effect::ResetResponses {
            sequence: "local-sequence".into(),
        })],
    );
    assert!(program.validate(&world).is_err());
}
#[test]
fn fallback_followups_run_once_and_nested_calls_keep_distinct_hook_roots() {
    let (world, mut program) = scene();
    reply_mut(&mut program, "ask").effects = vec![response("reply-sequence"), call("reply-award")];
    let mut p = Proof::new(world, program).unwrap();
    p.command("talk keeper");
    p.command("1");
    for _ in 0..4 {
        p.command("1");
        p.command("1");
    }
    assert_eq!(p.execution.story.sequences["reply-sequence"], 3);
    assert_eq!(p.value("exhausted"), 2); // One local fallback and one procedure-path fallback.
    let saved = p.snapshot();
    assert_eq!(restore(&p).snapshot(), saved);
}
#[test]
fn normal_and_explained_execution_have_identical_state_and_transcripts() {
    let (world, program) = scene();
    let mut normal = Proof::new(world.clone(), program.clone()).unwrap();
    let mut explained = Proof::new(world, program).unwrap();
    for input in [
        "talk keeper",
        "1",
        "take brass key",
        "talk keeper",
        "2",
        "1",
        "talk keeper",
        "quests",
    ] {
        let (a, error) = normal.attempt(input, false);
        assert!(error.is_none());
        let b = explained.command(input);
        assert_eq!(a.status, b.status);
        assert_eq!(a.messages, b.messages);
        assert_eq!(a.state_changed, b.state_changed);
        assert_eq!(normal.snapshot(), explained.snapshot());
        assert!(a.explanation.is_none());
        assert!(b.explanation.unwrap().committed);
    }
}
#[test]
fn history_gates_and_dead_end_nodes_do_not_expose_future_topics() {
    let (world, mut program) = scene();
    reply_mut(&mut program, "ask").condition = Gate::All {
        conditions: vec![
            Gate::Chosen {
                conversation: "conversation".into(),
                reply: "accept".into(),
            },
            Gate::Not {
                condition: Box::new(Gate::Visited {
                    conversation: "conversation".into(),
                    node: "clue".into(),
                }),
            },
        ],
    };
    reply_mut(&mut program, "leave").condition = Gate::Stage {
        quest: "missing".into(),
        stage: "found".into(),
    };
    let mut p = Proof::new(world, program).unwrap();
    p.command("talk keeper");
    p.command("1");
    assert_eq!(p.offer().choices.len(), 1);
    p.command("1");
    p.command("1");
    assert!(p.execution.story.active.is_none());
    assert_eq!(p.value("entries"), 4);
}
#[test]
fn invalid_graphs_prerequisites_and_cross_owner_references_are_rejected() {
    let (world, program) = scene();
    for mutate in [
        (|p: &mut Program| p.conversations[0].nodes[0].terminal = true) as fn(&mut Program),
        |p| p.quests[0].stages[0].prerequisites.push("returned".into()),
        |p| reply_mut(p, "accept").destination = Some("missing-node".into()),
        |p| {
            reply_mut(p, "accept").condition = Gate::Stage {
                quest: "missing".into(),
                stage: "other-stage".into(),
            }
        },
        |p| p.conversations[0].character = "brass".into(),
        |p| p.conversations[0].nodes[0].id = "greeting/../escape".into(),
    ] {
        let mut program = program.clone();
        mutate(&mut program);
        assert!(program.validate(&world).is_err());
    }
}
#[test]
fn candidate_snapshots_reject_unknown_ids_unsafe_spans_and_inconsistent_histories() {
    let mut p = proof();
    complete(&mut p);
    let snapshot = p.snapshot();
    let invalid: [fn(&mut Snapshot); 7] = [
        |s| {
            s.narrative
                .quests
                .get_mut("missing")
                .unwrap()
                .stages
                .remove("found");
        },
        |s| {
            s.narrative.quests.get_mut("missing").unwrap().journal[0].text[0].colour =
                Some("javascript".into());
        },
        |s| {
            s.narrative
                .quests
                .get_mut("missing")
                .unwrap()
                .journal
                .swap(0, 1);
        },
        |s| {
            s.narrative
                .conversations
                .get_mut("conversation")
                .unwrap()
                .chosen
                .insert("unknown".into());
        },
        |s| {
            s.narrative
                .conversations
                .get_mut("conversation")
                .unwrap()
                .visited
                .remove("greeting");
        },
        |s| {
            s.narrative.sequences.insert("unknown-sequence".into(), 1);
        },
        |s| {
            s.narrative.active = Some("unknown-conversation".into());
        },
    ];
    for mutate in invalid {
        let mut bad = snapshot.clone();
        mutate(&mut bad);
        assert!(Proof::restore(p.original.clone(), (*p.execution.program).clone(), bad).is_err());
    }
    assert_eq!(restore(&p).snapshot(), snapshot);
}
#[test]
fn snapshots_do_not_persist_selection_authority_and_missing_progress_defaults_empty() {
    let mut p = proof();
    p.command("talk keeper");
    let offer = p.offer();
    let encoded = serde_json::to_value(p.snapshot()).unwrap();
    assert!(!encoded.to_string().contains(&offer.token));
    let mut resumed = restore(&p);
    let before = resumed.snapshot();
    assert_ne!(resumed.offer().token, offer.token);
    assert_eq!(
        resumed.select(&offer.token, "accept").status,
        CommandStatus::Unmatched
    );
    assert_eq!(resumed.snapshot(), before);
    let fresh = proof();
    let mut legacy = serde_json::to_value(fresh.snapshot()).unwrap();
    legacy.as_object_mut().unwrap().remove("narrative");
    let snapshot: Snapshot = serde_json::from_value(legacy).unwrap();
    let loaded = Proof::restore(
        fresh.original.clone(),
        (*fresh.execution.program).clone(),
        snapshot,
    )
    .unwrap();
    assert_eq!(loaded.execution.story, Story::default());
    assert_eq!(loaded.value("starts"), 0);
}
#[test]
fn reserved_prefix_audit_preserves_legacy_commands_and_does_not_reserve_integers() {
    let (mut world, mut program) = scene();
    for (id, word) in [
        ("legacy-reply", "reply"),
        ("legacy-quest", "quest"),
        ("legacy-quests", "quests"),
        ("legacy-bye", "bye"),
        ("legacy-number", "1"),
    ] {
        world.vocabulary.push(Verb {
            id: id.into(),
            canonical: word.into(),
            ..Default::default()
        });
        world.game.actions.push(Action {
            id: format!("{id}-action"),
            verb: id.into(),
            effects: vec![inc_native("tail")],
            ..Default::default()
        });
    }
    let conflicts = program.conflicts(&world);
    assert_eq!(conflicts.len(), 7);
    assert!(!conflicts.iter().any(|id| id.contains("number")));
    assert!(program.validate(&world).is_err());
    program.enabled = false;
    let mut p = Proof::new(world, program).unwrap();
    for input in ["reply", "quest", "quests", "bye", "1"] {
        assert_eq!(p.command(input).status, CommandStatus::Ok);
    }
    assert_eq!(p.value("tail"), 5);
}
#[test]
fn recursive_entry_hooks_share_the_native_depth_limit_and_roll_back() {
    let (world, mut program) = scene();
    node_mut(&mut program, "greeting").effects = vec![
        inc("entries"),
        Step::End {
            conversation: "conversation".into(),
        },
        Step::Start {
            conversation: "conversation".into(),
        },
    ];
    let mut p = Proof::new(world, program).unwrap();
    let before = p.snapshot();
    let (result, error) = p.attempt("talk keeper", true);
    assert!(error.unwrap().to_string().contains("64"));
    assert_eq!(p.snapshot(), before);
    assert!(result.messages.is_empty());
}
#[test]
fn failed_load_is_atomic_and_equal_state_restore_invalidates_both_prompts() {
    let mut p = proof();
    p.command("talk keeper");
    let offer = p.offer();
    p.command("take key");
    let question = p.session.pending_clarification();
    let before = p.snapshot();
    let mut bad = before.clone();
    bad.narrative
        .conversations
        .get_mut("conversation")
        .unwrap()
        .visited
        .insert("deleted-node".into());
    assert!(Proof::restore(p.original.clone(), (*p.execution.program).clone(), bad).is_err());
    assert_eq!(p.snapshot(), before);
    assert_eq!(p.session.pending_clarification(), question);
    assert_eq!(p.offer().token, offer.token);
    let mut p = restore(&p);
    assert!(p.session.pending_clarification().is_none());
    assert_ne!(p.offer().token, offer.token);
    assert_eq!(p.snapshot(), before);
    assert_eq!(
        p.select(&offer.token, "accept").status,
        CommandStatus::Unmatched
    );
    assert_eq!(p.snapshot(), before);
}
#[test]
fn hint_progress_refreshes_choices_without_replaying_node_entry() {
    let (mut world, mut program) = scene();
    world.locations[0].hints.push(HintSet {
        id: "study-hint".into(),
        name: "Study clue".into(),
        stages: vec![HintStage {
            id: "study-hint-stage".into(),
            clues: vec!["Try near the desk.".into()],
            ..Default::default()
        }],
        ..Default::default()
    });
    reply_mut(&mut program, "accept").condition = condition(Condition::Not {
        condition: Box::new(Condition::HintUsed {
            hint: "study-hint".into(),
        }),
    });
    let mut p = Proof::new(world, program).unwrap();
    p.command("talk keeper");
    let offer = p.offer();
    let commands = p.value("commands");
    p.command("hint Study");
    assert_eq!(p.value("entries"), 1);
    assert_eq!(p.value("commands"), commands);
    assert_eq!(
        p.offer()
            .choices
            .iter()
            .map(|r| r.id.as_str())
            .collect::<Vec<_>>(),
        ["decline"]
    );
    let before = p.snapshot();
    assert_eq!(
        p.select(&offer.token, "accept").status,
        CommandStatus::Unmatched
    );
    assert_eq!(p.snapshot(), before);
}
#[test]
fn numeric_world_commands_work_outside_an_encounter_and_cannot_steal_its_prompt() {
    let (mut world, program) = scene();
    world.vocabulary.push(Verb {
        id: "number-verb".into(),
        canonical: "1".into(),
        ..Default::default()
    });
    world.game.actions.push(Action {
        id: "number-action".into(),
        verb: "number-verb".into(),
        effects: vec![inc_native("tail")],
        ..Default::default()
    });
    let mut p = Proof::new(world, program).unwrap();
    p.command("1");
    assert_eq!(p.value("tail"), 1);
    p.command("talk keeper");
    p.command("1");
    assert_eq!(p.value("starts"), 1);
    assert_eq!(p.value("tail"), 1);
}
#[test]
fn nested_quest_hooks_share_depth_limits_without_persisting_partial_history() {
    let (world, mut program) = scene();
    for i in 0..70 {
        let mut q = program.quests[0].clone();
        q.id = format!("chain{i}");
        q.title = q.id.clone();
        q.aliases.clear();
        q.stages.clear();
        q.on_start = Hook {
            id: format!("chain{i}-start"),
            effects: if i < 69 {
                vec![Step::StartQuest {
                    quest: format!("chain{}", i + 1),
                }]
            } else {
                vec![inc("tail")]
            },
        };
        q.on_complete = Hook {
            id: format!("chain{i}-complete"),
            effects: vec![],
        };
        q.on_fail = Hook {
            id: format!("chain{i}-fail"),
            effects: vec![],
        };
        program.quests.push(q);
    }
    reply_mut(&mut program, "accept").effects = vec![Step::StartQuest {
        quest: "chain0".into(),
    }];
    let mut p = Proof::new(world, program).unwrap();
    p.command("talk keeper");
    let before = p.snapshot();
    assert!(p.attempt("1", true).1.unwrap().to_string().contains("64"));
    assert_eq!(p.snapshot(), before);
}
#[test]
fn author_and_snapshot_resource_limits_are_explicit() {
    let (world, mut program) = scene();
    node_mut(&mut program, "greeting").replies = (0..257)
        .map(|i| reply(&format!("option-{i}"), None, vec![]))
        .collect();
    assert!(
        program
            .validate(&world)
            .unwrap_err()
            .to_string()
            .contains("Too many replies")
    );
    let p = proof();
    let mut too_many = p.snapshot();
    too_many.narrative.sequences = (0..=PROGRESS_LIMIT)
        .map(|i| (format!("sequence-{i}"), 0))
        .collect();
    assert!(
        p.execution
            .program
            .validate_story(&p.original, &too_many.world, &too_many.narrative)
            .unwrap_err()
            .to_string()
            .contains("resource bounds")
    );
    let mut p = proof();
    p.command("talk keeper");
    let mut too_large = p.snapshot();
    if let Some(Checkpoint::Entered { prompt, .. }) = &mut too_large
        .narrative
        .conversations
        .get_mut("conversation")
        .unwrap()
        .checkpoint
    {
        prompt[0].text = "x".repeat(JOURNAL_BYTES + 1);
    }
    assert!(
        p.execution
            .program
            .validate_story(&p.original, &too_large.world, &too_large.narrative)
            .is_err()
    );
}

#[test]
fn repeating_fallback_followups_keep_restorable_cursor_bounds() {
    let (world, mut program) = scene();
    let mut repeated = response("repeating-response");
    if let Step::Native {
        effect: Effect::Respond { exhaustion, .. },
    } = &mut repeated
    {
        *exhaustion = ExhaustionMode::Repeat;
    }
    reply_mut(&mut program, "ask").effects = vec![repeated];
    let mut p = Proof::new(world, program).unwrap();
    p.command("talk keeper");
    p.command("1");
    for _ in 0..4 {
        p.command("1");
        p.command("1");
    }
    assert_eq!(p.execution.story.sequences["repeating-response"], 3);
    assert_eq!(p.value("exhausted"), 2);
    let mut p = restore(&p);
    p.command("1");
    assert_eq!(p.value("exhausted"), 3);
}
#[test]
fn parallel_required_stages_complete_in_either_order_without_optional_work() {
    for order in [["found", "returned"], ["returned", "found"]] {
        let (world, mut program) = scene();
        let q = &mut program.quests[0];
        q.on_start.effects = vec![inc("starts")];
        q.stages[1].prerequisites.clear();
        q.stages
            .iter_mut()
            .for_each(|s| s.condition = Gate::default());
        q.stages.push(Stage {
            id: "optional".into(),
            text: "Optional".into(),
            prerequisites: vec![],
            condition: Gate::default(),
            required: false,
            effects: vec![],
        });
        program.flows.insert(
            "use-test".into(),
            vec![
                Step::StartQuest {
                    quest: "missing".into(),
                },
                Step::RecordStage {
                    quest: "missing".into(),
                    stage: order[0].into(),
                },
                Step::CompleteQuest {
                    quest: "missing".into(),
                },
            ],
        );
        program.flows.insert(
            "take-brass".into(),
            vec![Step::RecordStage {
                quest: "missing".into(),
                stage: order[1].into(),
            }],
        );
        program.flows.insert(
            "start-talk".into(),
            vec![Step::CompleteQuest {
                quest: "missing".into(),
            }],
        );
        let mut p = Proof::new(world, program).unwrap();
        p.command("use test");
        assert_eq!(p.execution.status("missing"), QuestStatus::Active);
        p.command("take brass key");
        assert_eq!(p.execution.status("missing"), QuestStatus::Active);
        assert_eq!(p.value("rewards"), 0);
        p.command("talk keeper");
        assert_eq!(p.execution.status("missing"), QuestStatus::Completed);
        assert_eq!(p.value("rewards"), 1);
        assert!(
            !p.execution.story.quests["missing"]
                .stages
                .contains("optional")
        );
        assert_eq!(restore(&p).snapshot(), p.snapshot());
    }
}
#[test]
fn unused_reserved_aliases_are_audited_and_reserved_queries_never_run_world_actions() {
    let (mut world, program) = scene();
    world.vocabulary.push(Verb {
        id: "unused-alias".into(),
        canonical: "gossip".into(),
        synonyms: vec!["reply to".into()],
        ..Default::default()
    });
    assert_eq!(program.conflicts(&world), ["unused-alias"]);
    assert!(program.validate(&world).is_err());
    world.vocabulary.pop();
    world.vocabulary.push(Verb {
        id: "longer-goodbye".into(),
        canonical: "bye later".into(),
        ..Default::default()
    });
    world.game.actions.push(Action {
        id: "longer-goodbye-action".into(),
        verb: "longer-goodbye".into(),
        ..Default::default()
    });
    assert!(program.conflicts(&world).is_empty());
    let mut p = Proof::new(world, program).unwrap();
    p.command("talk keeper");
    let before = p.snapshot();
    let token = p.offer().token;
    for query in [
        "quests keeper",
        "quest undiscovered name",
        "reply not-a-number",
    ] {
        assert_eq!(p.command(query).status, CommandStatus::Unmatched);
        assert_eq!(p.snapshot(), before);
        assert_eq!(p.offer().token, token);
    }
}

#[test]
fn pausing_inside_entry_preserves_completed_effects_without_reentry() {
    for immediate_resume in [false, true] {
        let (world, mut program) = scene();
        node_mut(&mut program, "greeting")
            .effects
            .push(Step::Pause {
                conversation: "conversation".into(),
            });
        if immediate_resume {
            node_mut(&mut program, "greeting")
                .effects
                .push(Step::Start {
                    conversation: "conversation".into(),
                });
        }
        let mut p = Proof::new(world, program).unwrap();
        p.command("talk keeper");
        assert_eq!(p.value("entries"), 1);
        assert_eq!(p.execution.story.active.is_some(), immediate_resume);
        assert!(
            matches!(&p.execution.story.conversations["conversation"].checkpoint,
            Some(Checkpoint::Entered { prompt, .. }) if !prompt.is_empty())
        );
        let mut p = restore(&p);
        p.command("talk keeper");
        assert_eq!(p.offer().node, "greeting");
        assert_eq!(p.value("entries"), 1);
    }
}
#[test]
fn terminal_entry_can_hide_its_speaker_without_leaving_an_unrestorable_checkpoint() {
    let (world, mut program) = scene();
    node_mut(&mut program, "revisit")
        .effects
        .push(native(Effect::Hide {
            entity: "keeper".into(),
        }));
    let mut p = Proof::new(world, program).unwrap();
    complete(&mut p);
    p.command("1");
    let result = p.command("talk keeper");
    assert!(plain(&result).contains("Thank you again"));
    assert!(p.execution.story.active.is_none());
    assert!(
        p.execution.story.conversations["conversation"]
            .checkpoint
            .is_none()
    );
    assert_eq!(restore(&p).snapshot(), p.snapshot());
    assert_eq!(p.value("rewards"), 1);
}
