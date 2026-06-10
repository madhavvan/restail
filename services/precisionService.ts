import { ParagraphInfo, KeywordSpec, Modification } from "../types";

// ═════════════════════════════════════════════════════════════════════════════
// PRECISION PIPELINE — provider-agnostic core
//
// Division of labor that actually works:
//   • code does all GEOMETRY (paragraph IDs, char budgets, rendered-line and
//     page verification) — things language models are bad at,
//   • the model does all WORDING (JD-concept mapping, terminology, authentic
//     rewriting) — things it is excellent at.
// Every provider (Claude, GPT, DeepSeek, Gemini, Grok) writes through this
// exact same contract; each service supplies only a thin LlmCall transport.
// ═════════════════════════════════════════════════════════════════════════════

/** Minimal transport every provider adapter implements. */
export type LlmCall = (
  system: string,
  user: string,
  temperature: number,
  maxTokens: number
) => Promise<string>;

export const extractJsonBlock = (raw: string, open: string, close: string): string => {
  const cleaned = raw.replace(/```json/gi, "").replace(/```/g, "").trim();
  const a = cleaned.indexOf(open);
  const b = cleaned.lastIndexOf(close);
  if (a === -1 || b === -1 || b < a) {
    console.error("Raw response (first 500 chars):", raw.substring(0, 500));
    throw new Error("No JSON found in model response.");
  }
  return cleaned.substring(a, b + 1);
};

/**
 * Extract the ATS keyword list from a job description — once, as data.
 * Scoring against this list is done deterministically in code (atsScore.ts);
 * the model never grades itself.
 */
export const extractJdKeywords = async (
  call: LlmCall,
  jobDescription: string
): Promise<KeywordSpec[]> => {
  const system = `You extract ATS screening keywords from job descriptions for a deterministic keyword scanner.
Return ONLY a JSON array, no other text. Schema per entry:
  {"term": "node.js", "variants": ["nodejs", "node js"], "weight": 3}

Rules:
- 30–60 entries covering: the exact role title, every named language/tool/platform, core practices (e.g. "ci/cd", "observability", "incident management"), domain concepts, the JD's industry (e.g. "financial services"), and the soft-skill phrases the JD itself uses (e.g. "self-starter").
- MANDATORY: if the JD contains an explicit skills/qualifications checklist, EVERY named technology in it becomes its own entry — those are exactly what ATS filters screen for. Do not skip any, even niche ones.
- weight 3 = explicitly required, listed in qualifications, or repeated; 2 = clearly important; 1 = nice-to-have.
- "variants" holds true spelling/abbreviation equivalents only (matching ANY variant counts as a hit). Distinct concepts get their own entries — e.g. "site reliability engineer" and "sre" as separate entries when both forms matter.
- Terms must be matchable substrings likely to appear verbatim in a resume — no full sentences, no vague duties.
- Lowercase everything.`;

  const result = await call(
    system,
    `JOB DESCRIPTION:\n${jobDescription}\n\nReturn the JSON array now. First character [ and last character ].`,
    0,
    4000
  );

  const arr = JSON.parse(extractJsonBlock(result, "[", "]")) as KeywordSpec[];
  return (Array.isArray(arr) ? arr : [])
    .filter(k => k && typeof k.term === "string" && k.term.trim().length > 1)
    .map(k => ({
      term: k.term.trim().toLowerCase(),
      variants: (k.variants ?? []).filter(v => typeof v === "string" && v.trim()),
      weight: Math.min(3, Math.max(1, Math.round(Number(k.weight) || 1))),
    }));
};

// ─── Precision tailoring ─────────────────────────────────────────────────────

export interface EngineFindings {
  /** Mods whose visible length exceeded the paragraph budget (code-measured). */
  budgetViolations: Array<{ paragraph_id: number; visibleLen: number; maxChars: number }>;
  /** Paragraphs whose RENDERED line count grew after application. */
  layoutOffenders: Array<{ paragraph_id: number; lines: number; originalLines: number; targetChars: number }>;
  /** Rendered page count vs the original document's page count. */
  pages?: { current: number; target: number };
  /** Keywords the deterministic scanner still reports missing. */
  missingKeywords?: string[];
}

export interface PrecisionContext {
  round: "write" | "repair";
  strategistNotes?: string;
  previousModifications?: Modification[];
  findings?: EngineFindings;
}

