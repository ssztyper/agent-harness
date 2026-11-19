#!/usr/bin/env bash
# The links that phone cards asked the human to open, newest last, one per line, so they can be tapped or copied in
# the phone's terminal (Moshi cards and inbox neither open nor copy links). Written by decide.sh --url.
# usage: links [n]   (default 5)
f="$(cd "$(dirname "$0")/.." && pwd)/log/links.txt"
[ -s "$f" ] || { echo "no links yet"; exit 0; }
tail -n "${1:-5}" "$f" | while IFS=$'\t' read -r at what url; do printf '%s  %s\n%s\n\n' "$at" "$what" "$url"; done
