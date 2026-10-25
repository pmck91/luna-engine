use luna_core::{CommandResult, CommandStatus, Session};
use luna_model::*;

fn target(entity: &str) -> PatternPart {
    PatternPart::Entity {
        entity: entity.into(),
    }
}
fn word(text: &str) -> PatternPart {
    PatternPart::Literal { text: text.into() }
}
fn action(id: &str, verb: &str, pattern: Vec<PatternPart>) -> Action {
    Action {
        id: id.into(),
        name: id.into(),
        verb: verb.into(),
        pattern,
        ..Default::default()
    }
}
fn world() -> Project {
    let mut p = Project::blank("Entity help");
    p.game.help_mode = HelpMode::Full;
    let room = p.game.starting_location.clone();
    p.locations[0].name = "Study".into();
    p.locations[0].aliases = vec!["room".into()];
    p.locations.push(Location {
        id: "garden".into(),
        name: "Garden".into(),
        ..Default::default()
    });
    p.vocabulary.push(Verb {
        id: "give".into(),
        canonical: "give".into(),
        synonyms: vec!["hand".into()],
        event: None,
    });
    let mut key = Object {
        id: "key".into(),
        name: "brass key".into(),
        aliases: vec!["key".into()],
        portable: true,
        placement: Placement::Location {
            location: room.clone(),
        },
        ..Default::default()
    };
    key.actions = starter_actions(&key);
    let mut give = action(
        "give-key",
        "give",
        vec![target("key"), word("to"), target("keeper")],
    );
    give.requirements = Condition::Carrying {
        object: "key".into(),
    };
    give.effects = vec![Effect::GiveCharacter {
        object: "key".into(),
        character: "keeper".into(),
    }];
    key.actions.push(give);
    p.objects.push(key);
    let mut unlock = action(
        "unlock",
        "use",
        vec![target("key"), word("on"), target("door")],
    );
    unlock.requirements = Condition::Carrying {
        object: "key".into(),
    };
    p.objects.push(Object {
        id: "door".into(),
        name: "oak door".into(),
        aliases: vec!["door".into()],
        placement: Placement::Location { location: room },
        actions: vec![description_action("door"), unlock],
        ..Default::default()
    });
    p.characters.push(Character {
        id: "keeper".into(),
        name: "Keeper".into(),
        aliases: vec!["guard".into()],
        location: p.game.starting_location.clone(),
        actions: vec![
            description_action("keeper"),
            action("talk-to-keeper", "talk", vec![target("keeper")]),
        ],
        ..Default::default()
    });
    p.locations[0].exits.push(Exit {
        id: "east".into(),
        name: "east".into(),
        verb: "go".into(),
        destination: "garden".into(),
        ..Default::default()
    });
    p
}
fn lines(result: &CommandResult) -> Vec<String> {
    result.messages.iter().map(|m| text::plain(m)).collect()
}
fn help(session: &mut Session, input: &str) -> CommandResult {
    let before = session.state().clone();
    let result = session.command(input).unwrap();
    assert_eq!(session.state(), &before, "Help must be read-only: {input}");
    assert!(!result.state_changed);
    assert!(result.control.is_none());
    assert!(result.trace.is_empty());
    result
}

#[test]
fn entity_help_lists_complete_current_commands_across_action_owners() {
    let (mut s, _) = Session::start(world(), None).unwrap();
    assert_eq!(
        lines(&help(&mut s, "help key")),
        [
            "Available commands for brass key:",
            "  examine brass key",
            "  take brass key"
        ]
    );
    s.command("take key").unwrap();
    assert_eq!(
        lines(&help(&mut s, "help key")),
        [
            "Available commands for brass key:",
            "  drop brass key",
            "  examine brass key",
            "  give brass key to Keeper",
            "  use brass key on oak door"
        ]
    );
    assert_eq!(
        lines(&help(&mut s, "help guard")),
        [
            "Available commands for Keeper:",
            "  examine Keeper",
            "  give brass key to Keeper",
            "  talk Keeper"
        ]
    );
    assert_eq!(
        lines(&help(&mut s, "help door")),
        [
            "Available commands for oak door:",
            "  examine oak door",
            "  use brass key on oak door"
        ]
    );
    s.command("give the key to the keeper").unwrap();
    assert_eq!(help(&mut s, "help key").status, CommandStatus::Unmatched);
    assert_eq!(
        lines(&help(&mut s, "help Keeper")),
        [
            "Available commands for Keeper:",
            "  examine Keeper",
            "  talk Keeper"
        ]
    );
}

