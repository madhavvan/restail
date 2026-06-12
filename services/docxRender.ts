// ─────────────────────────────────────────────────────────────────────────────
// Layout verification + PDF export via docx-preview.
//
// This is the instrument that replaces "guess pages from character counts":
// the final .docx buffer is actually RENDERED (paginated, with real fonts and
// real word-wrap) into an off-screen container, and we read back:
//   • the page count  (must equal the original's page count)
//   • each paragraph's rendered line count (to find exactly which paragraph
//     grew when something overflows)
//
// Character math cannot detect a paragraph crossing a wrap boundary at equal
// length — a layout render can. Same options as the visible preview pane, so
// what we verify is what the user sees.
// ─────────────────────────────────────────────────────────────────────────────

// Bundled from npm (no esm.sh at runtime). docx-preview injects all the CSS
// it needs into the style container during renderAsync — the separate
// stylesheet the old CDN <link> pointed at doesn't exist in the package.
import { renderAsync } from 'docx-preview';

const DOCX_MIME =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

/** Kept async for API compatibility with the previous dynamic CDN loader. */
export const loadDocxPreview = async (): Promise<{ renderAsync: typeof renderAsync }> =>
  ({ renderAsync });

const RENDER_OPTIONS = {
  className: 'docx',
  inWrapper: true,
  ignoreWidth: false,
  ignoreHeight: false,
  ignoreFonts: false,
  breakPages: true,
  useBase64URL: true,
  renderHeaders: true,
  renderFooters: true,
  renderFootnotes: true,
  renderEndnotes: true,
};

export interface DocMeasurement {
  /** Estimated page count. docx-preview only splits into multiple <section>
   *  elements when the file carries lastRenderedPageBreak markers (Word saves
   *  them; Google-Docs exports don't) — so pages are derived from content
   *  height vs usable page height, which works for both. */
  pages: number;
  /** Total rendered content height in px — the exact, pagination-independent
   *  overflow signal: if a modified doc's content height grew, it got longer,
   *  period. */
  contentHeight: number;
  /** Average rendered line height in px (for "grew by ~N lines" math). */
  lineHeight: number;
  /** Rendered line count of every <p>, document order. */
  paraLines: number[];
  /** Normalized text of every <p>, document order — used to align rendered
   *  paragraphs to XML paragraph IDs. */
  paraTexts: string[];
  paraCount: number;
}

const settleLayout = async (doc: Document): Promise<void> => {
  try { await (doc as any).fonts?.ready; } catch { /* older engines */ }
  await new Promise<void>(r => requestAnimationFrame(() => requestAnimationFrame(() => r())));
};

const measureContainer = (root: ParentNode): DocMeasurement => {
  const sections = Array.from(root.querySelectorAll('section.docx')) as HTMLElement[];
  const paraEls = Array.from(root.querySelectorAll('section.docx p')) as HTMLElement[];

  const paraLines: number[] = [];
  const paraTexts: string[] = [];
  const lineHeights: number[] = [];

  paraEls.forEach(el => {
    const h = el.getBoundingClientRect().height;
    const cs = getComputedStyle(el);
    let lineHeight = parseFloat(cs.lineHeight);
    if (!isFinite(lineHeight) || lineHeight <= 0) {
      const fontSize = parseFloat(cs.fontSize) || 14.7;
      lineHeight = fontSize * 1.2;
    }
    lineHeights.push(lineHeight);
    paraLines.push(Math.max(1, Math.round(h / lineHeight)));
    paraTexts.push((el.textContent || '').replace(/\s+/g, ' ').trim());
  });

  const avgLineHeight = lineHeights.length
    ? lineHeights.reduce((a, b) => a + b, 0) / lineHeights.length
    : 16;

  // Content height + page estimate per section.
  let contentHeight = 0;
  let pagesFloat = 0;
  for (const sec of sections) {
    const cs = getComputedStyle(sec);
    const padT = parseFloat(cs.paddingTop) || 0;
    const padB = parseFloat(cs.paddingBottom) || 0;
    const rect = sec.getBoundingClientRect();
    const secContent = Math.max(0, sec.scrollHeight - padT - padB);
    contentHeight += secContent;

    // Usable page height: the section's min-height (one page) minus padding.
    const minH = parseFloat(cs.minHeight);
    const pageH = isFinite(minH) && minH > 100 ? minH : rect.height;
    const usable = Math.max(1, pageH - padT - padB);
    pagesFloat += secContent / usable;
  }

  const pages = Math.max(sections.length, Math.ceil(pagesFloat - 0.02));

  return {
    pages,
    contentHeight,
    lineHeight: avgLineHeight,
    paraLines,
    paraTexts,
    paraCount: paraEls.length,
  };
};

