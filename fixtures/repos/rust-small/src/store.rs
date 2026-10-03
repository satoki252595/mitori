//! The pile of books: the `Store` trait and an in-memory implementation.

use std::collections::BTreeMap;
use std::fmt;

/// Reading state of a book.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Status {
    Unread,
    Reading,
    Done,
    Abandoned,
}

impl Status {
    /// Parse a user-supplied status (case-insensitive).
    pub fn parse(s: &str) -> Option<Status> {
        match s.trim().to_ascii_lowercase().as_str() {
            "unread" => Some(Status::Unread),
            "reading" => Some(Status::Reading),
            "done" => Some(Status::Done),
            "abandoned" => Some(Status::Abandoned),
            _ => None,
        }
    }

    pub fn as_str(self) -> &'static str {
        match self {
            Status::Unread => "unread",
            Status::Reading => "reading",
            Status::Done => "done",
            Status::Abandoned => "abandoned",
        }
    }
}

/// A book on the pile.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Book {
    pub id: u64,
    pub isbn: String,
    pub title: String,
    pub status: Status,
}

/// Why a store refused an operation.
#[derive(Debug, PartialEq, Eq)]
pub enum StoreError {
    MissingIsbn,
}

impl fmt::Display for StoreError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            StoreError::MissingIsbn => write!(f, "a book needs an ISBN"),
        }
    }
}

impl std::error::Error for StoreError {}

/// Return early with `StoreError::MissingIsbn` when the ISBN is blank.
macro_rules! ensure_isbn {
    ($isbn:expr) => {
        if $isbn.trim().is_empty() {
            return Err($crate::store::StoreError::MissingIsbn);
        }
    };
}

/// Persistence port used by the command line.
pub trait Store {
    /// All books, oldest first.
    fn list(&self) -> Vec<Book>;
    /// One book, or `None` when the id is unknown.
    fn get(&self, id: u64) -> Option<Book>;
    /// Add a book and return it with its new id.
    fn create(&mut self, isbn: &str, title: &str, status: Status) -> Result<Book, StoreError>;
    /// Remove a book; returns whether something was removed (deleting twice is fine).
    fn delete(&mut self, id: u64) -> bool;
}

// XXX: store is not thread-safe
/// A `Store` that keeps everything in process memory.
#[derive(Debug, Default)]
pub struct MemoryStore {
    books: BTreeMap<u64, Book>,
    next_id: u64,
}

impl MemoryStore {
    pub fn new() -> Self {
        MemoryStore {
            books: BTreeMap::new(),
            next_id: 1,
        }
    }
}

impl Store for MemoryStore {
    fn list(&self) -> Vec<Book> {
        self.books.values().cloned().collect()
    }

    fn get(&self, id: u64) -> Option<Book> {
        self.books.get(&id).cloned()
    }

    fn create(&mut self, isbn: &str, title: &str, status: Status) -> Result<Book, StoreError> {
        ensure_isbn!(isbn);
        let id = self.next_id.max(1);
        self.next_id = id + 1;
        let book = Book {
            id,
            isbn: isbn.to_string(),
            title: title.to_string(),
            status,
        };
        self.books.insert(id, book.clone());
        Ok(book)
    }

    fn delete(&mut self, id: u64) -> bool {
        self.books.remove(&id).is_some()
    }
}
