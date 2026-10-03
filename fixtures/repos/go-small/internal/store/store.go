// Package store holds the books on the pile.
package store

import (
	"context"
	"errors"
	"time"
)

// ErrNotFound is returned when a book id is unknown.
var ErrNotFound = errors.New("book not found")

// Status is the reading state of a book.
type Status string

// The reading states a book moves through.
const (
	StatusUnread    Status = "unread"
	StatusReading   Status = "reading"
	StatusDone      Status = "done"
	StatusAbandoned Status = "abandoned"
)

// Valid reports whether s is one of the known states.
func (s Status) Valid() bool {
	switch s {
	case StatusUnread, StatusReading, StatusDone, StatusAbandoned:
		return true
	}
	return false
}

// Book is one entry of the pile.
type Book struct {
	ID      int64     `json:"id"`
	ISBN    string    `json:"isbn"`
	Title   string    `json:"title"`
	Status  Status    `json:"status"`
	AddedAt time.Time `json:"added_at"`
}

// Store is the persistence port used by the HTTP server.
type Store interface {
	// List returns every book, oldest first.
	List(ctx context.Context) ([]Book, error)
	// Get returns one book or ErrNotFound.
	Get(ctx context.Context, id int64) (Book, error)
	// Create stores b and returns it with its id and AddedAt filled in.
	Create(ctx context.Context, b Book) (Book, error)
	// Delete removes a book or returns ErrNotFound.
	Delete(ctx context.Context, id int64) error
}
