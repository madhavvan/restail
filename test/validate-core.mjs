// Headless validation of the precision pipeline's deterministic core.
// No API calls, no personal data.
//
// Two suites:
//   1. ALWAYS-ON — runs against a synthetic .docx generated below; anyone who
//      clones the repo can run it.
//   2. LOCAL FIXTURE (optional) — deep ground-truth checks against a real
//      resume on YOUR machine. Create test/local-fixture.json (gitignored)
//      from test/local-fixture.example.json to enable it.
//
// Usage:  npm run dev   (separate terminal, port 3000)
//         node test/validate-core.mjs
// Env:    APP_URL    — app origin (default http://localhost:3000)
//         CHROME_PATH — any Chrome/Chromium binary (auto-detected otherwise)
import { chromium } from 'playwright-core';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import JSZip from 'jszip';

const __dirname = dirname(fileURLToPath(import.meta.url));
const APP_URL = process.env.APP_URL || 'http://localhost:3000';

// ── Browser resolution: CHROME_PATH → playwright registry → ms-playwright ───
const resolveChrome = () => {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  try {
    const p = chromium.executablePath();
    if (p && existsSync(p)) return p;
  } catch { /* no playwright registry — fall through */ }
  const roots = [
    process.env.PLAYWRIGHT_BROWSERS_PATH,
    process.env.LOCALAPPDATA && join(process.env.LOCALAPPDATA, 'ms-playwright'),
    process.env.HOME && join(process.env.HOME, '.cache', 'ms-playwright'),
    process.env.HOME && join(process.env.HOME, 'Library', 'Caches', 'ms-playwright'),
  ].filter(Boolean);
  const leaves = ['chrome-win64/chrome.exe', 'chrome-win/chrome.exe',
    'chrome-linux/chrome', 'chrome-mac/Chromium.app/Contents/MacOS/Chromium'];
  for (const root of roots) {
    if (!existsSync(root)) continue;
    const dirs = readdirSync(root).filter(d => d.startsWith('chromium')).sort().reverse();
    for (const dir of dirs) {
      for (const leaf of leaves) {
        const p = join(root, dir, ...leaf.split('/'));
        if (existsSync(p)) return p;
      }
    }
  }
  throw new Error('No Chromium found. Set CHROME_PATH to a Chrome/Chromium binary.');
};

// ── Optional local fixture (real resume + its Word ground truth) ────────────
const FIXTURE_FILE = join(__dirname, 'local-fixture.json');
const fixture = existsSync(FIXTURE_FILE)
  ? JSON.parse(readFileSync(FIXTURE_FILE, 'utf8'))
  : null;

