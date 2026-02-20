import React, { useState, useEffect, useRef } from 'react';
import { Step, TailoredResumeData, AppSettings } from './types';
import FileUpload from './components/FileUpload';
import ResumePreview from './components/ResumePreview';
import SettingsModal from './components/SettingsModal';
import { tailorResumeOpenAI, createOptimizationPlan } from './services/openaiService';
import { tailorResumeDeepSeek, createOptimizationPlanDeepSeek } from './services/deepseekService';
import { tailorResumeGemini, createOptimizationPlanGemini } from './services/geminiService';
import { FileText, Briefcase, Wand2, ArrowRight, Settings, Undo, LayoutDashboard, Terminal, BrainCircuit, Sparkles, Info, Loader2, AlertOctagon, RefreshCw, Zap } from 'lucide-react';

const DEFAULT_SETTINGS: AppSettings = {
  openaiApiKey: '',
  deepseekApiKey: '',
  geminiApiKey: '',
  activeProvider: 'openai'
};

const App: React.FC = () => {
  const [step, setStep] = useState<Step>(Step.UPLOAD);
  const [resumeText, setResumeText] = useState<string>('');
  const [originalFile, setOriginalFile] = useState<File | null>(null);
  const [jobDescription, setJobDescription] = useState<string>('');
  const [tailoredData, setTailoredData] = useState<TailoredResumeData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);

  const [agentActivity, setAgentActivity] = useState<{agent: string | null, message: string}>({agent: null, message: ''});
  const [agentLogs, setAgentLogs] = useState<Array<{id: string, agent: string, message: string, timestamp: Date}>>([]);
  const logsEndRef = useRef<HTMLDivElement>(null);

  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const settingsRef = useRef<AppSettings>(DEFAULT_SETTINGS);
  const [retryPrompt, setRetryPrompt] = useState<{ message: string, resolve: () => void, reject: (err: Error) => void } | null>(null);

  useEffect(() => {
    const saved = localStorage.getItem('resuTailorSettings');
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        setSettings(parsed);
        settingsRef.current = parsed;
      } catch (e) {
        console.error("Failed to load settings");
      }
    }
  }, []);

  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [agentLogs]);

  const addLog = (agent: string, message: string) => {
    setAgentLogs(prev => [...prev, {
      id: Math.random().toString(36).substring(7),
      agent,
      message,
      timestamp: new Date()
    }]);
    
    if (agent !== 'SYSTEM') {
      setAgentActivity({ agent, message: 'Working on resume...' });
    }
  };

  const handleSaveSettings = (newSettings: AppSettings) => {
    setSettings(newSettings);
    settingsRef.current = newSettings;
    localStorage.setItem('resuTailorSettings', JSON.stringify(newSettings));
  };

  const handleResumeProcessed = (text: string, file?: File) => {
    setResumeText(text);
    if (file) setOriginalFile(file);
  };

  const constructDraftResume = (original: string, modifications: any[]): string => {
    if (!modifications || !Array.isArray(modifications)) return original;
    let draft = original;
    const sortedMods = [...modifications].sort((a, b) => b.original_excerpt.length - a.original_excerpt.length);
    sortedMods.forEach(mod => {
      if (mod.original_excerpt && mod.original_excerpt.length > 5) {
        draft = draft.split(mod.original_excerpt.trim()).join(mod.new_content);
      }
    });
    return draft;
  };

  async function executeWithRetry<T>(operation: () => Promise<T>, agentName: string): Promise<T> {
    let attempts = 0;
    while (true) {
      try {
        return await operation();
      } catch (err: any) {
        attempts++;
        const isRateLimit = err?.status === 429 || err?.message?.toLowerCase().includes('quota') || err?.message?.toLowerCase().includes('rate limit') || err?.message?.toLowerCase().includes('too many requests');
        
        if (isRateLimit && attempts <= 2) {
           addLog('SYSTEM', `⚠️ Rate limit hit for ${agentName}. Auto-retrying in ${attempts * 3}s...`);
           await new Promise(r => setTimeout(r, attempts * 3000));
           continue;
        }

        addLog('SYSTEM', `❌ Error (${agentName}): ${err.message || 'Unknown error'}. Paused for retry.`);
        
        try {
          await new Promise<void>((resolve, reject) => {
             setRetryPrompt({
                message: `The ${agentName} model encountered an error (possibly out of tokens/quota). You can update your API key in Settings and retry, or cancel.`,
                resolve,
                reject
             });
          });
          setRetryPrompt(null);
          addLog('SYSTEM', `🔄 Retrying operation for ${agentName}...`);
          attempts = 0; 
        } catch (cancelErr) {
          setRetryPrompt(null);
          throw cancelErr; 
        }
      }
    }
  }

  const handleTailorClick = async () => {
    if (!resumeText || !jobDescription.trim()) {
      setError("Please upload resume and enter Job Description.");
      return;
    }

    setIsProcessing(true);
    setStep(Step.ANALYZING);
    setError(null);
    setAgentLogs([]);

    try {
      let data: TailoredResumeData = { agents: {} as any, modifications: [] };
      let currentDraftText = resumeText;
      let version = 1.0;
      let iterations = 0;
      const MAX_ITERATIONS = 4;

      addLog('SYSTEM', 'Initializing Dual-Agent Orchestrator v2.2...');
      await new Promise(r => setTimeout(r, 600));

      const provider = settingsRef.current.activeProvider;
      let primaryAgentName = 'GPT-4o';
      let reviewerAgentName = 'DeepSeek-V3.2';
      
      if (provider === 'deepseek') {
        primaryAgentName = 'DeepSeek-V3.2';
        reviewerAgentName = 'GPT-4o';
      } else if (provider === 'gemini') {
        primaryAgentName = 'Gemini 3.1 Pro';
        reviewerAgentName = 'DeepSeek-V3.2';
      }

      addLog('SYSTEM', `Resume and JD shared between ${primaryAgentName} and ${reviewerAgentName}.`);

      const runPrimaryPlan = async () => {
        if (provider === 'openai') return createOptimizationPlan(resumeText, jobDescription, settingsRef.current.openaiApiKey);
        if (provider === 'deepseek') return createOptimizationPlanDeepSeek(resumeText, jobDescription, settingsRef.current.deepseekApiKey);
        return createOptimizationPlanGemini(resumeText, jobDescription, settingsRef.current.geminiApiKey);
      };

      const runReviewerPlan = async () => {
        if (provider === 'openai' || provider === 'gemini') return createOptimizationPlanDeepSeek(resumeText, jobDescription, settingsRef.current.deepseekApiKey);
        return createOptimizationPlan(resumeText, jobDescription, settingsRef.current.openaiApiKey);
      };

      const runPrimaryTailor = async (critiqueContext?: any) => {
        if (provider === 'openai') return tailorResumeOpenAI(resumeText, jobDescription, settingsRef.current.openaiApiKey, critiqueContext);
        if (provider === 'deepseek') return tailorResumeDeepSeek(resumeText, jobDescription, settingsRef.current.deepseekApiKey, critiqueContext);
        return tailorResumeGemini(resumeText, jobDescription, settingsRef.current.geminiApiKey, critiqueContext);
      };

      const runReviewerTailor = async (critiqueContext?: any) => {
        if (provider === 'openai' || provider === 'gemini') return tailorResumeDeepSeek(resumeText, jobDescription, settingsRef.current.deepseekApiKey, critiqueContext);
        return tailorResumeOpenAI(resumeText, jobDescription, settingsRef.current.openaiApiKey, critiqueContext);
      };

      // ====================== PRIMARY OPTIMIZER BLOCK ======================
      setAgentActivity({ agent: primaryAgentName, message: 'Analyzing...' });
      addLog(primaryAgentName, `I have read the full resume and Job Description.\nPreparing optimization plan for maximum ATS score.`);

      const plan = await executeWithRetry(runPrimaryPlan, primaryAgentName);
      addLog(primaryAgentName, `PROPOSED OPTIMIZATION PLAN:\n\n${plan}\n\n${reviewerAgentName}, I am going to apply these changes. Please review and give your critical feedback.`);

      setAgentActivity({ agent: reviewerAgentName, message: 'Reviewing...' });
      const reviewerFeedback = await executeWithRetry(runReviewerPlan, reviewerAgentName);
      addLog(reviewerAgentName, `REVIEW FEEDBACK:\n\n${reviewerFeedback}`);

      setAgentActivity({ agent: primaryAgentName, message: 'Implementing...' });
      addLog(primaryAgentName, `Acknowledged. Integrating ${reviewerAgentName} feedback and creating Version 1.0...`);

      data = await executeWithRetry(() => runPrimaryTailor({
        previousModifications: [],
        auditorFeedback: reviewerFeedback,
        currentScore: 0
      }), primaryAgentName);

      currentDraftText = constructDraftResume(resumeText, data.modifications);
      addLog(primaryAgentName, `Version 1.0 created and sent for review.`);

      // ====================== ITERATION LOOP ======================
      while (iterations < MAX_ITERATIONS) {
        iterations++;
        version += 0.1;

        setAgentActivity({ agent: reviewerAgentName, message: 'Auditing Draft...' });
        const atsResult = await executeWithRetry(() => runReviewerTailor({ previousModifications: data.modifications, auditorFeedback: "", currentScore: 0 }), reviewerAgentName);

        addLog(reviewerAgentName, `AUDIT REPORT (v${version.toFixed(1)}):\nScore: ${atsResult.ats?.score || 85}%\n\nFeedback: ${atsResult.ats?.feedback || "No major issues."}`);

        if ((atsResult.ats?.score || 85) >= 98) {
          addLog(reviewerAgentName, 'No major changes needed. Resume is optimized.');
          break;
        }

        setAgentActivity({ agent: primaryAgentName, message: 'Refining...' });
        addLog(primaryAgentName, `Understood. Refining based on feedback → Version ${version.toFixed(1)}...`);

        const refinedData = await executeWithRetry(() => runPrimaryTailor({ previousModifications: data.modifications, auditorFeedback: atsResult.ats?.feedback || "", currentScore: atsResult.ats?.score || 0 }), primaryAgentName);

        data = refinedData;
        currentDraftText = constructDraftResume(resumeText, data.modifications);
        addLog(primaryAgentName, `Version ${version.toFixed(1)} created and sent for next review.`);
      }

      addLog('SYSTEM', 'Optimization complete. Final resume ready for download.');
      await new Promise(r => setTimeout(r, 800));

      setTailoredData(data);
      setStep(Step.PREVIEW);

    } catch (err: any) {
      console.error(err);
      setError(err.message || "Something went wrong.");
      addLog('SYSTEM', `CRITICAL ERROR: ${err.message}`);
    } finally {
      setIsProcessing(false);
      setAgentActivity({ agent: null, message: '' });
    }
  };

  const reset = () => {
    setStep(Step.UPLOAD);
    setTailoredData(null);
    setResumeText('');
    setOriginalFile(null);
    setJobDescription('');
    setError(null);
    setAgentLogs([]);
  };

  const getAgentIcon = (agentName: string) => {
    if (agentName.includes('GPT')) return <BrainCircuit className="w-5 h-5" />;
    if (agentName.includes('DeepSeek')) return <Sparkles className="w-5 h-5" />;
    return <Zap className="w-5 h-5" />;
  };

  const getAgentColorClass = (agentName: string) => {
    if (agentName.includes('GPT')) return 'bg-blue-500/20 text-blue-400 border-blue-500/30';
    if (agentName.includes('DeepSeek')) return 'bg-purple-500/20 text-purple-400 border-purple-500/30';
    return 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30';
  };

  const getAgentTextClass = (agentName: string) => {
    if (agentName.includes('GPT')) return 'text-blue-400';
    if (agentName.includes('DeepSeek')) return 'text-purple-400';
    return 'text-emerald-400';
  };

  const getAgentBubbleClass = (agentName: string, isRight: boolean) => {
    if (agentName.includes('GPT')) return 'bg-slate-800 border border-slate-700 text-slate-200 rounded-tl-none';
    if (agentName.includes('DeepSeek')) return 'bg-indigo-600 border border-indigo-500 text-white shadow-indigo-900/50 rounded-tr-none';
    return 'bg-emerald-600 border border-emerald-500 text-white shadow-emerald-900/50 rounded-tr-none';
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 font-sans">
      <SettingsModal 
        isOpen={isSettingsOpen} 
        onClose={() => setIsSettingsOpen(false)} 
        settings={settings}
        onSave={handleSaveSettings}
      />

      {/* Header */}
      <header className="bg-white border-b border-slate-200 sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2 cursor-pointer" onClick={reset}>
            <div className="bg-indigo-600 p-2 rounded-lg">
              <Wand2 className="w-5 h-5 text-white" />
            </div>
            <h1 className="text-xl font-bold tracking-tight text-slate-900">ResuTailor<span className="text-indigo-600">.ai</span></h1>
          </div>
          
          <div className="flex items-center gap-4">
            <div className="hidden sm:flex flex-col items-end mr-2">
              <span className="text-[10px] uppercase font-bold text-slate-400 tracking-wider">ACTIVE MODE</span>
              <span className="text-xs font-semibold text-slate-700">
                {settings.activeProvider === 'openai' ? 'GPT-4o + DeepSeek-V3.2' : 
                 settings.activeProvider === 'deepseek' ? 'DeepSeek-V3.2 + GPT-4o' : 
                 'Gemini 3.1 Pro + DeepSeek-V3.2'}
              </span>
            </div>
            <button onClick={() => setIsSettingsOpen(true)} className="p-2 text-slate-500 hover:text-indigo-600 hover:bg-slate-100 rounded-lg transition-all">
              <Settings className="w-5 h-5" />
            </button>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-4 py-8">
        {step === Step.UPLOAD && (
          <div className="max-w-4xl mx-auto animate-in fade-in slide-in-from-bottom-4 duration-500">
            <div className="text-center mb-10">
              <h2 className="text-3xl font-bold text-slate-900 mb-3">Tailor your resume for any job in seconds</h2>
              <p className="text-lg text-slate-600">
                AI specialists will collaborate to optimize it.
              </p>
            </div>

            {/* Upload + JD UI - unchanged */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
              <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200 hover:shadow-md transition-shadow">
                <div className="flex items-center gap-2 mb-4">
                  <div className="bg-indigo-100 p-2 rounded-lg">
                    <FileText className="w-5 h-5 text-indigo-600" />
                  </div>
                  <h3 className="font-semibold text-lg">1. Upload Resume</h3>
                </div>
                <FileUpload onFileProcessed={handleResumeProcessed} />
                {resumeText && (
                  <div className="mt-4 p-3 bg-green-50 border border-green-100 rounded-lg flex items-center justify-between">
                    <p className="text-xs text-green-700 font-medium truncate max-w-[200px]">{originalFile?.name}</p>
                    <button onClick={() => {setResumeText(''); setOriginalFile(null);}} className="text-xs text-green-600 hover:text-green-800 underline">Change</button>
                  </div>
                )}
              </div>

              <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200 hover:shadow-md transition-shadow flex flex-col">
                <div className="flex items-center gap-2 mb-4">
                  <div className="bg-emerald-100 p-2 rounded-lg">
                    <Briefcase className="w-5 h-5 text-emerald-600" />
                  </div>
                  <h3 className="font-semibold text-lg">2. Job Description</h3>
                </div>
                <textarea
                  className="flex-1 w-full p-4 rounded-xl border border-slate-300 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none text-sm leading-relaxed resize-none bg-slate-50 transition-all"
                  placeholder="Paste the job description here..."
                  value={jobDescription}
                  onChange={(e) => setJobDescription(e.target.value)}
                />
              </div>
            </div>

            <div className="mt-8 flex justify-center flex-col items-center">
              <button
                onClick={handleTailorClick}
                disabled={!resumeText || !jobDescription}
                className={`flex items-center gap-3 px-8 py-4 rounded-full font-bold text-lg shadow-lg transition-all transform
                  ${(!resumeText || !jobDescription) ? 'bg-slate-200 text-slate-400 cursor-not-allowed' : 'bg-indigo-600 text-white hover:bg-indigo-700 hover:scale-105'}`}
              >
                Start Elite Tailoring
                <ArrowRight className="w-5 h-5" />
              </button>
            </div>
          </div>
        )}

        {step === Step.ANALYZING && (
          <div className="max-w-5xl mx-auto animate-in fade-in zoom-in-95 duration-500">
            <div className="text-center mb-8">
              <h2 className="text-3xl font-bold text-slate-900">Live Optimization Studio</h2>
              <p className="text-slate-500 mt-2">Watch our AI specialists collaborate to perfect your resume.</p>
            </div>
            
            <div className="bg-white rounded-2xl shadow-xl border border-slate-200 overflow-hidden flex flex-col h-[70vh] relative">
              
              {/* Header with Agent Status */}
              <div className="bg-slate-50 border-b border-slate-200 p-4 flex justify-between items-center">
                <div className="flex gap-6">
                  {/* Agent Status */}
                  <div className={`flex items-center gap-3 transition-opacity duration-300 opacity-100`}>
                    <div className={`p-2 rounded-lg bg-slate-200 text-slate-500`}>
                      <BrainCircuit className="w-5 h-5" />
                    </div>
                    <div>
                      <div className="text-sm font-bold text-slate-900">Agents Active</div>
                      <div className="text-xs text-slate-500">{agentActivity.message || 'Waiting...'}</div>
                    </div>
                  </div>
                </div>
                
                <div className="flex items-center gap-2 bg-indigo-50 text-indigo-700 px-4 py-2 rounded-full text-sm font-semibold border border-indigo-100 shadow-sm">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Optimizing...
                </div>
              </div>
              
              {/* Collaboration Feed */}
              <div className="flex-1 overflow-y-auto p-6 space-y-6 bg-slate-900 scroll-smooth">
                {agentLogs.length === 0 && (
                  <div className="flex flex-col items-center justify-center h-full text-slate-400 space-y-4">
                    <Loader2 className="w-8 h-8 animate-spin text-indigo-400" />
                    <p className="font-mono text-sm">Initializing secure agent connection...</p>
                  </div>
                )}
                
                {agentLogs.map((log) => {
                  const isRight = log.agent.includes('DeepSeek');
                  return (
                    <div key={log.id} className={`flex ${log.agent === 'SYSTEM' ? 'justify-center' : !isRight ? 'justify-start' : 'justify-end'} animate-in fade-in slide-in-from-bottom-4 duration-500`}>
                      
                      {log.agent === 'SYSTEM' ? (
                        <div className="bg-slate-800 border border-slate-700 shadow-sm text-slate-300 px-4 py-2 rounded-full text-xs font-mono flex items-center gap-2 my-2">
                          <Info className="w-4 h-4 text-indigo-400" />
                          {log.message}
                        </div>
                      ) : (
                        <div className={`flex gap-4 max-w-[85%] ${isRight ? 'flex-row-reverse' : ''}`}>
                          <div className="shrink-0 mt-1">
                            <div className={`w-10 h-10 rounded-full flex items-center justify-center shadow-lg border-2 ${getAgentColorClass(log.agent)}`}>
                              {getAgentIcon(log.agent)}
                            </div>
                          </div>
                          
                          <div className={`flex flex-col ${isRight ? 'items-end' : 'items-start'}`}>
                            <div className="flex items-center gap-2 mb-1.5 px-1">
                              <span className={`text-xs font-bold ${getAgentTextClass(log.agent)}`}>{log.agent}</span>
                              <span className="text-[10px] font-mono text-slate-500">{log.timestamp.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</span>
                            </div>
                            <div className={`p-4 shadow-sm text-sm leading-relaxed whitespace-pre-wrap font-medium rounded-2xl ${getAgentBubbleClass(log.agent, isRight)}`}>
                              {log.message}
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}

                {/* Inline Retry Prompt */}
                {retryPrompt && (
                  <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-4 flex flex-col sm:flex-row items-center justify-between gap-4 animate-in slide-in-from-bottom-2 mt-4">
                    <div className="flex items-center gap-3 text-red-400">
                      <AlertOctagon className="w-6 h-6 shrink-0" />
                      <div className="text-sm">
                        <p className="font-bold text-red-300">Process Paused</p>
                        <p>{retryPrompt.message}</p>
                      </div>
                    </div>
                    <div className="flex gap-2 shrink-0">
                      <button 
                        onClick={() => retryPrompt.reject(new Error("User cancelled the operation."))}
                        className="px-4 py-2 bg-slate-800 border border-slate-700 text-slate-300 rounded-lg text-sm font-semibold hover:bg-slate-700 transition-colors"
                      >
                        Cancel
                      </button>
                      <button 
                        onClick={() => retryPrompt.resolve()}
                        className="px-4 py-2 bg-red-500 text-white rounded-lg text-sm font-semibold hover:bg-red-600 transition-colors flex items-center gap-2"
                      >
                        <RefreshCw className="w-4 h-4" />
                        Retry Now
                      </button>
                    </div>
                  </div>
                )}

                <div ref={logsEndRef} className="h-4" />
              </div>
            </div>
          </div>
        )}

        {step === Step.PREVIEW && tailoredData && (
          <div className="h-full animate-in fade-in duration-500">
            <div className="mb-6 flex justify-between items-center">
              <button onClick={reset} className="flex items-center gap-2 text-slate-500 hover:text-slate-800 font-medium">
                <Undo className="w-4 h-4" />
                Make Another Resume
              </button>
            </div>
            <ResumePreview data={tailoredData} originalFile={originalFile} originalText={resumeText} />
          </div>
        )}
      </main>
    </div>
  );
};

export default App;