//! Interactive terminal controls stay separate from gameplay and piped input.
use anyhow::{Result, ensure};
use dialoguer::{FuzzySelect, Select};
use luna_runner::{Installed, SaveSummary, Storage};
use rustyline::{
    DefaultEditor,
    config::{BellStyle, ColorMode, Config},
    error::ReadlineError,
};
use std::{
    collections::HashMap,
    io::{self, BufRead, IsTerminal, Write},
};

const MAX_COMMAND_BYTES: usize = 4096;

fn capable_terminal() -> bool {
    !std::env::var("TERM").is_ok_and(|term| term == "dumb")
}

/// A single game's in-memory history; prompt answers are never recorded.
pub(crate) struct Input {
    editor: Option<DefaultEditor>,
    interactive: bool,
}

impl Input {
    pub(crate) fn new() -> Result<Self> {
        let interactive = io::stdin().is_terminal();
        let editor = if interactive && io::stdout().is_terminal() && capable_terminal() {
            let config = Config::builder()
                .max_history_size(500)?
                .history_ignore_dups(true)?
                .bell_style(BellStyle::None)
                .color_mode(ColorMode::Disabled)
                .build();
            Some(DefaultEditor::with_config(config)?)
        } else {
            None
        };
        Ok(Self {
            editor,
            interactive,
        })
    }

    pub(crate) fn interactive(&self) -> bool {
        self.interactive
    }

    pub(crate) fn editable(&self) -> bool {
        self.editor.is_some()
    }

    pub(crate) fn read(&mut self, prompt: &str, history: bool) -> io::Result<Option<String>> {
        if let Some(editor) = &mut self.editor {
            loop {
                match editor.readline(prompt) {
                    Ok(line) => {
                        if line.len() > MAX_COMMAND_BYTES {
                            return Err(io::Error::new(
                                io::ErrorKind::InvalidInput,
                                "Commands are limited to 4096 bytes",
                            ));
                        }
                        if history && !line.trim().is_empty() {
                            editor.add_history_entry(&line).map_err(input_error)?;
                        }
                        return Ok(Some(line));
                    }
                    // Cancel the edit, not the session or a gameplay turn.
                    Err(ReadlineError::Interrupted) => continue,
                    Err(ReadlineError::Eof) => return Ok(None),
                    Err(error) => return Err(input_error(error)),
                }
            }
        }
        if self.interactive {
            print!("{prompt}");
            io::stdout().flush()?;
        }
        read_line(&mut io::stdin().lock())
    }
}

fn input_error(error: ReadlineError) -> io::Error {
    match error {
        ReadlineError::Io(error) => error,
        other => io::Error::other(other),
    }
}

pub(crate) fn clean_label(value: &str) -> String {
    value
        .chars()
        .map(|c| if c.is_control() { ' ' } else { c })
        .collect()
}

fn game_labels(records: &[Installed]) -> Vec<String> {
    let labels: Vec<_> = records
        .iter()
        .map(|record| {
            // Project titles are author-controlled; never interpret their terminal controls.
            let title = clean_label(&record.title);
            format!("{title} (version {})", record.content_version)
        })
        .collect();
    let mut counts = HashMap::new();
    for label in &labels {
        *counts.entry(label).or_insert(0) += 1;
    }
    labels
        .iter()
        .zip(records)
        .map(|(label, record)| {
            if counts[label] > 1 {
                format!("{label} [{}]", record.game_id)
            } else {
                label.clone()
            }
        })
        .collect()
}

pub(crate) fn pick_game(store: &Storage, version: Option<&str>) -> Result<Option<Installed>> {
    let mut records = store.records()?;
    if records.is_empty() {
        println!("No installed games. Use luna import <game.luna>.");
        return Ok(None);
    }
    if let Some(version) = version {
        records.retain(|record| record.content_version == version);
        ensure!(
            !records.is_empty(),
            "No installed games match version {version}; use luna list"
        );
    }
    ensure!(
        io::stdin().is_terminal() && io::stderr().is_terminal() && capable_terminal(),
        "Game selection needs an interactive terminal. Use luna list, then luna run <game-id> (and --version when needed) for scripts"
    );
    records.sort_by(|a, b| {
        a.title
            .to_lowercase()
            .cmp(&b.title.to_lowercase())
            .then(a.title.cmp(&b.title))
            .then(a.content_version.cmp(&b.content_version))
            .then(a.game_id.cmp(&b.game_id))
    });
    let selection = FuzzySelect::new()
        .with_prompt("Choose a game (type to search, Up/Down, Enter to play, Esc to cancel)")
        .highlight_matches(false)
        .items(game_labels(&records))
        .default(0)
        .max_length(12)
        .interact_opt();
    match selection {
        Ok(index) => Ok(index.map(|index| records.swap_remove(index))),
        Err(dialoguer::Error::IO(error)) if error.kind() == io::ErrorKind::Interrupted => Ok(None),
        Err(error) => Err(error.into()),
    }
}

fn select(prompt: &str, items: &[String]) -> Result<Option<usize>> {
    match Select::new()
        .with_prompt(prompt)
        .items(items)
        .default(0)
        .max_length(12)
        .interact_opt()
    {
        Ok(index) => Ok(index),
        Err(dialoguer::Error::IO(error)) if error.kind() == io::ErrorKind::Interrupted => Ok(None),
        Err(error) => Err(error.into()),
    }
}

pub(crate) fn confirm(prompt: &str, action: &str) -> Result<bool> {
    Ok(select(prompt, &["Cancel".into(), action.into()])? == Some(1))
}

