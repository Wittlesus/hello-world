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

type RouteType = 'none' | 'task' | 'decision';

interface AnswerPanelProps {
  q: Question;
  onClose: () => void;
}

function AnswerPanel({ q, onClose }: AnswerPanelProps) {
  const [answer, setAnswer] = useState('');
  const [routeType, setRouteType] = useState<RouteType>('none');
  const [taskTitle, setTaskTitle] = useState('');
  const [taskDescription, setTaskDescription] = useState('');
  const [decisionTitle, setDecisionTitle] = useState('');
  const [decisionContext, setDecisionContext] = useState('');
  const [decisionChosen, setDecisionChosen] = useState('');
  const [decisionRationale, setDecisionRationale] = useState('');
  const [decisionDecidedBy, setDecisionDecidedBy] = useState<'pat' | 'claude' | 'both'>('pat');
  const [copied, setCopied] = useState(false);

  function buildCommand(): string {
    const lines: string[] = [];
    lines.push(`hw_answer_question({`);
    lines.push(`  id: "${q.id}",`);
    lines.push(`  answer: ${JSON.stringify(answer || 'your answer here')},`);

    if (routeType === 'task' && taskTitle.trim()) {
      lines.push(`  route: {`);
      lines.push(`    type: "task",`);
      lines.push(`    title: ${JSON.stringify(taskTitle)},`);
      if (taskDescription.trim()) {
        lines.push(`    description: ${JSON.stringify(taskDescription)},`);
      }
      lines.push(`  },`);
    } else if (routeType === 'decision' && decisionTitle.trim()) {
      lines.push(`  route: {`);
      lines.push(`    type: "decision",`);
      lines.push(`    title: ${JSON.stringify(decisionTitle)},`);
      lines.push(`    context: ${JSON.stringify(decisionContext || '')},`);
      lines.push(`    chosen: ${JSON.stringify(decisionChosen || '')},`);
      lines.push(`    rationale: ${JSON.stringify(decisionRationale || '')},`);
      lines.push(`    decidedBy: "${decisionDecidedBy}",`);
      lines.push(`  },`);
    }

    lines.push(`})`);
    return lines.join('\n');
  }

  async function handleCopy() {
    const cmd = buildCommand();
    try {
      await navigator.clipboard.writeText(cmd);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // clipboard not available — ignore
    }
  }

  const inputClass =
    'w-full bg-[#0a0a0f] border border-gray-700 rounded p-2 text-sm text-gray-200 placeholder-gray-600 focus:outline-none focus:border-gray-500';
  const labelClass = 'text-[10px] uppercase tracking-wider text-gray-500 font-semibold mb-1 block';

  return (
    <div className="mt-2 bg-[#1a1a24] border border-gray-700 rounded-lg p-4 space-y-4">
      <div className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider">
        Answer this question
      </div>

      <div>
        <label className={labelClass}>Answer</label>
        <textarea
          className={`${inputClass} resize-none`}
          rows={3}
          placeholder="Type your answer..."
          value={answer}
          onChange={(e) => setAnswer(e.target.value)}
        />
      </div>

      <div>
        <label className={labelClass}>Route (optional)</label>
        <div className="flex gap-4">
          {(['none', 'task', 'decision'] as RouteType[]).map((rt) => (
            <label key={rt} className="flex items-center gap-1.5 cursor-pointer">
              <input
                type="radio"
                name={`route-${q.id}`}
                value={rt}
                checked={routeType === rt}
                onChange={() => setRouteType(rt)}
                className="accent-blue-500"
              />
              <span className="text-xs text-gray-400">
                {rt === 'none' ? 'No route' : rt === 'task' ? 'Create task' : 'Record decision'}
              </span>
            </label>
          ))}
        </div>
      </div>

      {routeType === 'task' && (
        <div className="space-y-3 pl-3 border-l border-gray-700">
          <div>
            <label className={labelClass}>Task title</label>
            <input
              type="text"
              className={inputClass}
              placeholder="Task title..."
              value={taskTitle}
              onChange={(e) => setTaskTitle(e.target.value)}
            />
          </div>
          <div>
            <label className={labelClass}>Description (optional)</label>
            <input
              type="text"
              className={inputClass}
              placeholder="Task description..."
              value={taskDescription}
              onChange={(e) => setTaskDescription(e.target.value)}
            />
          </div>
        </div>
      )}

      {routeType === 'decision' && (
        <div className="space-y-3 pl-3 border-l border-gray-700">
          <div>
            <label className={labelClass}>Decision title</label>
            <input
              type="text"
              className={inputClass}
              placeholder="Decision title..."
              value={decisionTitle}
              onChange={(e) => setDecisionTitle(e.target.value)}
            />
          </div>
          <div>
            <label className={labelClass}>Context</label>
            <input
              type="text"
              className={inputClass}
              placeholder="Why this decision was needed..."
              value={decisionContext}
              onChange={(e) => setDecisionContext(e.target.value)}
            />
          </div>
          <div>
            <label className={labelClass}>Chosen option</label>
            <input
              type="text"
              className={inputClass}
              placeholder="What was chosen..."
              value={decisionChosen}
              onChange={(e) => setDecisionChosen(e.target.value)}
            />
          </div>
          <div>
            <label className={labelClass}>Rationale</label>
            <input
              type="text"
              className={inputClass}
              placeholder="Why this option was chosen..."
              value={decisionRationale}
              onChange={(e) => setDecisionRationale(e.target.value)}
            />
          </div>
          <div>
            <label className={labelClass}>Decided by</label>
            <div className="flex gap-4">
              {(['pat', 'claude', 'both'] as const).map((by) => (
                <label key={by} className="flex items-center gap-1.5 cursor-pointer">
                  <input
                    type="radio"
                    name={`decidedBy-${q.id}`}
                    value={by}
                    checked={decisionDecidedBy === by}
                    onChange={() => setDecisionDecidedBy(by)}
                    className="accent-blue-500"
                  />
                  <span className="text-xs text-gray-400 capitalize">{by}</span>
                </label>
              ))}
            </div>
          </div>
        </div>
      )}

      <div>
        <label className={labelClass}>MCP command</label>
        <pre className="bg-[#0a0a0f] border border-gray-700 rounded p-2 text-[11px] text-green-300 font-mono whitespace-pre overflow-x-auto">
          {buildCommand()}
        </pre>
      </div>

      <div className="flex items-center gap-2 pt-1">
        <button
          type="button"
          onClick={handleCopy}
          className="px-3 py-1.5 text-xs bg-blue-600/20 hover:bg-blue-600/30 text-blue-300 border border-blue-600/30 rounded transition-colors"
        >
          {copied ? 'Copied!' : 'Copy MCP command'}
        </button>
        <button
          type="button"
          onClick={onClose}
          className="px-3 py-1.5 text-xs bg-gray-700/30 hover:bg-gray-700/50 text-gray-400 border border-gray-700 rounded transition-colors"
        >
          Close
        </button>
      </div>
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
