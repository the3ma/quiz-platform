#!/usr/bin/env node
/**
 * add-quiz.mjs — publish a built quiz.html into the platform and register it in
 * the hub manifest so it shows on the landing page.
 *
 * This does NOT build the quiz — build it first with the course-quiz-builder
 * skill (its config.submit.url should point at your Apps Script /exec URL, with
 * headers {"Content-Type":"text/plain"} so the POST is a simple CORS request).
 *
 * Usage:
 *   node scripts/add-quiz.mjs --html path/to/quiz.html [--slug my-course] [--force]
 *
 * It copies the page to quizzes/<slug>/index.html, reads the embedded payload to
 * fill in course/questions/topics/passScore/blurb, and updates quizzes/manifest.json.
 * Exit 0 = added/updated, 1 = failure.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const QUIZZES = join(ROOT, 'quizzes');
const MANIFEST = join(QUIZZES, 'manifest.json');

function parseArgs(argv) {
  const a = { force: false };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    if (k === '--html') a.html = argv[++i];
    else if (k === '--slug') a.slug = argv[++i];
    else if (k === '--force') a.force = true;
    else if (k === '--help' || k === '-h') a.help = true;
    else throw new Error(`Unknown argument: ${k}`);
  }
  return a;
}

function slugify(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

/** Pull the embedded quiz payload (course, question count, etc.) out of the page. */
function readPayload(html) {
  const m = /<script id="quizData" type="application\/json">([\s\S]*?)<\/script>/.exec(html);
  if (!m) return null;
  const raw = m[1].trim();
  try {
    const json = raw.charAt(0) === '{' ? raw : Buffer.from(raw, 'base64').toString('utf8');
    return JSON.parse(json);
  } catch { return null; }
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || !args.html) {
    console.log('Usage: node scripts/add-quiz.mjs --html quiz.html [--slug name] [--force]');
    process.exit(args.help ? 0 : 1);
  }
  const src = resolve(process.cwd(), args.html);
  if (!existsSync(src)) { console.error(`ERROR: not found: ${src}`); process.exit(1); }

  const html = readFileSync(src, 'utf8');
  const payload = readPayload(html);
  if (!payload) { console.error('ERROR: no quizData payload found — is this a built course-quiz-builder page?'); process.exit(1); }

  const slug = slugify(args.slug || payload.course || 'quiz');
  if (!slug) { console.error('ERROR: could not derive a slug; pass --slug'); process.exit(1); }

  const destDir = join(QUIZZES, slug);
  const destFile = join(destDir, 'index.html');
  if (existsSync(destFile) && !args.force) {
    console.error(`ERROR: ${slug} already exists. Re-run with --force to overwrite.`);
    process.exit(1);
  }
  mkdirSync(destDir, { recursive: true });
  writeFileSync(destFile, html, 'utf8');

  const cfg = payload.config || {};
  const entry = {
    slug,
    path: `quizzes/${slug}/`,
    course: payload.course || slug,
    blurb: payload.blurb || '',
    questions: Array.isArray(payload.questions) ? payload.questions.length : null,
    topics: new Set((payload.questions || []).map((q) => q.section || 'General')).size || null,
    passScore: cfg.passScore != null ? cfg.passScore : null,
  };

  let manifest = { quizzes: [] };
  if (existsSync(MANIFEST)) {
    try { manifest = JSON.parse(readFileSync(MANIFEST, 'utf8')); }
    catch { console.error('ERROR: manifest.json is not valid JSON'); process.exit(1); }
  }
  if (!Array.isArray(manifest.quizzes)) manifest.quizzes = [];
  const idx = manifest.quizzes.findIndex((q) => q.slug === slug);
  if (idx >= 0) manifest.quizzes[idx] = entry; else manifest.quizzes.push(entry);
  manifest.quizzes.sort((a, b) => String(a.course).localeCompare(String(b.course)));
  writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2) + '\n', 'utf8');

  console.log(`OK    ${idx >= 0 ? 'updated' : 'added'} "${entry.course}" → quizzes/${slug}/`);
  console.log(`      ${entry.questions} questions · ${entry.topics} topics · pass ${entry.passScore}%`);
  console.log(`      commit + push, then it appears on the landing page.`);
}

main();
