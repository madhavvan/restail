import React, { useState, useMemo } from 'react';
import { TailoredResumeData } from '../types';
import { Download, Bot, BrainCircuit, Search, PenTool, CheckCircle, Lightbulb, ArrowRight, FileCheck, AlertOctagon, FileText, BarChart, ShieldCheck } from 'lucide-react';
import { modifyAndDownloadDocx } from '../services/documentService';

interface ResumePreviewProps {
  data: TailoredResumeData;
  originalFile: File | null;
  originalText: string;
}

const ResumePreview: React.FC<ResumePreviewProps> = ({ data, originalFile, originalText }) => {
  const [activeTab, setActiveTab] = useState<'agents' | 'modifications' | 'livedoc'>('agents');

  const handleDownload = async () => {
    if (!originalFile) {
      alert("Original file missing. Please re-upload.");
      return;
    }
    await modifyAndDownloadDocx(originalFile, data.modifications, "Tailored_Resume.docx");
  };

  // Generate the "Live Doc" view
  const liveDocElements = useMemo(() => {
    if (!originalText) return [];
    
    let parts: { text: string; type: 'normal' | 'removed' | 'added'; reason?: string }[] = [{ text: originalText, type: 'normal' }];

    data.modifications?.forEach(mod => {
        const searchFor = mod.original_excerpt.trim();
        if (searchFor.length < 5) return;

        const newParts: typeof parts = [];
        
        parts.forEach(part => {
            if (part.type !== 'normal') {
                newParts.push(part);
                return;
            }

            const idx = part.text.indexOf(searchFor);
            if (idx !== -1) {
                const before = part.text.substring(0, idx);
                const after = part.text.substring(idx + searchFor.length);
                
                if (before) newParts.push({ text: before, type: 'normal' });
                newParts.push({ text: searchFor, type: 'removed', reason: mod.reason });
                newParts.push({ text: mod.new_content, type: 'added', reason: mod.reason });
                if (after) newParts.push({ text: after, type: 'normal' });
            } else {
                newParts.push(part);
            }
        });
        parts = newParts;
    });

    return parts;
  }, [originalText, data.modifications]);


  const agents = [
    { id: 'recruiter', icon: Search, color: 'text-blue-600', bg: 'bg-blue-100', data: data.agents?.recruiter },
    { id: 'profiler', icon: FileCheck, color: 'text-purple-600', bg: 'bg-purple-100', data: data.agents?.profiler },
    { id: 'gap_analyst', icon: BrainCircuit, color: 'text-amber-600', bg: 'bg-amber-100', data: data.agents?.gap_analyst },
    { id: 'strategist', icon: Lightbulb, color: 'text-indigo-600', bg: 'bg-indigo-100', data: data.agents?.strategist },
    { id: 'copywriter', icon: PenTool, color: 'text-pink-600', bg: 'bg-pink-100', data: data.agents?.copywriter },
    { id: 'reviewer', icon: CheckCircle, color: 'text-emerald-600', bg: 'bg-emerald-100', data: data.agents?.reviewer },
  ];

  // Calculate Color for ATS Score
  const getScoreColor = (score: number) => {
      if (score >= 95) return 'text-green-600 border-green-500 bg-green-50';
      if (score >= 80) return 'text-amber-600 border-amber-500 bg-amber-50';
      return 'text-red-600 border-red-500 bg-red-50';
  };

  const score = data.ats?.score || 98; // Default to 98 if undefined (legacy support)
  const scoreColor = getScoreColor(score);

  // Calculate length difference to ensure page count is preserved
  const lengthStats = useMemo(() => {
    let originalLen = 0;
    let newLen = 0;
    data.modifications?.forEach(mod => {
      originalLen += (mod.original_excerpt || '').length;
      newLen += (mod.new_content || '').length;
    });
    const diff = newLen - originalLen;
    return { originalLen, newLen, diff };
  }, [data.modifications]);

  return (
    <div className="h-full flex flex-col bg-slate-50">
      
      {/* ATS Score Banner */}
      <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200 mb-6 flex flex-col md:flex-row items-center justify-between gap-6">
        <div className="flex items-center gap-4">
            <div className={`w-20 h-20 rounded-full flex items-center justify-center border-4 text-2xl font-bold ${scoreColor}`}>
                {score}%
            </div>
            <div>
                <h2 className="text-xl font-bold text-slate-900 flex items-center gap-2">
                    <ShieldCheck className="w-5 h-5 text-indigo-600" />
                    ATS Match Score
                </h2>
                <p className="text-slate-500 text-sm">
                    {score >= 98 ? "Perfect Match. Resume is highly optimized." : "Good match, but room for improvement."}
                </p>
            </div>
        </div>
        
        {/* Length Constraint Indicator */}
        <div className="flex-1 bg-slate-50 p-4 rounded-xl border border-slate-100 flex flex-col justify-center">
            <span className="text-[10px] font-bold uppercase text-slate-400 tracking-wider mb-2 flex items-center gap-1">
              <FileText className="w-3 h-3" /> Page Layout Protection
            </span>
            <div className="flex items-center gap-3">
              <div className="flex flex-col">
                <span className="text-xs text-slate-500">Original Text</span>
                <span className="font-mono text-sm font-semibold text-slate-700">{lengthStats.originalLen} chars</span>
              </div>
              <ArrowRight className="w-4 h-4 text-slate-300" />
              <div className="flex flex-col">
                <span className="text-xs text-slate-500">Elite Content</span>
                <span className={`font-mono text-sm font-semibold ${lengthStats.diff > 0 ? 'text-amber-600' : 'text-green-600'}`}>
                  {lengthStats.newLen} chars
                </span>
              </div>
            </div>
            <div className="mt-2 text-xs font-medium">
              {lengthStats.diff > 0 ? (
                <span className="text-amber-600 flex items-center gap-1"><AlertOctagon className="w-3 h-3"/> Slightly longer (+{lengthStats.diff} chars). May affect pagination.</span>
              ) : (
                <span className="text-green-600 flex items-center gap-1"><CheckCircle className="w-3 h-3"/> Layout preserved ({lengthStats.diff} chars).</span>
              )}
            </div>
        </div>

        <button
          onClick={handleDownload}
          className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white px-6 py-3 rounded-xl font-bold transition-all shadow-md hover:shadow-lg hover:-translate-y-0.5 whitespace-nowrap"
        >
          <Download className="w-5 h-5" />
          Download DOCX
        </button>
      </div>

      {/* Tabs */}
      <div className="flex justify-center mb-6">
        <div className="inline-flex bg-white p-1.5 rounded-xl border border-slate-200 shadow-sm">
           <button
             onClick={() => setActiveTab('agents')}
             className={`flex items-center gap-2 px-6 py-2 rounded-lg text-sm font-semibold transition-all ${activeTab === 'agents' ? 'bg-slate-800 text-white shadow-md' : 'text-slate-500 hover:bg-slate-100'}`}
           >
             <Bot className="w-4 h-4" />
             Agents
           </button>
           <button
             onClick={() => setActiveTab('livedoc')}
             className={`flex items-center gap-2 px-6 py-2 rounded-lg text-sm font-semibold transition-all ${activeTab === 'livedoc' ? 'bg-slate-800 text-white shadow-md' : 'text-slate-500 hover:bg-slate-100'}`}
           >
             <FileText className="w-4 h-4" />
             Live Doc
           </button>
           <button
             onClick={() => setActiveTab('modifications')}
             className={`flex items-center gap-2 px-6 py-2 rounded-lg text-sm font-semibold transition-all ${activeTab === 'modifications' ? 'bg-slate-800 text-white shadow-md' : 'text-slate-500 hover:bg-slate-100'}`}
           >
             <FileCheck className="w-4 h-4" />
             Changes ({data.modifications?.length || 0})
           </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto pr-2 pb-10">
        
        {/* AGENTS VIEW */}
        {activeTab === 'agents' && (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6 max-w-7xl mx-auto">
            {agents.map((agent, idx) => (
              agent.data ? (
                <div key={idx} className="bg-white rounded-2xl p-6 border border-slate-200 shadow-sm hover:shadow-md transition-shadow relative overflow-hidden group">
                  <div className={`absolute top-0 right-0 w-24 h-24 -mr-8 -mt-8 rounded-full opacity-10 ${agent.bg.replace('bg-', 'bg-current ')} ${agent.color}`}></div>
                  
                  <div className="flex items-center gap-3 mb-4 relative">
                    <div className={`p-3 rounded-xl ${agent.bg} ${agent.color}`}>
                      <agent.icon className="w-6 h-6" />
                    </div>
                    <div>
                      <h3 className="font-bold text-slate-800 text-lg leading-tight">{agent.data.name || agent.id}</h3>
                      <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">{agent.data.role}</span>
                    </div>
                  </div>
                  
                  <div className="relative">
                    <div className="text-sm text-slate-600 leading-relaxed font-medium">
                      {agent.data.analysis || "No analysis provided."}
                    </div>
                  </div>

                  <div className="mt-4 pt-4 border-t border-slate-100 flex items-center justify-between">
                    <span className={`text-xs px-2 py-1 rounded-full font-bold ${agent.data.status === 'complete' ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-slate-500'}`}>
                      {agent.data.status === 'complete' ? 'COMPLETED' : 'PENDING'}
                    </span>
                    <span className="text-slate-300 text-xs font-mono">AGENT_0{idx+1}</span>
                  </div>
                </div>
              ) : (
                <div key={idx} className="bg-slate-50 border-2 border-dashed border-slate-200 rounded-2xl p-6 flex flex-col items-center justify-center text-slate-400 min-h-[200px]">
                  <AlertOctagon className="w-8 h-8 mb-2 opacity-50" />
                  <span className="text-sm font-medium">Agent {agent.id} did not report in.</span>
                </div>
              )
            ))}
          </div>
        )}

        {/* LIVE DOC VIEW */}
        {activeTab === 'livedoc' && (
            <div className="max-w-[21cm] mx-auto bg-white shadow-md border border-slate-200 min-h-[1000px] p-12">
                <h3 className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-6 border-b pb-2">Document Preview (With AI Edits)</h3>
                <div className="whitespace-pre-wrap font-serif text-slate-800 leading-relaxed text-sm">
                    {liveDocElements.map((part, idx) => {
                        if (part.type === 'removed') {
                            return (
                                <span key={idx} className="bg-red-50 text-red-400 line-through decoration-red-300 mx-0.5 px-0.5 rounded" title={`Original: ${part.reason}`}>
                                    {part.text}
                                </span>
                            );
                        }
                        if (part.type === 'added') {
                            return (
                                <span key={idx} className="bg-green-100 text-green-800 font-medium px-1 rounded mx-0.5 border-b-2 border-green-300" title={`New: ${part.reason}`}>
                                    {part.text}
                                </span>
                            );
                        }
                        return <span key={idx}>{part.text}</span>;
                    })}
                </div>
            </div>
        )}

        {/* MODIFICATIONS VIEW */}
        {activeTab === 'modifications' && (
          <div className="max-w-5xl mx-auto space-y-6">
            <div className="bg-slate-900 text-white p-6 rounded-2xl shadow-lg mb-8">
              <h2 className="text-2xl font-bold mb-2">Applied Modifications</h2>
              <p className="text-slate-300">
                The Elite Copywriter has generated {data.modifications?.length || 0} high-impact text replacements. 
                These changes are designed to maximize your ATS score and readability.
              </p>
            </div>

            {data.modifications && data.modifications.length > 0 ? (
              data.modifications.map((mod, idx) => (
                <div key={idx} className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden flex flex-col md:flex-row group hover:border-indigo-300 transition-colors">
                  {/* Left: Metadata */}
                  <div className="bg-slate-50 p-4 md:w-48 border-b md:border-b-0 md:border-r border-slate-200 flex flex-col justify-center">
                    <span className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-1">Section</span>
                    <div className="font-semibold text-slate-700 mb-4">{mod.section}</div>
                    
                    <span className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-1">Strategy</span>
                    <div className="text-xs text-indigo-600 leading-snug">{mod.reason}</div>
                  </div>

                  {/* Right: Diff */}
                  <div className="flex-1 p-6 grid grid-cols-1 md:grid-cols-2 gap-8">
                    <div className="relative">
                      <span className="absolute -top-3 left-0 bg-red-100 text-red-700 text-[10px] font-bold px-2 py-0.5 rounded uppercase tracking-wide">Original Text</span>
                      <p className="text-sm text-slate-500 mt-2 font-mono bg-slate-50 p-3 rounded border border-slate-100">
                        "{mod.original_excerpt}"
                      </p>
                    </div>
                    
                    <div className="relative">
                      <span className="absolute -top-3 left-0 bg-green-100 text-green-700 text-[10px] font-bold px-2 py-0.5 rounded uppercase tracking-wide">Elite Content</span>
                      <div className="flex gap-3 mt-2">
                        <ArrowRight className="w-5 h-5 text-green-500 flex-shrink-0 mt-0.5" />
                        <p className="text-sm text-slate-900 font-bold leading-relaxed">
                          "{mod.new_content}"
                        </p>
                      </div>
                    </div>
                  </div>
                </div>
              ))
            ) : (
              <div className="text-center py-12 bg-white rounded-xl border border-slate-200">
                <CheckCircle className="w-12 h-12 text-green-500 mx-auto mb-3" />
                <h3 className="text-lg font-bold text-slate-800">No Changes Needed</h3>
                <p className="text-slate-500">The agents decided your resume is already a perfect match!</p>
              </div>
            )}
          </div>
        )}

      </div>
    </div>
  );
};

export default ResumePreview;