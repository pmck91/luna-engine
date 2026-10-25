import { useEffect, useState } from 'react';
import type {
  CheckRun,
  CheckStart,
  CheckStep,
  GameState,
  HelpMode,
  PlaytestCheck,
  PlaytestSetup,
  PlaytestView,
  Project,
  SetupStatus,
} from './contracts';
import { request } from './api';
import { Check, ConditionEditor, Field, Select, StateInspector } from './Forms';
import Modal from './Modal';
import type { ProjectEdit } from './projectHistory';
import { checkChanged, checkStep, stateSummary, playContentKey } from './playtest';
import { flow } from './model';
import type { ExplanationRecord } from './explanations';

function Summary({ project, state }: { project: Project; state: GameState }) {
  const summary = stateSummary(project, state);
  const entityName = (id: string) =>
    [...project.locations, ...project.objects, ...project.characters].find((e) => e.id === id)
      ?.name ?? id;
  return (
    <div className="playtest-summary">
      <p>
        <strong>{summary.location}</strong> · {summary.ending}
      </p>
      <p>Player carrying: {summary.inventory.join(', ') || 'nothing'}</p>
      {summary.characters.map((c, i) => (
        <p key={i}>
          {c.name} · {c.location} · carrying {c.inventory.join(', ') || 'nothing'}
        </p>
      ))}
      <details>
        <summary>Variables and properties</summary>
        {Object.entries(state.variables).map(([name, value]) => (
          <p key={name}>
            {name}: {JSON.stringify(value)}
          </p>
        ))}
        {Object.entries(state.properties).flatMap(([id, values]) =>
          Object.entries(values ?? {}).map(([name, value]) => (
            <p key={`${id}/${name}`}>
              {entityName(id)} · {name}: {JSON.stringify(value)}
            </p>
          )),
        )}
      </details>
      <details>
        <summary>Visits, responses, and hints</summary>
        {Object.entries(state.visits).map(([id, count]) => (
          <p key={id}>
            {entityName(id)}: {count} visits
          </p>
        ))}
        <p>
          {Object.keys(state.sequences).length} response sequences;{' '}
          {Object.keys(state.hints).length} hint stages recorded.
        </p>
        {Object.entries(state.sequences).map(([id, cursor]) => (
          <p key={id}>
            Response {id}: position {cursor}
          </p>
        ))}
        {Object.entries(state.hints).map(([id, progress]) => (
          <p key={id}>
            Hint stage {id}: {progress?.clues_seen} clues
            {progress?.solution_seen ? ', solution seen' : ''}
          </p>
        ))}
      </details>
    </div>
  );
}

