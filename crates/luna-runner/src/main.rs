use anyhow::{Context, Result, ensure};
use clap::{Parser, Subcommand, ValueEnum};
use luna_core::{CommandResult, GameState, HostControl, Session};
use luna_model::{Project, text};
use luna_runner::{ExistingPolicy, Installed, Storage};
use serde::Deserialize;
use std::{
    fs,
    io::{self, BufRead, IsTerminal, Write},
    path::PathBuf,
};

#[derive(Clone, Copy, ValueEnum)]
enum Colour {
    Auto,
    Always,
    Never,
}
#[derive(Clone, Copy, ValueEnum)]
enum OnExisting {
    Keep,
    Replace,
    Cancel,
}
#[derive(Parser)]
#[command(name="luna",version=concat!(env!("CARGO_PKG_VERSION")," (game format 1)"),about="Import and play local parser-driven text adventures",color=clap::ColorChoice::Never)]
struct Cli {
    #[arg(long, global = true)]
    config: Option<PathBuf>,
    #[arg(long, global = true)]
    games_dir: Option<PathBuf>,
    #[arg(long, global = true)]
    saves_dir: Option<PathBuf>,
    #[arg(long, global = true, value_enum, default_value = "auto")]
    color: Colour,
    #[arg(long, global = true)]
    debug: bool,
    #[command(subcommand)]
    command: Command,
}
#[derive(Subcommand)]
enum Command {
    /// Validate and atomically install an editor-exported .luna ZIP.
    Import {
        path: PathBuf,
        #[arg(long, value_enum)]
        on_existing: Option<OnExisting>,
    },
    /// List installed games and all content versions.
    List,
    /// Play an installed game. Choose --new or --load for noninteractive use when saves exist.
    Run {
        game_id: String,
        #[arg(long)]
        version: Option<String>,
        #[arg(long, conflicts_with = "load")]
        new: bool,
        #[arg(long)]
        load: Option<String>,
    },
    /// Remove a game version; saves are preserved unless --delete-saves is explicit.
    Remove {
        game_id: String,
        #[arg(long)]
        version: Option<String>,
        #[arg(long)]
        delete_saves: bool,
    },
    /// List autosave and named saves, including saves for removed installations.
    Saves {
        game_id: String,
        #[arg(long)]
        version: Option<String>,
    },
}
#[derive(Deserialize, Default)]
#[serde(deny_unknown_fields)]
struct Config {
    games_dir: Option<PathBuf>,
    saves_dir: Option<PathBuf>,
}
fn main() {
    let cli = Cli::parse();
    let debug = cli.debug;
    if let Err(error) = run(cli) {
        if debug {
            eprintln!("luna: {error:?}")
        } else {
            eprintln!("luna: {error:#}")
        }
        std::process::exit(1)
    }
}
fn run(cli: Cli) -> Result<()> {
    let dirs = directories::ProjectDirs::from("", "", "luna")
        .context("Cannot find per-user application directories; configure XDG directories")?;
    let config_path = cli
        .config
        .clone()
        .unwrap_or_else(|| dirs.config_dir().join("runner.toml"));
    let config: Config = if config_path.exists() {
        toml::from_str(&fs::read_to_string(&config_path)?)
            .with_context(|| format!("Invalid configuration {}", config_path.display()))?
    } else {
        ensure!(
            cli.config.is_none(),
            "Configuration file does not exist: {}",
            config_path.display()
        );
        Config::default()
    };
    let store = Storage::new(
        cli.games_dir
            .or(config.games_dir)
            .unwrap_or_else(|| dirs.data_dir().join("games")),
        cli.saves_dir
            .or(config.saves_dir)
            .unwrap_or_else(|| dirs.data_dir().join("saves")),
    )?;
    match cli.command {
        Command::Import { path, on_existing } => {
            let prepared = store.prepare(&path)?;
            let id = prepared.project.game.id.clone();
            let version = prepared.project.game.content_version.clone();
            let existing = store.versions(&id, false)?.contains(&version);
            let policy = if existing {
                if !store.list_saves(&id, &version)?.is_empty() {
                    eprintln!(
                        "Game {id} version {version} has existing saves. Replacement preserves them, but changed content may be incompatible."
                    )
                };
                match on_existing {
                    Some(OnExisting::Keep) => ExistingPolicy::Keep,
                    Some(OnExisting::Replace) => ExistingPolicy::Replace,
                    Some(OnExisting::Cancel) => ExistingPolicy::Cancel,
                    None => {
                        ensure!(
                            io::stdin().is_terminal(),
                            "Game/version already installed. Choose --on-existing keep|replace|cancel"
                        );
                        eprint!(
                            "{id} {version} already installed. Keep, replace, or cancel? [keep]: "
                        );
                        io::stderr().flush()?;
                        let response = read_line(&mut io::stdin().lock())?.unwrap_or_default();
                        match response.trim().to_ascii_lowercase().as_str() {
                            "" | "keep" | "k" => ExistingPolicy::Keep,
                            "replace" | "r" => ExistingPolicy::Replace,
                            _ => ExistingPolicy::Cancel,
                        }
                    }
                }
            } else {
                ExistingPolicy::Replace
            };
            let record = store.install(prepared, policy)?;
            println!(
                "Installed {} {} [{}]",
                record.title, record.content_version, record.game_id
            );
        }
        Command::List => {
            let records = store.records()?;
            if records.is_empty() {
                println!("No installed games. Use luna import <game.luna>.")
            }
            for r in records {
                println!("{}\t{}\t{}", r.game_id, r.content_version, r.title)
            }
        }
        Command::Saves { game_id, version } => {
            let version = store.select_version(&game_id, version.as_deref(), true)?;
            print_saves(&store, &game_id, &version)?;
        }
        Command::Remove {
            game_id,
            version,
            delete_saves,
        } => {
            let version = store.select_version(&game_id, version.as_deref(), false)?;
            store.remove(&game_id, &version, delete_saves)?;
            println!(
                "Removed {game_id} version {version}. {}",
                if delete_saves {
                    "Its saves were explicitly deleted."
                } else {
                    "Player saves were preserved."
                }
            );
        }
        Command::Run {
            game_id,
            version,
            new,
            load,
        } => {
            let version = store.select_version(&game_id, version.as_deref(), false)?;
            let _guard = store.version_lock(&game_id, &version)?;
            let record = store.record(&game_id, &version)?;
            let project = store.load_game(&record)?;
            let no_colour = std::env::var_os("NO_COLOR").is_some_and(|v| !v.is_empty());
            let colour = colour_enabled(cli.color, io::stdout().is_terminal(), no_colour);
            play(&store, &record, project, new, load, colour)?;
        }
    }
    Ok(())
}
fn colour_enabled(mode: Colour, terminal: bool, no_colour: bool) -> bool {
    match mode {
        Colour::Always => true,
        Colour::Never => false,
        Colour::Auto => terminal && !no_colour,
    }
}
fn print_messages(result: &CommandResult, colour: bool) -> Result<()> {
    let mut stdout = io::stdout().lock();
    for message in &result.messages {
        writeln!(stdout, "{}", text::render(message, colour))?;
    }
    stdout.flush()?;
    Ok(())
}
fn show_restored(session: &Session, label: &str, colour: bool) -> Result<()> {
    let messages = session.resume_messages()?;
    println!("Loaded {label}.");
    print_messages(
        &CommandResult {
            messages,
            ..Default::default()
        },
        colour,
    )
}
fn print_saves(store: &Storage, id: &str, version: &str) -> Result<()> {
    let saves = store.list_saves(id, version)?;
    if saves.is_empty() {
        println!("No saves for {id} version {version}.")
    }
    for save in saves {
        println!(
            "{}\t{}",
            save.name,
            if save.corrupt {
                "corrupt; preserved".into()
            } else {
                save.updated.map(|t| t.to_rfc3339()).unwrap_or_default()
            }
        )
    }
    Ok(())
}
fn auto_save(
    store: &Storage,
    record: &Installed,
    session: &Session,
    last_saved: &mut Option<GameState>,
) {
    match store.write_save(record, &session.project, &session.state, None) {
        Ok(()) => *last_saved = Some(session.state.clone()),
        Err(e) => eprintln!(
            "Autosave failed: {e:#}. Your previous valid save remains available; use save to retry."
        ),
    }
}
fn dirty(session: &Session, last_saved: &Option<GameState>) -> bool {
    last_saved.as_ref() != Some(&session.state)
}
fn confirm_discard(input: &mut impl BufRead, interactive: bool) -> Result<bool> {
    if !interactive {
        eprintln!(
            "Unsaved progress would be lost; save successfully before loading in a noninteractive session."
        );
        return Ok(false);
    }
    print!("Discard progress since the last successful save? [y/N] ");
    io::stdout().flush()?;
    Ok(read_line(input)?
        .is_some_and(|s| matches!(s.trim().to_ascii_lowercase().as_str(), "y" | "yes")))
}
fn play(
    store: &Storage,
    record: &Installed,
    project: Project,
    new: bool,
    mut load: Option<String>,
    colour: bool,
) -> Result<()> {
    let stdin = io::stdin();
    let interactive = stdin.is_terminal();
    let mut input = stdin.lock();
    let saves = store.list_saves(&record.game_id, &record.content_version)?;
    if !new && load.is_none() && !saves.is_empty() {
        ensure!(
            interactive,
            "Saved progress exists. Use --load autosave, --load <name>, or --new"
        );
        print_saves(store, &record.game_id, &record.content_version)?;
        print!("Start new, load autosave, or enter a named slot [autosave]: ");
        io::stdout().flush()?;
        let answer = read_line(&mut input)?.context("No launch choice supplied")?;
        if !answer.trim().eq_ignore_ascii_case("new") {
            load = Some(if answer.trim().is_empty() {
                "autosave".into()
            } else {
                answer.trim().into()
            });
        }
    }
    let (mut session, mut last_saved) = if let Some(name) = load {
        let slot = if name.eq_ignore_ascii_case("autosave") {
            None
        } else {
            Some(name.as_str())
        };
        let save = store.load_save(record, &project, slot)?;
        if save.fingerprint != record.fingerprint {
            eprintln!(
                "Warning: content was replaced under this version. The restored state passed compatibility validation."
            )
        };
        let session = Session::restore(project, save.state)?;
        show_restored(&session, &name, colour)?;
        let saved = session.state.clone();
        (session, Some(saved))
    } else {
        let (session, result) = Session::start(project, None)?;
        let mut saved = None;
        auto_save(store, record, &session, &mut saved);
        print_messages(&result, colour)?;
        (session, saved)
    };
    loop {
        if interactive {
            print!("> ");
            io::stdout().flush()?
        }
        let line = match read_line(&mut input) {
            Ok(v) => v,
            Err(e)
                if matches!(
                    e.kind(),
                    io::ErrorKind::InvalidData | io::ErrorKind::InvalidInput
                ) =>
            {
                eprintln!("Input rejected: {e}");
                continue;
            }
            Err(e) => return Err(e.into()),
        };
        let eof = line.is_none();
        let command = line.unwrap_or_else(|| "quit".into());
        if command.trim().is_empty() {
            continue;
        }
        let result = match session.command(&command) {
            Ok(result) => result,
            Err(error) => {
                eprintln!("Command failed and was rolled back: {error:#}");
                continue;
            }
        };
        match result.control {
            Some(HostControl::Save { name }) => {
                match store.write_save(record, &session.project, &session.state, name.as_deref()) {
                    Ok(()) => {
                        last_saved = Some(session.state.clone());
                        println!("Saved {}.", name.as_deref().unwrap_or("autosave"))
                    }
                    Err(e) => eprintln!("Could not save: {e:#}"),
                }
            }
            Some(HostControl::Load { name }) => {
                if dirty(&session, &last_saved) && !confirm_discard(&mut input, interactive)? {
                    continue;
                }
                let slot = name
                    .as_deref()
                    .filter(|n| !n.eq_ignore_ascii_case("autosave"));
                match store.load_save(record, &session.project, slot) {
                    Ok(saved) => {
                        if saved.fingerprint != record.fingerprint {
                            eprintln!(
                                "Warning: game content changed; saved state passed compatibility validation."
                            )
                        }
                        session = Session::restore(session.project.clone(), saved.state)?;
                        last_saved = Some(session.state.clone());
                        show_restored(&session, name.as_deref().unwrap_or("autosave"), colour)?;
                        // Resuming a named slot establishes the rolling autosave at that safe boundary.
                        auto_save(store, record, &session, &mut last_saved);
                    }
                    Err(e) => eprintln!("Could not load: {e:#}"),
                }
            }
            Some(HostControl::Saves) => {
                print_saves(store, &record.game_id, &record.content_version)?
            }
            Some(HostControl::Quit) => {
                if dirty(&session, &last_saved) {
                    if !interactive || eof {
                        store.write_save(record,&session.project,&session.state,None).context("Could not save remaining progress on exit; previous saves were preserved")?;
                    } else {
                        print!("Save remaining progress before quitting? [Y/n/cancel] ");
                        io::stdout().flush()?;
                        let choice = read_line(&mut input)?.unwrap_or_default();
                        match choice.trim().to_ascii_lowercase().as_str() {
                            "cancel" | "c" => continue,
                            "n" | "no" => {}
                            _ => {
                                if let Err(e) =
                                    store.write_save(record, &session.project, &session.state, None)
                                {
                                    eprintln!("Could not save: {e:#}; still playing.");
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
                    auto_save(store, record, &session, &mut last_saved)
                }
                print_messages(&result, colour)?;
            }
        }
    }
    Ok(())
}
/// Bound input allocation and consume a malformed/oversized line before reporting it.
fn read_line(reader: &mut impl BufRead) -> io::Result<Option<String>> {
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
        if bytes.len() + end <= 4097 {
            bytes.extend_from_slice(&chunk[..end]);
        } else {
            too_long = true
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
    Ok(Some(text.trim_end_matches(['\r', '\n']).into()))
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn colour_modes() {
        assert!(!colour_enabled(Colour::Auto, true, true));
        assert!(!colour_enabled(Colour::Auto, false, false));
        assert!(colour_enabled(Colour::Auto, true, false));
        assert!(colour_enabled(Colour::Always, false, true));
        assert!(!colour_enabled(Colour::Never, true, false));
    }
    #[test]
    fn input_is_bounded_and_recovers() {
        let mut input = io::Cursor::new([vec![b'x'; 5000], b"\nlook\n".to_vec()].concat());
        assert!(read_line(&mut input).is_err());
        assert_eq!(read_line(&mut input).unwrap().as_deref(), Some("look"));
        let mut invalid = io::Cursor::new(vec![255, b'\n', b'q', b'\n']);
        assert!(read_line(&mut invalid).is_err());
        assert_eq!(read_line(&mut invalid).unwrap().as_deref(), Some("q"));
    }
}
