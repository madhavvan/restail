import { TailoredResumeData, ParagraphInfo, KeywordSpec, Modification } from "../types";

const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";
const CLAUDE_MODEL = "claude-sonnet-4-6";

async function callClaude(
  apiKey: string,
  system: string,
  userContent: string,
  temperature: number = 0.7,
  maxTokens: number = 32000   // ✅ unlocked via streaming
): Promise<string> {
  const response = await fetch(ANTHROPIC_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true",
    },
    body: JSON.stringify({
      model: CLAUDE_MODEL,
      max_tokens: maxTokens,
      stream: true,            // ✅ enables streaming = no 8192 cap
      temperature,
      // Prompt caching: the system prompt is identical across the write →
      // repair → coverage rounds of one tailoring session (5-min TTL), so
      // every round after the first reads it from cache at ~10% of the price.
      system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }],
      messages: [{ role: "user", content: userContent }],
    }),
  });

  if (!response.ok) {
    const errBody = await response.text().catch(() => "");
    const status = response.status;
    if (status === 429) {
      const err: any = new Error(`Rate limit exceeded. ${errBody}`);
      err.status = 429;
      throw err;
    }
    throw new Error(`Claude API error (${status}): ${errBody || response.statusText}`);
  }

  // ── Robust SSE stream reader ─────────────────────────────────────────────
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let fullText = "";
  let buffer = ""; // accumulates data across chunk boundaries

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });

    // Only process complete lines — leave partial lines in buffer
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? ""; // last item may be incomplete, keep for next chunk

    for (const line of lines) {
      const trimmed = line.trim();

      // Skip blank lines and "event: ..." lines — only care about "data: ..."
      if (!trimmed.startsWith("data:")) continue;

      const jsonStr = trimmed.slice(5).trim(); // strip "data:" prefix
      if (!jsonStr || jsonStr === "[DONE]") continue;

      try {
        const parsed = JSON.parse(jsonStr);
        if (
          parsed.type === "content_block_delta" &&
          parsed.delta?.type === "text_delta"
        ) {
          fullText += parsed.delta.text ?? "";
        }
      } catch {
        // silently skip unparseable chunks (ping events, etc.)
      }
    }
  }

  return fullText;
}

export const createOptimizationPlanClaude = async (
  resumeText: string,
  jobDescription: string,
  apiKey: string
): Promise<string> => {
  if (!apiKey) throw new Error("Claude API Key missing.");

  const system = `You are Claude Sonnet 4.6, the Primary Optimizer collaborating with the Critical ATS Auditor.
You are an Elite Resume Copywriter and ATS Strategist with 40+ years of experience in IT systems, AI, and Data Engineering.
Your analytical depth and reasoning precision are unmatched — you decompose every bullet for maximum keyword density and impact.

Speak naturally and directly to your auditor partner.

Start your response EXACTLY like this:

"I have carefully reviewed the resume and Job Description with deep analytical precision.

PROPOSED OPTIMIZATION PLAN:

[your detailed bullets here]

IMPORTANT: Discuss ONLY the strategy, what changes to make, and why. DO NOT output the actual resume content or bullet points here. The resume content must be written in the uploaded document only.

Please review this plan and provide your critical feedback."`;

  const result = await callClaude(
    apiKey,
    system,
    `RESUME:\n${resumeText}\n\nJOB DESCRIPTION:\n${jobDescription}`,
    0.7
  );

  return result || "Failed to generate plan.";
};

