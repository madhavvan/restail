import React, { useState, useEffect, useRef } from 'react';
import { AppSettings } from '../types';
import {
  X, Eye, EyeOff, Settings, Check, Shield,
  Key, Save, Sparkles, ChevronDown,
} from 'lucide-react';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  settings: AppSettings;
  onSave: (settings: AppSettings) => void;
}

const PROVIDERS = [
  { key: 'openai',   label: 'OpenAI (GPT-5.2)',       color: 'emerald', fieldKey: 'openaiApiKey'   },
  { key: 'deepseek', label: 'DeepSeek (V3.2)',         color: 'blue',    fieldKey: 'deepseekApiKey' },
  { key: 'gemini',   label: 'Google Gemini (3.1 Pro)',  color: 'violet',  fieldKey: 'geminiApiKey'   },
  { key: 'claude',   label: 'Anthropic (Sonnet 4.6)',     color: 'amber',   fieldKey: 'claudeApiKey'   },
] as const;

const SettingsModal: React.FC<SettingsModalProps> = ({ isOpen, onClose, settings, onSave }) => {
  const [local, setLocal] = useState<AppSettings>({ ...settings });
  const [showKeys, setShowKeys] = useState<Record<string, boolean>>({
    openaiApiKey: false,
    deepseekApiKey: false,
    geminiApiKey: false,
    claudeApiKey: false,
  });
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved'>('idle');
  const [isClosing, setIsClosing] = useState(false);
  const modalRef = useRef<HTMLDivElement>(null);

  // Sync local state when settings prop changes
  useEffect(() => {
    setLocal({ ...settings });
  }, [settings]);

  // Reset save state when modal opens
  useEffect(() => {
    if (isOpen) {
      setSaveState('idle');
      setIsClosing(false);
    }
  }, [isOpen]);

  const handleClose = () => {
    setIsClosing(true);
    setTimeout(() => {
      onClose();
      setIsClosing(false);
    }, 200);
  };

  const handleSave = () => {
    setSaveState('saving');
    // Small delay for animation effect
    setTimeout(() => {
      onSave(local);
      setSaveState('saved');
      setTimeout(() => {
        handleClose();
        setSaveState('idle');
      }, 800);
    }, 300);
  };

  const updateField = (field: keyof AppSettings, value: string) => {
    setLocal(prev => ({ ...prev, [field]: value }));
    setSaveState('idle');
  };

  const toggleKeyVisibility = (field: string) => {
    setShowKeys(prev => ({ ...prev, [field]: !prev[field] }));
  };

  if (!isOpen) return null;

  return (
    <div
      className={`fixed inset-0 z-50 flex items-center justify-center transition-all duration-200 ${
        isClosing ? 'opacity-0' : 'opacity-100'
      }`}
    >
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/40 backdrop-blur-sm"
        onClick={handleClose}
      />

      {/* Modal */}
      <div
        ref={modalRef}
        className={`relative w-full max-w-lg mx-4 bg-white rounded-2xl shadow-2xl overflow-hidden transform transition-all duration-200 ${
          isClosing ? 'scale-95 opacity-0' : 'scale-100 opacity-100'
        }`}
      >
        {/* Header */}
        <div className="bg-gradient-to-r from-slate-900 to-slate-800 px-6 py-5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-white/10 rounded-xl backdrop-blur">
                <Settings className="w-5 h-5 text-white" />
              </div>
              <div>
                <h2 className="text-lg font-bold text-white">Settings</h2>
                <p className="text-xs text-slate-400">Configure AI providers & API keys</p>
              </div>
            </div>
            <button
              onClick={handleClose}
              className="p-1.5 text-slate-400 hover:text-white hover:bg-white/10 rounded-lg transition-all"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        <div className="p-6 space-y-6 max-h-[65vh] overflow-y-auto">
          {/* Primary Model Selector */}
          <div>
            <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-2.5 flex items-center gap-1.5">
              <Sparkles className="w-3.5 h-3.5 text-indigo-500" />
              Primary AI Model
            </label>
            <div className="grid grid-cols-4 gap-2">
              {PROVIDERS.map(p => {
                const isActive = local.activeProvider === p.key;
                return (
                  <button
                    key={p.key}
                    onClick={() => updateField('activeProvider', p.key)}
                    className={`relative p-3 rounded-xl border-2 text-center transition-all ${
                      isActive
                        ? 'border-indigo-500 bg-indigo-50 shadow-sm'
                        : 'border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50'
                    }`}
                  >
                    {isActive && (
                      <div className="absolute -top-1.5 -right-1.5 w-5 h-5 bg-indigo-500 rounded-full flex items-center justify-center shadow-sm">
                        <Check className="w-3 h-3 text-white" />
                      </div>
                    )}
                    <span className={`text-[11px] font-bold block ${isActive ? 'text-indigo-700' : 'text-slate-600'}`}>
                      {p.key === 'openai' ? 'GPT-5.2' : p.key === 'deepseek' ? 'DeepSeek' : p.key === 'claude' ? 'Claude' : 'Gemini'}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* API Keys */}
          <div className="space-y-4">
            <div className="flex items-center gap-2">
              <Key className="w-3.5 h-3.5 text-slate-400" />
              <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">API Keys</span>
              <div className="flex-1 h-px bg-slate-200 ml-2" />
            </div>

            {/* Security notice */}
            <div className="flex items-start gap-2 bg-amber-50 border border-amber-200 rounded-xl p-3">
              <Shield className="w-4 h-4 text-amber-500 mt-0.5 flex-shrink-0" />
              <p className="text-[11px] text-amber-700 leading-relaxed">
                Keys are stored locally in your browser. They are never sent to our servers
                — they go directly to each AI provider's API.
              </p>
            </div>

            {PROVIDERS.map(p => {
              const fieldKey = p.fieldKey as keyof AppSettings;
              const value = (local[fieldKey] as string) || '';
              const isVisible = showKeys[p.fieldKey];

              return (
                <div key={p.key}>
                  <label className="block text-xs font-semibold text-slate-600 mb-1.5 flex items-center gap-1.5">
                    <span className={`w-2 h-2 rounded-full ${
                      p.color === 'emerald' ? 'bg-emerald-400' :
                      p.color === 'blue' ? 'bg-blue-400' :
                      p.color === 'amber' ? 'bg-amber-400' : 'bg-violet-400'
                    }`} />
                    {p.label}
                    {value && (
                      <span className="ml-auto text-[10px] font-medium text-green-500 flex items-center gap-0.5">
                        <Check className="w-2.5 h-2.5" /> Configured
                      </span>
                    )}
                  </label>
                  <div className="relative group">
                    <input
                      type={isVisible ? 'text' : 'password'}
                      value={value}
                      onChange={e => updateField(fieldKey, e.target.value)}
                      placeholder={`Enter ${p.label} API key…`}
                      className="w-full px-4 py-3 pr-12 rounded-xl border border-slate-200 bg-slate-50/50 text-sm font-mono text-slate-700 placeholder:text-slate-300 focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-400 outline-none transition-all"
                      autoComplete="off"
                    />
                    {/* Eye toggle button — always visible when there's a value */}
                    <button
                      type="button"
                      onClick={() => toggleKeyVisibility(p.fieldKey)}
                      className={`absolute right-3 top-1/2 -translate-y-1/2 p-1 rounded-md transition-all ${
                        value
                          ? 'text-slate-400 hover:text-indigo-600 hover:bg-indigo-50'
                          : 'text-slate-300 cursor-default'
                      }`}
                      disabled={!value}
                      title={isVisible ? 'Hide API key' : 'Show API key'}
                    >
                      {isVisible ? (
                        <EyeOff className="w-4 h-4" />
                      ) : (
                        <Eye className="w-4 h-4" />
                      )}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Footer with animated save button */}
        <div className="px-6 py-4 bg-slate-50 border-t border-slate-200 flex items-center justify-between">
          <button
            onClick={handleClose}
            className="px-5 py-2.5 text-sm font-semibold text-slate-500 hover:text-slate-700 hover:bg-white rounded-xl border border-transparent hover:border-slate-200 transition-all"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saveState === 'saving'}
            className={`relative flex items-center gap-2 px-6 py-2.5 rounded-xl text-sm font-bold transition-all duration-300 transform ${
              saveState === 'saved'
                ? 'bg-green-500 text-white shadow-lg shadow-green-500/25 scale-105'
                : saveState === 'saving'
                ? 'bg-indigo-400 text-white cursor-wait'
                : 'bg-gradient-to-r from-indigo-600 to-violet-600 text-white shadow-lg shadow-indigo-500/25 hover:shadow-xl hover:shadow-indigo-500/30 hover:scale-[1.02] active:scale-[0.98]'
            } ${saveState === 'saved' ? 'save-success' : ''}`}
          >
            {saveState === 'saved' ? (
              <>
                <Check className="w-4 h-4" />
                Saved!
              </>
            ) : saveState === 'saving' ? (
              <>
                <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                Saving…
              </>
            ) : (
              <>
                <Save className="w-4 h-4" />
                Save Settings
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};

export default SettingsModal;