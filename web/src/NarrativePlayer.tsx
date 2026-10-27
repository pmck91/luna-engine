import type { ConversationView, GameState, Project, QuestLogEntry, Span } from './contracts';
import Modal from './Modal';
export function StoryText({ spans, plain = false }: { spans: Span[]; plain?: boolean }) {
  return (
    <>
      {spans.map((s, i) => (
        <span
          key={i}
          style={{ color: !plain && s.colour ? `var(--colour-${s.colour})` : undefined }}
        >
          {s.text}
        </span>
      ))}
    </>
  );
}
export default function NarrativePlayer({
  project,
  view,
  plain,
  busy,
  select,
  pause,
}: {
  project: Project;
  view: ConversationView;
  plain: boolean;
  busy: boolean;
  select: (token: string, id: string, number: number) => void;
  pause: () => void;
}) {
  const c = project.conversations?.find((c) => c.id === view.conversation);
  const speaker = project.characters.find((s) => s.id === c?.character);
  return (
    <section
      className="narrative-dialogue-player"
      aria-label="Conversation choices"
      aria-busy={busy}
    >
      <p className="narrative-current-dialogue" aria-label="Current dialogue">
        {view.prompt.length ? (
          <StoryText spans={view.prompt} plain={plain} />
        ) : (
          <strong>{speaker?.name ?? 'Conversation'}</strong>
        )}
      </p>
      {!view.selection_enabled && (
        <p role="note">Answer or cancel the pending command before choosing a reply.</p>
      )}
      <ol>
        {view.replies.map((reply, index) => (
          <li key={reply.id}>
            <button
              disabled={busy || !view.selection_enabled}
              onClick={() => select(view.offer_token, reply.id, index + 1)}
            >
              {index + 1}. <StoryText spans={reply.text} plain={plain} />
            </button>
          </li>
        ))}
      </ol>
      <button disabled={busy || !view.selection_enabled} onClick={pause}>
        Pause conversation
      </button>
    </section>
  );
}
export function NarrativeJournal({
  entries,
  plain,
  close,
}: {
  entries: QuestLogEntry[];
  plain: boolean;
  close: () => void;
}) {
  return (
    <Modal title="Quest log" close={close}>
      <div className="section-heading">
        <h2>Quest log</h2>
        <button onClick={close}>Close</button>
      </div>
      {!entries.length && <p>No quests recorded yet.</p>}
      {entries.map((q) => (
        <section key={q.quest} className="narrative-journal">
          <h3>
            {q.title} · {q.status}
          </h3>
          {q.journal.map((entry, index) => (
            <p key={index}>
              <StoryText spans={entry.text} plain={plain} />
            </p>
          ))}
        </section>
      ))}
    </Modal>
  );
}
export function NarrativeProgressInspector({
  project,
  state,
  reveal,
  sourceCurrent,
}: {
  sourceCurrent: boolean;
  project: Project;
  state: GameState;
  reveal: (id: string) => void;
}) {
  return (
    <details>
      <summary>Narrative progress</summary>
      {!sourceCurrent && (
        <p className="muted">
          This session uses earlier game content. Restart with the latest edits to open its sources.
        </p>
      )}
      <p>
        Active conversation:{' '}
        {project.conversations?.find((c) => c.id === state.narrative?.active)?.name ?? 'None'}
      </p>
      {Object.entries(state.narrative?.conversations ?? {}).map(([id, value]) => (
        <div key={id}>
          <button disabled={!sourceCurrent} onClick={() => reveal(id)}>
            {project.conversations?.find((c) => c.id === id)?.name ?? id}
          </button>
          <p>
            {value?.checkpoint?.type ?? 'Closed'} · Visited {value?.visited.length} · Chosen{' '}
            {value?.chosen.length}
          </p>
          {value?.checkpoint && (
            <button disabled={!sourceCurrent} onClick={() => reveal(value.checkpoint!.node)}>
              Open checkpoint dialogue
            </button>
          )}
          {value && (
            <details>
              <summary>Visited dialogue and chosen replies</summary>
              {value.visited.map((node) => (
                <button key={node} disabled={!sourceCurrent} onClick={() => reveal(node)}>
                  Visited ·{' '}
                  {project.conversations?.find((c) => c.id === id)?.nodes.find((n) => n.id === node)
                    ?.name ?? node}
                </button>
              ))}
              {value.chosen.map((reply) => (
                <button key={reply} disabled={!sourceCurrent} onClick={() => reveal(reply)}>
                  Chosen ·{' '}
                  {project.conversations
                    ?.find((c) => c.id === id)
                    ?.nodes.flatMap((n) => n.replies)
                    .find((r) => r.id === reply)?.text ?? reply}
                </button>
              ))}
            </details>
          )}
        </div>
      ))}
      {Object.entries(state.narrative?.quests ?? {}).map(([id, value]) => (
        <div key={id}>
          <button disabled={!sourceCurrent} onClick={() => reveal(id)}>
            {project.quests?.find((q) => q.id === id)?.title ?? id} · {value?.status}
          </button>
          {value?.stages.map((stage) => (
            <button key={stage} onClick={() => reveal(stage)}>
              Open recorded stage ·{' '}
              {project.quests?.find((q) => q.id === id)?.stages.find((s) => s.id === stage)?.name ??
                stage}
            </button>
          ))}
        </div>
      ))}
    </details>
  );
}
