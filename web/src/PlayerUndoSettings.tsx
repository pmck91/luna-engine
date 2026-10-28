import { useEffect, useState } from 'react';
import type { PlayerUndoReview, Project } from './contracts';
import type { ProjectEdit } from './projectHistory';
import { request } from './api';
import { Check } from './Forms';
import { entity, flowOwner, gameDataPages } from './model';
import Modal from './Modal';

export default function PlayerUndoSettings({
  project,
  edit,
  select,
}: {
  project: Project;
  edit: ProjectEdit;
  select: (id: string) => void;
}) {
  const [review, setReview] = useState(false);
  const [checked, setChecked] = useState<{
    key: string;
    result?: PlayerUndoReview;
    error?: string;
  }>();
  const key = review ? JSON.stringify({ ...project, editor: undefined }) : '';
  useEffect(() => {
    if (!review) return;
    let active = true;
    void request<PlayerUndoReview>('/player-undo-review', 'POST', project).then(
      (result) => {
        if (active) setChecked({ key, result });
      },
      (error: unknown) => {
        if (active) setChecked({ key, error: String(error) });
      },
    );
    return () => {
      active = false;
    };
  }, [review, key]);
  const result = checked?.key === key ? checked.result : undefined;
  const error = checked?.key === key ? checked.error : undefined;
  const repair = (id: string) => {
    setReview(false);
    select(project.vocabulary.some((v) => v.id === id) ? gameDataPages.vocabulary : id);
  };
  const label = (id: string) => {
    const owner = flowOwner(project, id);
    const flow =
      owner?.actions.find((a) => a.id === id) ??
      project.locations.flatMap((l) => l.exits).find((e) => e.id === id);
    const room = project.locations.find((l) => l.exits.some((e) => e.id === id));
    return `${flow?.name || 'Unnamed command'} · ${owner ? ('title' in owner ? owner.title : owner.name) : (room?.name ?? 'Game')}`;
  };
  return (
    <div className="player-undo-settings">
      <Check
        label="Allow player undo"
        value={!!project.game.allow_player_undo}
        onChange={(enabled) => {
          if (enabled) {
            setChecked(undefined);
            setReview(true);
          } else
            edit(
              (p) => {
                delete p.game.allow_player_undo;
              },
              { label: 'Disable player undo' },
            );
        }}
      />
      <p>
        Let players take back recent game changes in this play session, including an ending. Off by
        default.
      </p>
      <p className="muted">
        Up to 20 actions; large games may retain fewer. Saving keeps history. Loading or restarting
        clears it. Running playtests keep their original settings until restarted.
      </p>
      <p className="muted">
        New hints stay known. Revealing a clue or solution clears earlier undo history.
      </p>
      {review && (
        <Modal title="Review player undo" close={() => setReview(false)}>
          <h2>Review player undo</h2>
          {project.game.format_version < 8 && (
            <p>
              This upgrades the project from content format {project.game.format_version} to 8.
              Exported games need a compatible Luna runner. Compatible story saves and captured
              setups are preserved.
            </p>
          )}
          <p>
            Players can type undo or use Undo last action in playtest to restore a complete game
            change. Project Undo remains separate.
          </p>
          <p>
            New hints stay known and clear earlier history. Loading, restarting or applying debug
            state starts a new history.
          </p>
          {!result && !error && <p role="status">Checking command compatibility…</p>}
          {error && (
            <p role="alert" className="reference-error">
              Could not review player undo: {error}. Cancel and try again.
            </p>
          )}
          {!!result?.conflicts.length && (
            <div role="alert" className="reference-error">
              <p>
                The exact command undo is used by these commands, including hidden or unavailable
                content. Rename them before enabling player undo, or cancel to keep their meaning.
              </p>
              <ul>
                {result.conflicts.map((id) => (
                  <li key={id}>
                    <button onClick={() => repair(id)}>{label(id)}</button>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {!!result?.upgrade_errors.length && (
            <div role="alert" className="reference-error">
              <p>The content upgrade also needs these repairs:</p>
              <ul>
                {result.upgrade_errors.map((d, i) => (
                  <li key={i}>
                    <button onClick={() => repair(d.subject)}>
                      {entity(project, d.subject)?.name ??
                        project.vocabulary.find((v) => v.id === d.subject)?.canonical ??
                        'Game'}
                      : {d.message}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <p>
            Longer commands and an entity named “undo” remain available. This settings change can be
            undone through project Undo. Restart a running playtest to use it.
          </p>
          <div className="inline">
            <button onClick={() => setReview(false)}>Cancel</button>
            <button
              className="primary"
              disabled={!result || !!result.conflicts.length || !!result.upgrade_errors.length}
              onClick={() => {
                edit(
                  (p) => {
                    p.game.format_version = Math.max(8, p.game.format_version);
                    p.game.allow_player_undo = true;
                  },
                  { label: 'Enable player undo' },
                );
                setReview(false);
              }}
            >
              Enable player undo
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