#[test]
fn names_aliases_ignored_words_and_ambiguity_follow_entity_scope() {
    let mut p = world();
    p.objects.push(Object {
        id: "silver".into(),
        name: "silver key".into(),
        aliases: vec!["key".into()],
        placement: Placement::Inventory,
        actions: vec![description_action("silver")],
        ..Default::default()
    });
    let (mut s, _) = Session::start(p, None).unwrap();
    let ambiguous = help(&mut s, "help the key");
    assert_eq!(ambiguous.status, CommandStatus::Ambiguous);
    assert_eq!(
        lines(&ambiguous),
        ["Which entity do you mean? brass key, silver key. Use a more specific name or alias."]
    );
    assert_eq!(
        lines(&help(&mut s, "HELP, THE THE BRASS KEY!"))[0],
        "Available commands for brass key:"
    );
    for query in ["help missing", "help Garden", "help brass key extra"] {
        assert_eq!(help(&mut s, query).status, CommandStatus::Unmatched);
    }
    let mut state = s.state().clone();
    state.objects.get_mut("silver").unwrap().hidden = true;
    s.replace_state(state).unwrap();
    assert_eq!(
        lines(&help(&mut s, "help key"))[0],
        "Available commands for brass key:"
    );
    assert_eq!(
        help(&mut s, "help silver key").status,
        CommandStatus::Unmatched
    );
    let mut project = s.project().clone();
    project.game.ignored_words.clear();
    s = Session::restore(project, s.into_state()).unwrap();
    assert_eq!(
        help(&mut s, "help the brass key").status,
        CommandStatus::Unmatched
    );
    assert_eq!(help(&mut s, "help brass key").status, CommandStatus::Ok);
}

#[test]
fn help_never_executes_effects_triggers_or_response_sequences() {
    let mut p = world();
    p.game.variables.insert("visits".into(), Value::Integer(0));
    let examine = p.objects[0]
        .actions
        .iter_mut()
        .find(|a| a.verb == "examine")
        .unwrap();
    examine.effects = vec![Effect::Respond {
        id: "replies".into(),
        responses: vec!["First".into(), "Second".into()],
        mode: SequenceMode::RepeatLast,
        fallback: String::new(),
        exhaustion: luna_model::ExhaustionMode::Once,
        on_exhausted: vec![],
    }];
    p.game.triggers.push(Trigger {
        id: "command-trigger".into(),
        event: Event::Command,
        effects: vec![Effect::SetVariable {
            name: "visits".into(),
            value: Value::Integer(1),
        }],
        ..Default::default()
    });
    let (mut s, _) = Session::start(p, None).unwrap();
    for query in ["help key", "help key", "help", "help missing", "help Study"] {
        help(&mut s, query);
    }
    assert_eq!(s.state().sequences["replies"], 0);
    assert_eq!(s.state().variables["visits"], Value::Integer(0));
    assert_eq!(lines(&s.command("examine key").unwrap()), ["First"]);
}

#[test]
fn blocked_hidden_remote_and_held_targets_are_not_advertised() {
    let mut p = world();
    p.objects[0].placement = Placement::Inventory;
    p.objects[1].hidden = true;
    p.characters[0].location = "garden".into();
    let mut remote = action("remote-action", "pull", vec![target("key")]);
    remote.effects = vec![];
    p.locations[1].actions.push(remote);
    let (mut s, _) = Session::start(p, None).unwrap();
    assert_eq!(
        lines(&help(&mut s, "help key")),
        [
            "Available commands for brass key:",
            "  drop brass key",
            "  examine brass key"
        ]
    );
    assert_eq!(help(&mut s, "help Keeper").status, CommandStatus::Unmatched);
    assert_eq!(help(&mut s, "help door").status, CommandStatus::Unmatched);
    let mut state = s.state().clone();
    state.objects.get_mut("key").unwrap().placement = Placement::Character {
        character: "keeper".into(),
    };
    s.replace_state(state).unwrap();
    assert_eq!(help(&mut s, "help key").status, CommandStatus::Unmatched);
    let mut state = s.state().clone();
    state.objects.get_mut("key").unwrap().placement = Placement::Absent;
    state.objects.get_mut("key").unwrap().exists = false;
    state.objects.get_mut("key").unwrap().consumed = true;
    s.replace_state(state).unwrap();
    assert_eq!(help(&mut s, "help key").status, CommandStatus::Unmatched);
}

#[test]
fn priorities_ambiguity_and_duplicate_phrases_use_the_actual_command_winner() {
    let mut p = world();
    let lower = action("push-low", "push", vec![target("key")]);
    let mut blocked = lower.clone();
    blocked.id = "push-high".into();
    blocked.priority = 1;
    blocked.requirements = Condition::False;
    p.objects[0].actions.extend([lower, blocked]);
    for id in ["pull-a", "pull-b"] {
        p.objects[0]
            .actions
            .push(action(id, "pull", vec![target("key")]));
    }
    let (mut s, _) = Session::start(p, None).unwrap();
    let result = lines(&help(&mut s, "help key"));
    assert_eq!(
        result,
        [
            "Available commands for brass key:",
            "  examine brass key",
            "  take brass key"
        ]
    );
    assert_eq!(
        s.command("push key").unwrap().status,
        CommandStatus::RequirementsFailed
    );
    assert_eq!(
        s.command("pull key").unwrap().status,
        CommandStatus::Ambiguous
    );
    let mut project = s.project().clone();
    project.objects[0]
        .actions
        .iter_mut()
        .find(|a| a.id == "push-high")
        .unwrap()
        .requirements = Condition::True;
    s = Session::restore(project, s.into_state()).unwrap();
    assert_eq!(
        lines(&help(&mut s, "help key"))
            .iter()
            .filter(|s| s.trim() == "push brass key")
            .count(),
        1
    );
}

