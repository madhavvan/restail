import OpenAI from "openai";
import { TailoredResumeData } from "../types";

export const createOptimizationPlanDeepSeek = async (
  resumeText: string,
  jobDescription: string,
  apiKey: string
): Promise<string> => {
  if (!apiKey) throw new Error("DeepSeek API Key missing.");

  const deepseek = new OpenAI({ 
    apiKey, 
    baseURL: "https://api.deepseek.com",
    dangerouslyAllowBrowser: true 
  });

  const response = await deepseek.chat.completions.create({
    model: "deepseek-chat",
    temperature: 0.7,
    messages: [
      { 
        role: "system", 
        content: `You are DeepSeek-V3.2, the Critical Reviewer working with GPT-5.2.

Speak naturally and directly to GPT-5.2.

Start your response EXACTLY like this:

"GPT-5.2, I have carefully reviewed your proposed optimization plan along with the full resume and Job Description.

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

  let systemPrompt = `
You are DeepSeek-V3.2 - Critical ATS Auditor.
You are reviewing work from GPT-5.2.

Be strict but constructive.
Always speak directly to GPT-5.2.

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

IMPORTANT:
- original_excerpt MUST be an exact match from the ORIGINAL resume (case-sensitive, spacing preserved).
- CRITICAL LAYOUT CONSTRAINT: You MUST preserve the original page count. Do not increase the overall length of the text. For every \`original_excerpt\` you modify, the \`new_content\` MUST be approximately the same length or shorter.
`;

  let userPrompt = "";

  if (!critiqueContext) {
    userPrompt = `ORIGINAL RESUME:\n${resumeText}\n\nJOB DESCRIPTION:\n${jobDescription}\n\nCreate the optimization and return only valid JSON.`;
  } else {
    systemPrompt += `\n\nGPT-5.2's previous version score: ${critiqueContext.currentScore}%\nFeedback: ${critiqueContext.auditorFeedback}\n\nGive critical review and updated modifications.`;
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
    model: "deepseek-chat",
    temperature: 0.65,
    messages: [
      { role: "system", content: systemPrompt.trim() },
      { role: "user", content: userPrompt.trim() }
    ],
    response_format: { type: "json_object" }
  });

  const content = response.choices[0].message.content;
  if (!content) throw new Error("No response from DeepSeek");

  try {
    const data = JSON.parse(content) as TailoredResumeData;
    if (!data.modifications || !Array.isArray(data.modifications)) data.modifications = [];
    return data;
  } catch (e) {
    console.error("JSON parse error:", e);
    throw new Error("Failed to parse DeepSeek response.");
  }
};