const PRECISION_SYSTEM = `You are an elite executive resume writer and ATS strategist. You rewrite resume CONTENT ONLY — the Word document's formatting, fonts, bullets, and layout are locked and handled by a deterministic document engine.

THE CONTRACT (enforced in code — violations are measured and bounced back):
1. The resume arrives as numbered paragraphs: "[id] (max N chars | L line(s)) text". Lines marked LOCKED are context only — never target them.
2. Return ONLY JSON:
   {"ats": {"feedback": "<2-3 sentence strategy summary>"},
    "modifications": [{"paragraph_id": <number>, "new_content": "...", "reason": "...", "section": "..."}]}
3. new_content REPLACES that paragraph's entire text.
4. HARD LIMIT: visible length of new_content (excluding ** markers) ≤ that paragraph's "max N chars". The engine measures every mod.
5. Stay close to each paragraph's CURRENT length (within ~±10%). Never pad toward the max — shorter is layout-safe, longer is not.
6. new_content = "" deletes the paragraph — only when you deliberately merge its content into an adjacent bullet.
7. Allowed formatting: **bold** around key terms and skill labels ("**Languages:** Python..."). Nothing else: no \\n, no bullet symbols (•, -, *), no # headings.
8. NEVER edit facts: names, employers, job titles, locations, dates, degrees, GPAs, certifications. Rewrite descriptions, not biography.

MISSION
Produce a resume a senior engineer at the target company would call exceptional AND that maximizes coverage in a deterministic keyword scan. The TARGET KEYWORDS list you receive IS the scanner — every term you place naturally is measured afterwards.

THE PLAYBOOK (apply in this order)
1. HEADLINE — the professional title line near the top: it MUST contain the JD's exact role title VERBATIM as its first words (the single highest-weight ATS signal — "Senior Software Engineer", not "Software Engineer | Java"). Keep seniority honest; a short specialization suffix after the title is fine.
2. SUMMARY — rebuild JD-first: open with the role identity, name the JD's core stack using its exact tool/language names, keep the candidate's 2–3 strongest REAL metrics, and name the JD's industry explicitly ("financial services", "healthcare"). If the original summary mentions the JD's industry, dropping it is a hard failure. Dense, zero filler.
3. SKILLS TAXONOMY — RENAME the 2–3 most JD-relevant category labels to the JD's own vocabulary (e.g. "Data Engineering Tools" → "Event-Driven & Messaging" for a messaging-heavy JD; "Operations" → "Incident Management" for an SRE JD) and re-curate contents: what the JD emphasizes goes first, least-relevant items get dropped to make room. Merely reordering items inside old labels is NOT enough. A keyword in a skills line is fully ATS-valid — skills lines are your coverage workhorse.
4. EXPERIENCE — re-term every bullet toward the JD's language: keep the underlying fact and EVERY metric, swap generic verbs for the JD's verbs, replace off-target jargon with on-target equivalents the candidate's work genuinely supports. Employer/title/date lines stay untouched.
5. PROJECTS — re-title and re-angle so each project's most JD-relevant aspect leads. Expect to modify MOST experience bullets and SEVERAL project bullets; an untouched Projects section means you left ATS coverage on the table.
6. COVERAGE SWEEP — before finalizing, walk the TARGET KEYWORDS list top to bottom: EVERY term should land somewhere natural (skills, summary, or a bullet). Cluster related terms in one line where natural ("logging, metrics, dashboards, alerting").

AUTHENTICITY (both audiences must pass — the ATS scanner AND a human reader)
- Never copy a JD sentence or distinctive phrase verbatim into a bullet. Extract the CONCEPT, then express it through the candidate's real work, tools, and outcomes.
- The same keyword must not repeat with identical phrasing across multiple roles — vary verb, context, metric.
- Per-bullet test: would a senior engineer believe the candidate did this, or smell pasted JD text?

WRITING DISCIPLINE
- Complete sentences only; never end on a dangling connector ("and", "with", "via", "by", "for", "&").
- Every metric keeps its unit and meaning ("cut latency 40%", never a bare "40%").
- "&" belongs in skills/tool lists; in sentence prose prefer "and" unless the budget forces brevity — telegraphic "&"-everywhere prose reads cheap to senior reviewers.
- Tight forms welcome: "configs" for "configurations"; cut filler ("in order to" → "to").
- Bold sparingly: skill labels always; at most 1–3 key terms per bullet.

OUTPUT: raw JSON only. First character { and last character }.`;

const formatParagraphRow = (p: ParagraphInfo): string => {
  if (p.locked) {
    const why = p.lockReason === 'empty' ? 'empty spacer' : p.lockReason ?? 'protected';
    return `[${String(p.id).padStart(3, "0")}] LOCKED (${why}) ${p.fullText.substring(0, 90)}`;
  }
  const lines = p.lines > 0 ? `${p.lines} line${p.lines > 1 ? "s" : ""}` : "? lines";
  return `[${String(p.id).padStart(3, "0")}] (max ${p.maxChars} chars | ${lines}) ${p.text}`;
};

