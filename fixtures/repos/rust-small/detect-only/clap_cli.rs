// The clap-based command line the project is moving to. Cargo never builds this directory (the crate has no
// dependencies yet); it exists so that tooling can see what the derive-based CLI will look like.
use std::path::PathBuf;

use clap::{Parser, Subcommand};

#[derive(Parser)]
#[command(name = "tsundoku", about = "Manage the pile of books you have not read yet")]
struct Cli {
    #[command(subcommand)]
    command: Command,
}

#[derive(Subcommand)]
enum Command {
    /// Start the HTTP service.
    Serve {
        /// Port to listen on.
        #[arg(long)]
        port: Option<u16>,
    },
    /// Import books from a CSV file (isbn,title,status).
    Import {
        file: PathBuf,
        /// Validate the file without storing anything.
        #[arg(long)]
        dry_run: bool,
    },
    /// Print the pile.
    Export {
        #[arg(long, default_value = "json")]
        format: String,
    },
}

fn main() {
    match Cli::parse().command {
        Command::Serve { port } => println!("serve {port:?}"),
        Command::Import { file, dry_run } => println!("import {} {dry_run}", file.display()),
        Command::Export { format } => println!("export {format}"),
    }
}
