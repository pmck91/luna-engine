use anyhow::{Context, Result};
use clap::Parser;
use std::path::PathBuf;
#[derive(Parser)]
#[command(version, about = "Luna's local visual game editor")]
struct Args {
    /// Override the editor configuration file (useful for isolated testing).
    #[arg(long)]
    config: Option<PathBuf>,
    #[arg(long)]
    projects_dir: Option<PathBuf>,
    #[arg(long, default_value_t = 4318)]
    port: u16,
    #[arg(long)]
    no_browser: bool,
}
#[tokio::main]
async fn main() {
    if let Err(error) = run().await {
        eprintln!("luna-editor: {error:#}");
        std::process::exit(1)
    }
}
async fn run() -> Result<()> {
    let args = Args::parse();
    let dirs = directories::ProjectDirs::from("", "", "luna")
        .context("Cannot determine per-user configuration directory")?;
    let token = luna_model::new_id();
    let app = luna_editor::App::new(
        args.config
            .unwrap_or_else(|| dirs.config_dir().join("editor.json")),
        args.projects_dir,
        token.clone(),
    )?;
    let listener = tokio::net::TcpListener::bind((std::net::Ipv4Addr::LOCALHOST, args.port))
        .await
        .context("Could not bind editor port; try --port 0")?;
    let url = format!(
        "http://127.0.0.1:{}/#token={token}",
        listener.local_addr()?.port()
    );
    println!("Luna editor: {url}");
    if !args.no_browser
        && let Err(e) = webbrowser::open(&url)
    {
        eprintln!("Could not open a browser ({e}); use the URL above.")
    }
    axum::serve(listener, luna_editor::router(app))
        .with_graceful_shutdown(async {
            let _ = tokio::signal::ctrl_c().await;
        })
        .await?;
    Ok(())
}
