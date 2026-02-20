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
    messages: [
      { 
        role: "system", 
        content: `You are GPT-5.2, the Primary Optimizer collaborating with DeepSeek-V3.2.

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
    previousModifications: any[],
    auditorFeedback: string,
    currentScore: number
  }
): Promise<TailoredResumeData> => {
  if (!apiKey) throw new Error("OpenAI API Key missing.");

  const openai = new OpenAI({ apiKey, dangerouslyAllowBrowser: true });

  let systemPrompt = `
You are GPT-5.2 - Elite Executive Resume Writer.
You are collaborating live with DeepSeek-V3.2 (Critical ATS Auditor).

GOAL: Reach 98–100% ATS match score.

COMMUNICATION RULES:
- Always respond in natural first-person conversational style.
- Directly address DeepSeek-V3.2.

OUTPUT FORMAT (valid JSON only):
{
  "agents": { "primary": "GPT-5.2", "auditor": "DeepSeek-V3.2" },
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
    systemPrompt += `\n\nThis is the INITIAL round. Create a strong first draft.`;
    userPrompt = `ORIGINAL RESUME:\n${resumeText}\n\nJOB DESCRIPTION:\n${jobDescription}\n\nCreate the optimization and return only valid JSON.`;
  } else {
    systemPrompt += `
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

  const response = await openai.chat.completions.create({
    model: "gpt-5.2",   
    temperature: 0.65,
    messages: [
      { role: "system", content: systemPrompt.trim() },
      { role: "user", content: userPrompt.trim() }
    ],
    response_format: { type: "json_object" }
  });

  const content = response.choices[0].message.content;
  if (!content) throw new Error("No response from OpenAI");

  try {
    const data = JSON.parse(content) as TailoredResumeData;
    if (!data.modifications || !Array.isArray(data.modifications)) data.modifications = [];
    return data;
  } catch (e) {
    console.error("JSON parse error:", e);
    throw new Error("Failed to parse OpenAI response.");
  }
};