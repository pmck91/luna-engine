//! Host-only launch/save flows; gameplay continues through the shared Session.
use crate::{
    output::{self, Output},
    terminal::{self, Input, Launch},
};
use anyhow::{Context, Result, ensure};
use luna_core::{GameDefinition, GameState, HostControl, Session};
use luna_model::Project;
use luna_runner::{Installed, Storage};
use std::{io, path::PathBuf};

pub(crate) struct Options {
    pub new: bool,
    pub load: Option<String>,
    pub colour: bool,
    pub transcript: Option<PathBuf>,
    pub guide_state: PathBuf,
}

pub(crate) enum Outcome {
    Finished,
    Back,
}

pub(crate) fn print_saves(
    store: &Storage,
    id: &str,
    version: &str,
    output: &mut Output,
) -> Result<()> {
    let saves = store.list_saves(id, version)?;
    if saves.is_empty() {
        output.line(&format!("No saves for {id} version {version}."))?;
    }
    for save in saves {
        output.line(&format!(
            "{}\t{}",
            save.name,
            if save.corrupt {
                "corrupt; preserved".into()
            } else {
                save.updated
                    .map(|date| date.to_rfc3339())
                    .unwrap_or_default()
            }
        ))?;
    }
    Ok(())
}

fn autosave(
    store: &Storage,
    record: &Installed,
    session: &Session,
    last_saved: &mut Option<GameState>,
    output: &mut Output,
) {
    match store.write_save(record, session.definition(), session.state(), None) {
        Ok(()) => *last_saved = Some(session.state().clone()),
        Err(error) => output.error(&format!("Autosave failed: {error:#}. Your previous valid save remains available; use save to retry.")),
    }
}

fn restored(session: &Session, label: &str, colour: bool, output: &mut Output) -> Result<()> {
    let messages = session.resume_messages()?;
    output.line(&format!("Loaded {label}."))?;
    output.messages(
        &luna_core::CommandResult {
            messages,
            ..Default::default()
        },
        colour,
    )
}

fn discard(input: &mut Input, output: &mut Output) -> Result<bool> {
    if !input.interactive() {
        output.error("Unsaved progress would be lost; save successfully before loading in a noninteractive session.");
        return Ok(false);
    }
    Ok(input
        .read(
            "Discard progress since the last successful save? [y/N] ",
            false,
        )?
        .is_some_and(|answer| matches!(answer.trim().to_ascii_lowercase().as_str(), "y" | "yes")))
}

