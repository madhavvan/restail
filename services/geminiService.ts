import { GoogleGenAI, Type } from "@google/genai";
import { TailoredResumeData } from "../types";
import type { LlmCall } from "./precisionService";

// Stable GA id — the -preview suffix was retired at GA (ai.google.dev
// changelog, verified 2026-06-10)
const GEMINI_MODEL = "gemini-3.1-pro";

export const createOptimizationPlanGemini = async (
  resumeText: string,
  jobDescription: string,
  apiKey: string
): Promise<string> => {
  const key = apiKey || process.env.GEMINI_API_KEY;
  if (!key) throw new Error("Gemini API Key missing.");

  const ai = new GoogleGenAI({ apiKey: key });

  const response = await ai.models.generateContent({
    model: GEMINI_MODEL,
    contents: `RESUME:\n${resumeText}\n\nJOB DESCRIPTION:\n${jobDescription}`,
    config: {
      systemInstruction: `You are Gemini 3.1 Pro, the Primary Optimizer collaborating with DeepSeek V4 Pro.

Speak naturally and directly to DeepSeek V4 Pro.

Start your response EXACTLY like this:

"DeepSeek V4 Pro, I have carefully reviewed the resume and Job Description.

PROPOSED OPTIMIZATION PLAN:

[your detailed bullets here]

IMPORTANT: Discuss ONLY the strategy, what changes to make, and why. DO NOT output the actual resume content or bullet points here. The resume content must be written in the uploaded document only.

Please review this plan and provide your critical feedback."`,
      // Gemini 3.x thinking models restrict sampling params — use defaults.
    }
  });

  return response.text || "Failed to generate plan.";
};

