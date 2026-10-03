.PHONY: build test lint fmt

build:
	go build -o bin/tsundoku ./cmd/tsundoku

test:
	go test ./...

lint:
	go vet ./...

fmt:
	gofmt -w cmd internal
