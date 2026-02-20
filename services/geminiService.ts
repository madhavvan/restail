import { GoogleGenAI, Type } from "@google/genai";
import { TailoredResumeData, ATSAnalysis, Modification } from "../types";

const getClient = (apiKey?: string) => {
  const key = apiKey || process.env.API_KEY;
  if (!key) {
    throw new Error("Gemini API Key missing. Please set it in Settings.");
  }
  return new GoogleGenAI({ apiKey: key });
};

// --- REVIEW PLAN FUNCTION (Step 2 - Gemini reviews GPT-5.2's initial plan) ---
export const reviewOptimizationPlan = async (
  plan: string,
  resumeText: string,
  jobDescription: string,
  apiKey?: string
): Promise<string> => {
  const ai = getClient(apiKey);

  const prompt = `
You are Gemini, the Lead Recruiter and Senior ATS Auditor.
You are collaborating live with GPT-5.2 (the Elite Resume Writer).

Speak naturally, professionally, and directly to GPT-5.2 in first-person.

Review the optimization plan GPT-5.2 has just proposed.

Start your response EXACTLY like this:

"GPT-5.2, I have carefully reviewed your proposed optimization plan along with the full resume and Job Description.

REVIEW FEEDBACK:

[your detailed feedback here]

Overall, [I approve / I partially approve]. Here are my precise suggestions and alternative wording where needed:"

Be strict but constructive. 
- Approve what is good.
- Point out missing keywords, weak impact statements, or structure issues.
- Quote exact text from the resume when suggesting changes.
- End by telling GPT-5.2 whether to proceed with implementation.

PLAN FROM GPT-5.2:
${plan}

RESUME:
${resumeText}

JOB DESCRIPTION:
${jobDescription}
  `;

  const response = await ai.models.generateContent({
    model: "gemini-3-pro-preview",
    contents: prompt
  });
  
  return response.text || "No feedback provided.";
};

// --- DEEP AUDIT FUNCTION (Used in every iteration + Final Polish Round) ---
export const performDeepAnalysis = async (
  draftResumeText: string,
  jobDescription: string,
  modifications: Modification[],
  apiKey?: string
): Promise<ATSAnalysis> => {
  const ai = getClient(apiKey);
  
  const modsSummary = modifications.length > 0 
    ? modifications.map(m => 
        `• Changed: "${m.original_excerpt.substring(0, 60)}..." → "${m.new_content.substring(0, 60)}..."`
      ).join('\n')
    : "Initial draft - no previous modifications.";

  const prompt = `
You are Gemini - Lead Technical Recruiter and Strict ATS Auditor.
You are reviewing the latest resume version submitted by GPT-5.2.

Speak directly and conversationally to GPT-5.2.

**OUTPUT MUST BE VALID JSON ONLY** with this exact structure:

{
  "score": number (0-100, be extremely strict - only 98+ for near-perfect ATS match),
  "missing_keywords": ["keyword1", "keyword2"],
  "feedback": "Conversational message starting with 'GPT-5.2, here is my audit report...' or 'Good progress GPT-5.2...' or 'I still see a few issues GPT-5.2...'"
}

**AUDIT RULES**:
1. Check every critical keyword from the JD is present naturally.
2. Flag weak verbs and low-impact statements.
3. Ensure summary is a strong full paragraph.
4. In the FINAL review round, focus ONLY on minor/optional polish (or say "Approved as is").

DRAFT RESUME:
${draftResumeText}

JOB DESCRIPTION:
${jobDescription}

PREVIOUS CHANGES SUMMARY:
${modsSummary}
  `;

  const response = await ai.models.generateContent({
    model: "gemini-3-pro-preview",
    contents: prompt,
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          score: { type: Type.NUMBER },
          missing_keywords: { 
            type: Type.ARRAY, 
            items: { type: Type.STRING }
          },
          feedback: { type: Type.STRING }
        },
        required: ["score", "missing_keywords", "feedback"]
      }
    }
  });

  const text = response.text;
  if (!text) throw new Error("ATS Deep Audit failed");
  
  try {
    const parsed = JSON.parse(text) as ATSAnalysis;
    // Force conversational style if missing
    if (!parsed.feedback.toLowerCase().includes("gpt-5.2")) {
      parsed.feedback = `GPT-5.2, here is my audit report for this version:\n\nScore: ${parsed.score}%\n\n${parsed.feedback}`;
    }
    return parsed;
  } catch (e) {
    console.error("Gemini JSON parse error:", e);
    return { 
      score: 82, 
      missing_keywords: [], 
      feedback: "GPT-5.2, I had trouble parsing the structure. Please review the latest version carefully for keyword alignment and impact." 
    };
  }
};

// --- INITIAL TAILORING (Gemini-only fallback mode) ---
export const tailorResume = async (
  resumeText: string,
  jobDescription: string,
  apiKey?: string
): Promise<TailoredResumeData> => {
  const ai = getClient(apiKey);

  const prompt = `
You are Gemini acting as a complete resume optimization team (single-agent mode).

RESUME:
${resumeText}

JOB DESCRIPTION:
${jobDescription}

Create a highly optimized version tailored for maximum ATS score and human recruiters.
Output valid JSON with "agents" and "modifications" arrays.
  `;

  const response = await ai.models.generateContent({
    model: "gemini-3-pro-preview",
    contents: prompt,
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          agents: { type: Type.OBJECT },
          modifications: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                original_excerpt: { type: Type.STRING },
                new_content: { type: Type.STRING },
                reason: { type: Type.STRING },
                section: { type: Type.STRING }
              },
              required: ["original_excerpt", "new_content"]
            }
          }
        },
        required: ["modifications"]
      }
    },
  });

  const text = response.text;
  if (!text) throw new Error("No response from Gemini");

  try {
    const data = JSON.parse(text) as TailoredResumeData;
    if (!data.modifications) data.modifications = [];
    return data;
  } catch (e) {
    throw new Error("Failed to parse Gemini response.");
  }
};