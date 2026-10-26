//! Immutable lookup tables and normalized patterns, built once per definition.
//!
//! Addresses point into the owned Project rather than borrowing from it. Ordered
//! vectors retain authoring order; hash maps are used only for keyed lookup.
use luna_model::{
    Action, EntityWords, Event, PatternPart, Project, Trigger, ValueTarget, normalize,
};
use std::collections::{HashMap, HashSet};

#[derive(Clone, Copy)]
pub(super) enum Owner {
    Game,
    Location(usize),
    Object(usize),
    Character(usize),
}

impl Owner {
    pub(super) fn id(self, p: &Project) -> &str {
        match self {
            Self::Game => &p.game.id,
            Self::Location(i) => &p.locations[i].id,
            Self::Object(i) => &p.objects[i].id,
            Self::Character(i) => &p.characters[i].id,
        }
    }

    pub(super) fn actions(self, p: &Project) -> &[Action] {
        match self {
            Self::Game => &p.game.actions,
            Self::Location(i) => &p.locations[i].actions,
            Self::Object(i) => &p.objects[i].actions,
            Self::Character(i) => &p.characters[i].actions,
        }
    }

    fn triggers(self, p: &Project) -> &[Trigger] {
        match self {
            Self::Game => &p.game.triggers,
            Self::Location(i) => &p.locations[i].triggers,
            Self::Object(i) => &p.objects[i].triggers,
            Self::Character(i) => &p.characters[i].triggers,
        }
    }

    pub(super) fn scope(self) -> u8 {
        match self {
            Self::Game => 0,
            Self::Location(_) => 1,
            Self::Object(_) | Self::Character(_) => 2,
        }
    }
}

pub(super) enum Part {
    Literal(Vec<String>),
    Entity(String),
    ObjectInput,
}

pub(super) struct Pattern {
    pub(super) parts: Vec<Part>,
    pub(super) specificity: (usize, usize),
}

impl Pattern {
    fn new(pattern: &[PatternPart]) -> Self {
        let mut specificity = (0, 0);
        let parts = pattern
            .iter()
            .map(|part| match part {
                PatternPart::Literal { text } => {
                    let words = words(&normalize(text));
                    specificity.0 += words.len();
                    Part::Literal(words)
                }
                PatternPart::Entity { entity } => {
                    specificity.1 += 1;
                    Part::Entity(entity.clone())
                }
                PatternPart::ObjectInput => {
                    specificity.1 += 1;
                    Part::ObjectInput
                }
            })
            .collect();
        Self { parts, specificity }
    }

    fn route(name: &str, entity_words: &EntityWords) -> Self {
        let words = words(&entity_words.name(name));
        Self {
            specificity: (words.len(), 0),
            parts: vec![Part::Literal(words)],
        }
    }
}

fn words(text: &str) -> Vec<String> {
    text.split_whitespace().map(str::to_owned).collect()
}

pub(super) struct Verb {
    pub(super) position: usize,
    pub(super) phrases: Vec<Vec<String>>,
    heads: Vec<String>,
}

pub(super) struct ActionEntry {
    pub(super) owner: Owner,
    pub(super) position: usize,
    pub(super) pattern: Pattern,
}

#[derive(Clone, Copy)]
pub(super) struct TriggerAddress {
    pub(super) owner: Owner,
    position: usize,
}

impl TriggerAddress {
    pub(super) fn trigger(self, project: &Project) -> &Trigger {
        &self.owner.triggers(project)[self.position]
    }
}

pub(crate) struct RuntimeIndex {
    pub(super) entity_words: EntityWords,
    pub(super) owners: Vec<Owner>,
    pub(super) entities: HashMap<String, Owner>,
    pub(super) names: HashMap<String, Vec<Vec<String>>>,
    pub(super) object_names: Option<ObjectNames>,
    pub(super) has_storage: bool,
    pub(super) verbs: HashMap<String, Verb>,
    pub(super) endings: HashMap<String, usize>,
    pub(super) exits: Vec<Vec<Vec<Pattern>>>,
    actions: Vec<ActionEntry>,
    all_actions: Vec<usize>,
    action_heads: HashMap<String, Vec<usize>>,
    events: Vec<(Event, Vec<TriggerAddress>)>,
    variable_watches: HashMap<String, Vec<TriggerAddress>>,
    property_watches: HashMap<String, HashMap<String, Vec<TriggerAddress>>>,
}

