#!/usr/bin/env bash
# Copy the SQLite file next to a timestamp; keeps the last 14 copies.
set -euo pipefail

src="${1:?usage: backup.sh DB_FILE [DEST_DIR]}"
dest="${2:-backups}"

mkdir -p "$dest"
cp "$src" "$dest/$(basename "$src").$(date +%Y%m%d)"

# prune
ls -1t "$dest" | tail -n +15 | while read -r old; do
  rm -f "$dest/$old"
done
