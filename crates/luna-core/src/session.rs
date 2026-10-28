//! Host-facing session lifecycle and the command commit/rollback boundary.
use crate::{
    CommandResult, CommandStatus, GameDefinition,
    runtime::{Run, explanation, resolution::InteractionContext},
};
use anyhow::Result;
use luna_model::{Condition, Event, GameState, Project, text};

#[path = "undo/mod.rs"]
pub(crate) mod undo;

/// A playthrough with immutable authored content and validated mutable state.
///
/// Commands commit their state and messages together. Hosts can borrow a state
/// snapshot or replace it through [`Self::replace_state`], which validates the
/// complete snapshot before committing it.
///
/// Pending clarification and recent-object references belong to this session,
/// outside [`GameState`]. Commands commit or roll back that context with story
/// state. Restore and successful state replacement begin with no input context.
///
/// Each session keeps its definition alive independently of other clones. State
/// compatibility is structural: debug replacement can install a valid snapshot
/// that ordinary gameplay could not reach. Host storage owns bundle fingerprints,
/// save envelopes, and slot/recovery policy.
pub struct Session {
    definition: GameDefinition,
    state: GameState,
    context: InteractionContext,
    offer: Option<crate::ConversationView>,
    undo_history: Option<undo::History>,
}
impl Session {
    /// Validate authored content and start a fresh playthrough.
    ///
    /// Displays the title/opening, runs start triggers, and enters the starting
    /// location unless those triggers already moved the player or ended the game.
    /// Initial state assignment does not fire value watches.
    ///
    /// # Errors
    ///
    /// Rejects invalid content, an unknown starting location, or failed
    /// opening/start/entry execution. No session is returned on failure.
    pub fn start(project: Project, location: Option<&str>) -> Result<(Self, CommandResult)> {
        Self::start_with_definition(GameDefinition::new(project)?, location)
    }
    /// Start a new playthrough using previously validated, immutable content.
    ///
    /// `location` overrides the starting room for this playthrough only. Title,
    /// opening text, start triggers, and initial entry share the startup budget;
    /// startup either returns a complete session/result or fails as a whole.
    /// Cloning a definition shares content without sharing mutable session state.
    ///
    /// # Errors
    ///
    /// Rejects an unknown starting location or failed opening/start/entry execution.
    pub fn start_with_definition(
        definition: GameDefinition,
        location: Option<&str>,
    ) -> Result<(Self, CommandResult)> {
        let state = definition.initial_state(location)?;
        let undo_history = definition
            .project()
            .game
            .allow_player_undo
            .then(undo::History::new);
        let mut session = Self {
            definition,
            state,
            context: InteractionContext::default(),
            offer: None,
            undo_history,
        };
        let mut run = Run::new(&session.definition, session.state.clone());
        run.say(&session.definition.project().game.title)?;
        run.say(&session.definition.project().game.opening_text)?;
        run.fire(Event::Start, &session.definition.project().game.id)?;
        if run.state.ending.is_none() && run.state.visits.get(&run.state.location) == Some(&0) {
            let id = run.state.location.clone();
            run.enter(&id)?;
        }
        run.finish_turn()?;
        run.activate_routines(true)?;
        run.finish_conversation()?;
        run.check_story_bounds()?;
        run.result.conversation = run.offer.clone();
        run.result.routines = run.routine_view();
        run.result.state_changed = true;
        run.result.turns =
            crate::runtime::turns::view(session.project(), &run.state, session.definition.turns());
        let Run {
            state,
            result,
            offer,
            ..
        } = run;
        session.state = state.into_owned();
        session.offer = offer;
        let mut result = result;
        result.undo = session.enabled_undo_view();
        Ok((session, result))
    }
    /// Validate authored content and restore a compatible saved snapshot.
    ///
    /// Restoring runs no opening text, triggers, or effects. Use
    /// [`Self::resume_messages`] to present the restored game.
    ///
    /// # Errors
    ///
    /// Rejects invalid content or incompatible saved state.
    pub fn restore(project: Project, state: GameState) -> Result<Self> {
        Self::restore_with_definition(GameDefinition::new(project)?, state)
    }
    /// Restore saved state without replaying effects or revalidating game content.
    ///
    /// Validates the complete snapshot, including its identity/version and progress
    /// bounds. A completed snapshot stays completed. Pending clarification and
    /// recent references are cleared. Presentation is explicit via
    /// [`Self::resume_messages`]; restoration returns no transcript itself.
    ///
    /// # Errors
    ///
    /// Returns an error if saved state is incompatible with the definition.
    pub fn restore_with_definition(definition: GameDefinition, state: GameState) -> Result<Self> {
        definition.validate_state(&state)?;
        let offer = {
            let mut run = Run::view(&definition, &state);
            run.prepare_conversation()?;
            run.offer
        };
        let undo_history = definition
            .project()
            .game
            .allow_player_undo
            .then(undo::History::new);
        Ok(Self {
            definition,
            state,
            context: InteractionContext::default(),
            offer,
            undo_history,
        })
    }
    /// Borrow the immutable game definition shared with save storage.
    pub fn definition(&self) -> &GameDefinition {
        &self.definition
    }
    /// Borrow authored content without allowing session-local definition edits.
    pub fn project(&self) -> &Project {
        self.definition.project()
    }

