// Package meta looks up book metadata (title, authors, page count) by ISBN.
package meta

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"strings"
	"time"
)

// requestTimeout bounds one lookup attempt.
const requestTimeout = 10 * time.Second

// Metadata is what the catalogue knows about a book.
type Metadata struct {
	Title   string   `json:"title"`
	Authors []string `json:"authors"`
	Pages   int      `json:"pages"`
}

// Client fetches metadata from a catalogue that speaks the Open Library "books" API.
type Client struct {
	baseURL string
	http    *http.Client
}

// NewClient returns a client for the catalogue at baseURL.
func NewClient(baseURL string) *Client {
	return &Client{baseURL: strings.TrimRight(baseURL, "/"), http: &http.Client{Timeout: requestTimeout}}
}

// NormalizeISBN strips hyphens and spaces and upper-cases a trailing X.
func NormalizeISBN(raw string) string {
	return strings.ToUpper(strings.NewReplacer("-", "", " ", "").Replace(raw))
}

// Fetch returns the metadata of isbn. Any failure (network error, HTTP error, unreadable body) is returned as is.
func (c *Client) Fetch(ctx context.Context, isbn string) (Metadata, error) {
	isbn = NormalizeISBN(isbn)

	md, err := c.fetchOnce(ctx, isbn)
	if err != nil {
		return Metadata{}, fmt.Errorf("fetch metadata for %s: %w", isbn, err)
	}
	return md, nil
}

func (c *Client) fetchOnce(ctx context.Context, isbn string) (Metadata, error) {
	q := url.Values{"bibkeys": {"ISBN:" + isbn}, "format": {"json"}, "jscmd": {"data"}}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, c.baseURL+"/api/books?"+q.Encode(), nil)
	if err != nil {
		return Metadata{}, err
	}

	resp, err := c.http.Do(req)
	if err != nil {
		return Metadata{}, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return Metadata{}, fmt.Errorf("catalogue answered HTTP %d", resp.StatusCode)
	}

	var body map[string]Metadata
	if err := json.NewDecoder(resp.Body).Decode(&body); err != nil {
		return Metadata{}, fmt.Errorf("decode catalogue response: %w", err)
	}
	md, ok := body["ISBN:"+isbn]
	if !ok {
		return Metadata{}, fmt.Errorf("catalogue has no entry for %s", isbn)
	}
	return md, nil
}