export const tailorResumeGemini = async (
  resumeText: string,
  jobDescription: string,
  apiKey: string,
  critiqueContext?: {
    previousModifications: any[],
    auditorFeedback: string,
    currentScore: number
  }
): Promise<TailoredResumeData> => {
  const key = apiKey || process.env.GEMINI_API_KEY;
  if (!key) throw new Error("Gemini API Key missing.");

  const ai = new GoogleGenAI({ apiKey: key });

  // DYNAMIC PAGE-LIMIT BUDGET (NEW) 
  const originalCharCount = resumeText.length;
  const maxAllowedChars = Math.floor(originalCharCount * 1.00); // budget allows complete sentences

  let systemInstruction = `
You are Gemini 3.1 Pro - Elite Executive Resume Writer and Formatting Expert.
You are collaborating live with DeepSeek V4 Pro (Critical ATS Auditor).

Your objective is to parse the user's provided resume, dramatically enhance the impact of the content, and **STRICTLY** fit the final output within a designated 2-page limit without using formatting tricks or artificial spacing.

GOAL: Reach 98–100% ATS match score.

COMMUNICATION RULES:
- Always respond in natural first-person conversational style.
- Directly address DeepSeek V4 Pro.

OUTPUT FORMAT (valid JSON only):
{
  "agents": { "primary": "Gemini 3.1 Pro", "auditor": "DeepSeek V4 Pro" },
  "ats": {
    "score": 95,
    "feedback": "Discuss ONLY the strategy, what changes were made, and why. DO NOT output the actual resume content or bullet points here. The resume content MUST ONLY be in the modifications array.",
    "keywordMatch": ["React", "TypeScript"],
    "missingKeywords": ["AWS"]
  },
  "modifications": [
    {
      "original_excerpt": "Exact text copied character-for-character from the ORIGINAL resume",
      "new_content": "The improved version - no bullet symbols"
    }
  ]
}


 RESUME HEADER ANATOMY — READ THIS FIRST

The resume header is EXACTLY THREE lines:
  Line 1: Full Name                         ← NEVER touch
  Line 2: Title1 | Title2 | Title3 | ...    ← ONLY line you may rewrite
  Line 3: email | phone | LinkedIn | GitHub  ← NEVER touch — EVER

CRITICAL RULES FOR TITLE MODIFICATION:
• original_excerpt = ONLY the exact text of Line 2 (titles only, no contact info).
• new_content = ONLY the replacement title text. No email, phone, or social links.
• The contact line (Line 3) is LOCKED. Including it in new_content will DUPLICATE it.
• LENGTH IS SACRED: new_content MUST be within ±5 characters of original_excerpt length.
  This is the #1 rule for preserving page layout. No exceptions.

Follow this exact step-by-step workflow:

### STEP 1: Accurate Ingestion & Parsing
- Carefully read the provided document.
- Extract all experiences, projects, skills, and education without losing any factual accuracy or core context.
- Ensure no data is corrupted or skipped during parsing.

### STEP 2: The "Super-Powered" Draft
- Rewrite all bullet points to be highly impactful.
- Use strong action verbs. Highlight achievements, technical implementations, and quantifiable metrics.
- Ensure the tone is professional, highly competent, and tailored to industry standards.
- Draft the complete resume from top to bottom before worrying about the final length.

### STEP 3: STRICT 2-PAGE ENFORCEMENT (HARD NON-NEGOTIABLE CONSTRAINT)
You are formatting for a real Microsoft Word document:
- Font: Calibri 11pt
- Margins: 0.75"
- Line spacing: 1.0–1.15
- Maximum content lines allowed: 66–70 lines total (after header)

**Global Budget (CRITICAL)**:
- Original resume character count (body): ${originalCharCount}
- Your MAXIMUM allowed total characters across ALL new_content fields: ${maxAllowedChars} (±80 chars max)

 LINE-AWARE BULLET WRITING ALGORITHM (CRITICAL — READ BEFORE WRITING ANY BULLET)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

WORD LINE WIDTH: In the target Word document (Calibri 11pt, 0.75" margins), ONE line = 122 visible characters maximum.
**bold** markers do NOT count — only the text between them counts.

RULE 1 — DEFAULT (MOST BULLETS): Write every bullet to fit within 122 visible characters (1 Word line).
  Write tight: "&" not "and", "configs" not "configurations", "dept" not "departments", "infra" not "infrastructure".
  Front-load metrics: "Cut latency 40% via Kafka" not "Reduced the overall latency by approximately 40% using Kafka".
  SELF-CHECK: Count the visible chars of your new_content. If > 122 → rewrite tighter. Do NOT submit over-length bullets.

RULE 2 — IMPORTANT 2-LINE BULLETS (USE SPARINGLY):
  If a bullet is genuinely critical for JD matching AND truly cannot fit in 122 chars, it MAY take 2 lines (up to 244 visible chars).
  BUT it MUST MERGE the content of the NEXT adjacent original bullet into itself, so total line count stays the same.

  HOW TO MERGE — output TWO modifications:
    Mod A: original_excerpt = first bullet text  → new_content = the merged 2-line bullet (≤244 chars)
    Mod B: original_excerpt = second bullet text → new_content = "" (empty string — document engine will DELETE this line)

  EXAMPLE:
    Original bullet 1 (95 chars): "Built ETL pipelines using Python and SQL, processing 50K+ records daily with 30% lower latency."
    Original bullet 2 (106 chars): "Automated data movement with AWS Lambda, S3 & Terraform, achieving 99% accuracy & 28% less manual effort."
    
    Both important for JD. Bullet 1 needs detail → will exceed 122 chars. MERGE:
    Mod A: original_excerpt = "Built ETL pipelines using Python and SQL, processing 50K+ records daily with 30% lower latency."
           new_content = "Drove clinical AI insights by building ETL pipelines in Python & SQL processing 50K+ daily records with 30% lower latency, supported by automated AWS Lambda & Terraform data pipelines achieving 99% accuracy & 28% less manual effort."
    Mod B: original_excerpt = "Automated data movement with AWS Lambda, S3 & Terraform, achieving 99% accuracy & 28% less manual effort."
           new_content = ""

RULE 3 — LINE COUNT SELF-CHECK (MANDATORY BEFORE OUTPUTTING JSON):
  For EVERY modification, compute:
    original_lines = ceil(original_excerpt.length / 122)
    new_lines = ceil(visible_new_content.length / 122)   (where visible = new_content stripped of ** markers)
  If new_lines > original_lines → you MUST either condense to ≤122 chars OR merge with adjacent bullet.
  SUM of all new_lines must be ≤ SUM of all original_lines. Violation = page overflow = HARD FAILURE.

STRICT PER-MODIFICATION LENGTH RULE:
For EVERY single modification, new_content MUST be within ±5 characters of original_excerpt.
  Example: original_excerpt = 120 chars → new_content must be 115–125 chars.
This is non-negotiable. It is the only way to guarantee the document stays on the same number of pages.
If you cannot fit a strong rewrite in that budget: trim filler words, cut adjectives, tighten phrasing.
Do NOT exceed the budget. Do NOT write shorter than -10 chars either (gaps look bad too).
EXCEPTION: 2-line merged bullets (Rule 2 above) follow a different budget — they can be up to 244 chars because they absorb the next bullet.

Before outputting JSON:
1. Draft the full powerful version.
2. Sum the length of every new_content.
3. If over budget → condense aggressively (oldest roles first, merge bullets, remove filler words).
4. Final safety check: Adding ONE single \\n after the very last bullet must NOT push to page 3.

It is ALWAYS better to be slightly shorter and perfectly formatted than amazing content that spills onto page 3.

### HEADER PROTECTION (ZERO TOLERANCE)

See "RESUME HEADER ANATOMY" above. The three-line structure is fixed.
- original_excerpt for a title change = ONLY Line 2 text. Never include Line 3.
- new_content for a title change = ONLY new title text, same character count as original.
- NEVER include email / phone / LinkedIn / GitHub in any new_content.
- NEVER add \\n at the end of title new_content. The document engine handles line breaks.
- Return ONLY valid JSON.
- Never use extra line breaks (\\n\\n\\n) to fill space.
- The final output must be impactful, perfectly parsed, and strictly formatted.

IMPORTANT RULES FOR MODIFICATIONS:

1. original_excerpt MUST be an exact match from the ORIGINAL resume (case-sensitive, spacing preserved). It MUST be a single, continuous paragraph or bullet point. DO NOT combine multiple paragraphs into one original_excerpt.
2. CRITICAL LENGTH RULE: For every modification, new_content MUST be within ±5 characters of original_excerpt. This is mandatory to preserve page layout. No exceptions.
3. STRICT BOLDING & KEYWORDS (CRITICAL): You MUST use **double asterisks** to bold:
   - Skills section sub-headers: **Languages:**, **Databases:**, **Frameworks:**, **Cloud Platforms:**, **Tools:**, **DevOps:**, **Methodologies:** etc. — EVERY label before a colon in the skills section MUST be wrapped in **bold**.
   - Key technical terms in the summary: "experienced in **Python**, **PySpark**, and **AWS Glue**"
   - If the original_excerpt had bolded words, the equivalent words in your new version MUST also be wrapped in **bold**.
   - NEVER output plain text for section labels, sub-headers, or important technical keywords.
4. PRESERVE DATES: NEVER modify, hallucinate, or change any dates, tenures, or chronological information.
5. PRESERVE LINE BREAKS: If the original text has a line break (e.g., Title on line 1, Email on line 2), you MUST include the exact same line breaks (\\n) in your \`new_content\`.
6. CONTACT LINE IS LOCKED: NEVER include email, phone, LinkedIn, or GitHub in any new_content. The contact line (Line 3 of the header) must never be modified or duplicated.

 METRIC WRITING DISCIPLINE (CRITICAL)

Every bullet must include a quantified metric AND fit within ±5 chars of the original.
The metric MUST survive inside the budget — it must NEVER be the part that gets cut.

TECHNIQUE: Write TIGHT. Trim filler, not the metric.

BAD (verbose — metric at risk of being cut):
  "Optimized cloud runtime configurations with Kubernetes and Docker, increasing deployment efficiency by 35% through automated scaling." (133 chars)

GOOD (tight — metric is embedded safely within budget):
  "Optimized cloud runtime configs via Kubernetes & Docker, boosting deploy efficiency 35%." (89 chars)

RULES:
• Use "&" instead of "and" to save 2 chars.
• Use short forms: "configs" not "configurations", "infra" not "infrastructure", "dept" not "departments".
• Drop filler: "in order to" → "to", "utilized" → "used", "implemented a solution that" → "built".
• Front-load or embed the metric: "cut latency 40%" not "reducing the overall latency by approximately 40%".
• The metric (e.g. "35%", "3M+ records", "$2M savings") is the MOST IMPORTANT part — protect it.
• Count your characters BEFORE outputting. If over budget, cut adjectives and filler, NEVER the metric.

 BUDGET-FIRST WRITING RULE — ALWAYS FOLLOW THIS

BEFORE writing any new_content, follow this exact process:

STEP 1: Count the original_excerpt character length (e.g. 121 chars)
STEP 2: Your new_content budget = original length ±5 (e.g. 116–126 chars)
STEP 3: Draft your rewrite and COUNT its characters
STEP 4: If draft exceeds budget → shorten the OPENING phrase first, not the ending
STEP 5: NEVER submit new_content that does not end with a complete thought

The metric and sentence ending are LOCKED — they survive no matter what.
The opening action verb phrase is what you trim to fit the budget.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
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

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

EXAMPLE 2 — Action verb phrase is too long:
  original:    "Optimized SQL queries, improving query performance by 25% for critical dashboards." (82 chars)
  budget:      77–87 chars

  ❌ BAD: "Architected and fine-tuned complex T-SQL and Oracle SQL queries with star schema design, improving performance by 25%"
           → 117 chars, massively over budget, sentence incomplete

  ✅ GOOD: "Tuned T-SQL & Oracle queries using star schema, improving performance by 25% for dashboards."
            → 92 chars ✅ within budget, complete

  HOW TO FIX: Keep trimming the OPENING until it fits. Never touch "improving performance by 25%".

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

EXAMPLE 3 — Ending with a preposition or conjunction (hard failure):
  original:    "Automated workflows with AWS Lambda and Terraform, achieving 99% accuracy and 28% less effort." (94 chars)
  budget:      89–99 chars

  ❌ BAD: "Automated cloud-native data movement via AWS Lambda, S3 & Terraform for high-frequency pipelines with 99% accuracy and"
           → cuts off after "and" — never acceptable

  ✅ GOOD: "Automated data workflows via AWS Lambda, S3 & Terraform, achieving 99% accuracy & 28% less effort."
            → 99 chars ✅ complete, both metrics intact

  RULE: If your draft ends with "and", "with", "via", "by", "for", "or", "&" — it is ALWAYS wrong. Rewrite.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

EXAMPLE 4 — Percentage without context (silent failure):
  original:    "Engineered Kafka pipelines processing 3M+ records/day, reducing processing time by 94%." (87 chars)
  budget:      82–92 chars

  ❌ BAD: "Engineered secure high-throughput Kafka backend services processing 3M+ records with 94%"
           → ends with bare "94%" — 94% of WHAT? Sentence is meaningless without the unit.

  ✅ GOOD: "Engineered real-time Kafka & Python pipelines processing 3M+ records/day, cutting time by 94%."
            → 94 chars ✅ complete, metric has context

  RULE: Always include what the metric measures: "94% faster", "94% reduction", "cutting time by 94%".
        A bare number at the end is always a failure — complete the unit of measurement.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

EXAMPLE 5 — Skills section sub-header (different budget rule):
  original:    "Programming Languages: Python, Java, JavaScript, SQL, Go" (56 chars)
  budget:      51–61 chars

  ❌ BAD: "Programming Languages: Python, Java, JavaScript, TypeScript, SQL"
           → 64 chars, over budget

  ✅ GOOD: "**Programming Languages:** Python, Java, TypeScript, SQL, Go"
            → 60 chars (bold markers don't count) ✅ within budget, sub-header bolded

  RULE: **bold** markers are INVISIBLE to the character count. Only count the actual text characters.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

EXAMPLE 6 — Two metrics, only one survives (double metric failure):
  original:    "Streamlined data flow across Azure and AWS, reducing pipeline errors by 25% and deploy time by 18%." (99 chars)
  budget:      94–104 chars

  ❌ BAD: "Streamlined multi-cloud data flow across Azure & AWS using Data Factory and Terraform, reducing errors by 25%"
           → 109 chars, over budget, second metric "deploy time by 18%" lost entirely

  ✅ GOOD: "Streamlined Azure & AWS data flow via Data Factory & Terraform, cutting errors 25% & deploy time 18%."
            → 102 chars ✅ both metrics intact, within budget

  HOW TO FIX: Compress the opening AND use short forms ("cutting" not "reducing", drop "by") to fit both metrics.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

EXAMPLE 7 — Sentence ends mid-clause after a keyword injection:
  original:    "Built React dashboards visualizing 100K+ data points for strategic reporting." (76 chars)
  budget:      71–81 chars

  ❌ BAD: "Designed React & Tableau-integrated KPI dashboards visualizing 100K+ data points for strategic"
           → 94 chars, over budget, ends mid-phrase after "strategic"

  ✅ GOOD: "Built React KPI dashboards visualizing 100K+ points for strategic reporting."
            → 76 chars ✅ exact budget, complete sentence

  HOW TO FIX: When a keyword injection pushes you over, remove a different word — never the ending noun.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

FINAL CHECKLIST — before outputting any new_content, ask yourself:
  ✅ Does this sentence end with a complete thought?
  ✅ Does the metric have its unit? ("35% faster" not just "35%")
  ✅ Is the character count within ±5 of the original?
  ✅ Does the sentence end with a noun, verb, or measurement — NOT a preposition or conjunction?
  ✅ Are key technical terms wrapped in **double asterisks**?
  ✅ If there are two metrics in the original — are BOTH present in new_content?
  If ANY answer is NO → rewrite before outputting.
`;

  let userPrompt = "";

  if (!critiqueContext) {
    systemInstruction += `\n\nThis is the INITIAL round. Create a strong first draft.`;
    userPrompt = `ORIGINAL RESUME:\n${resumeText}\n\nJOB DESCRIPTION:\n${jobDescription}\n\nCreate the optimization and return only valid JSON.`;
  } else {
    systemInstruction += `

FINAL REFINEMENT GOLDEN RULE (READ THIS FIRST — NON-NEGOTIABLE):
This is the version the user will actually use. Quality of completeness beats strict character count.
- Every single new_content MUST be a complete, professional sentence that ends with proper punctuation (. ! ? %).
- Protect the ending (metric + impact) at ALL costs — it is the most valuable part of the bullet.
- When shortening, ONLY remove words from the opening action phrase — never from the ending.
- It is BETTER to be 8–12 characters over budget with a strong complete sentence than to have ANY cut-off or awkward ending.
- If you cannot improve a bullet without breaking completeness, KEEP the previous strong version unchanged.
- NEVER output new_content that ends with: "by", "with", "and", "via", "for", "to", "or", "&", "using", "through", "across" — these are ALWAYS wrong.
- NEVER output new_content where the metric is missing its unit (e.g. "35%" alone — always "35% faster", "35% reduction", "cutting time by 35%").

PAGE OVERFLOW CONDENSING (IF FLAGGED IN FEEDBACK):
If the auditor feedback contains "CRITICAL PAGE OVERFLOW" or "CONDENSE":
- Your #1 priority is to FIX the overflow while keeping content quality high.
- For every bullet > 122 visible characters: REWRITE it to ≤122 chars. Use tighter phrasing, abbreviations ("&", "configs", "infra", "dept"), drop filler words.
- If a bullet is genuinely critical and CANNOT fit in 122 chars: MERGE it with the next adjacent bullet into a single 2-line statement (≤244 chars) and set the absorbed bullet's new_content to "" (empty string to delete it from the document).
- NEVER just chop or truncate a sentence — always rewrite intelligently.
- Run the LINE COUNT SELF-CHECK: for each mod, ceil(new_content_visible_length / 122) must be ≤ ceil(original_excerpt.length / 122).

PREVIOUS AUDITOR FEEDBACK:
Current Score: ${critiqueContext.currentScore}%
Feedback: ${critiqueContext.auditorFeedback}

INSTRUCTIONS FOR VERSION 1.1 (FINAL REFINEMENT):
1. Carefully address every point raised in the feedback.
2. IF THERE IS A "CRITICAL LAYOUT VIOLATION" OR "CRITICAL PAGE OVERFLOW" IN THE FEEDBACK: You MUST mathematically reduce the length of your 'new_content' to fix it. This is an absolute hard constraint. Do not fail this.
3. Output the COMPLETE updated list of modifications (keep good ones + fix bad ones + add new ones).
4. Your response MUST start with { and end with }. No preamble, no acknowledgment text. Raw JSON only.

⚠️ CRITICAL — REFINEMENT, NOT TRIMMING (ABSOLUTE RULE):
Your job in this round is to REFINE the wording of Version 1.0, NOT to trim, truncate, or remove content.
- NEVER cut a sentence short or leave it incomplete.
- NEVER remove bullet points, metrics, or achievements that existed in Version 1.0.
- NEVER produce new_content that ends mid-sentence or with a dangling preposition.
- If the auditor asks for changes, REPHRASE the content to address the feedback while keeping the SAME character length (±5 chars of original_excerpt).
- Think of this as a COPY-EDITING pass: swap synonyms, tighten phrasing, inject missing keywords — all within the same character envelope.
- Every new_content MUST be a complete, polished sentence that ends with proper punctuation and a complete thought.
- If a modification from Version 1.0 was already strong, keep it as-is. Do not degrade good work.`;
    
    userPrompt = `
ORIGINAL RESUME:
${resumeText}

PREVIOUS MODIFICATIONS:
${JSON.stringify(critiqueContext.previousModifications, null, 2)}

JOB DESCRIPTION:
${jobDescription}

Return updated JSON now.`;
  }

  const response = await ai.models.generateContent({
    model: GEMINI_MODEL,
    contents: userPrompt.trim(),
    config: {
      systemInstruction: systemInstruction.trim(),
      maxOutputTokens: 32000,
      responseMimeType: "application/json",
    }
  });

  const content = response.text;
  if (!content) throw new Error("No response from Gemini");

  try {
    const cleanContent = content.replace(/```json/g, '').replace(/```/g, '').trim();
    const data = JSON.parse(cleanContent) as TailoredResumeData;
    if (!data.modifications || !Array.isArray(data.modifications)) data.modifications = [];
    return data;
  } catch (e) {
    console.error("JSON parse error:", e);
    throw new Error("Failed to parse Gemini response.");
  }
};
// ─────────────────────────────────────────────────────────────────────────────
// Precision-pipeline adapter — the provider-agnostic core lives in
// precisionService.ts; this exposes Gemini as an LlmCall transport.
// ─────────────────────────────────────────────────────────────────────────────
export const geminiLlm = (apiKey: string): LlmCall =>
  async (system, user, _temperature, maxTokens) => {
    const key = apiKey || (process.env.GEMINI_API_KEY as string);
    if (!key) throw new Error("Gemini API Key missing.");
    const ai = new GoogleGenAI({ apiKey: key });
    // Thinking-class models reject non-default sampling params — omit
    // temperature; pipeline determinism is enforced by code-side validation.
    const response = await ai.models.generateContent({
      model: GEMINI_MODEL,
      contents: user,
      config: {
        systemInstruction: system,
        maxOutputTokens: maxTokens,
      },
    });
    return response.text || "";
  };
