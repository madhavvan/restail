import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Step, TailoredResumeData, AppSettings, Modification, ParagraphInfo } from './types';
import FileUpload from './components/FileUpload';
import ResumePreview from './components/ResumePreview';
import SmoothDocumentPreview from './components/SmoothDocumentPreview';
import SettingsModal from './components/SettingsModal';
import { tailorResumeOpenAI, createOptimizationPlan, openaiLlm } from './services/openaiService';
import { tailorResumeDeepSeek, createOptimizationPlanDeepSeek, deepseekLlm } from './services/deepseekService';
import { tailorResumeGemini, createOptimizationPlanGemini, geminiLlm } from './services/geminiService';
import { tailorResumeClaude, createOptimizationPlanClaude, claudeLlm } from './services/claudeService';
import { grokLlm, createOptimizationPlanGrok } from './services/grokservices';
import {
  extractJdKeywords, tailorResumePrecision, EngineFindings, LlmCall,
} from './services/precisionService';
import {
  applyModificationsToBuffer, extractParagraphTable,
  applyModificationsByIdToBuffer, visibleTextOf,
  normalizeDocxBuffer, extractTextFromDocx,
} from './services/documentService';
import { measureDocxBuffer, preparePrintFrame, loadDocxPreview } from './services/docxRender';
import { scoreTextAgainstKeywords, composeModifiedText } from './services/atsScore';
import ReactMarkdown from 'react-markdown';
import {
  FileText, Briefcase, Wand2, ArrowRight, Settings, Undo,
  BrainCircuit, Sparkles, Info, Loader2, AlertOctagon, RefreshCw,
  Shield, Zap, Eye, ChevronRight, Home, Shuffle, ArrowLeft,
  CheckCircle2, Star, Target, Cpu,
} from 'lucide-react';

// ─── Global CSS ───────────────────────────────────────────────────────────────
const GLOBAL_CSS = `
@import url('https://fonts.googleapis.com/css2?family=DM+Sans:ital,opsz,wght@0,9..40,300;0,9..40,400;0,9..40,500;0,9..40,600;0,9..40,700;1,9..40,400&family=JetBrains+Mono:wght@400;500;600&display=swap');

@keyframes fadeSlideUp {
  from { opacity:0; transform:translateY(8px); }
  to   { opacity:1; transform:translateY(0);   }
}
.msg-enter { animation: fadeSlideUp 0.3s ease forwards; }

@keyframes shimmer {
  0% { background-position: -200% 0; }
  100% { background-position: 200% 0; }
}

@keyframes gradientFlow {
  0%, 100% { background-position: 0% 50%; }
  50% { background-position: 100% 50%; }
}

@keyframes float {
  0%, 100% { transform: translateY(0px); }
  50% { transform: translateY(-6px); }
}

@keyframes pulseGlow {
  0%, 100% { box-shadow: 0 0 0 0 rgba(99, 102, 241, 0.4); }
  50% { box-shadow: 0 0 0 8px rgba(99, 102, 241, 0); }
}

@keyframes modApply {
  0% { opacity: 0; transform: scale(0.97); }
  50% { opacity: 1; transform: scale(1.01); background: rgba(253, 224, 71, 0.2); }
  100% { opacity: 1; transform: scale(1); background: transparent; }
}
.mod-apply { animation: modApply 0.6s ease forwards; }

/* ── docx-preview overrides ── */
.docx-preview-container .docx-wrapper {
  background: transparent !important;
  padding: 0 !important;
}
.docx-preview-container .docx-wrapper > section.docx {
  box-shadow: 0 4px 24px rgba(0,0,0,0.08) !important;
  margin: 16px auto !important;
  border-radius: 4px;
}

@keyframes highlightPulse {
  0%, 100% { background-color: #fef08a; }
  50%       { background-color: #fde047; }
}
.docx-preview-container [style*="background-color: yellow"],
.docx-preview-container [style*="background-color:yellow"],
.docx-preview-container mark {
  animation: highlightPulse 2s ease-in-out infinite;
  border-radius: 2px;
  padding: 0 1px;
}

/* Custom scrollbar */
::-webkit-scrollbar { width: 6px; height: 6px; }
::-webkit-scrollbar-track { background: transparent; }
::-webkit-scrollbar-thumb { background: #cbd5e1; border-radius: 3px; }
::-webkit-scrollbar-thumb:hover { background: #94a3b8; }

/* Save button animation */
@keyframes saveSuccess {
  0% { transform: scale(1); }
  30% { transform: scale(0.95); }
  60% { transform: scale(1.05); }
  100% { transform: scale(1); }
}
.save-success { animation: saveSuccess 0.4s ease; }
`;

// ─── DocxPreviewPane ──────────────────────────────────────────────────────────
interface DocxPreviewPaneProps {
  buffer: ArrayBuffer | null;
  isUpdating: boolean;
}

const DocxPreviewPane: React.FC<DocxPreviewPaneProps> = ({ buffer, isUpdating }) => {
  const containerRef  = useRef<HTMLDivElement>(null);
  const prevBufferRef = useRef<ArrayBuffer | null>(null);
  const [renderError,  setRenderError]  = useState<string | null>(null);
  const [isLibLoading, setIsLibLoading] = useState(true);

  useEffect(() => {
    loadDocxPreview()
      .then(() => setIsLibLoading(false))
      .catch(err => { setRenderError(err.message); setIsLibLoading(false); });
  }, []);

  useEffect(() => {
    if (!buffer || buffer === prevBufferRef.current) return;
    if (!containerRef.current) return;
    prevBufferRef.current = buffer;
    setRenderError(null);

    if (containerRef.current) containerRef.current.innerHTML = '';

    loadDocxPreview()
      .then(({ renderAsync }) => {
        if (!containerRef.current) return;
        return renderAsync(
          new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }),
          containerRef.current,
          undefined,
          {
            className:       'docx',
            inWrapper:       true,
            ignoreWidth:     false,
            ignoreHeight:    false,
            ignoreFonts:     false,
            breakPages:      true,
            useBase64URL:    true,
            renderHeaders:   true,
            renderFooters:   true,
            renderFootnotes: true,
            renderEndnotes:  true,
          }
        );
      })
      .catch(err => {
        console.error('docx-preview render error:', err);
        setRenderError(err.message || 'Failed to render document preview.');
      });
  }, [buffer]);

  return (
    <div className="relative w-full h-full">
      {isUpdating && (
        <div className="absolute inset-0 z-10 bg-white/60 backdrop-blur-sm flex items-center justify-center pointer-events-none">
          <div className="flex items-center gap-2 bg-white border border-indigo-200 shadow-lg rounded-full px-4 py-2">
            <Loader2 className="w-4 h-4 animate-spin text-indigo-500" />
            <span className="text-xs font-semibold text-indigo-700">Applying modifications…</span>
          </div>
        </div>
      )}

      {isLibLoading && (
        <div className="flex flex-col items-center justify-center h-full text-slate-400 gap-3 py-20">
          <Loader2 className="w-6 h-6 animate-spin text-indigo-400" />
          <p className="text-sm font-medium">Loading document renderer…</p>
        </div>
      )}

      {renderError && !isLibLoading && (
        <div className="p-6 text-red-500 text-sm font-medium text-center">
          <AlertOctagon className="w-6 h-6 mx-auto mb-2" />
          <p className="font-semibold mb-1">Preview unavailable</p>
          <p className="text-xs text-red-400">{renderError}</p>
        </div>
      )}

      {!buffer && !renderError && !isLibLoading && (
        <div className="flex flex-col items-center justify-center h-full text-slate-400 gap-3 py-20">
          <FileText className="w-10 h-10 opacity-30" />
          <p className="text-sm font-medium">Upload a .docx file to preview it here</p>
        </div>
      )}

      <div
        ref={containerRef}
        className="docx-preview-container w-full"
        style={{ display: buffer && !renderError ? 'block' : 'none' }}
      />
    </div>
  );
};

// ─── Default settings ─────────────────────────────────────────────────────────
const DEFAULT_SETTINGS: AppSettings = {
  openaiApiKey:   '',
  deepseekApiKey: '',
  geminiApiKey:   '',
  claudeApiKey:   '',
  grokApiKey:     '',
  activeProvider: 'openai',
  feedbackProvider: 'deepseek',
};

// ─── TypewriterText (COMPACT — with internal scroll) ──────────────────────────
const TypewriterText: React.FC<{ text: string; speed?: number }> = ({ text, speed = 10 }) => {
  const [displayed, setDisplayed] = useState('');
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setDisplayed('');
    let i = 0;
    const id = setInterval(() => {
      i += 4;
      if (i >= text.length) { setDisplayed(text); clearInterval(id); }
      else setDisplayed(text.substring(0, i));
    }, speed);
    return () => clearInterval(id);
  }, [text, speed]);

  // Only auto-scroll WITHIN this message box — not the parent container
  useEffect(() => {
    const el = boxRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [displayed]);

  return (
    <div
      ref={boxRef}
      className="overflow-y-auto pr-1 text-slate-700 text-xs leading-relaxed [&_p]:mb-1.5 [&_p:last-child]:mb-0 [&_ul]:list-disc [&_ul]:pl-4 [&_ul]:mb-1.5 [&_strong]:text-slate-900 [&_strong]:font-semibold [&_code]:bg-slate-100 [&_code]:px-1 [&_code]:rounded [&_code]:text-indigo-600 [&_code]:font-mono [&_code]:text-[10px]"
      style={{ maxHeight: 140 }}
    >
      <ReactMarkdown>{displayed}</ReactMarkdown>
    </div>
  );
};

// ─── Agent assets ─────────────────────────────────────────────────────────────
const OPENAI_LOGO   = 'https://upload.wikimedia.org/wikipedia/commons/0/04/ChatGPT_logo.svg';
const DEEPSEEK_LOGO = `data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><circle cx='50' cy='50' r='45' fill='%234d6bfe'/><path d='M30 65 Q50 20 70 65' stroke='white' stroke-width='8' fill='none' stroke-linecap='round'/><circle cx='50' cy='68' r='6' fill='white'/></svg>`;
const GEMINI_LOGO   = 'https://upload.wikimedia.org/wikipedia/commons/8/8a/Google_Gemini_logo.svg';
const CLAUDE_LOGO   = `data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><circle cx='50' cy='50' r='45' fill='%23D97706'/><text x='50' y='62' text-anchor='middle' font-size='40' font-weight='bold' fill='white' font-family='sans-serif'>C</text></svg>`;
const GROK_LOGO     = `data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><circle cx='50' cy='50' r='45' fill='%23111827'/><text x='50' y='64' text-anchor='middle' font-size='42' font-weight='bold' fill='white' font-family='sans-serif'>X</text></svg>`;

