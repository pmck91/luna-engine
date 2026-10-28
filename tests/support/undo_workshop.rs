//! Source for deliberate generation of the separate Undo Workshop.
//! Acceptance loads retained files; ordinary tests never regenerate examples.
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
fn set(name: &str, value: i32) -> Effect {
    Effect::SetVariable {
        name: name.into(),
        value: Value::Integer(value),
    }
}
fn free() -> Option<ActionTurnCost> {
    Some(ActionTurnCost {
        success: TurnCost::Free,
        ..Default::default()
    })
}
fn command(
    id: &str,
    verb: &str,
    target: PatternPart,
    effects: Vec<Effect>,
    is_free: bool,
) -> Action {
    Action {
        id: id.into(),
        name: id.replace('-', " "),
        verb: verb.into(),
        pattern: vec![target],
        effects,
        turn_cost: if is_free { free() } else { None },
        ..Default::default()
    }
}
fn noun(id: &str) -> PatternPart {
    PatternPart::Entity { entity: id.into() }
}
fn literal(word: &str) -> PatternPart {
    PatternPart::Literal { text: word.into() }
}
fn call(id: &str, procedure: &str) -> Effect {
    Effect::Call {
        id: id.into(),
        procedure: procedure.into(),
        arguments: Default::default(),
    }
}
fn description(id: &str) -> Action {
    command(
        &format!("{id}-examine"),
        "examine",
        noun(id),
        vec![Effect::PrintDescription { entity: id.into() }],
        true,
    )
}