pub(crate) fn play(
    store: &Storage,
    record: &Installed,
    project: Project,
    options: &Options,
) -> Result<Outcome> {
    let definition = GameDefinition::new(project)?;
    let mut input = Input::new()?;
    let explicit = options.new || options.load.is_some();
    let (session, loaded) = loop {
        let choice = if options.new {
            Launch::New
        } else if let Some(name) = &options.load {
            Launch::Load(name.clone())
        } else {
            let saves = store.list_saves(&record.game_id, &record.content_version)?;
            if input.editable() {
                terminal::launch_menu(&record.title, &saves)?
            } else {
                ensure!(
                    saves.is_empty(),
                    "Saved progress exists. Use --load autosave, --load <name>, or --new"
                );
                Launch::New
            }
        };
        match choice {
            Launch::Back => return Ok(Outcome::Back),
            Launch::New => {
                break (
                    Session::start_with_definition(definition.clone(), None)?,
                    None,
                );
            }
            Launch::Load(name) => {
                match store.load_save(
                    record,
                    &definition,
                    if name.eq_ignore_ascii_case("autosave") {
                        None
                    } else {
                        Some(&name)
                    },
                ) {
                    Ok(saved) => {
                        let changed = saved.fingerprint != record.fingerprint;
                        let session =
                            Session::restore_with_definition(definition.clone(), saved.state)?;
                        break ((session, Default::default()), Some((name, changed)));
                    }
                    Err(error) if !explicit && input.editable() => {
                        eprintln!(
                            "Could not load: {error:#}. Your saves were preserved. Choose another option."
                        );
                    }
                    Err(error) => return Err(error),
                }
            }
        }
    };
    let (initial_session, initial_messages) = session;
    let mut session = initial_session;
    let mut output = Output::for_game(record);
    if let Some(path) = &options.transcript {
        output.start(path)?;
    }
    if input.editable() {
        output::first_launch(&options.guide_state, &mut output)?;
    }
    let mut last_saved = None;
    if let Some((name, changed)) = loaded {
        if changed {
            output.error("Warning: content was replaced under this version. The restored state passed compatibility validation.");
        }
        last_saved = Some(session.state().clone());
        restored(&session, &name, options.colour, &mut output)?;
    } else {
        autosave(store, record, &session, &mut last_saved, &mut output);
        output.messages(&initial_messages, options.colour)?;
    }
    loop {
        let line = match input.read("> ", true) {
            Ok(value) => value,
            Err(error)
                if matches!(
                    error.kind(),
                    io::ErrorKind::InvalidData | io::ErrorKind::InvalidInput
                ) =>
            {
                output.error(&format!("Input rejected: {error}"));
                continue;
            }
            Err(error) => return Err(error.into()),
        };
        let eof = line.is_none();
        let command = line.unwrap_or_else(|| "quit".into());
        if command.trim().is_empty() {
            continue;
        }
        output.command(&command);
        if output::host_command(command.trim(), &mut output)? {
            continue;
        }
        let result = match session.command(&command) {
            Ok(result) => result,
            Err(error) => {
                output.error(&format!("Command failed and was rolled back: {error:#}"));
                continue;
            }
        };
        match result.control {
            Some(HostControl::Save { name }) => {
                if input.editable()
                    && let Some(label) = name.as_deref()
                {
                    let exists = match store.save_exists(record, Some(label)) {
                        Ok(exists) => exists,
                        Err(error) => {
                            output.error(&format!("Could not save: {error:#}"));
                            continue;
                        }
                    };
                    if exists
                        && !terminal::confirm(
                            &format!("Replace save {}?", terminal::clean_label(label)),
                            "Replace save",
                        )?
                    {
                        output.line("Save cancelled.")?;
                        continue;
                    }
                }
                match store.write_save(
                    record,
                    session.definition(),
                    session.state(),
                    name.as_deref(),
                ) {
                    Ok(()) => {
                        last_saved = Some(session.state().clone());
                        output
                            .line(&format!("Saved {}.", name.as_deref().unwrap_or("autosave")))?;
                    }
                    Err(error) => output.error(&format!("Could not save: {error:#}")),
                }
            }
            Some(HostControl::Load { mut name }) => {
                if name.is_none() && input.editable() {
                    name = terminal::pick_save(
                        &store.list_saves(&record.game_id, &record.content_version)?,
                    )?;
                    if name.is_none() {
                        output.line("Load cancelled.")?;
                        continue;
                    }
                }
                if last_saved.as_ref() != Some(session.state())
                    && !discard(&mut input, &mut output)?
                {
                    continue;
                }
                let slot = name
                    .as_deref()
                    .filter(|name| !name.eq_ignore_ascii_case("autosave"));
                match store.load_save(record, session.definition(), slot) {
                    Ok(saved) => {
                        if saved.fingerprint != record.fingerprint {
                            output.error("Warning: game content changed; saved state passed compatibility validation.");
                        }
                        session.replace_state(saved.state)?;
                        last_saved = Some(session.state().clone());
                        restored(
                            &session,
                            name.as_deref().unwrap_or("autosave"),
                            options.colour,
                            &mut output,
                        )?;
                        autosave(store, record, &session, &mut last_saved, &mut output);
                    }
                    Err(error) => output.error(&format!("Could not load: {error:#}")),
                }
            }
            Some(HostControl::Saves) => {
                print_saves(store, &record.game_id, &record.content_version, &mut output)?
            }
            Some(HostControl::Quit) => {
                if last_saved.as_ref() != Some(session.state()) {
                    if !input.interactive() || eof {
                        store.write_save(record, session.definition(), session.state(), None)
                            .context("Could not save remaining progress on exit; previous saves were preserved")?;
                    } else {
                        let choice = input
                            .read(
                                "Save remaining progress before quitting? [Y/n/cancel] ",
                                false,
                            )?
                            .unwrap_or_default();
                        match choice.trim().to_ascii_lowercase().as_str() {
                            "cancel" | "c" => continue,
                            "n" | "no" => {}
                            _ => {
                                if let Err(error) = store.write_save(
                                    record,
                                    session.definition(),
                                    session.state(),
                                    None,
                                ) {
                                    output.error(&format!(
                                        "Could not save: {error:#}; still playing."
                                    ));
                                    continue;
                                }
                            }
                        }
                    }
                }
                break;
            }
            None => {
                if result.state_changed {
                    autosave(store, record, &session, &mut last_saved, &mut output);
                }
                output.messages(&result, options.colour)?;
            }
        }
    }
    Ok(Outcome::Finished)
}
