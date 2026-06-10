// Headless validation of the precision pipeline's deterministic core.
// No API calls — exercises the dev hook (window.__restail) against a real
// resume whose Word ground truth is known:
//   VMADp_Sf.docx → 82 top-level paragraphs, renders EXACTLY 2 pages in
//   MS Word, summary paragraph (id 4) = 7 rendered lines, name in a textbox.
//
// Usage: node test/validate-core.mjs [path-to-docx]
import { chromium } from 'playwright-core';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const CHROME = process.env.CHROME_PATH ||
  `${process.env.LOCALAPPDATA}\\ms-playwright\\chromium-1217\\chrome-win64\\chrome.exe`;
const APP_URL = process.env.APP_URL || 'http://localhost:3000';
const DOCX = resolve(process.argv[2] || 'C:/Users/penta/Downloads/VMADp_Sf.docx');

const b64 = readFileSync(DOCX).toString('base64');

let pass = 0, fail = 0;
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
  ok ? pass++ : fail++;
};

const browser = await chromium.launch({ executablePath: CHROME, headless: true });
try {
  const page = await browser.newPage();
  page.on('console', m => { if (m.type() === 'error') console.log('  [browser]', m.text()); });
  await page.goto(APP_URL, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => (window).__restail != null, null, { timeout: 30000 });

  const result = await page.evaluate(async (b64) => {
    const R = window.__restail;
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const buffer = bytes.buffer;

    // ── 1. Paragraph table ──
    const paras = await R.extractParagraphTable(buffer.slice(0));

    // ── 2. Layout measurement ──
    const m = await R.measureDocxBuffer(buffer.slice(0));

    // ── 3. ID-addressed application round-trip (same-length swaps) ──
    const mods = [
      { paragraph_id: 21, new_content: 'Troubleshot Snowflake and Oracle SQL workloads, resolving recurring slow queries and lifting performance 25%.', original_excerpt: '' },
      { paragraph_id: 20, new_content: 'Built **Python**, SQL, and **Airflow** automations processing 50K+ records daily, cutting latency 30% and toil.', original_excerpt: '' },
    ];
    const { buffer: modBuf, applied, warnings } = await R.applyModificationsByIdToBuffer(buffer.slice(0), mods);
    const parasAfter = await R.extractParagraphTable(modBuf.slice(0));
    const mAfter = await R.measureDocxBuffer(modBuf.slice(0));

    // ── 4. Locked-paragraph rejection ──
    const lockTry = await R.applyModificationsByIdToBuffer(
      buffer.slice(0),
      [{ paragraph_id: 1, new_content: 'HACKED TITLE', original_excerpt: '' }],
      new Set([1])
    );

    // ── 4b. Mixed title+contact paragraph: title swap preserves contact ──
    const titleTry = await R.applyModificationsByIdToBuffer(
      buffer.slice(0),
      [{ paragraph_id: 1, new_content: 'Site Reliability Engineer – Software & AI Automation', original_excerpt: '' }]
    );
    const titleParas = await R.extractParagraphTable(titleTry.buffer.slice(0));

    // ── 5. Keyword scoring sanity ──
    const kw = [
      { term: 'node.js', variants: ['nodejs'], weight: 3 },
      { term: 'sre', weight: 3 },
      { term: 'powershell', weight: 2 },
      { term: 'ci/cd', weight: 2 },
      { term: 'alert noise', weight: 1 },
    ];
    const score = R.scoreTextAgainstKeywords(
      'Node.js engineer; CI/CD pipelines; reduced alert-noise daily.', kw);

    return {
      paraCount: paras.length,
      lockedSummary: paras.filter(p => p.locked).slice(0, 8).map(p => `${p.id}:${p.lockReason}`),
      p0Text: paras[0]?.fullText,
      p1Text: paras[1]?.text,
      p4Len: paras[4]?.text?.length,
      pages: m.pages,
      contentHeight: m.contentHeight,
      lineHeight: m.lineHeight,
      mPara: m.paraCount,
      lines4: m.paraLines.length > 4 ? null : null, // computed via alignment below
      paraTexts0: m.paraTexts.slice(0, 8),
      paraLines: m.paraLines,
      paraTexts: m.paraTexts,
      applied, warnings,
      after21: parasAfter[21]?.text,
      after20: parasAfter[20]?.text,
      after22: parasAfter[22]?.text,
      afterCount: parasAfter.length,
      afterHeight: mAfter.contentHeight,
      lockApplied: lockTry.applied,
      lockWarnings: lockTry.warnings,
      titleAfter: titleParas[1]?.fullText,
      score,
      parasBrief: paras.slice(0, 8).map(p => ({ id: p.id, locked: p.locked, t: (p.fullText || '').slice(0, 40) })),
    };
  }, b64);

  // Align summary paragraph (id 4) to its rendered line count by text match.
  const norm = s => (s || '').replace(/\s+/g, ' ').trim().toLowerCase();
  const sumPrefix = 'senior software engineer & ai systems architect';
  const domIdx = result.paraTexts.findIndex(t => norm(t).startsWith(sumPrefix));
  const lines4 = domIdx >= 0 ? result.paraLines[domIdx] : -1;

  // ── Assertions vs Word ground truth ──
  check('paragraph count = 82 (textbox paragraphs excluded)', result.paraCount === 82, `got ${result.paraCount}`);
  check('P0 = candidate name, locked; no false locks on headers/skills lines',
    result.lockedSummary.includes('0:name') &&
    !result.lockedSummary.some(s => s === '3:name' || s === '14:contact'),
    `p0=${JSON.stringify(result.p0Text)} locked=${result.lockedSummary.join(',')}`);
  check('headline (P1) editable text correct',
    (result.p1Text || '').startsWith('Software Engineer'), JSON.stringify(result.p1Text));
  check('title swap preserves contact info in mixed paragraph',
    (result.titleAfter || '').includes('Site Reliability Engineer') &&
    (result.titleAfter || '').includes('pentalavenumadhav@gmail.com') &&
    (result.titleAfter || '').includes('3179559198') &&
    !(result.titleAfter || '').includes('Software Engineer AI & Data'),
    JSON.stringify((result.titleAfter || '').slice(0, 120)));
  check('summary (P4) ~850 chars', result.p4Len > 800 && result.p4Len < 900, `got ${result.p4Len}`);
  check('estimated pages = 2 (Word ground truth)', result.pages === 2, `got ${result.pages}`);
  check('summary renders 7 lines (Word: 7)', lines4 >= 6 && lines4 <= 8, `got ${lines4} (domIdx ${domIdx})`);
  check('content height plausible (≈2 A4 pages)',
    result.contentHeight > 1500 && result.contentHeight < 3200, `got ${Math.round(result.contentHeight)}px, lineH ${result.lineHeight.toFixed(1)}`);
  check('ID-apply: 2/2 applied, no warnings',
    result.applied === 2 && result.warnings.length === 0,
    `applied=${result.applied} warn=${result.warnings.join(';')}`);
  check('ID-apply: P21 replaced exactly',
    (result.after21 || '').startsWith('Troubleshot Snowflake'), JSON.stringify((result.after21 || '').slice(0, 60)));
  check('ID-apply: P20 replaced (bold markers consumed)',
    (result.after20 || '').startsWith('Built Python, SQL, and Airflow') && !(result.after20 || '').includes('**'),
    JSON.stringify((result.after20 || '').slice(0, 60)));
  check('ID-apply: neighbor P22 untouched',
    (result.after22 || '').startsWith('Visualized 100K+'), JSON.stringify((result.after22 || '').slice(0, 50)));
  check('ID-apply: paragraph count stable', result.afterCount === 82, `got ${result.afterCount}`);
  check('ID-apply: content height stable after equal-length swaps',
    Math.abs(result.afterHeight - result.contentHeight) < result.lineHeight * 0.6,
    `Δ=${(result.afterHeight - result.contentHeight).toFixed(1)}px`);
  check('locked paragraph rejected', result.lockApplied === 0 && result.lockWarnings.length === 1,
    `applied=${result.lockApplied} warn=${result.lockWarnings.join(';')}`);
  check('keyword scorer: hits node.js + ci/cd + alert-noise, misses sre + powershell',
    result.score.matched.includes('node.js') && result.score.matched.includes('ci/cd') &&
    result.score.matched.includes('alert noise') && result.score.missing.includes('sre') &&
    result.score.missing.includes('powershell'),
    JSON.stringify({ matched: result.score.matched, missing: result.score.missing, score: result.score.score }));

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exitCode = fail ? 1 : 0;
} finally {
  await browser.close();
}