/** Render a .docx buffer off-screen and measure pages + per-paragraph lines. */
export const measureDocxBuffer = async (buffer: ArrayBuffer): Promise<DocMeasurement> => {
  const { renderAsync } = await loadDocxPreview();

  const host = document.createElement('div');
  // Off-screen but laid out at full size — display:none would collapse layout.
  host.style.cssText =
    'position:fixed;left:-12000px;top:0;width:1400px;pointer-events:none;z-index:-1;';
  document.body.appendChild(host);

  try {
    await renderAsync(new Blob([buffer], { type: DOCX_MIME }), host, undefined, RENDER_OPTIONS);
    await settleLayout(document);
    return measureContainer(host);
  } finally {
    host.remove();
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// PDF export — text-based (NEVER rasterized: a canvas-image PDF is unreadable
// to ATS parsers). The buffer is rendered into a hidden iframe with @page CSS
// matched to the document's real page size, then handed to the browser's
// print-to-PDF engine, which preserves selectable text and layout.
// ─────────────────────────────────────────────────────────────────────────────

export interface PrintFrame {
  /** Real page dimensions (inches) used for @page — from the section's
   *  min-height (the per-page height docx-preview derives from sectPr),
   *  NEVER from the rendered rect height: a single-section document with
   *  overflowing content (Google-Docs exports without rendered page breaks)
   *  has a rect 2+ pages tall, which previously produced one giant PDF page. */
  pageWidthIn: number;
  pageHeightIn: number;
  sections: number;
  /** Open the browser print dialog (user picks "Save as PDF") and clean up. */
  print: () => Promise<void>;
  dispose: () => void;
}

/** Render the buffer into a hidden print-ready iframe. Exposed separately from
 *  exportBufferAsPdf so the page geometry is verifiable in tests without
 *  triggering a real print dialog. */
export const preparePrintFrame = async (
  buffer: ArrayBuffer,
  suggestedName = 'Tailored_Resume'
): Promise<PrintFrame> => {
  const { renderAsync } = await loadDocxPreview();

  const iframe = document.createElement('iframe');
  // Full page width so layout inside the frame is identical to the preview.
  iframe.style.cssText =
    'position:fixed;left:-12000px;top:0;width:1000px;height:1200px;border:0;visibility:hidden;';
  document.body.appendChild(iframe);
  const dispose = () => iframe.remove();

  try {
    const idoc = iframe.contentDocument;
    const iwin = iframe.contentWindow;
    if (!idoc || !iwin) throw new Error('Could not create print frame.');

    // Browsers default the Save-as-PDF filename to the document title.
    idoc.title = suggestedName;

    const mount = idoc.createElement('div');
    idoc.body.appendChild(mount);

    await renderAsync(
      new Blob([buffer], { type: DOCX_MIME }),
      mount,
      idoc.head as any, // style container inside the frame
      RENDER_OPTIONS
    );
    await settleLayout(idoc);

    // True page size: min-height = one page; rect.width = page width.
    const firstSection = idoc.querySelector('section.docx') as HTMLElement | null;
    const sections = idoc.querySelectorAll('section.docx').length;
    const rect = firstSection?.getBoundingClientRect();
    const minH = firstSection
      ? parseFloat(iwin.getComputedStyle(firstSection).minHeight)
      : NaN;

    const pageWidthIn = rect && rect.width > 100 ? rect.width / 96 : 8.5;
    const pageHeightIn =
      isFinite(minH) && minH > 100 ? minH / 96
      : rect && rect.height > 100 ? rect.height / 96
      : 11;

    const style = idoc.createElement('style');
    style.textContent = `
      @page { size: ${pageWidthIn.toFixed(3)}in ${pageHeightIn.toFixed(3)}in; margin: 0; }
      /* Word prints shading/colors; browsers strip them unless forced. This is
         what kept the section-header bands out of the app's PDFs. */
      * {
        -webkit-print-color-adjust: exact !important;
        print-color-adjust: exact !important;
      }
      html, body { margin: 0 !important; padding: 0 !important; background: #fff !important; }
      .docx-wrapper { background: #fff !important; padding: 0 !important; margin: 0 !important; display: block !important; }
      .docx-wrapper > section.docx {
        box-shadow: none !important;
        margin: 0 !important;
        page-break-after: always;
        break-after: page;
      }
      .docx-wrapper > section.docx:last-of-type { page-break-after: auto; break-after: auto; }
    `;
    idoc.head.appendChild(style);

    const print = async () => {
      try {
        iwin.focus();
        iwin.print();
        // Keep the frame alive until the print dialog is dismissed.
        await new Promise<void>(resolve => {
          let done = false;
          const finish = () => { if (!done) { done = true; resolve(); } };
          try { iwin.addEventListener('afterprint', finish, { once: true }); } catch { /* ignore */ }
          setTimeout(finish, 120000);
        });
      } finally {
        dispose();
      }
    };

    return { pageWidthIn, pageHeightIn, sections, print, dispose };
  } catch (err) {
    dispose();
    throw err;
  }
};

export const exportBufferAsPdf = async (
  buffer: ArrayBuffer,
  suggestedName = 'Tailored_Resume'
): Promise<void> => {
  const frame = await preparePrintFrame(buffer, suggestedName);
  await frame.print();
};
