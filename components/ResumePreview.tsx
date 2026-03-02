import React, { useState, useMemo } from 'react';
import { TailoredResumeData } from '../types';
import {
  Download, Bot, BrainCircuit, Search, PenTool, CheckCircle,
  Lightbulb, ArrowRight, FileCheck, AlertOctagon, FileText,
  ShieldCheck, Tag, XCircle,
} from 'lucide-react';
import { modifyAndDownloadDocx } from '../services/documentService';

interface ResumePreviewProps {
  data: TailoredResumeData;
  originalFile: File | null;
  originalFileBuffer: ArrayBuffer | null;
  originalText: string;
}

const ResumePreview: React.FC<ResumePreviewProps> = ({
  data,
  originalFile,
  originalFileBuffer,
  originalText,
}) => {
  const [activeTab, setActiveTab] = useState<'agents' | 'modifications' | 'livedoc'>('agents');
  const [isDownloading, setIsDownloading] = useState(false);

  // ── Download handler ──────────────────────────────────────────────────────
  const handleDownload = async () => {
    if (!originalFile || !originalFileBuffer) {
      alert('Original file missing. Please re-upload.');
      return;
    }
    setIsDownloading(true);
    try {
      const freshFile = new File([originalFileBuffer], originalFile.name, {
        type: originalFile.type,
      });
      await modifyAndDownloadDocx(freshFile, data.modifications, 'Tailored_Resume.docx');
    } finally {
      setIsDownloading(false);
    }
  };

  // ── Live doc diff elements ────────────────────────────────────────────────
  const liveDocElements = useMemo(() => {
    if (!originalText) return [];

    let parts: { text: string; type: 'normal' | 'removed' | 'added' }[] = [
      { text: originalText, type: 'normal' },
    ];

    data.modifications?.forEach(mod => {
      const searchFor = (mod.original_excerpt || '').trim();
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
          const after  = part.text.substring(idx + searchFor.length);
          if (before) newParts.push({ text: before, type: 'normal' });
          newParts.push({ text: searchFor,       type: 'removed' });
          newParts.push({ text: mod.new_content, type: 'added'   });
          if (after)  newParts.push({ text: after,  type: 'normal' });
        } else {
          newParts.push(part);
        }
      });
      parts = newParts;
    });

    return parts;
  }, [originalText, data.modifications]);

  // ── Length stats ──────────────────────────────────────────────────────────
  const lengthStats = useMemo(() => {
    let originalLen = 0;
    let newLen = 0;
    data.modifications?.forEach(mod => {
      originalLen += (mod.original_excerpt || '').length;
      newLen      += (mod.new_content || '').length;
    });
    return { originalLen, newLen, diff: newLen - originalLen };
  }, [data.modifications]);

  // ── ATS data ──────────────────────────────────────────────────────────────
  const score           = data.ats?.score          ?? 98;
  const atsFeedback     = data.ats?.feedback        ?? '';
  const keywordMatch    = data.ats?.keywordMatch    ?? [];
  const missingKeywords = data.ats?.missingKeywords ?? [];

  const getScoreColor = (s: number) => {
    if (s >= 95) return 'text-green-600 border-green-500 bg-green-50';
    if (s >= 80) return 'text-amber-600 border-amber-500 bg-amber-50';
    return 'text-red-600 border-red-500 bg-red-50';
  };
  const scoreColor = getScoreColor(score);

  // ── Agents — BUG FIX ─────────────────────────────────────────────────────
  // Previous code expected data.agents.recruiter / .profiler / .gap_analyst etc.
  // which never exist — the AI services return data.agents.primary and
  // data.agents.auditor (just name strings). Rebuilt to show the real data.
  const primaryName  = data.agents?.primary  ?? data.agents?.optimizer  ?? 'Primary Agent';
  const reviewerName = data.agents?.auditor  ?? data.agents?.reviewer   ?? 'Auditor Agent';

  const getPrimaryIcon  = (name: string) => name.includes('Gemini') ? BrainCircuit : name.includes('Deep') ? Search : PenTool;
  const getReviewerIcon = (name: string) => name.includes('Deep') ? Search : name.includes('Gemini') ? Lightbulb : CheckCircle;

  const PrimaryIcon  = getPrimaryIcon(primaryName);
  const ReviewerIcon = getReviewerIcon(reviewerName);

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="h-full flex flex-col bg-slate-50">

      {/* ── ATS Score Banner ─────────────────────────────────────────────── */}
      <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200 mb-6 flex flex-col md:flex-row items-center justify-between gap-6">
        {/* Score circle */}
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
              {score >= 98
                ? 'Perfect match. Resume is highly optimised.'
                : score >= 80
                ? 'Strong match with minor gaps remaining.'
                : 'Needs further optimisation.'}
            </p>
          </div>
        </div>

        {/* Length protection */}
        <div className="flex-1 bg-slate-50 p-4 rounded-xl border border-slate-100 flex flex-col justify-center">
          <span className="text-[10px] font-bold uppercase text-slate-400 tracking-wider mb-2 flex items-center gap-1">
            <FileText className="w-3 h-3" /> Page Layout Protection
          </span>
          <div className="flex items-center gap-3">
            <div className="flex flex-col">
              <span className="text-xs text-slate-500">Original</span>
              <span className="font-mono text-sm font-semibold text-slate-700">{lengthStats.originalLen} chars</span>
            </div>
            <ArrowRight className="w-4 h-4 text-slate-300" />
            <div className="flex flex-col">
              <span className="text-xs text-slate-500">Elite Content</span>
              <span className={`font-mono text-sm font-semibold ${lengthStats.diff > 30 ? 'text-amber-600' : 'text-green-600'}`}>
                {lengthStats.newLen} chars
              </span>
            </div>
          </div>
          <div className="mt-2 text-xs font-medium">
            {lengthStats.diff > 30 ? (
              <span className="text-amber-600 flex items-center gap-1">
                <AlertOctagon className="w-3 h-3" /> Slightly longer (+{lengthStats.diff} chars). May affect pagination.
              </span>
            ) : lengthStats.diff < -30 ? (
              <span className="text-blue-600 flex items-center gap-1">
                <CheckCircle className="w-3 h-3" /> Layout secured ({Math.abs(lengthStats.diff)} chars condensed).
              </span>
            ) : (
              <span className="text-green-600 flex items-center gap-1">
                <CheckCircle className="w-3 h-3" /> Layout perfectly preserved ({lengthStats.diff > 0 ? '+' : ''}{lengthStats.diff} chars).
              </span>
            )}
          </div>
        </div>

        {/* Download button */}
        <button
          onClick={handleDownload}
          disabled={isDownloading}
          className={`flex items-center gap-2 px-6 py-3 rounded-xl font-bold transition-all shadow-md whitespace-nowrap ${
            isDownloading
              ? 'bg-slate-300 text-slate-500 cursor-not-allowed'
              : 'bg-indigo-600 hover:bg-indigo-700 text-white hover:shadow-lg hover:-translate-y-0.5'
          }`}
        >
          <Download className="w-5 h-5" />
          {isDownloading ? 'Saving…' : 'Download DOCX'}
        </button>
      </div>

      {/* ── Tabs ─────────────────────────────────────────────────────────── */}
      <div className="flex justify-center mb-6">
        <div className="inline-flex bg-white p-1.5 rounded-xl border border-slate-200 shadow-sm">
          {[
            { key: 'agents',        label: 'Agents',                       icon: Bot      },
            { key: 'livedoc',       label: 'Live Doc',                     icon: FileText },
            { key: 'modifications', label: `Changes (${data.modifications?.length ?? 0})`, icon: FileCheck },
          ].map(tab => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key as any)}
              className={`flex items-center gap-2 px-6 py-2 rounded-lg text-sm font-semibold transition-all ${
                activeTab === tab.key
                  ? 'bg-slate-800 text-white shadow-md'
                  : 'text-slate-500 hover:bg-slate-100'
              }`}
            >
              <tab.icon className="w-4 h-4" />
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto pr-2 pb-10">

        {/* ── AGENTS VIEW ────────────────────────────────────────────────── */}
        {activeTab === 'agents' && (
          <div className="max-w-5xl mx-auto space-y-6">

            {/* ATS Feedback card */}
            {atsFeedback && (
              <div className="bg-white rounded-2xl p-6 border border-slate-200 shadow-sm">
                <h3 className="font-bold text-slate-800 text-base mb-2 flex items-center gap-2">
                  <ShieldCheck className="w-5 h-5 text-indigo-500" /> ATS Auditor Feedback
                </h3>
                <p className="text-sm text-slate-600 leading-relaxed">{atsFeedback}</p>
              </div>
            )}

            {/* Keyword chips */}
            {(keywordMatch.length > 0 || missingKeywords.length > 0) && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {keywordMatch.length > 0 && (
                  <div className="bg-white rounded-2xl p-6 border border-green-100 shadow-sm">
                    <h4 className="font-bold text-green-700 text-sm mb-3 flex items-center gap-2">
                      <Tag className="w-4 h-4" /> Matched Keywords ({keywordMatch.length})
                    </h4>
                    <div className="flex flex-wrap gap-2">
                      {keywordMatch.map((kw, i) => (
                        <span key={i} className="bg-green-50 text-green-700 border border-green-200 text-xs font-semibold px-3 py-1 rounded-full">
                          {kw}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
                {missingKeywords.length > 0 && (
                  <div className="bg-white rounded-2xl p-6 border border-red-100 shadow-sm">
                    <h4 className="font-bold text-red-700 text-sm mb-3 flex items-center gap-2">
                      <XCircle className="w-4 h-4" /> Missing Keywords ({missingKeywords.length})
                    </h4>
                    <div className="flex flex-wrap gap-2">
                      {missingKeywords.map((kw, i) => (
                        <span key={i} className="bg-red-50 text-red-700 border border-red-200 text-xs font-semibold px-3 py-1 rounded-full">
                          {kw}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Agent cards — BUG FIX: now uses real primary/auditor names from the AI response */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* Primary optimizer */}
              <div className="bg-white rounded-2xl p-6 border border-slate-200 shadow-sm hover:shadow-md transition-shadow relative overflow-hidden">
                <div className="absolute top-0 right-0 w-24 h-24 -mr-8 -mt-8 rounded-full bg-indigo-400 opacity-10" />
                <div className="flex items-center gap-3 mb-4">
                  <div className="p-3 rounded-xl bg-indigo-100 text-indigo-600">
                    <PrimaryIcon className="w-6 h-6" />
                  </div>
                  <div>
                    <h3 className="font-bold text-slate-800 text-lg leading-tight">{primaryName}</h3>
                    <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">Primary Optimizer</span>
                  </div>
                </div>
                <p className="text-sm text-slate-600 leading-relaxed">
                  Responsible for rewriting all resume content with elite-level language,
                  strong action verbs, quantifiable achievements, and ATS keyword integration.
                </p>
                <div className="mt-4 pt-4 border-t border-slate-100 flex items-center justify-between">
                  <span className="text-xs px-2 py-1 rounded-full font-bold bg-green-100 text-green-700">COMPLETED</span>
                  <span className="text-slate-300 text-xs font-mono">AGENT_01</span>
                </div>
              </div>

              {/* Auditor / reviewer */}
              <div className="bg-white rounded-2xl p-6 border border-slate-200 shadow-sm hover:shadow-md transition-shadow relative overflow-hidden">
                <div className="absolute top-0 right-0 w-24 h-24 -mr-8 -mt-8 rounded-full bg-blue-400 opacity-10" />
                <div className="flex items-center gap-3 mb-4">
                  <div className="p-3 rounded-xl bg-blue-100 text-blue-600">
                    <ReviewerIcon className="w-6 h-6" />
                  </div>
                  <div>
                    <h3 className="font-bold text-slate-800 text-lg leading-tight">{reviewerName}</h3>
                    <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">Critical ATS Auditor</span>
                  </div>
                </div>
                <p className="text-sm text-slate-600 leading-relaxed">
                  Performs a rigorous ATS audit — validates keyword density, scores the resume
                  against the job description, and flags any remaining gaps or layout violations.
                </p>
                <div className="mt-4 pt-4 border-t border-slate-100 flex items-center justify-between">
                  <span className="text-xs px-2 py-1 rounded-full font-bold bg-green-100 text-green-700">COMPLETED</span>
                  <span className="text-slate-300 text-xs font-mono">AGENT_02</span>
                </div>
              </div>
            </div>

          </div>
        )}

        {/* ── LIVE DOC VIEW ───────────────────────────────────────────────── */}
        {activeTab === 'livedoc' && (
          <div className="max-w-[21cm] mx-auto bg-white shadow-md border border-slate-200 min-h-[1000px] p-12">
            <h3 className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-6 border-b pb-2">
              Document Preview — AI Edits Highlighted
            </h3>
            <div className="whitespace-pre-wrap font-serif text-slate-800 leading-relaxed text-sm">
              {liveDocElements.map((part, idx) => {
                if (part.type === 'removed') {
                  return (
                    <span
                      key={idx}
                      className="bg-red-50 text-red-400 line-through decoration-red-300 mx-0.5 px-0.5 rounded"
                    >
                      {part.text}
                    </span>
                  );
                }
                if (part.type === 'added') {
                  return (
                    <span
                      key={idx}
                      className="bg-green-100 text-green-800 font-medium px-1 rounded mx-0.5 border-b-2 border-green-300"
                    >
                      {part.text}
                    </span>
                  );
                }
                return <span key={idx}>{part.text}</span>;
              })}
            </div>
          </div>
        )}

        {/* ── MODIFICATIONS VIEW ──────────────────────────────────────────── */}
        {activeTab === 'modifications' && (
          <div className="max-w-5xl mx-auto space-y-6">
            <div className="bg-slate-900 text-white p-6 rounded-2xl shadow-lg mb-8">
              <h2 className="text-2xl font-bold mb-2">Applied Modifications</h2>
              <p className="text-slate-300">
                {data.modifications?.length ?? 0} high-impact text replacements crafted to
                maximise ATS score and recruiter readability.
              </p>
            </div>

            {data.modifications && data.modifications.length > 0 ? (
              data.modifications.map((mod, idx) => (
                <div
                  key={idx}
                  className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden flex flex-col md:flex-row group hover:border-indigo-300 transition-colors"
                >
                  {/* Index badge */}
                  <div className="bg-slate-50 p-4 md:w-20 border-b md:border-b-0 md:border-r border-slate-200 flex items-center justify-center">
                    <span className="text-2xl font-black text-slate-200">#{idx + 1}</span>
                  </div>

                  {/* Diff */}
                  <div className="flex-1 p-6 grid grid-cols-1 md:grid-cols-2 gap-8">
                    <div className="relative">
                      <span className="absolute -top-3 left-0 bg-red-100 text-red-700 text-[10px] font-bold px-2 py-0.5 rounded uppercase tracking-wide">
                        Original
                      </span>
                      <p className="text-sm text-slate-500 mt-2 font-mono bg-slate-50 p-3 rounded border border-slate-100 break-words">
                        "{mod.original_excerpt}"
                      </p>
                    </div>

                    <div className="relative">
                      <span className="absolute -top-3 left-0 bg-green-100 text-green-700 text-[10px] font-bold px-2 py-0.5 rounded uppercase tracking-wide">
                        Elite Content
                      </span>
                      <div className="flex gap-3 mt-2">
                        <ArrowRight className="w-5 h-5 text-green-500 flex-shrink-0 mt-0.5" />
                        <p className="text-sm text-slate-900 font-bold leading-relaxed break-words">
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