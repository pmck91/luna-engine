mod output;
mod playback;
mod terminal;

use anyhow::{Context, Result, ensure};
use clap::{Parser, Subcommand, ValueEnum};
use luna_runner::{ExistingPolicy, Storage};
use output::Output;
use serde::Deserialize;
use std::{
    fs,
    io::{self, IsTerminal},
    path::PathBuf,
};
use terminal::{Input, pick_game};

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
    /// Show terminal controls and transcript commands.
    Controls,
    /// Validate and atomically install an editor-exported .luna ZIP.
    Import {
        path: PathBuf,
        #[arg(long, value_enum)]
        on_existing: Option<OnExisting>,
    },
    /// List installed games and all content versions.
    List,
    /// Choose an installed game, or play an ID directly. Use --new or --load for scripts.
    Run {
        game_id: Option<String>,
        #[arg(long)]
        version: Option<String>,
        #[arg(long, conflicts_with = "load")]
        new: bool,
        #[arg(long)]
        load: Option<String>,
        /// Record commands and responses to a new plain-text file.
        #[arg(long)]
        transcript: Option<PathBuf>,
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
    if matches!(&cli.command, Command::Controls) {
        return output::controls(&mut Output::default());
    }
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
        Command::Controls => output::controls(&mut Output::default())?,
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
                        let response = Input::new()?.read(
                            &format!("{id} {version} already installed. Keep, replace, or cancel? [keep]: "),
                            false,
                        )?.unwrap_or_default();
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
            playback::print_saves(&store, &game_id, &version, &mut Output::default())?;
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
            transcript,
        } => {
            let picker = game_id.is_none();
            let no_colour = std::env::var_os("NO_COLOR").is_some_and(|value| !value.is_empty());
            let options = playback::Options {
                new,
                load,
                transcript,
                colour: colour_enabled(cli.color, io::stdout().is_terminal(), no_colour),
                guide_state: config_path.with_extension("guide.json"),
            };
            loop {
                let (id, selected_version) = if let Some(id) = &game_id {
                    (
                        id.clone(),
                        store.select_version(id, version.as_deref(), false)?,
                    )
                } else if let Some(record) = pick_game(&store, version.as_deref())? {
                    (record.game_id, record.content_version)
                } else {
                    break;
                };
                let selected = store.record(&id, &selected_version)?;
                let _guard = match store.version_lock(&id, &selected_version) {
                    Ok(guard) => guard,
                    Err(error) if lock_contended(&error) => {
                        let message = format!(
                            "{} (version {}) is already running or being updated. Quit the other session or wait for installation to finish, then try again.",
                            terminal::clean_label(&selected.title),
                            selected_version
                        );
                        if picker {
                            eprintln!("{message}");
                            continue;
                        }
                        return Err(anyhow::anyhow!(message));
                    }
                    Err(error) => return Err(error),
                };
                let record = store.record(&id, &selected_version)?;
                let project = store.load_game(&record)?;
                match playback::play(&store, &record, project, &options)? {
                    playback::Outcome::Back if picker => continue,
                    _ => break,
                }
            }
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
fn lock_contended(error: &anyhow::Error) -> bool {
    error
        .chain()
        .filter_map(|cause| cause.downcast_ref::<io::Error>())
        .any(|cause| cause.raw_os_error() == fs2::lock_contended_error().raw_os_error())
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
}