pub(crate) fn latest_slot(saves: &[SaveSummary]) -> Option<String> {
    saves
        .iter()
        .filter(|save| !save.corrupt)
        .max_by_key(|save| (save.name == "autosave", save.updated))
        .map(|save| save.name.clone())
}

pub(crate) fn pick_save(saves: &[SaveSummary]) -> Result<Option<String>> {
    let mut sorted: Vec<_> = saves.iter().collect();
    sorted.sort_by_key(|save| std::cmp::Reverse(save.updated));
    let mut labels: Vec<_> = sorted
        .iter()
        .map(|save| {
            let detail = if save.corrupt {
                "unreadable; preserved".into()
            } else {
                save.updated
                    .map(|date| {
                        date.with_timezone(&chrono::Local)
                            .format("%Y-%m-%d %H:%M:%S")
                            .to_string()
                    })
                    .unwrap_or_else(|| "date unavailable".into())
            };
            format!("{} — {detail}", clean_label(&save.name))
        })
        .collect();
    labels.push("Back".into());
    loop {
        match select("Load a save", &labels)? {
            Some(index) if index < sorted.len() && sorted[index].corrupt => eprintln!(
                "That save is unreadable and has been preserved. Choose another save or Back."
            ),
            Some(index) if index < sorted.len() => return Ok(Some(sorted[index].name.clone())),
            _ => return Ok(None),
        }
    }
}

pub(crate) enum Launch {
    New,
    Load(String),
    Back,
}

pub(crate) fn launch_menu(title: &str, saves: &[SaveSummary]) -> Result<Launch> {
    let continuation = latest_slot(saves);
    let mut labels = vec![];
    if let Some(name) = &continuation {
        labels.push(format!("Continue ({})", clean_label(name)));
    }
    if !saves.is_empty() {
        labels.push("Load a save".into());
    }
    labels.extend(["New game".into(), "Back".into()]);
    loop {
        let Some(index) = select(&format!("Play {}", clean_label(title)), &labels)? else {
            return Ok(Launch::Back);
        };
        if continuation.is_some() && index == 0 {
            return Ok(Launch::Load(continuation.clone().unwrap()));
        }
        if labels[index] == "Load a save" {
            if let Some(name) = pick_save(saves)? {
                return Ok(Launch::Load(name));
            }
        } else if labels[index] == "New game" {
            if saves.is_empty()
                || confirm(
                    "Start over? The autosave will be replaced; named saves are kept.",
                    "Start new game",
                )?
            {
                return Ok(Launch::New);
            }
        } else {
            return Ok(Launch::Back);
        }
    }
}

/// Bound allocation and consume a malformed/oversized piped line before reporting it.
pub(crate) fn read_line(reader: &mut impl BufRead) -> io::Result<Option<String>> {
    let mut bytes = Vec::new();
    let mut seen = false;
    let mut too_long = false;
    loop {
        let chunk = reader.fill_buf()?;
        if chunk.is_empty() {
            if !seen {
                return Ok(None);
            }
            break;
        }
        seen = true;
        let end = chunk
            .iter()
            .position(|b| *b == b'\n')
            .map(|n| n + 1)
            .unwrap_or(chunk.len());
        let done = chunk[end - 1] == b'\n';
        if bytes.len() + end <= MAX_COMMAND_BYTES + 2 {
            bytes.extend_from_slice(&chunk[..end]);
        } else {
            too_long = true;
        }
        reader.consume(end);
        if done {
            break;
        }
    }
    if too_long {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "Commands are limited to 4096 bytes",
        ));
    }
    let text = String::from_utf8(bytes)
        .map_err(|_| io::Error::new(io::ErrorKind::InvalidData, "Use UTF-8 text"))?;
    let text = text.trim_end_matches(['\r', '\n']);
    if text.len() > MAX_COMMAND_BYTES {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "Commands are limited to 4096 bytes",
        ));
    }
    Ok(Some(text.into()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn picker_labels_use_titles_and_versions_and_disambiguate_duplicates() {
        let record = |id: &str, title: &str| Installed {
            game_id: id.into(),
            title: title.into(),
            content_version: "1.0.0".into(),
            directory: "unused".into(),
            fingerprint: "unused".into(),
        };
        let labels = game_labels(&[
            record("one", "Study"),
            record("two", "Study"),
            record("three", "Garden\n\x1b[31m"),
        ]);
        assert_eq!(labels[0], "Study (version 1.0.0) [one]");
        assert_eq!(labels[1], "Study (version 1.0.0) [two]");
        assert!(!labels[2].contains(['\n', '\x1b']));
        assert!(!labels[2].contains("three"));
    }

    #[test]
    fn input_is_bounded_and_recovers() {
        let mut input = io::Cursor::new([vec![b'x'; 5000], b"\nlook\n".to_vec()].concat());
        assert!(read_line(&mut input).is_err());
        assert_eq!(read_line(&mut input).unwrap().as_deref(), Some("look"));
        let mut invalid = io::Cursor::new(vec![255, b'\n', b'q', b'\n']);
        assert!(read_line(&mut invalid).is_err());
        assert_eq!(read_line(&mut invalid).unwrap().as_deref(), Some("q"));
        for ending in ["", "\n", "\r\n"] {
            let accepted = format!("{}{ending}", "x".repeat(MAX_COMMAND_BYTES));
            assert_eq!(
                read_line(&mut io::Cursor::new(accepted))
                    .unwrap()
                    .unwrap()
                    .len(),
                MAX_COMMAND_BYTES
            );
            let rejected = format!("{}{ending}", "x".repeat(MAX_COMMAND_BYTES + 1));
            assert!(read_line(&mut io::Cursor::new(rejected)).is_err());
        }
    }
}
