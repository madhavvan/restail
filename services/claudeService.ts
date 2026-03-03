import { TailoredResumeData } from "../types";

const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";
const CLAUDE_MODEL = "claude-opus-4-6";

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
      system,
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

  // ── Stream reader 
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let fullText = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    const chunk = decoder.decode(value, { stream: true });
    const lines = chunk.split("\n");

    for (const line of lines) {
      if (!line.startsWith("data: ")) continue;
      const jsonStr = line.slice(6).trim();
      if (jsonStr === "[DONE]" || !jsonStr) continue;

      try {
        const parsed = JSON.parse(jsonStr);
        // Anthropic streaming format: content_block_delta events carry the text
        if (parsed.type === "content_block_delta" && parsed.delta?.type === "text_delta") {
          fullText += parsed.delta.text || "";
        }
      } catch {
        // skip malformed chunks
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

  const system = `You are Claude Opus 4.6, the Primary Optimizer collaborating with the Critical ATS Auditor.
You are an Elite Resume Copywriter and ATS Strategist with 40+ years of experience in IT systems, AI, and Data Engineering.
Your analytical depth and reasoning precision are unmatched — you decompose every bullet for maximum keyword density and impact.

Speak naturally and directly to your auditor partner.

Start your response EXACTLY like this:

"I have carefully reviewed the resume and Job Description with deep analytical precision.

PROPOSED OPTIMIZATION PLAN:

[your detailed bullets here]

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
You are Claude Opus 4.6 — the most analytically precise and deeply reasoning Elite Executive Resume Writer and ATS Strategist.
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
  "agents": { "primary": "Claude Opus 4.6", "auditor": "ATS Auditor" },
  "ats": {
    "score": 95,
    "feedback": "Specific feedback on this version...",
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

IMPORTANT: Return ONLY the raw JSON object. No markdown fences, no backticks, no preamble text. Just the JSON.
`.trim();

  let userPrompt = "";

  if (!critiqueContext) {
    userPrompt = `ORIGINAL RESUME:\n${resumeText}\n\nJOB DESCRIPTION:\n${jobDescription}\n\nCreate the optimization and return only valid JSON.`;
  } else {
    const feedbackSection = `
PREVIOUS AUDITOR FEEDBACK:
Current ATS Score: ${critiqueContext.currentScore}%
Feedback: ${critiqueContext.auditorFeedback}

INSTRUCTIONS FOR THIS REVISION:
1. Address every point raised in the feedback above.
2. If the feedback mentions content being too long: MATHEMATICALLY reduce new_content length but complete the sentence formation
   completely even if it is short — it must be meaningful and must make sense. This is non-negotiable.
3. Output the COMPLETE updated list of modifications (keep good ones, fix bad ones).
4. Re-check: does EVERY new_content contain zero markdown symbols? If yes, proceed.`;

    userPrompt = `ORIGINAL RESUME:\n${resumeText}\n\n${feedbackSection}\n\nPREVIOUS MODIFICATIONS:\n${JSON.stringify(critiqueContext.previousModifications, null, 2)}\n\nJOB DESCRIPTION:\n${jobDescription}\n\nReturn updated JSON now.`;
  }

  const content = await callClaude(apiKey, systemPrompt, userPrompt.trim(), 0.65, 32000);
  if (!content) throw new Error("No response from Claude");

  try {
    const cleanContent = content.replace(/```json/g, '').replace(/```/g, '').trim();
    const data = JSON.parse(cleanContent) as TailoredResumeData;
    if (!data.modifications || !Array.isArray(data.modifications)) data.modifications = [];
    return data;
  } catch (e) {
    console.error("JSON parse error:", e);
    console.error("Raw response:", content.substring(0, 500)); // helps debug
    throw new Error("Failed to parse Claude response.");
  }
};