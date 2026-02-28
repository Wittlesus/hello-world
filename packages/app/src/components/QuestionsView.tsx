import { invoke } from '@tauri-apps/api/core';
import { useState } from 'react';
import { useProjectPath } from '../hooks/useProjectPath.js';
import { useTauriData } from '../hooks/useTauriData.js';
import { EmptyState, ErrorState, LoadingState } from './LoadingState.js';
import { ViewShell } from './ViewShell.js';

interface Question {
  id: string;
  question: string;
  context: string;
  status: 'open' | 'answered' | 'deferred';
  answer?: string;
  createdAt: string;
  answeredAt?: string;
  linkedTaskId?: string;
  linkedDecisionId?: string;
}

interface StateData {
  questions: Question[];
}

const STATUS_STYLE: Record<string, string> = {
  open: 'bg-yellow-500/20 text-yellow-300',
  answered: 'bg-green-500/20 text-green-300',
  deferred: 'bg-gray-500/20 text-gray-400',
};

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

interface AnswerPanelProps {
  q: Question;
  onClose: () => void;
}

function AnswerPanel({ q, onClose }: AnswerPanelProps) {
  const projectPath = useProjectPath();
  const [answer, setAnswer] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  async function handleSubmit() {
    if (!answer.trim() || !projectPath) return;
    setSubmitting(true);
    setError(null);
    try {
      await invoke('answer_question', { projectPath, id: q.id, answer: answer.trim() });
      setSuccess(true);
      setTimeout(() => onClose(), 1200);
    } catch (err) {
      setError(String(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="mt-2 bg-[#1a1a24] border border-gray-700 rounded-lg p-4 space-y-4">
      <div className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider">
        Answer this question
      </div>

      {success ? (
        <div className="text-sm text-green-400 py-2">Answer saved.</div>
      ) : (
        <>
          <div>
            <textarea
              className="w-full bg-[#0a0a0f] border border-gray-700 rounded p-2 text-sm text-gray-200 placeholder-gray-600 focus:outline-none focus:border-gray-500 resize-none"
              rows={3}
              placeholder="Type your answer..."
              value={answer}
              onChange={(e) => setAnswer(e.target.value)}
            />
          </div>

          {error && (
            <div className="text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded px-3 py-2">
              {error}
            </div>
          )}

          <div className="flex items-center gap-2 pt-1">
            <button
              type="button"
              onClick={handleSubmit}
              disabled={submitting || !answer.trim()}
              className="px-3 py-1.5 text-xs bg-blue-600/20 hover:bg-blue-600/30 text-blue-300 border border-blue-600/30 rounded transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {submitting ? 'Submitting...' : 'Submit'}
            </button>
            <button
              type="button"
              onClick={onClose}
              disabled={submitting}
              className="px-3 py-1.5 text-xs bg-gray-700/30 hover:bg-gray-700/50 text-gray-400 border border-gray-700 rounded transition-colors disabled:opacity-40"
            >
              Cancel
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function QuestionCard({ q }: { q: Question }) {
  const [expanded, setExpanded] = useState(false);
  const [answerOpen, setAnswerOpen] = useState(false);
  const hasContent = q.context || q.answer;
  const isOpen = q.status === 'open';

  return (
    <div className="space-y-0">
      <div className="bg-[#1a1a24] border border-gray-800 rounded-lg p-4">
        <div
          role={hasContent ? 'button' : undefined}
          tabIndex={hasContent ? 0 : undefined}
          onClick={hasContent ? () => setExpanded((prev) => !prev) : undefined}
          onKeyDown={
            hasContent
              ? (e) => {
                  if (e.key === 'Enter' || e.key === ' ') setExpanded((prev) => !prev);
                }
              : undefined
          }
          className={hasContent ? 'cursor-pointer' : undefined}
        >
          <div className="flex items-start justify-between gap-3">
            <span className="text-sm font-medium text-gray-100 leading-snug">{q.question}</span>
            <span className="shrink-0 text-[10px] text-gray-500">{formatDate(q.createdAt)}</span>
          </div>

          <div className="flex items-center gap-2 mt-2">
            <span
              className={`text-[10px] font-medium px-2 py-0.5 rounded-full ${STATUS_STYLE[q.status] ?? 'bg-gray-500/20 text-gray-300'}`}
            >
              {q.status}
            </span>
            {hasContent && (
              <span className="text-[10px] text-gray-600">{expanded ? '[-]' : '[+]'}</span>
            )}
          </div>
        </div>

        {expanded && hasContent && (
          <div className="mt-3 pt-3 border-t border-gray-800 space-y-3">
            {q.context && (
              <div>
                <span className="text-[10px] uppercase tracking-wider text-gray-500 font-semibold">
                  Context
                </span>
                <p className="text-xs text-gray-400 mt-1 leading-relaxed">{q.context}</p>
              </div>
            )}
            {q.answer && (
              <div>
                <span className="text-[10px] uppercase tracking-wider text-gray-500 font-semibold">
                  Answer
                </span>
                <p className="text-xs text-gray-300 mt-1 leading-relaxed">{q.answer}</p>
                {q.answeredAt && (
                  <p className="text-[10px] text-gray-600 mt-1">
                    Answered {formatDate(q.answeredAt)}
                  </p>
                )}
              </div>
            )}
            {(q.linkedTaskId || q.linkedDecisionId) && (
              <div className="flex items-center gap-2 pt-1">
                <span className="text-[10px] text-gray-600">routed to</span>
                {q.linkedTaskId && (
                  <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-blue-500/15 text-blue-300 border border-blue-500/20">
                    task {q.linkedTaskId}
                  </span>
                )}
                {q.linkedDecisionId && (
                  <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-purple-500/15 text-purple-300 border border-purple-500/20">
                    decision {q.linkedDecisionId}
                  </span>
                )}
              </div>
            )}
          </div>
        )}

        {isOpen && (
          <div className="mt-3 pt-3 border-t border-gray-800">
            <button
              type="button"
              onClick={() => setAnswerOpen((prev) => !prev)}
              className="text-[11px] px-2.5 py-1 bg-yellow-500/10 hover:bg-yellow-500/20 text-yellow-400 border border-yellow-500/20 rounded transition-colors"
            >
              {answerOpen ? 'Cancel' : 'Answer'}
            </button>
          </div>
        )}
      </div>

      {isOpen && answerOpen && <AnswerPanel q={q} onClose={() => setAnswerOpen(false)} />}
    </div>
  );
}

export function QuestionsView() {
  const projectPath = useProjectPath();
  const { data, loading, error, refetch } = useTauriData<StateData>('get_state', projectPath);

  if (loading) return <LoadingState />;
  if (error) return <ErrorState message={error} onRetry={refetch} />;

  const questions = data?.questions ?? [];
  const open = questions.filter((q) => q.status === 'open');
  const answered = questions.filter((q) => q.status === 'answered');
  const deferred = questions.filter((q) => q.status === 'deferred');

  return (
    <ViewShell
      title="Questions"
      description={`${open.length} open · ${answered.length} answered · ${deferred.length} deferred`}
    >
      {questions.length === 0 ? (
        <EmptyState message="No open questions. Use hw_add_question to log unknowns — Claude tracks these and surfaces them when relevant context arises." />
      ) : (
        <div className="space-y-6">
          {open.length > 0 && (
            <section>
              <h3 className="text-[10px] uppercase tracking-wider text-yellow-500/70 font-semibold mb-2">
                Open
              </h3>
              <div className="space-y-2">
                {[...open].reverse().map((q) => (
                  <QuestionCard key={q.id} q={q} />
                ))}
              </div>
            </section>
          )}
          {answered.length > 0 && (
            <section>
              <h3 className="text-[10px] uppercase tracking-wider text-green-500/70 font-semibold mb-2">
                Answered
              </h3>
              <div className="space-y-2">
                {[...answered].reverse().map((q) => (
                  <QuestionCard key={q.id} q={q} />
                ))}
              </div>
            </section>
          )}
          {deferred.length > 0 && (
            <section>
              <h3 className="text-[10px] uppercase tracking-wider text-gray-500 font-semibold mb-2">
                Deferred
              </h3>
              <div className="space-y-2">
                {[...deferred].reverse().map((q) => (
                  <QuestionCard key={q.id} q={q} />
                ))}
              </div>
            </section>
          )}
        </div>
      )}
    </ViewShell>
  );
}
QuestionsView.displayName = 'QuestionsView';
