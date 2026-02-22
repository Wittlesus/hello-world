import { useState } from 'react';
import { useTauriData } from '../hooks/useTauriData.js';
import { useProjectPath } from '../hooks/useProjectPath.js';
import { ViewShell } from './ViewShell.js';
import { LoadingState, ErrorState, EmptyState } from './LoadingState.js';

interface Question {
  id: string;
  question: string;
  context: string;
  status: 'open' | 'answered' | 'deferred';
  answer?: string;
  createdAt: string;
  answeredAt?: string;
}

interface StateData {
  questions: Question[];
}

const STATUS_STYLE: Record<string, string> = {
  open:     'bg-yellow-500/20 text-yellow-300',
  answered: 'bg-green-500/20 text-green-300',
  deferred: 'bg-gray-500/20 text-gray-400',
};

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function QuestionCard({ q }: { q: Question }) {
  const [expanded, setExpanded] = useState(false);
  const hasContent = q.context || q.answer;

  return (
    <button
      type="button"
      onClick={hasContent ? () => setExpanded((prev) => !prev) : undefined}
      className={`w-full text-left bg-[#1a1a24] border border-gray-800 rounded-lg p-4 transition-colors ${hasContent ? 'hover:border-gray-700 cursor-pointer' : 'cursor-default'}`}
    >
      <div className="flex items-start justify-between gap-3">
        <span className="text-sm font-medium text-gray-100 leading-snug">{q.question}</span>
        <span className="shrink-0 text-[10px] text-gray-500">{formatDate(q.createdAt)}</span>
      </div>

      <div className="flex items-center gap-2 mt-2">
        <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full ${STATUS_STYLE[q.status] ?? 'bg-gray-500/20 text-gray-300'}`}>
          {q.status}
        </span>
        {hasContent && (
          <span className="text-[10px] text-gray-600">{expanded ? '[-]' : '[+]'}</span>
        )}
      </div>

      {expanded && hasContent && (
        <div className="mt-3 pt-3 border-t border-gray-800 space-y-3">
          {q.context && (
            <div>
              <span className="text-[10px] uppercase tracking-wider text-gray-500 font-semibold">Context</span>
              <p className="text-xs text-gray-400 mt-1 leading-relaxed">{q.context}</p>
            </div>
          )}
          {q.answer && (
            <div>
              <span className="text-[10px] uppercase tracking-wider text-gray-500 font-semibold">Answer</span>
              <p className="text-xs text-gray-300 mt-1 leading-relaxed">{q.answer}</p>
              {q.answeredAt && (
                <p className="text-[10px] text-gray-600 mt-1">Answered {formatDate(q.answeredAt)}</p>
              )}
            </div>
          )}
        </div>
      )}
    </button>
  );
}

export function QuestionsView() {
  const projectPath = useProjectPath();
  const { data, loading, error, refetch } = useTauriData<StateData>('get_state', projectPath);

  if (loading) return <LoadingState />;
  if (error) return <ErrorState message={error} onRetry={refetch} />;

  const questions = data?.questions ?? [];
  const open = questions.filter(q => q.status === 'open');
  const answered = questions.filter(q => q.status === 'answered');
  const deferred = questions.filter(q => q.status === 'deferred');

  return (
    <ViewShell
      title="Questions"
      description={`${open.length} open · ${answered.length} answered · ${deferred.length} deferred`}
    >
      {questions.length === 0 ? (
        <EmptyState message="No known unknowns recorded" />
      ) : (
        <div className="space-y-6 max-w-3xl">
          {open.length > 0 && (
            <section>
              <h3 className="text-[10px] uppercase tracking-wider text-yellow-500/70 font-semibold mb-2">Open</h3>
              <div className="space-y-2">
                {[...open].reverse().map(q => <QuestionCard key={q.id} q={q} />)}
              </div>
            </section>
          )}
          {answered.length > 0 && (
            <section>
              <h3 className="text-[10px] uppercase tracking-wider text-green-500/70 font-semibold mb-2">Answered</h3>
              <div className="space-y-2">
                {[...answered].reverse().map(q => <QuestionCard key={q.id} q={q} />)}
              </div>
            </section>
          )}
          {deferred.length > 0 && (
            <section>
              <h3 className="text-[10px] uppercase tracking-wider text-gray-500 font-semibold mb-2">Deferred</h3>
              <div className="space-y-2">
                {[...deferred].reverse().map(q => <QuestionCard key={q.id} q={q} />)}
              </div>
            </section>
          )}
        </div>
      )}
    </ViewShell>
  );
}
