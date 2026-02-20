import React, { useRef, useState } from 'react';
import { Upload, FileText, CheckCircle, AlertCircle } from 'lucide-react';
import { extractTextFromDocx } from '../services/documentService';

interface FileUploadProps {
  onFileProcessed: (text: string, file: File) => void;
}

const FileUpload: React.FC<FileUploadProps> = ({ onFileProcessed }) => {
  const [isDragging, setIsDragging] = useState(false);
  const [fileName, setFileName] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [processing, setProcessing] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const processFile = async (file: File) => {
    if (file.type !== "application/vnd.openxmlformats-officedocument.wordprocessingml.document") {
      setError("Please upload a valid .docx file.");
      return;
    }
    
    setError(null);
    setProcessing(true);
    setFileName(file.name);

    try {
      const text = await extractTextFromDocx(file);
      onFileProcessed(text, file);
    } catch (err: any) {
      setError(err.message || "Failed to read file.");
      setFileName(null);
    } finally {
      setProcessing(false);
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      processFile(e.dataTransfer.files[0]);
    }
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      processFile(e.target.files[0]);
    }
  };

  return (
    <div className="w-full">
      <div
        onClick={() => fileInputRef.current?.click()}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        className={`
          relative flex flex-col items-center justify-center w-full h-48 rounded-xl border-2 border-dashed transition-all cursor-pointer
          ${isDragging ? 'border-indigo-500 bg-indigo-50' : 'border-slate-300 bg-slate-50 hover:bg-slate-100'}
          ${fileName ? 'border-green-500 bg-green-50' : ''}
        `}
      >
        <input
          type="file"
          ref={fileInputRef}
          onChange={handleChange}
          accept=".docx"
          className="hidden"
        />

        {processing ? (
          <div className="flex flex-col items-center text-indigo-600 animate-pulse">
            <FileText className="w-10 h-10 mb-2" />
            <p className="font-medium">Reading document...</p>
          </div>
        ) : fileName ? (
          <div className="flex flex-col items-center text-green-600">
            <CheckCircle className="w-10 h-10 mb-2" />
            <p className="font-medium">Loaded: {fileName}</p>
            <p className="text-xs text-green-500 mt-1">Click to change</p>
          </div>
        ) : (
          <div className="flex flex-col items-center text-slate-500">
            <Upload className="w-10 h-10 mb-2" />
            <p className="font-medium">Drop your resume (.docx) here</p>
            <p className="text-sm mt-1">or click to browse</p>
          </div>
        )}
      </div>

      {error && (
        <div className="flex items-center gap-2 mt-3 text-red-500 text-sm bg-red-50 p-3 rounded-lg">
          <AlertCircle className="w-4 h-4" />
          <span>{error}</span>
        </div>
      )}
    </div>
  );
};

export default FileUpload;