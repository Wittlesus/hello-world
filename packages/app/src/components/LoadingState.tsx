export function LoadingState({ label }: { label?: string }) {
  return (
    <div className="flex-1 flex items-center justify-center gap-3">
      <span className="inline-block w-4 h-4 border-2 border-gray-600 border-t-gray-300 rounded-full animate-spin" />
      <span className="text-sm text-gray-500">{label ?? 'Loading...'}</span>
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="flex-1 flex flex-col items-center justify-center gap-3">
      <span className="text-sm text-red-400">{message}</span>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="text-xs px-3 py-1 rounded bg-gray-800 text-gray-300 hover:bg-gray-700 transition-colors cursor-pointer"
        >
          Retry
        </button>
      )}
    </div>
  );
}

export function EmptyState({ message }: { message: string }) {
  return (
    <div className="flex items-center justify-center min-h-[120px] border border-dashed border-gray-800 rounded-lg">
      <span className="text-sm text-gray-600">{message}</span>
    </div>
  );
}
