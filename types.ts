export interface AgentInsight {
  name: string;
  role: string;
  analysis: string;
  status: 'pending' | 'active' | 'complete';
}

export interface Modification {
  original_excerpt: string; // The text to find in the doc (legacy match key + UI display)
  new_content: string;      // The text to replace it with ("" = delete paragraph)
  reason?: string;          // Why the change was made
  section?: string;         // e.g., "Experience", "Summary"
  paragraph_id?: number;    // Stable paragraph index — precision (ID-addressed) pipeline
}

export interface ATSAnalysis {
  score: number;
  feedback: string;
  keywordMatch?: string[];
  missingKeywords?: string[];
  /** true when the score was computed deterministically by the keyword scanner
   *  (precision pipeline) rather than self-reported by a model. */
  measured?: boolean;
}

export interface TailoredResumeData {
  agents: Record<string, string>;
  modifications: Modification[];
  ats?: ATSAnalysis;
}

// ─── Precision pipeline types ────────────────────────────────────────────────

/** One Word paragraph, in document order, as extracted from word/document.xml. */
export interface ParagraphInfo {
  id: number;        // index among ALL <w:p> elements in document order
  text: string;      // editable text (text before the contact soft-break on mixed title+contact lines)
  fullText: string;  // entire paragraph text
  locked: boolean;   // protected — never offered to the model for editing
  lockReason?: 'empty' | 'name' | 'contact';
  lines: number;     // rendered line count from layout measurement (0 = unknown)
  maxChars: number;  // hard budget for replacement text (visible chars)
}

/** A JD keyword the deterministic scanner checks for. */
export interface KeywordSpec {
  term: string;
  variants?: string[];
  weight?: number; // 1 (nice to have) – 3 (critical)
}

export interface AtsScoreResult {
  score: number;          // 0–100, weighted coverage
  matched: string[];
  missing: string[];
  matchedWeight: number;
  totalWeight: number;
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

export type ModelProvider = 'openai' | 'deepseek' | 'gemini' | 'claude';

export interface AppSettings {
  openaiApiKey: string;
  deepseekApiKey: string;
  geminiApiKey: string;
  claudeApiKey: string;
  grokApiKey?: string;
  activeProvider: ModelProvider;
  feedbackProvider: ModelProvider;
}
