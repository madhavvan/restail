import OpenAI from "openai";
import { Modification } from "../types";

/**
 * Grok Quality Gate — Post-V1.1 Final Review
 *
 * Reviews every modification in the finalized document for:
 *   - Incomplete sentences / word cutoffs
 *   - Dangling prepositions or conjunctions at the end
 *   - Metrics missing their unit (bare "35%" without context)
 *   - Character budget violations (±5 of original_excerpt, max 122 for single-line)
 *
 * Returns ONLY the modifications that need fixing, with corrected new_content.
 * Modifications that pass review are NOT returned (caller keeps them as-is).
 */
export const reviewFinalDocument = async (
  resumeText: string,
  modifications: Modification[],
  jobDescription: string,
  apiKey: string
): Promise<Modification[]> => {
  if (!apiKey) throw new Error("Grok API Key missing.");

  const grok = new OpenAI({
    apiKey,
    baseURL: "https://api.x.ai/v1",
    dangerouslyAllowBrowser: true,
  });

  const systemPrompt = `You are Grok, the Final Quality Gate Agent.
Your ONLY job is to review the finalized resume modifications and catch any defective bullets before they reach the user.

You are NOT rewriting the resume. You are NOT adding keywords. You are a PROOFREADER and QUALITY CHECKER.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
WHAT YOU CHECK FOR (in order of severity):
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

1. INCOMPLETE SENTENCES — new_content that ends mid-thought, with a missing word, or is clearly cut off.
   Examples of FAILURES:
     "Engineered real-time Kafka pipelines processing 3M+ records with"  ← ends with "with"
     "Built scalable ETL workflows using Apache Spark and"               ← ends with "and"
     "Designed cloud-native microservices architecture for high-throu"   ← word cut off
     "Automated CI/CD pipelines reducing deployment time by"            ← metric incomplete

2. DANGLING PREPOSITIONS / CONJUNCTIONS — new_content ends with: by, with, and, via, for, to, or, &, using, through, across, in, of, the, a, an, as, at, on, into, from, than.
   These are ALWAYS wrong. The sentence must end with a noun, verb, measurement, or proper punctuation.

3. METRICS WITHOUT UNITS — A bare percentage or number at the end without context.
   BAD:  "...improving performance by 25%"  ← OK (has context "performance")
   BAD:  "...with 94%"                      ← 94% of WHAT?
   GOOD: "...cutting latency by 94%"        ← has context

4. MISSING PUNCTUATION — new_content doesn't end with . ! ? % ) "
   Every bullet must end with proper punctuation.

5. CHARACTER BUDGET — new_content visible length (excluding **bold** markers) should be within ±5 characters of original_excerpt length.
   - For single-line bullets (original < 122 chars): new_content can expand up to 122 chars max.
   - For multi-line bullets (original ≥ 122 chars): strict ±5 chars of original length.
   - **bold** markers do NOT count toward character length. Only count visible text.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
HOW TO FIX:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

When you find a defective bullet:
- REWRITE the new_content to fix the issue.
- PRESERVE the meaning, keywords, and technical terms from the original new_content.
- KEEP the same character budget (within ±5 of the original_excerpt length).
- ALWAYS end with a complete thought and proper punctuation.
- PRESERVE all **bold** markers on technical terms and sub-headers.
- Use "&" instead of "and", short forms like "configs", "infra", "env", "depts" to save space.
- Front-load or embed metrics: "cut latency 40%" not "reducing the overall latency by approximately 40%".
- The metric (e.g. "35%", "3M+ records", "$2M savings") is the MOST IMPORTANT part — protect it always.
- If you absolutely cannot fit a complete sentence within budget, it is BETTER to be 3-5 chars over with a complete sentence than to cut off.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
WHAT YOU MUST NOT DO:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

- Do NOT add new modifications. Only fix existing ones.
- Do NOT change modifications that are already correct and complete.
- Do NOT modify dates, company names, job titles, or contact information.
- Do NOT remove metrics or achievements.
- Do NOT change the original_excerpt — copy it exactly as provided.
- Do NOT add bullet symbols (•, -, *) at the start of new_content.
- Do NOT include email, phone, LinkedIn, or GitHub in any new_content.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
OUTPUT FORMAT:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Return ONLY valid JSON. No preamble, no explanation, no markdown fences.

{
  "reviewSummary": "Brief summary of issues found",
  "totalReviewed": 25,
  "issuesFound": 3,
  "fixes": [
    {
      "original_excerpt": "exact text from ORIGINAL resume (copy from input)",
      "new_content": "the CORRECTED version that fixes the issue",
      "issue": "brief description of what was wrong"
    }
  ]
}

If ALL modifications pass review, return:
{
  "reviewSummary": "All modifications are complete and well-formed.",
  "totalReviewed": 25,
  "issuesFound": 0,
  "fixes": []
}`;

  const modsForReview = modifications.map((m, i) => ({
    index: i + 1,
    original_excerpt: m.original_excerpt,
    original_length: m.original_excerpt?.length ?? 0,
    new_content: m.new_content,
    new_content_visible_length: (m.new_content || "")
      .replace(/\*\*([^*]+)\*\*/g, "$1")
      .length,
  }));

  const userPrompt = `ORIGINAL RESUME:
${resumeText}

JOB DESCRIPTION (for context only — do NOT add keywords):
${jobDescription}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
MODIFICATIONS TO REVIEW (${modifications.length} total):
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

${JSON.stringify(modsForReview, null, 2)}

Review each modification above. For any that have incomplete sentences, cutoffs, dangling prepositions, or missing metric units — provide the corrected version in the fixes array.
Return ONLY valid JSON.`;

  const response = await grok.chat.completions.create({
    model: "grok-4-1-fast-reasoning",
    temperature: 0.3,
    max_tokens: 16000,
    messages: [
      { role: "system", content: systemPrompt.trim() },
      { role: "user", content: userPrompt.trim() },
    ],
    response_format: { type: "json_object" },
  });

  const content = response.choices[0].message.content;
  if (!content) throw new Error("No response from Grok");

  try {
    const cleanContent = content
      .replace(/```json/g, "")
      .replace(/```/g, "")
      .trim();
    const parsed = JSON.parse(cleanContent);

    if (!parsed.fixes || !Array.isArray(parsed.fixes)) return [];

    // Validate each fix has the required fields
    return parsed.fixes
      .filter(
        (f: any) =>
          f.original_excerpt &&
          f.new_content &&
          f.original_excerpt.length >= 8
      )
      .map((f: any) => ({
        original_excerpt: f.original_excerpt,
        new_content: f.new_content,
        issue: f.issue || "Quality fix",
      }));
  } catch (e) {
    console.error("Grok JSON parse error:", e);
    console.error("Raw Grok response:", content?.substring(0, 500));
    throw new Error("Failed to parse Grok quality review response.");
  }
};