import { Modification } from '../types';

// ─────────────────────────────────────────────────────────────────────────────
// CDN Library Loaders
// ─────────────────────────────────────────────────────────────────────────────

const CDN = {
  mammoth:   'https://cdn.jsdelivr.net/npm/mammoth@1.6.0/mammoth.browser.min.js',
  jszip:     'https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js',
  fileSaver: 'https://cdn.jsdelivr.net/npm/file-saver@2.0.5/dist/FileSaver.min.js',
};

const _loaded: Record<string, Promise<void>> = {};
const loadScript = (url: string): Promise<void> => {
  if (_loaded[url]) return _loaded[url];
  _loaded[url] = new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${url}"]`)) { resolve(); return; }
    const s = document.createElement('script');
    s.src = url; s.async = true;
    s.onload  = () => resolve();
    s.onerror = () => reject(new Error(`Failed to load CDN script: ${url}`));
    document.head.appendChild(s);
  });
  return _loaded[url];
};

const getMammoth = async (): Promise<typeof import('mammoth')> => {
  await loadScript(CDN.mammoth);
  const lib = (window as any).mammoth;
  if (!lib) throw new Error('mammoth did not attach to window after CDN load.');
  return lib;
};

const getJSZip = async (): Promise<typeof import('jszip')> => {
  await loadScript(CDN.jszip);
  const lib = (window as any).JSZip;
  if (!lib) throw new Error('JSZip did not attach to window after CDN load.');
  return lib as any;
};

const getSaveAs = async (): Promise<(blob: Blob, name: string) => void> => {
  await loadScript(CDN.fileSaver);
  const fn = (window as any).saveAs;
  if (typeof fn !== 'function') throw new Error('saveAs did not attach to window after CDN load.');
  return fn;
};

// ─────────────────────────────────────────────────────────────────────────────
// Public: Extract plain text from a .docx file
// ─────────────────────────────────────────────────────────────────────────────
export const extractTextFromDocx = async (file: File): Promise<string> => {
  const mammoth     = await getMammoth();
  const arrayBuffer = await file.arrayBuffer();
  const result      = await mammoth.extractRawText({ arrayBuffer });
  return result.value;
};

// ─────────────────────────────────────────────────────────────────────────────
// Public: Extract HTML from a .docx file
// ─────────────────────────────────────────────────────────────────────────────
export const extractHtmlFromDocx = async (file: File): Promise<string> => {
  const mammoth     = await getMammoth();
  const arrayBuffer = await file.arrayBuffer();
  const result      = await mammoth.convertToHtml({ arrayBuffer });
  return result.value;
};

// ─────────────────────────────────────────────────────────────────────────────
// Public: Get document stats
// ─────────────────────────────────────────────────────────────────────────────
export interface DocStats {
  totalChars: number;
  totalLines: number;
  paragraphBudgets: Array<{ text: string; maxChars: number }>;
  isSingleLineHeaders: string[];
}

export const getDocumentStats = (rawText: string): DocStats => {
  const lines = rawText.split('\n');
  const totalChars = rawText.length;
  const totalLines = lines.length;

  const isSingleLineHeaders: string[] = [];
  for (let i = 0; i < Math.min(5, lines.length); i++) {
    const l = lines[i].trim();
    if (l && (l.includes('@') || /\d{3}[-.\s]\d{3}|linkedin|github|\|/.test(l))) {
      isSingleLineHeaders.push(l);
    }
  }

  const paragraphBudgets = lines
    .filter(l => l.trim().length > 8)
    .map(l => ({
      text: l.trim(),
      maxChars: l.trim().length < 122 ? 122 : l.trim().length + 5,
    }));

  return { totalChars, totalLines, paragraphBudgets, isSingleLineHeaders };
};

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Normalize text for fuzzy matching.
 * Also normalises Unicode pipe variants (｜ ‖ ∣ ⏐) to ASCII | so that
 * title lines always match regardless of which pipe the Word doc uses.
 */
const normalizeForMatch = (text: string): string =>
  text
    .replace(/\s+/g, ' ')
    .replace(/[\u2018\u2019\u201C\u201D]/g, "'")
    // Normalise all Unicode pipe / vertical-bar variants to ASCII |
    .replace(/[\uFF5C\u2016\u2223\u23D0\u01C0\u2502]/g, '|')
    .trim()
    .toLowerCase();

/**
 * Clean AI-generated content while PRESERVING **bold** markers.
 *
 * Strategy (no lookbehind needed):
 *   1. Swap **bold** → rare-char placeholders so single-* stripping can't touch them.
 *   2. Strip single *italic* wrappers.
 *   3. Restore placeholders → **bold**.
 *   4. Strip markdown heading markers and leading bullet symbols.
 */
