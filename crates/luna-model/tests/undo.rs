use luna_model::*;

#[test]
fn undo_is_off_and_omitted_by_default_in_every_supported_content_format() {
    for version in 1..=FORMAT_VERSION {
        let mut p = Project::blank("Legacy undo compatibility");
        p.game.format_version = version;
        p.game.command_assistance = None;
        assert!(!p.game.allow_player_undo);
        let json = serde_json::to_value(&p).unwrap();
        assert!(json["game"].get("allow_player_undo").is_none());
        let decoded: Project = serde_json::from_value(json).unwrap();
        assert!(!decoded.game.allow_player_undo);
        assert!(!has_errors(&validate(&decoded)));
        assert_eq!(decoded.minimum_format(), 1);
    }
}

#[test]
fn enabling_undo_requires_an_explicit_content_eight_upgrade_and_a_boolean() {
    let mut p = Project::blank("Opt in");
    p.game.allow_player_undo = true;
    assert_eq!(p.minimum_format(), 8);
    for version in 1..8 {
        p.game.format_version = version;
        let diagnostics = validate(&p);
        assert!(
            diagnostics
                .iter()
                .any(|d| d.field == "allow_player_undo" && d.message.contains("content format 8"))
        );
    }
    p.game.format_version = 8;
    assert!(!has_errors(&validate(&p)));
    for value in [
        serde_json::json!(1),
        serde_json::json!("true"),
        serde_json::Value::Null,
    ] {
        let mut json = serde_json::to_value(&p).unwrap();
        json["game"]["allow_player_undo"] = value;
        assert!(serde_json::from_value::<Project>(json).is_err());
    }
    p.game.allow_player_undo = false;
    assert_eq!(p.game.format_version, 8);
    assert!(
        serde_json::to_value(&p.game)
            .unwrap()
            .get("allow_player_undo")
            .is_none()
    );
}

#[test]
fn collision_validation_includes_synonyms_and_unavailable_entities_without_reserving_longer_commands()
 {
    let mut p = Project::blank("Command collisions");
    p.vocabulary.push(Verb {
        id: "rewind".into(),
        canonical: "rewind".into(),
        synonyms: vec!["UNDO!".into()],
        ..Default::default()
    });
    let action = |id: &str| Action {
        id: id.into(),
        verb: "rewind".into(),
        ..Default::default()
    };
    p.game.actions.push(action("global"));
    p.objects.push(Object {
        id: "hidden".into(),
        name: "Hidden".into(),
        hidden: true,
        actions: vec![action("hidden-command")],
        ..Default::default()
    });
    p.characters.push(Character {
        id: "absent".into(),
        name: "Absent".into(),
        location: p.game.starting_location.clone(),
        hidden: true,
        actions: vec![action("character-command")],
        ..Default::default()
    });
    p.locations.push(Location {
        id: "offstage".into(),
        name: "Offstage".into(),
        actions: vec![action("room-command")],
        ..Default::default()
    });
    assert_eq!(
        player_undo_command_conflicts(&p),
        [
            "character-command",
            "global",
            "hidden-command",
            "room-command"
        ]
    );
    assert!(!has_errors(&validate(&p)));
    p.game.allow_player_undo = true;
    let diagnostics = validate(&p);
    for id in player_undo_command_conflicts(&p) {
        assert!(
            diagnostics
                .iter()
                .any(|d| d.subject == id && d.message.contains("exact command undo"))
        );
    }
    p.game.actions.clear();
    p.characters.clear();
    p.locations[1].actions.clear();
    p.objects[0].actions.clear();
    p.objects[0].name = "undo".into();
    let mut longer = action("longer-command");
    longer.pattern = vec![PatternPart::Literal {
        text: "lever".into(),
    }];
    p.game.actions.push(longer);
    p.game.actions.push(Action {
        id: "take-undo".into(),
        verb: "take".into(),
        pattern: vec![PatternPart::Entity {
            entity: "hidden".into(),
        }],
        ..Default::default()
    });
    assert!(player_undo_command_conflicts(&p).is_empty());
    assert!(!has_errors(&validate(&p)));
}
