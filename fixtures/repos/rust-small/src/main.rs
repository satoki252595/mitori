//! Command line: `tsundoku serve [--port N] | import [--dry-run] FILE | export [--format json]`.

use std::env;
use std::fs;
use std::io::{Read, Write};
use std::net::TcpListener;
use std::process::ExitCode;

use tsundoku::config::Config;
use tsundoku::meta;
use tsundoku::store::{MemoryStore, Status, Store};

fn main() -> ExitCode {
    let args: Vec<String> = env::args().skip(1).collect();
    let mut store = MemoryStore::new();
    let result = match args.first().map(String::as_str) {
        Some("serve") => serve(&args[1..]),
        Some("import") => import(&mut store, &args[1..]),
        Some("export") => export(&store, &args[1..]),
        _ => Err("usage: tsundoku serve|import|export [flags]".to_string()),
    };
    match result {
        Ok(()) => ExitCode::SUCCESS,
        Err(message) => {
            eprintln!("tsundoku: {message}");
            ExitCode::FAILURE
        }
    }
}

/// Value of `--name VALUE`, if given.
fn flag_value<'a>(args: &'a [String], name: &str) -> Option<&'a str> {
    let at = args.iter().position(|a| a == name)?;
    args.get(at + 1).map(String::as_str)
}

fn serve(args: &[String]) -> Result<(), String> {
    let config = Config::from_env().map_err(|e| e.to_string())?;
    let port = match flag_value(args, "--port") {
        Some(p) => p
            .parse::<u16>()
            .map_err(|_| format!("invalid --port: {p}"))?,
        None => config.port,
    };
    let listener = TcpListener::bind(("127.0.0.1", port)).map_err(|e| e.to_string())?;
    println!(
        "tsundoku listening on :{port} (log level {})",
        config.log_level
    );
    for stream in listener.incoming().flatten() {
        let mut stream = stream;
        let mut buf = [0u8; 1024];
        let _ = stream.read(&mut buf);
        let body = r#"{"status":"ok"}"#;
        let reply = format!(
            "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\n\r\n{body}",
            body.len()
        );
        let _ = stream.write_all(reply.as_bytes());
    }
    Ok(())
}

fn import(store: &mut MemoryStore, args: &[String]) -> Result<(), String> {
    let dry_run = args.iter().any(|a| a == "--dry-run");
    let file = args
        .iter()
        .find(|a| !a.starts_with("--"))
        .ok_or("import needs a CSV file")?;
    let text = fs::read_to_string(file).map_err(|e| format!("{file}: {e}"))?;
    let mut imported = 0;
    for (n, line) in text.lines().enumerate().skip(1) {
        let cells: Vec<&str> = line.split(',').map(str::trim).collect();
        let [isbn, title, rest @ ..] = cells.as_slice() else {
            return Err(format!("row {}: isbn and title are required", n + 1));
        };
        let status = rest
            .first()
            .and_then(|s| Status::parse(s))
            .unwrap_or(Status::Unread);
        if !dry_run {
            store
                .create(isbn, title, status)
                .map_err(|e| format!("row {}: {e}", n + 1))?;
        }
        imported += 1;
    }
    println!(
        "{imported} books (lookups retry {} time)",
        meta::MAX_RETRIES
    );
    Ok(())
}

fn export(store: &MemoryStore, args: &[String]) -> Result<(), String> {
    match flag_value(args, "--format").unwrap_or("json") {
        "json" => {
            let rows: Vec<String> = store
                .list()
                .iter()
                .map(|b| {
                    format!(
                        r#"{{"id":{},"isbn":"{}","title":"{}","status":"{}"}}"#,
                        b.id,
                        b.isbn,
                        b.title,
                        b.status.as_str()
                    )
                })
                .collect();
            println!("[{}]", rows.join(","));
            Ok(())
        }
        other => Err(format!("unsupported export format {other:?}")),
    }
}
