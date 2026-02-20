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

  if (!isOpen) return null;

  const handleChange = (field: keyof AppSettings, value: string) => {
    setFormData(prev => ({ ...prev, [field]: value }));
  };

  const handleSave = () => {
    onSave(formData);
    onClose();
  };

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-xs overflow-hidden animate-in fade-in zoom-in duration-200"> {/* SMALL BOX */}
        
        {/* Header */}
        <div className="bg-slate-900 text-white px-5 py-3 flex justify-between items-center">
          <h2 className="text-base font-bold flex items-center gap-2">
            <Cpu className="w-4 h-4" />
            Engine Configuration
          </h2>
          <button onClick={onClose} className="text-slate-400 hover:text-white transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="p-4 space-y-5">
          
          {/* Active Provider - Only 2 models */}
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-2">Choose Primary Model</label>
            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={() => handleChange('activeProvider', 'openai')}
                className={`flex items-center justify-center gap-2 py-2.5 px-4 rounded-lg border text-sm font-semibold transition-all
                  ${formData.activeProvider === 'openai' 
                    ? 'bg-green-50 border-green-500 text-green-700 ring-1 ring-green-500' 
                    : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'
                  }`}
              >
                GPT-5.2 (OpenAI)
              </button>
              <button
                onClick={() => handleChange('activeProvider', 'deepseek')}
                className={`flex items-center justify-center gap-2 py-2.5 px-4 rounded-lg border text-sm font-semibold transition-all
                  ${formData.activeProvider === 'deepseek' 
                    ? 'bg-purple-50 border-purple-500 text-purple-700 ring-1 ring-purple-500' 
                    : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'
                  }`}
              >
                DeepSeek-V3.2
              </button>
            </div>
          </div>

          <div className="border-t border-slate-100 my-3"></div>

          {/* OpenAI Key */}
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1 flex items-center gap-2">
              OpenAI API Key
              {formData.activeProvider === 'openai' && <span className="text-[10px] bg-green-100 text-green-600 px-1.5 py-0.5 rounded font-bold">ACTIVE</span>}
            </label>
            <div className="relative">
              <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                <Key className="w-4 h-4 text-slate-400" />
              </div>
              <input
                type="password"
                value={formData.openaiApiKey}
                onChange={(e) => handleChange('openaiApiKey', e.target.value)}
                placeholder="sk-..."
                className="pl-10 block w-full rounded-lg border border-slate-300 bg-slate-50 py-2 text-sm focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500 outline-none"
              />
            </div>
          </div>

          {/* DeepSeek Key */}
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1 flex items-center gap-2">
              DeepSeek API Key
              {formData.activeProvider === 'deepseek' && <span className="text-[10px] bg-purple-100 text-purple-600 px-1.5 py-0.5 rounded font-bold">ACTIVE</span>}
            </label>
            <div className="relative">
              <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                <Key className="w-4 h-4 text-slate-400" />
              </div>
              <input
                type="password"
                value={formData.deepseekApiKey}
                onChange={(e) => handleChange('deepseekApiKey', e.target.value)}
                placeholder="sk-..."
                className="pl-10 block w-full rounded-lg border border-slate-300 bg-slate-50 py-2 text-sm focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500 outline-none"
              />
            </div>
          </div>

          <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-xs">
            <p className="text-amber-800">
              <strong>Note:</strong> Keys saved locally only. Conversation happens between GPT-5.2 (OpenAI) and DeepSeek-V3.2.
            </p>
          </div>

        </div>

        {/* Footer */}
        <div className="bg-slate-50 px-4 py-3 flex justify-end">
          <button
            onClick={handleSave}
            className="flex items-center gap-2 bg-slate-900 hover:bg-slate-800 text-white px-5 py-2 rounded-lg font-semibold text-sm transition-all shadow-md hover:shadow-lg"
          >
            <Save className="w-4 h-4" />
            Save Configuration
          </button>
        </div>
      </div>
    </div>
  );
};

export default SettingsModal;