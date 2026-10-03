use tsundoku::store::{MemoryStore, Status, Store, StoreError};

#[test]
fn create_assigns_id() {
    let mut store = MemoryStore::new();
    let first = store
        .create("9784101001012", "吾輩は猫である", Status::Unread)
        .unwrap();
    let second = store
        .create("9784101010014", "坊っちゃん", Status::Reading)
        .unwrap();
    assert_eq!((first.id, second.id), (1, 2));
    assert_eq!(store.get(2).map(|b| b.status), Some(Status::Reading));
    assert_eq!(
        store.create(" ", "no isbn", Status::Unread),
        Err(StoreError::MissingIsbn)
    );
}

#[test]
fn delete_is_idempotent() {
    let mut store = MemoryStore::new();
    let book = store
        .create("9784101001012", "吾輩は猫である", Status::Unread)
        .unwrap();
    assert!(store.delete(book.id));
    assert!(!store.delete(book.id));
    assert!(store.get(book.id).is_none());
}
