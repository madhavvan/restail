import OpenAI from "openai";
import { TailoredResumeData } from "../types";

export const createOptimizationPlan = async (
  resumeText: string,
  jobDescription: string,
  apiKey: string
): Promise<string> => {
  if (!apiKey) throw new Error("OpenAI API Key missing.");

  const openai = new OpenAI({ apiKey, dangerouslyAllowBrowser: true });

  const response = await openai.chat.completions.create({
    model: "gpt-5.2",
    temperature: 0.7,
    max_tokens: 32000,
    messages: [
      {
        role: "system",
        content: `You are GPT-5.2, the Primary Optimizer collaborating with DeepSeek-V3.2.
You are an Elite Resume Copywriter and ATS Strategist with 30+ years of experience in IT systems, AI, and Data Engineering.

Speak naturally and directly to DeepSeek-V3.2.

Start your response EXACTLY like this:

"DeepSeek-V3.2, I have carefully reviewed the resume and Job Description.

PROPOSED OPTIMIZATION PLAN:

[your detailed bullets here]

Please review this plan and provide your critical feedback."`
      },
      {
        role: "user",
        content: `RESUME:\n${resumeText}\n\nJOB DESCRIPTION:\n${jobDescription}`
      }
    ]
  });

  return response.choices[0].message.content || "Failed to generate plan.";
};

export const tailorResumeOpenAI = async (
  resumeText: string,
  jobDescription: string,
  apiKey: string,
  critiqueContext?: {
    previousModifications: any[];
    auditorFeedback: string;
    currentScore: number;
  }
): Promise<TailoredResumeData> => {
  if (!apiKey) throw new Error("OpenAI API Key missing.");

  const openai = new OpenAI({ apiKey, dangerouslyAllowBrowser: true });

  // ── Compute per-paragraph character budgets from the original resume ──────
  const originalLines = resumeText.split('\n');
  const originalCharCount = resumeText.length;
  const maxAllowedChars = Math.floor(originalCharCount * 1.00);

  // Build a budget map: each line → max chars allowed for its replacement
  const paragraphBudgets = originalLines
    .filter(l => l.trim().length > 8)
    .map(l => `  "${l.trim().substring(0, 60)}…" → max ${Math.ceil(l.trim().length * 1.10)} chars`)
    .slice(0, 40) // cap to avoid token overflow
    .join('\n');

  const systemPrompt = `
You are GPT-5.2 — Elite Executive Resume Writer and ATS Strategist.
You are collaborating live with DeepSeek-V3.2 (Critical ATS Auditor).

Your job is to rewrite ONLY the text content of specific bullet points and sections
to better match the Job Description. You are NOT redesigning the resume.
The document already has perfect Word formatting — your job is to improve the WORDS ONLY.

 RESUME HEADER ANATOMY — READ CAREFULLY

The resume header is EXACTLY THREE lines:
  Line 1: Full Name                        ← NEVER touch
  Line 2: Title1 | Title2 | Title3 | ...   ← ONLY line you may rewrite
  Line 3: email | phone | LinkedIn | GitHub ← NEVER touch — EVER

CRITICAL RULES FOR TITLE MODIFICATION:
• Your original_excerpt = ONLY the exact text of Line 2 (titles only).
  Do NOT include Line 3 (the contact line) in original_excerpt.
• Your new_content = ONLY the new title text. Nothing else.
  No email, no phone, no LinkedIn, no GitHub. Zero contact info.
• The contact line is LOCKED. It is handled automatically by the document engine.
  If you include it in new_content it will be DUPLICATED — causing a broken header.
• The character count of new_content MUST be within ±5 characters of original_excerpt.

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
   If you cannot fit a rewrite in that budget, trim words rather than exceed the limit.
   Note: **bold** markers do NOT count toward the character budget.
5. NEVER combine multiple bullet points into one new_content. One excerpt → one replacement.
6. NEVER modify dates, company names, job titles, or contact information.
7. NEVER add extra blank lines (\\n\\n) — this pushes content off the page.

 PAGE LIMIT ENFORCEMENT (HARD CONSTRAINT)

Original resume total characters: ${originalCharCount}
Your MAXIMUM total characters across ALL new_content fields combined: ${maxAllowedChars}

PER-PARAGRAPH BUDGETS (your replacement cannot exceed these):
${paragraphBudgets}

If you are over budget: shorten by removing filler words, merging redundant phrases,
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

OUTPUT FORMAT — valid JSON only, no other text

{
  "agents": { "primary": "GPT-5.2", "auditor": "DeepSeek-V3.2" },
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
2. If the feedback mentions content being too long: MATHEMATICALLY reduce new_content length. This is non-negotiable.
3. Output the COMPLETE updated list of modifications (keep good ones, fix bad ones).
4. Re-check: does EVERY new_content contain zero markdown symbols? If yes, proceed.`;

    userPrompt = `ORIGINAL RESUME:\n${resumeText}\n\n${feedbackSection}\n\nPREVIOUS MODIFICATIONS:\n${JSON.stringify(critiqueContext.previousModifications, null, 2)}\n\nJOB DESCRIPTION:\n${jobDescription}\n\nReturn updated JSON now.`;
  }

  const response = await openai.chat.completions.create({
    model: "gpt-5.2",
    temperature: 0.65,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user",   content: userPrompt.trim() }
    ],
    response_format: { type: "json_object" }
  });

  const content = response.choices[0].message.content;
  if (!content) throw new Error("No response from OpenAI");

  try {
    const cleanContent = content.replace(/```json/g, '').replace(/```/g, '').trim();
    const data = JSON.parse(cleanContent) as TailoredResumeData;
    if (!data.modifications || !Array.isArray(data.modifications)) data.modifications = [];
    return data;
  } catch (e) {
    console.error("JSON parse error:", e);
    throw new Error("Failed to parse OpenAI response.");
  }
};