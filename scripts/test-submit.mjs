#!/usr/bin/env node
/**
 * test-submit.mjs — POST a fake quiz-result/2 payload to your Apps Script /exec
 * URL, so you can confirm a row lands in the Sheet without taking a real quiz.
 *
 * Usage:
 *   node scripts/test-submit.mjs --url "https://script.google.com/macros/s/XXXX/exec"
 *   node scripts/test-submit.mjs --url "...exec" --token "your-secret"   # if SECRET is set
 *   node scripts/test-submit.mjs --url "...exec" --fail                  # send a failing result
 *
 * Sends as text/plain (a simple CORS request — matches how the quiz page posts).
 * Prints the receiver's JSON reply: {"ok":true} means the row was appended.
 * Exit 0 = receiver replied ok:true, 1 = anything else.
 */

function parseArgs(argv) {
  const a = {};
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    if (k === '--url') a.url = argv[++i];
    else if (k === '--token') a.token = argv[++i];
    else if (k === '--fail') a.fail = true;
    else if (k === '--help' || k === '-h') a.help = true;
    else throw new Error(`Unknown argument: ${k}`);
  }
  return a;
}

function samplePayload(fail) {
  const now = new Date().toISOString();
  return {
    schema: 'quiz-result/2',
    course: 'TEST — platform check',
    email: 'test@example.com',
    generatedAt: now,
    takenAt: now,
    score: fail ? 33.3 : 100,
    passScore: 80,
    passed: !fail,
    correct: fail ? 1 : 3,
    total: 3,
    unanswered: 0,
    earned: fail ? 1 : 3,
    elapsedSeconds: 42,
    seed: 12345,
    attempt: { mode: 'full', retryWrongOnly: false },
    bySection: [
      { section: 'Basics', pct: fail ? 50 : 100 },
      { section: 'Payload', pct: fail ? 0 : 100 },
    ],
    missed: fail ? ['Why text/plain content type on submit?', 'Which appear in quiz-result/2?'] : [],
    perQuestion: [
      { sourceIndex: 0, promptHash: 'deadbeef', section: 'Basics', type: 'single',
        prompt: 'sample question', answered: true, correct: !fail, credit: fail ? 0 : 1,
        hits: fail ? 0 : 1, misses: fail ? 1 : 0, selectedCount: 1 },
    ],
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || !args.url) {
    console.log('Usage: node scripts/test-submit.mjs --url "<exec-url>" [--token secret] [--fail]');
    process.exit(args.help ? 0 : 1);
  }
  let url = args.url;
  if (args.token) url += (url.includes('?') ? '&' : '?') + 'token=' + encodeURIComponent(args.token);

  const body = JSON.stringify(samplePayload(args.fail));
  let res;
  try {
    // text/plain: a "simple" CORS request, no preflight — same as the quiz page.
    // redirect: follow — Apps Script /exec 302-redirects to a googleusercontent host.
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body,
      redirect: 'follow',
    });
  } catch (e) {
    console.error(`ERROR: request failed — ${e.message}`);
    process.exit(1);
  }

  const text = await res.text();
  console.log(`HTTP ${res.status}`);
  console.log(text);
  let ok = false;
  try { ok = JSON.parse(text).ok === true; } catch { /* not JSON */ }
  if (ok) { console.log('\n✔ Receiver accepted the result — check the Sheet for a new row.'); process.exit(0); }
  console.error('\n✘ Receiver did not return ok:true. Check the URL, deployment access, and SECRET/token.');
  process.exit(1);
}

main();
