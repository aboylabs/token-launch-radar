// Entry token-radar-01 (Node 22, standard library only, tanpa network).
//
// Program membaca snapshot tersegel dari --input (file snapshot.json atau
// direktori yang memuatnya), menilai setiap protokol pre-token dengan model
// radar-2 di lib/model.ts, menulis board berperingkat ke board.json dan data
// dashboard ke data.js, lalu menyalin dashboard/ dan screenshots/ repo ini
// ke output. Terakhir menulis dossier.json dengan library make.fun yang
// di-vendor, bila dashboard dan screenshots sudah ada.
//
// Tahap build: dashboard/ dan screenshots/ dibuat agen lain dan mungkin belum
// ada saat program ini dijalankan. Bila keduanya belum ada, program tetap
// berjalan dan menulis board.json + data.js, melaporkan apa yang dilewati,
// dan menulis dossier hanya bila memungkinkan (dossier final dibuat di tahap
// integrasi, saat dashboard dan minimal 3 screenshot sudah lengkap).
//
// Di luar container grader, MAKEFUN_OUTPUT_DIR menggantikan /output:
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input ../input/snapshot.json

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { boardIssue, buildRadar, dataScript, parseSnapshot } from './lib/model.ts';
import { buildDossier } from './vendor/makefun-board.ts';

const here = fileURLToPath(new URL('.', import.meta.url));

/** Caps scorer sendiri (reference/gate.json): text cap membentuk byte, sisanya menolak. */
const TEXT_MAX_BYTES = 65_536;
const SCREENSHOT_CAPS = { max: 4, max_bytes: 524_288 };
const DASHBOARD_CAPS = { max_files: 400, max_bytes: 4_194_304 };
const IMAGE_NAME = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;

/** --name <value> dari argumen, atau fallback. */
function arg(name: string, fallback: string): string {
  const at = process.argv.indexOf(`--${name}`);
  if (at >= 0 && at + 1 < process.argv.length) return process.argv[at + 1]!;
  const withEquals = process.argv.find((a) => a.startsWith(`--${name}=`));
  return withEquals === undefined ? fallback : withEquals.slice(name.length + 3);
}

function fail(message: string, code = 1): never {
  process.stderr.write(`token radar: ${message}\n`);
  process.exit(code);
}

const inputArg = arg('input', '/input');
const inputFile = inputArg.endsWith('.json') ? inputArg : join(inputArg, 'snapshot.json');
if (!existsSync(inputFile)) {
  fail(`no snapshot at ${inputFile}: pass --input <snapshot.json|directory> or mount the sealed /input`, 2);
}
const out = arg('output', process.env.MAKEFUN_OUTPUT_DIR ?? '/output');

const snapshot = parseSnapshot(readFileSync(inputFile, 'utf8'));
const { board, radar } = buildRadar(snapshot);
const issue = boardIssue(board, snapshot);
if (issue !== null) {
  fail(`the model wrote a board the gate refuses: ${issue}`);
}

mkdirSync(out, { recursive: true });
writeFileSync(join(out, 'board.json'), `${JSON.stringify({ rows: board })}\n`);
writeFileSync(join(out, 'data.js'), dataScript(radar));

/**
 * Salin satu direktori (rekursif, hanya file reguler) ke `to`, melewati nama
 * yang diawali titik. Mengembalikan path relatif file yang disalin.
 */
function copyTree(from: string, to: string, rel = ''): string[] {
  if (!existsSync(from)) return [];
  const copied: string[] = [];
  for (const name of readdirSync(from)) {
    if (name.startsWith('.')) continue;
    const path = join(from, name);
    const dest = join(to, name);
    const st = statSync(path);
    if (st.isDirectory()) {
      copied.push(...copyTree(path, dest, rel === '' ? name : `${rel}/${name}`));
    } else if (st.isFile()) {
      mkdirSync(to, { recursive: true });
      copyFileSync(path, dest);
      copied.push(rel === '' ? name : `${rel}/${name}`);
    }
  }
  return copied;
}

const dashFiles = copyTree(join(here, 'dashboard'), join(out, 'dashboard'));
const shots = copyTree(join(here, 'screenshots'), join(out, 'screenshots'));
const dashMissing = dashFiles.length === 0 && !existsSync(join(here, 'dashboard'));
const shotsMissing = shots.length === 0 && !existsSync(join(here, 'screenshots'));

if (dashMissing) {
  process.stderr.write('token radar: dashboard/ not present yet: skipped copying the dashboard (board.json and data.js are still written)\n');
}
if (shotsMissing) {
  process.stderr.write('token radar: screenshots/ not present yet: skipped copying screenshots (board.json and data.js are still written)\n');
} else if (shots.length < 3) {
  process.stderr.write(
    `token radar: screenshots/ holds ${shots.length} image${shots.length === 1 ? '' : 's'}: hand in 3, the board, a detail view and a filtered view (dossier deferred to integration)\n`,
  );
}
for (const name of shots) {
  const base = name.split('/').pop()!;
  if (!IMAGE_NAME.test(base)) {
    fail(`screenshots/${name}: a name is letters, digits and . _ -, 1 to 128 characters`);
  }
}

// Dossier ditulis terakhir, hanya bila dashboard dan screenshot tersedia:
// scorer membangun ulang dossier dari /output ini dan membandingkan byte.
let dossierWritten = false;
if (!dashMissing && shots.length > 0) {
  try {
    writeFileSync(
      join(out, 'dossier.json'),
      buildDossier(out, { text_max_bytes: TEXT_MAX_BYTES, screenshots: SCREENSHOT_CAPS, dashboard: DASHBOARD_CAPS }),
    );
    dossierWritten = true;
  } catch (err) {
    process.stderr.write(
      `token radar: dossier deferred: ${(err as Error).message} (board.json and data.js are still written)\n`,
    );
  }
} else {
  process.stderr.write('token radar: dossier deferred to integration: dashboard/ or screenshots/ not present yet\n');
}

process.stdout.write(
  `token radar: ${snapshot.protocols.length} protocols, ${snapshot.watchlist.length} on the watchlist, ${board.length} rows scored (${radar.early_size} early, ${radar.live_size} live set aside)\n` +
    `token radar: wrote ${join(out, 'board.json')}, ${join(out, 'data.js')}` +
    (dashFiles.length > 0 ? `, ${join(out, 'dashboard')} (${dashFiles.length} files)` : ', dashboard/ skipped (not present yet)') +
    (shots.length > 0 ? `, ${join(out, 'screenshots')} (${shots.length} images)` : ', screenshots/ skipped (not present yet)') +
    (dossierWritten ? ` and ${join(out, 'dossier.json')}\n` : ' and no dossier.json yet (deferred)\n'),
);
