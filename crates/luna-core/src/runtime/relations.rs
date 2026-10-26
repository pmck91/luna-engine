//! Shared, cycle-safe object ancestry, possession, access, and atomic transfers.
//!
//! Flat objects retain the direct-placement path. Nested ancestry is memoized only
//! within the current attempted command/view and invalidated on world mutations.
use super::{Run, index::Owner};
use anyhow::{Context, Result, ensure};
use luna_model::{ContainerOpening, ContentRelation, Event, ObjectState, ObjectTarget, Placement};

#[derive(Clone, Copy, PartialEq, Eq)]
pub(super) enum Root {
    Room(usize),
    Player,
    Character(usize),
    Absent,
}
#[derive(Clone, Copy)]
pub(super) struct Relation {
    pub root: Root,
    pub alive: bool,
    pub accessible: bool,
}

impl<'a> Run<'a> {
    pub(super) fn object_target<'b>(&'b self, target: &'b ObjectTarget) -> Option<&'b str> {
        match target {
            ObjectTarget::Fixed(id) => Some(id),
            ObjectTarget::Input { .. } => self.item_input,
        }
    }
    fn direct_relation(&self, index: usize) -> Option<Relation> {
        let object = self.state.objects.get(&self.p.objects[index].id)?;
        let root = match &object.placement {
            Placement::Inventory => Root::Player,
            Placement::Location { location } => match self.index.entities.get(location) {
                Some(Owner::Location(i)) => Root::Room(*i),
                _ => Root::Absent,
            },
            Placement::Character { character } => match self.index.entities.get(character) {
                Some(Owner::Character(i)) => Root::Character(*i),
                _ => Root::Absent,
            },
            Placement::Absent => Root::Absent,
            Placement::Inside { .. } | Placement::On { .. } => return None,
        };
        let alive = object.exists && !object.consumed && root != Root::Absent;
        Some(Relation {
            root,
            alive,
            accessible: alive && !object.hidden,
        })
    }
    pub(super) fn object_relation(&self, id: &str) -> Relation {
        let absent = Relation {
            root: Root::Absent,
            alive: false,
            accessible: false,
        };
        let Some(Owner::Object(index)) = self.index.entities.get(id) else {
            return absent;
        };
        if let Some(direct) = self.direct_relation(*index) {
            return direct;
        }
        if let Some(cached) = self.relations.borrow().get(index) {
            return *cached;
        }
        let mut path = vec![];
        let mut current = *index;
        let mut base = loop {
            if let Some(cached) = self.relations.borrow().get(&current) {
                break *cached;
            }
            if let Some(direct) = self.direct_relation(current) {
                break direct;
            }
            if path.len() >= self.p.objects.len() {
                return absent;
            }
            let Some(state) = self.state.objects.get(&self.p.objects[current].id) else {
                return absent;
            };
            let Some((parent, relation)) = state.placement.parent_object() else {
                return absent;
            };
            let Some(Owner::Object(parent_index)) = self.index.entities.get(parent) else {
                return absent;
            };
            let parent_open = self.state.objects.get(parent).is_some_and(|s| s.open);
            path.push((current, relation != ContentRelation::Inside || parent_open));
            current = *parent_index;
        };
        let mut cache = self.relations.borrow_mut();
        for (index, passage) in path.into_iter().rev() {
            let state = &self.state.objects[&self.p.objects[index].id];
            base = Relation {
                root: base.root,
                alive: base.alive && state.exists && !state.consumed,
                accessible: base.accessible
                    && passage
                    && state.exists
                    && !state.consumed
                    && !state.hidden,
            };
            cache.insert(index, base);
        }
        base
    }
    pub(super) fn object_available(&self, id: &str) -> bool {
        self.state
            .objects
            .get(id)
            .is_some_and(|state| self.object_available_state(id, state))
    }
    pub(super) fn object_available_state(&self, id: &str, state: &ObjectState) -> bool {
        // Preserve the original single state lookup for the common flat case.
        // Only nested objects need indexed ancestry and its per-attempt cache.
        if !state.exists || state.consumed || state.hidden {
            return false;
        }
        match &state.placement {
            Placement::Inventory => return true,
            Placement::Location { location } => return location == &self.state.location,
            Placement::Character { .. } | Placement::Absent => return false,
            Placement::Inside { .. } | Placement::On { .. } => {}
        }
        let relation = self.object_relation(id);
        relation.accessible
            && match relation.root {
                Root::Player => true,
                Root::Room(i) => self.p.locations[i].id == self.state.location,
                Root::Character(_) | Root::Absent => false,
            }
    }
    pub(super) fn possesses(&self, id: &str, character: Option<&str>) -> bool {
        let relation = self.object_relation(id);
        relation.alive
            && match (relation.root, character) {
                (Root::Player, None) => true,
                (Root::Character(i), Some(id)) => self.p.characters[i].id == id,
                _ => false,
            }
    }
    fn valid_transfer(&self, id: &str, placement: &Placement) -> Result<()> {
        ensure!(
            matches!(self.index.entities.get(id), Some(Owner::Object(_))),
            "Unknown transfer object"
        );
        match placement {
            Placement::Inventory => {}
            Placement::Absent => anyhow::bail!("Use REMOVE to park an object offstage"),
            Placement::Location { location } => ensure!(
                location == "@current" || self.location(location).is_some(),
                "Unknown object destination"
            ),
            Placement::Character { character } => ensure!(
                self.character(character).is_some(),
                "Unknown character inventory"
            ),
            Placement::Inside { object } | Placement::On { object } => {
                let Some(Owner::Object(parent)) = self.index.entities.get(object) else {
                    anyhow::bail!("Unknown object holder")
                };
                let storage = self.p.objects[*parent].storage.unwrap_or_default();
                ensure!(
                    if matches!(placement, Placement::Inside { .. }) {
                        storage.container.is_some()
                    } else {
                        storage.surface
                    },
                    "Holder does not support this placement"
                );
                let mut current = object.as_str();
                for _ in 0..=self.state.objects.len() {
                    ensure!(
                        current != id,
                        "An object cannot be placed inside/on itself or its descendant"
                    );
                    let state = self
                        .state
                        .objects
                        .get(current)
                        .context("Unknown object holder")?;
                    ensure!(
                        !state.consumed,
                        "Cannot place an item in/on a consumed holder"
                    );
                    let Some((parent, _)) = state.placement.parent_object() else {
                        return Ok(());
                    };
                    current = parent;
                }
                anyhow::bail!("Object placement forms a cycle");
            }
        }
        Ok(())
    }
    pub(super) fn can_transfer(&self, id: &str, placement: &Placement) -> bool {
        let Some(Owner::Object(index)) = self.index.entities.get(id) else {
            return false;
        };
        if !self.p.objects[*index].portable
            || !self.object_available(id)
            || self.valid_transfer(id, placement).is_err()
        {
            return false;
        }
        if self.state.objects[id].placement == *placement {
            return false;
        }
        match placement {
            Placement::Inventory => true,
            Placement::Location { location } => {
                self.possesses(id, None)
                    && (location == "@current" || location == &self.state.location)
            }
            Placement::Character { character } => {
                self.possesses(id, None) && self.available(character)
            }
            Placement::Inside { object } => {
                self.possesses(id, None)
                    && self.object_available(object)
                    && self.state.objects[object].open
            }
            Placement::On { object } => self.possesses(id, None) && self.object_available(object),
            Placement::Absent => false,
        }
    }
    pub(super) fn transfer(&mut self, id: &str, placement: Placement) -> Result<()> {
        self.valid_transfer(id, &placement)?;
        let before = self.object_relation(id);
        let placement = match placement {
            Placement::Location { location } if location == "@current" => Placement::Location {
                location: self.state.location.clone(),
            },
            other => other,
        };
        let state = self
            .world_mut()
            .objects
            .get_mut(id)
            .context("Unknown object")?;
        state.placement = placement;
        state.exists = true;
        state.consumed = false;
        let after = self.object_relation(id);
        if before.root != Root::Player && after.root == Root::Player {
            self.fire_mutation(Event::Take, id)?;
        } else if before.root == Root::Player && after.root != Root::Player {
            self.fire_mutation(Event::Drop, id)?;
        }
        Ok(())
    }
    pub(super) fn fire_mutation(&mut self, event: Event, id: &str) -> Result<()> {
        self.mutation_events.push((event, id.to_owned()));
        self.fire(event, id)
    }
    pub(super) fn ensure_can_close(&self, id: &str) -> Result<()> {
        if let Some(Owner::Object(index)) = self.index.entities.get(id) {
            ensure!(
                self.p.objects[*index].storage.unwrap_or_default().container
                    != Some(ContainerOpening::AlwaysOpen),
                "An always-open container cannot be closed"
            );
        }
        Ok(())
    }
}