/// Prefix lookup is compiled only for games declaring item inputs. Matching a
/// slot walks the input words; it does not scan all objects or expand actions.
pub(super) struct ObjectNames {
    nodes: Vec<NounNode>,
}
#[derive(Default)]
struct NounNode {
    next: HashMap<String, usize>,
    objects: Vec<usize>,
}
impl Default for ObjectNames {
    fn default() -> Self {
        Self {
            nodes: vec![NounNode::default()],
        }
    }
}
impl ObjectNames {
    fn insert(&mut self, words: &[String], object: usize) {
        if words.is_empty() {
            return;
        }
        let mut index = 0;
        for word in words {
            index = if let Some(&next) = self.nodes[index].next.get(word) {
                next
            } else {
                let next = self.nodes.len();
                self.nodes.push(NounNode::default());
                self.nodes[index].next.insert(word.clone(), next);
                next
            };
        }
        // Objects are inserted consecutively, including all their aliases.
        // Duplicate spellings need only inspect the last ID.
        if self.nodes[index].objects.last() != Some(&object) {
            self.nodes[index].objects.push(object);
        }
    }
    pub(super) fn matches(&self, words: &[&str], start: usize) -> Vec<(usize, usize)> {
        let mut index = 0;
        let mut matches = vec![];
        for (offset, word) in words[start..].iter().enumerate() {
            let Some(&child) = self.nodes[index].next.get(*word) else {
                break;
            };
            index = child;
            matches.extend(
                self.nodes[index]
                    .objects
                    .iter()
                    .map(|&object| (start + offset + 1, object)),
            );
        }
        matches
    }
}

