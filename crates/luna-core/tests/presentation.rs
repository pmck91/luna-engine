use luna_core::Session;
use luna_model::*;

fn plain(messages: &[Vec<text::Span>]) -> Vec<String> {
    messages.iter().map(|line| text::plain(line)).collect()
}

#[test]
fn resuming_an_active_game_formats_current_values_without_replaying_entry() {
    let mut project = Project::blank("Score <green>%score%</green> %%");
    project.game.variables = [
        ("score".into(), Value::Integer(3)),
        ("entries".into(), Value::Integer(0)),
    ]
    .into();
    project.game.opening_text = "Opening text only runs at the beginning.".into();
    let room = &mut project.locations[0];
    room.id = "room".into();
    room.actions = vec![description_action(&room.id)];
    project.game.starting_location = room.id.clone();
    room.state.insert("health".into(), Value::Integer(10));
    room.description = "Score: %score%. Room health: %room.health%.".into();
    room.triggers.push(Trigger {
        id: "entry-counter".into(),
        event: Event::Enter,
        effects: vec![Effect::UpdateVariable {
            name: "entries".into(),
            op: ArithmeticOperation::Add,
            operand: NumericOperand::Literal { value: 1 },
        }],
        ..Default::default()
    });
    let (mut session, _) = Session::start(project, None).unwrap();
    // These are saved current values, deliberately different from the definition's defaults.
    session
        .state
        .variables
        .insert("score".into(), Value::Integer(7));
    session
        .state
        .properties
        .get_mut("room")
        .unwrap()
        .insert("health".into(), Value::Integer(4));
    let session =
        Session::restore_with_definition(session.definition().clone(), session.state).unwrap();
    let before = session.state.clone();
    let messages = session.resume_messages().unwrap();
    assert_eq!(
        plain(&messages),
        [
            "Score 7 %",
            "Starting location",
            "Score: 7. Room health: 4."
        ]
    );
    assert!(
        messages[0]
            .iter()
            .any(|span| span.text == "7" && span.colour.as_deref() == Some("green"))
    );
    assert_eq!(session.state.variables["entries"], Value::Integer(1));
    assert_eq!(session.state.visits["room"], 1);
    assert_eq!(session.state, before);
    assert_eq!(session.resume_messages().unwrap(), messages);
}

#[test]
fn completed_resume_matches_live_presentation_and_keeps_substituted_text_literal() {
    let mut project = Project::blank("A completed story: %score%");
    project.game.variables = [
        ("score".into(), Value::Integer(3)),
        (
            "label".into(),
            Value::Text("<red>literal</red> & %score%".into()),
        ),
    ]
    .into();
    project.game.endings.push(Ending {
        id: "finish".into(),
        name: "Finish".into(),
        text: "<cyan>%label%</cyan> earned <green>%score%</green>.".into(),
        outcome: Some(Outcome::Victory),
    });
    project.game.actions.push(Action {
        id: "finish-action".into(),
        verb: "use".into(),
        pattern: vec![PatternPart::Literal {
            text: "finish".into(),
        }],
        effects: vec![Effect::End {
            ending: "finish".into(),
        }],
        ..Default::default()
    });
    project.game.triggers.push(Trigger {
        id: "finalizer".into(),
        event: Event::Ending,
        effects: vec![
            Effect::UpdateVariable {
                name: "score".into(),
                op: ArithmeticOperation::Add,
                operand: NumericOperand::Literal { value: 1 },
            },
            Effect::Say {
                text: "Finalizer only runs once.".into(),
            },
        ],
        ..Default::default()
    });
    let (mut session, _) = Session::start(project, None).unwrap();
    let live = session.command("use finish").unwrap();
    let session =
        Session::restore_with_definition(session.definition().clone(), session.state).unwrap();
    let before = session.state.clone();
    let resumed = session.resume_messages().unwrap();
    assert_eq!(
        plain(&resumed),
        [
            "A completed story: 4",
            "<red>literal</red> & %score% earned 4.",
            "Outcome: Victory",
        ]
    );
    assert_eq!(resumed[1..], live.messages[1..]);
    assert!(
        resumed[1]
            .iter()
            .any(|span| span.text == "<red>literal</red> & %score%"
                && span.colour.as_deref() == Some("cyan"))
    );
    assert_eq!(session.state, before);
    assert_eq!(session.resume_messages().unwrap(), resumed);
}
