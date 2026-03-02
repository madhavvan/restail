import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Step, TailoredResumeData, AppSettings } from './types';
import FileUpload from './components/FileUpload';
import ResumePreview from './components/ResumePreview';
import SettingsModal from './components/SettingsModal';
import { tailorResumeOpenAI, createOptimizationPlan } from './services/openaiService';
import { tailorResumeDeepSeek, createOptimizationPlanDeepSeek } from './services/deepseekService';
import { tailorResumeGemini, createOptimizationPlanGemini } from './services/geminiService';
import { applyModificationsToBuffer } from './services/documentService';
import ReactMarkdown from 'react-markdown';
import {
  FileText, Briefcase, Wand2, ArrowRight, Settings, Undo,
  BrainCircuit, Sparkles, Info, Loader2, AlertOctagon, RefreshCw,
} from 'lucide-react';

// ─── docx-preview — loaded as a proper ES module via esm.sh ─────────────────
// Dynamic import() works perfectly where UMD <script> tags fail, because the
// module exports are resolved at import time — no window global needed at all.
const DOCX_PREVIEW_CSS_URL = 'https://cdn.jsdelivr.net/npm/docx-preview@0.3.3/dist/docx-preview.min.css';

let _docxPreviewPromise: Promise<{ renderAsync: Function }> | null = null;

const loadDocxPreview = (): Promise<{ renderAsync: Function }> => {
  if (_docxPreviewPromise) return _docxPreviewPromise;

  // Inject CSS once (the JS module doesn't inject it automatically)
  if (!document.querySelector(`link[href="${DOCX_PREVIEW_CSS_URL}"]`)) {
    const link = document.createElement('link');
    link.rel  = 'stylesheet';
    link.href = DOCX_PREVIEW_CSS_URL;
    document.head.appendChild(link);
  }

  // Dynamic ES module import — no UMD global, no race condition
  _docxPreviewPromise = (import('https://esm.sh/docx-preview@0.3.3') as Promise<any>)
    .then(mod => {
      const renderAsync = mod.renderAsync ?? mod.default?.renderAsync;
      if (typeof renderAsync !== 'function')
        throw new Error('docx-preview: renderAsync not found in ES module exports');
      return { renderAsync: renderAsync.bind(mod.default ?? mod) };
    })
    .catch(err => {
      _docxPreviewPromise = null; // allow retry
      throw err;
    });

  return _docxPreviewPromise;
};

