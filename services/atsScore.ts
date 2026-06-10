import { KeywordSpec, AtsScoreResult } from '../types';

// ─────────────────────────────────────────────────────────────────────────────
// Deterministic ATS keyword scoring.
//
// The model extracts the keyword list from the JD ONCE (that's a language
// task — models are good at it). Scoring is then pure code: the same
// word-boundary regex scan an ATS keyword matcher performs. The score shown
// in the UI is measured, never self-reported by a model.
// ─────────────────────────────────────────────────────────────────────────────

const escapeRegex = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Build a case-insensitive matcher for a keyword.
 * Word boundaries are applied only where the term edge is alphanumeric, so
 * terms like "CI/CD", "Node.js", or ".NET" still match correctly.
 * Internal whitespace and hyphens are interchangeable ("alert noise" matches
 * "alert-noise") — resumes and JDs vary on this constantly.
 */
export const keywordRegex = (term: string): RegExp => {
  const t = term.trim();
  const esc = escapeRegex(t).replace(/(\\\s|\s|-)+/g, '[\\s\\u2010-\\u2015-]+');
  const lead = /^[A-Za-z0-9]/.test(t) ? '\\b' : '';
  const tail = /[A-Za-z0-9]$/.test(t) ? '\\b' : '';
  return new RegExp(lead + esc + tail, 'i');
};

/** Visible text of model output: strip **bold** markers. */
export const stripBoldMarkers = (s: string): string => (s || '').replace(/\*\*/g, '');

/** Weighted keyword-coverage score of a text against a JD keyword list. */
export const scoreTextAgainstKeywords = (
  text: string,
  keywords: KeywordSpec[]
): AtsScoreResult => {
  const visible = stripBoldMarkers(text);
  const matched: string[] = [];
  const missing: string[] = [];
  let matchedWeight = 0;
  let totalWeight = 0;

  for (const kw of keywords) {
    if (!kw?.term?.trim()) continue;
    const weight = Math.min(3, Math.max(1, Math.round(kw.weight ?? 1)));
    totalWeight += weight;
    const candidates = [kw.term, ...(kw.variants ?? [])].filter(Boolean);
    const hit = candidates.some(c => {
      try { return keywordRegex(c).test(visible); } catch { return false; }
    });
    if (hit) {
      matchedWeight += weight;
      matched.push(kw.term);
    } else {
      missing.push(kw.term);
    }
  }

  const score = totalWeight > 0 ? Math.round((matchedWeight / totalWeight) * 100) : 0;
  return { score, matched, missing, matchedWeight, totalWeight };
};

/**
 * Compose the post-modification resume text from the paragraph table + mods,
 * so coverage can be scored without re-parsing the docx.
 */
export const composeModifiedText = (
  paragraphTexts: string[],
  mods: Array<{ paragraph_id?: number; new_content: string }>
): string => {
  const byId = new Map<number, string>();
  for (const m of mods) {
    if (m.paragraph_id != null) byId.set(m.paragraph_id, m.new_content ?? '');
  }
  return paragraphTexts
    .map((t, i) => (byId.has(i) ? stripBoldMarkers(byId.get(i)!) : t))
    .filter(t => t.trim().length > 0)
    .join('\n');
};