const agentIcon = (name: string) => {
  if (name.includes('GPT'))      return <img src={OPENAI_LOGO}   alt="GPT"    className="w-4 h-4 object-contain" />;
  if (name.includes('DeepSeek')) return <img src={DEEPSEEK_LOGO} alt="DS"     className="w-4 h-4 object-contain" />;
  if (name.includes('Claude'))   return <img src={CLAUDE_LOGO}   alt="Claude" className="w-4 h-4 object-contain" />;
  if (name.includes('Grok'))     return <img src={GROK_LOGO}     alt="Grok"   className="w-4 h-4 object-contain" />;
  return                                <img src={GEMINI_LOGO}   alt="Gemini" className="w-4 h-4 object-contain" />;
};
const agentBg   = (n: string) => n.includes('GPT') ? 'bg-emerald-50/80'   : n.includes('DeepSeek') ? 'bg-blue-50/80'   : n.includes('Claude') ? 'bg-amber-50/80' : n.includes('Grok') ? 'bg-slate-100/80' : 'bg-violet-50/80';
const agentText = (n: string) => n.includes('GPT') ? 'text-emerald-700' : n.includes('DeepSeek') ? 'text-blue-700' : n.includes('Claude') ? 'text-amber-700' : n.includes('Grok') ? 'text-slate-700' : 'text-violet-700';

// ─── Provider label helper (model IDs verified against vendor docs 2026-06-10) ─
const providerLabel = (p: string) =>
  p === 'openai'   ? 'GPT-5.5'
  : p === 'deepseek' ? 'DeepSeek V4 Pro'
  : p === 'claude'   ? 'Claude Sonnet 4.6'
  : p === 'grok'     ? 'Grok 4.3'
  : 'Gemini 3.1 Pro';

const apiKeyField = (p: string) =>
  p === 'claude'   ? 'claudeApiKey'
  : p === 'openai'   ? 'openaiApiKey'
  : p === 'deepseek' ? 'deepseekApiKey'
  : p === 'grok'     ? 'grokApiKey'
  : 'geminiApiKey';

const ALL_PROVIDERS = ['openai', 'deepseek', 'gemini', 'claude', 'grok'] as const;
const providerPairLabel = (p: string, f?: string) => {
  const writer = providerLabel(p);
  const feedback = f ? providerLabel(f) : 'DeepSeek V4 Pro';
  return `${writer} ⇆ ${feedback}`;
};