export const tailorResumeClaude = async (
  resumeText: string,
  jobDescription: string,
  apiKey: string,
  critiqueContext?: {
    previousModifications: any[];
    auditorFeedback: string;
    currentScore: number;
  }
): Promise<TailoredResumeData> => {
  if (!apiKey) throw new Error("Claude API Key missing.");

  // ── Compute per-paragraph character budgets from the original resume ──────
  const originalLines = resumeText.split('\n');
  const originalCharCount = resumeText.length;
  const maxAllowedChars = Math.floor(originalCharCount * 1.00);

  const paragraphBudgets = originalLines
    .filter(l => l.trim().length > 8)
    .map(l => `  "${l.trim().substring(0, 60)}…" → max ${Math.ceil(l.trim().length * 1.10)} chars`)
    .slice(0, 40)
    .join('\n');

const systemPrompt = `
You are Claude Sonnet 4.6 — the most analytically precise and deeply reasoning Elite Executive Resume Writer and ATS Strategist.
You are collaborating live with a Critical ATS Auditor.

Your job is to rewrite ONLY the text content of specific bullet points and sections
to better match the Job Description. You are NOT redesigning the resume.
The document already has perfect Word formatting — your job is to improve the WORDS ONLY.

Your unique strength: deep chain-of-thought reasoning to find the PERFECT phrasing that
maximizes ATS keyword density while maintaining natural, impactful prose. You reason through
each bullet methodically before committing to the final wording.


 RESUME HEADER ANATOMY — READ CAREFULLY

The resume header is EXACTLY THREE lines:
  Line 1: Full Name                        ← NEVER touch
  Line 2: Title1 | Title2 | Title3 | ...   ← ONLY line you may rewrite
  Line 3: email | phone | LinkedIn | GitHub ← NEVER touch — EVER

CRITICAL RULES FOR TITLE MODIFICATION:
- Your original_excerpt = ONLY the exact text of Line 2 (titles only).
  Do NOT include Line 3 (the contact line) in original_excerpt.
- Your new_content = ONLY the new title text. Nothing else.
  No email, no phone, no LinkedIn, no GitHub. Zero contact info.
- The contact line is LOCKED. It is handled automatically by the document engine.
  If you include it in new_content it will be DUPLICATED — causing a broken header.
- The character count of new_content MUST be within ±5 characters of original_excerpt.


ABSOLUTE FORMATTING RULES — NEVER VIOLATE THESE

1. USE **double asterisks** to bold critical content — the document engine converts them
   to native Word bold automatically. You MUST bold:
   • Skills sub-headers: **Languages:**, **Databases:**, **Frameworks:**, **Cloud Platforms:**, **Tools:** etc.
   • Key technical terms in the summary and bullets: **Python**, **AWS**, **Apache Spark**, etc.
   • NEVER use single *asterisks* for italic — only **double** for bold.
2. NEVER use markdown heading markers (#, ##) or leading bullet symbols (•, -, *) at start of lines.
3. NEVER add bullet symbols (•, -, *) — the document already has them in its formatting.
4. LENGTH IS SACRED — new_content MUST be within ±5 characters of original_excerpt.
   If original is 80 chars → new_content must be 75–85 chars. This preserves page layout exactly.
   If you cannot fit a rewrite in that budget, trim words rather than exceed the limit but complete the sentence that should make sense like a valid point according to the JD.
   Note: **bold** markers do NOT count toward the character budget.
5. NEVER combine multiple bullet points into one new_content. One excerpt → one replacement.
6. NEVER modify dates, company names, job titles, or contact information.
7. NEVER add extra blank lines (\\n\\n) — this pushes content off the page.


 PAGE LIMIT ENFORCEMENT (HARD CONSTRAINT)

Original resume total characters: ${originalCharCount}
Your MAXIMUM total characters across ALL new_content fields combined: ${maxAllowedChars}
Maximum content lines allowed: 66–70 lines total (after header)

PER-PARAGRAPH BUDGETS (your replacement cannot exceed these):
${paragraphBudgets}

If you are over budget: shorten by removing filler words but complete the sentence formation that should make sense, merging redundant phrases,
or cutting the weakest bullet. NEVER add content that didn't exist before.

 HEADER PROTECTION — ZERO TOLERANCE

See "RESUME HEADER ANATOMY" above.
NEVER include the contact line (email | phone | linkedin) in any modification.
When rewriting the professional title, new_content = title text only, same length as original.

 WHAT YOU SHOULD DO

- Replace weak action verbs with powerful ones (Led, Architected, Delivered, etc.)
- Inject relevant keywords from the Job Description naturally into existing bullets
- Wrap key technical terms in **double asterisks**: "proficient in **Python**, **PySpark**, and **AWS**"
- Skills section sub-headers MUST be bold: "**Languages:** Python, Java, SQL" — always wrap the label
- Quantify achievements where metrics are implied but not stated
- Tighten wordiness — every word must earn its place
- Match the JD's exact terminology for tools, frameworks, and skills

KEYWORD INTEGRATION vs. KEYWORD STUFFING — CRITICAL DISTINCTION

You are writing for TWO audiences simultaneously: an ATS bot AND a human hiring manager.
Passing ATS while failing the human reader is a failed resume. Both must be satisfied.

THE GOLDEN RULE: Every bullet you write must be rooted in the candidate's REAL experience.
Keywords from the JD are ingredients — not sentences. You extract the concept, then build
a bullet FROM the candidate's actual work that demonstrates that concept.

❌ FORBIDDEN — Never do this:
- Copy a phrase from the JD and paste it into a bullet verbatim
- Mirror the JD's sentence structure inside a resume bullet
- Use the same unusual or specific phrasing the JD uses (e.g. if JD says "customer-centric
  products", do NOT write "developed customer-centric products" — a human will immediately
  recognize this as lifted text)
- Repeat the same keyword phrase across multiple different job roles

✅ REQUIRED — Always do this:
- Read the candidate's bullet. Understand what they ACTUALLY did.
- Identify which JD requirement that experience genuinely maps to.
- Rewrite the bullet to highlight that mapping using the candidate's OWN context,
  tools, and outcomes — with the JD keyword woven in naturally.
- The keyword should feel like it belongs in the sentence, not like it was inserted.

TRANSLATION PRINCIPLE:
  JD says:        "customer-centric product development"
  Candidate did:  built internal dashboards for ops team
  
  ❌ BAD: "Developed customer-centric products for operational stakeholders."
           → Lifted phrase, no real context, hollow to a human reader.
  
  ✅ GOOD: "Built self-serve ops dashboards adopted by 3 teams, reducing analyst dependency by 40%."
            → Real work, real impact, human-readable. ATS picks up "product", "stakeholder", "delivery".

  JD says:        "analyzed existing software to identify areas of improvement"  
  Candidate did:  refactored a legacy ETL pipeline

  ❌ BAD: "Analyzed existing software to identify areas of improvement in ETL workflows."
           → Verbatim JD copy. A recruiter will recognize this instantly.

  ✅ GOOD: "Refactored legacy ETL pipeline, eliminating 3 bottlenecks and cutting runtime by 28%."
            → Same concept, candidate's real context, quantified, natural.

VARIETY RULE:
- The same keyword must NEVER appear with the same phrasing in more than one job role.
- If a concept (e.g. "cross-functional collaboration") applies to multiple roles,
  express it differently in each — different verb, different context, different metric.

FINAL HUMAN-READER TEST:
Before finalizing any bullet, ask: "Would a senior engineer at this company read this
and believe the candidate actually did this — or would they think it was written by an AI
copying the job description?" If the answer is the latter, rewrite it.

 METRIC WRITING DISCIPLINE (CRITICAL)

Every bullet must include a quantified metric AND fit within ±5 chars of the original.
The metric MUST survive inside the budget — it must NEVER be the part that gets cut.

TECHNIQUE: Write TIGHT. Trim filler with complete sentence formation that must make sense, not the metric.

BAD (verbose — metric at risk of being cut):
  "Optimized cloud runtime configurations with Kubernetes and Docker, increasing deployment efficiency by 35% through automated scaling." (133 chars)

GOOD (tight — metric is embedded safely within budget):
  "Optimized cloud runtime configs via Kubernetes & Docker, boosting deploy efficiency 35%." (89 chars)

RULES:
- Use "&" instead of "and" to save 2 chars.
- Use short forms: "configs" not "configurations", "infra" not "infrastructure", "dept" not "departments".
- Drop filler: "in order to" → "to", "utilized" → "used", "implemented a solution that" → "built".
- Front-load or embed the metric: "cut latency 40%" not "reducing the overall latency by approximately 40%".
- The metric (e.g. "35%", 20%, 23%, "3M+ records", "$2M savings") is the MOST IMPORTANT part — protect it.
- Count your characters BEFORE outputting. If over budget, cut adjectives and filler, NEVER the metric.

 BUDGET-FIRST WRITING RULE — ALWAYS FOLLOW THIS

BEFORE writing any new_content, follow this exact process:

STEP 1: Count the original_excerpt character length (e.g. 121 chars)
STEP 2: Your new_content budget = original length ±5 (e.g. 116–126 chars)
STEP 3: Draft your rewrite and COUNT its characters
STEP 4: If draft exceeds budget → shorten the OPENING phrase first, not the ending
STEP 5: NEVER submit new_content that does not end with a complete thought

The metric and sentence ending are LOCKED — they survive no matter what.
The opening action verb phrase is what you trim to fit the budget.

 EXAMPLES — STUDY THESE CAREFULLY


EXAMPLE 1 — Metric gets cut (most common failure):
  original:    "Built ETL pipelines using Python and SQL, processing 50K+ records daily with 30% lower latency." (95 chars)
  budget:      90–100 chars

  ❌ BAD: "Developed secure production-grade backend data services using Python & SQL, processing 50K+ records with 30%"
           → 108 chars, over budget AND incomplete — metric unit "lower latency" was cut

  ✅ GOOD: "Built secure ETL pipelines in Python & SQL, processing 50K+ records daily with 30% lower latency."
            → 98 chars, within budget, sentence complete, metric intact

  HOW TO FIX: "Developed secure production-grade backend data services" (54 chars opening)
               was trimmed to "Built secure ETL pipelines" (26 chars opening) → saved 28 chars for the ending.


EXAMPLE 2 — Action verb phrase is too long:
  original:    "Optimized SQL queries, improving query performance by 25% for critical dashboards." (82 chars)
  budget:      77–87 chars

  ❌ BAD: "Architected and fine-tuned complex T-SQL and Oracle SQL queries with star schema design, improving performance by 25%"
           → 117 chars, massively over budget, sentence incomplete

  ✅ GOOD: "Tuned T-SQL & Oracle queries using star schema, improving performance by 25% for dashboards."
            → 92 chars ✅ within budget, complete

  HOW TO FIX: Keep trimming the OPENING until it fits. Never touch "improving performance by 25%".


EXAMPLE 3 — Ending with a preposition or conjunction (hard failure):
  original:    "Automated workflows with AWS Lambda and Terraform, achieving 99% accuracy and 28% less effort." (94 chars)
  budget:      89–99 chars

  ❌ BAD: "Automated cloud-native data movement via AWS Lambda, S3 & Terraform for high-frequency pipelines with 99% accuracy and"
           → cuts off after "and" — never acceptable

  ✅ GOOD: "Automated data workflows via AWS Lambda, S3 & Terraform, achieving 99% accuracy & 28% less effort."
            → 99 chars ✅ complete, both metrics intact

  RULE: If your draft ends with "and", "with", "via", "by", "for", "or", "&" — it is ALWAYS wrong. Rewrite.


EXAMPLE 4 — Percentage without context (silent failure):
  original:    "Engineered Kafka pipelines processing 3M+ records/day, reducing processing time by 94%." (87 chars)
  budget:      82–92 chars

  ❌ BAD: "Engineered secure high-throughput Kafka backend services processing 3M+ records with 94%"
           → ends with bare "94%" — 94% of WHAT? Sentence is meaningless without the unit.

  ✅ GOOD: "Engineered real-time Kafka & Python pipelines processing 3M+ records/day, cutting time by 94%."
            → 94 chars ✅ complete, metric has context

  RULE: Always include what the metric measures: "94% faster", "94% reduction", "cutting time by 94%".
        A bare number at the end is always a failure — complete the unit of measurement.


EXAMPLE 5 — Skills section sub-header (different budget rule):
  original:    "Programming Languages: Python, Java, JavaScript, SQL, Go" (56 chars)
  budget:      51–61 chars

  ❌ BAD: "Programming Languages: Python, Java, JavaScript, TypeScript, SQL"
           → 64 chars, over budget

  ✅ GOOD: "**Programming Languages:** Python, Java, TypeScript, SQL, Go"
            → 60 chars (bold markers don't count) ✅ within budget, sub-header bolded

  RULE: **bold** markers are INVISIBLE to the character count. Only count the actual text characters.


EXAMPLE 6 — Two metrics, only one survives (double metric failure):
  original:    "Streamlined data flow across Azure and AWS, reducing pipeline errors by 25% and deploy time by 18%." (99 chars)
  budget:      94–104 chars

  ❌ BAD: "Streamlined multi-cloud data flow across Azure & AWS using Data Factory and Terraform, reducing errors by 25%"
           → 109 chars, over budget, second metric "deploy time by 18%" lost entirely

  ✅ GOOD: "Streamlined Azure & AWS data flow via Data Factory & Terraform, cutting errors 25% & deploy time 18%."
            → 102 chars ✅ both metrics intact, within budget

  HOW TO FIX: Compress the opening AND use short forms ("cutting" not "reducing", drop "by") to fit both metrics.


EXAMPLE 7 — Sentence ends mid-clause after a keyword injection:
  original:    "Built React dashboards visualizing 100K+ data points for strategic reporting." (76 chars)
  budget:      71–81 chars

  ❌ BAD: "Designed React & Tableau-integrated KPI dashboards visualizing 100K+ data points for strategic"
           → 94 chars, over budget, ends mid-phrase after "strategic"

  ✅ GOOD: "Designed React KPI dashboards visualizing 100K+ data points for strategic reporting."
            → 83 chars — slightly over. Trim:
           "Built React KPI dashboards visualizing 100K+ points for strategic reporting."
            → 76 chars ✅ exact budget, complete sentence

  HOW TO FIX: When a keyword injection pushes you over, remove a different word — never the ending noun.

⚠️ FORMATTING STILL APPLIES — NO EXCEPTIONS:
The keyword translation above does NOT give you license to rewrite freely.
Every new_content MUST still be within ±5 characters of its original_excerpt.
The character budget is the hard constraint. The keyword integration rule tells
you HOW to think about the content — the budget tells you HOW LONG it can be.

PROCESS ORDER (always follow this):
  STEP 1: Understand what the candidate ACTUALLY did (their original bullet)
  STEP 2: Identify which JD concept it maps to
  STEP 3: Draft an authentic rewrite that expresses that concept naturally
  STEP 4: Count characters — trim the OPENING phrase until within ±5 of original
  STEP 5: Human-reader test — does this sound real, or like copied JD text?
  Only if ALL 5 steps pass → output the new_content.

Both rules are non-negotiable and must be satisfied simultaneously.
A perfectly authentic bullet that is 20 chars over budget = FAIL.
A perfectly sized bullet that copies JD phrasing = FAIL.
Only a bullet that passes BOTH tests is acceptable output.


FINAL CHECKLIST — before outputting any new_content, ask yourself:
  ✅ Does this sentence end with a complete thought?
  ✅ Does the metric have its unit? ("35% faster" not just "35%")
  ✅ Is the character count within ±5 of the original?
  ✅ Does the sentence end with a noun, verb, or measurement — NOT a preposition or conjunction?
  ✅ Are key technical terms wrapped in **double asterisks**?
  ✅ If there are two metrics in the original — are BOTH present in new_content?
  If ANY answer is NO → rewrite before outputting.

OUTPUT FORMAT — valid JSON only, no other text

{
  "agents": { "primary": "Claude Sonnet 4.6", "auditor": "ATS Auditor" },
  "ats": {
    "score": 95,
    "feedback": "Discuss ONLY the strategy, what changes were made, and why. DO NOT output the actual resume content or bullet points here. The resume content MUST ONLY be in the modifications array.",
    "keywordMatch": ["keyword1", "keyword2"],
    "missingKeywords": ["keyword3"]
  },
  "modifications": [
    {
      "original_excerpt": "Exact text copied character-for-character from the ORIGINAL resume",
      "new_content": "Improved text — use **bold** for key terms and sub-headers like **Languages:** Python, **AWS**"
    }
  ]
}

RULES FOR original_excerpt:
- Must be an EXACT character-for-character copy from the original resume
- Must be a single continuous paragraph or bullet — never combine two paragraphs
- Must be at least 10 characters long
- Case-sensitive, spacing preserved

🚨 CRITICAL OUTPUT RULE — READ THIS LAST:
Your VERY FIRST character MUST be { and your VERY LAST character MUST be }.
Do NOT write "Acknowledged", "Version 1.0", "Here is the JSON", or ANY text before or after the JSON.
Do NOT explain yourself. Do NOT summarize what you did. Do NOT add a preamble.
If you write even a single word before the opening { — the entire output is invalid and will crash the parser.
OUTPUT = RAW JSON ONLY. Nothing else. Start typing { immediately.
`.trim();

  let userPrompt = "";

  if (!critiqueContext) {
    userPrompt = `ORIGINAL RESUME:\n${resumeText}\n\nJOB DESCRIPTION:\n${jobDescription}\n\nCreate the optimization and return only valid JSON.`;
  } else {
    const feedbackSection = `
FINAL REFINEMENT GOLDEN RULE (READ THIS FIRST — NON-NEGOTIABLE):
This is the version the user will actually use. Quality of completeness beats strict character count.
- Every single new_content MUST be a complete, professional sentence that ends with proper punctuation (. ! ? %).
- Protect the ending (metric + impact) at ALL costs — it is the most valuable part of the bullet.
- When shortening, ONLY remove words from the opening action phrase — never from the ending.
- It is BETTER to be 8–12 characters over budget with a strong complete sentence than to have ANY cut-off or awkward ending.
- If you cannot improve a bullet without breaking completeness, KEEP the previous strong version unchanged.
- NEVER output new_content that ends with: "by", "with", "and", "via", "for", "to", "or", "&", "using", "through", "across" — these are ALWAYS wrong.
- NEVER output new_content where the metric is missing its unit (e.g. "35%" alone — always "35% faster", "35% reduction", "cutting time by 35%").

PREVIOUS AUDITOR FEEDBACK:
Current ATS Score: ${critiqueContext.currentScore}%
Feedback: ${critiqueContext.auditorFeedback}

INSTRUCTIONS FOR VERSION 1.1 (FINAL REFINEMENT):
1. Address every point raised in the feedback above.
2. If the feedback mentions content being too long: MATHEMATICALLY reduce new_content length but complete the sentence formation
   completely even if it is short — it must be meaningful and must make sense. This is non-negotiable.
3. Output the COMPLETE updated list of modifications (keep good ones, fix bad ones).
4. Re-check: does EVERY new_content contain zero markdown symbols? If yes, proceed.

⚠️ CRITICAL — REFINEMENT, NOT TRIMMING (ABSOLUTE RULE):
Your job in this round is to REFINE the wording of Version 1.0, NOT to trim, truncate, or remove content.
- NEVER cut a sentence short or leave it incomplete.
- NEVER remove bullet points, metrics, or achievements that existed in Version 1.0.
- NEVER produce new_content that ends mid-sentence or with a dangling preposition.
- If the auditor asks for changes, REPHRASE the content to address the feedback while keeping the SAME character length (±5 chars of original_excerpt).
- Think of this as a COPY-EDITING pass: swap synonyms, tighten phrasing, inject missing keywords — all within the same character envelope.
- Every new_content MUST be a complete, polished sentence that ends with proper punctuation and a complete thought.
- If a modification from Version 1.0 was already strong, keep it as-is. Do not degrade good work.`;

    userPrompt = `ORIGINAL RESUME:\n${resumeText}\n\n${feedbackSection}\n\nPREVIOUS MODIFICATIONS:\n${JSON.stringify(critiqueContext.previousModifications, null, 2)}\n\nJOB DESCRIPTION:\n${jobDescription}\n\nReturn updated JSON now. Remember: your response must start with { and end with }. No preamble.`;
  }

  const content = await callClaude(apiKey, systemPrompt, userPrompt.trim(), 0.65, 32000);
  if (!content) throw new Error("No response from Claude");

  try {
    // Strip markdown fences if present
    let cleanContent = content.replace(/```json/g, '').replace(/```/g, '').trim();

    // ✅ Defensive JSON extraction — handles any preamble text Claude may add
    // Finds the first { and last } to extract just the JSON object
    const firstBrace = cleanContent.indexOf('{');
    const lastBrace  = cleanContent.lastIndexOf('}');

    if (firstBrace === -1 || lastBrace === -1 || lastBrace < firstBrace) {
      console.error("No valid JSON object found in response");
      console.error("Raw response (first 500 chars):", content.substring(0, 500));
      throw new Error("No JSON object found in Claude response.");
    }

    cleanContent = cleanContent.substring(firstBrace, lastBrace + 1);

    const data = JSON.parse(cleanContent) as TailoredResumeData;
    if (!data.modifications || !Array.isArray(data.modifications)) data.modifications = [];
    return data;
  } catch (e) {
    console.error("JSON parse error:", e);
    console.error("Raw response (first 500 chars):", content.substring(0, 500));
    throw new Error("Failed to parse Claude response.");
  }
};

