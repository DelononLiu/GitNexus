#!/bin/bash
set -e
cd "$(dirname "$0")"
exec npx tsx src/server/codegraph-bridge.ts
