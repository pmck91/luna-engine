//! C0 feasibility experiment for a single typed item input on a standard action.
//!
//! This module is compiled only in tests. It calls the real compiled matcher,
//! requirement evaluator, and effect executor; it is not a second text parser.
//! The deliberately simple probe enumerates in-scope objects transiently. It does
//! not create authored actions or claim production matching performance. C1 must
//! integrate captured input into the existing matching walk and relationship scope.
//! Container placement, player transfer rules, saved state, and public contracts
//! are deliberately absent until the UX and representation have been reviewed.
use super::{Part, Pattern, Run};
use crate::{CommandStatus, GameDefinition};
use luna_model::{
    Action, ArithmeticOperation, Condition, Effect, NumericOperand, Object, PatternPart, Placement,
    Project, Value, Verb, normalize, text,
};

#[derive(Clone, Copy)]
enum Kind {
    Open,
    PutInside,
    PutOn,
    TakeFrom,
}

struct Standard<'a> {
    owner: &'a str,
    kind: Kind,
}

#[derive(Debug, PartialEq)]
struct Binding<'a> {
    owner: &'a str,
    item: Option<&'a str>,
}

// Fixed object IDs and a command input are different types of reference. A game
// variable named "item" cannot accidentally substitute for this input.
enum ObjectRef<'a> {
    Fixed(&'a str),
    CommandItem,
}

impl ObjectRef<'_> {
    fn resolve<'a>(&'a self, binding: &'a Binding<'_>) -> Option<&'a str> {
        match self {
            Self::Fixed(id) => Some(id),
            Self::CommandItem => binding.item,
        }
    }
}

impl Standard<'_> {
    fn bindings<'a>(&self, run: &'a Run<'_>, input: &str) -> Vec<Binding<'a>> {
        let input = normalize(input);
        let tokens = input.split_whitespace().collect::<Vec<_>>();
        if !run.available(self.owner) {
            return vec![];
        }
        let owner = run.p.objects.iter().find(|o| o.id == self.owner).unwrap();
        if matches!(self.kind, Kind::Open) {
            let pattern = Pattern {
                parts: vec![Part::Entity(owner.id.clone())],
                specificity: (0, 1),
            };
            return run
                .matches(&tokens, "open", &pattern, None, false)
                .then_some(Binding {
                    owner: &owner.id,
                    item: None,
                })
                .into_iter()
                .collect();
        }
        let (verb, relation) = match self.kind {
            Kind::PutInside => ("put", "in"),
            Kind::PutOn => ("put", "on"),
            Kind::TakeFrom => ("take", "from"),
            Kind::Open => unreachable!(),
        };
        let mut matches = run
            .p
            .objects
            .iter()
            .filter(|item| run.available(&item.id))
            .filter(|item| {
                // This ephemeral Pattern exercises Luna's actual aliases,
                // ignored words, verb normalization, and whole-input matching.
                // No Action is inserted into the project/index for this pair.
                let pattern = Pattern {
                    parts: vec![
                        Part::Entity(item.id.clone()),
                        Part::Literal(vec![relation.into()]),
                        Part::Entity(owner.id.clone()),
                    ],
                    specificity: (1, 2),
                };
                run.matches(&tokens, verb, &pattern, None, false)
            })
            .map(|item| Binding {
                owner: &owner.id,
                item: Some(item.id.as_str()),
            })
            .collect::<Vec<_>>();
        matches.sort_by_key(|binding| binding.item);
        matches
    }
}

fn increment(owner: &str) -> Effect {
    Effect::UpdateProperty {
        entity: owner.into(),
        name: "proof_runs".into(),
        op: ArithmeticOperation::Add,
        operand: NumericOperand::Literal { value: 1 },
    }
}

