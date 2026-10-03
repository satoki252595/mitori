// Command api serves the books API (gin) and the statistics API (echo, see echo.go).
package main

import (
	"log"
	"net/http"
	"os"
	"sync"

	"github.com/gin-gonic/gin"
)

// book is the wire format of one entry of the pile.
type book struct {
	ID     int    `json:"id"`
	ISBN   string `json:"isbn"`
	Title  string `json:"title"`
	Status string `json:"status"`
}

type shelf struct {
	mu    sync.Mutex
	books []book
}

func (s *shelf) all() []book {
	s.mu.Lock()
	defer s.mu.Unlock()
	return append([]book(nil), s.books...)
}

func (s *shelf) add(b book) book {
	s.mu.Lock()
	defer s.mu.Unlock()
	b.ID = len(s.books) + 1
	s.books = append(s.books, b)
	return b
}

func main() {
	if mode := os.Getenv("GIN_MODE"); mode != "" {
		gin.SetMode(mode)
	}
	pile := &shelf{}

	r := gin.New()
	r.Use(gin.Recovery())
	r.GET("/api/v1/books", func(c *gin.Context) {
		c.JSON(http.StatusOK, pile.all())
	})
	r.POST("/api/v1/books", func(c *gin.Context) {
		var in book
		if err := c.ShouldBindJSON(&in); err != nil || in.ISBN == "" {
			c.JSON(http.StatusBadRequest, gin.H{"error": "body must be JSON with an isbn"})
			return
		}
		c.JSON(http.StatusCreated, pile.add(in))
	})

	go func() { log.Fatal(statsServer(pile).Start(":8081")) }()
	log.Fatal(r.Run(":8080"))
}
