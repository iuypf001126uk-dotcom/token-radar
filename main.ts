// Token Launch Radar — entrypoint (model "radar-2").
//
// What this program does, in order:
//   1. Reads the sealed DefiLlama snapshot (default /input/snapshot.json, or --input <file|dir>).
//   2. Scores every pre-token protocol with the model in lib/model.ts and self-checks the board
//      against the gate's shape before writing anything.
//   3. Writes /output/board.json (the ranked rows) and /output/data.js (the same rows, shaped for
//      the dashboard), then copies this repo's dashboard/ and screenshots/ into /output.
//   4. Writes /output/dossier.json LAST, with the vendored make.fun library: the scorer rebuilds
//      the dossier from the finished /output and compares bytes, so nothing may change after it.
//
// Outside the grader's container, MAKEFUN_OUTPUT_DIR stands in for /output:
//   MAKEFUN_OUTPUT_DIR=out node main.ts --input ../input/snapshot.json

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { boardIssue, buildRadar, dataScript, parseSnapshot } from './lib/model.ts';
import { buildDossier } from './vendor/makefun-board.ts';

const repoDir = fileURLToPath(new URL('.', import.meta.url));

// The scorer's caps, mirrored here so the dossier is built with the same limits it is judged by.
const DOSSIER_TEXT_MAX_BYTES = 65_536;
const DOSSIER_SCREENSHOTS = { max: 4, max_bytes: 524_288 };
const DOSSIER_DASHBOARD = { max_files: 400, max_bytes: 4_194_304 };
const SCREENSHOT_NAME = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;

/** Stop with a message on stderr; exit codes match the starter's contract (2 = no input, 1 = bad board/output). */
function fail(code: number, message: string): never {
  process.stderr.write(`token radar: ${message}\n`);
  process.exit(code);
}

/** Read `--name <value>` or `--name=<value>` from the arguments, else the fallback. */
function readArg(name: string, fallback: string): string {
  const argv = process.argv;
  const at = argv.indexOf(`--${name}`);
  if (at >= 0 && at + 1 < argv.length) return argv[at + 1]!;
  const inline = argv.find((a) => a.startsWith(`--${name}=`));
  return inline === undefined ? fallback : inline.slice(name.length + 3);
}

// --- Load and score ---------------------------------------------------------

const inputArg = readArg('input', '/input');
const snapshotPath = inputArg.endsWith('.json') ? inputArg : join(inputArg, 'snapshot.json');
if (!existsSync(snapshotPath)) {
  fail(2, `no snapshot at ${snapshotPath}: pass --input <snapshot.json|directory> or mount the sealed /input`);
}
const outputDir = readArg('output', process.env.MAKEFUN_OUTPUT_DIR ?? '/output');

const snapshot = parseSnapshot(readFileSync(snapshotPath, 'utf8'));
const { board, radar } = buildRadar(snapshot);
const issue = boardIssue(board, snapshot);
if (issue !== null) fail(1, `the model wrote a board the gate refuses: ${issue}`);

// --- Write the board and the dashboard's data -------------------------------

mkdirSync(outputDir, { recursive: true });
writeFileSync(join(outputDir, 'board.json'), `${JSON.stringify({ rows: board })}\n`);
writeFileSync(join(outputDir, 'data.js'), dataScript(radar));

/** Copy a directory's regular files into the output, skipping dotfiles; returns the names copied. */
function copyInto(from: string, to: string): string[] {
  if (!existsSync(from)) return [];
  mkdirSync(to, { recursive: true });
  const names: string[] = [];
  for (const name of readdirSync(from)) {
    if (name.startsWith('.')) continue;
    const source = join(from, name);
    if (!statSync(source).isFile()) continue;
    copyFileSync(source, join(to, name));
    names.push(name);
  }
  return names;
}

copyInto(join(repoDir, 'dashboard'), join(outputDir, 'dashboard'));
const shotNames = copyInto(join(repoDir, 'screenshots'), join(outputDir, 'screenshots'));
if (shotNames.length < 3) {
  fail(1, `screenshots/ holds ${shotNames.length} image${shotNames.length === 1 ? '' : 's'}: hand in 3, the board, a detail view and a filtered view`);
}
for (const name of shotNames) {
  if (!SCREENSHOT_NAME.test(name)) {
    fail(1, `screenshots/${name}: a name is letters, digits and . _ -, 1 to 128 characters`);
  }
}

// --- The dossier goes last, over the finished output ------------------------

writeFileSync(
  join(outputDir, 'dossier.json'),
  buildDossier(outputDir, { text_max_bytes: DOSSIER_TEXT_MAX_BYTES, screenshots: DOSSIER_SCREENSHOTS, dashboard: DOSSIER_DASHBOARD }),
);

process.stdout.write(
  `token radar: ${snapshot.protocols.length} protocols, ${snapshot.watchlist.length} on the watchlist, ${board.length} rows scored (${radar.early_size} early, ${radar.live_size} live set aside)\n` +
    `token radar: wrote ${join(outputDir, 'board.json')}, ${join(outputDir, 'data.js')}, ${join(outputDir, 'dashboard')} (3 files), ${join(outputDir, 'screenshots')} (${shotNames.length} images) and ${join(outputDir, 'dossier.json')}\n`,
);