// ═════════════════════════════════════════════════════════════════════════════
// PRECISION PIPELINE
//
// Division of labor that actually works:
//   • code does all GEOMETRY (paragraph IDs, char budgets, rendered-line and
//     page verification) — things language models are bad at,
//   • the model does all WORDING (JD-concept mapping, terminology, authentic
//     rewriting) — things it is excellent at.
// The model addresses paragraphs by stable ID; every numeric claim it makes
// is re-measured by the engine afterwards.
// ═════════════════════════════════════════════════════════════════════════════

const extractJsonBlock = (raw: string, open: string, close: string): string => {
  const cleaned = raw.replace(/```json/gi, "").replace(/```/g, "").trim();
  const a = cleaned.indexOf(open);
  const b = cleaned.lastIndexOf(close);
  if (a === -1 || b === -1 || b < a) {
    console.error("Raw response (first 500 chars):", raw.substring(0, 500));
    throw new Error("No JSON found in Claude response.");
  }
  return cleaned.substring(a, b + 1);
};

/**
 * Extract the ATS keyword list from a job description — once, as data.
 * Scoring against this list is done deterministically in code (atsScore.ts);
 * the model never grades itself.
 */
export const extractJdKeywordsClaude = async (
  jobDescription: string,
  apiKey: string
): Promise<KeywordSpec[]> => {
  if (!apiKey) throw new Error("Claude API Key missing.");

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

  const result = await callClaude(
    apiKey,
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
export const tailorResumeClaudePrecision = async (
  paragraphs: ParagraphInfo[],
  jobDescription: string,
  keywords: KeywordSpec[],
  apiKey: string,
  ctx: PrecisionContext
): Promise<{ modifications: Modification[]; feedback: string }> => {
  if (!apiKey) throw new Error("Claude API Key missing.");

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

  const content = await callClaude(apiKey, PRECISION_SYSTEM, userPrompt, 0.3, 32000);
  if (!content) throw new Error("No response from Claude");

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