//! Built-in controls and authored command dispatch within one transaction.
use super::{Flow, Run, matching::Handler};
use crate::{CommandStatus, HostControl, TraceKind};
use anyhow::{Result, ensure};
use luna_model::{Event, normalize, reserved};

impl<'a> Run<'a> {
    pub(crate) fn command(&mut self, input: &str) -> Result<()> {
        let normalized = normalize(input);
        if self.recording.is_some() && (normalized.is_empty() || reserved(input)) {
            self.observe(
                TraceKind::Notice {
                    text: "Built-in control; authored command effects are not dispatched.".into(),
                },
                None,
            );
        }
        if normalized.is_empty() {
            return Ok(());
        }
        if let Some(control) = host_control(input) {
            self.result.control = Some(control);
            self.result.status = CommandStatus::Control;
            return Ok(());
        }
        if let Some(query) = normalized.strip_prefix("help ") {
            ensure!(input.len() <= 4096, "Command is too long");
            return self.entity_help(query);
        }
        if let Some(query) = normalized.strip_prefix("hint ") {
            ensure!(input.len() <= 4096, "Command is too long");
            return self.entity_hint(Some(query));
        }
        match normalized.as_str() {
            "hint" => return self.entity_hint(None),
            "look" => return self.look(),
            "inventory" => {
                self.inventory();
                return Ok(());
            }
            "help" => return self.general_help(),
            _ => {}
        }
        if self.state.ending.is_some() {
            self.literal("This playthrough has ended. You can look, inspect your inventory, save, load, or quit.");
            self.result.status = CommandStatus::Ended;
            return Ok(());
        }
        ensure!(input.len() <= 4096, "Command is too long");
        let mut recorder = self.recording.take();
        let matches = self.candidates(&normalized, recorder.as_mut());
        self.recording = recorder;
        let matches = matches?;
        for m in &matches {
            self.result
                .trace
                .push(format!("Candidate '{}' [{}]: literal specificity {}, bound targets {}, scope {}, priority {}", m.name,m.id,m.rank.0,m.rank.1,match m.rank.2 { 2 => "object/character", 1 => "location", _ => "global" },m.rank.3))
        }
        let Some(best) = matches.first().copied() else {
            self.result.status = CommandStatus::Unmatched;
            return self.say(&self.p.game.unknown_command_text);
        };
        let tied = matches
            .iter()
            .filter(|m| m.rank == best.rank && m.fallback == best.fallback)
            .collect::<Vec<_>>();
        if tied.len() > 1 {
            self.result.status = CommandStatus::Ambiguous;
            self.literal(&format!("Please clarify your command: {}. Type a more specific command; nothing has changed.",tied.iter().map(|m| match m.item { Some(id) => format!("{} ({})", m.name, self.entity_name(id).unwrap_or(id)), None => m.name.to_owned() }).collect::<Vec<_>>().join(" or ")));
            return Ok(());
        }
        self.result.trace.push(format!(
            "Selected '{}' [{}] for normalized command '{normalized}'",
            best.name, best.id
        ));
        self.result.selected_flow = Some(best.id.to_owned());
        self.item_input = best.item;
        if let Some(item) = best.item {
            self.observe(
                TraceKind::Notice {
                    text: format!(
                        "Command item: {} [{item}]",
                        self.entity_name(item).unwrap_or(item)
                    ),
                },
                self.source_for(best.id, "pattern"),
            );
        }
        self.observe(
            TraceKind::Selected {
                name: best.name.to_owned(),
            },
            self.source_for(best.id, ""),
        );
        match best.handler {
            Handler::Action(action) => {
                if !self.checked_condition(
                    &action.requirements,
                    self.source_for(&action.id, "requirements"),
                    "Action requirements",
                ) {
                    self.result.status = CommandStatus::RequirementsFailed;
                    self.say(if action.failure_text.is_empty() {
                        "You cannot do that yet."
                    } else {
                        &action.failure_text
                    })?;
                    return Ok(());
                }
                self.effects_at(&action.effects, self.source_for(&action.id, "effects"))?;
                if self.state.ending.is_none() {
                    if let Some(event) = self.verb(&action.verb).and_then(|v| v.event) {
                        let target = if action.standard.as_ref().is_some_and(|s| {
                            s.interaction == luna_model::StandardInteraction::TakeFrom
                        }) {
                            best.item.unwrap_or(best.owner)
                        } else {
                            best.owner
                        };
                        let duplicate = action.standard.is_some()
                            && self
                                .mutation_events
                                .iter()
                                .any(|(prior, owner)| *prior == event && owner == target);
                        if !duplicate {
                            self.fire(event, target)?;
                        }
                    }
                    if self.state.ending.is_none() {
                        self.fire(Event::Command, best.owner)?
                    }
                }
            }
            Handler::Exit(exit) => {
                if !self.checked_condition(
                    &exit.available,
                    self.source_for(&exit.id, "available"),
                    "Exit availability",
                ) {
                    self.result.status = CommandStatus::RequirementsFailed;
                    self.say(if exit.blocked_text.is_empty() {
                        "That route is not available yet."
                    } else {
                        &exit.blocked_text
                    })?;
                    return Ok(());
                }
                self.say(&exit.text)?;
                let flow = self.effects_at(&exit.effects, self.source_for(&exit.id, "effects"))?;
                if flow == Flow::Continue {
                    self.traced(
                        TraceKind::Notice {
                            text: "Travel through the selected exit.".into(),
                        },
                        self.source_for(&exit.id, "destination"),
                        true,
                        |this| this.move_to(&exit.destination),
                    )?;
                }
                if self.state.ending.is_none() {
                    self.fire(Event::Command, best.owner)?
                }
            }
        }
        Ok(())
    }
}

/// Recognize runner save/load/list/quit controls, preserving save-label text.
///
/// Only the first word is normalized. Surrounding label whitespace is trimmed,
/// while its case, punctuation, and internal spacing remain intact. `saves` and
/// `quit` accept no label. This parser performs no I/O or slot-label validation.
///
/// ```
/// use luna_core::{HostControl, host_control};
/// assert_eq!(host_control(" SAVE  Before the Gate!  "), Some(HostControl::Save {
///     name: Some("Before the Gate!".into()),
/// }));
/// assert_eq!(host_control("quit"), Some(HostControl::Quit));
/// assert_eq!(host_control("quit later"), None);
/// assert_eq!(host_control("examine painting"), None);
/// ```
pub fn host_control(input: &str) -> Option<HostControl> {
    let trimmed = input.trim();
    let (first, rest) = trimmed
        .split_once(char::is_whitespace)
        .unwrap_or((trimmed, ""));
    let name = if rest.trim().is_empty() {
        None
    } else {
        Some(rest.trim().to_owned())
    };
    match normalize(first).as_str() {
        "save" => Some(HostControl::Save { name }),
        "load" => Some(HostControl::Load { name }),
        "saves" if name.is_none() => Some(HostControl::Saves),
        "quit" if name.is_none() => Some(HostControl::Quit),
        _ => None,
    }
}
