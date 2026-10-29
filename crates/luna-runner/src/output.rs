//! Optional plain-text transcripts; recording errors never discard gameplay.
use anyhow::{Context, Result, ensure};
use luna_core::CommandResult;
use luna_model::text;
use luna_runner::Installed;
use std::{
    fs::{File, OpenOptions},
    io::{self, Write},
    path::{Path, PathBuf},
};

#[derive(Default)]
pub(crate) struct Output {
    recording: Option<(PathBuf, File)>,
    heading: String,
}

fn plain(value: &str) -> String {
    value
        .chars()
        .filter(|c| !c.is_control() || matches!(c, '\n' | '\t'))
        .collect()
}

impl Output {
    pub(crate) fn for_game(record: &Installed) -> Self {
        Self {
            heading: format!(
                "Luna transcript: {} (version {})",
                plain(&record.title),
                record.content_version
            ),
            ..Self::default()
        }
    }

    pub(crate) fn start(&mut self, path: &Path) -> Result<()> {
        ensure!(
            self.recording.is_none(),
            "A transcript is already recording; use /transcript stop first"
        );
        let mut options = OpenOptions::new();
        options.write(true).create_new(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o600);
        }
        let mut file = options.open(path).with_context(|| format!("Could not create transcript {} (choose a new filename; existing files are never overwritten)", path.display()))?;
        writeln!(
            file,
            "{}\nRunner version: {}\nStarted: {}\n",
            self.heading,
            env!("CARGO_PKG_VERSION"),
            chrono::Utc::now().to_rfc3339()
        )?;
        self.recording = Some((path.to_owned(), file));
        self.line(&format!("Transcript started: {}", path.display()))
    }

    pub(crate) fn stop(&mut self) -> Result<()> {
        self.line(if self.recording.is_some() {
            "Transcript stopped."
        } else {
            "Transcript recording is off."
        })?;
        self.recording = None;
        Ok(())
    }

    pub(crate) fn status(&mut self) -> Result<()> {
        let status = self
            .recording
            .as_ref()
            .map(|(path, _)| format!("Transcript recording: {}", path.display()))
            .unwrap_or_else(|| "Transcript recording is off.".into());
        self.line(&status)
    }

    fn record(&mut self, value: &str) {
        if let Some((_, file)) = &mut self.recording
            && let Err(error) = writeln!(file, "{}", plain(value)).and_then(|_| file.flush())
        {
            self.recording = None;
            eprintln!("Transcript recording stopped: {error}. The game is still running.");
        }
    }

    pub(crate) fn command(&mut self, command: &str) {
        self.record(&format!("> {command}"));
    }

    pub(crate) fn line(&mut self, value: &str) -> Result<()> {
        let mut stdout = io::stdout().lock();
        writeln!(stdout, "{value}")?;
        stdout.flush()?;
        drop(stdout);
        self.record(value);
        Ok(())
    }

    pub(crate) fn error(&mut self, value: &str) {
        eprintln!("{value}");
        self.record(value);
    }

    pub(crate) fn messages(&mut self, result: &CommandResult, colour: bool) -> Result<()> {
        for message in &result.messages {
            let mut stdout = io::stdout().lock();
            writeln!(stdout, "{}", text::render(message, colour))?;
            stdout.flush()?;
            drop(stdout);
            self.record(&text::plain(message));
        }
        Ok(())
    }
}

pub(crate) fn controls(output: &mut Output) -> Result<()> {
    output.line("Luna controls")?;
    output.line("  help: game help; save <name>: keep a checkpoint; load: choose a save; saves: list saves; quit: leave.")?;
    output.line("  Up/Down recall commands; Left/Right, Backspace/Delete edit; Ctrl-A/Ctrl-E move to the start/end.")?;
    output.line(
        "  Ctrl-C cancels an edit; Ctrl-D on an empty line quits safely. History is session-local.",
    )?;
    output.line("  /controls shows this guide. /transcript start <file>, /transcript stop, /transcript status manage optional recording.")
}

/// The marker is host UI state, separate from game saves and the user's TOML.
pub(crate) fn first_launch(path: &Path, output: &mut Output) -> Result<()> {
    if std::fs::read(path)
        .ok()
        .and_then(|data| serde_json::from_slice::<serde_json::Value>(&data).ok())
        .is_some_and(|value| value["version"] == 1)
    {
        return Ok(());
    }
    controls(output)?;
    if let Err(error) = luna_project::atomic_write(path, b"{\"version\":1}\n") {
        output.error(&format!(
            "Could not remember the controls guide: {error:#}. You can still play."
        ));
    }
    Ok(())
}

pub(crate) fn host_command(command: &str, output: &mut Output) -> Result<bool> {
    if command == "/controls" {
        controls(output)?;
    } else if command == "/transcript" || command == "/transcript status" {
        output.status()?;
    } else if command == "/transcript stop" {
        output.stop()?;
    } else if let Some(path) = command
        .strip_prefix("/transcript start ")
        .map(str::trim)
        .filter(|path| !path.is_empty())
    {
        if let Err(error) = output.start(Path::new(path)) {
            output.error(&format!("{error:#}"));
        }
    } else if command.starts_with("/transcript ") {
        output
            .line("Use /transcript start <new-file>, /transcript stop, or /transcript status.")?;
    } else {
        return Ok(false);
    }
    Ok(true)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn transcripts_are_opt_in_plain_and_refuse_existing_files() {
        let temp = tempfile::tempdir().unwrap();
        let path = temp.path().join("play.txt");
        let mut output = Output::default();
        output.command("not recorded");
        assert!(!path.exists());
        output.start(&path).unwrap();
        output.command("look");
        output.line("A room.").unwrap();
        output.stop().unwrap();
        output.command("not recorded either");
        let bytes = std::fs::read(&path).unwrap();
        assert!(output.start(&path).is_err());
        assert_eq!(std::fs::read(&path).unwrap(), bytes);
        let log = String::from_utf8(bytes).unwrap();
        assert!(log.contains("> look\nA room.\n"));
        assert!(!log.contains("not recorded") && !log.contains('\x1b'));
    }

    #[test]
    fn a_transcript_write_failure_disables_recording_without_failing_the_session() {
        let temp = tempfile::tempdir().unwrap();
        let path = temp.path().join("read-only.txt");
        std::fs::write(&path, "preserve").unwrap();
        let mut output = Output {
            recording: Some((path.clone(), File::open(&path).unwrap())),
            ..Default::default()
        };
        output.command("look");
        assert!(output.recording.is_none());
        output.line("Still playing.").unwrap();
        assert_eq!(std::fs::read_to_string(path).unwrap(), "preserve");
    }
}