fn attempt(run: &mut Run<'_>, standard: &Standard<'_>, input: &str) {
    // Prototype fallback policy: choose authored candidates first, without
    // evaluating requirements to decide whether a fallback should be tried.
    if !run.candidates(&normalize(input), None).unwrap().is_empty() {
        run.command(input).unwrap();
        return;
    }
    let bindings = standard.bindings(run, input);
    let owner = match bindings.as_slice() {
        [binding] => binding.owner.to_owned(),
        [] => {
            run.result.status = CommandStatus::Unmatched;
            return;
        }
        _ => {
            run.result.status = CommandStatus::Ambiguous;
            return;
        }
    };
    if !run.condition(&Condition::Property {
        entity: owner.clone(),
        name: "locked".into(),
        op: luna_model::Comparison::Eq,
        value: Value::Bool(false),
    }) {
        run.result.status = CommandStatus::RequirementsFailed;
        run.say("The chest is locked.").unwrap();
        return;
    }
    run.effects_at(&[increment(&owner)], None).unwrap();
}

fn world() -> Project {
    let mut p = Project::blank("C0 binding proof");
    p.locations[0].actions.clear();
    p.game
        .variables
        .insert("item".into(), Value::Text("not an object reference".into()));
    p.vocabulary.push(Verb {
        id: "put".into(),
        canonical: "put".into(),
        synonyms: vec!["place carefully".into()],
        event: None,
    });
    let mut chest = Object {
        id: "chest".into(),
        name: "Wooden chest".into(),
        aliases: vec!["chest".into()],
        placement: Placement::Location {
            location: p.locations[0].id.clone(),
        },
        ..Default::default()
    };
    chest.state.insert("proof_runs".into(), Value::Integer(0));
    chest.state.insert("locked".into(), Value::Bool(false));
    p.objects = vec![chest];
    for (id, name, alias) in [
        ("key", "Brass key", "key"),
        ("letter", "Letter", "note"),
        ("secret", "Secret token", "secret"),
    ] {
        p.objects.push(Object {
            id: id.into(),
            name: name.into(),
            aliases: vec![alias.into()],
            placement: Placement::Inventory,
            portable: true,
            hidden: id == "secret",
            ..Default::default()
        });
    }
    p
}

#[test]
fn one_definition_binds_distinct_items_using_the_existing_matcher() {
    let definition = GameDefinition::new(world()).unwrap();
    let run = Run::new(&definition, definition.initial_state(None).unwrap());
    for (kind, input, expected) in [
        (
            Kind::PutInside,
            "PLACE CAREFULLY the brass key in the chest!",
            "key",
        ),
        (Kind::PutInside, "put the note in wooden chest", "letter"),
        (Kind::PutOn, "put letter on chest", "letter"),
        (Kind::TakeFrom, "pick up key from the chest", "key"),
    ] {
        let standard = Standard {
            owner: "chest",
            kind,
        };
        assert_eq!(
            standard.bindings(&run, input),
            vec![Binding {
                owner: "chest",
                item: Some(expected)
            }]
        );
    }
    let binding = Binding {
        owner: "chest",
        item: Some("key"),
    };
    assert_eq!(ObjectRef::CommandItem.resolve(&binding), Some("key"));
    assert_eq!(ObjectRef::Fixed("letter").resolve(&binding), Some("letter"));
    assert_eq!(
        ObjectRef::CommandItem.resolve(&Binding {
            owner: "chest",
            item: None
        }),
        None
    );
}

#[test]
fn unavailable_names_and_extra_input_do_not_produce_a_binding() {
    let definition = GameDefinition::new(world()).unwrap();
    let run = Run::new(&definition, definition.initial_state(None).unwrap());
    let standard = Standard {
        owner: "chest",
        kind: Kind::PutInside,
    };
    for input in [
        "put secret in chest",
        "put key in chest extra",
        "put key on chest",
    ] {
        assert!(standard.bindings(&run, input).is_empty(), "{input}");
    }
    let mut state = run.state.clone().into_owned();
    state.objects.get_mut("chest").unwrap().hidden = true;
    let run = Run::new(&definition, state);
    assert!(standard.bindings(&run, "put key in chest").is_empty());
}

