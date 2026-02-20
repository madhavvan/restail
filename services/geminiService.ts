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
You are Gemini 3.1 Pro - Elite Executive Resume Writer.
You are collaborating live with DeepSeek-V3.2 (Critical ATS Auditor).

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

IMPORTANT:
- original_excerpt MUST be an exact match from the ORIGINAL resume (case-sensitive, spacing preserved).
- Keep new_content concise and professional.
- CRITICAL LAYOUT CONSTRAINT: You MUST preserve the original page count. Do not increase the overall length of the text. For every \`original_excerpt\` you modify, the \`new_content\` MUST be approximately the same length or shorter.
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
2. Output the COMPLETE updated list of modifications (keep good ones + fix bad ones + add new ones).
3. Think as if you are telling the Reviewer: "Acknowledged. Integrating your feedback and generating Version X.Y..."`;
    
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