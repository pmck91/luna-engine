//! Host-facing session lifecycle and the command commit/rollback boundary.
use crate::{
    CommandResult, GameDefinition,
    runtime::{Run, explanation},
};
use anyhow::Result;
use luna_model::{Condition, Event, GameState, Project, text};

pub struct Session {
    definition: GameDefinition,
    pub state: GameState,
}
impl Session {
    pub fn start(project: Project, location: Option<&str>) -> Result<(Self, CommandResult)> {
        Self::start_with_definition(GameDefinition::new(project)?, location)
    }
    /// Start a new playthrough using previously validated, immutable content.
    ///
    /// # Errors
    ///
    /// Rejects an unknown starting location or a failed opening/entry effect.
    pub fn start_with_definition(
        definition: GameDefinition,
        location: Option<&str>,
    ) -> Result<(Self, CommandResult)> {
        let state = definition.initial_state(location)?;
        let mut session = Self { definition, state };
        let mut run = Run::new(session.definition.project(), session.state.clone());
        run.say(&session.definition.project().game.title)?;
        run.say(&session.definition.project().game.opening_text)?;
        run.fire(Event::Start, &session.definition.project().game.id)?;
        if run.state.ending.is_none() && run.state.visits.get(&run.state.location) == Some(&0) {
            let id = run.state.location.clone();
            run.enter(&id)?;
        }
        run.result.state_changed = true;
        let Run { state, result, .. } = run;
        session.state = state;
        Ok((session, result))
    }
    pub fn restore(project: Project, state: GameState) -> Result<Self> {
        Self::restore_with_definition(GameDefinition::new(project)?, state)
    }
    /// Restore saved state without replaying effects or revalidating game content.
    ///
    /// # Errors
    ///
    /// Returns an error if saved state is incompatible with the definition.
    pub fn restore_with_definition(definition: GameDefinition, state: GameState) -> Result<Self> {
        definition.validate_state(&state)?;
        Ok(Self { definition, state })
    }
    /// Borrow the immutable game definition shared with save storage.
    pub fn definition(&self) -> &GameDefinition {
        &self.definition
    }
    /// Borrow authored content without allowing session-local definition edits.
    pub fn project(&self) -> &Project {
        self.definition.project()
    }
    pub fn command(&mut self, input: &str) -> Result<CommandResult> {
        let (result, error) = self.execute(input, false);
        if let Some(error) = error {
            return Err(error);
        }
        Ok(result)
    }
    /// Execute once with optional observations, retaining failed attempts without committing them.
    pub fn command_explained(&mut self, input: &str) -> CommandResult {
        self.execute(input, true).0
    }
    fn execute(&mut self, input: &str, explain: bool) -> (CommandResult, Option<anyhow::Error>) {
        let mut run = Run::new(self.definition.project(), self.state.clone());
        if explain {
            run.recording = Some(explanation::Recorder::default());
        }
        let error = run.command(input).err();
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
            run.result.state_changed = run.state != self.state;
            self.state = run.state;
        } else {
            run.result.status = "error".into();
            run.result.state_changed = false;
            run.result.control = None;
        }
        (run.result, error)
    }
    pub fn description(&self) -> Result<Vec<Vec<text::Span>>> {
        let mut run = Run::new(self.definition.project(), self.state.clone());
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
    /// let before = session.state.clone();
    /// let messages = session.resume_messages()?;
    /// assert_eq!(text::plain(&messages[0]), "An adventure");
    /// assert_eq!(session.state, before);
    /// # Ok(())
    /// # }
    /// ```
    pub fn resume_messages(&self) -> Result<Vec<Vec<text::Span>>> {
        let mut run = Run::new(self.definition.project(), self.state.clone());
        run.resume()?;
        Ok(run.result.messages)
    }
    /// Read-only evaluation for author checks. Uses the same rules as gameplay.
    pub fn test_condition(&self, condition: &Condition) -> bool {
        Run::new(self.definition.project(), self.state.clone()).condition(condition)
    }
}