pub fn project() -> Project {
    let mut p = Project::blank("The Undo Workshop");
    p.game.id = "undo-workshop".into();
    p.game.format_version = 8;
    p.game.allow_player_undo = true;
    p.game.turns = Some(TurnPolicy::default());
    p.game.starting_location = "workshop".into();
    p.game.opening_text = "Begin with take brass key, undo, then pull lever and undo. Taking and dropping are free. Go lab for optional experiments.".into();
    p.game.help_text = "Try take brass key, drop brass key, pull lever, push finish button, and undo. LOOK is free. The optional lab is reached with go lab.".into();
    p.game.variables = [
        "lever_pulls",
        "coins",
        "lab_value",
        "watches",
        "bells",
        "routine_moves",
        "reply_rewards",
        "dialogue_entries",
        "ending_hooks",
    ]
    .into_iter()
    .map(|k| (k.into(), Value::Integer(0)))
    .collect();
    p.game.variables.insert("divisor".into(), Value::Integer(1));
    p.game.endings = vec![Ending {
        id: "finished".into(),
        name: "Workshop complete".into(),
        text: "Workshop finished. Undo can return you to play.".into(),
        outcome: None,
    }];
    p.game.triggers = vec![
        Trigger {
            id: "ending-hook".into(),
            name: "Count ending once".into(),
            event: Event::Ending,
            effects: vec![inc("ending_hooks")],
            ..Default::default()
        },
        Trigger {
            id: "lab-watch".into(),
            name: "Watch the lab value".into(),
            watch: Some(TriggerWatch {
                target: ValueTarget::Variable {
                    name: "lab_value".into(),
                },
                mode: WatchMode::BecomesTrue,
            }),
            condition: Condition::Variable {
                name: "lab_value".into(),
                op: Comparison::Gt,
                value: Value::Integer(0),
            },
            effects: vec![inc("watches")],
            ..Default::default()
        },
    ];
    p.locations = vec![Location { id: "workshop".into(), name: "Workshop".into(), description: "A brass key and a lever make a small first experiment. Lever pulls: %lever_pulls%. The finish button ends the game. Go lab for the optional lab.".into(), actions: vec![description("workshop")], exits: vec![Exit { id: "to-lab".into(), name: "lab".into(), verb: "go".into(), destination: "lab".into(), turn_cost: free(), ..Default::default() }], ..Default::default() }, Location {
        id: "lab".into(), name: "Undo lab".into(), aliases: vec!["lab".into()], description: "Optional: use arm, then pull console. Inspect the quest log, timers, routines and world state. Use failing arms a late failure; use repair fixes it. Talk keeper tests replies. Go workshop returns.".into(),
        actions: vec![description("lab"), command("arm-lab", "use", literal("arm"), vec![call("arm-call", "prepare-lab")], true), command("arm-failure", "use", literal("failing"), vec![call("failing-arm-call", "prepare-lab"), set("divisor", 0)], true), command("repair-lab", "use", literal("repair"), vec![set("divisor", 1), say("The timer is repaired. Pull console again.")], true)],
        exits: vec![Exit { id: "to-workshop".into(), name: "workshop".into(), verb: "go".into(), destination: "workshop".into(), turn_cost: free(), ..Default::default() }], ..Default::default()
    }];
    p.objects = vec![Object { id: "brass-key".into(), name: "brass key".into(), aliases: vec!["key".into()], description: "A simple brass key. Taking or dropping it costs no turn but still creates an undo point.".into(), portable: true, placement: Placement::Location { location: "workshop".into() }, actions: vec![description("brass-key"), command("take-key", "take", noun("brass-key"), vec![Effect::Give { object: "brass-key".into() }, say("You take the brass key.")], true), command("drop-key", "drop", noun("brass-key"), vec![Effect::Place { object: "brass-key".into(), location: "workshop".into() }, say("You put the key back on its stand.")], true)], ..Default::default() }, Object {
        id: "lever".into(), name: "lever".into(), description: "Pulls: %lever_pulls%. Pulling spends one turn. Undo restores both the counter and the clock.".into(), placement: Placement::Location { location: "workshop".into() }, actions: vec![description("lever"), command("pull-lever", "pull", noun("lever"), vec![inc("lever_pulls"), say("The lever clicks. Pulls: %lever_pulls%.")], false)],
        hints: vec![HintSet { id: "lever-hints".into(), name: "Trying the lever".into(), available: Condition::True, solved: Condition::False, stages: vec![HintStage { id: "lever-clue".into(), name: "One clue".into(), condition: Condition::True, clues: vec!["Pull the lever, then try undo. Looking around does not spend a turn.".into()], solution: Some("Type pull lever, then undo. The counter and clock return together.".into()) }] }], ..Default::default()
    }, Object { id: "finish-button".into(), name: "finish button".into(), aliases: vec!["button".into()], description: "Ends the workshop. An available undo point can return you to play.".into(), placement: Placement::Location { location: "workshop".into() }, actions: vec![description("finish-button"), command("finish-workshop", "push", noun("finish-button"), vec![Effect::End { ending: "finished".into() }], false)], ..Default::default() }, Object {
        id: "console".into(), name: "console".into(), description: "Lab value %lab_value%, watch %watches%, bells %bells%, routine moves %routine_moves%, coins %coins%. Use arm before pulling.".into(), placement: Placement::Location { location: "lab".into() }, actions: vec![description("console"), Action { requirements: Condition::QuestStatus { quest: "lab-quest".into(), status: QuestStatus::Active }, failure_text: "Use arm first, or restore the Lab armed setup.".into(), ..command("pull-console", "pull", noun("console"), vec![call("console-change-call", "lab-change")], false) }], ..Default::default()
    }];
    p.characters = vec![Character { id: "keeper".into(), name: "Keeper".into(), location: "lab".into(), description: "Offers one prewritten reply. Undoing it restores the earlier choices without repeating the greeting.".into(), actions: vec![description("keeper"), command("talk-keeper", "talk", noun("keeper"), vec![Effect::StartConversation { conversation: "keeper-chat".into() }], true)], ..Default::default() }];
    p.procedures = vec![
        Procedure {
            id: "prepare-lab".into(),
            name: "Arm the optional lab".into(),
            description: "Prepare a quest, timer and character routine without spending a turn."
                .into(),
            inputs: vec![],
            effects: vec![
                set("divisor", 1),
                Effect::StartQuest {
                    quest: "lab-quest".into(),
                },
                Effect::StartRoutine {
                    routine: "lab-routine".into(),
                    busy: RoutineBusyPolicy::Replace,
                },
                Effect::ScheduleTimer {
                    timer: "lab-bell".into(),
                    after: NumericOperand::Literal { value: 1 },
                    pending: TimerPendingPolicy::Restart,
                },
                say(
                    "Lab armed. Pull console: one action will change the quest, reward, response, watch, timer and routine.",
                ),
            ],
        },
        Procedure {
            id: "lab-change".into(),
            name: "Whole lab change".into(),
            description: "One initiating action and its synchronous consequences form one point."
                .into(),
            inputs: vec![],
            effects: vec![
                inc("lab_value"),
                Effect::Give {
                    object: "brass-key".into(),
                },
                Effect::Respond {
                    id: "lab-response".into(),
                    responses: vec!["The console response advances once.".into()],
                    mode: SequenceMode::Fallback,
                    fallback: "The response is already known.".into(),
                    exhaustion: ExhaustionMode::Once,
                    on_exhausted: vec![],
                },
                Effect::CompleteQuestStage {
                    quest: "lab-quest".into(),
                    stage: "lab-stage".into(),
                },
                Effect::CompleteQuest {
                    quest: "lab-quest".into(),
                },
            ],
        },
    ];
    p.quests = vec![Quest {
        id: "lab-quest".into(),
        title: "Restore the whole change".into(),
        introduction: "Pull the armed console, inspect the consequences, then undo.".into(),
        completion: "The lab change completed. Its reward belongs to this same action.".into(),
        stages: vec![QuestStage {
            id: "lab-stage".into(),
            name: "Test the console".into(),
            text: "The console changed the world.".into(),
            ..Default::default()
        }],
        on_start: NarrativeHook {
            id: "lab-quest-start".into(),
            effects: vec![],
        },
        on_complete: NarrativeHook {
            id: "lab-quest-reward".into(),
            effects: vec![Effect::UpdateVariable {
                name: "coins".into(),
                op: ArithmeticOperation::Add,
                operand: NumericOperand::Literal { value: 10 },
            }],
        },
        on_fail: NarrativeHook {
            id: "lab-quest-fail".into(),
            effects: vec![],
        },
        ..Default::default()
    }];
    p.timers = vec![ScheduledTrigger {
        id: "lab-bell".into(),
        name: "Lab bell".into(),
        order: 0,
        priority: 0,
        condition: Condition::True,
        effects: vec![
            inc("bells"),
            Effect::UpdateVariable {
                name: "bells".into(),
                op: ArithmeticOperation::Divide,
                operand: NumericOperand::Variable {
                    name: "divisor".into(),
                },
            },
            say("The lab bell rings once."),
        ],
    }];
    p.routines = vec![CharacterRoutine {
        id: "lab-routine".into(),
        name: "Keeper lab demonstration".into(),
        character: "keeper".into(),
        order: 0,
        start: RoutineStart::Blocks,
        repeat: RoutineRepeat::Finish,
        hold_conversation: true,
        steps: vec![
            RoutineStep {
                id: "keeper-move".into(),
                name: "Return to Workshop".into(),
                condition: Condition::True,
                blocked: RoutineBlocked::Retry,
                wait: None,
                effects: vec![
                    Effect::MoveCharacter {
                        character: "keeper".into(),
                        location: "workshop".into(),
                    },
                    inc("routine_moves"),
                ],
            },
            RoutineStep {
                id: "keeper-wait".into(),
                name: "Wait two turns".into(),
                condition: Condition::True,
                blocked: RoutineBlocked::Retry,
                wait: Some(NumericOperand::Literal { value: 2 }),
                effects: vec![],
            },
        ],
    }];
    p.conversations = vec![Conversation {
        id: "keeper-chat".into(),
        name: "A reversible reply".into(),
        character: "keeper".into(),
        default_entry: "keeper-greeting".into(),
        entries: vec![ConversationEntry {
            condition: Condition::Variable {
                name: "reply_rewards".into(),
                op: Comparison::Gt,
                value: Value::Integer(0),
            },
            node: "keeper-thanks".into(),
        }],
        nodes: vec![
            ConversationNode {
                id: "keeper-greeting".into(),
                name: "Greeting".into(),
                text: "Would you like to test a reply?".into(),
                effects: vec![inc("dialogue_entries")],
                replies: vec![ConversationReply {
                    id: "keeper-yes".into(),
                    text: "Yes, let's try it.".into(),
                    once: true,
                    effects: vec![
                        inc("reply_rewards"),
                        say("The Keeper records your answer once."),
                    ],
                    turn_cost: TurnCost::Free,
                    ..Default::default()
                }],
                ..Default::default()
            },
            ConversationNode {
                id: "keeper-thanks".into(),
                name: "Return greeting".into(),
                text: "Thank you again for trying the reply.".into(),
                terminal: true,
                ..Default::default()
            },
        ],
        ..Default::default()
    }];
    p.editor.positions = [
        ("workshop".into(), Point { x: 80., y: 100. }),
        ("lab".into(), Point { x: 420., y: 100. }),
    ]
    .into();
    p
}

pub fn checkpoints() -> Vec<(&'static str, Vec<&'static str>)> {
    vec![
        ("Carrying key", vec!["take brass key"]),
        ("Known lever clue", vec!["hint lever"]),
        ("Lab armed", vec!["go lab", "use arm"]),
        ("Before late failure", vec!["go lab", "use failing"]),
        ("Conversation offer", vec!["go lab", "talk keeper"]),
        (
            "After compound change",
            vec!["go lab", "use arm", "pull console"],
        ),
        (
            "Lab mid-wait",
            vec!["go lab", "use arm", "pull console", "wait"],
        ),
        ("Completed game", vec!["pull lever", "push finish button"]),
    ]
}