// ── Synthetic minimal docx — fully neutral ground truth we control ──────────
// Exercises the lock heuristics and hyperlink survival without any real
// resume: a plain-words headline (P1) that must stay EDITABLE, and a prose
// bullet (P3) with an inline hyperlink that must stay editable AND keep its
// link when the rewrite preserves the anchor text.
const buildSyntheticDocx = async () => {
  const zip = new JSZip();
  zip.file('[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`);
  zip.file('_rels/.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`);
  zip.file('word/_rels/document.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId9" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="https://github.com/example/search-service" TargetMode="External"/>
</Relationships>`);
  const P = inner => `<w:p>${inner}</w:p>`;
  const R = t => `<w:r><w:t xml:space="preserve">${t}</w:t></w:r>`;
  zip.file('word/document.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<w:body>
${P(R('John Smith'))}
${P(R('Senior Software Engineer'))}
${P(R('john.smith@example.com | 555-123-4567 | Springfield, USA'))}
${P(R('Built a distributed search service in Go serving 5K QPS — see ') + '<w:hyperlink r:id="rId9"><w:r><w:t>GitHub</w:t></w:r></w:hyperlink>' + R(' for code.'))}
${P(R('Optimized ETL pipelines cutting latency 40% across clusters.'))}
<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1080" w:right="1080" w:bottom="1080" w:left="1080"/></w:sectPr>
</w:body>
</w:document>`);
  return (await zip.generateAsync({ type: 'nodebuffer' })).toString('base64');
};

let pass = 0, fail = 0;
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
  ok ? pass++ : fail++;
};

const browser = await chromium.launch({ executablePath: resolveChrome(), headless: true });
try {
  const page = await browser.newPage();
  page.on('console', m => { if (m.type() === 'error') console.log('  [browser]', m.text()); });
  await page.goto(APP_URL, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => (window).__restail != null, null, { timeout: 30000 });

  // ═══ ALWAYS-ON SUITE — synthetic document ══════════════════════════════════
  console.log('— Always-on suite (synthetic document) —');
  const synthB64 = await buildSyntheticDocx();
  const synth = await page.evaluate(async (b64) => {
    const R = window.__restail;
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const buffer = bytes.buffer;

    const paras = await R.extractParagraphTable(buffer.slice(0));

    // Bundled mammoth (upload path) must work without any CDN
    const file = new File([bytes], 'synthetic.docx', {
      type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    });
    const rawText = await R.extractTextFromDocx(file);

    // Layout render + normalization on the synthetic doc
    const m = await R.measureDocxBuffer(buffer.slice(0));
    const normBuf = await R.normalizeDocxBuffer(buffer.slice(0));
    const mNorm = await R.measureDocxBuffer(normBuf.slice(0));

    // ID-addressed rewrite of the hyperlink bullet, anchor text preserved
    const { buffer: modBuf, applied, warnings } = await R.applyModificationsByIdToBuffer(
      buffer.slice(0),
      [{
        paragraph_id: 3,
        new_content: 'Engineered a **distributed** search service in Go at 5K+ QPS — code on GitHub.',
        original_excerpt: '',
      }]
    );
    const parasAfter = await R.extractParagraphTable(modBuf.slice(0));

    // Locked-id rejection
    const lockTry = await R.applyModificationsByIdToBuffer(
      buffer.slice(0),
      [{ paragraph_id: 0, new_content: 'HACKED NAME', original_excerpt: '' }],
      new Set([0])
    );

    // Deterministic keyword scorer
    const score = R.scoreTextAgainstKeywords(
      'Node.js engineer; CI/CD pipelines; reduced alert-noise daily.',
      [
        { term: 'node.js', variants: ['nodejs'], weight: 3 },
        { term: 'sre', weight: 3 },
        { term: 'powershell', weight: 2 },
        { term: 'ci/cd', weight: 2 },
        { term: 'alert noise', weight: 1 },
      ]
    );

    // Print-frame geometry (Letter page from sectPr, never content-sized)
    const frame = await R.preparePrintFrame(buffer.slice(0), 'synthetic');
    const printGeom = { w: frame.pageWidthIn, h: frame.pageHeightIn, sections: frame.sections };
    frame.dispose();

    const u8 = new Uint8Array(modBuf);
    let bin2 = '';
    for (let i = 0; i < u8.length; i += 0x8000) {
      bin2 += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
    }
    return {
      locks: paras.map(p => `${p.id}:${p.locked ? p.lockReason : 'open'}`),
      rawTextHead: rawText.slice(0, 120),
      pages: m.pages,
      pagesNorm: mNorm.pages,
      normDeltaLines: (mNorm.contentHeight - m.contentHeight) / (m.lineHeight || 16),
      applied, warnings,
      p3After: parasAfter[3]?.text,
      lockApplied: lockTry.applied,
      lockWarnings: lockTry.warnings,
      score,
      printGeom,
      modB64: btoa(bin2),
    };
  }, synthB64);

  check('name locked exactly once, at P0',
    synth.locks[0] === '0:name' && !synth.locks.slice(1).some(l => l.endsWith(':name')),
    synth.locks.join(','));
  check('plain-words headline "Senior Software Engineer" stays EDITABLE',
    synth.locks[1] === '1:open', synth.locks.join(','));
  check('contact line locked',
    synth.locks[2] === '2:contact', synth.locks.join(','));
  check('prose bullet with inline link stays editable; ID-mod applies cleanly',
    synth.locks[3] === '3:open' && synth.applied === 1 && synth.warnings.length === 0,
    `lock=${synth.locks[3]} applied=${synth.applied} warn=${synth.warnings.join(';')}`);
  check('rewritten bullet text correct (bold markers consumed)',
    (synth.p3After || '').startsWith('Engineered a distributed search service') &&
    !(synth.p3After || '').includes('**'),
    JSON.stringify((synth.p3After || '').slice(0, 60)));
  check('locked paragraph rejected with warning',
    synth.lockApplied === 0 && synth.lockWarnings.length === 1,
    `applied=${synth.lockApplied} warn=${synth.lockWarnings.join(';')}`);
  check('bundled mammoth extracts upload text (no CDN)',
    /john smith/i.test(synth.rawTextHead), JSON.stringify(synth.rawTextHead.slice(0, 40)));
  check('synthetic doc renders 1 page',
    synth.pages === 1, `got ${synth.pages}`);
  check('normalizeDocxBuffer geometry-neutral',
    synth.pagesNorm === synth.pages && Math.abs(synth.normDeltaLines) <= 1.5,
    `pages ${synth.pages}→${synth.pagesNorm}, Δ=${synth.normDeltaLines.toFixed(2)} lines`);
  check('keyword scorer: hits node.js + ci/cd + alert-noise, misses sre + powershell',
    synth.score.matched.includes('node.js') && synth.score.matched.includes('ci/cd') &&
    synth.score.matched.includes('alert noise') && synth.score.missing.includes('sre') &&
    synth.score.missing.includes('powershell'),
    JSON.stringify({ matched: synth.score.matched, missing: synth.score.missing }));
  check('print frame uses true Letter page size from sectPr (not content-sized)',
    Math.abs(synth.printGeom.w - 8.5) < 0.25 && Math.abs(synth.printGeom.h - 11) < 0.25,
    `got ${synth.printGeom.w.toFixed(2)}in × ${synth.printGeom.h.toFixed(2)}in`);

  const modZip = await JSZip.loadAsync(Buffer.from(synth.modB64, 'base64'));
  const modXml = await modZip.file('word/document.xml').async('string');
  check('hyperlink survives the rewrite (r:id intact, anchor re-linked)',
    modXml.includes('<w:hyperlink') && modXml.includes('rId9') &&
    />GitHub</.test(modXml.replace(/\s+/g, '')),
    modXml.includes('<w:hyperlink') ? 'hyperlink present' : 'hyperlink LOST');

  // UI sanity: all five providers selectable as writer + feedback model
  const grokButtons = await page.locator('button:has-text("Grok 4.3")').count();
  check('Grok appears in writer + feedback model grids', grokButtons >= 2,
    `found ${grokButtons} Grok buttons`);
  const labels = await page.locator('text=GPT-5.5').count();
  check('current model labels rendered', labels >= 2, `found ${labels}`);

  // ═══ LOCAL FIXTURE SUITE — real document ground truth (optional) ═══════════
  if (!fixture) {
    console.log('\nSKIP  local fixture suite — create test/local-fixture.json (see local-fixture.example.json) to enable deep ground-truth checks against a real resume.');
  } else {
    console.log('\n— Local fixture suite (real document) —');
    const E = fixture.expect;
    const b64 = readFileSync(fixture.docx).toString('base64');

    const result = await page.evaluate(async ({ b64, E }) => {
      const R = window.__restail;
      const bin = atob(b64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      const buffer = bytes.buffer;

      const paras = await R.extractParagraphTable(buffer.slice(0));
      const m = await R.measureDocxBuffer(buffer.slice(0));

      const mods = E.idSwap.mods.map(x => ({
        paragraph_id: x.paragraph_id, new_content: x.new_content, original_excerpt: '',
      }));
      const { buffer: modBuf, applied, warnings } = await R.applyModificationsByIdToBuffer(buffer.slice(0), mods);
      const parasAfter = await R.extractParagraphTable(modBuf.slice(0));
      const mAfter = await R.measureDocxBuffer(modBuf.slice(0));

      const lockTry = await R.applyModificationsByIdToBuffer(
        buffer.slice(0),
        [{ paragraph_id: E.headlineId, new_content: 'HACKED', original_excerpt: '' }],
        new Set([E.headlineId])
      );

      const titleTry = await R.applyModificationsByIdToBuffer(
        buffer.slice(0),
        [{ paragraph_id: E.titleSwap.id, new_content: E.titleSwap.newTitle, original_excerpt: '' }]
      );
      const titleParas = await R.extractParagraphTable(titleTry.buffer.slice(0));

      const frame = await R.preparePrintFrame(buffer.slice(0), 'fixture');
      const printGeom = { w: frame.pageWidthIn, h: frame.pageHeightIn, sections: frame.sections };
      frame.dispose();

      const normBuf = await R.normalizeDocxBuffer(buffer.slice(0));
      const mNorm = await R.measureDocxBuffer(normBuf.slice(0));

      return {
        paraCount: paras.length,
        locks: paras.filter(p => p.locked).map(p => `${p.id}:${p.lockReason}`),
        headlineText: paras[E.headlineId]?.text,
        summaryLen: paras[E.summary.id]?.text?.length,
        pages: m.pages,
        contentHeight: m.contentHeight,
        lineHeight: m.lineHeight,
        paraLines: m.paraLines,
        paraTexts: m.paraTexts,
        applied, warnings,
        afterTexts: E.idSwap.mods.map(x => parasAfter[x.paragraph_id]?.text),
        neighborAfter: parasAfter[E.idSwap.neighbor.id]?.text,
        afterCount: parasAfter.length,
        afterHeight: mAfter.contentHeight,
        lockApplied: lockTry.applied,
        lockWarnings: lockTry.warnings,
        titleAfter: titleParas[E.titleSwap.id]?.fullText,
        printGeom,
        pagesNorm: mNorm.pages,
        normDeltaLines: (mNorm.contentHeight - m.contentHeight) / (m.lineHeight || 16),
      };
    }, { b64, E });

    const norm = s => (s || '').replace(/\s+/g, ' ').trim().toLowerCase();
    const domIdx = result.paraTexts.findIndex(t => norm(t).startsWith(E.summary.domPrefix));
    const summaryLines = domIdx >= 0 ? result.paraLines[domIdx] : -1;

    check(`paragraph count = ${E.paraCount}`, result.paraCount === E.paraCount, `got ${result.paraCount}`);
    check('name locked exactly once, at expected paragraph',
      result.locks.filter(l => l.endsWith(':name')).join(',') === `${E.nameId}:name`,
      `name locks: ${result.locks.filter(l => l.endsWith(':name')).join(',') || 'none'}`);
    check('no false locks on known-editable paragraphs',
      E.editableIds.every(id => !result.locks.some(l => l.startsWith(`${id}:`))),
      `locks=${result.locks.join(',')}`);
    check('headline editable text correct',
      (result.headlineText || '').startsWith(E.headlinePrefix), JSON.stringify(result.headlineText));
    check('title swap preserves contact info in mixed paragraph',
      (result.titleAfter || '').includes(E.titleSwap.newTitle.split(' ')[0]) &&
      E.titleSwap.mustContain.every(s => (result.titleAfter || '').includes(s)) &&
      !(result.titleAfter || '').includes(E.titleSwap.mustNotContain),
      JSON.stringify((result.titleAfter || '').slice(0, 120)));
    check(`summary length in [${E.summary.minChars}, ${E.summary.maxChars}]`,
      result.summaryLen > E.summary.minChars && result.summaryLen < E.summary.maxChars,
      `got ${result.summaryLen}`);
    check(`estimated pages = ${E.pages} (Word ground truth)`, result.pages === E.pages, `got ${result.pages}`);
    check(`summary renders ${E.summary.renderedLines} lines (±${E.summary.linesTolerance})`,
      Math.abs(summaryLines - E.summary.renderedLines) <= E.summary.linesTolerance,
      `got ${summaryLines} (domIdx ${domIdx})`);
    check('content height plausible',
      result.contentHeight > E.contentHeightPx.min && result.contentHeight < E.contentHeightPx.max,
      `got ${Math.round(result.contentHeight)}px, lineH ${result.lineHeight.toFixed(1)}`);
    check(`ID-apply: ${E.idSwap.mods.length}/${E.idSwap.mods.length} applied, no warnings`,
      result.applied === E.idSwap.mods.length && result.warnings.length === 0,
      `applied=${result.applied} warn=${result.warnings.join(';')}`);
    E.idSwap.mods.forEach((x, i) => {
      const t = result.afterTexts[i] || '';
      const boldOk = x.new_content.includes('**') ? !t.includes('**') : true;
      check(`ID-apply: P${x.paragraph_id} replaced exactly`,
        t.startsWith(x.expectPrefix) && boldOk, JSON.stringify(t.slice(0, 60)));
    });
    check('ID-apply: neighbor untouched',
      (result.neighborAfter || '').startsWith(E.idSwap.neighbor.expectPrefix),
      JSON.stringify((result.neighborAfter || '').slice(0, 50)));
    check('ID-apply: paragraph count stable', result.afterCount === E.paraCount, `got ${result.afterCount}`);
    check('ID-apply: content height stable after equal-length swaps',
      Math.abs(result.afterHeight - result.contentHeight) < result.lineHeight * 0.6,
      `Δ=${(result.afterHeight - result.contentHeight).toFixed(1)}px`);
    check('locked paragraph rejected', result.lockApplied === 0 && result.lockWarnings.length === 1,
      `applied=${result.lockApplied} warn=${result.lockWarnings.join(';')}`);
    check('print frame uses true page size (not giant single page)',
      Math.abs(result.printGeom.w - E.pageSizeIn.w) < E.pageSizeIn.tol &&
      Math.abs(result.printGeom.h - E.pageSizeIn.h) < E.pageSizeIn.tol,
      `got ${result.printGeom.w.toFixed(2)}in × ${result.printGeom.h.toFixed(2)}in (${result.printGeom.sections} section(s))`);
    check('normalizeDocxBuffer keeps page count and height',
      result.pagesNorm === E.pages && Math.abs(result.normDeltaLines) <= 1.5,
      `pages ${result.pages}→${result.pagesNorm}, Δ=${result.normDeltaLines.toFixed(2)} lines`);
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exitCode = fail ? 1 : 0;
} finally {
  await browser.close();
}