impl RuntimeIndex {
    pub(crate) fn new(project: &Project) -> Self {
        let entity_words = EntityWords::new(&project.game.ignored_words);
        let owners = std::iter::once(Owner::Game)
            .chain((0..project.locations.len()).map(Owner::Location))
            .chain((0..project.objects.len()).map(Owner::Object))
            .chain((0..project.characters.len()).map(Owner::Character))
            .collect::<Vec<_>>();
        let entities = owners
            .iter()
            .skip(1)
            .map(|owner| (owner.id(project).to_owned(), *owner))
            .collect();
        // Read names directly from their owners: Project::entity_aliases scans
        // entity lists and would make definition compilation quadratic.
        let names: HashMap<String, Vec<Vec<String>>> = project
            .locations
            .iter()
            .map(|e| (&e.id, &e.name, &e.aliases))
            .chain(project.objects.iter().map(|e| (&e.id, &e.name, &e.aliases)))
            .chain(
                project
                    .characters
                    .iter()
                    .map(|e| (&e.id, &e.name, &e.aliases)),
            )
            .map(|(id, name, aliases)| {
                (
                    id.clone(),
                    std::iter::once(name)
                        .chain(aliases)
                        .map(|name| words(&entity_words.name(name)))
                        .collect(),
                )
            })
            .collect();
        let object_names = project
            .owners()
            .iter()
            .any(|(_, actions, _)| {
                actions.iter().any(|a| {
                    a.pattern
                        .iter()
                        .any(|part| matches!(part, PatternPart::ObjectInput))
                })
            })
            .then(|| {
                let mut trie = ObjectNames::default();
                for (i, object) in project.objects.iter().enumerate() {
                    for words in &names[&object.id] {
                        trie.insert(words, i);
                    }
                }
                trie
            });
        let verbs: HashMap<_, _> = project
            .vocabulary
            .iter()
            .enumerate()
            .map(|(position, verb)| {
                let phrases = std::iter::once(&verb.canonical)
                    .chain(&verb.synonyms)
                    .map(|phrase| words(&normalize(phrase)))
                    .collect::<Vec<_>>();
                let heads = phrases
                    .iter()
                    .filter_map(|phrase| phrase.first())
                    .cloned()
                    .collect::<HashSet<_>>()
                    .into_iter()
                    .collect();
                (
                    verb.id.clone(),
                    Verb {
                        position,
                        phrases,
                        heads,
                    },
                )
            })
            .collect();
        let mut actions = vec![];
        let mut action_heads: HashMap<String, Vec<usize>> = HashMap::new();
        let mut events: Vec<(Event, Vec<TriggerAddress>)> = vec![];
        let mut variable_watches: HashMap<String, Vec<TriggerAddress>> = HashMap::new();
        let mut property_watches: HashMap<String, HashMap<String, Vec<TriggerAddress>>> =
            HashMap::new();
        for &owner in &owners {
            for (position, action) in owner.actions(project).iter().enumerate() {
                let index = actions.len();
                actions.push(ActionEntry {
                    owner,
                    position,
                    pattern: Pattern::new(&action.pattern),
                });
                // A verb can have several multiword phrases with the same head.
                // Each action must still be visited only once, in authored order.
                for head in &verbs[&action.verb].heads {
                    action_heads.entry(head.clone()).or_default().push(index);
                }
            }
            for (position, trigger) in owner.triggers(project).iter().enumerate() {
                let address = TriggerAddress { owner, position };
                match trigger.watch.as_ref().map(|watch| &watch.target) {
                    Some(ValueTarget::Variable { name }) => variable_watches
                        .entry(name.clone())
                        .or_default()
                        .push(address),
                    Some(ValueTarget::Property { entity, name }) => property_watches
                        .entry(entity.clone())
                        .or_default()
                        .entry(name.clone())
                        .or_default()
                        .push(address),
                    None => {
                        if let Some((_, addresses)) =
                            events.iter_mut().find(|(event, _)| *event == trigger.event)
                        {
                            addresses.push(address);
                        } else {
                            events.push((trigger.event, vec![address]));
                        }
                    }
                }
            }
        }
        let exits = project
            .locations
            .iter()
            .map(|location| {
                location
                    .exits
                    .iter()
                    .map(|exit| {
                        if exit.pattern.is_empty() {
                            std::iter::once(&exit.name)
                                .chain(&exit.aliases)
                                .map(|name| Pattern::route(name, &entity_words))
                                .collect()
                        } else {
                            vec![Pattern::new(&exit.pattern)]
                        }
                    })
                    .collect()
            })
            .collect();
        Self {
            entity_words,
            owners,
            entities,
            names,
            object_names,
            has_storage: project
                .objects
                .iter()
                .any(|o| o.storage.is_some_and(|s| !s.is_empty())),
            verbs,
            exits,
            endings: project
                .game
                .endings
                .iter()
                .enumerate()
                .map(|(i, e)| (e.id.clone(), i))
                .collect(),
            all_actions: (0..actions.len()).collect(),
            actions,
            action_heads,
            events,
            variable_watches,
            property_watches,
        }
    }

    pub(super) fn actions(&self, input: &str, explain: bool) -> impl Iterator<Item = &ActionEntry> {
        let indices = if explain {
            self.all_actions.as_slice()
        } else {
            input
                .split_whitespace()
                .next()
                .and_then(|head| self.action_heads.get(head))
                .map_or(&[][..], Vec::as_slice)
        };
        indices.iter().map(|&i| &self.actions[i])
    }

    pub(super) fn events(&self, event: Event) -> &[TriggerAddress] {
        self.events
            .iter()
            .find(|(key, _)| *key == event)
            .map_or(&[], |(_, addresses)| addresses)
    }

    pub(super) fn watchers(&self, target: &ValueTarget) -> &[TriggerAddress] {
        match target {
            ValueTarget::Variable { name } => self.variable_watches.get(name),
            ValueTarget::Property { entity, name } => self
                .property_watches
                .get(entity)
                .and_then(|properties| properties.get(name)),
        }
        .map_or(&[], Vec::as_slice)
    }
}
