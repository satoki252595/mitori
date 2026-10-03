package store

import (
	"context"
	"sort"
	"sync"
	"time"
)

// MemoryStore is a Store that keeps everything in process memory.
type MemoryStore struct {
	mu     sync.RWMutex
	books  map[int64]Book
	nextID int64
	now    func() time.Time
}

// NewMemoryStore returns an empty store. now stamps AddedAt (time.Now when nil).
func NewMemoryStore(now func() time.Time) *MemoryStore {
	if now == nil {
		now = time.Now
	}
	return &MemoryStore{books: make(map[int64]Book), nextID: 1, now: now}
}

// List implements Store.
func (m *MemoryStore) List(_ context.Context) ([]Book, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()

	all := make([]Book, 0, len(m.books))
	for _, b := range m.books {
		all = append(all, b)
	}
	sort.Slice(all, func(i, j int) bool { return all[i].ID < all[j].ID })
	return all, nil
}

// Get implements Store.
func (m *MemoryStore) Get(_ context.Context, id int64) (Book, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()

	b, ok := m.books[id]
	if !ok {
		return Book{}, ErrNotFound
	}
	return b, nil
}

// Create implements Store.
func (m *MemoryStore) Create(_ context.Context, b Book) (Book, error) {
	m.mu.Lock()
	defer m.mu.Unlock()

	b.ID = m.nextID
	m.nextID++
	b.AddedAt = m.now()
	if b.Status == "" {
		b.Status = StatusUnread
	}
	m.books[b.ID] = b
	return b, nil
}

// Delete implements Store.
func (m *MemoryStore) Delete(_ context.Context, id int64) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	if _, ok := m.books[id]; !ok {
		return ErrNotFound
	}
	delete(m.books, id)
	return nil
}