const cleanNewContent = (text: string): string => {
  const BOLD_PH_OPEN  = '\x02';
  const BOLD_PH_CLOSE = '\x03';

  // Protect **bold**
  let result = text.replace(/\*\*([^*]+)\*\*/g, (_m, inner: string) =>
    BOLD_PH_OPEN + inner + BOLD_PH_CLOSE
  );

  // Strip single *italic*
  result = result.replace(/\*([^*]+)\*/g, '$1');

  // Restore **bold**
  result = result.replace(
    new RegExp(BOLD_PH_OPEN + '([^' + BOLD_PH_CLOSE + ']+)' + BOLD_PH_CLOSE, 'g'),
    (_m, inner: string) => '**' + inner + '**'
  );

  // Strip markdown heading markers
  result = result.replace(/^#{1,6}\s+/gm, '');

  // Strip leading bullet symbols (•, -, >) — NOT * (used for bold)
  result = result.replace(/^[\s•\->]+/gm, '');

  // Collapse triple+ newlines
  result = result.replace(/\n{3,}/g, '\n\n');

  return result.trim();
};

/**
 * Soft-cap new_content to the original paragraph length + small tolerance.
 *
 * Budget stays TIGHT (+5 chars) to preserve the exact line structure of the
 * resume — every bullet must occupy the same number of lines as the original.
 * The GLOBAL enforcer in App.tsx handles overall page budget too.
 *
 * When trimming IS required, we trim INTELLIGENTLY instead of chopping at
 * a dumb word boundary:
 *   0. (NEW) Try to COMPRESS the full text by removing filler words — this
 *      preserves the trailing metric (e.g. "by 35%") that matters most.
 *   1. Try to find the last complete sentence (period).
 *   2. Try to find the last complete clause (semicolon).
 *   3. Cut at word boundary, then strip dangling prepositions/conjunctions
 *      ("by", "via", "with", "and", etc.) that make no sense alone.
 *   4. Strip trailing commas/colons (incomplete lists).
 *   5. Always ensure proper punctuation at the end.
 *
 * **bold** markers are stripped before measuring — they add no page space.
 */
const DANGLING_WORDS = /\s+(by|via|with|and|or|for|to|in|of|the|a|an|as|at|on|into|from|using|through|across|than|&)\s*$/i;

/** Common filler phrases that can be compressed without losing meaning. */
const FILLER_COMPRESSIONS: [RegExp, string][] = [
  [/\bin order to\b/gi,       'to'],
  [/\butilized\b/gi,          'used'],
  [/\bimplemented\b/gi,       'built'],
  [/\bconfigurations\b/gi,    'configs'],
  [/\binfrastructure\b/gi,    'infra'],
  [/\bapproximately\b/gi,     '~'],
  [/\benvironment\b/gi,       'env'],
  [/\bdepartments\b/gi,       'depts'],
  [/\bapplication\b/gi,       'app'],
  [/\boptimization\b/gi,      'optimization'],  // no-op placeholder
  [/\band\b/gi,               '&'],
  [/\s{2,}/g,                 ' '],             // collapse double spaces
];

const enforceLengthBudget = (original: string, newText: string): string => {
  const measuredLength = newText.replace(/\*\*([^*]+)\*\*/g, '$1').length;

  // Single-line bullets (< 122 chars) can expand up to the full Word line width.
  // Multi-line content (≥ 122 chars) keeps the tight +5 budget to preserve line count.
  const WORD_LINE_MAX = 122; // Calibri 11pt, 0.75" margins, experience section
  const maxChars = original.length < WORD_LINE_MAX
    ? WORD_LINE_MAX          // fill the whole line — no wasted space
    : original.length + 5;  // multi-line: tight budget preserves page layout

  if (measuredLength <= maxChars) return newText;

  // ── Strategy 0: Compress filler to preserve the metric at the end ───────
  // If the full text has a trailing metric (e.g. "by 35%.", "40% latency."),
  // try removing filler words from the middle so the metric survives intact.
  const stripped = newText.replace(/\*\*([^*]+)\*\*/g, '$1');
  let compressed = stripped;
  for (const [pattern, replacement] of FILLER_COMPRESSIONS) {
    if (compressed.replace(/\*\*([^*]+)\*\*/g, '$1').length <= maxChars) break;
    compressed = compressed.replace(pattern, replacement);
  }
  compressed = compressed.replace(/\s{2,}/g, ' ').trim();
  if (compressed.length <= maxChars && /[.!?%)"]$/.test(compressed)) {
    return compressed;
  }

  // ── Strategy 1: Find the last complete sentence (ends with period) ──────
  const hardCut  = stripped.substring(0, maxChars);

  const lastPeriod = Math.max(
    hardCut.lastIndexOf('. '),
    hardCut.lastIndexOf('.\n'),
    hardCut.endsWith('.') ? hardCut.length - 1 : -1
  );
  if (lastPeriod > maxChars * 0.55) {
    return hardCut.substring(0, lastPeriod + 1).trim();
  }

  // ── Strategy 2: Find the last complete clause (semicolon) ───────────────
  const lastSemicolon = hardCut.lastIndexOf('; ');
  if (lastSemicolon > maxChars * 0.55) {
    return hardCut.substring(0, lastSemicolon + 1).trim() + '.';
  }

  // ── Strategy 3: Cut at word boundary then clean up dangling words ───────
  let trimmed = hardCut;
  const lastSpace = trimmed.lastIndexOf(' ');
  if (lastSpace > maxChars * 0.4) {
    trimmed = trimmed.substring(0, lastSpace).trim();
  }

  // Remove dangling prepositions/conjunctions (multiple passes if stacked)
  let passes = 0;
  while (DANGLING_WORDS.test(trimmed) && passes < 5) {
    trimmed = trimmed.replace(DANGLING_WORDS, '').trim();
    passes++;
  }

  // Remove trailing comma, colon, or ampersand (incomplete clause)
  trimmed = trimmed.replace(/[,;:&]\s*$/, '').trim();

  // Ensure the text ends with proper punctuation
  if (trimmed && !/[.!?%)"]$/.test(trimmed)) {
    trimmed += '.';
  }

  return trimmed;
};

// ─────────────────────────────────────────────────────────────────────────────
// Core XML namespace constants
// ─────────────────────────────────────────────────────────────────────────────
const W_NS   = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const XML_NS = 'http://www.w3.org/XML/1998/namespace';

// ─────────────────────────────────────────────────────────────────────────────
// isContactLine
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Returns true if the paragraph is a PURELY protected contact/social line
 * and should NOT be modified at all.
 *
 * KEY FIX: Many resumes place the professional title and the contact info
 * in the SAME Word paragraph, separated by a <w:br/> (soft line break):
 *
 *   <w:r><w:t>Senior Software Engineer | AI Architect</w:t></w:r>
 *   <w:r><w:br/></w:r>
 *   <w:hyperlink r:id="rId8"><w:r><w:t>email@example.com</w:t></w:r></w:hyperlink>
 *   <w:r><w:t> | +1 (317) 555-0123 | </w:t></w:r>
 *   <w:hyperlink r:id="rId9"><w:r><w:t>LinkedIn</w:t></w:r></w:hyperlink>
 *   ...
 *
 * The old code returned true whenever ANY <w:hyperlink> existed in the paragraph.
 * This blocked ALL modifications — including the title, which IS supposed to change.
 *
 * New logic:
 *   1. Collect the "primary" text — everything BEFORE the first <w:br/>.
 *   2. If the primary text contains contact patterns (@ / phone / linkedin / github),
 *      the paragraph is a pure contact line → return true.
 *   3. If there IS a <w:br/> and the primary text does NOT look like contact info,
 *      this is a mixed title+contact paragraph → return false. The title is editable
 *      and applyReplacement() preserves the contact section after the break.
 *   4. If there is no <w:br/>, check for hyperlinks — a standalone paragraph with
 *      only hyperlinks (e.g. a solo contact line) is protected.
 */
const isContactLine = (paragraph: Element): boolean => {
  // Collect ONLY direct-child <w:r> elements (not nested inside hyperlinks)
  const directRuns: Element[] = [];
  for (let i = 0; i < paragraph.childNodes.length; i++) {
    const child = paragraph.childNodes[i] as Element;
    if (child.localName === 'r') directRuns.push(child);
  }

  let primaryText = '';
  let hasBreak = false;

  for (const run of directRuns) {
    // Collect this run's text
    primaryText += run.getElementsByTagNameNS(W_NS, 't')[0]?.textContent || '';
    // Check for soft break
    if (run.getElementsByTagNameNS(W_NS, 'br').length > 0) {
      hasBreak = true;
      break;
    }
  }

  primaryText = primaryText.trim();

  // If the primary text (before break) itself looks like contact info → fully protected
  if (primaryText && (
    primaryText.includes('@') ||
    /\d{3}[-.\s]\d{3,}/.test(primaryText) ||
    /linkedin|github/i.test(primaryText)
  )) {
    return true;
  }

  // If there's a break, this is a MIXED title+contact paragraph.
  // The title part IS modifiable — applyReplacement() preserves the contact section.
  if (hasBreak) return false;

  // No break — standalone paragraph. If it contains hyperlinks it's a pure contact line.
  if (paragraph.getElementsByTagNameNS(W_NS, 'hyperlink').length > 0) return true;

  return false;
};

// ─────────────────────────────────────────────────────────────────────────────
// writeRun / writeRunsWithBold
// ─────────────────────────────────────────────────────────────────────────────

/** Write a single plain or bold Word run. No highlight ever applied. */
const writeRun = (
  xmlDoc: Document,
  paragraph: Element,
  content: string,
  baseRPr: Node | null,
  bold: boolean
): void => {
  if (!content) return;

  const newRun = xmlDoc.createElementNS(W_NS, 'r');
  const rPr = baseRPr
    ? (baseRPr.cloneNode(true) as Element)
    : xmlDoc.createElementNS(W_NS, 'rPr');

  const hasBold   = Array.from(rPr.childNodes).some(n => (n as Element).localName === 'b');
  const hasBoldCs = Array.from(rPr.childNodes).some(n => (n as Element).localName === 'bCs');

  if (bold) {
    if (!hasBold)   rPr.appendChild(xmlDoc.createElementNS(W_NS, 'b'));
    if (!hasBoldCs) rPr.appendChild(xmlDoc.createElementNS(W_NS, 'bCs'));
  } else {
    Array.from(rPr.childNodes)
      .filter(n => ['b', 'bCs'].includes((n as Element).localName))
      .forEach(n => n.parentNode?.removeChild(n));
  }

  // Always strip any highlight node (safety net — no yellow ever)
  Array.from(rPr.childNodes)
    .filter(n => (n as Element).localName === 'highlight')
    .forEach(n => n.parentNode?.removeChild(n));

  if (rPr.childNodes.length > 0) newRun.appendChild(rPr);

  const textNode = xmlDoc.createElementNS(W_NS, 't');
  textNode.textContent = content;
  textNode.setAttributeNS(XML_NS, 'xml:space', 'preserve');
  newRun.appendChild(textNode);
  paragraph.appendChild(newRun);
};

/**
 * Write a text line that may contain **bold** markers as native Word bold runs.
 *
 * Also auto-bolds "Label:" sub-header patterns at the start of a line
 * (e.g. "Languages: Python, Java") so skills sub-headers are always bold.
 *
 * "Led **Python** and **PySpark** pipelines"
 *   → run("Led ",     bold=false)
 *   → run("Python",   bold=true)
 *   → run(" and ",    bold=false)
 *   → run("PySpark",  bold=true)
 *   → run(" pipelines", bold=false)
 */
const LABEL_RE = /^([A-Za-z][A-Za-z0-9\s\/&().]{1,40}:\s+)(.+)$/;

const writeRunsWithBold = (
  xmlDoc: Document,
  paragraph: Element,
  text: string,
  baseRPr: Node | null,
  defaultBold: boolean
): void => {
  // Auto-bold "Label:" sub-headers unless the text is already fully bold
  // or already wrapped in ** markers
  if (!defaultBold && !text.startsWith('**')) {
    const labelMatch = LABEL_RE.exec(text);
    if (labelMatch) {
      const label   = labelMatch[1]; // "Languages: "
      const theRest = labelMatch[2]; // "Python, Java, SQL..."
      writeRun(xmlDoc, paragraph, label, baseRPr, true);
      // Process the rest for any **bold** markers
      const restParts = theRest.split(/(\*\*[^*]+\*\*)/);
      for (const part of restParts) {
        if (!part) continue;
        const isBold = part.startsWith('**') && part.endsWith('**') && part.length >= 5;
        writeRun(xmlDoc, paragraph, isBold ? part.slice(2, -2) : part, baseRPr, isBold);
      }
      return;
    }
  }

  // Standard **bold** marker processing
  const parts = text.split(/(\*\*[^*]+\*\*)/);
  for (const part of parts) {
    if (!part) continue;
    const isBoldSegment = part.startsWith('**') && part.endsWith('**') && part.length >= 5;
    const content = isBoldSegment ? part.slice(2, -2) : part;
    if (content) {
      writeRun(xmlDoc, paragraph, content, baseRPr, isBoldSegment || defaultBold);
    }
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// getParagraphText
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Collect the visible text of a paragraph's content runs and locate the
 * run-index where the contact section begins (if any).
 *
 * KEY FIX: A <w:r> can contain BOTH <w:t> AND <w:br> in the same element —
 * for example the last word of the professional title is often in the same
 * run as the soft break before the contact line:
 *
 *     <w:r>
 *       <w:t>ETL Developer</w:t>
 *       <w:br w:type="textWrapping"/>
 *     </w:r>
 *
 * The previous code checked for <w:br> BEFORE collecting text, so "ETL Developer"
 * was silently dropped, the collected title text was incomplete, and the contact
 * section was flagged at run index 0 — meaning contentRuns = [] and baseRPr = null.
 *
 * Fix: collect the run's <w:t> text FIRST, then check for the break.
 */
const getParagraphText = (
  paragraph: Element
): { text: string; contactStartIdx: number } => {
  const runs = Array.from(paragraph.getElementsByTagNameNS(W_NS, 'r'));
  let text = '';
  let contactStartIdx = -1;

  for (let i = 0; i < runs.length; i++) {
    const run = runs[i] as Element;

    // ── Collect this run's text FIRST ──────────────────────────────────────
    text += run.getElementsByTagNameNS(W_NS, 't')[0]?.textContent || '';

    // ── Then check for a soft break ────────────────────────────────────────
    if (run.getElementsByTagNameNS(W_NS, 'br').length > 0) {
      // Peek at what follows this break — text content AND hyperlink elements
      const runsAfter  = runs.slice(i + 1);
      const afterText  = runsAfter.map(r => (r as Element).textContent || '').join('');

      // Also check if any element AFTER the break is a <w:hyperlink>
      // (the social links line stores LinkedIn/GitHub as hyperlinks)
      const parentEl   = run.parentNode as Element;
      const allChildren = parentEl ? Array.from(parentEl.childNodes) : [];
      const runPos     = allChildren.indexOf(run);
      const afterChildren = runPos >= 0 ? allChildren.slice(runPos + 1) : [];
      const hasHyperlinkAfter = afterChildren.some(
        n => (n as Element).localName === 'hyperlink'
      );

      const looksLikeContact =
        hasHyperlinkAfter ||
        /@/.test(afterText) ||
        /\d{3}[-.\s]\d{3,}/.test(afterText) ||
        /linkedin|github/i.test(afterText);

      if (looksLikeContact) {
        contactStartIdx = i;
        break;
      }
    }
  }

  return { text, contactStartIdx };
};

// ─────────────────────────────────────────────────────────────────────────────
// applyReplacement
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Replace the text content of a single Word paragraph.
 *
 * PARTIAL MATCH — original_excerpt is a substring of the paragraph text:
 *   Writes [before] [new content] [after] on the same line.
 *
 * FULL MATCH — original_excerpt covers the whole paragraph:
 *   Replaces all content runs with new content.
 *
 * Contact runs (email | phone | LinkedIn | GitHub) that share the paragraph
 * with the title via a <w:br> are always re-attached unchanged at the end.
 *
 * KEY FIX: The contact section can contain <w:hyperlink> elements (for email,
 * LinkedIn, GitHub) which are DIRECT children of <w:p>, not <w:r> elements.
 * The old code only tracked runs, leaving orphaned hyperlinks in the wrong
 * position after replacement. Now we save/restore ALL direct children
 * (both runs and hyperlinks) in the contact section.
 */
const applyReplacement = (
  paragraph: Element,
  xmlDoc: Document,
  originalText: string,
  newText: string
): void => {
  const budgeted  = enforceLengthBudget(originalText, newText);
  const finalText = cleanNewContent(budgeted);

  // ── Gather ALL direct children that are content (runs OR hyperlinks) ─────
  // We skip <w:pPr> (paragraph properties) and other non-content elements.
  const allContentChildren: Element[] = [];
  for (let i = 0; i < paragraph.childNodes.length; i++) {
    const child = paragraph.childNodes[i] as Element;
    if (child.localName === 'r' || child.localName === 'hyperlink') {
      allContentChildren.push(child);
    }
  }

  // Also get only DIRECT <w:r> children (not nested inside hyperlinks) for
  // text analysis — getParagraphText walks getElementsByTagNameNS which
  // includes nested runs, but we need direct children for the split point.
  const directRuns: Element[] = [];
  for (let i = 0; i < paragraph.childNodes.length; i++) {
    const child = paragraph.childNodes[i] as Element;
    if (child.localName === 'r') directRuns.push(child);
  }

  // ── Find the break-point: the <w:r> containing <w:br/> ──────────────────
  let breakRunElement: Element | null = null;
  let titleTextForBudget = '';

  for (const run of directRuns) {
    titleTextForBudget += run.getElementsByTagNameNS(W_NS, 't')[0]?.textContent || '';
    if (run.getElementsByTagNameNS(W_NS, 'br').length > 0) {
      breakRunElement = run;
      break;
    }
  }

  // ── Split children into title vs contact sections ────────────────────────
  let titleChildren: Element[] = [];
  let contactChildren: Element[] = [];

  if (breakRunElement) {
    const breakIdx = allContentChildren.indexOf(breakRunElement);
    if (breakIdx >= 0) {
      // Title = everything before the break run (exclusive)
      titleChildren   = allContentChildren.slice(0, breakIdx);
      // Contact = the break run + everything after it (hyperlinks, runs, etc.)
      contactChildren = allContentChildren.slice(breakIdx);
    } else {
      // Break run is a direct <w:r> but not in our content list (shouldn't happen)
      titleChildren = allContentChildren;
    }
  } else {
    // No break — entire paragraph is one section
    titleChildren = allContentChildren;
  }

  // ── Capture base formatting from the first title run ─────────────────────
  let baseRPr: Node | null = null;
  let originalIsBold = false;

  const firstTitleRun = titleChildren.find(c => c.localName === 'r') as Element | undefined;
  if (firstTitleRun) {
    const rPr0 = firstTitleRun.getElementsByTagNameNS(W_NS, 'rPr')[0];
    if (rPr0) baseRPr = rPr0.cloneNode(true);

    // Check if majority of title content is bold
    let boldLen = 0;
    let totalLen = 0;
    titleChildren.forEach(child => {
      if (child.localName !== 'r') return;
      const t   = child.getElementsByTagNameNS(W_NS, 't')[0]?.textContent || '';
      totalLen += t.length;
      const rPr = child.getElementsByTagNameNS(W_NS, 'rPr')[0];
      if (rPr && (
        rPr.getElementsByTagNameNS(W_NS, 'b').length > 0 ||
        rPr.getElementsByTagNameNS(W_NS, 'bCs').length > 0
      )) {
        boldLen += t.length;
      }
    });
    if (totalLen > 0 && boldLen / totalLen > 0.5) originalIsBold = true;
  }

  // ── Deep-clone the contact section BEFORE removing anything ──────────────
  const savedContactNodes: Node[] = contactChildren.map(el => el.cloneNode(true));

  // ── Remove ALL content children (title + contact) from the paragraph ─────
  allContentChildren.forEach(child => {
    if (child.parentNode) child.parentNode.removeChild(child);
  });

  // ── Determine full-match vs partial-match ────────────────────────────────
  // Use the title-only text (before break) for matching, not the full paragraph
  const titleText = titleTextForBudget.replace(/\n/g, '').trim();
  const normTitle = normalizeForMatch(titleText);
  const normOrig  = normalizeForMatch(originalText);

  const isPartial =
    normTitle.includes(normOrig) &&
    normTitle.trim() !== normOrig.trim() &&
    normOrig.length < normTitle.length * 0.95;

  const writeFinalText = (textToWrite: string, inheritBold: boolean): void => {
    textToWrite.split('\n').forEach((line, lineIdx) => {
      if (lineIdx > 0) {
        const brRun = xmlDoc.createElementNS(W_NS, 'r');
        brRun.appendChild(xmlDoc.createElementNS(W_NS, 'br'));
        paragraph.appendChild(brRun);
      }
      writeRunsWithBold(xmlDoc, paragraph, line, baseRPr, inheritBold);
    });
  };

  if (isPartial) {
    let matchStart = titleText.indexOf(originalText);
    if (matchStart === -1) {
      matchStart = titleText.toLowerCase().indexOf(originalText.toLowerCase());
    }

    if (matchStart !== -1) {
      const before = titleText.substring(0, matchStart);
      const after  = titleText.substring(matchStart + originalText.length);

      if (before) writeRun(xmlDoc, paragraph, before, baseRPr, originalIsBold);
      writeFinalText(finalText, false);
      if (after)  writeRun(xmlDoc, paragraph, after,  baseRPr, originalIsBold);
    } else {
      writeFinalText(finalText, originalIsBold);
    }
  } else {
    writeFinalText(finalText, originalIsBold);
  }

  // ── Re-attach the contact section (break + hyperlinks + runs) ────────────
  for (const node of savedContactNodes) {
    paragraph.appendChild(node);
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// applyAutoFormatting — bold skills sub-headers throughout each paragraph
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Scans every paragraph for un-bolded "Label:" sub-header patterns and makes
 * the label portion bold.
 *
 * KEY FIX: Skills lines like:
 *   ● Databases: PostgreSQL, MongoDB...
 *     AI & Vector DBs: Pinecone, Weaviate...   ← after <w:br>, same paragraph
 *     Cloud: Azure, AWS...                     ← after another <w:br>
 *
 * These "continuation" sub-headers are hidden inside the same Word paragraph
 * after soft breaks. The previous implementation only checked the paragraph's
 * FIRST run. Now we walk ALL runs and process every visual segment — both the
 * first line AND every line after a <w:br> — independently.
 *
 * A "segment" is the sequence of runs between two soft breaks (or the start/end
 * of the paragraph). If the segment's first run starts with "Label: values",
 * we split that run into a bold label run + plain values run.
 */
const applyAutoFormatting = (xmlDoc: Document): void => {
  const paragraphs = Array.from(xmlDoc.getElementsByTagNameNS(W_NS, 'p'));

  for (const paragraph of paragraphs) {
    // Work on a snapshot — we'll mutate the paragraph as we go
    let runs = Array.from(paragraph.getElementsByTagNameNS(W_NS, 'r'));
    if (runs.length === 0) continue;

    // Build segments: each segment is the list of runs between soft breaks.
    // A "segment" represents one visual line within the paragraph.
    const segments: Element[][] = [];
    let current: Element[] = [];

    for (const run of runs) {
      const el = run as Element;
      current.push(el);
      if (el.getElementsByTagNameNS(W_NS, 'br').length > 0) {
        segments.push(current);
        current = [];
      }
    }
    if (current.length > 0) segments.push(current);

    // Process each segment independently
    for (const segment of segments) {
      // Find the first run in this segment that has actual text
      const firstTextRun = segment.find(r =>
        ((r as Element).getElementsByTagNameNS(W_NS, 't')[0]?.textContent || '').trim().length > 0
      ) as Element | undefined;

      if (!firstTextRun) continue;

      // Skip if already bold
      const rPrEl = firstTextRun.getElementsByTagNameNS(W_NS, 'rPr')[0];
      const alreadyBold = rPrEl && (
        rPrEl.getElementsByTagNameNS(W_NS, 'b').length > 0 ||
        rPrEl.getElementsByTagNameNS(W_NS, 'bCs').length > 0
      );
      if (alreadyBold) continue;

      const firstRunText = firstTextRun.getElementsByTagNameNS(W_NS, 't')[0]?.textContent || '';
      const match = LABEL_RE.exec(firstRunText);
      if (!match) continue;

      const label   = match[1]; // "Languages: "
      const theRest = match[2]; // "Python, Java, SQL..."

      // Clone rPr for reuse
      const baseRPr: Node | null = rPrEl ? rPrEl.cloneNode(true) : null;

      // Remove the first text run from the paragraph
      firstTextRun.parentNode?.removeChild(firstTextRun);

      // Build bold label run
      const boldRun = xmlDoc.createElementNS(W_NS, 'r');
      const boldRPr = baseRPr
        ? (baseRPr.cloneNode(true) as Element)
        : xmlDoc.createElementNS(W_NS, 'rPr');
      if (!Array.from(boldRPr.childNodes).some(n => (n as Element).localName === 'b'))
        boldRPr.appendChild(xmlDoc.createElementNS(W_NS, 'b'));
      if (!Array.from(boldRPr.childNodes).some(n => (n as Element).localName === 'bCs'))
        boldRPr.appendChild(xmlDoc.createElementNS(W_NS, 'bCs'));
      boldRun.appendChild(boldRPr);
      const boldT = xmlDoc.createElementNS(W_NS, 't');
      boldT.textContent = label;
      boldT.setAttributeNS(XML_NS, 'xml:space', 'preserve');
      boldRun.appendChild(boldT);

      // Build plain values run
      const plainRun = xmlDoc.createElementNS(W_NS, 'r');
      if (baseRPr) {
        const plainRPr = baseRPr.cloneNode(true) as Element;
        Array.from(plainRPr.childNodes)
          .filter(n => ['b', 'bCs'].includes((n as Element).localName))
          .forEach(n => n.parentNode?.removeChild(n));
        plainRun.appendChild(plainRPr);
      }
      const plainT = xmlDoc.createElementNS(W_NS, 't');
      plainT.textContent = theRest;
      plainT.setAttributeNS(XML_NS, 'xml:space', 'preserve');
      plainRun.appendChild(plainT);

      // Find the insertion point: right before the next run in this segment
      // (or before the <w:br> run that ends this segment)
      const nextSiblingInSegment = segment.find(r => r !== firstTextRun && r.parentNode === paragraph);
      if (nextSiblingInSegment) {
        paragraph.insertBefore(plainRun, nextSiblingInSegment);
        paragraph.insertBefore(boldRun, plainRun);
      } else {
        // Segment was the last one and had only the one run — append
        paragraph.appendChild(boldRun);
        paragraph.appendChild(plainRun);
      }
    }
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// removeTrailingEmptyParagraphs
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Word always appends a mandatory final empty paragraph to every document.
 * After our XML modifications, sometimes 2-3 empty paragraphs accumulate at
 * the end — enough for Word to render a completely blank extra page.
 *
 * This function walks backwards from the end of the document body and removes
 * every truly empty paragraph (no text, no images, no tables), keeping exactly
 * ONE final empty paragraph (which Word requires as a document terminator).
 */
const removeTrailingEmptyParagraphs = (xmlDoc: Document): void => {
  const body = xmlDoc.getElementsByTagNameNS(W_NS, 'body')[0];
  if (!body) return;

  const children = Array.from(body.childNodes);

  // Walk backwards — collect trailing empty <w:p> elements
  const toRemove: Node[] = [];
  for (let i = children.length - 1; i >= 0; i--) {
    const node = children[i] as Element;

    // Stop at non-paragraph elements (tables, section props, etc.)
    if (node.localName !== 'p') break;

    // A paragraph is "empty" if it has no text content and no drawing/image runs
    const hasText    = (node.textContent || '').trim().length > 0;
    const hasDrawing = node.getElementsByTagNameNS(
      'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing', 'inline'
    ).length > 0;

    if (!hasText && !hasDrawing) {
      toRemove.push(node);
    } else {
      break; // hit real content — stop
    }
  }

  // Keep exactly one trailing empty paragraph (Word's required terminator)
  // Remove all extras beyond the first one
  const extras = toRemove.slice(1);
  extras.forEach(node => body.removeChild(node));

  if (extras.length > 0) {
    console.log(`[DocFix] Removed ${extras.length} trailing empty paragraph(s) — blank page eliminated`);
  }
};
const applyModsToXml = (
  xmlDoc: Document,
  modifications: Modification[]
): { xmlDoc: Document; applied: number } => {
  const paragraphs = Array.from(xmlDoc.getElementsByTagNameNS(W_NS, 'p'));
  let applied = 0;

  for (const mod of modifications) {
    const original   = (mod.original_excerpt || '').trim();
    const newContent = mod.new_content || '';
    if (!original || original.length < 8) continue;

    const searchNorm = normalizeForMatch(original);
    let found = false;

    // Level 1 — exact normalised match
    for (const p of paragraphs) {
      const pt = normalizeForMatch(p.textContent || '');
      if (pt.includes(searchNorm)) {
        if (isContactLine(p)) { found = true; break; } // silently skip protected lines
        applyReplacement(p, xmlDoc, original, newContent);
        applied++; found = true; break;
      }
    }

    // Level 2 — first 40% of the search string as a prefix
    if (!found) {
      const prefix = searchNorm.substring(0, Math.floor(searchNorm.length * 0.4));
      for (const p of paragraphs) {
        const pt = normalizeForMatch(p.textContent || '');
        if (pt.includes(prefix)) {
          if (isContactLine(p)) { found = true; break; }
          applyReplacement(p, xmlDoc, original, newContent);
          applied++; found = true; break;
        }
      }
    }

    // Level 3 — fuzzy word-overlap (≥ 40% of significant words)
    if (!found) {
      let best: Element | null = null;
      let bestScore = 0;
      const words = searchNorm.split(' ');
      for (const p of paragraphs) {
        if (isContactLine(p)) continue; // never touch contact/hyperlink paragraphs
        const pt = normalizeForMatch(p.textContent || '');
        if (pt.length < 10) continue;
        const score =
          words.filter(word => word.length > 3 && pt.includes(word)).length / words.length;
        if (score > bestScore && score >= 0.4) { bestScore = score; best = p; }
      }
      if (best) {
        applyReplacement(best, xmlDoc, original, newContent);
        applied++;
      }
    }
  }

  // Remove any extra trailing empty paragraphs that cause a blank final page
  removeTrailingEmptyParagraphs(xmlDoc);

  // Auto-formatting pass: bold any skills sub-headers the AI may have missed,
  // including sub-lines that appear after <w:br> inside the same paragraph.
  applyAutoFormatting(xmlDoc);

  return { xmlDoc, applied };
};

// ─────────────────────────────────────────────────────────────────────────────
// Public: Apply modifications → ArrayBuffer for live preview.
// Preview is identical to download — no yellow highlighting.
// ─────────────────────────────────────────────────────────────────────────────
export const applyModificationsToBuffer = async (
  originalBuffer: ArrayBuffer,
  modifications: Modification[]
): Promise<ArrayBuffer> => {
  if (!modifications?.length) return originalBuffer;

  const JSZip = await getJSZip();
  const zip   = await (JSZip as any).loadAsync(originalBuffer);

  const docFile = zip.file('word/document.xml');
  if (!docFile) throw new Error('word/document.xml not found in this .docx archive.');

  const xmlContent = await docFile.async('string');
  const xmlDoc     = new DOMParser().parseFromString(xmlContent, 'text/xml');

  const { xmlDoc: updated, applied } = applyModsToXml(xmlDoc, modifications);
  console.log(`[LiveDoc] ${applied}/${modifications.length} mods applied`);

  zip.file('word/document.xml', new XMLSerializer().serializeToString(updated));
  const blob: Blob = await zip.generateAsync({ type: 'blob' });
  return blob.arrayBuffer();
};

// ─────────────────────────────────────────────────────────────────────────────
// Public: Apply modifications and trigger a clean download
// ─────────────────────────────────────────────────────────────────────────────
export const modifyAndDownloadDocx = async (
  originalFile: File,
  modifications: Modification[],
  newFileName = 'Tailored_Resume.docx'
): Promise<void> => {
  try {
    const JSZip  = await getJSZip();
    const saveAs = await getSaveAs();

    const arrayBuffer = await originalFile.arrayBuffer();
    const zip         = await (JSZip as any).loadAsync(arrayBuffer);

    const docFile = zip.file('word/document.xml');
    if (!docFile) throw new Error('word/document.xml not found in this .docx archive.');

    const xmlDoc = new DOMParser().parseFromString(
      await docFile.async('string'),
      'text/xml'
    );

    const { xmlDoc: updated, applied } = applyModsToXml(xmlDoc, modifications);
    console.log(`[Download] ${applied}/${modifications.length} mods applied`);

    if (applied === 0 && modifications.length > 0) {
      alert('Warning: No modifications were matched in the document. Check the console (F12) for details.');
    }

    zip.file('word/document.xml', new XMLSerializer().serializeToString(updated));
    const blob: Blob = await zip.generateAsync({ type: 'blob' });
    saveAs(blob, newFileName);
    console.log('✅ Saved:', newFileName);
  } catch (err) {
    console.error('[Download] Error:', err);
    alert('Failed to save document. Check the console (F12) for details.');
  }
};