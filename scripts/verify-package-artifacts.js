/**
 * Verify build artifacts and package contents.
 *
 * Checks:
 * - package.json main/module/types/exports targets exist after build
 * - those targets are included in `npm pack --dry-run`
 *
 * This script is designed for CI.
 */
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const root = path.resolve(__dirname, '..');

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function normalizeExportTarget(value) {
  if (typeof value !== 'string') return null;
  if (!value.startsWith('./')) return null;
  return value.slice(2);
}

function collectExportTargets(node, out) {
  if (!node) return;
  if (typeof node === 'string') {
    const p = normalizeExportTarget(node);
    if (p) out.add(p);
    return;
  }
  if (Array.isArray(node)) {
    node.forEach((x) => collectExportTargets(x, out));
    return;
  }
  if (typeof node === 'object') {
    Object.values(node).forEach((v) => collectExportTargets(v, out));
  }
}

function fileExists(relPath) {
  return fs.existsSync(path.join(root, relPath));
}

function runNpmPackDryRunJson() {
  /**
   * IMPORTANT:
   * - `npm pack` may run lifecycle scripts (e.g. prepare), which can pollute stdout and break JSON parsing.
   * - We try to disable scripts via both CLI and env config for robustness across npm versions.
   * - We also parse JSON from mixed output defensively (as a fallback).
   */
  const stdout = execSync('npm pack --dry-run --json --ignore-scripts', {
    cwd: root,
    stdio: ['ignore', 'pipe', 'inherit'],
    encoding: 'utf8',
    env: {
      ...process.env,
      npm_config_ignore_scripts: 'true',
      npm_config_loglevel: 'silent'
    }
  });
  const data = parseJsonFromPossiblyMixedStdout(stdout);
  assert(Array.isArray(data) && data.length > 0, 'Unexpected npm pack --json output');
  const pack = data[0];
  const files = pack.files || [];
  const paths = new Set();
  for (const f of files) {
    if (typeof f === 'string') {
      paths.add(f);
      continue;
    }
    if (f && typeof f.path === 'string') {
      paths.add(f.path);
    }
  }
  return paths;
}

function parseJsonFromPossiblyMixedStdout(stdout) {
  const raw = String(stdout || '').trim();
  if (!raw) throw new Error('Empty npm pack output');

  // Fast path: pure JSON
  try {
    return JSON.parse(raw);
  } catch {
    /** fallthrough */
  }

  // Fallback: find the last JSON array/object in the output.
  const starters = ['[', '{'];
  let bestIndex = -1;
  for (const s of starters) {
    const idx = raw.lastIndexOf(s);
    bestIndex = Math.max(bestIndex, idx);
  }
  for (let i = bestIndex; i >= 0; i--) {
    const ch = raw[i];
    if (ch !== '[' && ch !== '{') continue;
    const candidate = raw.slice(i).trim();
    try {
      return JSON.parse(candidate);
    } catch {
      /** keep scanning */
    }
  }
  throw new Error('Failed to parse JSON from npm pack output');
}

function isAllowedByFilesWhitelist(relPath, filesList) {
  if (!Array.isArray(filesList) || filesList.length === 0) return true;
  const p = String(relPath || '').replace(/\\/g, '/');
  for (const raw of filesList) {
    if (typeof raw !== 'string') continue;
    const entry = raw.replace(/\\/g, '/').replace(/^\.\/+/, '').replace(/\/+$/, '');
    if (!entry) continue;
    if (p === entry) return true;
    if (p.startsWith(`${entry}/`)) return true;
  }
  return false;
}

function main() {
  const pkg = readJson(path.join(root, 'package.json'));

  const required = new Set();
  for (const field of ['main', 'module', 'types']) {
    if (typeof pkg[field] === 'string' && pkg[field]) {
      required.add(pkg[field]);
    }
  }

  collectExportTargets(pkg.exports, required);

  // Also ensure these manifest files exist (they are referenced by package.json "files")
  required.add('react/package.json');

  // 0) Ensure required artifacts are under package.json "files" whitelist
  const filesWhitelist = pkg.files;
  const notWhitelisted = [...required].filter((p) => !isAllowedByFilesWhitelist(p, filesWhitelist));
  assert(
    notWhitelisted.length === 0,
    `Artifacts are not under package.json "files" whitelist:\n${notWhitelisted.map((p) => `- ${p}`).join('\n')}`
  );

  // 1) Existence on disk
  const missing = [...required].filter((p) => !fileExists(p));
  assert(
    missing.length === 0,
    `Missing build artifacts:\n${missing.map((p) => `- ${p}`).join('\n')}`
  );

  // 2) Included in package tarball (dry-run)
  const packedFiles = runNpmPackDryRunJson();
  const notPacked = [...required].filter((p) => !packedFiles.has(p));
  assert(
    notPacked.length === 0,
    `Artifacts not included in npm package:\n${notPacked.map((p) => `- ${p}`).join('\n')}`
  );

  // eslint-disable-next-line no-console
  console.log('[verify-package-artifacts] OK');
}

main();

