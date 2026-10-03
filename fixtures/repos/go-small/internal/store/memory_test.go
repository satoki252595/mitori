package store

import (
	"context"
	"errors"
	"testing"
	"time"
)

func fixedClock() time.Time { return time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC) }

func TestMemoryStore_CreateAssignsID(t *testing.T) {
	s := NewMemoryStore(fixedClock)
	ctx := context.Background()

	first, err := s.Create(ctx, Book{ISBN: "9784101001012", Title: "吾輩は猫である"})
	if err != nil {
		t.Fatal(err)
	}
	second, err := s.Create(ctx, Book{ISBN: "9784101010014", Title: "坊っちゃん", Status: StatusReading})
	if err != nil {
		t.Fatal(err)
	}

	if first.ID != 1 || second.ID != 2 {
		t.Fatalf("ids = %d, %d; want 1, 2", first.ID, second.ID)
	}
	if first.Status != StatusUnread {
		t.Errorf("default status = %q; want %q", first.Status, StatusUnread)
	}
	if !first.AddedAt.Equal(fixedClock()) {
		t.Errorf("AddedAt = %v; want %v", first.AddedAt, fixedClock())
	}
}

func TestMemoryStore_DeleteMissing(t *testing.T) {
	s := NewMemoryStore(fixedClock)

	err := s.Delete(context.Background(), 42)
	if !errors.Is(err, ErrNotFound) {
		t.Fatalf("Delete(42) error = %v; want ErrNotFound", err)
	}
}
