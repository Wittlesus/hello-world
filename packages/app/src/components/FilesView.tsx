import { useState, useEffect, useCallback, useRef } from 'react';
import { listen } from '@tauri-apps/api/event';
import { convertFileSrc } from '@tauri-apps/api/core';
import { X, FileImage, FileVideo, File } from 'lucide-react';

interface SharedFile {
  path: string;
  name: string;
  ext: string;
  previewUrl: string | null;
  type: 'image' | 'video' | 'other';
}

function fileType(ext: string): 'image' | 'video' | 'other' {
  if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'svg', 'ico', 'avif'].includes(ext)) return 'image';
  if (['mp4', 'webm', 'mov', 'avi', 'mkv', 'ogg'].includes(ext)) return 'video';
  return 'other';
}

function pathBasename(p: string) {
  return p.replace(/\\/g, '/').split('/').pop() ?? p;
}

function pathExt(name: string) {
  return (name.split('.').pop() ?? '').toLowerCase();
}

export function FilesView() {
  const [files, setFiles] = useState<SharedFile[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const dragCounter = useRef(0);

  const addPaths = useCallback((paths: string[]) => {
    const newFiles: SharedFile[] = paths.map((p) => {
      const name = pathBasename(p);
      const ext = pathExt(name);
      const type = fileType(ext);
      let previewUrl: string | null = null;
      if (type === 'image' || type === 'video') {
        try { previewUrl = convertFileSrc(p); } catch { /* ignore */ }
      }
      return { path: p, name, ext, type, previewUrl };
    });
    setFiles((prev) => {
      const existingPaths = new Set(prev.map((f) => f.path));
      return [...prev, ...newFiles.filter((f) => !existingPaths.has(f.path))];
    });
  }, []);

  // Tauri drag-drop gives us actual filesystem paths
  useEffect(() => {
    const unlisten = listen<{ paths: string[] }>('tauri://drag-drop', (e) => {
      if (e.payload?.paths?.length) addPaths(e.payload.paths);
    });
    return () => { unlisten.then((fn) => fn()); };
  }, [addPaths]);

  // HTML5 drag events for visual feedback
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
    // Tauri://drag-drop fires separately with paths — no need to handle files here
  };

  const remove = (path: string) => setFiles((prev) => prev.filter((f) => f.path !== path));
  const clear = () => setFiles([]);

  return (
    <div className="flex-1 flex flex-col min-h-0 p-4">

      {/* Header */}
      <div className="flex items-center justify-between mb-3 shrink-0">
        <div>
          <h2 className="text-sm font-semibold text-white">Shared Files</h2>
          <p className="text-[11px] text-gray-500 mt-0.5">
            Drop images or videos here. Claude can read them by path.
          </p>
        </div>
        {files.length > 0 && (
          <button
            onClick={clear}
            className="text-[11px] text-gray-600 hover:text-gray-400 transition-colors"
          >
            Clear all
          </button>
        )}
      </div>

      {/* Drop zone / file grid */}
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
          <div className="h-full flex flex-col items-center justify-center gap-2 text-gray-600 pointer-events-none">
            <FileImage size={32} className="opacity-30" />
            <p className="text-sm">Drop images or videos</p>
            <p className="text-[11px] opacity-60">Files stay on disk — Claude reads them by path</p>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3 p-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))' }}>
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
      {/* Remove button */}
      <button
        onClick={onRemove}
        className="absolute top-1.5 right-1.5 z-10 w-5 h-5 rounded bg-black/60 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity text-gray-400 hover:text-white"
      >
        <X size={10} />
      </button>

      {/* Preview */}
      <div className="w-full bg-black/30" style={{ height: '120px' }}>
        {file.type === 'image' && file.previewUrl ? (
          <img
            src={file.previewUrl}
            alt={file.name}
            className="w-full h-full object-contain"
          />
        ) : file.type === 'video' && file.previewUrl ? (
          <video
            src={file.previewUrl}
            className="w-full h-full object-contain"
            controls={false}
            muted
            preload="metadata"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-gray-700">
            {file.type === 'video' ? <FileVideo size={28} /> : <File size={28} />}
          </div>
        )}
      </div>

      {/* Info */}
      <div className="p-2">
        <p className="text-[11px] font-medium text-gray-200 truncate" title={file.name}>{file.name}</p>
        <p className="text-[10px] text-gray-600 truncate mt-0.5 font-mono" title={file.path}>{file.path}</p>
        <button
          onClick={copyPath}
          className="mt-1.5 text-[10px] text-gray-600 hover:text-indigo-400 transition-colors"
        >
          {copied ? 'Copied!' : 'Copy path'}
        </button>
      </div>
    </div>
  );
}
