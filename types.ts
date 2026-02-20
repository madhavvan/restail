export interface AgentInsight {
  name: string;
  role: string;
  analysis: string;
  status: 'pending' | 'active' | 'complete';
}

export interface Modification {
  original_excerpt: string; // The text to find in the doc
  new_content: string;      // The text to replace it with
  reason: string;           // Why the change was made
  section: string;          // e.g., "Experience", "Summary"
}

export interface ATSAnalysis {
  score: number;
  missing_keywords: string[];
  feedback: string;
}

export interface TailoredResumeData {
  agents: {
    recruiter: AgentInsight;
    profiler: AgentInsight;
    gap_analyst: AgentInsight;
    strategist: AgentInsight;
    copywriter: AgentInsight;
    reviewer: AgentInsight;
  };
  modifications: Modification[];
  ats?: ATSAnalysis;
}

export interface AppState {
  step: 'upload' | 'analyzing' | 'preview';
  originalFile: File | null;
  originalResumeText: string;
  jobDescription: string;
  tailoredData: TailoredResumeData | null;
  error: string | null;
}

export enum Step {
  UPLOAD = 'upload',
  ANALYZING = 'analyzing',
  PREVIEW = 'preview',
}

export type ModelProvider = 'openai' | 'deepseek' | 'gemini';

export interface AppSettings {
  openaiApiKey: string;
  deepseekApiKey: string;
  geminiApiKey: string;
  activeProvider: ModelProvider;
}