import React, { useMemo, useEffect, useState } from 'react';

interface SmoothDocumentPreviewProps {
  originalText: string;
  modifications: any[];
}

const SmoothDocumentPreview: React.FC<SmoothDocumentPreviewProps> = ({ originalText, modifications }) => {
  const [displayedChars, setDisplayedChars] = useState(0);

  // When modifications change, we want to animate the latest one
  useEffect(() => {
    if (modifications.length === 0) return;
    
    const latestMod = modifications[modifications.length - 1];
    const targetLen = latestMod.new_content.length;
    
    setDisplayedChars(0);
    
    let current = 0;
    const interval = setInterval(() => {
      current += Math.max(1, Math.floor(targetLen / 20)); // Animate in ~20 steps
      if (current >= targetLen) {
        setDisplayedChars(targetLen);
        clearInterval(interval);
      } else {
        setDisplayedChars(current);
      }
    }, 30);
    
    return () => clearInterval(interval);
  }, [modifications]);

  const liveDocElements = useMemo(() => {
    if (!originalText) return [];

    let parts: { text: string; type: 'normal' | 'removed' | 'added' | 'typing' }[] = [
      { text: originalText, type: 'normal' },
    ];

    modifications.forEach((mod, index) => {
      const searchFor = (mod.original_excerpt || '').trim();
      if (searchFor.length < 5) return;

      const isLatest = index === modifications.length - 1;

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
          
          if (isLatest) {
            newParts.push({ text: searchFor, type: 'removed' });
            const typedText = mod.new_content.substring(0, displayedChars);
            newParts.push({ text: typedText, type: 'typing' });
          } else {
            newParts.push({ text: searchFor, type: 'removed' });
            newParts.push({ text: mod.new_content, type: 'added' });
          }
          
          if (after)  newParts.push({ text: after,  type: 'normal' });
        } else {
          newParts.push(part);
        }
      });
      parts = newParts;
    });

    return parts;
  }, [originalText, modifications, displayedChars]);

  // Auto-scroll to the typing element
  useEffect(() => {
    const typingEl = document.getElementById('typing-cursor');
    if (typingEl) {
      typingEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, [displayedChars]);

  return (
    <div className="max-w-[21cm] mx-auto bg-white shadow-md border border-slate-200 min-h-[1000px] p-12">
      <div className="whitespace-pre-wrap font-serif text-slate-800 leading-relaxed text-sm">
        {liveDocElements.map((part, idx) => {
          if (part.type === 'removed') {
            return (
              <span
                key={idx}
                className="bg-red-50 text-red-400 line-through decoration-red-300 mx-0.5 px-0.5 rounded opacity-50"
              >
                {part.text}
              </span>
            );
          }
          if (part.type === 'added') {
            return (
              <span
                key={idx}
                className="bg-green-100 text-green-800 font-medium px-1 rounded mx-0.5 border-b-2 border-green-300 transition-all"
              >
                {part.text}
              </span>
            );
          }
          if (part.type === 'typing') {
            return (
              <span
                key={idx}
                className="bg-indigo-100 text-indigo-900 font-bold px-1 rounded mx-0.5 border-b-2 border-indigo-400 shadow-sm"
              >
                {part.text}
                <span id="typing-cursor" className="inline-block w-1.5 h-4 bg-indigo-500 ml-0.5 animate-pulse align-middle" />
              </span>
            );
          }
          return <span key={idx}>{part.text}</span>;
        })}
      </div>
    </div>
  );
};

export default SmoothDocumentPreview;
