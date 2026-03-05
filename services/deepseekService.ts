import OpenAI from "openai";
import { TailoredResumeData } from "../types";

export const createOptimizationPlanDeepSeek = async (
  resumeText: string,
  jobDescription: string,
  apiKey: string,
  writerModelName?: string
): Promise<string> => {
  if (!apiKey) throw new Error("DeepSeek API Key missing.");

  const deepseek = new OpenAI({ 
    apiKey, 
    baseURL: "https://api.deepseek.com",
    dangerouslyAllowBrowser: true 
  });

  const partnerName = writerModelName || 'GPT-5.2';

  const response = await deepseek.chat.completions.create({
    model: "deepseek-reasoner",
    temperature: 0.7,
    max_tokens: 32000,
    messages: [
      { 
        role: "system", 
        content: `You are DeepSeek-V3.2, the Critical Reviewer working with ${partnerName}.
You are an Elite Resume Copywriter and ATS Strategist with 30+ years of top-tier experience in IT systems, AI, and Data Engineering.
Your goal is to rewrite the provided resume to perfectly match the Job Description with absolute authority and "mouth-shutting" impact.
The points you write must be breathtakingly powerful, demonstrating unparalleled expertise and leadership.
${partnerName === 'Claude Sonnet 4.6' ? '\nYou are working with Claude Sonnet 4.6 — the most analytically precise reasoning model available. Match its depth of analysis. Challenge its reasoning with equally rigorous counter-arguments. Demand mathematical precision in keyword density and character budgets. Your feedback must be at the highest intellectual caliber.' : ''}

Speak naturally and directly to ${partnerName}.

Start your response EXACTLY like this:

"${partnerName}, I have carefully reviewed your proposed optimization plan along with the full resume and Job Description.

REVIEW FEEDBACK:

[your detailed feedback here]

Overall, [I approve / I partially approve]. Here are my precise suggestions and alternative wording where needed."`
      },
      { 
        role: "user", 
        content: `RESUME:\n${resumeText}\n\nJOB DESCRIPTION:\n${jobDescription}` 
      }
    ]
  });

  return response.choices[0].message.content || "Failed to generate review.";
};

export const tailorResumeDeepSeek = async (
  resumeText: string,
  jobDescription: string,
  apiKey: string,
  critiqueContext?: {
    previousModifications: any[],
    auditorFeedback: string,
    currentScore: number
  }
): Promise<TailoredResumeData> => {
  if (!apiKey) throw new Error("DeepSeek API Key missing.");

  const deepseek = new OpenAI({
    apiKey,
    baseURL: "https://api.deepseek.com",
    dangerouslyAllowBrowser: true 
  });

  // DYNAMIC PAGE-LIMIT BUDGET (NEW) 
  const originalCharCount = resumeText.length;
  const maxAllowedChars = Math.floor(originalCharCount * 1.00); // budget allows complete sentences

  let systemPrompt = `
You are DeepSeek-V3.2 - Critical ATS Auditor, Elite Executive Resume Writer, and Formatting Expert with 30+ years of top-tier experience in IT systems, AI, and Data Engineering.
You are reviewing work from the Primary Writer.

Your objective is to parse the user's provided resume, dramatically enhance the impact of the content, and **STRICTLY** fit the final output within a designated 2-page limit without using formatting tricks or artificial spacing.

Be strict but constructive.
Always speak directly to GPT-5.2.
The points you write must be breathtakingly powerful, demonstrating unparalleled expertise and leadership. They must be "mouth-shutting" in their impact.

OUTPUT ONLY valid JSON:
{
  "agents": { "reviewer": "DeepSeek-V3.2", "optimizer": "GPT-5.2" },
  "ats": {
    "score": 95,
    "feedback": "Detailed feedback on the current modifications...",
    "keywordMatch": ["React", "TypeScript"],
    "missingKeywords": ["AWS"]
  },
  "modifications": [
    { "original_excerpt": "exact text from ORIGINAL resume", "new_content": "improved version" }
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

STRICT PER-MODIFICATION LENGTH RULE:
For EVERY single modification, new_content MUST be within ±5 characters of original_excerpt.
  Example: original_excerpt = 120 chars → new_content must be 115–125 chars.
This is non-negotiable. It is the only way to guarantee the document stays on the same number of pages.
If you cannot fit a strong rewrite in that budget: trim filler words, cut adjectives, tighten phrasing.
Do NOT exceed the budget. Do NOT write shorter than -10 chars either (gaps look bad too).

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
━
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
`;

  let userPrompt = "";

  if (!critiqueContext) {
    userPrompt = `ORIGINAL RESUME:\n${resumeText}\n\nJOB DESCRIPTION:\n${jobDescription}\n\nCreate the optimization and return only valid JSON.`;
  } else {
    systemPrompt += `

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
Current Score: ${critiqueContext.currentScore}%
Feedback: ${critiqueContext.auditorFeedback}

INSTRUCTIONS FOR VERSION 1.1 (FINAL REFINEMENT):
1. Carefully address every point raised in the feedback.
2. IF THERE IS A "CRITICAL LAYOUT VIOLATION" IN THE FEEDBACK: You MUST mathematically reduce the length of your 'new_content' to fix it. This is an absolute hard constraint. Do not fail this.
3. Output the COMPLETE updated list of modifications (keep good ones + fix bad ones + add new ones).
4. Think as if you are telling the Reviewer: "Acknowledged. Integrating your feedback and generating Version X.Y..."

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

  const response = await deepseek.chat.completions.create({
    model: "deepseek-reasoner",
    temperature: 0.65,
    max_tokens: 32000,
    messages: [
      { role: "system", content: systemPrompt.trim() },
      { role: "user", content: userPrompt.trim() }
    ],
    response_format: { type: "json_object" }
  });

  const content = response.choices[0].message.content;
  if (!content) throw new Error("No response from DeepSeek");

  try {
    const cleanContent = content.replace(/```json/g, '').replace(/```/g, '').trim();
    const data = JSON.parse(cleanContent) as TailoredResumeData;
    if (!data.modifications || !Array.isArray(data.modifications)) data.modifications = [];
    return data;
  } catch (e) {
    console.error("JSON parse error:", e);
    throw new Error("Failed to parse DeepSeek response.");
  }
};