    /// Borrow the current state without allowing unchecked mutation.
    ///
    /// Clone this snapshot for host editing, then use [`Self::replace_state`].
    /// Serialization can borrow it directly without making a copy.
    ///
    /// ```compile_fail
    /// use luna_core::Session;
    /// use luna_model::Project;
    /// let (mut session, _) = Session::start(Project::blank("Adventure"), None).unwrap();
    /// session.state().variables.clear();
    /// ```
    pub fn state(&self) -> &GameState {
        &self.state
    }
    /// Inspect the committed clock and ordered pending timers without executing effects.
    pub fn turn_view(&self) -> Option<crate::TurnView> {
        crate::runtime::turns::view(self.project(), &self.state, self.definition.turns())
    }

    /// Inspect routine cursors, captured waits and current hold/guard reasons without effects.
    pub fn routine_view(&self) -> Vec<crate::RoutineView> {
        Run::view(&self.definition, &self.state).routine_view()
    }

    /// Return the current player-safe question without changing story or context.
    ///
    /// Read-only commands can leave a question pending. Successful restore or
    /// state replacement clears it; this view is never part of saved GameState.
    pub fn pending_clarification(&self) -> Option<crate::ClarificationQuestion> {
        self.context.question()
    }

    /// Borrow the prepared player-safe reply offer without running effects.
    ///
    /// Its ephemeral token survives unchanged read-only views, but successful
    /// restore/replacement begins a new lifetime. Hosts must submit both the
    /// token and a listed reply ID to [`Self::select_reply`].
    pub fn conversation_view(&self) -> Option<&crate::ConversationView> {
        self.offer.as_ref()
    }

    /// Return discovered quests, active first, then completed and failed.
    ///
    /// Retains author order within each status and only earned journal snapshots.
    /// Reading the log runs no hooks, changes no input context, and works after
    /// game completion. Undiscovered quests and future stages remain private.
    pub fn quest_log(&self) -> Vec<crate::QuestLogEntry> {
        crate::narrative::quest_log(self.project(), &self.state, None)
    }

    /// Consume this session and return its complete state for storage or transfer.
    ///
    /// Deliberately drops pending clarification and recent references; those are
    /// interaction context, not saved story progress.
    pub fn into_state(self) -> GameState {
        self.state
    }

    /// Validate and atomically replace the entire current state.
    ///
    /// Intended for host state editing and loading. Replacement runs no events,
    /// effects, or messages and preserves the supplied progress exactly.
    /// Successful replacement clears pending clarification and recent references,
    /// even when the supplied state equals the current snapshot.
    ///
    /// # Errors
    ///
    /// Rejects any snapshot incompatible with this session's definition, leaving
    /// the previous state and interaction context intact.
    ///
    /// ```
    /// use luna_core::Session;
    /// use luna_model::{Project, Value};
    /// # fn main() -> anyhow::Result<()> {
    /// let mut project = Project::blank("Adventure");
    /// project.game.variables.insert("health".into(), Value::Integer(10));
    /// let (mut session, _) = Session::start(project, None)?;
    /// let mut edited = session.state().clone();
    /// edited.variables.insert("health".into(), Value::Integer(5));
    /// session.replace_state(edited)?;
    /// assert_eq!(session.state().variables["health"], Value::Integer(5));
    /// # Ok(())
    /// # }
    /// ```
    pub fn replace_state(&mut self, state: GameState) -> Result<()> {
        self.definition.validate_state(&state)?;
        let offer = {
            let mut run = Run::view(&self.definition, &state);
            run.prepare_conversation()?;
            run.offer
        };
        self.state = state;
        self.context = InteractionContext::default();
        self.offer = offer;
        if let Some(history) = &mut self.undo_history {
            history.clear(crate::UndoUnavailableReason::StateReplaced);
        }
        Ok(())
    }

