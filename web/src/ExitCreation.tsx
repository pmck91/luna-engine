import { useState } from 'react';
import type { Project } from './contracts';
import type { ProjectEdit } from './projectHistory';
import { exit } from './model';
import { Field, Select } from './Forms';
import Modal from './Modal';
export default function ExitCreation({
  project,
  source,
  edit,
  select,
  close,
}: {
  project: Project;
  source: string;
  edit: ProjectEdit;
  select: (id: string) => void;
  close: () => void;
}) {
  const [from, setFrom] = useState(source);
  const [to, setTo] = useState('');
  const [name, setName] = useState('');
  return (
    <Modal title="Add exit" close={close}>
      <div className="section-heading">
        <h2>Add exit</h2>
        <button onClick={close}>Cancel</button>
      </div>
      <p>Connect two rooms. This creates one direction; add a return exit separately.</p>
      <Select label="Source room" value={from} items={project.locations} onChange={setFrom} />
      <Select label="Target room" value={to} items={project.locations} onChange={setTo} />
      <Field label="Exit name">
        <input
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="east, garden, upstairs…"
        />
      </Field>
      <p className="muted">
        Players type <code>go {name.trim() || 'exit name'}</code>. Self-loops and multiple exits
        between rooms are allowed.
      </p>
      <button
        className="primary"
        disabled={!from || !to || !name.trim()}
        onClick={() => {
          const created = exit(to);
          created.name = name.trim();
          edit(
            (p) => {
              p.locations.find((room) => room.id === from)!.exits.push(created);
            },
            { label: 'Add exit' },
          );
          close();
          select(created.id);
        }}
      >
        Create exit
      </button>
    </Modal>
  );
}
