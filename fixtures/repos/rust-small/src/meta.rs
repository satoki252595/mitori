//! Book metadata lookup. The transport is injected, so the tests need no network.

use crate::store::Book;

/// A failed lookup is retried exactly once: one initial attempt plus `MAX_RETRIES` more.
pub const MAX_RETRIES: u32 = 1;

/// What the catalogue knows about a book.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Metadata {
    pub title: String,
    pub pages: Option<u32>,
}

/// Fetches the catalogue entry of an ISBN as JSON text.
pub trait Transport {
    fn get(&self, isbn: &str) -> Result<String, String>;
}

/// Pull `"key": "value"` out of a flat JSON object (the catalogue answers with one; no JSON crate here).
fn string_field(body: &str, key: &str) -> Option<String> {
    let after_key = &body[body.find(&format!("\"{key}\""))? + key.len() + 2..];
    let after_colon = after_key.trim_start().strip_prefix(':')?.trim_start();
    let value = after_colon.strip_prefix('"')?;
    Some(value[..value.find('"')?].to_string())
}

fn number_field(body: &str, key: &str) -> Option<u32> {
    let after_key = &body[body.find(&format!("\"{key}\""))? + key.len() + 2..];
    let digits: String = after_key
        .trim_start()
        .strip_prefix(':')?
        .trim_start()
        .chars()
        .take_while(|c| c.is_ascii_digit())
        .collect();
    digits.parse().ok()
}

/// Look a book up. Transport errors and unreadable answers are retried; the error of the last
/// attempt is returned when every attempt fails.
pub fn fetch<T: Transport>(transport: &T, isbn: &str) -> Result<Metadata, String> {
    let mut last_error = String::new();
    for _attempt in 0..=MAX_RETRIES {
        match transport.get(isbn) {
            Ok(body) => match string_field(&body, "title") {
                Some(title) => {
                    return Ok(Metadata {
                        title,
                        pages: number_field(&body, "pages"),
                    })
                }
                None => last_error = format!("no title in the answer for {isbn}"),
            },
            Err(e) => last_error = e,
        }
    }
    Err(last_error)
}

/// Fill in the title of a book that has none yet.
pub fn enrich<T: Transport>(transport: &T, book: &Book) -> Result<Book, String> {
    if !book.title.is_empty() {
        return Ok(book.clone());
    }
    let found = fetch(transport, &book.isbn)?;
    Ok(Book {
        title: found.title,
        ..book.clone()
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::Cell;

    /// Fails `failures` times, then answers with a fixed entry.
    struct Scripted {
        failures: u32,
        calls: Cell<u32>,
    }

    impl Transport for Scripted {
        fn get(&self, _isbn: &str) -> Result<String, String> {
            self.calls.set(self.calls.get() + 1);
            if self.calls.get() <= self.failures {
                Err("connection reset".to_string())
            } else {
                Ok(r#"{"title": "こころ", "pages": 248}"#.to_string())
            }
        }
    }

    #[test]
    fn retries_exactly_once() {
        let flaky = Scripted {
            failures: MAX_RETRIES,
            calls: Cell::new(0),
        };
        let found = fetch(&flaky, "9784101010137").unwrap();
        assert_eq!(
            found,
            Metadata {
                title: "こころ".into(),
                pages: Some(248)
            }
        );
        assert_eq!(flaky.calls.get(), 2);

        let dead = Scripted {
            failures: 99,
            calls: Cell::new(0),
        };
        assert_eq!(
            fetch(&dead, "9784101010137"),
            Err("connection reset".to_string())
        );
        assert_eq!(dead.calls.get(), MAX_RETRIES + 1);
    }
}
