// Package config reads the service configuration from the environment.
package config

import (
	"cmp"
	"os"
	"strconv"
)

// Config is the runtime configuration of the tsundoku service.
type Config struct {
	Port        int
	DatabaseURL string
	LogLevel    string
	APIToken    string
}

// Load reads the configuration from the environment. Command-line flags override it (see cmd/tsundoku).
func Load() Config {
	port, err := strconv.Atoi(cmp.Or(os.Getenv("PORT"), "8080"))
	if err != nil || port <= 0 {
		port = 8080
	}

	databaseURL, _ := os.LookupEnv("DATABASE_URL")

	level := os.Getenv("LOG_LEVEL")
	if level == "" {
		level = "info"
	}

	return Config{
		Port:        port,
		DatabaseURL: databaseURL,
		LogLevel:    level,
		APIToken:    os.Getenv("TSUNDOKU_API_TOKEN"),
	}
}
