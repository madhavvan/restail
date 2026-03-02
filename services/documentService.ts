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
    .map(l => ({ text: l.trim(), maxChars: l.trim().length + 5 }));

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
 * We allow a little breathing room (+5 chars) so the AI can make genuine
 * improvements without being hard-cut. The GLOBAL enforcer in App.tsx
 * handles any net overflow at the document level.
 *
 * **bold** markers are stripped before measuring — they add no page space.
 */
const enforceLengthBudget = (original: string, newText: string): string => {
  const measuredLength = newText.replace(/\*\*([^*]+)\*\*/g, '$1').length;
  const maxChars = original.length + 5; // small tolerance only

  if (measuredLength <= maxChars) return newText;

  // Must trim — strip bold markers first
  const stripped = newText.replace(/\*\*([^*]+)\*\*/g, '$1');
  const trimmed  = stripped.substring(0, maxChars);

  const lastPeriod = Math.max(trimmed.lastIndexOf('. '), trimmed.lastIndexOf('.\n'));
  if (lastPeriod > maxChars * 0.7) return trimmed.substring(0, lastPeriod + 1).trim();

  const lastSpace = trimmed.lastIndexOf(' ');
  return lastSpace > maxChars * 0.7 ? trimmed.substring(0, lastSpace).trim() : trimmed.trim();
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
 * Returns true if the paragraph is a protected contact/social line.
 *
 * Protected if the paragraph's FIRST visual line (before any <w:br>) contains:
 *   • An email address (@)
 *   • A phone number pattern
 *   • "linkedin" or "github" text (display text of hyperlinks)
 *   • Any <w:hyperlink> element (the actual XML wrapper for clickable links)
 *
 * The hyperlink check is the key addition — the social links line stores
 * LinkedIn and GitHub as <w:hyperlink r:id="rId..."> elements in the XML.
 * Plain text detection alone misses paragraphs where "LinkedIn" is only
 * embedded inside a hyperlink element and not visible as raw text content
 * at the paragraph level.
 */
const isContactLine = (paragraph: Element): boolean => {
  // ── Check 1: paragraph contains any <w:hyperlink> element ────────────────
  // The social links line (email | LinkedIn | GitHub) uses Word hyperlinks.
  // Any paragraph with a hyperlink is considered protected — resume content
  // never has clickable links, only the contact section does.
  const R_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
  if (paragraph.getElementsByTagNameNS(R_NS, 'hyperlink').length > 0) return true;

  // ── Check 2: primary text (before first <w:br>) looks like contact info ──
  const runs = Array.from(paragraph.getElementsByTagNameNS(W_NS, 'r'));
  let primaryText = '';

  for (const run of runs) {
    const el = run as Element;
    primaryText += el.getElementsByTagNameNS(W_NS, 't')[0]?.textContent || '';
    if (el.getElementsByTagNameNS(W_NS, 'br').length > 0) break;
  }

  primaryText = primaryText.trim();
  if (!primaryText) return false;

  return (
    primaryText.includes('@') ||
    /\d{3}[-.\s]\d{3,}/.test(primaryText) ||
    /linkedin|github/i.test(primaryText)
  );
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
 *   Fixes skills-line partial replacements where trailing items were pushed
 *   to a new line.
 *
 * FULL MATCH — original_excerpt covers the whole paragraph:
 *   Replaces all content runs with new content.
 *
 * Contact runs (email | phone | LinkedIn | GitHub) that share the paragraph
 * with the title via a <w:br> are always re-attached unchanged at the end.
 */
const applyReplacement = (
  paragraph: Element,
  xmlDoc: Document,
  originalText: string,
  newText: string
): void => {
  const budgeted  = enforceLengthBudget(originalText, newText);
  const finalText = cleanNewContent(budgeted);

  const allRuns = Array.from(paragraph.getElementsByTagNameNS(W_NS, 'r'));
  const { text: fullParaText, contactStartIdx } = getParagraphText(paragraph);

  // Save the contact section (the break-containing run + all runs after it)
  const contactRuns: Element[] = contactStartIdx >= 0
    ? allRuns.slice(contactStartIdx).map(r => (r as Element).cloneNode(true) as Element)
    : [];

  // Determine which runs are content (everything before the contact section)
  const contentRuns = contactStartIdx >= 0
    ? allRuns.slice(0, contactStartIdx)
    : allRuns;

  // Capture base rPr and boldness from the first content run
  let baseRPr: Node | null = null;
  let originalIsBold = false;

  if (contentRuns.length > 0) {
    const rPr0 = (contentRuns[0] as Element).getElementsByTagNameNS(W_NS, 'rPr')[0];
    if (rPr0) baseRPr = rPr0.cloneNode(true);

    let boldLen = 0;
    let totalLen = 0;
    contentRuns.forEach(run => {
      const t   = (run as Element).getElementsByTagNameNS(W_NS, 't')[0]?.textContent || '';
      totalLen += t.length;
      const rPr = (run as Element).getElementsByTagNameNS(W_NS, 'rPr')[0];
      if (rPr && (
        rPr.getElementsByTagNameNS(W_NS, 'b').length > 0 ||
        rPr.getElementsByTagNameNS(W_NS, 'bCs').length > 0
      )) {
        boldLen += t.length;
      }
    });
    if (totalLen > 0 && boldLen / totalLen > 0.5) originalIsBold = true;
  }

  // Remove all old runs
  allRuns.forEach(run => run.parentNode?.removeChild(run));

  // ── Partial vs Full match ────────────────────────────────────────────────
  const normFull = normalizeForMatch(fullParaText);
  const normOrig = normalizeForMatch(originalText);

  const isPartial =
    normFull.includes(normOrig) &&
    normFull.trim() !== normOrig.trim() &&
    normOrig.length < normFull.length * 0.95;

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
    let matchStart = fullParaText.indexOf(originalText);
    if (matchStart === -1) {
      matchStart = fullParaText.toLowerCase().indexOf(originalText.toLowerCase());
    }

    if (matchStart !== -1) {
      const before = fullParaText.substring(0, matchStart);
      const after  = fullParaText.substring(matchStart + originalText.length);

      if (before) writeRun(xmlDoc, paragraph, before, baseRPr, originalIsBold);
      writeFinalText(finalText, false);
      if (after)  writeRun(xmlDoc, paragraph, after,  baseRPr, originalIsBold);
    } else {
      writeFinalText(finalText, originalIsBold);
    }
  } else {
    writeFinalText(finalText, originalIsBold);
  }

  // Re-attach the contact section (email | phone | LinkedIn | GitHub)
  if (contactRuns.length > 0) {
    contactRuns.forEach(run => paragraph.appendChild(run));
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