// ─── Global CSS ───────────────────────────────────────────────────────────────
const GLOBAL_CSS = `
@keyframes fadeSlideUp {
  from { opacity:0; transform:translateY(8px); }
  to   { opacity:1; transform:translateY(0);   }
}
.msg-enter { animation: fadeSlideUp 0.3s ease forwards; }

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

/* Word yellow-highlight runs pulse so AI edits are obvious */
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

  // Pre-warm the ES module import on mount so it's ready before the buffer arrives
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

    // Clear previous render before drawing the new one
    if (containerRef.current) containerRef.current.innerHTML = '';

    loadDocxPreview()
      .then(({ renderAsync }) => {
        if (!containerRef.current) return;
        // renderAsync expects a Blob (or ArrayBuffer) + the container DOM node
        return renderAsync(
          new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }),
          containerRef.current,
          undefined,   // styleContainer — undefined = inject into document <head>
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

      {/* Updating overlay */}
      {isUpdating && (
        <div className="absolute inset-0 z-10 bg-white/60 backdrop-blur-sm flex items-center justify-center pointer-events-none">
          <div className="flex items-center gap-2 bg-white border border-indigo-200 shadow-lg rounded-full px-4 py-2">
            <Loader2 className="w-4 h-4 animate-spin text-indigo-500" />
            <span className="text-xs font-semibold text-indigo-700">Applying modifications…</span>
          </div>
        </div>
      )}

      {/* Library loading spinner — shown until ES module is ready */}
      {isLibLoading && (
        <div className="flex flex-col items-center justify-center h-full text-slate-400 gap-3 py-20">
          <Loader2 className="w-6 h-6 animate-spin text-indigo-400" />
          <p className="text-sm font-medium">Loading document renderer…</p>
        </div>
      )}

      {/* Error state */}
      {renderError && !isLibLoading && (
        <div className="p-6 text-red-500 text-sm font-medium text-center">
          <AlertOctagon className="w-6 h-6 mx-auto mb-2" />
          <p className="font-semibold mb-1">Preview unavailable</p>
          <p className="text-xs text-red-400">{renderError}</p>
        </div>
      )}

      {/* Empty state */}
      {!buffer && !renderError && !isLibLoading && (
        <div className="flex flex-col items-center justify-center h-full text-slate-400 gap-3 py-20">
          <FileText className="w-10 h-10 opacity-30" />
          <p className="text-sm font-medium">Upload a .docx file to preview it here</p>
        </div>
      )}

      {/* docx-preview renders directly into this div */}
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
  activeProvider: 'openai',
};

// ─── TypewriterText ───────────────────────────────────────────────────────────
const TypewriterText: React.FC<{ text: string; speed?: number }> = ({ text, speed = 12 }) => {
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

  useEffect(() => {
    const el = boxRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [displayed]);

  return (
    <div
      ref={boxRef}
      className="overflow-y-auto pr-1 text-slate-700 text-[13px] leading-relaxed [&_p]:mb-2 [&_p:last-child]:mb-0 [&_ul]:list-disc [&_ul]:pl-5 [&_ul]:mb-2 [&_strong]:text-slate-900 [&_strong]:font-semibold [&_code]:bg-slate-100 [&_code]:px-1 [&_code]:rounded [&_code]:text-indigo-600 [&_code]:font-mono [&_code]:text-[11px]"
      style={{ maxHeight: 220 }}
    >
      <ReactMarkdown>{displayed}</ReactMarkdown>
    </div>
  );
};

// ─── Agent assets ─────────────────────────────────────────────────────────────
const OPENAI_LOGO   = 'https://upload.wikimedia.org/wikipedia/commons/0/04/ChatGPT_logo.svg';
const DEEPSEEK_LOGO = `data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><circle cx='50' cy='50' r='45' fill='%234d6bfe'/><path d='M30 65 Q50 20 70 65' stroke='white' stroke-width='8' fill='none' stroke-linecap='round'/><circle cx='50' cy='68' r='6' fill='white'/></svg>`;
const GEMINI_LOGO   = 'https://upload.wikimedia.org/wikipedia/commons/8/8a/Google_Gemini_logo.svg';

const agentIcon = (name: string) => {
  if (name.includes('GPT'))      return <img src={OPENAI_LOGO}   alt="GPT"    className="w-5 h-5 object-contain" />;
  if (name.includes('DeepSeek')) return <img src={DEEPSEEK_LOGO} alt="DS"     className="w-5 h-5 object-contain" />;
  return                                <img src={GEMINI_LOGO}   alt="Gemini" className="w-5 h-5 object-contain" />;
};
const agentBg   = (n: string) => n.includes('GPT') ? 'bg-emerald-50'   : n.includes('DeepSeek') ? 'bg-blue-50'   : 'bg-violet-50';
const agentText = (n: string) => n.includes('GPT') ? 'text-emerald-700' : n.includes('DeepSeek') ? 'text-blue-700' : 'text-violet-700';

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
  const [isDocUpdating, setIsDocUpdating]       = useState(false);

  const [agentLogs, setAgentLogs] = useState<Array<{ id: string; agent: string; message: string; ts: Date }>>([]);
  const [thinking, setThinking]   = useState<{ agent: string; action: string } | null>(null);
  const [retryPrompt, setRetryPrompt] = useState<{ message: string; resolve: () => void; reject: (e: Error) => void } | null>(null);
  const [progressText, setProgressText] = useState('Initializing…');
  const [liveAtsScore, setLiveAtsScore] = useState(0);
  const logsEndRef = useRef<HTMLDivElement>(null);

  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [settings, setSettings]             = useState<AppSettings>(DEFAULT_SETTINGS);
  const settingsRef                         = useRef<AppSettings>(DEFAULT_SETTINGS);

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

  // Auto-scroll agent log
  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [agentLogs, thinking]);

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
    new Promise<void>(r => setTimeout(r, Math.ceil((text.length / 4) * 12) + 600));

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

  const updateLiveDoc = async (mods: any[]) => {
    if (!originalFileBuffer || !mods?.length) return;
    setIsDocUpdating(true);
    try {
      const newBuf = await applyModificationsToBuffer(originalFileBuffer.slice(0), mods);
      setLiveDocBuffer(newBuf);
    } catch (e) {
      console.error('Live doc update failed:', e);
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

  const enforcePageLimit = (data: TailoredResumeData, originalText: string): TailoredResumeData => {
    // Use the ORIGINAL document's own line count and char count as the ceiling.
    const originalLines = originalText.split('\n').length;
    const originalChars = originalText.length;

    const draft        = constructDraft(originalText, data.modifications ?? []);
    const currentLines = draft.split('\n').length;
    const currentChars = draft.length;

    // Within original bounds — nothing to do
    if (currentLines <= originalLines && currentChars <= originalChars) {
      addLog('SYSTEM', `✅ Page fit perfect (${currentLines}/${originalLines} lines)`);
      return data;
    }

    const overByChars = currentChars - originalChars;
    addLog('SYSTEM', `🔒 Page overflow by ~${overByChars} chars / ${currentLines - originalLines} lines. Surgical trim…`);

    // ── Surgical trim: shorten mods that GREW, smallest trim first ───────────
    // Goal: reduce total char count by exactly `overByChars` while keeping
    // content quality as high as possible. We trim the mods that grew the most,
    // cutting just a few words at a time until we're back within bounds.
    let mods = (data.modifications ?? []).map(m => ({ ...m }));

    // Sort descending by growth so we trim the biggest offender first
    const byGrowth = [...mods]
      .map((m, i) => ({
        idx: i,
        growth: (m.new_content?.replace(/\*\*([^*]+)\*\*/g, '$1').length ?? 0)
               - (m.original_excerpt?.length ?? 0),
      }))
      .filter(x => x.growth > 0)
      .sort((a, b) => b.growth - a.growth);

    let remaining = overByChars;
    for (const { idx } of byGrowth) {
      if (remaining <= 0) break;
      const mod      = mods[idx];
      const origLen  = (mod.original_excerpt || '').length;
      const stripped = (mod.new_content || '').replace(/\*\*([^*]+)\*\*/g, '$1');

      // Trim back toward original length — but never below it (no gaps)
      const targetLen = Math.max(origLen, stripped.length - remaining);
      if (targetLen >= stripped.length) continue;

      const trimmed   = stripped.substring(0, targetLen);
      const lastSpace = trimmed.lastIndexOf(' ');
      const final     = lastSpace > targetLen * 0.7
        ? trimmed.substring(0, lastSpace).trimEnd()
        : trimmed.trimEnd();

      const saved      = stripped.length - final.length;
      remaining       -= saved;
      mods[idx]        = { ...mod, new_content: final };
    }

    const finalDraft = constructDraft(originalText, mods);
    const finalLines = finalDraft.split('\n').length;
    addLog('SYSTEM', `✅ Page fit after trim: ${finalLines}/${originalLines} lines (trimmed ${overByChars - Math.max(0, remaining)} chars)`);
    return { ...data, modifications: mods };
  };

  async function withRetry<T>(op: () => Promise<T>, name: string): Promise<T> {
    let attempts = 0;
    while (true) {
      try {
        return await op();
      } catch (err: any) {
        attempts++;
        const isRate = err?.status === 429 || /quota|rate.?limit|too.?many/i.test(err?.message ?? '');
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

  const handleTailorClick = async () => {
    if (!resumeText || !jobDescription.trim()) {
      setError('Please upload a resume and enter a Job Description.');
      return;
    }
    setError(null);
    setAgentLogs([]);
    setLiveAtsScore(0);
    setStep(Step.ANALYZING);
    if (originalFileBuffer) setLiveDocBuffer(originalFileBuffer.slice(0));

    try {
      let data: TailoredResumeData = { agents: {} as any, modifications: [] };
      const provider = settingsRef.current.activeProvider;

      // ── Agent name assignment ──────────────────────────────────────────────
      let primaryName  = 'GPT-5.2';
      let reviewerName = 'DeepSeek-V3.2';
      if (provider === 'deepseek') {
        primaryName  = 'DeepSeek-V3.2';
        reviewerName = 'GPT-5.2';
      } else if (provider === 'gemini') {
        primaryName  = 'Gemini 3.1 Pro';
        reviewerName = 'DeepSeek-V3.2';
      }

      // ── Service routing ───────────────────────────────────────────────────
      const runPrimaryPlan = () =>
        provider === 'openai'
          ? createOptimizationPlan(resumeText, jobDescription, settingsRef.current.openaiApiKey)
          : provider === 'deepseek'
          ? createOptimizationPlanDeepSeek(resumeText, jobDescription, settingsRef.current.deepseekApiKey)
          : createOptimizationPlanGemini(resumeText, jobDescription, settingsRef.current.geminiApiKey);

      const runReviewerPlan = () =>
        provider === 'openai'
          ? createOptimizationPlanDeepSeek(resumeText, jobDescription, settingsRef.current.deepseekApiKey)
          : createOptimizationPlan(resumeText, jobDescription, settingsRef.current.openaiApiKey);

      const runPrimaryTailor = (ctx?: any) =>
        provider === 'openai'
          ? tailorResumeOpenAI(resumeText, jobDescription, settingsRef.current.openaiApiKey, ctx)
          : provider === 'deepseek'
          ? tailorResumeDeepSeek(resumeText, jobDescription, settingsRef.current.deepseekApiKey, ctx)
          : tailorResumeGemini(resumeText, jobDescription, settingsRef.current.geminiApiKey, ctx);

      const runReviewerTailor = (ctx?: any) =>
        provider === 'openai'
          ? tailorResumeDeepSeek(resumeText, jobDescription, settingsRef.current.deepseekApiKey, ctx)
          : tailorResumeOpenAI(resumeText, jobDescription, settingsRef.current.openaiApiKey, ctx);

      // ── Workflow ──────────────────────────────────────────────────────────
      addLog('SYSTEM', `Dual-Agent Workspace ready. ${primaryName} ⇆ ${reviewerName} connected.`);
      await new Promise(r => setTimeout(r, 600));

      const introMsg = `I have fully read the resume and Job Description.\nPreparing a comprehensive optimization plan for maximum ATS impact.`;
      addLog(primaryName, introMsg);
      await awaitTyping(introMsg);

      setThinking({ agent: primaryName, action: 'Building optimization plan…' });
      const plan = await withRetry(runPrimaryPlan, primaryName);
      setThinking(null);

      const planMsg = `PROPOSED OPTIMIZATION PLAN:\n\n${plan}\n\n${reviewerName}, I'm about to apply these changes. Please review and give your critical feedback.`;
      addLog(primaryName, planMsg);
      await awaitTyping(planMsg);

      setThinking({ agent: reviewerName, action: 'Reviewing plan and cooking feedback…' });
      const reviewFeedback = await withRetry(runReviewerPlan, reviewerName);
      setThinking(null);

      const feedbackMsg = `REVIEW FEEDBACK:\n\n${reviewFeedback}`;
      addLog(reviewerName, feedbackMsg);
      await awaitTyping(feedbackMsg);

      const ackMsg = `Acknowledged. Integrating your feedback and writing Version 1.0…`;
      addLog(primaryName, ackMsg);
      await awaitTyping(ackMsg);

      setThinking({ agent: primaryName, action: 'Writing Version 1.0…' });
      data = await withRetry(
        () => runPrimaryTailor({ previousModifications: [], auditorFeedback: reviewFeedback, currentScore: 0 }),
        primaryName
      );
      setThinking(null);

      if (data.modifications?.length > 0) {
        await updateLiveDoc(data.modifications);
        setLiveAtsScore(data.ats?.score ?? 82);
      }

      const v1Msg = `Version 1.0 complete — ${data.modifications?.length ?? 0} modifications written directly into your Word document (highlighted yellow on the left). Sending for audit…`;
      addLog(primaryName, v1Msg);
      await awaitTyping(v1Msg);

      setThinking({ agent: reviewerName, action: 'Auditing V1.0 and computing ATS delta…' });
      const atsResult = await withRetry(
        () => runReviewerTailor({ previousModifications: data.modifications, auditorFeedback: '', currentScore: data.ats?.score ?? 0 }),
        reviewerName
      );
      setThinking(null);

      const auditScore = atsResult.ats?.score ?? 90;
      setLiveAtsScore(auditScore);
      const auditMsg = `AUDIT REPORT v1.1\nATS Score: ${auditScore}%\n\n${atsResult.ats?.feedback ?? 'Looking strong!'}\n\nMissing keywords: ${(atsResult.ats?.missingKeywords ?? []).join(', ') || 'None'}`;
      addLog(reviewerName, auditMsg);
      await awaitTyping(auditMsg);

      const refineMsg = `Understood. Applying final refinements → Version 1.1 (FINAL)…`;
      addLog(primaryName, refineMsg);
      await awaitTyping(refineMsg);

      setThinking({ agent: primaryName, action: 'Finalizing Version 1.1…' });
      const finalData = await withRetry(
        () => runPrimaryTailor({ previousModifications: data.modifications, auditorFeedback: atsResult.ats?.feedback ?? '', currentScore: auditScore }),
        primaryName
      );
      setThinking(null);

      if (finalData.modifications?.length > 0) {
        data = finalData;
        await updateLiveDoc(data.modifications);
        setLiveAtsScore(finalData.ats?.score ?? auditScore);
      }

      const doneMsg = `Version 1.1 (FINAL) complete.\n${data.modifications?.length ?? 0} elite modifications live in your Word document.\nFinal ATS Score: ${data.ats?.score ?? auditScore}%`;
      addLog(primaryName, doneMsg);
      await awaitTyping(doneMsg);

      addLog('SYSTEM', 'Running final page-limit check…');
      await new Promise(r => setTimeout(r, 500));
      data = enforcePageLimit(data, resumeText);
      addLog('SYSTEM', `🎉 Done! ${data.modifications?.length ?? 0} modifications ready. Preparing download…`);
      await new Promise(r => setTimeout(r, 1200));

      setTailoredData(data);
      setStep(Step.PREVIEW);
    } catch (err: any) {
      console.error(err);
      setError(err.message ?? 'Something went wrong.');
      addLog('SYSTEM', `CRITICAL ERROR: ${err.message}`);
    } finally {
      setThinking(null);
    }
  };

  const reset = () => {
    setStep(Step.UPLOAD);
    setTailoredData(null);
    setResumeText('');
    setOriginalFile(null);
    setOriginalFileBuffer(null);
    setLiveDocBuffer(null);
    setJobDescription('');
    setError(null);
    setAgentLogs([]);
    setLiveAtsScore(0);
  };

  // ─── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 font-sans">
      <style>{GLOBAL_CSS}</style>
      <SettingsModal
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        settings={settings}
        onSave={handleSaveSettings}
      />

      {/* Header */}
      <header className="bg-white border-b border-slate-200 sticky top-0 z-20 h-14 flex items-center">
        <div className="w-full max-w-7xl mx-auto px-4 flex items-center justify-between">
          <div className="flex items-center gap-2 cursor-pointer" onClick={reset}>
            <div className="bg-indigo-600 p-1.5 rounded-lg">
              <Wand2 className="w-4 h-4 text-white" />
            </div>
            <h1 className="text-lg font-bold tracking-tight">
              ResuTailor<span className="text-indigo-600">.ai</span>
            </h1>
          </div>
          <div className="flex items-center gap-3">
            <span className="hidden sm:block text-xs font-semibold text-slate-500">
              {settings.activeProvider === 'openai'
                ? 'GPT-5.2 ⇆ DeepSeek-V3.2'
                : settings.activeProvider === 'deepseek'
                ? 'DeepSeek-V3.2 ⇆ GPT-5.2'
                : 'Gemini 3.1 Pro ⇆ GPT-5.2'}
            </span>
            <button
              onClick={() => setIsSettingsOpen(true)}
              className="p-2 text-slate-500 hover:text-indigo-600 hover:bg-slate-100 rounded-lg transition-all"
            >
              <Settings className="w-4 h-4" />
            </button>
          </div>
        </div>
      </header>

      {/* ── UPLOAD STEP ────────────────────────────────────────────────────── */}
      {step === Step.UPLOAD && (
        <main className="max-w-4xl mx-auto px-4 py-10 animate-in fade-in slide-in-from-bottom-4 duration-500">
          <div className="text-center mb-10">
            <h2 className="text-3xl font-bold text-slate-900 mb-3">
              Tailor your resume for any job in seconds
            </h2>
            <p className="text-lg text-slate-500">
              Two AI specialists collaborate live — watch your real Word document get rewritten.
            </p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            {/* Upload box */}
            <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200">
              <div className="flex items-center gap-2 mb-4">
                <div className="bg-indigo-100 p-2 rounded-lg">
                  <FileText className="w-5 h-5 text-indigo-600" />
                </div>
                <h3 className="font-semibold text-lg">1. Upload Resume (.docx)</h3>
              </div>
              <FileUpload onFileProcessed={handleResumeProcessed} />
              {resumeText && (
                <div className="mt-4 p-3 bg-green-50 border border-green-100 rounded-lg flex items-center justify-between">
                  <p className="text-xs text-green-700 font-medium truncate max-w-[200px]">
                    {originalFile?.name}
                  </p>
                  <button
                    onClick={() => { setResumeText(''); setOriginalFile(null); setLiveDocBuffer(null); }}
                    className="text-xs text-green-600 hover:text-green-800 underline"
                  >
                    Change
                  </button>
                </div>
              )}
            </div>

            {/* Job description box */}
            <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200 flex flex-col">
              <div className="flex items-center gap-2 mb-4">
                <div className="bg-emerald-100 p-2 rounded-lg">
                  <Briefcase className="w-5 h-5 text-emerald-600" />
                </div>
                <h3 className="font-semibold text-lg">2. Job Description</h3>
              </div>
              <textarea
                className="flex-1 w-full min-h-[200px] p-4 rounded-xl border border-slate-300 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none text-sm leading-relaxed resize-none bg-slate-50 transition-all"
                placeholder="Paste the job description here…"
                value={jobDescription}
                onChange={e => setJobDescription(e.target.value)}
              />
            </div>
          </div>

          {error && (
            <p className="mt-4 text-center text-red-500 text-sm font-medium">{error}</p>
          )}

          <div className="mt-8 flex justify-center">
            <button
              onClick={handleTailorClick}
              disabled={!resumeText || !jobDescription}
              className={`flex items-center gap-3 px-8 py-4 rounded-full font-bold text-lg shadow-lg transition-all transform ${
                !resumeText || !jobDescription
                  ? 'bg-slate-200 text-slate-400 cursor-not-allowed'
                  : 'bg-indigo-600 text-white hover:bg-indigo-700 hover:scale-105'
              }`}
            >
              Start Elite Tailoring <ArrowRight className="w-5 h-5" />
            </button>
          </div>
        </main>
      )}

      {/* ── ANALYZING STEP ─────────────────────────────────────────────────── */}
      {step === Step.ANALYZING && (
        <div className="fixed inset-0 top-14 z-10 bg-slate-100 flex flex-col overflow-hidden">
          {/* Toolbar */}
          <div className="bg-white border-b border-slate-200 px-5 py-2.5 flex items-center justify-between shrink-0 shadow-sm">
            <div className="flex items-center gap-3">
              <div className="bg-indigo-100 p-1.5 rounded-lg">
                <BrainCircuit className="w-4 h-4 text-indigo-600 animate-pulse" />
              </div>
              <div>
                <p className="text-xs font-bold text-slate-800 flex items-center gap-1.5">
                  Live AI Workspace
                  <span className="flex h-2 w-2 relative">
                    <span className="animate-ping absolute inline-flex h-2 w-2 rounded-full bg-indigo-400 opacity-75" />
                    <span className="relative inline-flex h-2 w-2 rounded-full bg-indigo-500" />
                  </span>
                </p>
                <p className="text-[11px] text-slate-400 font-medium">{progressText}</p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <div className="hidden sm:flex items-center gap-1.5 bg-blue-50 border border-blue-200 text-blue-700 px-3 py-1 rounded-full text-[11px] font-semibold">
                <FileText className="w-3 h-3" />
                Word-accurate rendering
              </div>
              <div className="flex flex-col items-end">
                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wide">ATS Score</span>
                <span className={`text-xl font-black leading-none ${
                  liveAtsScore >= 95 ? 'text-green-600' : liveAtsScore >= 80 ? 'text-indigo-600' : 'text-amber-500'
                }`}>
                  {liveAtsScore > 0 ? `${liveAtsScore}%` : '—'}
                </span>
              </div>
              <div className="w-24 h-2 bg-slate-200 rounded-full overflow-hidden">
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
                <DocxPreviewPane buffer={liveDocBuffer} isUpdating={isDocUpdating} />
              </div>
            </div>

            {/* Right — AI collaboration chat */}
            <div className="w-[42%] bg-white flex flex-col">
              <div className="bg-white px-4 py-2.5 border-b border-slate-100 flex items-center gap-2 shrink-0">
                <Sparkles className="w-4 h-4 text-indigo-500" />
                <span className="text-sm font-bold text-slate-800">AI Collaboration</span>
                <span className="ml-auto text-[11px] text-slate-400 font-medium">
                  {agentLogs.length} messages
                </span>
              </div>
              <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-slate-50/80">
                {agentLogs.length === 0 && !thinking && (
                  <div className="flex flex-col items-center justify-center h-40 text-slate-400 gap-3">
                    <Loader2 className="w-6 h-6 animate-spin text-indigo-400" />
                    <p className="text-sm font-medium">Connecting agents…</p>
                  </div>
                )}

                {agentLogs.map(log => {
                  if (log.agent === 'SYSTEM') return (
                    <div key={log.id} className="flex justify-center msg-enter">
                      <div className="bg-slate-100 border border-slate-200 text-slate-500 px-3 py-1.5 rounded-full text-[11px] font-medium flex items-center gap-1.5">
                        <Info className="w-3 h-3 text-indigo-400" />{log.message}
                      </div>
                    </div>
                  );
                  return (
                    <div key={log.id} className="msg-enter">
                      <div className="bg-white border border-slate-200 rounded-2xl shadow-sm hover:shadow-md transition-shadow">
                        <div className={`flex items-center gap-2.5 px-4 py-2.5 rounded-t-2xl border-b border-slate-100 ${agentBg(log.agent)}`}>
                          <div className="w-7 h-7 rounded-full flex items-center justify-center bg-white/70 border border-white/80 shadow-sm">
                            {agentIcon(log.agent)}
                          </div>
                          <span className={`text-xs font-bold ${agentText(log.agent)}`}>{log.agent}</span>
                          <span className="ml-auto text-[10px] text-slate-400 font-medium">
                            {log.ts.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                          </span>
                        </div>
                        <div className="px-4 py-3">
                          <TypewriterText text={log.message} speed={12} />
                        </div>
                      </div>
                    </div>
                  );
                })}

                {/* Thinking indicator */}
                {thinking && (
                  <div className="msg-enter">
                    <div className="bg-white border border-indigo-100 rounded-2xl shadow-sm">
                      <div className={`flex items-center gap-2.5 px-4 py-2.5 rounded-t-2xl border-b border-slate-100 ${agentBg(thinking.agent)}`}>
                        <div className="w-7 h-7 rounded-full flex items-center justify-center bg-white/70 border border-white/80 shadow-sm">
                          {agentIcon(thinking.agent)}
                        </div>
                        <span className={`text-xs font-bold ${agentText(thinking.agent)}`}>{thinking.agent}</span>
                        <span className="ml-auto text-[10px] bg-indigo-100 text-indigo-500 px-2 py-0.5 rounded-full font-semibold">
                          Live
                        </span>
                      </div>
                      <div className="px-4 py-3 flex items-center gap-2.5 text-slate-500 text-[13px]">
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

                {/* Retry prompt */}
                {retryPrompt && (
                  <div className="msg-enter bg-red-50 border border-red-200 rounded-xl p-4 space-y-3">
                    <div className="flex items-center gap-2 text-red-600">
                      <AlertOctagon className="w-4 h-4" />
                      <span className="text-xs font-bold">Process Paused</span>
                    </div>
                    <p className="text-xs text-red-600/80">{retryPrompt.message}</p>
                    <div className="flex gap-2">
                      <button
                        onClick={() => retryPrompt.reject(new Error('Cancelled'))}
                        className="flex-1 py-1.5 bg-white border border-slate-200 text-slate-600 rounded-lg text-xs font-semibold hover:bg-slate-50"
                      >
                        Cancel
                      </button>
                      <button
                        onClick={retryPrompt.resolve}
                        className="flex-1 py-1.5 bg-red-500 text-white rounded-lg text-xs font-semibold hover:bg-red-600 flex items-center justify-center gap-1"
                      >
                        <RefreshCw className="w-3 h-3" /> Retry
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
          />
        </main>
      )}
    </div>
  );
};

export default App;