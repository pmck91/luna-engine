import { useEffect, useRef, useState } from 'react';
import * as Blockly from 'blockly/core';
import type { Project } from './contracts';
import {
  catalogue,
  blockAvailable,
  registerBlockScope,
  blockWorkspaceOptions,
  createCatalogueBlock,
  registerBlocks,
  type InsertionPoint,
} from './Blocks';
import { Field, Select } from './Forms';
import { refreshChainEnds } from './blockRenderer';

export default function BlockPicker({
  project,
  points,
  initial,
  close,
  insert,
  flowId,
}: {
  project: Project;
  flowId?: string;
  points: InsertionPoint[];
  initial: string;
  close: () => void;
  insert: (point: InsertionPoint, type: string) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const preview = useRef<HTMLDivElement>(null);
  const [pointKey, setPointKey] = useState(initial);
  const [query, setQuery] = useState('');
  const [chosen, setChosen] = useState('');
  const point = points.find((point) => point.key === pointKey);
  const entries = catalogue(project, flowId).filter(
    (entry) =>
      entry.kind === point?.kind &&
      blockAvailable(project, entry.type) &&
      `${entry.name} ${entry.category} ${entry.aliases}`
        .toLowerCase()
        .includes(query.toLowerCase().trim()),
  );
  const selected = entries.find((entry) => entry.type === chosen) ?? entries[0];
  useEffect(() => {
    const previous = document.activeElement;
    const surface = dialog.current!;
    surface.showModal();
    surface.querySelector('input')?.focus();
    return () => {
      surface.close();
      if (previous instanceof HTMLElement && previous.isConnected)
        previous.focus({ preventScroll: true });
    };
  }, []);
  useEffect(() => {
    if (!preview.current || !selected) return;
    registerBlocks(project);
    const editorWorkspace = Blockly.common.getMainWorkspace();
    const workspace = Blockly.inject(preview.current, {
      ...blockWorkspaceOptions({ kind: 'flyoutToolbox', contents: [] }),
      toolbox: undefined,
      readOnly: true,
      zoom: { startScale: 0.8 },
      scrollbars: true,
      trashcan: false,
    });
    Blockly.Events.disable();
    try {
      if (flowId) registerBlockScope(workspace, flowId);
      const block = createCatalogueBlock(workspace, selected.type);
      for (const item of workspace.getAllBlocks(false)) item.initSvg();
      refreshChainEnds(workspace);
      workspace.render();
      block.moveBy(15, 15);
    } finally {
      Blockly.Events.enable();
    }
    return () => {
      workspace.dispose();
      if (editorWorkspace) Blockly.common.setMainWorkspace(editorWorkspace);
    };
  }, [selected?.type, project]);
  return (
    <dialog
      ref={dialog}
      className="modal block-picker"
      aria-label="Add block"
      onCancel={(event) => {
        event.preventDefault();
        close();
      }}
    >
      <div className="section-heading">
        <h2>Add block</h2>
        <button onClick={close}>Cancel</button>
      </div>
      <Select
        label="Insertion point"
        value={pointKey}
        items={points.map((point) => ({ id: point.key, name: point.label }))}
        onChange={(key) => {
          setPointKey(key);
          setChosen('');
          setQuery('');
        }}
      />
      <Field label="Search blocks">
        <input
          autoFocus
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setChosen('');
          }}
          placeholder="Try print, carrying, or character…"
          onKeyDown={(event) => {
            if (event.key === 'Enter' && selected && point) {
              event.preventDefault();
              insert(point, selected.type);
            }
          }}
        />
      </Field>
      <div className="block-picker-body">
        <div className="block-picker-results" role="group" aria-label="Compatible blocks">
          {entries.map((entry) => (
            <button
              key={entry.type}
              aria-pressed={selected?.type === entry.type}
              onClick={() => setChosen(entry.type)}
            >
              <strong>{entry.name}</strong>
              <small>{entry.category}</small>
            </button>
          ))}
          {!entries.length && <p>No compatible blocks match this search.</p>}
        </div>
        <div className="block-picker-preview">
          <h3>Preview{selected ? ` · ${selected.name}` : ''}</h3>
          <div ref={preview} className="block-preview-canvas" aria-label="Block preview" />
          <p aria-live="polite">
            {point?.label}
            {point?.occupied
              ? point.kind === 'effect'
                ? ' · The following effects stay connected after this block.'
                : ' · Replaces this input. The previous block is kept as a draft and does not run.'
              : ' · Adds the first block at this connection.'}
          </p>
        </div>
      </div>
      <button
        className="primary"
        disabled={!selected || !point}
        onClick={() => {
          if (point && selected) insert(point, selected.type);
        }}
      >
        {point?.occupied && point.kind !== 'effect' ? 'Replace block' : 'Insert block'}
      </button>
    </dialog>
  );
}
