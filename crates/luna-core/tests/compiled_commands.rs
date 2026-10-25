use luna_core::{CommandStatus, GameDefinition, Session, TraceKind};
use luna_model::*;

fn world() -> Project {
    let mut p = Project::blank("Compiled command semantics");
    p.game.starting_location = "room".into();
    p.locations[0].id = "room".into();
    p.locations[0].actions.clear();
    p.locations.push(Location {
        id: "remote".into(),
        name: "Remote".into(),
        ..Default::default()
    });
    p.game.help_mode = HelpMode::Full;
    p.vocabulary.push(Verb {
        id: "peer".into(),
        canonical: "Peer At".into(),
        synonyms: vec!["peer toward".into(), "inspect closely".into()],
        event: None,
    });
    let action = |id: &str, entity: &str| Action {
        id: id.into(),
        name: id.into(),
        verb: "peer".into(),
        pattern: vec![PatternPart::Entity {
            entity: entity.into(),
        }],
        effects: vec![Effect::PrintDescription {
            entity: entity.into(),
        }],
        ..Default::default()
    };
    p.objects = vec![
        Object {
            id: "token".into(),
            name: "The Brass Token".into(),
            aliases: vec!["old coin".into(), "the the".into()],
            description: "A shining token.".into(),
            placement: Placement::Location {
                location: "room".into(),
            },
            actions: vec![action("peer-token", "token")],
            ..Default::default()
        },
        Object {
            id: "remote-token".into(),
            name: "Remote Token".into(),
            placement: Placement::Location {
                location: "remote".into(),
            },
            actions: vec![action("remote-peer", "remote-token")],
            ..Default::default()
        },
    ];
    p.game.actions.push(Action {
        id: "unrelated".into(),
        name: "Unrelated".into(),
        verb: "use".into(),
        pattern: vec![PatternPart::Literal {
            text: "other".into(),
        }],
        ..Default::default()
    });
    p
}

#[test]
fn multiword_verbs_aliases_and_prefixes_match_once_with_identical_explained_execution() {
    let (mut session, _) = Session::start(world(), None).unwrap();
    for command in [
        "PEER, AT the brass TOKEN!",
        "peer toward the old coin",
        "inspect closely old coin",
        "peer at the the",
    ] {
        let mut explained =
            Session::restore_with_definition(session.definition().clone(), session.state().clone())
                .unwrap();
        let result = session.command(command).unwrap();
        assert_eq!(result.status, CommandStatus::Ok, "{command}");
        assert_eq!(result.selected_flow.as_deref(), Some("peer-token"));
        assert_eq!(text::plain(&result.messages[0]), "A shining token.");
        let mut observed = explained.command_explained(command);
        let explanation = observed.explanation.take().unwrap();
        assert_eq!(
            serde_json::to_value(result).unwrap(),
            serde_json::to_value(observed).unwrap()
        );
        assert_eq!(session.state(), explained.state());
        let candidates = explanation
            .steps
            .iter()
            .filter_map(|step| match &step.kind {
                TraceKind::Candidate { matched, .. } => {
                    Some((step.source.as_ref().unwrap().subject.as_str(), *matched))
                }
                _ => None,
            })
            .collect::<Vec<_>>();
        assert_eq!(
            candidates,
            [
                ("unrelated", false),
                ("peer-token", true),
                ("remote-peer", false)
            ]
        );
    }
    for command in [
        "peer towarder old coin",
        "peer at old coin extra",
        "peer at remote token",
    ] {
        assert_eq!(
            session.command(command).unwrap().status,
            CommandStatus::Unmatched,
            "{command}"
        );
    }
    let help = session.command("help old coin").unwrap();
    assert!(
        help.messages
            .iter()
            .any(|line| text::plain(line) == "  Peer At The Brass Token")
    );
}

