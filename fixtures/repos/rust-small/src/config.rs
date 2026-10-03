//! Runtime configuration, read from the environment.

use std::env;
use std::error::Error;

/// Where the (separately deployed) HTTP front end mounts the books API; used to print help texts.
pub const API_PATH: &str = "/api/books";

/// Settings of the service.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Config {
    pub port: u16,
    pub database_url: String,
    pub log_level: String,
    pub api_token: Option<String>,
}

impl Config {
    /// Read the configuration from the environment.
    ///
    /// `DATABASE_URL` is required; a `PORT` that is not a number silently falls back to 8080.
    pub fn from_env() -> Result<Config, Box<dyn Error>> {
        let port = env::var("PORT")
            .unwrap_or_else(|_| "8080".into())
            .parse::<u16>()
            .unwrap_or(8080);
        let database_url = env::var("DATABASE_URL")?;
        let log_level = env::var("LOG_LEVEL").ok().unwrap_or("info".to_string());
        let api_token = env::var_os("TSUNDOKU_API_TOKEN").map(|v| v.to_string_lossy().into_owned());
        Ok(Config {
            port,
            database_url,
            log_level,
            api_token,
        })
    }

    /// True when writes must carry `Authorization: Bearer <token>`.
    pub fn requires_token(&self) -> bool {
        self.api_token.is_some()
    }
}
