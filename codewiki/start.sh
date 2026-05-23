#!/bin/bash
# CodeWiki server startup script
# Usage: ./codewiki/start.sh [port]

set -e
PORT="${1:-4747}"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
GITNEXUS_DIR="$(cd "$SCRIPT_DIR/../gitnexus" && pwd)"

NODE_BIN="${NODE_BIN:-$HOME/nodejs/node-v22.22.2-linux-x64/bin/node}"
LIBCXX="${LIBCXX:-$SCRIPT_DIR/lib/libstdc++.so.6}"

if [ ! -f "$LIBCXX" ]; then
  echo "Warning: libstdc++.so.6 not found at $LIBCXX"
  echo "Set LIBCXX env var or install a compatible version."
  echo "Continuing without LD_PRELOAD — may fail if tree-sitter native bindings need newer GLIBCXX."
fi

cd "$GITNEXUS_DIR"

if [ ! -d "node_modules" ]; then
  echo "Missing node_modules. Run: cd gitnexus && npm install"
  exit 1
fi

TSX="./node_modules/.bin/tsx"
if [ ! -f "$TSX" ]; then
  echo "tsx not found. Run: cd gitnexus && npm install"
  exit 1
fi

export LD_PRELOAD="$LIBCXX"
"$NODE_BIN" "$TSX" src/cli/index.ts serve --port "$PORT"
