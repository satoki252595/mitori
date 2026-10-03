// Command tsundoku manages the pile of books you bought and have not read yet.
//
//	tsundoku serve  [-port N]
//	tsundoku import [-dry-run] FILE.csv
//	tsundoku export [-format json]
package main

import (
	"context"
	"encoding/csv"
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"strings"

	"example.com/tsundoku/internal/config"
	"example.com/tsundoku/internal/server"
	"example.com/tsundoku/internal/store"
)

func main() {
	if len(os.Args) < 2 {
		fmt.Fprintln(os.Stderr, "usage: tsundoku serve|import|export [flags]")
		os.Exit(2)
	}
	cfg := config.Load()
	pile := store.NewMemoryStore(nil)

	var err error
	switch os.Args[1] {
	case "serve":
		err = serve(cfg, pile, os.Args[2:])
	case "import":
		err = importCSV(pile, os.Args[2:])
	case "export":
		err = export(pile, os.Args[2:], os.Stdout)
	default:
		err = fmt.Errorf("unknown command %q", os.Args[1])
	}
	if err != nil {
		fmt.Fprintln(os.Stderr, "tsundoku:", err)
		os.Exit(1)
	}
}

func serve(cfg config.Config, pile store.Store, args []string) error {
	fs := flag.NewFlagSet("serve", flag.ExitOnError)
	port := fs.Int("port", cfg.Port, "port to listen on")
	if err := fs.Parse(args); err != nil {
		return err
	}
	addr := fmt.Sprintf(":%d", *port)
	log.Printf("tsundoku listening on %s (log level %s)", addr, cfg.LogLevel)
	return http.ListenAndServe(addr, server.New(pile, nil).WithToken(cfg.APIToken))
}

func importCSV(pile store.Store, args []string) error {
	fs := flag.NewFlagSet("import", flag.ExitOnError)
	dryRun := fs.Bool("dry-run", false, "validate the file without storing anything")
	if err := fs.Parse(args); err != nil {
		return err
	}
	if fs.NArg() != 1 {
		return fmt.Errorf("import needs exactly one CSV file")
	}
	f, err := os.Open(fs.Arg(0))
	if err != nil {
		return err
	}
	defer f.Close()

	rows, err := csv.NewReader(f).ReadAll()
	if err != nil {
		return err
	}
	imported := 0
	for i, row := range rows {
		if i == 0 && strings.EqualFold(row[0], "isbn") {
			continue // header
		}
		if len(row) < 2 || row[0] == "" || row[1] == "" {
			return fmt.Errorf("row %d: isbn and title are required", i+1)
		}
		if !*dryRun {
			b := store.Book{ISBN: row[0], Title: row[1]}
			if len(row) > 2 {
				b.Status = store.Status(row[2])
			}
			if _, err := pile.Create(context.Background(), b); err != nil {
				return err
			}
		}
		imported++
	}
	fmt.Printf("%d books\n", imported)
	return nil
}

func export(pile store.Store, args []string, out io.Writer) error {
	fs := flag.NewFlagSet("export", flag.ExitOnError)
	format := fs.String("format", "json", "output format")
	if err := fs.Parse(args); err != nil {
		return err
	}
	if *format != "json" {
		return fmt.Errorf("unsupported export format %q", *format)
	}
	books, err := pile.List(context.Background())
	if err != nil {
		return err
	}
	enc := json.NewEncoder(out)
	enc.SetIndent("", "  ")
	return enc.Encode(books)
}