export default function PlaytestTools({
  project,
  play,
  history,
  historyUsable,
  initialStart,
  helpMode,
  initialSelection,
  edit,
  close,
  restore,
  openRun,
  revealFlow,
  isCurrent,
  explain,
}: {
  project: Project;
  play: PlaytestView | null;
  history: string[];
  historyUsable: boolean;
  initialStart: CheckStart;
  helpMode: HelpMode | '';
  initialSelection?: { setupId?: string; checkId?: string };
  edit: ProjectEdit;
  close: () => void;
  restore: (setup: PlaytestSetup) => Promise<void>;
  openRun: (run: CheckRun, project: Project, check: PlaytestCheck) => void;
  revealFlow: (id: string) => void;
  isCurrent: boolean;
  explain: (record: ExplanationRecord) => void;
}) {
  const setups = project.editor.playtest?.setups ?? [];
  const checks = project.editor.playtest?.checks ?? [];
  const [tab, setTab] = useState<'setups' | 'checks'>(
    initialSelection?.checkId ? 'checks' : 'setups',
  );
  const [selected, setSelected] = useState(initialSelection?.setupId ?? setups[0]?.id ?? '');
  const setup = setups.find((s) => s.id === selected);
  const [captureName, setCaptureName] = useState('');
  const [rename, setRename] = useState(setup?.name ?? '');
  const [compatibility, setCompatibility] = useState<SetupStatus | null>(null);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [editingState, setEditingState] = useState(false);
  const [draft, setDraft] = useState<PlaytestCheck | null>(
    () => checks.find((c) => c.id === initialSelection?.checkId) ?? null,
  );
  const [report, setReport] = useState<{
    run: CheckRun;
    project: Project;
    check: PlaytestCheck;
  } | null>(null);
  const saved = checks.find((c) => c.id === draft?.id);
  const changed = !!draft && checkChanged(saved, draft);
  useEffect(() => {
    setRename(setup?.name ?? '');
    setEditingState(false);
    setCompatibility(null);
    if (!setup) return;
    let current = true;
    void request<SetupStatus>('/playtests/setup-status', 'POST', {
      project,
      setup,
      help_mode: helpMode || null,
    })
      .then((status) => {
        if (current) setCompatibility(status);
      })
      .catch((e: Error) => {
        if (current) setMessage(e.message);
      });
    return () => {
      current = false;
    };
  }, [project, setup?.id, helpMode]);
  const task = async (run: () => Promise<void>) => {
    setBusy(true);
    setMessage('');
    try {
      await run();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  const modify = (update: (check: PlaytestCheck) => void) => {
    setDraft((old) => {
      if (!old) return old;
      const next = structuredClone(old);
      update(next);
      return next;
    });
    setReport(null);
  };
  const chooseCheck = (check: PlaytestCheck | null) => {
    if (changed && !window.confirm('Discard unsaved check changes?')) return;
    setDraft(check ? structuredClone(check) : null);
    setReport(null);
    setMessage('');
  };
  const patchStep = (index: number, patch: Partial<CheckStep>) =>
    modify((c) => {
      Object.assign(c.steps[index], patch);
    });
  const saveCheck = () => {
    if (!draft?.name.trim()) {
      setMessage('Give this check a name.');
      return;
    }
    const next = { ...draft, name: draft.name.trim() };
    edit(
      (p) => {
        p.editor.playtest ??= { setups: [], checks: [] };
        const index = p.editor.playtest.checks.findIndex((c) => c.id === next.id);
        if (index < 0) p.editor.playtest.checks.push(next);
        else p.editor.playtest.checks[index] = next;
      },
      { label: saved ? 'Edit playtest check' : 'Add playtest check' },
    );
    setDraft(next);
    setMessage('Check saved.');
  };
  const dismiss = () => {
    if (busy) return;
    if (changed && !window.confirm('Discard unsaved check changes?')) return;
    close();
  };
  const dependentChecks = setup
    ? checks.filter((c) => c.start.type === 'setup' && c.start.setup === setup.id)
    : [];
  return (
    <Modal title="Playtest setups and checks" close={dismiss} className="playtest-tools">
      <div className="section-heading">
        <h2>Setups &amp; checks</h2>
        <button onClick={dismiss} disabled={busy}>
          Close
        </button>
      </div>
      <fieldset disabled={busy} className="playtest-tools-body">
        <p className="muted">
          Saved with this project for author testing. Excluded from game exports and player saves.
        </p>
        <div
          role="tablist"
          aria-label="Playtest tools"
          className="playtest-tabs"
          onKeyDown={(event) => {
            if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
            event.preventDefault();
            const next =
              event.key === 'Home'
                ? 'setups'
                : event.key === 'End'
                  ? 'checks'
                  : tab === 'setups'
                    ? 'checks'
                    : 'setups';
            setTab(next);
            document.getElementById(`${next}-tab`)?.focus();
          }}
        >
          <button
            role="tab"
            tabIndex={tab === 'setups' ? 0 : -1}
            id="setups-tab"
            aria-selected={tab === 'setups'}
            aria-controls="setups-panel"
            onClick={() => setTab('setups')}
          >
            Setups
          </button>
          <button
            role="tab"
            tabIndex={tab === 'checks' ? 0 : -1}
            id="checks-tab"
            aria-selected={tab === 'checks'}
            aria-controls="checks-panel"
            onClick={() => setTab('checks')}
          >
            Checks
          </button>
        </div>
        {message && (
          <p role="status" className="playtest-notice">
            {message}
          </p>
        )}
        {tab === 'setups' ? (
          <section role="tabpanel" id="setups-panel" aria-labelledby="setups-tab">
            <form
              className="capture-setup"
              onSubmit={(event) => {
                event.preventDefault();
                void task(async () => {
                  if (!play) return;
                  const captured = await request<PlaytestSetup>(
                    `/playtests/${play.session}/capture`,
                    'POST',
                    { name: captureName },
                  );
                  edit(
                    (p) => {
                      p.editor.playtest ??= { setups: [], checks: [] };
                      p.editor.playtest.setups.push(captured);
                    },
                    { label: 'Capture playtest setup' },
                  );
                  setSelected(captured.id);
                  setCaptureName('');
                  setMessage('Setup captured from the active playtest.');
                });
              }}
            >
              <Field label="New setup name">
                <input
                  value={captureName}
                  maxLength={160}
                  onChange={(e) => setCaptureName(e.target.value)}
                  placeholder="At the door, carrying the key"
                />
              </Field>
              <button disabled={!play || !captureName.trim() || busy}>Capture current state</button>
            </form>
            {!play && <p className="muted">Start a playtest to capture a setup.</p>}
            {play && !isCurrent && (
              <p className="muted">
                The active session uses earlier game content. A capture keeps that state;
                compatibility is checked against your latest edits.
              </p>
            )}
            <Select
              label="Saved setup"
              value={selected}
              items={setups}
              onChange={(id) => {
                setSelected(id);
                setMessage('');
              }}
            />
            {setup ? (
              <>
                <Summary project={project} state={setup.state} />
                <p className="muted">
                  Captured from {setup.source.title} · {setup.source.content_version} · snapshot{' '}
                  {setup.source.revision.slice(0, 8)} · help {setup.source.help_mode}.
                </p>
                <p
                  className={compatibility?.compatible === false ? 'reference-error' : 'muted'}
                  aria-live="polite"
                >
                  {!compatibility
                    ? 'Checking compatibility…'
                    : compatibility.exact
                      ? 'Matches the latest game content.'
                      : compatibility.compatible
                        ? 'Compatible with latest edits. Restoring uses the captured state and the latest game logic.'
                        : compatibility.reason}
                </p>
                <p className="muted">
                  Restoring does not replay game-start or room-entry effects. Fresh start runs them
                  normally.
                </p>
                {editingState ? (
                  <StateInspector
                    savedSetup
                    key={setup.id}
                    project={project}
                    state={setup.state}
                    onApply={(state) =>
                      task(async () => {
                        const status = await request<SetupStatus>(
                          '/playtests/setup-status',
                          'POST',
                          {
                            project,
                            setup: { ...setup, state },
                            help_mode: helpMode || null,
                          },
                        );
                        if (!status.compatible)
                          throw new Error(status.reason ?? 'This state is incompatible.');
                        edit(
                          (p) => {
                            p.editor.playtest!.setups.find((s) => s.id === setup.id)!.state = state;
                          },
                          { label: 'Edit saved setup state' },
                        );
                        setEditingState(false);
                        setMessage('Setup state saved. The active playtest is unchanged.');
                      })
                    }
                  />
                ) : (
                  <div className="button-row">
                    <button
                      className="primary"
                      disabled={!compatibility?.compatible || busy}
                      onClick={() =>
                        void task(async () => {
                          await restore(setup);
                          close();
                        })
                      }
                    >
                      Restore with latest edits
                    </button>
                    <button
                      disabled={!compatibility?.compatible || busy}
                      onClick={() => setEditingState(true)}
                    >
                      Edit setup state
                    </button>
                  </div>
                )}
                <form
                  className="capture-setup"
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (!rename.trim()) return;
                    edit(
                      (p) => {
                        p.editor.playtest!.setups.find((s) => s.id === setup.id)!.name =
                          rename.trim();
                      },
                      { label: 'Rename playtest setup' },
                    );
                  }}
                >
                  <Field label="Setup name">
                    <input
                      value={rename}
                      maxLength={160}
                      onChange={(e) => setRename(e.target.value)}
                    />
                  </Field>
                  <button disabled={!rename.trim() || busy || rename === setup.name}>
                    Rename setup
                  </button>
                  <button
                    type="button"
                    disabled={busy || dependentChecks.length > 0}
                    onClick={() => {
                      edit(
                        (p) => {
                          p.editor.playtest!.setups = p.editor.playtest!.setups.filter(
                            (s) => s.id !== setup.id,
                          );
                        },
                        { label: 'Delete playtest setup' },
                      );
                      setSelected('');
                    }}
                  >
                    Delete setup
                  </button>
                </form>
                {dependentChecks.length > 0 && (
                  <p className="muted">
                    Used by {dependentChecks.map((c) => c.name).join(', ')}. Change those checks'
                    start before deleting this setup.
                  </p>
                )}
              </>
            ) : (
              <p className="muted">
                Capture a situation once, then return to it to test another path.
              </p>
            )}
          </section>
        ) : (
          <section role="tabpanel" id="checks-panel" aria-labelledby="checks-tab">
            <div className="capture-setup">
              <Select
                label="Saved check"
                value={saved?.id ?? ''}
                items={checks}
                onChange={(id) => chooseCheck(checks.find((c) => c.id === id) ?? null)}
              />
              <button
                disabled={busy}
                onClick={() => {
                  if (changed && !window.confirm('Discard unsaved check changes?')) return;
                  setDraft({
                    id: crypto.randomUUID(),
                    name: 'New check',
                    start: historyUsable ? initialStart : { type: 'fresh', location: null },
                    help_mode: helpMode || null,
                    steps:
                      historyUsable && history.length
                        ? history.map((c) => checkStep(c))
                        : [checkStep()],
                  });
                  setReport(null);
                  setMessage('');
                }}
              >
                New check
              </button>
            </div>
            {draft ? (
              <>
                <Field label="Check name">
                  <input
                    value={draft.name}
                    maxLength={160}
                    onChange={(e) =>
                      modify((c) => {
                        c.name = e.target.value;
                      })
                    }
                  />
                </Field>
                <Select
                  label="Check starts from"
                  value={
                    draft.start.type === 'setup'
                      ? draft.start.setup
                      : `fresh:${draft.start.location ?? ''}`
                  }
                  items={[
                    { id: 'fresh:', name: 'Fresh start · game starting location' },
                    ...project.locations.map((l) => ({
                      id: `fresh:${l.id}`,
                      name: `Fresh start · ${l.name}`,
                    })),
                    ...setups.map((s) => ({ id: s.id, name: `Setup · ${s.name}` })),
                  ]}
                  onChange={(value) =>
                    modify((c) => {
                      c.start = value.startsWith('fresh:')
                        ? { type: 'fresh', location: value.slice(6) || null }
                        : { type: 'setup', setup: value };
                    })
                  }
                />
                <Select
                  label="Check help mode"
                  value={draft.help_mode ?? ''}
                  items={[
                    { id: '', name: 'Use game setting' },
                    ...(['off', 'basic', 'full'] as const).map((id) => ({ id, name: id })),
                  ]}
                  onChange={(value) =>
                    modify((c) => {
                      c.help_mode = (value || null) as HelpMode | null;
                    })
                  }
                />
                <p className="muted">
                  Checks run against the latest edits in a separate session. Each expectation
                  applies immediately after its command. The run stops at the first failure.
                </p>
                {draft.steps.map((step, index) => (
                  <fieldset key={index} className="check-step">
                    <legend>Command {index + 1}</legend>
                    <Field label={`Command ${index + 1}`}>
                      <input
                        value={step.command}
                        maxLength={4096}
                        onChange={(e) => patchStep(index, { command: e.target.value })}
                      />
                    </Field>
                    <Field label="Reply contains (optional)">
                      <textarea
                        value={step.transcript ?? ''}
                        onChange={(e) => patchStep(index, { transcript: e.target.value || null })}
                        placeholder="Plain text from this command's reply"
                      />
                    </Field>
                    <Check
                      label="Expect a state condition"
                      value={!!step.condition}
                      onChange={(value) =>
                        patchStep(index, { condition: value ? { type: 'true' } : null })
                      }
                    />
                    {step.condition && (
                      <ConditionEditor
                        allowCreation={false}
                        project={project}
                        value={step.condition}
                        onChange={(condition) => patchStep(index, { condition })}
                      />
                    )}
                    <Select
                      label="Expected completion"
                      value={
                        step.completion?.type === 'playing'
                          ? 'playing'
                          : step.completion?.type === 'ended'
                            ? `ended:${step.completion.ending ?? ''}`
                            : ''
                      }
                      items={[
                        { id: '', name: 'No completion expectation' },
                        { id: 'playing', name: 'Still playing' },
                        { id: 'ended:', name: 'Any ending' },
                        ...project.game.endings.map((e) => ({
                          id: `ended:${e.id}`,
                          name: `Ending · ${e.name}`,
                        })),
                      ]}
                      onChange={(value) =>
                        patchStep(index, {
                          completion:
                            value === 'playing'
                              ? { type: 'playing' }
                              : value.startsWith('ended:')
                                ? { type: 'ended', ending: value.slice(6) || null }
                                : null,
                        })
                      }
                    />
                    <div className="button-row">
                      <button
                        disabled={index === 0 || busy}
                        onClick={() =>
                          modify((c) => {
                            [c.steps[index - 1], c.steps[index]] = [
                              c.steps[index],
                              c.steps[index - 1],
                            ];
                          })
                        }
                      >
                        Move command up
                      </button>
                      <button
                        disabled={index === draft.steps.length - 1 || busy}
                        onClick={() =>
                          modify((c) => {
                            [c.steps[index], c.steps[index + 1]] = [
                              c.steps[index + 1],
                              c.steps[index],
                            ];
                          })
                        }
                      >
                        Move command down
                      </button>
                      <button
                        disabled={busy}
                        onClick={() =>
                          modify((c) => {
                            c.steps.splice(index, 1);
                          })
                        }
                      >
                        Remove command
                      </button>
                    </div>
                  </fieldset>
                ))}
                <div className="button-row">
                  <button
                    disabled={busy || draft.steps.length >= 100}
                    onClick={() =>
                      modify((c) => {
                        c.steps.push(checkStep());
                      })
                    }
                  >
                    Add command
                  </button>
                  <button
                    disabled={busy || !history.length || !historyUsable}
                    onClick={() => {
                      if (
                        draft.steps.some((s) => s.command.trim()) &&
                        !window.confirm('Replace these commands with the active playtest history?')
                      )
                        return;
                      modify((c) => {
                        c.start = initialStart;
                        c.steps = history.map((s) => checkStep(s));
                      });
                    }}
                  >
                    Use command history
                  </button>
                </div>
                {!historyUsable && history.length > 0 && (
                  <p className="muted">
                    This history follows manual state changes or a changed setup. Capture and
                    restore a setup, then record commands to reuse them in a repeatable check.
                  </p>
                )}
                <div className="button-row">
                  <button disabled={busy || !changed || !draft.name.trim()} onClick={saveCheck}>
                    Save check
                  </button>
                  <button
                    className="primary"
                    disabled={
                      busy || !draft.steps.length || draft.steps.some((s) => !s.command.trim())
                    }
                    onClick={() =>
                      void task(async () => {
                        setReport(null);
                        const snapshot = structuredClone(project);
                        const check = structuredClone(draft);
                        const run = await request<CheckRun>('/playtests/checks', 'POST', {
                          project: snapshot,
                          check,
                          explain: true,
                        });
                        setReport({ run, project: snapshot, check });
                      })
                    }
                  >
                    {busy ? 'Running check…' : 'Run check'}
                  </button>
                  <button
                    disabled={busy || !saved}
                    onClick={() => {
                      edit(
                        (p) => {
                          p.editor.playtest!.checks = p.editor.playtest!.checks.filter(
                            (c) => c.id !== draft.id,
                          );
                        },
                        { label: 'Delete playtest check' },
                      );
                      setDraft(null);
                      setReport(null);
                    }}
                  >
                    Delete check
                  </button>
                  {changed && (
                    <span className="muted">
                      Unsaved check changes; Run checks the displayed draft.
                    </span>
                  )}
                </div>
                {report && (
                  <section className="check-results" aria-label="Check results" aria-live="polite">
                    <h3>
                      {report.run.passed
                        ? `Passed · ${report.run.steps.length} ${report.run.steps.length === 1 ? 'command' : 'commands'}`
                        : `Failed at command ${report.run.steps.find((s) => s.failures.length)!.index + 1}`}
                    </h3>
                    <p>
                      {report.check.name} · snapshot {report.run.source.revision.slice(0, 8)}. The
                      interactive playtest is unchanged.
                    </p>
                    <details>
                      <summary>Reproducible starting state</summary>
                      <Summary project={report.project} state={report.run.initial_state} />
                    </details>
                    <ol>
                      {report.run.steps.map((step) => (
                        <li key={step.index} className={step.failures.length ? 'check-failed' : ''}>
                          <strong>
                            {step.command} · {step.failures.length ? 'Failed' : 'Passed'}
                          </strong>
                          {step.result?.messages.map((line, i) => (
                            <p key={i}>{line.map((span) => span.text).join('')}</p>
                          ))}
                          {step.failures.map((failure) => (
                            <p key={failure} className="reference-error">
                              {failure}
                            </p>
                          ))}
                          {step.result?.explanation && (
                            <button
                              onClick={() => {
                                if (
                                  changed &&
                                  !window.confirm(
                                    'Discard unsaved check changes to inspect this command?',
                                  )
                                )
                                  return;
                                explain({
                                  explanation: step.result!.explanation!,
                                  project: report.project,
                                  source: report.run.source,
                                  contentKey: playContentKey(
                                    report.project,
                                    report.check.help_mode ?? '',
                                  ),
                                  help: report.check.help_mode ?? '',
                                  status: step.result!.status,
                                  origin: `Check · ${report.check.name} · command ${step.index + 1}`,
                                });
                                close();
                              }}
                            >
                              Explain command {step.index + 1}
                            </button>
                          )}
                          {step.result?.selected_flow &&
                            (playContentKey(project, report.check.help_mode ?? '') ===
                            playContentKey(report.project, report.check.help_mode ?? '') ? (
                              <button
                                onClick={() => {
                                  revealFlow(step.result!.selected_flow!);
                                  close();
                                }}
                              >
                                Inspect{' '}
                                {flow(report.project, step.result.selected_flow)?.name ||
                                  'selected action'}
                              </button>
                            ) : (
                              <p className="muted">
                                The game has changed since this run. Rerun the check to inspect its
                                current action.
                              </p>
                            ))}
                        </li>
                      ))}
                    </ol>
                    <details>
                      <summary>Resulting state</summary>
                      <Summary project={report.project} state={report.run.state} />
                    </details>
                    <button
                      onClick={() => {
                        openRun(report.run, report.project, report.check);
                        close();
                      }}
                    >
                      Open result in playtest
                    </button>
                  </section>
                )}
              </>
            ) : (
              <p className="muted">
                Create a check to replay commands from a fresh start or a saved setup. Add optional
                reply, state, or ending expectations.
              </p>
            )}
          </section>
        )}
      </fieldset>
    </Modal>
  );
}
