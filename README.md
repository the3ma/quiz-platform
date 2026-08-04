# quiz-platform

A **static** quiz platform. Take generated knowledge-check quizzes in the browser;
each submission is saved to a **Google Sheet** via a Google Apps Script web app.
**No backend server** — the whole thing is static files on GitHub Pages plus one
Apps Script endpoint you own.

```
GitHub Pages (this repo)                         Google
┌─────────────────────────┐   POST result       ┌──────────────────────────┐
│ index.html  (hub)        │   quiz-result/2     │ Apps Script web app       │
│ quizzes/<slug>/index.html├────────────────────▶│ doPost() → appendRow()    │
│ quizzes/manifest.json    │   (text/plain)      │        │                  │
└─────────────────────────┘                      │        ▼                  │
                                                  │   Google Sheet (Results)  │
                                                  └──────────────────────────┘
```

## How it fits together

- **Quizzes** are built with the [`course-quiz-builder`](https://github.com/the3ma/course-quiz-builder)
  skill — each is one self-contained `quiz.html`.
- The builder's **SP2 submit hook** (`config.submit`) POSTs a `quiz-result/2`
  payload on grade. Point it at your Apps Script `/exec` URL.
- The **Apps Script** receiver (`apps-script/Code.gs`) parses the payload and
  appends a row to your sheet.
- The **hub** (`index.html`) reads `quizzes/manifest.json` and lists every
  published quiz.

## Setup

### 1. Google Sheet + Apps Script receiver

1. Create a Google Sheet. Copy its ID from the URL
   (`docs.google.com/spreadsheets/d/<SHEET_ID>/edit`).
2. Create an Apps Script project (script.google.com ▸ New project), paste
   `apps-script/Code.gs`.
3. Project Settings ▸ Script Properties ▸ add `SHEET_ID = <your id>`
   (optionally `SHEET_NAME`, defaults to `Results`).
4. **(Recommended)** add `SECRET = <a long random string>` — this endpoint is an
   unauthenticated write URL; the secret gates it. See "Shared secret" below.
5. Deploy ▸ New deployment ▸ **Web app**: *Execute as* **Me**, *Who has access*
   **Anyone**. Copy the **/exec** URL.
6. Sanity check: open the `/exec` URL in a browser — it should return
   `{"ok":true,...}` (that's `doGet`).
7. Confirm writes work end-to-end without taking a quiz:
   ```bash
   node scripts/test-submit.mjs --url "https://script.google.com/macros/s/XXXX/exec" --token "<SECRET>"
   ```
   `{"ok":true}` + a new row in the Sheet = wired correctly. Drop `--token` if you
   didn't set `SECRET`; add `--fail` to send a failing-score sample.

> The header row is created automatically on the first submission.

### Shared secret (recommended)

Because *Who has access* is **Anyone**, the raw `/exec` URL lets anyone append
rows. Set a `SECRET` script property, then submit to `.../exec?token=<SECRET>`.

The token goes in the **URL query string**, not a header — a custom header would
trigger a CORS preflight that Apps Script can't answer. `doPost` checks
`e.parameter.token` against `SECRET`; mismatches get `{"ok":false,"error":"unauthorized"}`.
If `SECRET` is unset the endpoint is open.

> A public repo would expose the token if you commit it. Keep the full
> `?token=` URL out of the repo — put it only in the quiz's `config.submit.url`
> at build time, and don't publish that `questions.json`.

### 2. Build a quiz that reports to it

In the quiz's `questions.json`, add:

```json
{
  "config": {
    "passScore": 80,
    "submit": {
      "url": "https://script.google.com/macros/s/XXXX/exec",
      "when": "onGradeOnce",
      "include": "full",
      "headers": { "Content-Type": "text/plain" }
    }
  }
}
```

> **`Content-Type: text/plain` is required.** Apps Script web apps do not answer
> CORS preflight requests, and `application/json` triggers one. `text/plain`
> keeps the POST a "simple request" (no preflight), and `doPost` parses the body
> as JSON regardless. The payload never contains answer keys.

Build it with the skill, then:

### 3. Publish it here

```bash
node scripts/add-quiz.mjs --html /path/to/quiz.html --slug my-course
git add quizzes/ && git commit -m "add: my-course quiz" && git push
```

`add-quiz.mjs` copies the page to `quizzes/<slug>/index.html` and registers it in
`quizzes/manifest.json`. The GitHub Pages workflow redeploys on push, and the hub
lists it automatically.

## Serving

GitHub Pages is configured via the `.github/workflows/pages.yml` workflow
(source = **GitHub Actions**). Every push to `main` redeploys the site.

## What's stored per submission

One row: `takenAt, course, schema, score, passScore, passed, correct, total,
unanswered, earned, elapsedSeconds, seed, mode, retryWrongOnly, bySection,
missed, perQuestion, rawPayload`. No learner identity is collected unless you add
it to the quiz — treat the sheet accordingly.

## Privacy / security notes

- This repo is **public**; do not commit the Apps Script URL if you consider it
  sensitive (it's an unauthenticated write endpoint — anyone with the URL can
  append rows). Consider a shared-secret field checked in `doPost` if abuse is a
  concern.
- Quiz answer keys are obfuscated in the page, **not** secure — same caveat as
  the generator. Do not use for high-stakes proctored grading.
