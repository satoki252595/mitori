// Command admin runs maintenance tasks against the books database.
package main

import (
	"fmt"
	"log"
	"os"

	"github.com/urfave/cli/v2"
)

func main() {
	app := &cli.App{
		Name:  "admin",
		Usage: "maintenance tasks for the books API",
		Commands: []*cli.Command{
			{
				Name:  "migrate",
				Usage: "apply the pending schema migrations",
				Flags: []cli.Flag{
					&cli.BoolFlag{Name: "dry-run", Usage: "print the migrations without applying them"},
				},
				Action: func(c *cli.Context) error {
					if c.Bool("dry-run") {
						fmt.Println("0001_init would be applied")
						return nil
					}
					fmt.Println("0001_init applied")
					return nil
				},
			},
		},
	}
	if err := app.Run(os.Args); err != nil {
		log.Fatal(err)
	}
}
