//! Source for deliberately generating the separate CR4 acceptance project.
//! Normal acceptance tests load the retained project, never regenerate it.
use luna_model::*;

fn say(text: &str) -> Effect {
    Effect::Say { text: text.into() }
}
fn inc(name: &str) -> Effect {
    Effect::UpdateVariable {
        name: name.into(),
        op: ArithmeticOperation::Add,
        operand: NumericOperand::Literal { value: 1 },
    }
}
fn set(name: &str, value: Value) -> Effect {
    Effect::SetVariable {
        name: name.into(),
        value,
    }
}
fn start(routine: &str) -> Effect {
    Effect::StartRoutine {
        routine: routine.into(),
        busy: RoutineBusyPolicy::Replace,
    }
}
fn movement(character: &str, location: &str) -> Effect {
    Effect::MoveCharacter {
        character: character.into(),
        location: location.into(),
    }
}
fn free() -> Option<ActionTurnCost> {
    Some(ActionTurnCost {
        success: TurnCost::Free,
        ..Default::default()
    })
}
fn command(id: &str, name: &str, effects: Vec<Effect>) -> Action {
    Action {
        id: format!("control-{id}"),
        name: name.into(),
        verb: "use".into(),
        pattern: vec![PatternPart::Literal { text: id.into() }],
        turn_cost: free(),
        effects,
        ..Default::default()
    }
}
fn step(id: &str, name: &str, effects: Vec<Effect>) -> RoutineStep {
    RoutineStep {
        id: id.into(),
        name: name.into(),
        condition: Condition::True,
        blocked: RoutineBlocked::Retry,
        wait: None,
        effects,
    }
}
fn definition(
    id: &str,
    name: &str,
    character: &str,
    order: u32,
    steps: Vec<RoutineStep>,
) -> CharacterRoutine {
    CharacterRoutine {
        id: id.into(),
        name: name.into(),
        character: character.into(),
        order,
        start: RoutineStart::Blocks,
        repeat: RoutineRepeat::Finish,
        hold_conversation: true,
        steps,
    }
}
fn route(id: &str, destination: &str) -> Exit {
    Exit {
        id: id.into(),
        name: format!("Visit {destination} without advancing time"),
        verb: "go".into(),
        pattern: vec![PatternPart::Literal {
            text: destination.into(),
        }],
        destination: destination.into(),
        text: format!("You enter the {destination}."),
        turn_cost: free(),
        ..Default::default()
    }
}
fn visible_speech(text: &str) -> Effect {
    Effect::If {
        condition: Condition::Visible {
            entity: "keeper".into(),
        },
        then: vec![Effect::CharacterSays {
            character: "keeper".into(),
            text: text.into(),
        }],
        otherwise: vec![],
    }
}