#[test]
fn rebuilt_definitions_refresh_normalized_names_and_ties_stay_ordered_by_stable_id() {
    let definition = GameDefinition::new(world()).unwrap();
    let (old, _) = Session::start_with_definition(definition.clone(), None).unwrap();
    let mut changed = definition.project().clone();
    changed.objects[0].aliases = vec!["new coin".into()];
    changed.vocabulary.last_mut().unwrap().synonyms = vec!["gaze toward".into()];
    let mut tie = changed.objects[0].actions[0].clone();
    tie.id = "a-tied".into();
    changed.objects[0].actions.push(tie);
    for reverse in [false, true] {
        if reverse {
            changed.objects[0].actions.reverse();
        }
        let mut session = Session::restore(changed.clone(), old.state().clone()).unwrap();
        assert_eq!(
            session.command("peer toward old coin").unwrap().status,
            CommandStatus::Unmatched
        );
        let result = session.command("gaze toward new coin").unwrap();
        assert_eq!(result.status, CommandStatus::Ambiguous);
        assert!(result.trace[0].contains("[a-tied]"));
        assert!(result.trace[1].contains("[peer-token]"));
        assert_eq!(session.state(), old.state());
    }
    let mut old = old;
    assert_eq!(
        old.command("peer toward old coin").unwrap().status,
        CommandStatus::Ok
    );
}

#[test]
fn entry_dispatch_keeps_initial_membership_scope_priority_and_live_conditions() {
    let mut p = Project::blank("Entry ordering");
    let start = p.game.starting_location.clone();
    p.game.variables.insert("ready".into(), Value::Bool(false));
    let say = |text: &str| Effect::Say { text: text.into() };
    let trigger = |id: &str, priority| Trigger {
        id: id.into(),
        event: Event::Enter,
        priority,
        effects: vec![say(id)],
        ..Default::default()
    };
    let mut room_trigger = trigger("garden-enter", -1000);
    room_trigger.effects.extend([
        Effect::Remove {
            object: "old".into(),
        },
        Effect::Place {
            object: "added".into(),
            location: "garden".into(),
        },
        Effect::SetVariable {
            name: "ready".into(),
            value: Value::Bool(true),
        },
    ]);
    p.locations.push(Location {
        id: "garden".into(),
        name: "Garden".into(),
        triggers: vec![room_trigger],
        ..Default::default()
    });
    p.game.triggers.push(trigger("global-enter", 1000));
    p.game.actions.push(Action {
        id: "travel".into(),
        verb: "use".into(),
        pattern: vec![PatternPart::Literal {
            text: "travel".into(),
        }],
        effects: vec![Effect::Move {
            location: "garden".into(),
        }],
        ..Default::default()
    });
    for (id, room, handler) in [
        ("old", "garden", "z-member"),
        ("conditional", "garden", "b-conditional"),
        ("added", start.as_str(), "c-new-member"),
    ] {
        let mut t = trigger(handler, 10);
        if id == "conditional" {
            t.condition = Condition::Exists {
                object: "old".into(),
            };
        }
        p.objects.push(Object {
            id: id.into(),
            name: id.into(),
            placement: Placement::Location {
                location: room.into(),
            },
            triggers: vec![t],
            ..Default::default()
        });
    }
    let mut character = trigger("a-character", 10);
    character.condition = Condition::Variable {
        name: "ready".into(),
        op: Comparison::Eq,
        value: Value::Bool(true),
    };
    p.characters.push(Character {
        id: "keeper".into(),
        name: "Keeper".into(),
        location: "garden".into(),
        triggers: vec![character],
        ..Default::default()
    });
    let (mut session, _) = Session::start(p, None).unwrap();
    let result = session.command_explained("use travel");
    assert_eq!(result.status, CommandStatus::Ok);
    let lines = result
        .messages
        .iter()
        .map(|line| text::plain(line))
        .collect::<Vec<_>>();
    assert_eq!(
        &lines[..4],
        ["garden-enter", "a-character", "z-member", "global-enter"]
    );
    assert!(
        !lines
            .iter()
            .any(|line| line == "b-conditional" || line == "c-new-member")
    );
    let fired = result
        .explanation
        .unwrap()
        .steps
        .into_iter()
        .filter_map(|step| {
            matches!(step.kind, TraceKind::Trigger { fired: true, .. })
                .then(|| step.source.unwrap().subject)
        })
        .collect::<Vec<_>>();
    assert_eq!(
        fired,
        ["garden-enter", "a-character", "z-member", "global-enter"]
    );
}
