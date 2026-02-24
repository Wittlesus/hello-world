import { useState, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { X, FileImage, FileVideo, File } from 'lucide-react';
import { useProjectPath } from '../hooks/useProjectPath.js';

interface SharedFile {
  path: string;
  name: string;
  type: 'image' | 'video' | 'other';
  previewUrl: string;
}

function fileType(name: string): 'image' | 'video' | 'other' {
  const ext = (name.split('.').pop() ?? '').toLowerCase();
  if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'svg', 'ico', 'avif'].includes(ext)) return 'image';
  if (['mp4', 'webm', 'mov', 'avi', 'mkv', 'ogg'].includes(ext)) return 'video';
  return 'other';
}

export function FilesView() {
  const projectPath = useProjectPath();
  const [files, setFiles] = useState<SharedFile[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const [saving, setSaving] = useState(false);
  const dragCounter = useRef(0);

  const processFiles = async (fileList: FileList) => {
    if (!projectPath || !fileList.length) return;
    setSaving(true);
    for (const file of Array.from(fileList)) {
      try {
        const buffer = await file.arrayBuffer();
        const data = Array.from(new Uint8Array(buffer));
        const savedPath = await invoke<string>('save_shared_file', {
          projectPath,
          filename: file.name,
          data,
        });
        const previewUrl = URL.createObjectURL(file);
        setFiles((prev) => {
          if (prev.some((f) => f.path === savedPath)) return prev;
          return [...prev, { path: savedPath, name: file.name, type: fileType(file.name), previewUrl }];
        });
      } catch (err) {
        console.error('save_shared_file failed:', err);
      }
    }
    setSaving(false);
  };

  const onDragEnter = (e: React.DragEvent) => {
    e.preventDefault();
    dragCounter.current++;
    setDragOver(true);
  };
  const onDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    dragCounter.current--;
    if (dragCounter.current === 0) setDragOver(false);
  };
  const onDragOver = (e: React.DragEvent) => { e.preventDefault(); };
  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    dragCounter.current = 0;
    setDragOver(false);
    if (e.dataTransfer.files.length) processFiles(e.dataTransfer.files);
  };

  const remove = (path: string) => setFiles((prev) => prev.filter((f) => f.path !== path));
  const clear = () => setFiles([]);

  return (
    <div className="flex-1 flex flex-col min-h-0 p-4">

      <div className="flex items-center justify-between mb-3 shrink-0">
        <div>
          <h2 className="text-sm font-semibold text-white">Shared Files</h2>
          <p className="text-[11px] text-gray-500 mt-0.5">
            Drop images or videos here — copied to .hello-world/shared-files/ for Claude to read.
          </p>
        </div>
        <div className="flex items-center gap-3">
          {saving && <span className="text-[11px] text-gray-500">Saving...</span>}
          {files.length > 0 && (
            <button onClick={clear} className="text-[11px] text-gray-600 hover:text-gray-400 transition-colors">
              Clear all
            </button>
          )}
        </div>
      </div>

      <div
        onDragEnter={onDragEnter}
        onDragLeave={onDragLeave}
        onDragOver={onDragOver}
        onDrop={onDrop}
        className={`flex-1 rounded-lg border-2 border-dashed transition-colors overflow-y-auto ${
          dragOver
            ? 'border-indigo-500/60 bg-indigo-500/5'
            : files.length === 0
            ? 'border-gray-700/50'
            : 'border-transparent'
        }`}
      >
        {files.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center gap-2 text-gray-600 pointer-events-none select-none">
            <FileImage size={32} className="opacity-30" />
            <p className="text-sm">Drop images or videos</p>
            <p className="text-[11px] opacity-60">Files are saved to .hello-world/shared-files/</p>
          </div>
        ) : (
          <div className="p-3" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: '12px' }}>
            {files.map((f) => (
              <FileCard key={f.path} file={f} onRemove={() => remove(f.path)} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function FileCard({ file, onRemove }: { file: SharedFile; onRemove: () => void }) {
  const [copied, setCopied] = useState(false);

  const copyPath = () => {
    navigator.clipboard.writeText(file.path).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  return (
    <div className="bg-gray-900/60 border border-gray-800/60 rounded-lg overflow-hidden group relative">
      <button
        onClick={onRemove}
        className="absolute top-1.5 right-1.5 z-10 w-5 h-5 rounded bg-black/60 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity text-gray-400 hover:text-white"
      >
        <X size={10} />
      </button>

      <div className="w-full bg-black/30 flex items-center justify-center" style={{ height: '120px' }}>
        {file.type === 'image' ? (
          <img src={file.previewUrl} alt={file.name} className="w-full h-full object-contain" />
        ) : file.type === 'video' ? (
          <video src={file.previewUrl} className="w-full h-full object-contain" muted preload="metadata" />
        ) : (
          <File size={28} className="text-gray-700" />
        )}
      </div>

      <div className="p-2">
        <p className="text-[11px] font-medium text-gray-200 truncate" title={file.name}>{file.name}</p>
        <p className="text-[10px] text-gray-600 truncate mt-0.5 font-mono" title={file.path}>{file.path}</p>
        <button onClick={copyPath} className="mt-1.5 text-[10px] text-gray-600 hover:text-indigo-400 transition-colors">
          {copied ? 'Copied!' : 'Copy path'}
        </button>
      </div>
    </div>
  );
}