#[test]
fn ambiguous_aliases_leave_state_and_output_unchanged() {
    let mut p = world();
    let mut silver = p.objects[1].clone();
    silver.id = "silver-key".into();
    silver.name = "Silver key".into();
    p.objects.push(silver);
    let definition = GameDefinition::new(p).unwrap();
    let initial = definition.initial_state(None).unwrap();
    let mut run = Run::new(&definition, initial.clone());
    let standard = Standard {
        owner: "chest",
        kind: Kind::PutInside,
    };
    let bindings = standard.bindings(&run, "put key in chest");
    assert_eq!(
        bindings
            .iter()
            .map(|binding| binding.item)
            .collect::<Vec<_>>(),
        vec![Some("key"), Some("silver-key")]
    );
    attempt(&mut run, &standard, "put key in chest");
    assert_eq!(run.result.status, CommandStatus::Ambiguous);
    assert_eq!(*run.state, initial);
    assert!(run.result.messages.is_empty());
}

#[test]
fn custom_requirements_never_fall_through_to_a_standard_handler() {
    let mut p = world();
    p.objects[0].actions.push(Action {
        id: "custom-open".into(),
        name: "Custom open".into(),
        verb: "open".into(),
        pattern: vec![PatternPart::Entity {
            entity: "chest".into(),
        }],
        requirements: Condition::False,
        failure_text: "Find the combination first.".into(),
        effects: vec![increment("chest")],
        ..Default::default()
    });
    let standard = Standard {
        owner: "chest",
        kind: Kind::Open,
    };
    for allowed in [false, true] {
        p.objects[0].actions[0].requirements = if allowed {
            Condition::True
        } else {
            Condition::False
        };
        let definition = GameDefinition::new(p.clone()).unwrap();
        let mut run = Run::new(&definition, definition.initial_state(None).unwrap());
        attempt(&mut run, &standard, "open chest");
        assert_eq!(run.result.selected_flow.as_deref(), Some("custom-open"));
        assert_eq!(
            run.state.properties["chest"]["proof_runs"],
            Value::Integer(i32::from(allowed))
        );
        if !allowed {
            assert_eq!(run.result.status, CommandStatus::RequirementsFailed);
            assert_eq!(
                text::plain(&run.result.messages[0]),
                "Find the combination first."
            );
        }
    }
}

#[test]
fn standard_requirement_failure_and_success_run_effects_zero_or_once() {
    let standard = Standard {
        owner: "chest",
        kind: Kind::Open,
    };
    for locked in [true, false] {
        let mut p = world();
        p.objects[0]
            .state
            .insert("locked".into(), Value::Bool(locked));
        let definition = GameDefinition::new(p).unwrap();
        let initial = definition.initial_state(None).unwrap();
        let mut run = Run::new(&definition, initial.clone());
        attempt(&mut run, &standard, "open chest");
        assert_eq!(
            run.state.properties["chest"]["proof_runs"],
            Value::Integer(i32::from(!locked))
        );
        if locked {
            assert_eq!(*run.state, initial);
            assert_eq!(run.result.status, CommandStatus::RequirementsFailed);
        }
    }
}

#[test]
fn many_items_do_not_expand_the_authored_action_registry() {
    let mut p = world();
    for n in 0..1000 {
        p.objects.push(Object {
            id: format!("extra-{n}"),
            name: format!("Extra item {n}"),
            placement: Placement::Inventory,
            ..Default::default()
        });
    }
    let definition = GameDefinition::new(p).unwrap();
    let run = Run::new(&definition, definition.initial_state(None).unwrap());
    let standard = Standard {
        owner: "chest",
        kind: Kind::PutInside,
    };
    assert_eq!(standard.bindings(&run, "put key in chest").len(), 1);
    assert!(
        definition
            .project()
            .owners()
            .iter()
            .all(|(_, actions, _)| actions.is_empty())
    );
}