// ─── App ──────────────────────────────────────────────────────────────────────
const App: React.FC = () => {
  const [step, setStep]                         = useState<Step>(Step.UPLOAD);
  const [resumeText, setResumeText]             = useState('');
  const [originalFile, setOriginalFile]         = useState<File | null>(null);
  const [originalFileBuffer, setOriginalFileBuffer] = useState<ArrayBuffer | null>(null);
  const [jobDescription, setJobDescription]     = useState('');
  const [tailoredData, setTailoredData]         = useState<TailoredResumeData | null>(null);
  const [error, setError]                       = useState<string | null>(null);

  const [liveDocBuffer, setLiveDocBuffer]       = useState<ArrayBuffer | null>(null);
  const [liveModifications, setLiveModifications] = useState<any[]>([]);
  const [isDocUpdating, setIsDocUpdating]       = useState(false);
  /** Exact verified bytes of the final document (precision pipeline) —
   *  downloads serve THIS buffer, never a re-application. */
  const [finalBuffer, setFinalBuffer]           = useState<ArrayBuffer | null>(null);

  const [agentLogs, setAgentLogs] = useState<Array<{ id: string; agent: string; message: string; ts: Date }>>([]);
  const [thinking, setThinking]   = useState<{ agent: string; action: string } | null>(null);
  const [retryPrompt, setRetryPrompt] = useState<{ message: string; resolve: () => void; reject: (e: Error) => void } | null>(null);
  const [progressText, setProgressText] = useState('Initializing…');
  const [liveAtsScore, setLiveAtsScore] = useState(0);
  const logsEndRef = useRef<HTMLDivElement>(null);
  const logsContainerRef = useRef<HTMLDivElement>(null);

  // ── Track how many mods have been applied (token-by-token) ──
  const [appliedModCount, setAppliedModCount] = useState(0);
  const [totalModCount, setTotalModCount] = useState(0);

  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [settings, setSettings]             = useState<AppSettings>(DEFAULT_SETTINGS);
  const settingsRef                         = useRef<AppSettings>(DEFAULT_SETTINGS);

  // ── Cancel flag for stopping the process mid-run ──
  const cancelRef = useRef(false);

  // ── Track if user has scrolled up (to NOT force-scroll) ──
  const userScrolledUpRef = useRef(false);

  // Load persisted settings
  useEffect(() => {
    const saved = localStorage.getItem('resuTailorSettings');
    if (saved) {
      try {
        const p = JSON.parse(saved);
        setSettings(p);
        settingsRef.current = p;
      } catch {}
    }
  }, []);

  // Dev-only test hook: exposes the deterministic core for headless validation
  // (paragraph extraction, layout measurement, keyword scoring) without API calls.
  useEffect(() => {
    if ((import.meta as any).env?.DEV) {
      (window as any).__restail = {
        extractParagraphTable,
        measureDocxBuffer,
        applyModificationsByIdToBuffer,
        scoreTextAgainstKeywords,
        visibleTextOf,
        preparePrintFrame,
        normalizeDocxBuffer,
        extractTextFromDocx,
      };
    }
  }, []);

  // ── Smart auto-scroll: only scroll if user is near the bottom ──
  useEffect(() => {
    if (userScrolledUpRef.current) return; // User scrolled up — don't force
    logsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [agentLogs, thinking]);

  // ── Detect user scroll position in the chat panel ──
  const handleLogsScroll = useCallback(() => {
    const el = logsContainerRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    userScrolledUpRef.current = distanceFromBottom > 120;
  }, []);

  // Progress text cycling
  useEffect(() => {
    if (step !== Step.ANALYZING) return;
    const phrases = [
      'Deep-scanning resume structure…',
      'Aligning with JD requirements…',
      'Injecting elite ATS terminology…',
      'Restructuring for maximum impact…',
      'Cross-validating technical keywords…',
      'Polishing narrative flow…',
      'Finalizing high-impact bullets…',
    ];
    let i = 0;
    setProgressText(phrases[0]);
    const id = setInterval(() => { i++; setProgressText(phrases[i % phrases.length]); }, 2600);
    return () => clearInterval(id);
  }, [step]);

  const addLog = useCallback((agent: string, message: string) => {
    setAgentLogs(prev => [...prev, { id: Math.random().toString(36).slice(2), agent, message, ts: new Date() }]);
  }, []);

  const awaitTyping = (text: string) =>
    new Promise<void>(r => setTimeout(r, Math.ceil((text.length / 4) * 10) + 400));

  const handleSaveSettings = (s: AppSettings) => {
    setSettings(s);
    settingsRef.current = s;
    localStorage.setItem('resuTailorSettings', JSON.stringify(s));
  };

  const handleResumeProcessed = async (text: string, file?: File) => {
    setResumeText(text);
    if (file) {
      setOriginalFile(file);
      try {
        const buf = await file.arrayBuffer();
        setOriginalFileBuffer(buf);
        setLiveDocBuffer(buf.slice(0));
      } catch (e) {
        console.error('Buffer read failed', e);
      }
    }
  };

  // ── Buffer application — routes by mod addressing mode ────────────────────
  // Mods carrying paragraph_id use the exact ID-addressed engine (precision
  // pipeline); legacy excerpt mods keep the fuzzy matcher.
  const applyBufferMods = async (mods: any[], isFinalRound = false): Promise<ArrayBuffer | null> => {
    if (!originalFileBuffer || !mods?.length) return null;
    const usesIds = mods.some(m => m.paragraph_id != null);
    if (usesIds) {
      const { buffer } = await applyModificationsByIdToBuffer(originalFileBuffer.slice(0), mods);
      return buffer;
    }
    return applyModificationsToBuffer(originalFileBuffer.slice(0), mods, isFinalRound);
  };

  // ── Apply modifications ONE AT A TIME (token-by-token) ────────────────────
  const applyModsSequentially = async (mods: any[]): Promise<ArrayBuffer | null> => {
    if (!originalFileBuffer || !mods?.length) return null;
    setTotalModCount(mods.length);
    setAppliedModCount(0);
    setLiveModifications([]);

    for (let i = 0; i < mods.length; i++) {
      if (cancelRef.current) break;
      const subset = mods.slice(0, i + 1);

      setLiveModifications(subset);
      setAppliedModCount(i + 1);

      // Calculate delay based on length to simulate typing
      const newContentLen = mods[i].new_content.length;
      const delay = Math.min(Math.max(newContentLen * 15, 400), 2500);
      await new Promise(r => setTimeout(r, delay));
    }

    // After all mods are applied visually, update the actual DOCX buffer
    setIsDocUpdating(true);
    try {
      const newBuf = await applyBufferMods(mods);
      if (newBuf) setLiveDocBuffer(newBuf);
      setLiveModifications([]); // Switch back to DocxPreviewPane
      return newBuf;
    } catch (e) {
      console.error(`Final mod apply failed:`, e);
      return null;
    } finally {
      setIsDocUpdating(false);
    }
  };

  // ── Bulk update (fallback for final pass) ──
  const updateLiveDoc = async (mods: any[], isFinalRound = false): Promise<ArrayBuffer | null> => {
    if (!originalFileBuffer || !mods?.length) return null;
    setIsDocUpdating(true);
    try {
      const newBuf = await applyBufferMods(mods, isFinalRound);
      if (newBuf) setLiveDocBuffer(newBuf);
      return newBuf;
    } catch (e) {
      console.error('Live doc update failed:', e);
      return null;
    } finally {
      setIsDocUpdating(false);
    }
  };

  const constructDraft = (original: string, mods: any[]) => {
    if (!mods?.length) return original;
    let draft = original;
    [...mods]
      .sort((a, b) => b.original_excerpt.length - a.original_excerpt.length)
      .forEach(m => {
        if (m.original_excerpt?.length > 5)
          draft = draft.split(m.original_excerpt.trim()).join(m.new_content);
      });
    return draft;
  };

  // ─────────────────────────────────────────────────────────────────────────
  // Page-overflow DETECTION (no trimming — AI handles condensing)
  // ─────────────────────────────────────────────────────────────────────────

  const WORD_LINE_MAX = 122; // Calibri 11pt, 0.75" margins — 1 Word line

  /**
   * Detects whether the modified resume exceeds the original's character/line
   * count and generates targeted AI feedback identifying which bullets overflow.
   *
   * This does NOT trim anything — it produces a feedback string that gets
   * sent back to the primary AI so it can intelligently condense or merge bullets.
   */
  const detectPageOverflow = (
    data: TailoredResumeData,
    originalText: string
  ): { isOverflowing: boolean; overByChars: number; overByLines: number; feedback: string } => {
    const originalLines = originalText.split('\n').length;
    const originalChars = originalText.length;

    const draft        = constructDraft(originalText, data.modifications ?? []);
    const currentLines = draft.split('\n').length;
    const currentChars = draft.length;

    const overByChars = Math.max(0, currentChars - originalChars);
    const overByLines = Math.max(0, currentLines - originalLines);

    if (overByChars <= 0 && overByLines <= 0) {
      addLog('SYSTEM', `✅ Page fit perfect (${currentLines}/${originalLines} lines)`);
      return { isOverflowing: false, overByChars: 0, overByLines: 0, feedback: '' };
    }

    // Identify which bullets are overflowing their original line count
    const mods = data.modifications ?? [];
    const overflowingBullets: string[] = [];
    const expandedBullets: string[] = [];

    for (const mod of mods) {
      const origLen = (mod.original_excerpt || '').length;
      const newVisible = (mod.new_content || '').replace(/\*\*([^*]+)\*\*/g, '$1').length;
      if (newVisible === 0) continue; // absorbed bullet — already deleted
      const origWordLines = Math.ceil(Math.max(origLen, 1) / WORD_LINE_MAX);
      const newWordLines  = Math.ceil(Math.max(newVisible, 1) / WORD_LINE_MAX);

      if (newWordLines > origWordLines) {
        overflowingBullets.push(
          `- "${(mod.new_content || '').substring(0, 80)}…" → ${newVisible} chars (${newWordLines} lines, was ${origWordLines})`
        );
      }
      if (newVisible > origLen + 10) {
        expandedBullets.push(
          `- "${(mod.new_content || '').substring(0, 60)}…" grew by +${newVisible - origLen} chars`
        );
      }
    }

    let feedback = `CRITICAL PAGE OVERFLOW DETECTED — YOU MUST FIX THIS\n`;
    feedback += `The resume overflows by ~${overByChars} chars / ${overByLines} extra lines. It will spill to page 3.\n\n`;

    if (overflowingBullets.length > 0) {
      feedback += `BULLETS TAKING MORE LINES THAN THE ORIGINAL (fix these first):\n`;
      feedback += overflowingBullets.join('\n') + '\n\n';
    }

    if (expandedBullets.length > 0) {
      feedback += `BULLETS THAT GREW SIGNIFICANTLY:\n`;
      feedback += expandedBullets.join('\n') + '\n\n';
    }

    feedback += `MANDATORY ACTIONS:\n`;
    feedback += `1. Every bullet that exceeds 122 visible characters (1 Word line) MUST be condensed to ≤122 chars — write tighter, use "&" not "and", drop filler words.\n`;
    feedback += `2. If a bullet MUST stay at 2 lines because it is critical for JD matching, MERGE it with the next adjacent bullet: combine both into one 2-line statement (≤244 chars) and set the absorbed bullet's new_content to "" (empty string — the document engine will delete that line).\n`;
    feedback += `3. Preserve all metrics and key achievements — condense the opening action phrase, not the ending.\n`;
    feedback += `4. The total line count across ALL modifications MUST equal or be LESS than the original resume's line count (${originalLines} lines).\n`;
    feedback += `5. For each modification, verify: ceil(new_content_length / 122) ≤ ceil(original_excerpt_length / 122).\n`;

    addLog('SYSTEM', `⚠️ Page overflow: +${overByChars} chars / +${overByLines} lines. ${overflowingBullets.length} bullets exceed their line budget.`);
    return { isOverflowing: true, overByChars, overByLines, feedback };
  };

  /**
   * Merge V1.x modifications back to the real .docx original_excerpts.
   * Reusable helper used after any AI refinement pass (v1.1, condensing, etc.)
   */
  const mergeModifications = (prevMods: any[], newMods: any[]): any[] => {
    const normalizeKey = (s: string) => (s || '').replace(/\*\*([^*]+)\*\*/g, '$1').trim().toLowerCase();

    const prevByNewContent = new Map<string, (typeof prevMods)[0]>();
    for (const m of prevMods) {
      const key = normalizeKey(m.new_content || '');
      if (key) prevByNewContent.set(key, m);
    }

    const prevByOriginal = new Map<string, (typeof prevMods)[0]>();
    for (const m of prevMods) {
      const key = normalizeKey(m.original_excerpt || '');
      if (key) prevByOriginal.set(key, m);
    }

    const merged: typeof prevMods = [];
    const usedPrevKeys = new Set<string>();

    for (const newMod of newMods) {
      const excerptKey = normalizeKey(newMod.original_excerpt || '');

      // Case A: new mod's original_excerpt matches a prev mod's new_content
      // → The AI refined prev output → remap to prev's original_excerpt
      const matchByNew = prevByNewContent.get(excerptKey);
      if (matchByNew) {
        merged.push({
          ...newMod,
          original_excerpt: matchByNew.original_excerpt, // points to real .docx text
        });
        usedPrevKeys.add(normalizeKey(matchByNew.original_excerpt || ''));
        continue;
      }

      // Case B: new mod's original_excerpt matches a prev mod's original_excerpt
      const matchByOrig = prevByOriginal.get(excerptKey);
      if (matchByOrig) {
        merged.push(newMod);
        usedPrevKeys.add(excerptKey);
        continue;
      }

      // Case C: Brand new mod
      merged.push(newMod);
    }

    // Carry forward prev mods that the new pass didn't touch
    for (const m of prevMods) {
      const key = normalizeKey(m.original_excerpt || '');
      if (!usedPrevKeys.has(key)) {
        merged.push(m);
      }
    }

    return merged;
  };

  // ── withRetry now supports model switching on error ──
  async function withRetry<T>(op: () => Promise<T>, name: string): Promise<T> {
    let attempts = 0;
    while (true) {
      if (cancelRef.current) throw new Error('Cancelled by user');
      try {
        return await op();
      } catch (err: any) {
        attempts++;
        const isRate = err?.status === 429 || err?.status === 529 ||
          /quota|rate.?limit|too.?many|exceeded|overloaded/i.test(err?.message ?? '');
        if (isRate && attempts <= 2) {
          addLog('SYSTEM', `⚠️ Rate limit (${name}). Retrying in ${attempts * 3}s…`);
          await new Promise(r => setTimeout(r, attempts * 3000));
          continue;
        }
        addLog('SYSTEM', `❌ Error (${name}): ${err.message ?? 'Unknown'}`);
        try {
          await new Promise<void>((res, rej) =>
            setRetryPrompt({ message: err.message, resolve: res, reject: rej })
          );
          setRetryPrompt(null);
          addLog('SYSTEM', `🔄 Retrying…`);
          attempts = 0;
        } catch (cancel) {
          setRetryPrompt(null);
          throw cancel;
        }
      }
    }
  }

  // ── Switch provider mid-process ──
  const handleSwitchProvider = (newProvider: string) => {
    const s = { ...settingsRef.current, activeProvider: newProvider as any };
    setSettings(s);
    settingsRef.current = s;
    localStorage.setItem('resuTailorSettings', JSON.stringify(s));
    addLog('SYSTEM', `🔄 Switched primary model to ${providerLabel(newProvider)}. Retrying…`);
    // Resolve the retry prompt to continue with the new provider
    if (retryPrompt) {
      retryPrompt.resolve();
    }
  };

  // ── Go back to dashboard ──
  const handleBackToDashboard = () => {
    cancelRef.current = true;
    setThinking(null);
    setRetryPrompt(null);
    setStep(Step.UPLOAD);
    setFinalBuffer(null);
    setAgentLogs([]);
    setLiveAtsScore(0);
    setAppliedModCount(0);
    setTotalModCount(0);
    if (originalFileBuffer) setLiveDocBuffer(originalFileBuffer.slice(0));
    setTimeout(() => { cancelRef.current = false; }, 100);
  };

  // ───────────────────────────────────────────────────────────────────────────
  // PRECISION PIPELINE (Claude writer)
  //
  // Code does geometry, the model does wording:
  //   1. Parse paragraphs with stable IDs + measure the REAL rendered layout
  //      (pages, per-paragraph line counts) — that page count becomes the
  //      locked target for whatever resume was uploaded.
  //   2. Extract JD keywords once; score coverage deterministically (the UI
  //      shows measured percentages, never model self-grades).
  //   3. Model writes ID-addressed mods under per-paragraph char budgets.
  //   4. Engine applies, RENDERS, and measures; violations/offenders bounce
  //      back with exact findings; paragraphs that can't be fixed revert to
  //      their original text — layout is guaranteed, never "hope it fits".
  // ───────────────────────────────────────────────────────────────────────────
  const runPrecisionPipeline = async () => {
    if (!originalFileBuffer) throw new Error('Original .docx buffer missing — please re-upload the file.');

    const getApiKey = (p: string) => {
      if (p === 'openai')   return settingsRef.current.openaiApiKey;
      if (p === 'deepseek') return settingsRef.current.deepseekApiKey;
      if (p === 'gemini')   return settingsRef.current.geminiApiKey;
      if (p === 'claude')   return settingsRef.current.claudeApiKey;
      if (p === 'grok')     return settingsRef.current.grokApiKey || '';
      return '';
    };

    // Writer transport — every provider speaks the same precision contract.
    // Resolved per-call so the mid-run "switch model & continue" rescue works.
    const writerFor = (p: string): { name: string; llm: LlmCall } => {
      const key = getApiKey(p);
      if (!key) throw new Error(`${providerLabel(p)} API key missing — add it in Settings.`);
      if (p === 'openai')   return { name: providerLabel(p), llm: openaiLlm(key) };
      if (p === 'deepseek') return { name: providerLabel(p), llm: deepseekLlm(key) };
      if (p === 'gemini')   return { name: providerLabel(p), llm: geminiLlm(key) };
      if (p === 'grok')     return { name: providerLabel(p), llm: grokLlm(key) };
      return { name: providerLabel('claude'), llm: claudeLlm(key) };
    };
    const wllm: LlmCall = (s, u, t, m) => writerFor(settingsRef.current.activeProvider).llm(s, u, t, m);

    const primaryName = writerFor(settingsRef.current.activeProvider).name;
    const fbProvider = settingsRef.current.feedbackProvider || 'deepseek';
    const reviewerName = providerLabel(fbProvider);

    addLog('SYSTEM', `Precision pipeline engaged. ${primaryName} ⇆ ${reviewerName} connected.`);

    // ── 1 · Geometry: paragraph table + real rendered layout ────────────────
    setThinking({ agent: primaryName, action: 'Parsing document geometry…' });
    const paragraphs = await extractParagraphTable(originalFileBuffer.slice(0));
    // Baseline geometry comes from the NORMALIZED buffer — the same trailing-
    // empty cleanup + label-bolding pass every applied buffer goes through —
    // so auto-formatting can never register as overflow caused by the mods.
    const baseline = await measureDocxBuffer(await normalizeDocxBuffer(originalFileBuffer.slice(0)));
    setThinking(null);

    // Align rendered <p> elements to XML paragraph IDs by text (two-pointer,
    // document order). Stray rendered nodes (textbox banners etc.) get skipped.
    const alignToDom = (
      expected: Array<{ id: number; text: string }>,
      m: typeof baseline
    ) => {
      const norm = (s: string) => s.replace(/\s+/g, ' ').trim().toLowerCase();
      const linesById = new Map<number, number>();
      let j = 0, matched = 0, nonEmpty = 0;
      for (const e of expected) {
        const t = norm(e.text);
        if (t) nonEmpty++;
        let found = -1;
        for (let k = j; k < Math.min(m.paraTexts.length, j + 6); k++) {
          const d = norm(m.paraTexts[k]);
          if (!t && !d) { found = k; break; }
          if (t && d && (d.startsWith(t.slice(0, 30)) || t.startsWith(d.slice(0, 30)))) { found = k; break; }
        }
        if (found >= 0) {
          if (t) matched++;
          linesById.set(e.id, m.paraLines[found]);
          j = found + 1;
        }
      }
      return { linesById, reliable: nonEmpty > 0 && matched / nonEmpty >= 0.9 };
    };

    const baseAlign = alignToDom(paragraphs.map(p => ({ id: p.id, text: p.fullText })), baseline);
    const mapReliable = baseAlign.reliable;
    const targetPages = Math.max(1, baseline.pages);
    const baseHeight = baseline.contentHeight;
    const lineH = baseline.lineHeight || 16;

    paragraphs.forEach(p => {
      p.lines = Math.max(1, baseAlign.linesById.get(p.id) ?? Math.ceil((p.text.length || 1) / 110));
    });
    // Empirical 1-line capacity: the longest paragraph that renders on one
    // line tells us roughly how many chars a line fits in THIS template.
    const oneLineLens = paragraphs.filter(p => !p.locked && p.lines === 1).map(p => p.text.length);
    const cap1 = oneLineLens.length ? Math.max(...oneLineLens) : 110;
    paragraphs.forEach(p => {
      if (p.locked) { p.maxChars = p.text.length; return; }
      if (p.lines <= 1)      p.maxChars = Math.max(p.text.length + 2, Math.min(cap1 - 6, p.text.length + 30));
      else if (p.lines === 2) p.maxChars = p.text.length + 10;
      else                    p.maxChars = p.text.length + 20;
    });

    const lockedIds = new Set(paragraphs.filter(p => p.locked).map(p => p.id));
    const editableCount = paragraphs.length - lockedIds.size;
    addLog('SYSTEM',
      `Geometry locked: ${paragraphs.length} paragraphs (${editableCount} editable) · renders exactly ${targetPages} page(s)` +
      (mapReliable ? ' · per-line verification active.' : ' · page-level verification active.'));
    if (cancelRef.current) return;

    // ── 2 · JD keywords + measured baseline ─────────────────────────────────
    setThinking({ agent: primaryName, action: 'Extracting JD keyword matrix…' });
    const keywords = await withRetry(() => extractJdKeywords(wllm, jobDescription), primaryName);
    setThinking(null);
    if (cancelRef.current) return;

    const originalTexts = paragraphs.map(p => p.fullText);
    const base = scoreTextAgainstKeywords(originalTexts.join('\n'), keywords);
    setLiveAtsScore(base.score);
    addLog('SYSTEM', `Deterministic ATS baseline: ${base.score}% (${base.matched.length}/${keywords.length} JD keywords present).`);
    if (cancelRef.current) return;

    // ── 3 · Plan + critical review (the dual-agent conversation) ────────────
    const introMsg = `I parsed the document into ${editableCount} editable paragraphs and measured a ${base.score}% keyword baseline against this JD.\nPreparing the optimization plan…`;
    addLog(primaryName, introMsg);
    await awaitTyping(introMsg);
    if (cancelRef.current) return;

    setThinking({ agent: primaryName, action: 'Building optimization plan…' });
    const writerPlan = () => {
      const p = settingsRef.current.activeProvider;
      if (p === 'openai')   return createOptimizationPlan(resumeText, jobDescription, getApiKey('openai'));
      if (p === 'deepseek') return createOptimizationPlanDeepSeek(resumeText, jobDescription, getApiKey('deepseek'), reviewerName);
      if (p === 'gemini')   return createOptimizationPlanGemini(resumeText, jobDescription, getApiKey('gemini'));
      if (p === 'grok')     return createOptimizationPlanGrok(resumeText, jobDescription, getApiKey('grok'), reviewerName);
      return createOptimizationPlanClaude(resumeText, jobDescription, getApiKey('claude'));
    };
    const plan = await withRetry(writerPlan, primaryName);
    setThinking(null);
    if (cancelRef.current) return;

    const planMsg = `PROPOSED OPTIMIZATION PLAN:\n\n${plan}\n\n${reviewerName}, please review and give your critical feedback.`;
    addLog(primaryName, planMsg);
    await awaitTyping(planMsg);
    if (cancelRef.current) return;

    setThinking({ agent: reviewerName, action: 'Reviewing plan and cooking feedback…' });
    const reviewerPlan = () => {
      const fb = settingsRef.current.feedbackProvider || 'deepseek';
      if (fb === 'deepseek') return createOptimizationPlanDeepSeek(resumeText, jobDescription, getApiKey('deepseek'), primaryName);
      if (fb === 'openai')   return createOptimizationPlan(resumeText, jobDescription, getApiKey('openai'));
      if (fb === 'claude')   return createOptimizationPlanClaude(resumeText, jobDescription, getApiKey('claude'));
      if (fb === 'grok')     return createOptimizationPlanGrok(resumeText, jobDescription, getApiKey('grok'), primaryName);
      return createOptimizationPlanGemini(resumeText, jobDescription, getApiKey('gemini'));
    };
    const reviewFeedback = await withRetry(reviewerPlan, reviewerName);
    setThinking(null);
    if (cancelRef.current) return;

    const feedbackMsg = `REVIEW FEEDBACK:\n\n${reviewFeedback}`;
    addLog(reviewerName, feedbackMsg);
    await awaitTyping(feedbackMsg);
    if (cancelRef.current) return;

    // ── Pipeline helpers ─────────────────────────────────────────────────────
    const byId = (list: Modification[]) => {
      const m = new Map<number, Modification>();
      list.forEach(x => { if (x.paragraph_id != null) m.set(x.paragraph_id, x); });
      return m;
    };
    const sanitize = (list: Modification[]) => list.filter(m => {
      if (m.paragraph_id == null || m.paragraph_id < 0 || m.paragraph_id >= paragraphs.length) return false;
      if (lockedIds.has(m.paragraph_id)) return false;
      const vis = visibleTextOf(m.new_content);
      if (vis.trim() === '' && m.new_content.trim() !== '') return false; // markup-only garbage
      if (vis.trim() === paragraphs[m.paragraph_id].text.trim()) return false; // no-op
      return true;
    });
    const budgetViolations = (list: Modification[]) => list
      .filter(m => m.new_content.trim() !== '')
      .map(m => ({ paragraph_id: m.paragraph_id!, visibleLen: visibleTextOf(m.new_content).length, maxChars: paragraphs[m.paragraph_id!].maxChars }))
      .filter(v => v.visibleLen > v.maxChars);
    const dropViolators = (list: Modification[]) => {
      const bad = new Set(budgetViolations(list).map(v => v.paragraph_id));
      if (bad.size) addLog('SYSTEM', `↩️ Reverted ${bad.size} paragraph(s) to original text (budget could not be met).`);
      return list.filter(m => !bad.has(m.paragraph_id!));
    };
    const enrich = (list: Modification[]) => list.map(m => ({
      ...m,
      original_excerpt: paragraphs[m.paragraph_id!].text,
    }));
    const mergeRepair = (current: Modification[], repair: Modification[]) => {
      const merged = byId(current);
      sanitize(repair).forEach(m => merged.set(m.paragraph_id!, m));
      return [...merged.values()];
    };
    const analyzeLayout = async (buffer: ArrayBuffer, currentMods: Modification[]) => {
      const metrics = await measureDocxBuffer(buffer);
      const modMap = byId(currentMods);

      // Expected post-modification text per surviving paragraph (deletions skipped)
      const expected = paragraphs
        .filter(p => {
          const m = modMap.get(p.id);
          return !(m && m.new_content.trim() === '');
        })
        .map(p => ({
          id: p.id,
          text: modMap.has(p.id) ? visibleTextOf(modMap.get(p.id)!.new_content) : p.fullText,
        }));

      const align = alignToDom(expected, metrics);
      const offenders: EngineFindings['layoutOffenders'] = [];
      if (mapReliable && align.reliable) {
        for (const m of currentMods) {
          const id = m.paragraph_id!;
          if (m.new_content.trim() === '') continue;
          const orig = paragraphs[id].lines;
          const now = align.linesById.get(id);
          if (now != null && now > orig) {
            const curLen = visibleTextOf(m.new_content).length;
            offenders.push({
              paragraph_id: id,
              lines: now,
              originalLines: orig,
              targetChars: Math.max(40, Math.floor((curLen * orig) / now) - 6),
            });
          }
        }
      }

      // Exact, pagination-independent overflow signal: rendered content height.
      const heightDeltaLines = (metrics.contentHeight - baseHeight) / lineH;
      const overflow = heightDeltaLines > 0.6 || offenders.length > 0;
      return { pages: metrics.pages, heightDeltaLines, overflow, offenders };
    };
    const silentApply = async (list: Modification[]): Promise<ArrayBuffer> => {
      setIsDocUpdating(true);
      try {
        const { buffer } = await applyModificationsByIdToBuffer(originalFileBuffer.slice(0), list, lockedIds);
        setLiveDocBuffer(buffer);
        return buffer;
      } finally {
        setIsDocUpdating(false);
      }
    };
    const rescues = (list: Modification[]) => scoreTextAgainstKeywords(composeModifiedText(originalTexts, list), keywords);

    // ── 4 · Version 1.0 — ID-addressed write ────────────────────────────────
    const ackMsg = `Acknowledged. Writing Version 1.0 — ID-addressed, budget-locked…`;
    addLog(primaryName, ackMsg);
    await awaitTyping(ackMsg);
    if (cancelRef.current) return;

    setThinking({ agent: primaryName, action: 'Writing Version 1.0 (precision mode)…' });
    const v1 = await withRetry(
      () => tailorResumePrecision(wllm, paragraphs, jobDescription, keywords, {
        round: 'write',
        strategistNotes: reviewFeedback,
      }),
      primaryName
    );
    setThinking(null);
    if (cancelRef.current) return;

    let mods = sanitize(v1.modifications);

    // ── 5 · Code-side budget gate (pre-render) ──────────────────────────────
    const v1Violations = budgetViolations(mods);
    if (v1Violations.length) {
      addLog('SYSTEM', `⚠️ ${v1Violations.length} mod(s) exceed their hard budgets — engine findings sent back for repair.`);
      setThinking({ agent: primaryName, action: `Repairing ${v1Violations.length} over-budget paragraph(s)…` });
      const repair = await withRetry(
        () => tailorResumePrecision(wllm, paragraphs, jobDescription, keywords, {
          round: 'repair',
          previousModifications: mods,
          findings: { budgetViolations: v1Violations, layoutOffenders: [] },
        }),
        primaryName
      );
      setThinking(null);
      if (cancelRef.current) return;
      mods = dropViolators(mergeRepair(mods, repair.modifications));
    } else {
      mods = dropViolators(mods);
    }

    // ── 6 · Apply with live animation, then RENDER-VERIFY ───────────────────
    const v1Msg = `Version 1.0 complete — ${mods.length} modifications. Applying to your Word document one by one…`;
    addLog(primaryName, v1Msg);
    await awaitTyping(v1Msg);
    let buf = await applyModsSequentially(enrich(mods));
    if (cancelRef.current) return;
    if (!buf) throw new Error('Failed to apply modifications to the document.');

    let score = rescues(mods);
    setLiveAtsScore(score.score);

    addLog('SYSTEM', 'Rendering document for layout verification…');
    let check = await analyzeLayout(buf, mods);
    addLog('SYSTEM', `Render check: content ${check.heightDeltaLines >= 0 ? '+' : ''}${check.heightDeltaLines.toFixed(1)} line(s) vs original · ${check.offenders.length} paragraph(s) above original line count.`);

    // ── 7 · Layout repair loop (engine findings → targeted condense) ────────
    for (let round = 1; round <= 2 && !cancelRef.current; round++) {
      if (!check.overflow) break;

      addLog('SYSTEM', `⚠️ Layout repair round ${round}: content ${check.heightDeltaLines >= 0 ? '+' : ''}${check.heightDeltaLines.toFixed(1)} line(s) · ${check.offenders.length} offender(s). Engine findings sent back.`);
      setThinking({ agent: primaryName, action: 'Condensing measured overflow…' });
      const repair = await withRetry(
        () => tailorResumePrecision(wllm, paragraphs, jobDescription, keywords, {
          round: 'repair',
          previousModifications: mods,
          findings: {
            budgetViolations: [],
            layoutOffenders: check.offenders,
            pages: { current: check.pages, target: targetPages },
          },
        }),
        primaryName
      );
      setThinking(null);
      if (cancelRef.current) return;

      mods = dropViolators(mergeRepair(mods, repair.modifications));
      buf = await silentApply(enrich(mods));
      check = await analyzeLayout(buf, mods);
      addLog('SYSTEM', `Render re-check: content ${check.heightDeltaLines >= 0 ? '+' : ''}${check.heightDeltaLines.toFixed(1)} line(s) · ${check.offenders.length} offender(s).`);
    }

    // ── 8 · Deterministic layout guarantee — revert what cannot be fixed ────
    let guardRounds = 0;
    while (check.overflow && mods.length > 0 && guardRounds < 10) {
      guardRounds++;
      const revertIds = new Set<number>(check.offenders.map(o => o.paragraph_id));
      if (revertIds.size === 0) {
        // Height overflow without per-paragraph mapping — revert the largest growers.
        [...mods]
          .map(m => ({ id: m.paragraph_id!, growth: visibleTextOf(m.new_content).length - paragraphs[m.paragraph_id!].text.length }))
          .sort((a, b) => b.growth - a.growth)
          .slice(0, 3)
          .forEach(x => revertIds.add(x.id));
      }
      mods = mods.filter(m => !revertIds.has(m.paragraph_id!));
      buf = await silentApply(enrich(mods));
      check = await analyzeLayout(buf, mods);
      addLog('SYSTEM', `↩️ Layout guarantee: reverted ${revertIds.size} paragraph(s) → content ${check.heightDeltaLines >= 0 ? '+' : ''}${check.heightDeltaLines.toFixed(1)} line(s).`);
    }

    score = rescues(mods);
    setLiveAtsScore(score.score);

    // ── 9 · Coverage sweeps — place still-missing keywords, layout-gated ────
    for (let sweep = 1; sweep <= 2 && score.missing.length > 0 && !check.overflow && !cancelRef.current; sweep++) {
      addLog('SYSTEM', `Coverage sweep ${sweep}: ${score.missing.length} JD keyword(s) still unplaced → targeted refinement.`);
      setThinking({ agent: primaryName, action: `Placing ${score.missing.length} missing keyword(s)…` });
      const refine = await withRetry(
        () => tailorResumePrecision(wllm, paragraphs, jobDescription, keywords, {
          round: 'repair',
          previousModifications: mods,
          findings: {
            budgetViolations: [],
            layoutOffenders: [],
            pages: { current: check.pages, target: targetPages },
            missingKeywords: score.missing,
          },
        }),
        primaryName
      );
      setThinking(null);
      if (cancelRef.current) return;

      const candidate = dropViolators(mergeRepair(mods, refine.modifications));
      const newBuf = await silentApply(enrich(candidate));
      const newCheck = await analyzeLayout(newBuf, candidate);
      const newScore = rescues(candidate);
      if (!newCheck.overflow && newScore.score > score.score) {
        mods = candidate;
        buf = newBuf;
        check = newCheck;
        score = newScore;
        setLiveAtsScore(score.score);
        addLog('SYSTEM', `Coverage sweep ${sweep} verified clean → ${score.score}% measured.`);
      } else if (newCheck.overflow) {
        buf = await silentApply(enrich(mods)); // restore the verified version
        addLog('SYSTEM', `Coverage sweep ${sweep} would have broken layout (content +${newCheck.heightDeltaLines.toFixed(1)} line(s), ${newCheck.offenders.length} offender(s)) — kept the verified version.`);
        break;
      } else {
        buf = await silentApply(enrich(mods)); // no improvement — keep verified version
        addLog('SYSTEM', `Coverage sweep ${sweep} did not improve the measured score — kept the verified version.`);
        break;
      }
    }

    // ── 10 · Finalize with measured numbers ──────────────────────────────────
    const finalMods = enrich(mods);
    const data: TailoredResumeData = {
      agents: { primary: primaryName, auditor: reviewerName },
      ats: {
        score: score.score,
        measured: true,
        feedback:
          `Measured by deterministic keyword scan: ${score.matched.length}/${keywords.length} JD keywords present ` +
          `(weighted ${score.score}%, up from ${base.score}%). Layout render-verified: content height within ` +
          `${Math.abs(check.heightDeltaLines).toFixed(1)} line(s) of the original ${targetPages}-page document. ${v1.feedback}`.trim(),
        keywordMatch: score.matched,
        missingKeywords: score.missing,
      },
      modifications: finalMods,
    };

    setFinalBuffer(buf);
    setLiveDocBuffer(buf);

    const doneMsg = `FINAL — ${finalMods.length} modifications, every one verified.\nMeasured ATS coverage: ${base.score}% → ${score.score}%.\nLayout: render-verified, content within ${Math.abs(check.heightDeltaLines).toFixed(1)} line(s) of the original ${targetPages}-page layout.`;
    addLog(primaryName, doneMsg);
    await awaitTyping(doneMsg);
    addLog('SYSTEM', `🎉 Done! ${finalMods.length} modifications ready. Preparing download…`);
    await new Promise(r => setTimeout(r, 900));

    setTailoredData(data);
    setStep(Step.PREVIEW);
  };

  const handleTailorClick = async () => {
    if (!resumeText || !jobDescription.trim()) {
      setError('Please upload a resume and enter a Job Description.');
      return;
    }
    setError(null);
    setAgentLogs([]);
    setLiveAtsScore(0);
    setAppliedModCount(0);
    setTotalModCount(0);
    cancelRef.current = false;
    userScrolledUpRef.current = false;
    setFinalBuffer(null);
    setStep(Step.ANALYZING);
    if (originalFileBuffer) setLiveDocBuffer(originalFileBuffer.slice(0));

    try {
      // ── ALL writers route through the precision pipeline (ID protocol +
      // render-verified layout + measured ATS). The legacy excerpt flow below
      // is retained only as reference / emergency fallback.
      await runPrecisionPipeline();
      return;

      // eslint-disable-next-line no-unreachable
      let data: TailoredResumeData = { agents: {} as any, modifications: [] };
      const provider = settingsRef.current.activeProvider;

      // (legacy excerpt flow — unreachable; precision pipeline serves all writers)
      let primaryName  = providerLabel(provider);
      let reviewerName = 'DeepSeek V4 Pro';

      // Dynamic feedback model from settings
      const fbProvider = settingsRef.current.feedbackProvider || 'deepseek';
      reviewerName = providerLabel(fbProvider);

      // ── Helper: get the API key for a given provider ──
      const getApiKey = (p: string) => {
        if (p === 'openai')   return settingsRef.current.openaiApiKey;
        if (p === 'deepseek') return settingsRef.current.deepseekApiKey;
        if (p === 'gemini')   return settingsRef.current.geminiApiKey;
        if (p === 'claude')   return settingsRef.current.claudeApiKey;
        return '';
      };

      // ── Service routing (re-read settingsRef each call for mid-switch) ──
      const runPrimaryPlan = () => {
        const p = settingsRef.current.activeProvider;
        if (p === 'openai')   return createOptimizationPlan(resumeText, jobDescription, getApiKey('openai'));
        if (p === 'deepseek') return createOptimizationPlanDeepSeek(resumeText, jobDescription, getApiKey('deepseek'), reviewerName);
        if (p === 'claude')   return createOptimizationPlanClaude(resumeText, jobDescription, getApiKey('claude'));
        return createOptimizationPlanGemini(resumeText, jobDescription, getApiKey('gemini'));
      };

      const runReviewerPlan = () => {
        const fb = settingsRef.current.feedbackProvider || 'deepseek';
        if (fb === 'deepseek') return createOptimizationPlanDeepSeek(resumeText, jobDescription, getApiKey('deepseek'), primaryName);
        if (fb === 'openai')   return createOptimizationPlan(resumeText, jobDescription, getApiKey('openai'));
        if (fb === 'claude')   return createOptimizationPlanClaude(resumeText, jobDescription, getApiKey('claude'));
        return createOptimizationPlanGemini(resumeText, jobDescription, getApiKey('gemini'));
      };

      const runPrimaryTailor = (ctx?: any) => {
        const p = settingsRef.current.activeProvider;
        if (p === 'openai')   return tailorResumeOpenAI(resumeText, jobDescription, getApiKey('openai'), ctx);
        if (p === 'deepseek') return tailorResumeDeepSeek(resumeText, jobDescription, getApiKey('deepseek'), ctx);
        if (p === 'claude')   return tailorResumeClaude(resumeText, jobDescription, getApiKey('claude'), ctx);
        return tailorResumeGemini(resumeText, jobDescription, getApiKey('gemini'), ctx);
      };

      const runReviewerTailor = (ctx?: any) => {
        const fb = settingsRef.current.feedbackProvider || 'deepseek';
        if (fb === 'deepseek') return tailorResumeDeepSeek(resumeText, jobDescription, getApiKey('deepseek'), ctx);
        if (fb === 'openai')   return tailorResumeOpenAI(resumeText, jobDescription, getApiKey('openai'), ctx);
        if (fb === 'claude')   return tailorResumeClaude(resumeText, jobDescription, getApiKey('claude'), ctx);
        return tailorResumeGemini(resumeText, jobDescription, getApiKey('gemini'), ctx);
      };

      addLog('SYSTEM', `Dual-Agent Workspace ready. ${primaryName} ⇆ ${reviewerName} connected.`);
      await new Promise(r => setTimeout(r, 600));
      if (cancelRef.current) return;

      const introMsg = `I have fully read the resume and Job Description.\nPreparing a comprehensive optimization plan for maximum ATS impact.`;
      addLog(primaryName, introMsg);
      await awaitTyping(introMsg);
      if (cancelRef.current) return;

      setThinking({ agent: primaryName, action: 'Building optimization plan…' });
      const plan = await withRetry(runPrimaryPlan, primaryName);
      setThinking(null);
      if (cancelRef.current) return;

      const planMsg = `PROPOSED OPTIMIZATION PLAN:\n\n${plan}\n\n${reviewerName}, I'm about to apply these changes. Please review and give your critical feedback.`;
      addLog(primaryName, planMsg);
      await awaitTyping(planMsg);
      if (cancelRef.current) return;

      setThinking({ agent: reviewerName, action: 'Reviewing plan and cooking feedback…' });
      const reviewFeedback = await withRetry(runReviewerPlan, reviewerName);
      setThinking(null);
      if (cancelRef.current) return;

      const feedbackMsg = `REVIEW FEEDBACK:\n\n${reviewFeedback}`;
      addLog(reviewerName, feedbackMsg);
      await awaitTyping(feedbackMsg);
      if (cancelRef.current) return;

      const ackMsg = `Acknowledged. Integrating your feedback and writing Version 1.0…`;
      addLog(primaryName, ackMsg);
      await awaitTyping(ackMsg);
      if (cancelRef.current) return;

      setThinking({ agent: primaryName, action: 'Writing Version 1.0…' });
      data = await withRetry(
        () => runPrimaryTailor({ previousModifications: [], auditorFeedback: reviewFeedback, currentScore: 0 }),
        primaryName
      );
      setThinking(null);
      if (cancelRef.current) return;

      // ── Apply modifications one-by-one (token-by-token view) ──
      if (data.modifications?.length > 0) {
        const v1Msg = `Version 1.0 complete — ${data.modifications?.length ?? 0} modifications. Applying to your Word document one by one…`;
        addLog(primaryName, v1Msg);
        await awaitTyping(v1Msg);
        setLiveAtsScore(data.ats?.score ?? 82);
        await applyModsSequentially(data.modifications);
      }
      if (cancelRef.current) return;

      const doneV1Msg = `All ${data.modifications?.length ?? 0} modifications written into your Word document (highlighted yellow). Sending for audit…`;
      addLog(primaryName, doneV1Msg);
      await awaitTyping(doneV1Msg);
      if (cancelRef.current) return;

      setThinking({ agent: reviewerName, action: 'Auditing V1.0 and computing ATS delta…' });
      const atsResult = await withRetry(
        () => runReviewerTailor({ previousModifications: data.modifications, auditorFeedback: '', currentScore: data.ats?.score ?? 0 }),
        reviewerName
      );
      setThinking(null);
      if (cancelRef.current) return;

      const auditScore = atsResult.ats?.score ?? 90;
      setLiveAtsScore(auditScore);
      const auditMsg = `AUDIT REPORT v1.1\nATS Score: ${auditScore}%\n\n${atsResult.ats?.feedback ?? 'Looking strong!'}\n\nMissing keywords: ${(atsResult.ats?.missingKeywords ?? []).join(', ') || 'None'}`;
      addLog(reviewerName, auditMsg);
      await awaitTyping(auditMsg);
      if (cancelRef.current) return;

      const refineMsg = `Understood. Applying final refinements → Version 1.1 (FINAL)…`;
      addLog(primaryName, refineMsg);
      await awaitTyping(refineMsg);
      if (cancelRef.current) return;

      setThinking({ agent: primaryName, action: 'Finalizing Version 1.1…' });
      const finalData = await withRetry(
        () => runPrimaryTailor({
          previousModifications: data.modifications,
          // ✅ Strip any preamble lines Gemini/reviewer may have added before the actual feedback
          auditorFeedback: (atsResult.ats?.feedback ?? '')
            .split('\n')
            .filter(line => {
              const l = line.trim().toLowerCase();
              return !(
                l.startsWith('acknowledged') ||
                l.startsWith('audit report') ||
                l.startsWith('ats score:') ||
                l.startsWith('version ') ||
                l.startsWith('integrating your') ||
                l.startsWith('understood.')
              );
            })
            .join('\n')
            .trim(),
          currentScore: auditScore,
        }),
        primaryName
      );
      setThinking(null);
      if (cancelRef.current) return;

      if (finalData.modifications?.length > 0) {
        // ── Merge V1.1 into V1.0: remap original_excerpt to match the real .docx ──
        const v1Mods   = data.modifications ?? [];
        const v1_1Mods = finalData.modifications;
        const merged = mergeModifications(v1Mods, v1_1Mods);

        data = { ...finalData, modifications: merged };
        // Final pass — apply all merged mods at once
        await updateLiveDoc(data.modifications, true);
        setLiveAtsScore(finalData.ats?.score ?? auditScore);
      }

      const doneMsg = `Version 1.1 (FINAL) complete.\n${data.modifications?.length ?? 0} elite modifications live in your Word document.\nFinal ATS Score: ${data.ats?.score ?? auditScore}%`;
      addLog(primaryName, doneMsg);
      await awaitTyping(doneMsg);

      addLog('SYSTEM', 'Running page-overflow detection…');
      await new Promise(r => setTimeout(r, 500));

      const overflowReport = detectPageOverflow(data, resumeText);

      if (overflowReport.isOverflowing) {
        // ── AI-driven condensing pass — no dumb trimming ──
        addLog('SYSTEM', `⚠️ Overflow: +${overflowReport.overByChars} chars / +${overflowReport.overByLines} lines. Sending back to AI for intelligent condensing…`);
        await new Promise(r => setTimeout(r, 300));

        setThinking({ agent: primaryName, action: 'Condensing overflowing bullets…' });
        const condensedData = await withRetry(
          () => runPrimaryTailor({
            previousModifications: data.modifications,
            auditorFeedback: overflowReport.feedback,
            currentScore: data.ats?.score ?? auditScore,
          }),
          primaryName
        );
        setThinking(null);
        if (cancelRef.current) return;

        if (condensedData.modifications?.length > 0) {
          const prevMods = data.modifications ?? [];
          const condensedMerged = mergeModifications(prevMods, condensedData.modifications);
          data = { ...condensedData, modifications: condensedMerged };
          await updateLiveDoc(data.modifications, true);
          addLog('SYSTEM', `✅ AI condensed successfully. Verifying page fit…`);

          // Verify the condensing actually worked
          const recheck = detectPageOverflow(data, resumeText);
          if (recheck.isOverflowing) {
            addLog('SYSTEM', `⚠️ Still overflowing by ${recheck.overByChars} chars — minor overflow, proceeding. Check the final document.`);
          }
        }
      }

      // ── Re-sync live preview buffer with the final modifications ──
      // This ensures the preview exactly matches what the user downloads.
      if (data.modifications?.length > 0) {
        await updateLiveDoc(data.modifications, true);
      }

      addLog('SYSTEM', `🎉 Done! ${data.modifications?.length ?? 0} modifications ready. Preparing download…`);
      await new Promise(r => setTimeout(r, 1200));

      setTailoredData(data);
      setStep(Step.PREVIEW);
    } catch (err: any) {
      if (cancelRef.current) return; // Silently exit on cancel
      console.error(err);
      setError(err.message ?? 'Something went wrong.');
      addLog('SYSTEM', `CRITICAL ERROR: ${err.message}`);
    } finally {
      setThinking(null);
    }
  };

  const reset = () => {
    cancelRef.current = true;
    setStep(Step.UPLOAD);
    setTailoredData(null);
    setResumeText('');
    setOriginalFile(null);
    setOriginalFileBuffer(null);
    setLiveDocBuffer(null);
    setFinalBuffer(null);
    setJobDescription('');
    setError(null);
    setAgentLogs([]);
    setLiveAtsScore(0);
    setAppliedModCount(0);
    setTotalModCount(0);
    setTimeout(() => { cancelRef.current = false; }, 100);
  };

  // ── Available providers for mid-switch (exclude current) ──
  const getAlternativeProviders = () => {
    const current = settingsRef.current.activeProvider;
    return ALL_PROVIDERS
      .map(key => ({
        key,
        label: providerLabel(key),
        hasKey: !!(settingsRef.current as any)[apiKeyField(key)],
      }))
      .filter(p => p.key !== current && p.hasKey);
  };

  // ─── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-slate-50 text-slate-900" style={{ fontFamily: "'DM Sans', sans-serif" }}>
      <style>{GLOBAL_CSS}</style>
      <SettingsModal
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        settings={settings}
        onSave={handleSaveSettings}
      />

      {/* ── Header ────────────────────────────────────────────────────────── */}
      <header className="bg-white/80 backdrop-blur-xl border-b border-slate-200/60 sticky top-0 z-20 h-14 flex items-center">
        <div className="w-full max-w-7xl mx-auto px-4 flex items-center justify-between">
          <div className="flex items-center gap-2.5 cursor-pointer group" onClick={reset}>
            <div className="bg-gradient-to-br from-indigo-600 to-violet-600 p-1.5 rounded-lg shadow-sm group-hover:shadow-md transition-shadow">
              <Wand2 className="w-4 h-4 text-white" />
            </div>
            <h1 className="text-lg font-bold tracking-tight">
              ResuTailor<span className="bg-gradient-to-r from-indigo-600 to-violet-600 bg-clip-text text-transparent">.ai</span>
            </h1>
          </div>
          <div className="flex items-center gap-3">
            <span className="hidden sm:block text-[11px] font-semibold text-slate-400 bg-slate-100 px-3 py-1 rounded-full">
              {providerPairLabel(settings.activeProvider, settings.feedbackProvider)}
            </span>
            <button
              onClick={() => setIsSettingsOpen(true)}
              className="p-2 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-all"
            >
              <Settings className="w-4 h-4" />
            </button>
          </div>
        </div>
      </header>

      {/* ── UPLOAD / LANDING PAGE ─────────────────────────────────────────── */}
      {step === Step.UPLOAD && (
        <main className="animate-in fade-in slide-in-from-bottom-4 duration-500">
          {/* Hero Section */}
          <div className="relative overflow-hidden">
            {/* Background decoration */}
            <div className="absolute inset-0 bg-gradient-to-b from-indigo-50/80 via-white to-white pointer-events-none" />
            <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[800px] h-[400px] bg-gradient-to-r from-indigo-400/10 via-violet-400/10 to-fuchsia-400/10 rounded-full blur-3xl pointer-events-none" />

            <div className="relative max-w-5xl mx-auto px-4 pt-16 pb-12 text-center">
              {/* Badge */}
              <div className="inline-flex items-center gap-2 bg-white border border-slate-200 shadow-sm rounded-full px-4 py-1.5 mb-6">
                <span className="flex h-2 w-2 relative">
                  <span className="animate-ping absolute inline-flex h-2 w-2 rounded-full bg-green-400 opacity-75" />
                  <span className="relative inline-flex h-2 w-2 rounded-full bg-green-500" />
                </span>
                <span className="text-xs font-semibold text-slate-600">Dual-Agent AI System</span>
              </div>

              <h2 className="text-4xl md:text-5xl font-bold text-slate-900 mb-4 tracking-tight leading-[1.15]">
                Land more interviews with<br />
                <span className="bg-gradient-to-r from-indigo-600 via-violet-600 to-fuchsia-500 bg-clip-text text-transparent">
                  AI-optimized resumes
                </span>
              </h2>
              <p className="text-lg text-slate-500 max-w-2xl mx-auto mb-8 leading-relaxed">
                Two elite AI agents collaborate in real-time — rewriting your resume word-by-word,
                injecting ATS keywords, and maximizing your match score against any job description.
              </p>

              {/* Trust badges */}
              <div className="flex items-center justify-center gap-6 mb-12">
                {[
                  { icon: Shield, label: 'ATS-Optimized' },
                  { icon: Zap, label: 'Real-time Editing' },
                  { icon: Eye, label: 'Watch AI Work' },
                  { icon: Target, label: '98%+ Match Score' },
                ].map(({ icon: Icon, label }) => (
                  <div key={label} className="flex items-center gap-1.5 text-xs font-medium text-slate-500">
                    <Icon className="w-3.5 h-3.5 text-indigo-500" />
                    {label}
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Upload Cards */}
          <div className="max-w-4xl mx-auto px-4 pb-16">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* Upload box */}
              <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200 hover:border-indigo-200 hover:shadow-md transition-all">
                <div className="flex items-center gap-3 mb-5">
                  <div className="bg-gradient-to-br from-indigo-500 to-indigo-600 p-2.5 rounded-xl text-white shadow-sm">
                    <FileText className="w-5 h-5" />
                  </div>
                  <div>
                    <h3 className="font-bold text-base text-slate-800">Upload Resume</h3>
                    <p className="text-xs text-slate-400">.docx format only</p>
                  </div>
                </div>
                <FileUpload onFileProcessed={handleResumeProcessed} />
                {resumeText && (
                  <div className="mt-4 p-3 bg-green-50 border border-green-100 rounded-xl flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <CheckCircle2 className="w-4 h-4 text-green-500" />
                      <p className="text-xs text-green-700 font-medium truncate max-w-[200px]">
                        {originalFile?.name}
                      </p>
                    </div>
                    <button
                      onClick={() => { setResumeText(''); setOriginalFile(null); setLiveDocBuffer(null); }}
                      className="text-xs text-green-600 hover:text-green-800 font-medium"
                    >
                      Change
                    </button>
                  </div>
                )}
              </div>

              {/* Job description box */}
              <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200 hover:border-emerald-200 hover:shadow-md transition-all flex flex-col">
                <div className="flex items-center gap-3 mb-5">
                  <div className="bg-gradient-to-br from-emerald-500 to-emerald-600 p-2.5 rounded-xl text-white shadow-sm">
                    <Briefcase className="w-5 h-5" />
                  </div>
                  <div>
                    <h3 className="font-bold text-base text-slate-800">Job Description</h3>
                    <p className="text-xs text-slate-400">Paste the target JD</p>
                  </div>
                </div>
                <textarea
                  className="flex-1 w-full min-h-[200px] p-4 rounded-xl border border-slate-200 focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-400 outline-none text-sm leading-relaxed resize-none bg-slate-50/50 transition-all placeholder:text-slate-300"
                  placeholder="Paste the job description here…"
                  value={jobDescription}
                  onChange={e => setJobDescription(e.target.value)}
                />
              </div>
            </div>

            {error && (
              <p className="mt-4 text-center text-red-500 text-sm font-medium">{error}</p>
            )}

            {/* ── Writer & Feedback Model Selection ──────────────────────── */}
            <div className="mt-8 bg-white p-5 rounded-2xl shadow-sm border border-slate-200">
              <div className="flex items-center gap-2 mb-4">
                <BrainCircuit className="w-4 h-4 text-indigo-500" />
                <h3 className="font-bold text-sm text-slate-800">AI Model Configuration</h3>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* Writer model */}
                <div>
                  <label className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide mb-2 block">
                    ✍️ Writer Model
                  </label>
                  <div className="grid grid-cols-2 gap-2">
                    {([
                      { key: 'openai', label: 'GPT-5.5', icon: OPENAI_LOGO, ring: 'ring-emerald-400', bg: 'bg-emerald-50', text: 'text-emerald-700', hasKey: !!settings.openaiApiKey },
                      { key: 'deepseek', label: 'DeepSeek V4 Pro', icon: DEEPSEEK_LOGO, ring: 'ring-blue-400', bg: 'bg-blue-50', text: 'text-blue-700', hasKey: !!settings.deepseekApiKey },
                      { key: 'gemini', label: 'Gemini 3.1 Pro', icon: GEMINI_LOGO, ring: 'ring-violet-400', bg: 'bg-violet-50', text: 'text-violet-700', hasKey: !!settings.geminiApiKey },
                      { key: 'claude', label: 'Claude Sonnet 4.6', icon: CLAUDE_LOGO, ring: 'ring-amber-400', bg: 'bg-amber-50', text: 'text-amber-700', hasKey: !!settings.claudeApiKey },
                      { key: 'grok', label: 'Grok 4.3', icon: GROK_LOGO, ring: 'ring-slate-400', bg: 'bg-slate-100', text: 'text-slate-700', hasKey: !!settings.grokApiKey },
                    ] as const).map(m => (
                      <button
                        key={m.key}
                        onClick={() => {
                          const newSettings = { ...settings, activeProvider: m.key as any };
                          // Auto-adjust feedback if same as writer
                          if (newSettings.feedbackProvider === m.key) {
                            const fallback = ALL_PROVIDERS.find(k => k !== m.key && !!(settings as any)[apiKeyField(k)]);
                            newSettings.feedbackProvider = (fallback || 'deepseek') as any;
                          }
                          handleSaveSettings(newSettings);
                        }}
                        disabled={!m.hasKey}
                        className={`flex items-center gap-2 p-2.5 rounded-xl border-2 text-left transition-all ${
                          settings.activeProvider === m.key
                            ? `${m.bg} border-current ${m.text} ring-2 ${m.ring} shadow-sm`
                            : m.hasKey
                            ? 'border-slate-200 hover:border-slate-300 hover:bg-slate-50'
                            : 'border-slate-100 opacity-40 cursor-not-allowed'
                        }`}
                      >
                        <img src={m.icon} alt="" className="w-5 h-5 object-contain shrink-0" />
                        <div>
                          <span className="text-xs font-bold block leading-tight">{m.label}</span>
                          {!m.hasKey && <span className="text-[9px] text-slate-400">No API key</span>}
                        </div>
                      </button>
                    ))}
                  </div>
                </div>

                {/* Feedback model */}
                <div>
                  <label className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide mb-2 block">
                    🔍 Feedback / Auditor Model
                  </label>
                  <div className="grid grid-cols-2 gap-2">
                    {([
                      { key: 'openai', label: 'GPT-5.5', icon: OPENAI_LOGO, ring: 'ring-emerald-400', bg: 'bg-emerald-50', text: 'text-emerald-700', hasKey: !!settings.openaiApiKey },
                      { key: 'deepseek', label: 'DeepSeek V4 Pro', icon: DEEPSEEK_LOGO, ring: 'ring-blue-400', bg: 'bg-blue-50', text: 'text-blue-700', hasKey: !!settings.deepseekApiKey },
                      { key: 'gemini', label: 'Gemini 3.1 Pro', icon: GEMINI_LOGO, ring: 'ring-violet-400', bg: 'bg-violet-50', text: 'text-violet-700', hasKey: !!settings.geminiApiKey },
                      { key: 'claude', label: 'Claude Sonnet 4.6', icon: CLAUDE_LOGO, ring: 'ring-amber-400', bg: 'bg-amber-50', text: 'text-amber-700', hasKey: !!settings.claudeApiKey },
                      { key: 'grok', label: 'Grok 4.3', icon: GROK_LOGO, ring: 'ring-slate-400', bg: 'bg-slate-100', text: 'text-slate-700', hasKey: !!settings.grokApiKey },
                    ] as const).map(m => {
                      const isWriter = settings.activeProvider === m.key;
                      return (
                        <button
                          key={m.key}
                          onClick={() => {
                            if (!isWriter && m.hasKey) {
                              handleSaveSettings({ ...settings, feedbackProvider: m.key as any });
                            }
                          }}
                          disabled={!m.hasKey || isWriter}
                          className={`flex items-center gap-2 p-2.5 rounded-xl border-2 text-left transition-all ${
                            isWriter
                              ? 'border-slate-100 opacity-30 cursor-not-allowed bg-slate-50'
                              : settings.feedbackProvider === m.key
                              ? `${m.bg} border-current ${m.text} ring-2 ${m.ring} shadow-sm`
                              : m.hasKey
                              ? 'border-slate-200 hover:border-slate-300 hover:bg-slate-50'
                              : 'border-slate-100 opacity-40 cursor-not-allowed'
                          }`}
                        >
                          <img src={m.icon} alt="" className="w-5 h-5 object-contain shrink-0" />
                          <div>
                            <span className="text-xs font-bold block leading-tight">{m.label}</span>
                            {isWriter && <span className="text-[9px] text-slate-400">Writer</span>}
                            {!m.hasKey && !isWriter && <span className="text-[9px] text-slate-400">No API key</span>}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>
              <p className="mt-3 text-[10px] text-slate-400 text-center">
                Select a Writer to optimize your resume and a different Feedback model to audit & critique the results.
              </p>
            </div>

            <div className="mt-6 flex justify-center">
              <button
                onClick={handleTailorClick}
                disabled={!resumeText || !jobDescription}
                className={`group flex items-center gap-3 px-8 py-4 rounded-2xl font-bold text-lg shadow-lg transition-all transform ${
                  !resumeText || !jobDescription
                    ? 'bg-slate-200 text-slate-400 cursor-not-allowed shadow-none'
                    : 'bg-gradient-to-r from-indigo-600 to-violet-600 text-white hover:shadow-xl hover:scale-[1.02] active:scale-[0.98]'
                }`}
                style={resumeText && jobDescription ? { animation: 'pulseGlow 2s ease-in-out infinite' } : {}}
              >
                Start Elite Tailoring
                <ArrowRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
              </button>
            </div>

            {/* Feature cards */}
            <div className="mt-16 grid grid-cols-1 md:grid-cols-3 gap-5">
              {[
                {
                  icon: Cpu,
                  title: 'Dual-Agent System',
                  desc: 'Two AI models debate and refine your resume collaboratively — one writes, the other audits.',
                  color: 'indigo',
                },
                {
                  icon: FileText,
                  title: 'Word-Accurate Output',
                  desc: 'Edits are applied directly to your .docx file. Formatting, fonts, and layout stay perfect.',
                  color: 'emerald',
                },
                {
                  icon: Star,
                  title: 'ATS Score Tracking',
                  desc: 'Real-time keyword matching and scoring. Watch your match percentage climb live.',
                  color: 'amber',
                },
              ].map(({ icon: Icon, title, desc, color }) => (
                <div key={title} className="bg-white rounded-2xl p-5 border border-slate-200 hover:border-slate-300 hover:shadow-sm transition-all">
                  <div className={`w-10 h-10 rounded-xl flex items-center justify-center mb-3 ${
                    color === 'indigo' ? 'bg-indigo-100 text-indigo-600' :
                    color === 'emerald' ? 'bg-emerald-100 text-emerald-600' :
                    'bg-amber-100 text-amber-600'
                  }`}>
                    <Icon className="w-5 h-5" />
                  </div>
                  <h4 className="font-bold text-sm text-slate-800 mb-1">{title}</h4>
                  <p className="text-xs text-slate-500 leading-relaxed">{desc}</p>
                </div>
              ))}
            </div>
          </div>
        </main>
      )}

      {/* ── ANALYZING STEP ─────────────────────────────────────────────────── */}
      {step === Step.ANALYZING && (
        <div className="fixed inset-0 top-14 z-10 bg-slate-100 flex flex-col overflow-hidden">
          {/* Toolbar */}
          <div className="bg-white border-b border-slate-200 px-4 py-2 flex items-center justify-between shrink-0 shadow-sm">
            <div className="flex items-center gap-3">
              {/* ── Dashboard button ── */}
              <button
                onClick={handleBackToDashboard}
                className="flex items-center gap-1.5 text-[11px] font-semibold text-slate-500 hover:text-indigo-600 bg-slate-100 hover:bg-indigo-50 px-3 py-1.5 rounded-lg transition-all"
                title="Back to Dashboard"
              >
                <ArrowLeft className="w-3 h-3" />
                Dashboard
              </button>
              <div className="w-px h-5 bg-slate-200" />
              <div className="bg-indigo-100 p-1.5 rounded-lg">
                <BrainCircuit className="w-3.5 h-3.5 text-indigo-600 animate-pulse" />
              </div>
              <div>
                <p className="text-[11px] font-bold text-slate-800 flex items-center gap-1.5">
                  Live AI Workspace
                  <span className="flex h-1.5 w-1.5 relative">
                    <span className="animate-ping absolute inline-flex h-1.5 w-1.5 rounded-full bg-indigo-400 opacity-75" />
                    <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-indigo-500" />
                  </span>
                </p>
                <p className="text-[10px] text-slate-400 font-medium">{progressText}</p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              {/* Mod progress indicator */}
              {totalModCount > 0 && (
                <div className="hidden sm:flex items-center gap-2 bg-amber-50 border border-amber-200 text-amber-700 px-3 py-1 rounded-full text-[10px] font-semibold">
                  <Wand2 className="w-3 h-3" />
                  {appliedModCount}/{totalModCount} mods applied
                </div>
              )}
              <div className="hidden sm:flex items-center gap-1.5 bg-blue-50 border border-blue-200 text-blue-700 px-3 py-1 rounded-full text-[10px] font-semibold">
                <FileText className="w-3 h-3" />
                Word-accurate
              </div>
              <div className="flex flex-col items-end">
                <span className="text-[9px] font-bold text-slate-400 uppercase tracking-wide">ATS</span>
                <span className={`text-lg font-black leading-none ${
                  liveAtsScore >= 95 ? 'text-green-600' : liveAtsScore >= 80 ? 'text-indigo-600' : 'text-amber-500'
                }`}>
                  {liveAtsScore > 0 ? `${liveAtsScore}%` : '—'}
                </span>
              </div>
              <div className="w-20 h-1.5 bg-slate-200 rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all duration-1000 ${
                    liveAtsScore >= 95 ? 'bg-green-500' : liveAtsScore >= 80 ? 'bg-indigo-500' : 'bg-amber-400'
                  }`}
                  style={{ width: `${liveAtsScore > 0 ? liveAtsScore : 5}%` }}
                />
              </div>
            </div>
          </div>

          {/* Main workspace */}
          <div className="flex-1 flex overflow-hidden">
            {/* Left — Live document */}
            <div className="w-[58%] border-r border-slate-200 flex flex-col bg-slate-200/70">
              <div className="bg-white/80 backdrop-blur px-4 py-2 border-b border-slate-200 flex items-center gap-2 shrink-0">
                <FileText className="w-3.5 h-3.5 text-slate-400" />
                <span className="text-[11px] font-bold text-slate-500 uppercase tracking-widest">
                  Live Document — Word Format
                </span>
                {isDocUpdating && (
                  <span className="ml-2 flex items-center gap-1 text-[11px] text-indigo-500 font-medium">
                    <Loader2 className="w-3 h-3 animate-spin" />Updating…
                  </span>
                )}
                <span className="ml-auto text-[11px] text-slate-400 font-medium">
                  Changes in{' '}
                  <span className="bg-yellow-200 text-yellow-800 px-1 rounded font-semibold">yellow</span>
                </span>
              </div>
              <div className="flex-1 overflow-y-auto">
                {liveModifications.length > 0 ? (
                  <SmoothDocumentPreview originalText={resumeText} modifications={liveModifications} />
                ) : (
                  <DocxPreviewPane buffer={liveDocBuffer} isUpdating={isDocUpdating} />
                )}
              </div>
            </div>

            {/* Right — AI collaboration chat (COMPACT) */}
            <div className="w-[42%] bg-white flex flex-col">
              <div className="bg-white px-4 py-2 border-b border-slate-100 flex items-center gap-2 shrink-0">
                <Sparkles className="w-3.5 h-3.5 text-indigo-500" />
                <span className="text-xs font-bold text-slate-800">AI Collaboration</span>
                <span className="ml-auto text-[10px] text-slate-400 font-medium">
                  {agentLogs.length} messages
                </span>
              </div>

              {/* ── Scrollable chat area with scroll tracking ── */}
              <div
                ref={logsContainerRef}
                onScroll={handleLogsScroll}
                className="flex-1 overflow-y-auto p-3 space-y-2.5 bg-slate-50/80"
              >
                {agentLogs.length === 0 && !thinking && (
                  <div className="flex flex-col items-center justify-center h-32 text-slate-400 gap-2">
                    <Loader2 className="w-5 h-5 animate-spin text-indigo-400" />
                    <p className="text-xs font-medium">Connecting agents…</p>
                  </div>
                )}

                {agentLogs.map(log => {
                  if (log.agent === 'SYSTEM') return (
                    <div key={log.id} className="flex justify-center msg-enter">
                      <div className="bg-slate-100 border border-slate-200 text-slate-500 px-2.5 py-1 rounded-full text-[10px] font-medium flex items-center gap-1.5">
                        <Info className="w-2.5 h-2.5 text-indigo-400" />{log.message}
                      </div>
                    </div>
                  );
                  return (
                    <div key={log.id} className="msg-enter">
                      {/* ── COMPACT message card ── */}
                      <div className="bg-white border border-slate-200/80 rounded-xl shadow-sm hover:shadow transition-shadow">
                        <div className={`flex items-center gap-2 px-3 py-1.5 rounded-t-xl border-b border-slate-100/80 ${agentBg(log.agent)}`}>
                          <div className="w-5 h-5 rounded-full flex items-center justify-center bg-white/70 border border-white/80 shadow-sm">
                            {agentIcon(log.agent)}
                          </div>
                          <span className={`text-[10px] font-bold ${agentText(log.agent)}`}>{log.agent}</span>
                          <span className="ml-auto text-[9px] text-slate-400 font-medium">
                            {log.ts.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                          </span>
                        </div>
                        <div className="px-3 py-2">
                          <TypewriterText text={log.message} speed={10} />
                        </div>
                      </div>
                    </div>
                  );
                })}

                {/* Thinking indicator (compact) */}
                {thinking && (
                  <div className="msg-enter">
                    <div className="bg-white border border-indigo-100 rounded-xl shadow-sm">
                      <div className={`flex items-center gap-2 px-3 py-1.5 rounded-t-xl border-b border-slate-100/80 ${agentBg(thinking.agent)}`}>
                        <div className="w-5 h-5 rounded-full flex items-center justify-center bg-white/70 border border-white/80 shadow-sm">
                          {agentIcon(thinking.agent)}
                        </div>
                        <span className={`text-[10px] font-bold ${agentText(thinking.agent)}`}>{thinking.agent}</span>
                        <span className="ml-auto text-[9px] bg-indigo-100 text-indigo-500 px-2 py-0.5 rounded-full font-semibold">
                          Live
                        </span>
                      </div>
                      <div className="px-3 py-2 flex items-center gap-2 text-slate-500 text-[11px]">
                        <div className="flex gap-1">
                          {[0, 1, 2].map(i => (
                            <span
                              key={i}
                              className="w-1.5 h-1.5 bg-indigo-400 rounded-full animate-bounce"
                              style={{ animationDelay: `${i * 0.15}s` }}
                            />
                          ))}
                        </div>
                        <span className="font-medium">{thinking.action}</span>
                      </div>
                    </div>
                  </div>
                )}

                {/* ── Retry prompt with MODEL SWITCH option ── */}
                {retryPrompt && (
                  <div className="msg-enter bg-red-50 border border-red-200 rounded-xl p-3 space-y-2.5">
                    <div className="flex items-center gap-2 text-red-600">
                      <AlertOctagon className="w-3.5 h-3.5" />
                      <span className="text-[11px] font-bold">Process Paused</span>
                    </div>
                    <p className="text-[11px] text-red-600/80">{retryPrompt.message}</p>

                    {/* Switch model buttons */}
                    {getAlternativeProviders().length > 0 && (
                      <div className="space-y-1.5">
                        <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-wide flex items-center gap-1">
                          <Shuffle className="w-3 h-3" /> Switch model & continue
                        </p>
                        <div className="flex gap-1.5">
                          {getAlternativeProviders().map(p => (
                            <button
                              key={p.key}
                              onClick={() => handleSwitchProvider(p.key)}
                              className="flex-1 py-1.5 bg-indigo-50 border border-indigo-200 text-indigo-700 rounded-lg text-[10px] font-semibold hover:bg-indigo-100 transition-colors flex items-center justify-center gap-1"
                            >
                              <Shuffle className="w-3 h-3" />
                              {p.label}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}

                    <div className="flex gap-2 pt-1">
                      <button
                        onClick={() => retryPrompt.reject(new Error('Cancelled'))}
                        className="flex-1 py-1.5 bg-white border border-slate-200 text-slate-600 rounded-lg text-[11px] font-semibold hover:bg-slate-50"
                      >
                        Cancel
                      </button>
                      <button
                        onClick={retryPrompt.resolve}
                        className="flex-1 py-1.5 bg-red-500 text-white rounded-lg text-[11px] font-semibold hover:bg-red-600 flex items-center justify-center gap-1"
                      >
                        <RefreshCw className="w-3 h-3" /> Retry Same
                      </button>
                    </div>
                  </div>
                )}

                <div ref={logsEndRef} />
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── PREVIEW STEP ───────────────────────────────────────────────────── */}
      {step === Step.PREVIEW && tailoredData && (
        <main className="max-w-7xl mx-auto px-4 py-8 animate-in fade-in duration-500">
          <div className="mb-6">
            <button
              onClick={reset}
              className="flex items-center gap-2 text-slate-500 hover:text-slate-800 font-medium text-sm"
            >
              <Undo className="w-4 h-4" />Make Another Resume
            </button>
          </div>
          <ResumePreview
            data={tailoredData}
            originalFile={originalFile}
            originalFileBuffer={originalFileBuffer}
            originalText={resumeText}
            finalBuffer={finalBuffer}
          />
        </main>
      )}
    </div>
  );
};

export default App;