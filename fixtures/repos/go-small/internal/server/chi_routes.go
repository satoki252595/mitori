//go:build ignore

package server

import (
	"net/http"

	"github.com/go-chi/chi/v5"

	"example.com/tsundoku/internal/store"
)

// ChiRouter is the v2 API on top of chi. It is not compiled yet (chi is not a dependency of the module);
// it documents where /v2 is heading.
func ChiRouter(s store.Store) http.Handler {
	r := chi.NewRouter()
	srv := New(s, nil)
	r.Get("/v2/books", srv.listBooks)
	r.Post("/v2/books", srv.createBook)
	return r
}