    /// Execute one command, committing state and output together on success.
    ///
    /// Unmatched/ambiguous commands and failed requirements return an ordinary
    /// result with the corresponding [`CommandStatus`]. Host controls are returned
    /// for the caller to handle; the core performs no filesystem operations.
    ///
    /// # Errors
    ///
    /// Runtime failures, including invalid arithmetic and exhausted trigger
    /// limits, discard the entire attempted state and transcript. A normal failed
    /// requirement or ambiguity is returned as `Ok(CommandResult)` instead.
    pub fn command(&mut self, input: &str) -> Result<CommandResult> {
        let (result, error) = self.execute(input, false);
        if let Some(error) = error {
            return Err(error);
        }
        Ok(result)
    }
    /// Execute once and retain a bounded explanation of the attempt.
    ///
    /// Uses the ordinary execution path. On failure, returns
    /// [`CommandStatus::Error`] and diagnostic/discarded-output details in the
    /// explanation while leaving state unchanged and ordinary messages empty.
    /// A successful attempt commits normally; this is not a dry run. Recording
    /// may truncate at 8,192 steps or 256 changes per diff without stopping gameplay.
    /// Full state snapshots make long changing chains more costly to explain.
    ///
    /// ```
    /// use luna_core::{CommandStatus, Session};
    /// use luna_model::{Action, ArithmeticOperation, Effect, NumericOperand, PatternPart, Project, Value};
    /// # fn main() -> anyhow::Result<()> {
    /// let mut project = Project::blank("A risky action");
    /// project.game.variables.insert("health".into(), Value::Integer(10));
    /// project.game.variables.insert("divisor".into(), Value::Integer(0));
    /// project.game.actions.push(Action {
    ///     id: "risk".into(), verb: "use".into(),
    ///     pattern: vec![PatternPart::Literal { text: "risk".into() }],
    ///     effects: vec![
    ///         Effect::Say { text: "This output is discarded.".into() },
    ///         Effect::UpdateVariable {
    ///             name: "health".into(), op: ArithmeticOperation::Divide,
    ///             operand: NumericOperand::Variable { name: "divisor".into() },
    ///         },
    ///     ],
    ///     ..Default::default()
    /// });
    /// let (mut session, _) = Session::start(project, None)?;
    /// let before = session.state().clone();
    /// let result = session.command_explained("use risk");
    /// assert_eq!(result.status, CommandStatus::Error);
    /// assert!(result.messages.is_empty());
    /// assert_eq!(session.state(), &before);
    /// let explanation = result.explanation.unwrap();
    /// assert!(!explanation.committed);
    /// assert_eq!(explanation.discarded_messages.len(), 1);
    /// # Ok(())
    /// # }
    /// ```
    pub fn command_explained(&mut self, input: &str) -> CommandResult {
        self.execute(input, true).0
    }
    /// Select a prewritten reply from the current prepared offer.
    ///
    /// Rechecks live scope/eligibility and never accepts a foreign, stale or
    /// future-node reply. Rejections return Unmatched with a neutral notice.
    /// Noun clarification owns input until completed/cancelled. Selection shares
    /// ordinary command rollback, effects, budgets and output semantics.
    ///
    /// # Errors
    /// Returns an error for oversized selection input or failed hook execution;
    /// the full attempted world, progress, transcript and offer roll back.
    pub fn select_reply(&mut self, offer_token: &str, reply_id: &str) -> Result<CommandResult> {
        let (result, error) = self.execute_with("[selected reply]", false, |run| {
            run.select_conversation_reply(offer_token, reply_id)
        });
        if let Some(error) = error {
            return Err(error);
        }
        Ok(result)
    }
    /// Execute the same selection once with bounded attempted-state diagnostics.
    ///
    /// Runtime failures return Error and preserve the previous offer and state,
    /// with discarded output retained only in the explanation.
    pub fn select_reply_explained(&mut self, offer_token: &str, reply_id: &str) -> CommandResult {
        self.execute_with("[selected reply]", true, |run| {
            run.select_conversation_reply(offer_token, reply_id)
        })
        .0
    }
    fn execute(&mut self, input: &str, explain: bool) -> (CommandResult, Option<anyhow::Error>) {
        if self.undo_history.is_some() && luna_model::normalize(input) == "undo" {
            return self.execute_undo(input, explain);
        }
        self.execute_with(input, explain, |run| run.command(input))
    }