#[test]
fn location_help_includes_only_available_routes_and_literal_owned_commands() {
    let mut p = world();
    p.locations[0]
        .actions
        .push(action("literal-action", "push", vec![word("the switch")]));
    let mut hidden = p.locations[0].exits[0].clone();
    hidden.id = "hidden".into();
    hidden.name = "north".into();
    hidden.visible = Condition::False;
    let mut blocked = hidden.clone();
    blocked.id = "blocked".into();
    blocked.name = "south".into();
    blocked.visible = Condition::True;
    blocked.available = Condition::False;
    p.locations[0].exits.extend([hidden, blocked]);
    let (mut s, _) = Session::start(p, None).unwrap();
    assert_eq!(
        lines(&help(&mut s, "help room")),
        [
            "Available commands for Study:",
            "  examine Study",
            "  go east",
            "  push the switch"
        ]
    );
    let mut project = s.project().clone();
    project.locations[0].exits[2].available = Condition::True;
    s = Session::restore(project, s.into_state()).unwrap();
    assert!(lines(&help(&mut s, "help Study")).contains(&"  go south".into()));
}

#[test]
fn empty_help_and_ended_games_report_no_available_commands() {
    let mut p = world();
    p.characters[0].actions.clear();
    p.objects[0].actions.retain(|a| a.verb != "give");
    p.game.endings.push(Ending {
        id: "done".into(),
        name: "Done".into(),
        ..Default::default()
    });
    let (mut s, _) = Session::start(p, None).unwrap();
    assert_eq!(
        lines(&help(&mut s, "help Keeper")),
        ["No commands are available for Keeper right now."]
    );
    let mut state = s.state().clone();
    state.ending = Some("done".into());
    s.replace_state(state).unwrap();
    assert_eq!(
        lines(&help(&mut s, "help key")),
        ["No commands are available for brass key right now."]
    );
    assert!(
        lines(&help(&mut s, "help"))
            .iter()
            .any(|line| line.contains("help [entity]"))
    );
    assert!(s.command(&format!("help {}", "x".repeat(4096))).is_err());
}

#[test]
fn basic_help_lists_verbs_without_targets_or_puzzle_readiness_changes() {
    let mut p = world();
    p.game.help_mode = HelpMode::Basic;
    let (mut s, _) = Session::start(p, None).unwrap();
    let before = lines(&help(&mut s, "help Keeper"));
    assert_eq!(
        before,
        [
            "Verbs for Keeper: examine, give, talk.",
            "Syntax: <verb> <entity> [to/on/in/with <target>]."
        ]
    );
    assert!(!before.iter().any(|line| line.contains("brass key")));
    s.command("take key").unwrap();
    assert_eq!(lines(&help(&mut s, "help Keeper")), before);
    let mut state = s.state().clone();
    state.objects.get_mut("key").unwrap().hidden = true;
    s.replace_state(state).unwrap();
    assert_eq!(lines(&help(&mut s, "help Keeper")), before);
}

#[test]
fn off_retains_general_help_and_basic_is_the_legacy_and_new_default() {
    let mut p = world();
    p.game.help_mode = HelpMode::Off;
    let (mut s, _) = Session::start(p, None).unwrap();
    assert_eq!(
        lines(&help(&mut s, "help missing")),
        ["Entity command help is disabled for this game."]
    );
    assert!(
        lines(&help(&mut s, "help"))
            .iter()
            .any(|line| line.contains("help [entity]"))
    );
    let blank = Project::blank("Defaults");
    assert_eq!(blank.game.help_mode, HelpMode::Basic);
    let mut legacy = serde_json::to_value(blank).unwrap();
    legacy["game"].as_object_mut().unwrap().remove("help_mode");
    legacy["game"]
        .as_object_mut()
        .unwrap()
        .remove("hints_enabled");
    legacy["locations"][0]
        .as_object_mut()
        .unwrap()
        .remove("hints");
    let p: Project = serde_json::from_value(legacy).unwrap();
    assert_eq!(p.game.help_mode, HelpMode::Basic);
    assert!(p.game.hints_enabled);
    assert!(p.locations[0].hints.is_empty());
}