const formatKeywords = (keywords: KeywordSpec[]): string =>
  keywords
    .map(k => {
      const v = k.variants?.length ? ` [also counts: ${k.variants.join(", ")}]` : "";
      return `- ${k.term} (${k.weight ?? 1})${v}`;
    })
    .join("\n");

/**
 * ID-addressed tailoring call. Round "write" produces the full modification
 * set; round "repair" receives the engine's measured findings and returns
 * corrected mods ONLY for the flagged paragraphs.
 */
export const tailorResumePrecision = async (
  call: LlmCall,
  paragraphs: ParagraphInfo[],
  jobDescription: string,
  keywords: KeywordSpec[],
  ctx: PrecisionContext
): Promise<{ modifications: Modification[]; feedback: string }> => {
  const paragraphTable = paragraphs.map(formatParagraphRow).join("\n");
  let userPrompt: string;

  if (ctx.round === "write") {
    userPrompt = `TARGET KEYWORDS (the deterministic scanner checks each; weight in parentheses):
${formatKeywords(keywords)}

RESUME PARAGRAPHS:
${paragraphTable}

JOB DESCRIPTION:
${jobDescription}

${ctx.strategistNotes ? `STRATEGIST / AUDITOR NOTES (address these):\n${ctx.strategistNotes}\n` : ""}
Rewrite for maximum keyword coverage and an exceptional human read, honoring every budget. Return the complete modification set as JSON now. First character { and last character }.`;
  } else {
    const f = ctx.findings;
    const sections: string[] = [];

    if (f?.budgetViolations?.length) {
      sections.push(
        "BUDGET VIOLATIONS (visible length > max — cut words, keep all metrics):\n" +
        f.budgetViolations
          .map(v => `- [${v.paragraph_id}] your text is ${v.visibleLen} visible chars; HARD MAX ${v.maxChars}. Cut ≥ ${v.visibleLen - v.maxChars} chars.`)
          .join("\n")
      );
    }
    if (f?.layoutOffenders?.length) {
      sections.push(
        "LAYOUT OVERFLOWS (the rendered document measured these paragraphs taking MORE lines than the original):\n" +
        f.layoutOffenders
          .map(o => `- [${o.paragraph_id}] now renders ${o.lines} lines (original ${o.originalLines}). Rewrite at ≤ ${o.targetChars} visible chars.`)
          .join("\n")
      );
    }
    if (f?.pages) {
      sections.push(`PAGE STATUS: document now renders ${f.pages.current} page(s); target is exactly ${f.pages.target}. The paragraphs above are the cause.`);
    }
    if (f?.missingKeywords?.length) {
      sections.push(
        `STILL-MISSING KEYWORDS: ${f.missingKeywords.join(", ")}\n` +
        "Place EVERY one of these somewhere natural without exceeding any budget. You may UPDATE mods you already made " +
        "OR add NEW mods for any unlocked paragraph you haven't touched yet — skills lines are the easiest legitimate " +
        "placement, and renaming a skills-category label to the JD's vocabulary is allowed and encouraged. " +
        "A keyword in a skills list is fully ATS-valid; only skip a keyword if placing it would be an outright lie."
      );
    }

    userPrompt = `You previously produced the modifications below. The document engine applied them and MEASURED the result.

PREVIOUS MODIFICATIONS:
${JSON.stringify((ctx.previousModifications ?? []).map(m => ({ paragraph_id: m.paragraph_id, new_content: m.new_content })), null, 1)}

RESUME PARAGRAPHS (unchanged originals, with budgets):
${paragraphTable}

ENGINE FINDINGS:
${sections.join("\n\n")}

Fix ONLY the flagged issues. Return JSON with ONLY the corrected/updated modifications (same schema) — unlisted modifications are already locked in. Every metric must survive. First character { and last character }.`;
  }

  const content = await call(PRECISION_SYSTEM, userPrompt, 0.3, 32000);
  if (!content) throw new Error("No response from model");

  const parsed = JSON.parse(extractJsonBlock(content, "{", "}"));
  const rawMods: any[] = Array.isArray(parsed?.modifications) ? parsed.modifications : [];

  const modifications: Modification[] = rawMods
    .map(m => ({
      paragraph_id: Number(m?.paragraph_id),
      new_content: typeof m?.new_content === "string" ? m.new_content : "",
      original_excerpt: "", // enriched by the caller from the paragraph table
      reason: typeof m?.reason === "string" ? m.reason : undefined,
      section: typeof m?.section === "string" ? m.section : undefined,
    }))
    .filter(m => Number.isInteger(m.paragraph_id) && m.paragraph_id >= 0);

  const feedback = typeof parsed?.ats?.feedback === "string" ? parsed.ats.feedback : "";
  return { modifications, feedback };
};
