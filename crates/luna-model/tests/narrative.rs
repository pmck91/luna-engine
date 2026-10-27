#[path = "../../../tests/support/narrative.rs"]
#[allow(dead_code)]
mod fixture;
use luna_model::*;
#[test]
fn native_hook_validation_covers_every_root_and_preserves_owned_identities() {
    let p = fixture::project();
    let diagnostics = validate(&p);
    assert!(!has_errors(&diagnostics), "{diagnostics:?}");
    assert_eq!(p.minimum_format(), 5);
    let roots: Vec<_> = p.narrative_roots().map(|(id, _)| id).collect();
    for id in [
        "greeting",
        "accept",
        "progress",
        "goodbye",
        "revisit",
        "unused-node",
        "quest-start",
        "quest-complete",
        "quest-fail",
        "found",
        "returned",
    ] {
        assert!(roots.contains(&id));
    }
    assert!(
        all_effects(&p)
            .iter()
            .any(|e| matches!(e, Effect::Respond { id, .. } if id == "stage-sequence"))
    );
    assert!(
        !ordinary_effects(&p)
            .iter()
            .any(|e| matches!(e, Effect::Respond { id, .. } if id == "stage-sequence"))
    );
}
#[test]
fn invalid_graphs_prerequisites_native_calls_and_messages_are_findings() {
    let changes: [fn(&mut Project); 12] = [
        |p| p.conversations[0].character = p.game.starting_location.clone(),
        |p| p.conversations[0].nodes[0].id = "keeper".into(),
        |p| p.conversations[0].nodes[0].terminal = true,
        |p| p.conversations[0].nodes[0].replies[0].destination = Some("unused-node".into()),
        |p| p.conversations[0].nodes[0].replies[0].text.clear(),
        |p| p.quests[0].stages[0].prerequisites.push("returned".into()),
        |p| {
            p.quests[0].stages[0]
                .prerequisites
                .push("foreign-stage".into())
        },
        |p| p.quests[0].stages[1].prerequisites.push("found".into()),
        |p| p.quests[0].on_fail.id.clear(),
        |p| p.conversations[0].nodes[0].text = "%unknown_variable%".into(),
        |p| {
            p.quests[0].on_start.effects.push(Effect::Call {
                id: "bad-call".into(),
                procedure: "missing-procedure".into(),
                arguments: Default::default(),
            })
        },
        |p| {
            p.conversations[0].nodes[0].replies[0]
                .effects
                .push(Effect::Give {
                    object: EntityRef::Input {
                        procedure_input: "undeclared".into(),
                    },
                })
        },
    ];
    for change in changes {
        let mut p = fixture::project();
        change(&mut p);
        assert!(has_errors(&validate(&p)));
    }
}
#[test]
fn resets_stay_local_and_new_forms_require_format_five_even_in_templates() {
    let mut p = fixture::project();
    p.conversations[0].nodes[0]
        .effects
        .push(Effect::ResetResponses {
            sequence: "greeting-sequence".into(),
        });
    assert!(!has_errors(&validate(&p)));
    p.quests[0].on_start.effects.push(Effect::ResetResponses {
        sequence: "greeting-sequence".into(),
    });
    assert!(has_errors(&validate(&p)));
    let mut p = Project::blank("Version checks");
    p.game.format_version = 4;
    p.game.actions.push(Action {
        id: "future-effect".into(),
        verb: "use".into(),
        effects: vec![Effect::If {
            condition: Condition::True,
            then: vec![Effect::StartQuest {
                quest: "future-quest".into(),
            }],
            otherwise: vec![],
        }],
        ..Default::default()
    });
    assert_eq!(p.minimum_format(), 5);
    p.editor.templates.push(BlockTemplate {
        timers: vec![],
        narratives: vec![],
        id: "template".into(),
        name: "Template".into(),
        source_owner: None,
        entities: vec![],
        text_variables: vec![],
        content: TemplateContent::Effects {
            effects: p.game.actions.pop().unwrap().effects,
        },
    });
    assert_eq!(p.minimum_format(), 5);
    p.editor.templates.clear();
    p.game.actions.push(Action {
        id: "future-condition".into(),
        verb: "use".into(),
        requirements: Condition::Not {
            condition: Box::new(Condition::QuestStatus {
                quest: "q".into(),
                status: QuestStatus::Active,
            }),
        },
        ..Default::default()
    });
    assert_eq!(p.minimum_format(), 5);
    assert!(validate(&p).iter().any(|d| d.message.contains("format 5")));
}
#[test]
fn definitions_and_progress_reject_unknown_fields_and_duplicate_histories() {
    assert!(serde_json::from_str::<NarrativeProgress>(r#"{"quests":{"q":{},"q":{}}}"#).is_err());
    assert!(
        serde_json::from_str::<ConversationProgress>(r#"{"visited":["node","node"]}"#).is_err()
    );
    assert!(serde_json::from_str::<QuestProgress>(r#"{"stages":["stage","stage"]}"#).is_err());
    assert!(
        serde_json::from_str::<NarrativeProgress>(r#"{"offer_token":"must-not-be-saved"}"#)
            .is_err()
    );
    let mut raw = serde_json::to_value(fixture::project()).unwrap();
    raw["conversations"][0]["fuzzy"] = true.into();
    assert!(serde_json::from_value::<Project>(raw).is_err());
    let mut raw = serde_json::to_value(fixture::project()).unwrap();
    raw["game"]["format_version"] = 999.into();
    raw["conversations"] = serde_json::json!([{"type":"future-unknown-shape"}]);
    assert!(
        serde_json::from_value::<Project>(raw)
            .unwrap_err()
            .to_string()
            .contains("Unsupported game format 999")
    );
}
#[test]
fn reserved_prefix_audit_is_version_specific_and_includes_unused_aliases() {
    let mut p = Project::blank("Command audit");
    p.vocabulary.push(Verb {
        id: "gossip".into(),
        canonical: "gossip".into(),
        synonyms: vec!["reply about".into()],
        ..Default::default()
    });
    assert_eq!(narrative_command_conflicts(&p), ["gossip"]);
    assert!(has_errors(&validate(&p)));
    p.game.format_version = 4;
    assert!(!has_errors(&validate(&p)));
    for phrase in ["yes", "no", "ask about", "1", "bye later", "questing"] {
        assert!(!narrative_reserved(phrase));
    }
    for phrase in ["REPLY", "quest key", "quests", "quests now"] {
        assert!(narrative_reserved(phrase));
    }
}
#[test]
fn conditional_depth_reply_limits_and_owned_history_references_are_validated() {
    let mut p = fixture::project();
    let mut condition = Condition::True;
    for _ in 0..64 {
        condition = Condition::Not {
            condition: Box::new(condition),
        };
    }
    let mut legacy = Project::blank("Legacy condition query");
    legacy.game.format_version = 4;
    assert!(!has_errors(&validate_condition(&legacy, &condition)));
    p.conversations[0].available = condition;
    assert!(validate(&p).iter().any(|d| d.message.contains("nesting")));
    let mut p = fixture::project();
    p.conversations[0].nodes[0].replies = (0..257)
        .map(|n| ConversationReply {
            id: format!("reply-{n}"),
            text: "Choice".into(),
            ..Default::default()
        })
        .collect();
    assert!(validate(&p).iter().any(|d| d.message.contains("256")));
    let mut p = fixture::project();
    p.quests[0].stages[0].condition = Condition::ConversationReplyChosen {
        conversation: "unused-conversation".into(),
        reply: "accept".into(),
    };
    assert!(has_errors(&validate(&p)));
}
#[test]
fn setup_header_is_checked_before_state_and_legacy_collections_default_empty() {
    let raw = r#"{"version":999,"state":{"objects":"future-format"}}"#;
    assert!(
        serde_json::from_str::<PlaytestSetup>(raw)
            .unwrap_err()
            .to_string()
            .contains("Unsupported playtest setup version 999")
    );
    for version in 1..=4 {
        let mut p = Project::blank("Legacy");
        p.game.format_version = version;
        if version < 3 {
            p.game.command_assistance = None;
        }
        let value = serde_json::to_value(&p).unwrap();
        assert!(value.get("conversations").is_none());
        assert!(value.get("quests").is_none());
        let decoded: Project = serde_json::from_value(value).unwrap();
        assert!(decoded.conversations.is_empty() && decoded.quests.is_empty());
        assert_eq!(decoded, p);
    }
}

#[test]
fn frozen_content_and_setup_fixtures_use_the_canonical_versioned_types() {
    let p: Project = serde_json::from_str(include_str!(
        "../../../tests/fixtures/narrative/content5.json"
    ))
    .unwrap();
    assert_eq!(p, fixture::project());
    let setup: PlaytestSetup = serde_json::from_str(include_str!(
        "../../../tests/fixtures/narrative/setup3.json"
    ))
    .unwrap();
    let state: GameState = serde_json::from_str(include_str!(
        "../../../tests/fixtures/narrative/state5.json"
    ))
    .unwrap();
    assert_eq!(setup.version, 3);
    assert_eq!(setup.state, state);
    assert_eq!(state.narrative.active.as_deref(), Some("conversation"));
}
#[test]
fn structural_reachability_follows_dialogue_reply_and_quest_hooks() {
    let mut p = fixture::project();
    p.game.require_ending = true;
    p.game.endings.push(Ending {
        id: "finished".into(),
        name: "Finished".into(),
        ..Default::default()
    });
    p.game.actions[0].effects = vec![Effect::StartConversation {
        conversation: "conversation".into(),
    }];
    p.conversations[0].nodes[0].replies[0]
        .effects
        .push(Effect::CompleteQuest {
            quest: "missing".into(),
        });
    p.quests[0].on_complete.effects = vec![Effect::End {
        ending: "finished".into(),
    }];
    assert!(!has_errors(&validate(&p)));
    p.conversations[0].available = Condition::False;
    assert!(
        validate(&p)
            .iter()
            .any(|d| d.message.contains("none is structurally reachable"))
    );
}

#[test]
fn header_preflight_keeps_duplicate_progress_visible_to_the_strict_decoder() {
    let setup: PlaytestSetup = serde_json::from_str(include_str!(
        "../../../tests/fixtures/narrative/setup3.json"
    ))
    .unwrap();
    let encoded = serde_json::to_string(&setup).unwrap().replacen(
        "\"quests\":{\"missing\":",
        "\"quests\":{\"missing\":{},\"missing\":",
        1,
    );
    assert!(
        serde_json::from_str::<PlaytestSetup>(&encoded)
            .unwrap_err()
            .to_string()
            .contains("Duplicate narrative")
    );
    let mut p = fixture::project();
    p.editor.playtest = Some(PlaytestLibrary {
        setups: vec![setup],
        checks: vec![],
    });
    let encoded = serde_json::to_string(&p).unwrap().replacen(
        "\"quests\":{\"missing\":",
        "\"quests\":{\"missing\":{},\"missing\":",
        1,
    );
    assert!(
        serde_json::from_str::<Project>(&encoded)
            .unwrap_err()
            .to_string()
            .contains("Duplicate narrative")
    );
}