    // Resolution, selected-handler execution, and explanations share this
    // commit boundary. Story and ephemeral input context commit together.
    fn execute_with(
        &mut self,
        input: &str,
        explain: bool,
        command: impl FnOnce(&mut Run<'_>) -> Result<()>,
    ) -> (CommandResult, Option<anyhow::Error>) {
        let mut run = Run::new(&self.definition, self.state.clone());
        run.context = self.context.clone();
        run.offer = self.offer.clone();
        if explain {
            run.recording = Some(explanation::Recorder::default());
        }
        let error = command(&mut run)
            .and_then(|()| run.finish_turn())
            .and_then(|()| run.finish_routines())
            .and_then(|()| run.finish_conversation())
            .and_then(|()| run.check_story_bounds())
            .err();
        if let Some(recorder) = run.recording.take() {
            let discarded = if error.is_some() {
                std::mem::take(&mut run.result.messages)
            } else {
                vec![]
            };
            run.result.explanation = Some(recorder.finish(
                input,
                &self.state,
                &run.state,
                error.as_ref().map(|e| format!("{e:#}")),
                discarded,
            ));
        }
        if error.is_none() {
            run.result.state_changed = *run.state != self.state;
            if let Some(history) = &mut self.undo_history
                && let Some(reason) = history.commit(&self.state, &run.state, &run.undo_input)
            {
                run.result.messages.push(vec![text::Span {
                    text: reason.notice().into(),
                    colour: None,
                }]);
            }
            self.context = run.context;
            self.offer = run.offer;
            self.state = run.state.into_owned();
        } else {
            run.result.status = CommandStatus::Error;
            run.result.state_changed = false;
            run.result.control = None;
        }
        run.result.pending_clarification = self.context.question();
        run.result.conversation = self.offer.clone();
        run.result.turns = self.turn_view();
        run.result.routines = self.routine_view();
        run.result.undo = self.enabled_undo_view();
        (run.result, error)
    }

    /// Describe the current location without entering it or advancing progress.
    ///
    /// # Errors
    ///
    /// Rejects a missing current location or invalid description formatting.
    pub fn description(&self) -> Result<Vec<Vec<text::Span>>> {
        let mut run = Run::view(&self.definition, &self.state);
        run.look()?;
        Ok(run.result.messages)
    }

    /// Present a resumed game's title and current location or completed ending.
    ///
    /// Messages use current saved values and the same formatting as ordinary
    /// execution. This does not replay opening text, entry/ending triggers, or
    /// effects, and leaves visits and response/hint progress unchanged.
    ///
    /// # Errors
    ///
    /// Returns an error if a referenced location, ending, or message value is
    /// missing, or the presented text contains invalid formatting.
    ///
    /// # Examples
    ///
    /// ```
    /// use luna_core::Session;
    /// use luna_model::{Project, text};
    /// # fn main() -> anyhow::Result<()> {
    /// let (session, _) = Session::start(Project::blank("An adventure"), None)?;
    /// let before = session.state().clone();
    /// let messages = session.resume_messages()?;
    /// assert_eq!(text::plain(&messages[0]), "An adventure");
    /// assert_eq!(session.state(), &before);
    /// # Ok(())
    /// # }
    /// ```
    pub fn resume_messages(&self) -> Result<Vec<Vec<text::Span>>> {
        let mut run = Run::view(&self.definition, &self.state);
        run.resume()?;
        if let Some(offer) = &self.offer {
            run.result.messages.extend(offer.messages());
        }
        Ok(run.result.messages)
    }
    /// Read-only evaluation for author checks. Uses the same rules as gameplay.
    ///
    /// Borrows state without effects, events, transcript output, or progress
    /// changes. Missing references evaluate false at their leaf; Boolean groups
    /// and negation still apply. This does not validate arbitrary conditions:
    /// hosts should validate authoring/check definitions before using them.
    pub fn test_condition(&self, condition: &Condition) -> bool {
        Run::view(&self.definition, &self.state).condition(condition)
    }
}

#[cfg(test)]
#[path = "input_tests.rs"]
mod input_tests;
