//go:build ignore

// This is the cobra-based command line the project is moving to. It is excluded from the build (the module has
// no third-party dependencies yet); cmd/tsundoku keeps the standard-library version running.
package main

import (
	"fmt"
	"net/http"
	"os"

	"github.com/spf13/cobra"

	"example.com/tsundoku/internal/config"
	"example.com/tsundoku/internal/server"
	"example.com/tsundoku/internal/store"
)

func main() {
	root := &cobra.Command{Use: "tsundoku", Short: "Manage the pile of books you have not read yet"}

	var port int
	serve := &cobra.Command{
		Use:   "serve",
		Short: "start the HTTP service",
		RunE: func(cmd *cobra.Command, _ []string) error {
			cfg := config.Load()
			if !cmd.Flags().Changed("port") {
				port = cfg.Port
			}
			return http.ListenAndServe(fmt.Sprintf(":%d", port), server.New(store.NewMemoryStore(nil), nil))
		},
	}
	serve.Flags().IntVar(&port, "port", 0, "port to listen on")

	var dryRun bool
	importCmd := &cobra.Command{
		Use:   "import FILE",
		Short: "import books from a CSV file",
		Args:  cobra.ExactArgs(1),
		RunE: func(_ *cobra.Command, args []string) error {
			fmt.Println("importing", args[0], "dry-run:", dryRun)
			return nil
		},
	}
	importCmd.Flags().BoolVar(&dryRun, "dry-run", false, "validate without storing")

	var format string
	exportCmd := &cobra.Command{
		Use:   "export",
		Short: "print the pile",
		RunE: func(_ *cobra.Command, _ []string) error {
			fmt.Println("exporting as", format)
			return nil
		},
	}
	exportCmd.Flags().StringVar(&format, "format", "json", "output format")

	root.AddCommand(serve, importCmd, exportCmd)
	if err := root.Execute(); err != nil {
		os.Exit(1)
	}
}
