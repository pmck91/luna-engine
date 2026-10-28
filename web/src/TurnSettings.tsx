import { gameDataPages } from './model';
import { useState } from 'react';
import type { Project, ActionTurnCost, TurnCost } from './contracts';
import type { ProjectEdit } from './projectHistory';
import { Check, Select } from './Forms';
import Modal from './Modal';
import { turnDefaults, turnCostChoices, turnUsages, turnUpgradeConflicts } from './turnModel';

export function TurnEnableReview({
  project,
  select,
}: {
  project: Project;
  select?: (id: string) => void;
}) {
  const conflicts = turnUpgradeConflicts(project);
  return (
    <>
      <p>
        Turns require content format 6 and a compatible Luna runner. WAIT spends one turn. Existing
        authored actions and replies spend one turn by default; looking, hints and failed
        requirements stay free.
      </p>
      <p>
        A timer scheduled after 3 turns fires after 3 subsequent charged inputs. The scheduling
        input is excluded. Help, inventory, quest log, clarification and save/load are always free.
      </p>
      {conflicts.length > 0 && (
        <div role="alert" className="reference-error">
          <p>
            Repair these reserved-command conflicts before enabling turns. WAIT reserves a whole
            command; longer commands such as “wait here” remain available. Games older than format 5
            also need their conversation and quest command prefixes repaired.
          </p>
          <ul>
            {conflicts.map((a) => (
              <li key={a.id}>
                {select ? (
                  <button onClick={() => select(a.vocabulary ? gameDataPages.vocabulary : a.id)}>
                    {a.name || 'Unnamed action'} · {a.owner}
                  </button>
                ) : (
                  `${a.name || 'Unnamed action'} · ${a.owner}`
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
      <p>
        This change can be undone. Running playtests keep their original settings until restarted.
      </p>
      <p>
        Existing saves and setups without a turn clock need a fresh playthrough after enabling
        turns.
      </p>
    </>
  );
}
export default function TurnSettings({
  project,
  edit,
  select,
}: {
  project: Project;
  edit: ProjectEdit;
  select: (id: string) => void;
}) {
  const [review, setReview] = useState<'enable' | 'disable' | null>(null);
  const policy = project.game.turns;
  const blockers = turnUsages(project);
  return (
    <section aria-label="Turn settings" className="turn-settings">
      <h3>Turns and scheduled events</h3>
      <Check
        label="Enable turns"
        value={!!policy}
        onChange={(enabled) => setReview(enabled ? 'enable' : 'disable')}
      />
      {policy ? (
        <>
          <p>
            Choose which accepted inputs spend one turn. Actions, exits and replies can override
            these defaults.
          </p>
          {(
            [
              ['actions', 'Successful actions and exits'],
              ['replies', 'Accepted conversation replies'],
              ['failed_requirements', 'Failed action requirements'],
              ['look', 'Look around'],
              ['hints', 'Hint requests'],
            ] as const
          ).map(([key, label]) => (
            <Check
              key={key}
              label={`${label} spend 1 turn`}
              value={policy[key]}
              onChange={(value) =>
                edit(
                  (p) => {
                    p.game.turns = { ...policy, [key]: value };
                  },
                  { label: 'Change turn policy' },
                )
              }
            />
          ))}
          <p className="muted">
            WAIT always spends 1 turn. Help, inventory, quest log, unresolved input, clarification
            and host controls are free.
          </p>
        </>
      ) : (
        <p className="muted">
          Enable a player-turn clock to schedule events. Games without turns keep their authored
          WAIT commands.
        </p>
      )}
      {review && (
        <Modal
          title={review === 'enable' ? 'Enable turns' : 'Disable turns'}
          close={() => setReview(null)}
        >
          <h2>{review === 'enable' ? 'Enable turns' : 'Disable turns'}</h2>
          {review === 'enable' ? (
            <TurnEnableReview
              project={project}
              select={(id) => {
                setReview(null);
                select(id);
              }}
            />
          ) : (
            <>
              <p>
                Disabling turns removes the game policy. Remove timer definitions, construction
                drafts, timer blocks and turn overrides first; no countdowns are silently suspended
                or deleted.
              </p>
              {blockers.length > 0 && (
                <div role="alert" className="reference-error">
                  <ul>
                    {blockers.map((s) => (
                      <li key={s}>{s}</li>
                    ))}
                  </ul>
                </div>
              )}
            </>
          )}
          <div className="inline">
            <button onClick={() => setReview(null)}>Cancel</button>
            <button
              className="primary"
              disabled={
                review === 'enable' ? turnUpgradeConflicts(project).length > 0 : blockers.length > 0
              }
              onClick={() => {
                edit(
                  (p) => {
                    if (review === 'enable') {
                      p.game.format_version = Math.max(6, p.game.format_version);
                      p.game.turns = turnDefaults();
                    } else delete p.game.turns;
                  },
                  { label: review === 'enable' ? 'Enable turns' : 'Disable turns' },
                );
                setReview(null);
              }}
            >
              {review === 'enable' ? 'Enable turns' : 'Disable turns'}
            </button>
          </div>
        </Modal>
      )}
    </section>
  );
}
export function ActionTurnSettings({
  project,
  value,
  change,
}: {
  project: Project;
  value?: ActionTurnCost;
  change: (value: ActionTurnCost | undefined) => void;
}) {
  if (!project.game.turns) return null;
  return (
    <fieldset>
      <legend>Turn cost</legend>
      {(
        [
          ['success', 'On success'],
          ['failed_requirements', 'When requirements fail'],
        ] as const
      ).map(([key, label]) => (
        <Select
          key={key}
          label={`${label} turn cost`}
          value={value?.[key] ?? 'default'}
          items={turnCostChoices}
          onChange={(cost) => {
            const next = {
              success: 'default' as TurnCost,
              failed_requirements: 'default' as TurnCost,
              ...value,
              [key]: cost as TurnCost,
            };
            change(
              next.success === 'default' && next.failed_requirements === 'default'
                ? undefined
                : next,
            );
          }}
        />
      ))}
      <p className="muted">
        A message-only action still uses this policy. Nested effects and timer callbacks do not
        spend additional turns.
      </p>
    </fieldset>
  );
}
