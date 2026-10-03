use clap::{Arg, ArgAction, Command};

fn main() {
    let matches = Command::new("indexer")
        .about("Build the search index of the book titles")
        .subcommand(
            Command::new("build")
                .about("build the index")
                .arg(Arg::new("full").long("full").action(ArgAction::SetTrue)),
        )
        .get_matches();

    if let Some(build) = matches.subcommand_matches("build") {
        let mode = if build.get_flag("full") {
            "full"
        } else {
            "incremental"
        };
        println!("building the index ({mode})");
    }
}
