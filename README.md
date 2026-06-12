# ResuTailor AI

A client-side resume tailoring studio. Upload a `.docx` resume, paste a job description, and a precision pipeline rewrites the wording — and only the wording — to match the role, while code (not the model) guarantees the document's layout, formatting, and page count survive untouched.

Everything runs in your browser. There is no backend: your resume goes only to the LLM provider you select, with your own API key.

## How it works

The pipeline splits responsibilities by what each side is actually good at:

- **Code does all geometry.** The `.docx` is parsed into paragraphs with stable IDs; the candidate's name, contact lines, and layout spacers are locked; every editable paragraph gets a measured character budget derived from its real rendered line count.
- **The model does all wording.** It receives the numbered paragraph table plus a JD keyword matrix and returns ID-addressed rewrites under those budgets — it never touches structure, formatting, or facts (employers, titles, dates, metrics).
- **Every claim is measured, never self-reported.** The modified document is actually rendered off-screen (real fonts, real word-wrap, real pagination) and compared to the original; over-budget or layout-breaking edits bounce back to the model with exact findings, and anything that can't be fixed reverts to the original text. The ATS score shown is a deterministic keyword scan, not a model's opinion of itself.

Output is the exact verified bytes as `.docx`, or a text-based (never rasterized) PDF via the browser's print engine.

## Providers

Pick a writer and a reviewer independently in Settings — all five speak the same precision contract:

| Provider | Model |
|---|---|
| Anthropic | Claude Sonnet 4.6 |
| OpenAI | GPT-5.5 |
| Google | Gemini 3.1 Pro |
| DeepSeek | V4 Pro |
| xAI | Grok 4.3 |

## Quick start

```bash
npm install
npm run dev        # http://localhost:3000
```

Open Settings in the app and paste an API key for at least one provider. Keys are stored in your browser's `localStorage` and sent only to that provider's official API endpoint — never anywhere else. Don't enter keys on a shared machine, and prefer scoped/limited keys.

## Validation

A headless harness exercises the deterministic core (paragraph extraction, lock heuristics, ID-addressed application, hyperlink survival, layout measurement, keyword scoring, PDF geometry) against a synthetic document — no API calls, no cost:

```bash
npm run dev        # in one terminal
npm test           # in another
```

It auto-detects an installed Playwright Chromium; set `CHROME_PATH` to point at any Chrome/Chromium binary otherwise.

Optionally, copy `test/local-fixture.example.json` to `test/local-fixture.json` (gitignored) and fill in a real resume's Word ground truth to enable a deeper suite that checks rendered pages and line counts against what Microsoft Word actually shows.

## Tech

React 19 + Vite + TypeScript, fully client-side. `.docx` editing via direct OOXML manipulation (JSZip + DOMParser), layout verification via docx-preview, text extraction via mammoth. All libraries are bundled — no runtime CDN dependencies for the document engine.
