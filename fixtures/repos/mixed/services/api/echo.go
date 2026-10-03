package main

import (
	"net/http"

	"github.com/labstack/echo/v4"
)

// statsServer exposes the per-status counts on its own port so that dashboards can scrape it.
func statsServer(pile *shelf) *echo.Echo {
	e := echo.New()
	e.HideBanner = true
	e.GET("/api/v1/stats", func(c echo.Context) error {
		counts := map[string]int{}
		for _, b := range pile.all() {
			counts[b.Status]++
		}
		return c.JSON(http.StatusOK, counts)
	})
	return e
}
