import { useState } from 'react';
import type { Action, Object as GameObject, Project, StandardInteraction, Verb } from './contracts';
import type { ProjectEdit } from './projectHistory';
import { request } from './api';
import { availableInteractions, interactionPattern, localMessage } from './containerModel';
import { commandPreview } from './authoring';
import { flows, id } from './model';
import { Check, Field, Select, Text } from './Forms';
import Modal from './Modal';

const normalized = (text: string) =>
  text
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
type Choice = { kind: StandardInteraction; checked: boolean; verb: string; phrase: string };
function conflicts(p: Project, object: GameObject, kind: StandardInteraction, verb: string) {
  const pattern = interactionPattern(kind, object.id);
  return flows(p).filter(
    (a) =>
      'verb' in a &&
      !('standard' in a && a.standard) &&
      a.verb === verb &&
      a.pattern.length === pattern.length &&
      a.pattern.every((part, i) => {
        const proposed = pattern[i];
        if (proposed.type === 'object_input')
          return part.type === 'entity' && p.objects.some((o) => o.id === part.entity);
        return JSON.stringify(part) === JSON.stringify(proposed);
      }),
  );
}
export default function ContainerSetup({
  project: p,
  object,
  edit,
  select,
  close,
}: {
  project: Project;
  object: GameObject;
  edit: ProjectEdit;
  select: (id: string) => void;
  close: () => void;
}) {
  const offered = availableInteractions(object);
  const [choices, setChoices] = useState<Choice[]>(() =>
    offered.map((item) => {
      const verb =
        p.vocabulary.find((v) =>
          [v.canonical, ...v.synonyms].some(
            (phrase) => normalized(phrase) === normalized(item.verb),
          ),
        )?.id ?? '@new';
      const exists = object.actions.some((a) => a.standard?.interaction === item.kind);
      return {
        kind: item.kind,
        phrase: item.verb,
        verb,
        checked: !exists && !conflicts(p, object, item.kind, verb).length,
      };
    }),
  );
  const [review, setReview] = useState<{ actions: Action[]; verbs: Verb[] } | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState('');
  const patch = (kind: StandardInteraction, value: Partial<Choice>) =>
    setChoices((old) => old.map((row) => (row.kind === kind ? { ...row, ...value } : row)));
  const prepare = async () => {
    setBusy(true);
    setProblem('');
    try {
      const verbs: Verb[] = [];
      const interactions = choices
        .filter((row) => row.checked)
        .map((row) => {
          let verb = row.verb;
          if (verb === '@new') {
            const phrase = normalized(row.phrase);
            if (
              !phrase ||
              ['look', 'inventory', 'help', 'hint', 'save', 'load', 'saves', 'quit'].includes(
                phrase,
              ) ||
              /^(help|hint|save|load) /.test(phrase)
            )
              throw new Error('Choose a non-reserved verb phrase.');
            const existing = [...p.vocabulary, ...verbs].find((v) =>
              [v.canonical, ...v.synonyms].some((name) => normalized(name) === phrase),
            );
            if (existing) verb = existing.id;
            else {
              verb = id();
              verbs.push({ id: verb, canonical: row.phrase.trim(), synonyms: [], event: null });
            }
          }
          return { interaction: row.kind, verb };
        });
      const actions = await request<Action[]>('/templates/container-actions', 'POST', {
        object,
        interactions,
      });
      setReview({ actions, verbs });
    } catch (e) {
      setProblem(String(e));
    } finally {
      setBusy(false);
    }
  };
  const preview = review ? { ...p, vocabulary: [...p.vocabulary, ...review.verbs] } : p;
  return (
    <Modal
      title={`Set up interactions for ${object.name}`}
      close={close}
      className="container-setup"
    >
      <div className="section-heading">
        <h2>Set up standard interactions</h2>
        <button onClick={close}>Cancel</button>
      </div>
      <p>
        For {object.name}. Commands become ordinary editable actions. Custom actions take
        precedence; failed requirements never fall through to a default.
      </p>
      {!review ? (
        <>
          {choices.map((row) => {
            const item = offered.find((i) => i.kind === row.kind)!;
            const existing = object.actions.find((a) => a.standard?.interaction === row.kind);
            const overlaps = conflicts(p, object, row.kind, row.verb);
            return (
              <fieldset className="interaction-choice" key={row.kind} disabled={!!existing}>
                <Check
                  label={item.name}
                  value={row.checked}
                  onChange={(checked) => patch(row.kind, { checked })}
                />
                {existing ? (
                  <p>
                    Already added: {existing.name}
                    {existing.standard?.enabled ? '' : ' (disabled)'}. Edit it from Actions.
                  </p>
                ) : (
                  <>
                    <Select
                      label={`${item.name} verb`}
                      value={row.verb}
                      items={[
                        ...p.vocabulary.map((v) => ({ id: v.id, name: v.canonical })),
                        { id: '@new', name: 'Create missing verb…' },
                      ]}
                      onChange={(verb) => patch(row.kind, { verb })}
                    />
                    {row.verb === '@new' && (
                      <Text
                        label={`${item.name} new verb`}
                        value={row.phrase}
                        onChange={(phrase) => patch(row.kind, { phrase })}
                      />
                    )}
                    <p className="command-preview">
                      {commandPreview(
                        {
                          ...p,
                          vocabulary: [
                            ...p.vocabulary,
                            { id: '@new', canonical: row.phrase, synonyms: [], event: null },
                          ],
                        },
                        row.verb,
                        interactionPattern(row.kind, object.id),
                      )}
                    </p>
                    {!!overlaps.length && (
                      <p className="contents-notice">
                        Existing custom command:{' '}
                        {overlaps.map((a) => a.name || 'Unnamed action').join(', ')}. It will keep
                        precedence. This interaction starts unchecked.
                      </p>
                    )}
                  </>
                )}
              </fieldset>
            );
          })}
          <button
            className="primary"
            disabled={busy || !choices.some((c) => c.checked)}
            onClick={() => void prepare()}
          >
            {busy ? 'Preparing…' : 'Review commands'}
          </button>
        </>
      ) : (
        <>
          {!!review.verbs.length && (
            <p className="contents-notice">
              New vocabulary: {review.verbs.map((v) => v.canonical).join(', ')}.
            </p>
          )}
          {review.actions.map((action, index) => (
            <section className="interaction-review" key={action.id}>
              <h3>{action.name}</h3>
              <p className="command-preview">
                {commandPreview(preview, action.verb, action.pattern)}
              </p>
              <Text
                label={`${action.name} refusal`}
                value={action.failure_text}
                onChange={(failure_text) =>
                  setReview({
                    ...review,
                    actions: review.actions.map((a, i) =>
                      i === index ? { ...a, failure_text } : a,
                    ),
                  })
                }
              />
              {action.effects
                .filter((e) => e.type === 'say' || e.type === 'say_with_inputs')
                .map((e, i) => (
                  <p key={i} className="muted">
                    Response:{' '}
                    {e.type === 'say'
                      ? e.text
                      : e.type === 'say_with_inputs'
                        ? localMessage(preview, e.references).display(e.text)
                        : ''}
                  </p>
                ))}
            </section>
          ))}
          <p className="muted">
            After adding, edit requirements, success messages, and logic in Actions. Locks use the
            existing property/requirement blocks.
          </p>
          <div className="inline">
            <button onClick={() => setReview(null)}>Back to choices</button>
            <button
              className="primary"
              onClick={() => {
                edit(
                  (draft) => {
                    draft.vocabulary.push(...review.verbs);
                    const target = draft.objects.find((o) => o.id === object.id)!;
                    for (const action of review.actions)
                      if (
                        !target.actions.some(
                          (a) => a.standard?.interaction === action.standard?.interaction,
                        )
                      )
                        target.actions.push(action);
                  },
                  { label: `Set up interactions for ${object.name}` },
                );
                close();
                if (review.actions[0]) select(review.actions[0].id);
              }}
            >
              Add reviewed interactions
            </button>
          </div>
        </>
      )}
      {problem && <p role="alert">{problem}</p>}
    </Modal>
  );
}
