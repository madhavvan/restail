import { GoogleGenAI, Type } from "@google/genai";
import { TailoredResumeData } from "../types";

export const createOptimizationPlanGemini = async (
  resumeText: string,
  jobDescription: string,
  apiKey: string
): Promise<string> => {
  const key = apiKey || process.env.GEMINI_API_KEY;
  if (!key) throw new Error("Gemini API Key missing.");

  const ai = new GoogleGenAI({ apiKey: key });

  const response = await ai.models.generateContent({
    model: "gemini-3.1-pro-preview",
    contents: `RESUME:\n${resumeText}\n\nJOB DESCRIPTION:\n${jobDescription}`,
    config: {
      systemInstruction: `You are Gemini 3.1 Pro, the Primary Optimizer collaborating with DeepSeek-V3.2.

Speak naturally and directly to DeepSeek-V3.2.

Start your response EXACTLY like this:

"DeepSeek-V3.2, I have carefully reviewed the resume and Job Description.

PROPOSED OPTIMIZATION PLAN:

[your detailed bullets here]

Please review this plan and provide your critical feedback."`,
      temperature: 0.7,
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

  let systemInstruction = `
You are Gemini 3.1 Pro - Elite Executive Resume Writer and Formatting Expert.
You are collaborating live with DeepSeek-V3.2 (Critical ATS Auditor).

Your objective is to parse the user's provided resume, dramatically enhance the impact of the content, and strictly fit the final output within a designated 2-page limit without using formatting tricks or artificial spacing.

GOAL: Reach 98–100% ATS match score.

COMMUNICATION RULES:
- Always respond in natural first-person conversational style.
- Directly address DeepSeek-V3.2.

OUTPUT FORMAT (valid JSON only):
{
  "agents": { "primary": "Gemini 3.1 Pro", "auditor": "DeepSeek-V3.2" },
  "ats": {
    "score": 95,
    "feedback": "Detailed feedback on the current modifications...",
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

### STEP 3: The Formatting & Length Validation Loop
You must now fit the drafted content perfectly into the required physical space (strict maximum of 2 pages). 
Do NOT add artificial blank lines, extra spaces, or filler text to manipulate the length. 

Execute the following logic:
1. OVER-LENGTH CHECK: If the generated content exceeds the standard word/line count for a 2-page document (causing it to spill onto a 3rd page), you must iteratively condense the text. 
   - How to condense: Combine related bullet points, remove redundant words, and make project descriptions more concise while retaining the high-impact metrics.
   - Continue refining until the content fits strictly within the 2-page limit.
   
2. UNDER-LENGTH CHECK: If the content falls slightly short (leaving 2-3 empty lines at the end of page 2), do not add blank spaces. 
   - How to expand: Elaborate on a complex technical project, add an additional high-value bullet point to the most recent work experience, or detail the specific technologies used. 
   - Fill the space with valuable, relevant professional context until the page is naturally complete.

3. THE FINAL BOUNDARY CHECK: Ensure that adding a single carriage return (new line) after your final bullet point does not trigger a 3rd page. If it does, trim exactly one line of text from an earlier section to create a safe margin.

### FINAL OUTPUT CONSTRAINTS
- Return ONLY valid JSON.
- Never use extra line breaks (\\n\\n\\n) to fill space.
- The final output must be impactful, perfectly parsed, and strictly formatted.

IMPORTANT RULES FOR MODIFICATIONS:
1. original_excerpt MUST be an exact match from the ORIGINAL resume (case-sensitive, spacing preserved). It MUST be a single, continuous paragraph or bullet point. DO NOT combine multiple paragraphs into one original_excerpt.
2. CRITICAL LAYOUT CONSTRAINT: For every \`original_excerpt\` you modify, the \`new_content\` MUST be EXACTLY the same length as the original (within a 5-character margin) to preserve the exact page layout, UNLESS you are applying the Over/Under-length checks above.
3. STRICT BOLDING & KEYWORDS (CRITICAL): You MUST use exact Markdown bolding (**word**) to highlight critical ATS keywords, technical skills, metrics, titles, and subheadings in your \`new_content\`. If the \`original_excerpt\` had bolded words, the equivalent words in your new version MUST also be wrapped in **bold**. NEVER output plain text for important keywords or section titles.
4. PRESERVE DATES: NEVER modify, hallucinate, or change any dates, tenures, or chronological information.
5. PRESERVE LINE BREAKS: If the original text has a line break (e.g., Title on line 1, Email on line 2), you MUST include the exact same line breaks (\\n) in your \`new_content\`.
6. HEADER FORMATTING: If you modify the professional title at the top of the resume, you MUST preserve the newline character (\\n) separating the title from the contact information (email/phone). Do not merge them into a single line.
`;

  let userPrompt = "";

  if (!critiqueContext) {
    systemInstruction += `\n\nThis is the INITIAL round. Create a strong first draft.`;
    userPrompt = `ORIGINAL RESUME:\n${resumeText}\n\nJOB DESCRIPTION:\n${jobDescription}\n\nCreate the optimization and return only valid JSON.`;
  } else {
    systemInstruction += `
\n\nPREVIOUS AUDITOR FEEDBACK:
Current Score: ${critiqueContext.currentScore}%
Feedback: ${critiqueContext.auditorFeedback}

INSTRUCTIONS:
1. Carefully address every point raised in the feedback.
2. IF THERE IS A "CRITICAL LAYOUT VIOLATION" IN THE FEEDBACK: You MUST mathematically reduce the length of your 'new_content' to fix it. This is an absolute hard constraint. Do not fail this.
3. Output the COMPLETE updated list of modifications (keep good ones + fix bad ones + add new ones).
4. Think as if you are telling the Reviewer: "Acknowledged. Integrating your feedback and generating Version X.Y..."`;
    
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
    model: "gemini-3.1-pro-preview",
    contents: userPrompt.trim(),
    config: {
      systemInstruction: systemInstruction.trim(),
      temperature: 0.65,
      responseMimeType: "application/json",
    }
  });

  const content = response.text;
  if (!content) throw new Error("No response from Gemini");

  try {
    const data = JSON.parse(content) as TailoredResumeData;
    if (!data.modifications || !Array.isArray(data.modifications)) data.modifications = [];
    return data;
  } catch (e) {
    console.error("JSON parse error:", e);
    throw new Error("Failed to parse Gemini response.");
  }
};