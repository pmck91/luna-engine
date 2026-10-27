//! Playable native quest specimen for N3 core, API and separate-process checks.
use luna_model::*;

pub fn increment(name: &str) -> Effect {
    Effect::UpdateVariable {
        name: name.into(),
        op: ArithmeticOperation::Add,
        operand: NumericOperand::Literal { value: 1 },
    }
}
pub fn action(p: &mut Project, word: &str, effects: Vec<Effect>) {
    p.game.actions.push(Action {
        id: format!("action-{word}"),
        name: word.into(),
        verb: "use".into(),
        pattern: vec![PatternPart::Literal { text: word.into() }],
        effects,
        ..Default::default()
    });
}
pub fn stage(id: &str) -> Effect {
    Effect::CompleteQuestStage {
        quest: "missing".into(),
        stage: id.into(),
    }
}
pub fn project() -> Project {
    let mut p = Project::blank("Keeper quest runtime");
    p.game.id = "quest-runtime".into();
    p.locations[0].id = "study".into();
    p.locations[0].actions.clear();
    p.game.starting_location = "study".into();
    for name in [
        "coins", "starts", "found", "returns", "rewards", "failures", "commands", "divisor",
    ] {
        p.game.variables.insert(name.into(), Value::Integer(0));
    }
    p.characters.push(Character {
        id: "keeper".into(),
        name: "Keeper".into(),
        location: "study".into(),
        ..Default::default()
    });
    p.objects.push(Object {
        id: "key".into(),
        name: "key".into(),
        placement: Placement::Location {
            location: "study".into(),
        },
        ..Default::default()
    });
    p.procedures.push(Procedure {
        id: "reward".into(),
        name: "Reward".into(),
        description: String::new(),
        inputs: vec![],
        effects: vec![
            increment("rewards"),
            Effect::UpdateVariable {
                name: "coins".into(),
                op: ArithmeticOperation::Add,
                operand: NumericOperand::Literal { value: 10 },
            },
            Effect::Respond {
                id: "reward-response".into(),
                responses: vec![
                    "Ten coins for your trouble.".into(),
                    "Another reward.".into(),
                ],
                mode: SequenceMode::Loop,
                fallback: "".into(),
                exhaustion: ExhaustionMode::Once,
                on_exhausted: vec![],
            },
        ],
    });
    p.quests.push(Quest {
        id: "missing".into(),
        title: "The Missing Key".into(),
        aliases: vec!["key".into()],
        introduction: "Find the Keeper's key. Coins: %coins%.".into(),
        completion: "Returned the key. Coins before reward: %coins%.".into(),
        failure: "The key is lost.".into(),
        on_start: NarrativeHook {
            id: "quest-start".into(),
            effects: vec![
                increment("starts"),
                Effect::If {
                    condition: Condition::Carrying {
                        object: "key".into(),
                    },
                    then: vec![stage("found-stage")],
                    otherwise: vec![],
                },
            ],
        },
        on_complete: NarrativeHook {
            id: "quest-complete".into(),
            effects: vec![Effect::Call {
                id: "quest-reward-call".into(),
                procedure: "reward".into(),
                arguments: Default::default(),
            }],
        },
        on_fail: NarrativeHook {
            id: "quest-fail".into(),
            effects: vec![increment("failures")],
        },
        stages: vec![
            QuestStage {
                id: "found-stage".into(),
                name: "Find key".into(),
                text: "Found the key.".into(),
                condition: Condition::Carrying {
                    object: "key".into(),
                },
                effects: vec![increment("found")],
                ..Default::default()
            },
            QuestStage {
                id: "returned".into(),
                name: "Return key".into(),
                text: "Returned the key.".into(),
                prerequisites: vec!["found-stage".into()],
                condition: Condition::Carrying {
                    object: "key".into(),
                },
                effects: vec![
                    increment("returns"),
                    Effect::GiveCharacter {
                        object: "key".into(),
                        character: "keeper".into(),
                    },
                ],
                ..Default::default()
            },
        ],
    });
    action(
        &mut p,
        "accept",
        vec![Effect::StartQuest {
            quest: "missing".into(),
        }],
    );
    action(
        &mut p,
        "find",
        vec![
            Effect::Give {
                object: "key".into(),
            },
            Effect::If {
                condition: Condition::QuestStatus {
                    quest: "missing".into(),
                    status: QuestStatus::Active,
                },
                then: vec![stage("found-stage")],
                otherwise: vec![],
            },
        ],
    );
    action(&mut p, "return", vec![stage("returned")]);
    action(
        &mut p,
        "complete",
        vec![Effect::CompleteQuest {
            quest: "missing".into(),
        }],
    );
    action(
        &mut p,
        "fail",
        vec![Effect::FailQuest {
            quest: "missing".into(),
        }],
    );
    p
}
