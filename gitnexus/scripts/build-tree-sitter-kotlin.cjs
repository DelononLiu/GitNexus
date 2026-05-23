#!/usr/bin/env node
/**
 * Build vendor/tree-sitter-kotlin native binding.
 *
 * Usage:
 *   node scripts/build-tree-sitter-kotlin.cjs                       # use system node in PATH
 *   NODE_BIN=~/nodejs/node-v22.22.2-linux-x64/bin node scripts/... # custom node binary dir
 *
 * The NODE_BIN env var points to a directory containing node, npm, npx.
 * When set, the script prepends it to PATH so that node-gyp uses the
 * correct Node version and ABI.
 *
 * Compiles the vendored tree-sitter-kotlin C source and copies the
 * resulting .node file into prebuilds/<platform>-<arch>/ so that
 * node-gyp-build picks it up at runtime without native compilation
 * during npm install.
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const SCRIPT_DIR = __dirname;
const VENDOR_DIR = path.resolve(SCRIPT_DIR, '..', 'vendor', 'tree-sitter-kotlin');
const BINDING_GYP = path.join(VENDOR_DIR, 'binding.gyp');
const BINDING_OUT = path.join(VENDOR_DIR, 'build', 'Release', 'tree_sitter_kotlin_binding.node');

const PLATFORM = process.platform;       // 'linux', 'darwin', 'win32'
const ARCH = process.arch;               // 'x64', 'arm64'
const PREBUILDS_DIR = path.join(VENDOR_DIR, 'prebuilds', `${PLATFORM}-${ARCH}`);
const PREBUILD_DEST = path.join(PREBUILDS_DIR, 'tree-sitter-kotlin.node');

// Opt-out env var (consistent with tree-sitter-dart / tree-sitter-proto).
if (process.env.GITNEXUS_SKIP_OPTIONAL_GRAMMARS === '1') {
  console.warn('[tree-sitter-kotlin] Skipping build (GITNEXUS_SKIP_OPTIONAL_GRAMMARS=1).');
  process.exit(0);
}

// Pre-flight checks.
if (!fs.existsSync(BINDING_GYP)) {
  console.warn('[tree-sitter-kotlin] binding.gyp not found at ' + BINDING_GYP);
  process.exit(0);
}

// Check for hoisted build deps.
try {
  require.resolve('node-addon-api');
  require.resolve('node-gyp-build');
} catch (resolveErr) {
  console.warn('[tree-sitter-kotlin] Skipping build: hoisted build deps not resolvable (%s).', resolveErr.message);
  console.warn('[tree-sitter-kotlin] Run from the gitnexus package root (node_modules/ must have node-addon-api + node-gyp-build).');
  process.exit(0);
}

console.log('[tree-sitter-kotlin] Building native binding (target %s-%s)…', PLATFORM, ARCH);

// If NODE_BIN is set, prepend it to PATH so the right Node version is used.
const env = { ...process.env };
if (process.env.NODE_BIN) {
  env.PATH = `${process.env.NODE_BIN}:${env.PATH}`;
}

try {
  execSync('npx node-gyp rebuild', { cwd: VENDOR_DIR, stdio: 'pipe', timeout: 300000, env });
} catch (err) {
  console.warn('[tree-sitter-kotlin] node-gyp rebuild failed:', err.message);
  if (err.stderr) console.warn(err.stderr.toString());
  console.warn('[tree-sitter-kotlin] Kotlin parsing will be unavailable.');
  process.exit(0);
}

// Copy built binary to prebuilds dir.
if (fs.existsSync(BINDING_OUT)) {
  fs.mkdirSync(PREBUILDS_DIR, { recursive: true });
  fs.copyFileSync(BINDING_OUT, PREBUILD_DEST);
  console.log('[tree-sitter-kotlin] Copied native binding to ' + PREBUILD_DEST);
} else {
  console.warn('[tree-sitter-kotlin] Build succeeded but output not found at ' + BINDING_OUT);
  process.exit(0);
}

console.log('[tree-sitter-kotlin] Native binding built and installed successfully.');
