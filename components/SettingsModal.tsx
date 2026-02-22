import React, { useState } from 'react';
import { X, Save, Key, Cpu } from 'lucide-react';
import { AppSettings } from '../types';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  settings: AppSettings;
  onSave: (newSettings: AppSettings) => void;
}

const SettingsModal: React.FC<SettingsModalProps> = ({ isOpen, onClose, settings, onSave }) => {
  const [formData, setFormData] = useState<AppSettings>(settings);
  const [isClosing, setIsClosing] = useState(false);

  if (!isOpen && !isClosing) return null;

  const handleChange = (field: keyof AppSettings, value: string) => {
    setFormData(prev => ({ ...prev, [field]: value }));
  };

  const handleClose = () => {
    setIsClosing(true);
    setTimeout(() => {
      setIsClosing(false);
      onClose();
    }, 200);
  };

  const handleSave = () => {
    onSave(formData);
    handleClose();
  };

  return (
    <div className={`fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4 transition-opacity duration-200 ${isClosing ? 'opacity-0' : 'opacity-100'}`}>
      <div className={`bg-white rounded-xl shadow-2xl w-full max-w-sm flex flex-col overflow-hidden transition-all duration-200 ${isClosing ? 'scale-95 opacity-0' : 'scale-100 opacity-100'}`}>
        
        {/* Header */}
        <div className="bg-slate-900 text-white px-4 py-3 flex justify-between items-center shrink-0">
          <h2 className="text-sm font-bold flex items-center gap-2">
            <Cpu className="w-4 h-4 text-indigo-400" />
            Engine Configuration
          </h2>
          <button onClick={handleClose} className="text-slate-400 hover:text-white transition-colors p-1 rounded-md hover:bg-slate-800">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="p-4 space-y-4 overflow-y-auto max-h-[70vh]">
          
          {/* Active Provider */}
          <div>
            <label className="block text-xs font-semibold text-slate-800 mb-2">Choose Primary Model</label>
            <div className="grid grid-cols-3 gap-2">
              <button
                onClick={() => handleChange('activeProvider', 'openai')}
                className={`flex flex-col items-center justify-center gap-0.5 py-2 px-1 rounded-lg border text-xs font-semibold transition-all
                  ${formData.activeProvider === 'openai' 
                    ? 'bg-green-50 border-green-500 text-green-700 ring-1 ring-green-500/20 shadow-sm' 
                    : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50 hover:border-slate-300'
                  }`}
              >
                <span>GPT-5.2</span>
              </button>
              <button
                onClick={() => handleChange('activeProvider', 'deepseek')}
                className={`flex flex-col items-center justify-center gap-0.5 py-2 px-1 rounded-lg border text-xs font-semibold transition-all
                  ${formData.activeProvider === 'deepseek' 
                    ? 'bg-purple-50 border-purple-500 text-purple-700 ring-1 ring-purple-500/20 shadow-sm' 
                    : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50 hover:border-slate-300'
                  }`}
              >
                <span>DeepSeek</span>
              </button>
              <button
                onClick={() => handleChange('activeProvider', 'gemini')}
                className={`flex flex-col items-center justify-center gap-0.5 py-2 px-1 rounded-lg border text-xs font-semibold transition-all
                  ${formData.activeProvider === 'gemini' 
                    ? 'bg-blue-50 border-blue-500 text-blue-700 ring-1 ring-blue-500/20 shadow-sm' 
                    : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50 hover:border-slate-300'
                  }`}
              >
                <span>Gemini 3.1</span>
              </button>
            </div>
          </div>

          <div className="border-t border-slate-100"></div>

          {/* API Keys */}
          <div className="space-y-3">
            {/* OpenAI Key */}
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1 flex items-center justify-between">
                <span className="flex items-center gap-1">OpenAI API Key</span>
                {formData.activeProvider === 'openai' && <span className="text-[9px] bg-green-100 text-green-700 px-1.5 py-0.5 rounded-full font-bold tracking-wide">ACTIVE</span>}
              </label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-2.5 flex items-center pointer-events-none">
                  <Key className="w-3.5 h-3.5 text-slate-400" />
                </div>
                <input
                  type="password"
                  value={formData.openaiApiKey}
                  onChange={(e) => handleChange('openaiApiKey', e.target.value)}
                  placeholder="sk-..."
                  className="pl-8 block w-full rounded-lg border border-slate-300 bg-slate-50 py-1.5 text-xs focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/20 outline-none transition-all"
                />
              </div>
            </div>

            {/* DeepSeek Key */}
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1 flex items-center justify-between">
                <span className="flex items-center gap-1">DeepSeek API Key</span>
                {formData.activeProvider === 'deepseek' && <span className="text-[9px] bg-purple-100 text-purple-700 px-1.5 py-0.5 rounded-full font-bold tracking-wide">ACTIVE</span>}
              </label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-2.5 flex items-center pointer-events-none">
                  <Key className="w-3.5 h-3.5 text-slate-400" />
                </div>
                <input
                  type="password"
                  value={formData.deepseekApiKey}
                  onChange={(e) => handleChange('deepseekApiKey', e.target.value)}
                  placeholder="sk-..."
                  className="pl-8 block w-full rounded-lg border border-slate-300 bg-slate-50 py-1.5 text-xs focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/20 outline-none transition-all"
                />
              </div>
            </div>

            {/* Gemini Key */}
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1 flex items-center justify-between">
                <span className="flex items-center gap-1">Gemini API Key</span>
                {formData.activeProvider === 'gemini' && <span className="text-[9px] bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded-full font-bold tracking-wide">ACTIVE</span>}
              </label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-2.5 flex items-center pointer-events-none">
                  <Key className="w-3.5 h-3.5 text-slate-400" />
                </div>
                <input
                  type="password"
                  value={formData.geminiApiKey}
                  onChange={(e) => handleChange('geminiApiKey', e.target.value)}
                  placeholder="AIza..."
                  className="pl-8 block w-full rounded-lg border border-slate-300 bg-slate-50 py-1.5 text-xs focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/20 outline-none transition-all"
                />
              </div>
            </div>
          </div>

          <div className="bg-amber-50 border border-amber-200 rounded-lg p-2 text-[10px] flex items-start gap-1.5">
             <span className="text-amber-600">ℹ️</span>
             <p className="text-amber-800 leading-tight">
               Keys are stored securely in local storage.
             </p>
          </div>

        </div>

        {/* Footer */}
        <div className="bg-slate-50 px-4 py-3 flex justify-end border-t border-slate-200 shrink-0">
          <button
            onClick={handleSave}
            className="flex items-center gap-1.5 bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-1.5 rounded-lg font-semibold text-xs transition-all shadow-sm hover:shadow active:scale-95"
          >
            <Save className="w-3.5 h-3.5" />
            Save
          </button>
        </div>
      </div>
    </div>
  );
};

export default SettingsModal;