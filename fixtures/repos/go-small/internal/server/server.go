// Package server exposes the pile over HTTP (net/http with Go 1.22 pattern routing).
package server

import (
	"encoding/json"
	"errors"
	"net/http"
	"strconv"
	"strings"

	"example.com/tsundoku/internal/meta"
	"example.com/tsundoku/internal/store"
)

// Server serves the HTTP API.
type Server struct {
	store store.Store
	meta  *meta.Client
	token string
	mux   *http.ServeMux
}

// New wires the routes. meta may be nil, in which case POST /api/books requires a title.
func New(s store.Store, m *meta.Client) *Server {
	srv := &Server{store: s, meta: m, mux: http.NewServeMux()}
	srv.mux.HandleFunc("/healthz", srv.health)
	srv.mux.HandleFunc("GET /api/books", srv.listBooks)
	srv.mux.HandleFunc("GET /api/books/{id}", srv.getBook)
	srv.mux.HandleFunc("POST /api/books", srv.createBook)
	srv.mux.HandleFunc("DELETE /api/books/{id}", srv.deleteBook)
	return srv
}

// WithToken makes every non-GET request require "Authorization: Bearer <token>". An empty token disables the check.
func (s *Server) WithToken(token string) *Server {
	s.token = token
	return s
}

// ServeHTTP implements http.Handler.
func (s *Server) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if s.token != "" && r.Method != http.MethodGet && r.URL.Path != "/healthz" {
		if got := strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer "); got != s.token {
			writeError(w, http.StatusUnauthorized, "missing or wrong API token")
			return
		}
	}
	s.mux.ServeHTTP(w, r)
}

func (s *Server) health(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

func (s *Server) listBooks(w http.ResponseWriter, r *http.Request) {
	// TODO: paginate list results
	books, err := s.store.List(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, books)
}

func (s *Server) getBook(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(w, r)
	if !ok {
		return
	}
	book, err := s.store.Get(r.Context(), id)
	if errors.Is(err, store.ErrNotFound) {
		writeError(w, http.StatusNotFound, "book not found")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, book)
}

func (s *Server) createBook(w http.ResponseWriter, r *http.Request) {
	var in struct {
		ISBN   string       `json:"isbn"`
		Title  string       `json:"title"`
		Status store.Status `json:"status"`
	}
	if err := json.NewDecoder(r.Body).Decode(&in); err != nil || in.ISBN == "" {
		writeError(w, http.StatusBadRequest, "body must be JSON with an isbn")
		return
	}
	if in.Status != "" && !in.Status.Valid() {
		writeError(w, http.StatusBadRequest, "unknown status "+string(in.Status))
		return
	}
	if in.Title == "" && s.meta != nil {
		md, err := s.meta.Fetch(r.Context(), in.ISBN)
		if err != nil {
			writeError(w, http.StatusBadGateway, err.Error())
			return
		}
		in.Title = md.Title
	}
	if in.Title == "" {
		writeError(w, http.StatusBadRequest, "title is required")
		return
	}
	book, err := s.store.Create(r.Context(), store.Book{ISBN: in.ISBN, Title: in.Title, Status: in.Status})
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusCreated, book)
}

func (s *Server) deleteBook(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(w, r)
	if !ok {
		return
	}
	err := s.store.Delete(r.Context(), id)
	if errors.Is(err, store.ErrNotFound) {
		writeError(w, http.StatusNotFound, "book not found")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func pathID(w http.ResponseWriter, r *http.Request) (int64, bool) {
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil || id <= 0 {
		writeError(w, http.StatusBadRequest, "id must be a positive integer")
		return 0, false
	}
	return id, true
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

func writeError(w http.ResponseWriter, status int, msg string) {
	writeJSON(w, status, map[string]string{"error": msg})
}