pub fn project() -> Project {
    let mut p = Project::blank("The Routine Workshop");
    p.game.id = "routine-workshop".into();
    p.game.author = "Luna Engine".into();
    p.game.description = "A simple patrol first; optional routine experiments in the lab.".into();
    p.game.starting_location = "study".into();
    p.game.turns = Some(TurnPolicy::default());
    p.game.require_ending = true;
    p.game.opening_text = "Keeper is ready for a short patrol. WAIT moves him to the Garden. GO GARDEN follows without spending a turn; WAIT twice, then once more to hear him, then once to see him return. The routine lab is optional: GO LAB, then HELP ROUTINE LAB.".into();
    p.game.help_text = "Start with WAIT, GO GARDEN, WAIT, WAIT, WAIT, WAIT. LOOK, HELP and the room exits are free. For optional controls and experiments: GO LAB, HELP ROUTINE LAB. Restart the playtest or restore a named setup for each independent experiment.".into();
    p.game.variables = [
        ("award_ready", Value::Bool(false)),
        ("gate_enabled", Value::Bool(true)),
        ("rest_delay", Value::Integer(3)),
        ("divisor", Value::Integer(0)),
        ("signals", Value::Integer(0)),
        ("bells", Value::Integer(0)),
        ("rewards", Value::Integer(0)),
        ("attempts", Value::Integer(0)),
        ("ending_hooks", Value::Integer(0)),
    ]
    .into_iter()
    .map(|(k, v)| (k.into(), v))
    .collect();
    p.game.endings = vec![Ending {
        id: "complete".into(),
        name: "Workshop complete".into(),
        text: "The routine workshop is complete.".into(),
        outcome: None,
    }];
    p.game.triggers = vec![Trigger {
        id: "ending-hook".into(),
        name: "Record completion without reviving work".into(),
        event: Event::Ending,
        effects: vec![
            inc("ending_hooks"),
            start("after-ending"),
            say("The ending hook ran once."),
        ],
        ..Default::default()
    }];
    p.locations = vec![
        Location { id: "study".into(), name: "Study".into(), description: "Keeper begins here. Follow his short patrol with WAIT and GO GARDEN. GO LAB opens the optional experiments.".into(), exits: vec![route("study-garden", "garden"),route("study-lab", "lab")], ..Default::default() },
        Location { id: "garden".into(), name: "Garden".into(), description: "A quiet place to watch Keeper wait and speak. GO STUDY returns without advancing time.".into(), exits: vec![route("garden-study", "study")], ..Default::default() },
        Location { id: "lab".into(), name: "Routine lab".into(), description: "Optional experiments: USE PAUSE, USE RESUME, USE STOP, USE RESTART, USE GATE, USE ENDGATE, USE NIGHT, USE PAIR, USE READY, USE UNREADY, USE AWARD, USE FAILING, USE STEP, USE REPAIR, USE FINISH. OPEN GATE and CLOSE GATE are free. Each experiment starts fresh or from a captured setup.".into(), exits: vec![route("lab-study", "study")], ..Default::default() },
        Location { id: "offstage".into(), name: "Offstage storage".into(), description: "An intentionally disconnected place to store Keeper and his badge. Only direct character movement uses this room.".into(), ..Default::default() },
    ];
    p.characters = vec![
        Character {
            id: "keeper".into(),
            name: "Keeper".into(),
            location: "study".into(),
            description:
                "He follows a short patrol, pauses to talk and carries his badge with him.".into(),
            actions: vec![Action {
                id: "talk-keeper".into(),
                name: "Talk without advancing the speaker's routine".into(),
                verb: "talk".into(),
                pattern: vec![PatternPart::Entity {
                    entity: "keeper".into(),
                }],
                effects: vec![Effect::StartConversation {
                    conversation: "patrol-talk".into(),
                }],
                ..Default::default()
            }],
            ..Default::default()
        },
        Character {
            id: "steward".into(),
            name: "Steward".into(),
            location: "lab".into(),
            description:
                "She helps demonstrate ordering, once-only rewards and transaction rollback.".into(),
            ..Default::default()
        },
    ];
    p.objects = vec![
        Object { id: "gate".into(), name: "Patrol gate".into(), aliases: vec!["gate".into()], description: "The optional gated routine requires this to be open. The demonstration gate does not restrict the player's exits.".into(), placement: Placement::Location { location: "lab".into() }, open: true, actions: vec![
            Action { id: "open-gate".into(), name: "Allow Keeper's gated step".into(), verb: "open".into(), pattern: vec![PatternPart::Entity { entity: "gate".into() }], turn_cost: free(), effects: vec![Effect::Open { object: "gate".into() },say("The patrol gate is open.")], ..Default::default() },
            Action { id: "close-gate".into(), name: "Block Keeper's gated step".into(), verb: "close".into(), pattern: vec![PatternPart::Entity { entity: "gate".into() }], turn_cost: free(), effects: vec![Effect::Close { object: "gate".into() },say("The patrol gate is closed.")], ..Default::default() },
        ], ..Default::default() },
        Object { id: "badge".into(), name: "Keeper's badge".into(), description: "A carried item that follows Keeper, including into offstage storage.".into(), placement: Placement::Character { character: "keeper".into() }, ..Default::default() },
    ];
    // The introductory patrol has only four pacing containers.
    let mut wait = step("patrol-wait", "Wait two turns", vec![]);
    wait.wait = Some(NumericOperand::Literal { value: 2 });
    let mut patrol = definition(
        "evening-patrol",
        "Evening patrol",
        "keeper",
        0,
        vec![
            step(
                "patrol-garden",
                "Move to Garden",
                vec![movement("keeper", "garden")],
            ),
            wait,
            step(
                "patrol-say",
                "Speak if visible",
                vec![visible_speech("The garden is quiet.")],
            ),
            step(
                "patrol-study",
                "Return to Study",
                vec![movement("keeper", "study")],
            ),
        ],
    );
    patrol.start = RoutineStart::Initial;
    let mut gate_step = step(
        "gate-garden",
        "Retry until the gate opens",
        vec![movement("keeper", "garden")],
    );
    gate_step.condition = Condition::Opened {
        object: "gate".into(),
    };
    let mut gated = definition(
        "gate-patrol",
        "Patrol through the open gate",
        "keeper",
        1,
        vec![
            gate_step,
            step(
                "gate-return",
                "Return and check whether to repeat",
                vec![movement("keeper", "study")],
            ),
        ],
    );
    gated.repeat = RoutineRepeat::While {
        condition: Condition::Variable {
            name: "gate_enabled".into(),
            op: Comparison::Eq,
            value: Value::Bool(true),
        },
    };
    let mut rest = step("night-wait", "Capture the rest duration once", vec![]);
    rest.wait = Some(NumericOperand::Variable {
        name: "rest_delay".into(),
    });
    let night = definition(
        "night-rest",
        "Rest in offstage storage",
        "keeper",
        2,
        vec![
            step(
                "night-move",
                "Move offstage with the badge",
                vec![movement("keeper", "offstage")],
            ),
            rest,
            step(
                "night-say",
                "No offstage speech",
                vec![visible_speech(
                    "You should only hear this if Keeper is visible.",
                )],
            ),
        ],
    );
    let reward_effects = vec![
        Effect::StartQuest {
            quest: "workshop-task".into(),
        },
        Effect::CompleteQuestStage {
            quest: "workshop-task".into(),
            stage: "signal-heard".into(),
        },
        Effect::CompleteQuest {
            quest: "workshop-task".into(),
        },
    ];
    let mut once = definition(
        "conditional-award",
        "Once when the signal is ready",
        "steward",
        3,
        vec![step(
            "award-step",
            "Record a quest reward once",
            vec![
                Effect::Respond {
                    id: "award-response".into(),
                    responses: vec!["First reward signal.".into()],
                    mode: SequenceMode::Fallback,
                    fallback: "The reward was already recorded.".into(),
                    exhaustion: ExhaustionMode::Once,
                    on_exhausted: vec![],
                },
                Effect::Call {
                    id: "award-step-call".into(),
                    procedure: "record-signal".into(),
                    arguments: Default::default(),
                },
            ],
        )],
    );
    once.start = RoutineStart::When {
        condition: Condition::Variable {
            name: "award_ready".into(),
            op: Comparison::Eq,
            value: Value::Bool(true),
        },
    };
    p.procedures = vec![
        Procedure {
            id: "record-signal".into(),
            name: "Record the signal".into(),
            description:
                "The quest completion hook awards once, even if this procedure is called again."
                    .into(),
            inputs: vec![],
            effects: reward_effects,
        },
        Procedure {
            id: "late-work".into(),
            name: "Do work before a deliberate late failure".into(),
            description: "All effects roll back if the caller later fails.".into(),
            inputs: vec![],
            effects: vec![
                Effect::Call {
                    id: "late-record-call".into(),
                    procedure: "record-signal".into(),
                    arguments: Default::default(),
                },
                say("Discard this routine output on failure."),
            ],
        },
    ];
    p.routines = vec![
        patrol,
        gated,
        night,
        once,
        definition(
            "z-first",
            "First author-ordered signal",
            "keeper",
            10,
            vec![step(
                "first-signal",
                "First character",
                vec![
                    movement("keeper", "lab"),
                    inc("signals"),
                    say("First signal."),
                ],
            )],
        ),
        definition(
            "a-second",
            "Second author-ordered signal",
            "steward",
            11,
            vec![step(
                "second-signal",
                "Second character",
                vec![inc("signals"), say("Second signal.")],
            )],
        ),
        definition(
            "failing",
            "Rollback after earlier work",
            "steward",
            20,
            vec![step(
                "failing-step",
                "Move, reward, respond, then divide",
                vec![
                    movement("steward", "garden"),
                    Effect::Call {
                        id: "failing-call".into(),
                        procedure: "late-work".into(),
                        arguments: Default::default(),
                    },
                    Effect::Respond {
                        id: "failed-response".into(),
                        responses: vec![
                            "First routine reply.".into(),
                            "Later routine reply.".into(),
                        ],
                        mode: SequenceMode::Loop,
                        fallback: "".into(),
                        exhaustion: ExhaustionMode::Once,
                        on_exhausted: vec![],
                    },
                    Effect::UpdateVariable {
                        name: "attempts".into(),
                        op: ArithmeticOperation::Divide,
                        operand: NumericOperand::Variable {
                            name: "divisor".into(),
                        },
                    },
                ],
            )],
        ),
        definition(
            "ending",
            "End before later routine work",
            "keeper",
            30,
            vec![step(
                "ending-step",
                "Complete the workshop",
                vec![
                    Effect::End {
                        ending: "complete".into(),
                    },
                    say("Unreachable after the ending."),
                ],
            )],
        ),
        definition(
            "after-ending",
            "Suppressed after ending",
            "steward",
            31,
            vec![step(
                "suppressed-step",
                "This must never fire during completion",
                vec![say("A later routine should not run.")],
            )],
        ),
        definition(
            "unused",
            "An unused routine is still exported",
            "steward",
            40,
            vec![step("unused-step", "Reserved for later authoring", vec![])],
        ),
    ];
    p.timers = vec![ScheduledTrigger {
        id: "audit-bell".into(),
        name: "Timer before routine work".into(),
        order: 0,
        priority: 0,
        condition: Condition::True,
        effects: vec![inc("bells"), say("A timer sounded before the routines.")],
    }];
    let schedule = |after| Effect::ScheduleTimer {
        timer: "audit-bell".into(),
        after: NumericOperand::Literal { value: after },
        pending: TimerPendingPolicy::Restart,
    };
    p.game.actions = vec![
        command(
            "pause",
            "Pause Keeper's current patrol",
            vec![Effect::PauseRoutine {
                routine: "evening-patrol".into(),
            }],
        ),
        command(
            "resume",
            "Resume the same captured patrol",
            vec![Effect::ResumeRoutine {
                routine: "evening-patrol".into(),
            }],
        ),
        command(
            "stop",
            "Stop the patrol and discard its cursor",
            vec![Effect::StopRoutine {
                routine: "evening-patrol".into(),
            }],
        ),
        command(
            "restart",
            "Restart the introductory patrol",
            vec![start("evening-patrol")],
        ),
        command(
            "gate",
            "Try a guarded repeating patrol",
            vec![
                Effect::Close {
                    object: "gate".into(),
                },
                set("gate_enabled", Value::Bool(true)),
                start("gate-patrol"),
            ],
        ),
        command(
            "endgate",
            "Finish after this gated cycle",
            vec![set("gate_enabled", Value::Bool(false))],
        ),
        command(
            "night",
            "Replace Keeper's patrol with offstage rest",
            vec![start("night-rest")],
        ),
        command(
            "pair",
            "Start in reverse order; execute in author order",
            vec![start("a-second"), start("z-first")],
        ),
        command(
            "ready",
            "Make the once-only start condition true",
            vec![set("award_ready", Value::Bool(true))],
        ),
        command(
            "unready",
            "Make the start condition false",
            vec![set("award_ready", Value::Bool(false))],
        ),
        command(
            "award",
            "Explicitly restart without resetting reward history",
            vec![start("conditional-award")],
        ),
        command(
            "failing",
            "Arm a timer and two routines for a failed transaction",
            vec![start("z-first"), start("failing"), schedule(1)],
        ),
        command(
            "repair",
            "Repair without advancing the pending attempt",
            vec![set("divisor", Value::Integer(1))],
        ),
        command(
            "finish",
            "End before pending timer and later routine work",
            vec![start("after-ending"), start("ending"), schedule(2)],
        ),
    ];
    let mut charged = command("step", "Attempt one charged input", vec![inc("attempts")]);
    charged.turn_cost = None;
    p.game.actions.push(charged);
    p.quests = vec![Quest {
        id: "workshop-task".into(),
        title: "Record one signal".into(),
        aliases: vec!["signal".into()],
        introduction: "A signal was requested.".into(),
        completion: "The signal was recorded; the reward is only earned once.".into(),
        stages: vec![QuestStage {
            id: "signal-heard".into(),
            name: "Record the signal".into(),
            text: "The routine recorded its signal.".into(),
            required: true,
            ..Default::default()
        }],
        on_start: NarrativeHook {
            id: "signal-start".into(),
            effects: vec![],
        },
        on_complete: NarrativeHook {
            id: "signal-complete".into(),
            effects: vec![inc("rewards"), say("One reward was earned.")],
        },
        on_fail: NarrativeHook {
            id: "signal-fail".into(),
            effects: vec![],
        },
        ..Default::default()
    }];
    p.conversations = vec![Conversation {
        id: "patrol-talk".into(),
        name: "A pause for conversation".into(),
        character: "keeper".into(),
        default_entry: "chat".into(),
        nodes: vec![
            ConversationNode {
                id: "chat".into(),
                name: "Keep talking".into(),
                text: "I can hold my patrol while we talk.".into(),
                replies: vec![
                    ConversationReply {
                        id: "continue-chat".into(),
                        text: "Tell me a little more.".into(),
                        destination: Some("chat".into()),
                        ..Default::default()
                    },
                    ConversationReply {
                        id: "pause-chat".into(),
                        text: "Pause your patrol, but keep talking.".into(),
                        destination: Some("chat".into()),
                        effects: vec![Effect::PauseRoutine {
                            routine: "evening-patrol".into(),
                        }],
                        ..Default::default()
                    },
                    ConversationReply {
                        id: "leave-chat".into(),
                        text: "I'll let you work.".into(),
                        destination: Some("goodbye".into()),
                        ..Default::default()
                    },
                ],
                ..Default::default()
            },
            ConversationNode {
                id: "goodbye".into(),
                name: "Return to work".into(),
                text: "Thank you. I will continue on a later turn.".into(),
                terminal: true,
                ..Default::default()
            },
        ],
        ..Default::default()
    }];
    p.editor.positions = [
        ("study", (0., 0.)),
        ("garden", (330., 0.)),
        ("lab", (0., 250.)),
        ("offstage", (650., 250.)),
    ]
    .into_iter()
    .map(|(key, (x, y))| (key.into(), Point { x, y }))
    .collect();
    p.locations
        .iter_mut()
        .find(|l| l.id == "lab")
        .unwrap()
        .actions = std::mem::take(&mut p.game.actions);
    p.locations.sort_by(|a, b| a.id.cmp(&b.id));
    p.objects.sort_by(|a, b| a.id.cmp(&b.id));
    p.procedures.sort_by(|a, b| a.id.cmp(&b.id));
    p
}
