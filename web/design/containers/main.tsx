// C0 authoring prototype. This entry is not imported by the application or its build.
import { createRoot } from 'react-dom/client';
import { cloneElement, useEffect, useId, useRef, useState, type ReactElement } from 'react';
import * as Blockly from 'blockly/core';
// Match the application's initialization order through the existing authoring modules.
import '../../src/HintBlocks';
import {
  blockWorkspaceOptions,
  conditionFieldChanged,
  loadEffectBlocks,
  makeCondition,
  registerBlocks,
} from '../../src/Blocks';
import { refreshChainEnds } from '../../src/blockRenderer';
import { object, location } from '../../src/model';
import type { Effect, Project } from '../../src/contracts';
import Modal from '../../src/Modal';
import logo from '../../../assets/logo-transparent.png';
import '../../src/styles.css';
import './styles.css';

type Relation = 'inside' | 'on';
type View = 'details' | 'contents' | 'actions' | 'player';
type Interaction = 'open' | 'close' | 'look' | 'put_in' | 'put_on' | 'take_from';
type Storage = {
  id: string;
  name: string;
  inside: boolean;
  surface: boolean;
  opening: 'always' | 'openable';
  open: boolean;
  portable: boolean;
  placement: 'study' | 'inventory';
  locked: boolean;
  interactions: Interaction[];
};
type Item = { id: string; name: string; holder: string; relation: Relation | 'room' };
const initialStorage: Storage[] = [
  {
    id: 'chest',
    name: 'Wooden chest',
    inside: true,
    surface: true,
    opening: 'openable',
    open: false,
    portable: false,
    placement: 'study',
    locked: true,
    interactions: [],
  },
  {
    id: 'bag',
    name: 'Canvas bag',
    inside: true,
    surface: false,
    opening: 'openable',
    open: true,
    portable: true,
    placement: 'study',
    locked: false,
    interactions: [],
  },
];
const initialItems: Item[] = [
  { id: 'key', name: 'Brass key', holder: 'chest', relation: 'inside' },
  { id: 'box', name: 'Small box', holder: 'chest', relation: 'inside' },
  { id: 'letter', name: 'Letter', holder: 'chest', relation: 'on' },
  { id: 'coin', name: 'Silver coin', holder: 'room', relation: 'room' },
];
const interactionNames: Record<Interaction, string> = {
  open: 'Open',
  close: 'Close',
  look: 'Look inside',
  put_in: 'Put an item inside',
  put_on: 'Put an item on top',
  take_from: 'Take an item from here',
};
function command(kind: Interaction, name: string) {
  const noun = name.toLowerCase();
  return {
    open: `open ${noun}`,
    close: `close ${noun}`,
    look: `look in ${noun}`,
    put_in: `put <item> in ${noun}`,
    put_on: `put <item> on ${noun}`,
    take_from: `take <item> from ${noun}`,
  }[kind];
}
const study = { ...location('Study'), id: 'study' };
const project: Project = {
  game: {
    id: 'packing',
    title: 'Packing the Study',
    description: '',
    author: '',
    format_version: 1,
    content_version: '0.1.0',
    starting_location: 'study',
    opening_text: '',
    help_text: '',
    unknown_command_text: '',
    help_mode: 'basic',
    hints_enabled: true,
    ignored_words: ['a', 'an', 'the'],
    require_ending: false,
    variables: {},
    endings: [],
    actions: [],
    triggers: [],
    assets: [],
  },
  vocabulary: [],
  locations: [study],
  characters: [],
  objects: [...initialStorage, ...initialItems].map((item) => ({
    ...object('study'),
    id: item.id,
    name: item.name,
    state: { locked: false, accepting_items: true },
  })),
  editor: { positions: {}, blocks: {}, routes: {}, templates: [] },
};
registerBlocks(project);

// Proposed blocks use the existing renderer, colours, fields, and connection rules.
// They intentionally have C0-only names and no production serialization.
for (const type of ['put_in', 'put_on', 'take_from', 'list']) {
  Blockly.Blocks[`c0_${type}`] = {
    init(this: Blockly.Block) {
      const input = this.appendDummyInput();
      if (type === 'list') input.appendField('LIST CONTENTS OF');
      else {
        input.appendField(type === 'take_from' ? 'TAKE' : 'PUT');
        input.appendField(
          new Blockly.FieldDropdown([
            ['Command item', 'input:item'],
            ...initialItems.map((item): [string, string] => [item.name, item.id]),
          ]),
          'item',
        );
        input.appendField(type === 'put_in' ? 'INSIDE' : type === 'put_on' ? 'ON' : 'FROM');
      }
      input.appendField(
        new Blockly.FieldDropdown(
          initialStorage.map((holder): [string, string] => [holder.name, holder.id]),
        ),
        'holder',
      );
      if (type === 'list')
        input.appendField(
          new Blockly.FieldDropdown([
            ['inside', 'inside'],
            ['on top', 'on'],
          ]),
          'relation',
        );
      this.setPreviousStatement(true);
      this.setNextStatement(true);
      this.setColour(type === 'list' ? '#386b58' : '#555f7f');
    },
  };
}
Blockly.Blocks.c0_can_put = {
  init(this: Blockly.Block) {
    this.appendDummyInput()
      .appendField('CAN PUT')
      .appendField(new Blockly.FieldLabel('Command item'))
      .appendField('INSIDE')
      .appendField(new Blockly.FieldLabel('Wooden chest'));
    this.setOutput(true, 'Boolean');
    this.setColour('#916b31');
    this.setTooltip(
      'The item is portable, possessed, and reachable; the holder is reachable and open.',
    );
  },
};

type SelectedBlock = { id: string; type: string; name: string; item?: string; text?: string };
function BlockPreview({
  holder,
  action,
  conditional,
  onSelect,
  workspaceRef,
}: {
  holder: Storage;
  action: Interaction;
  conditional: boolean;
  onSelect: (block: SelectedBlock | null) => void;
  workspaceRef: { current: Blockly.WorkspaceSvg | null };
}) {
  const host = useRef<HTMLDivElement>(null);
  const callback = useRef(onSelect);
  callback.current = onSelect;
  useEffect(() => {
    const toolbox = {
      kind: 'categoryToolbox',
      contents: [
        {
          kind: 'category',
          name: 'Responses',
          colour: '#386b58',
          contents: [
            { kind: 'block', type: 'luna_say' },
            { kind: 'block', type: 'c0_list' },
          ],
        },
        {
          kind: 'category',
          name: 'Logic',
          colour: '#916b31',
          contents: [
            { kind: 'block', type: 'luna_if' },
            { kind: 'block', type: 'condition_opened' },
          ],
        },
        {
          kind: 'category',
          name: 'World & state',
          colour: '#555f7f',
          contents: [
            { kind: 'block', type: 'luna_open' },
            { kind: 'block', type: 'luna_close' },
            { kind: 'block', type: 'c0_put_in' },
            { kind: 'block', type: 'c0_put_on' },
          ],
        },
      ],
    };
    const ws = Blockly.inject(host.current!, {
      ...blockWorkspaceOptions(toolbox),
      media: '/node_modules/blockly/media/',
    });
    workspaceRef.current = ws;
    let effects: Effect[] = [];
    if (action === 'open' || action === 'close') {
      effects = [
        { type: action, object: holder.id },
        { type: 'say', text: action === 'open' ? 'The lid creaks open.' : 'The lid settles shut.' },
      ];
    }
    const root = loadEffectBlocks(ws, effects, {
      requirements:
        action === 'open'
          ? {
              type: 'not',
              condition: {
                type: 'property',
                entity: holder.id,
                name: 'locked',
                op: 'eq',
                value: true,
              },
            }
          : { type: 'true' },
    });
    root.setFieldValue(`WHEN ${command(action, holder.name).toUpperCase()}`, 'FLOW_TITLE');
    const append = (type: string, parent: Blockly.Block, input = 'DO') => {
      const block = ws.newBlock(type);
      parent.getInput(input)!.connection!.connect(block.previousConnection!);
      if (block.getField('holder')) block.setFieldValue(holder.id, 'holder');
      return block;
    };
    if (action === 'look') append('c0_list', root);
    if (action === 'put_in' || action === 'put_on' || action === 'take_from') {
      const check = ws.newBlock('c0_can_put');
      // The label preview follows the selected operation; its semantics remain proposed.
      check.getInput('')!.fieldRow.forEach((field) => {
        if (field.getText() === 'Wooden chest') field.setValue(holder.name);
        if (field.getText() === 'INSIDE' && action !== 'put_in')
          field.setValue(action === 'put_on' ? 'ON' : 'FROM');
        if (field.getText() === 'CAN PUT' && action === 'take_from') field.setValue('CAN TAKE');
      });
      root.getInputTargetBlock('requirements')?.dispose(false);
      root.getInput('requirements')!.connection!.connect(check.outputConnection!);
      if (conditional) {
        const branch = append('luna_if', root);
        const test = makeCondition(ws, {
          type: 'property',
          entity: holder.id,
          name: 'accepting_items',
          op: 'eq',
          value: true,
        });
        branch.getInput('TEST')!.connection!.connect(test.outputConnection!);
        append(`c0_${action}`, branch, 'THEN');
        const refusal = append('luna_say', branch, 'ELSE');
        refusal.setFieldValue("This space is reserved for the Keeper's things.", 'text');
      } else append(`c0_${action}`, root);
    }
    root.moveBy(20, 24);
    ws.getAllBlocks(false).forEach((block) => block.initSvg());
    ws.render();
    refreshChainEnds(ws);
    ws.zoomToFit();
    const selection = (block: Blockly.Block | null) =>
      callback.current(
        block
          ? {
              id: block.id,
              type: block.type,
              name: block.toString(),
              item: block.getFieldValue('item') ?? undefined,
              text: block.getFieldValue('text') ?? undefined,
            }
          : null,
      );
    selection(root);
    const listener = (event: Blockly.Events.Abstract) => {
      if (event instanceof Blockly.Events.Selected && event.newElementId)
        selection(ws.getBlockById(event.newElementId));
      if (event instanceof Blockly.Events.BlockChange) {
        conditionFieldChanged(event, ws);
        selection(ws.getBlockById(event.blockId ?? ''));
      }
      if (!event.isUiEvent) refreshChainEnds(ws);
    };
    ws.addChangeListener(listener);
    const resize = new ResizeObserver(() => Blockly.svgResize(ws));
    resize.observe(host.current!);
    return () => {
      resize.disconnect();
      ws.removeChangeListener(listener);
      ws.dispose();
      workspaceRef.current = null;
    };
  }, [holder.id, action, conditional]);
  return <div className="c0-block-host" ref={host} aria-label="Container action blocks" />;
}

function Field({
  label,
  children,
  help,
}: {
  label: string;
  children: ReactElement<{ id?: string; 'aria-describedby'?: string }>;
  help?: string;
}) {
  const fieldId = useId();
  return (
    <div className="c0-field">
      <label htmlFor={fieldId}>{label}</label>
      {cloneElement(children, {
        id: fieldId,
        'aria-describedby': help ? `${fieldId}-help` : undefined,
      })}
      {help && <small id={`${fieldId}-help`}>{help}</small>}
    </div>
  );
}
function Check({
  label,
  checked,
  change,
}: {
  label: string;
  checked: boolean;
  change: (value: boolean) => void;
}) {
  return (
    <label className="c0-check">
      <input type="checkbox" checked={checked} onChange={(event) => change(event.target.checked)} />
      <span>{label}</span>
    </label>
  );
}
function App() {
  const [holders, setHolders] = useState(() => structuredClone(initialStorage));
  const [items, setItems] = useState(() => structuredClone(initialItems));
  const [owner, setOwner] = useState('chest');
  const [view, setView] = useState<View>('details');
  const [action, setAction] = useState<Interaction>('open');
  const [selected, setSelected] = useState<SelectedBlock | null>(null);
  const [conditional, setConditional] = useState(false);
  const [inspector, setInspector] = useState(true);
  const [play, setPlay] = useState(true);
  const [setup, setSetup] = useState<Interaction[] | null>(null);
  const [add, setAdd] = useState<{ relation: Relation; mode: 'new' | 'existing' } | null>(null);
  const [newName, setNewName] = useState('');
  const [existing, setExisting] = useState('coin');
  const [notice, setNotice] = useState('');
  const [undoItems, setUndoItems] = useState<Item[] | null>(null);
  const [liveOpen, setLiveOpen] = useState(false);
  const [liveLocked, setLiveLocked] = useState(true);
  const [liveCarried, setLiveCarried] = useState(false);
  const [transcript, setTranscript] = useState([
    'A wooden chest stands in the Study. A letter rests on top.',
  ]);
  const workspaceRef = useRef<Blockly.WorkspaceSvg | null>(null);
  const holder = holders.find((entry) => entry.id === owner)!;
  const children = items.filter((item) => item.holder === owner);
  const offered: Interaction[] = [
    ...(holder.inside && holder.opening === 'openable' ? (['open', 'close'] as const) : []),
    ...(holder.inside ? (['look', 'put_in'] as const) : []),
    ...(holder.surface ? (['put_on'] as const) : []),
    ...(holder.inside || holder.surface ? (['take_from'] as const) : []),
  ];
  const editHolder = (patch: Partial<Storage>) => {
    if (
      (patch.inside === false && children.some((item) => item.relation === 'inside')) ||
      (patch.surface === false && children.some((item) => item.relation === 'on'))
    ) {
      setNotice('Move the affected contents before removing this storage option.');
      return;
    }
    setHolders((current) =>
      current.map((entry) => (entry.id === owner ? { ...entry, ...patch } : entry)),
    );
  };
  const navigate = (next: View) => {
    setView(next);
    setSelected(null);
  };
  const chooseOwner = (id: string) => {
    setOwner(id);
    setSelected(null);
    setConditional(false);
    setView('details');
  };
  const runPreview = (input: 'open chest' | 'close chest' | 'take key' | 'look in chest') => {
    let response = '';
    if (input === 'open chest') {
      if (liveLocked) response = 'The chest is locked.';
      else if (liveOpen) response = 'The chest is already open.';
      else {
        setLiveOpen(true);
        response = 'The lid creaks open. Inside: a brass key and a small box.';
      }
    } else if (input === 'close chest') {
      setLiveOpen(false);
      response = 'The lid settles shut. The letter remains on top.';
    } else if (input === 'look in chest') {
      response = liveOpen
        ? liveCarried
          ? 'Inside: a small box.'
          : 'Inside: a brass key and a small box.'
        : 'The chest is closed.';
    } else if (!liveOpen) response = "You can't find that item here.";
    else if (liveCarried) response = 'You already have the key.';
    else {
      setLiveCarried(true);
      response = 'You take the brass key.';
    }
    setTranscript((current) => [...current, `> ${input}`, response]);
  };
  const title =
    view === 'actions'
      ? interactionNames[action]
      : view === 'player'
        ? 'Visibility and reachability'
        : holder.name;
  const selectBlock = (type: string) => {
    const block = workspaceRef.current?.getAllBlocks(false).find((entry) => entry.type === type);
    if (block) {
      block.select();
      workspaceRef.current!.centerOnBlock(block.id);
    }
  };
  return (
    <div className="c0-preview">
      <div className="c0-banner">
        <span>
          <strong>Container design · C0</strong> — changes stay in this preview
        </span>
        <a href="/">Open current editor</a>
      </div>
      <header>
        <div className="brand">
          <img className="brand-logo" src={logo} width="43" height="43" alt="Luna Engine" />
          <strong>Luna Engine</strong>
          <span className="project-title">Packing the Study</span>
        </div>
        <div className="header-actions">
          <button
            onClick={() => {
              setHolders(structuredClone(initialStorage));
              setItems(structuredClone(initialItems));
              chooseOwner('chest');
              setNotice('Preview reset.');
            }}
          >
            Reset preview
          </button>
          <span className="save-status">Design review</span>
        </div>
      </header>
      <div className={`c0-layout ${!inspector ? 'c0-inspector-closed' : ''}`}>
        <nav className="c0-tree" aria-label="World hierarchy">
          <h3>World</h3>
          {(['study', 'inventory'] as const).map((placement) => (
            <div key={placement} className="c0-tree-group">
              <strong>{placement === 'study' ? 'Study' : 'Player inventory'}</strong>
              {holders
                .filter((entry) => entry.placement === placement)
                .map((entry) => (
                  <div key={entry.id}>
                    <button
                      className={owner === entry.id ? 'c0-current' : ''}
                      onClick={() => chooseOwner(entry.id)}
                    >
                      {entry.name}
                      <small>
                        {entry.inside ? 'container' : 'object'}
                        {entry.surface ? ' · surface' : ''}
                      </small>
                    </button>
                    {items
                      .filter((item) => item.holder === entry.id)
                      .map((item) => (
                        <div className="c0-tree-child" key={item.id}>
                          {item.name}
                          <small>{item.relation === 'inside' ? 'inside' : 'on top'}</small>
                        </div>
                      ))}
                  </div>
                ))}
              {placement === 'study' &&
                items
                  .filter((item) => item.holder === 'room')
                  .map((item) => (
                    <div className="c0-tree-child" key={item.id}>
                      {item.name}
                      <small>in Study</small>
                    </div>
                  ))}
            </div>
          ))}
          <h3>Game data</h3>
          <p className="muted">
            Variables
            <br />
            Vocabulary
            <br />
            Triggers
            <br />
            Hints
          </p>
          <p className="c0-caption">
            Review the object settings, move contents, then open an action.
          </p>
        </nav>
        <main className="c0-main">
          <div className="c0-breadcrumb">
            <button onClick={() => navigate('details')}>
              {holder.placement === 'inventory' ? 'Player inventory' : 'Study'}
            </button>
            <span>›</span>
            <button onClick={() => navigate('details')}>{holder.name}</button>
            <span>›</span>
            <span>
              {view === 'actions'
                ? 'Actions'
                : view === 'player'
                  ? 'Player view'
                  : view === 'contents'
                    ? 'Contents'
                    : 'Details'}
            </span>
            <button className="c0-panel-toggle" onClick={() => setInspector(!inspector)}>
              {inspector ? 'Hide inspector' : 'Show inspector'}
            </button>
          </div>
          <div className="c0-tabs" aria-label="Object views">
            {(['details', 'contents', 'actions', 'player'] as View[]).map((tab) => (
              <button key={tab} aria-pressed={view === tab} onClick={() => navigate(tab)}>
                {tab === 'player' ? 'Player view' : tab[0].toUpperCase() + tab.slice(1)}
              </button>
            ))}
          </div>
          <div className="c0-content">
            {view === 'details' && (
              <section className="c0-overview">
                <div className="c0-page-heading">
                  <div>
                    <span className="c0-eyebrow">Object settings</span>
                    <h1>{holder.name}</h1>
                    <p>Give this object an interior, a top surface, or both.</p>
                  </div>
                  <span className="c0-tag">
                    {holder.placement === 'inventory' ? 'Player inventory' : 'Study'}
                  </span>
                </div>
                <div className="c0-object-card">
                  <span className="c0-object-icon" aria-hidden="true">
                    ▣
                  </span>
                  <div>
                    <h2>{holder.name}</h2>
                    <p>
                      {holder.inside
                        ? holder.opening === 'always'
                          ? 'Always-open container'
                          : `Container · starts ${holder.open ? 'open' : 'closed'}`
                        : 'Ordinary object'}
                      {holder.surface ? ' · top surface' : ''}
                    </p>
                    <div className="c0-chips">
                      <span>{holder.portable ? 'Portable' : 'Fixed in place'}</span>
                      <span>{children.length} initial items</span>
                    </div>
                  </div>
                </div>
                <div className="c0-explainer">
                  <h2>One object, two independent spaces</h2>
                  <p>
                    Closing the chest conceals its interior. Items on top remain visible and
                    reachable.
                  </p>
                  <div className="c0-space-grid">
                    <button onClick={() => navigate('contents')}>
                      <strong>Inside</strong>
                      <span>
                        {children
                          .filter((item) => item.relation === 'inside')
                          .map((item) => item.name)
                          .join(', ') || 'No items'}
                      </span>
                      <small>{holder.open ? 'Starts accessible' : 'Blocked while closed'}</small>
                    </button>
                    <button onClick={() => navigate('contents')}>
                      <strong>On top</strong>
                      <span>
                        {children
                          .filter((item) => item.relation === 'on')
                          .map((item) => item.name)
                          .join(', ') || 'No items'}
                      </span>
                      <small>Independent of the lid</small>
                    </button>
                  </div>
                </div>
                <div className="c0-next">
                  <h2>Make it playable</h2>
                  <p>
                    Review common commands, then customize them in Actions. Your existing custom
                    commands stay visible.
                  </p>
                  <button className="primary" onClick={() => setSetup([...offered])}>
                    Set up standard interactions
                  </button>
                  <button onClick={() => navigate('contents')}>Edit contents</button>
                </div>
              </section>
            )}
            {view === 'contents' && (
              <section className="c0-overview">
                <div className="c0-page-heading">
                  <div>
                    <span className="c0-eyebrow">Initial world state</span>
                    <h1>Contents of {holder.name.toLowerCase()}</h1>
                    <p>Adding an existing object moves it here. Each item has one placement.</p>
                  </div>
                </div>
                {(['inside', 'on'] as Relation[])
                  .filter((relation) => (relation === 'inside' ? holder.inside : holder.surface))
                  .map((relation) => (
                    <section className="c0-contents-group" key={relation}>
                      <div className="c0-row">
                        <h2>{relation === 'inside' ? 'Inside' : 'On top'}</h2>
                        <button
                          className="primary"
                          onClick={() => {
                            setAdd({ relation, mode: 'new' });
                            setNewName('');
                          }}
                        >
                          Add item {relation === 'inside' ? 'inside' : 'on top'}
                        </button>
                      </div>
                      {items
                        .filter((item) => item.holder === owner && item.relation === relation)
                        .map((item) => (
                          <div className="c0-item-row" key={item.id}>
                            <div>
                              <strong>{item.name}</strong>
                              <small>
                                {item.id === 'box' ? 'Portable box' : 'Initially hidden: No'}
                              </small>
                            </div>
                            <span className="c0-tag">
                              {relation === 'inside' && !holder.open
                                ? 'Concealed while closed'
                                : 'Visible'}
                            </span>
                            <button
                              aria-label={`Move ${item.name} to Study`}
                              onClick={() => {
                                setUndoItems(structuredClone(items));
                                setItems((current) =>
                                  current.map((entry) =>
                                    entry.id === item.id
                                      ? { ...entry, holder: 'room', relation: 'room' }
                                      : entry,
                                  ),
                                );
                                setNotice(`${item.name} moved to Study.`);
                              }}
                            >
                              Move to Study
                            </button>
                          </div>
                        ))}
                      {!children.some((item) => item.relation === relation) && (
                        <p className="c0-empty">
                          No items here yet. Create an object or move one from elsewhere.
                        </p>
                      )}
                    </section>
                  ))}
                <div className="c0-note">
                  {holder.open
                    ? 'Inside items start visible unless explicitly hidden.'
                    : 'This container starts closed. Its inside items cannot be seen or reached until opened.'}{' '}
                  Items on top are unaffected.
                </div>
              </section>
            )}
            {view === 'actions' && (
              <section className="c0-actions">
                <div className="c0-action-toolbar">
                  <Field label="Choose an action">
                    <select
                      value={action}
                      onChange={(event) => {
                        setAction(event.target.value as Interaction);
                        setConditional(false);
                      }}
                    >
                      {offered.map((kind) => (
                        <option key={kind} value={kind}>
                          {interactionNames[kind]}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <button className="primary" onClick={() => setSetup([...offered])}>
                    Set up interactions
                  </button>
                </div>
                <div className="c0-command-preview">
                  <span className="c0-tag">
                    {holder.interactions.includes(action)
                      ? 'Standard behaviour · added to preview'
                      : 'Standard behaviour · offered preview'}
                  </span>
                  <code>{command(action, holder.name)}</code>
                </div>
                <div className="c0-block-controls">
                  <button onClick={() => selectBlock('luna_flow')}>Action settings</button>
                  <button
                    onClick={() =>
                      selectBlock(
                        action === 'open' || action === 'close'
                          ? `luna_${action}`
                          : action === 'look'
                            ? 'c0_list'
                            : `c0_${action}`,
                      )
                    }
                  >
                    Select operation
                  </button>
                  <button onClick={() => workspaceRef.current?.zoomToFit()}>Fit flow</button>
                  {action.startsWith('put') && (
                    <button onClick={() => setConditional(!conditional)}>
                      {conditional ? 'Remove example IF / ELSE' : 'Show example IF / ELSE'}
                    </button>
                  )}
                </div>
                <BlockPreview
                  key={owner}
                  holder={holder}
                  action={action}
                  conditional={conditional}
                  onSelect={setSelected}
                  workspaceRef={workspaceRef}
                />
                <p className="c0-caption c0-flow-caption">
                  Existing Luna blocks and renderer. “Command item” comes from the item named by the
                  player; it is available only in this action.
                </p>
              </section>
            )}
            {view === 'player' && (
              <section className="c0-overview">
                <span className="c0-eyebrow">Scripted player preview</span>
                <h1>What the player can discover</h1>
                <p>
                  Try the closed chest, unlock it in the author controls, then open it and take the
                  key.
                </p>
                <div className="c0-preview-state">
                  <h2>Author-only controls</h2>
                  <Check label="Chest locked" checked={liveLocked} change={setLiveLocked} />
                  <p>
                    Current chest: <strong>{liveOpen ? 'open' : 'closed'}</strong>. Key:{' '}
                    <strong>{liveCarried ? 'player inventory' : 'inside chest'}</strong>.
                  </p>
                  <p>
                    Letter on top: <strong>visible and reachable</strong>.
                  </p>
                  <p>
                    Key inside:{' '}
                    <strong>
                      {liveCarried
                        ? 'possessed and reachable'
                        : liveOpen
                          ? 'visible and reachable'
                          : 'concealed and unreachable'}
                    </strong>
                    .
                  </p>
                </div>
                <div className="c0-note">
                  The final engine will use these same rules for commands, help, hints, and saved
                  games. This preview demonstrates the intended presentation only.
                </div>
              </section>
            )}
          </div>
          <section
            className={`c0-play ${play ? '' : 'c0-play-collapsed'}`}
            aria-label="Scripted playtest preview"
          >
            <div className="c0-row">
              <h2>
                Playtest <span className="c0-caption">Scripted preview</span>
              </h2>
              <button onClick={() => setPlay(!play)}>
                {play ? 'Collapse playtest' : 'Open playtest'}
              </button>
            </div>
            {play && (
              <>
                <div className="c0-transcript" role="log" aria-label="Preview transcript">
                  {transcript.map((line, index) => (
                    <div className={line.startsWith('>') ? 'c0-input-line' : ''} key={index}>
                      {line}
                    </div>
                  ))}
                </div>
                <div className="c0-player-commands">
                  {(['open chest', 'close chest', 'look in chest', 'take key'] as const).map(
                    (input) => (
                      <button key={input} onClick={() => runPreview(input)}>
                        {input}
                      </button>
                    ),
                  )}
                </div>
              </>
            )}
          </section>
        </main>
        {inspector && (
          <aside className="c0-inspector" aria-label="Inspector">
            <div className="c0-row">
              <h2>
                {view === 'actions'
                  ? selected?.type === 'luna_flow'
                    ? 'Action settings'
                    : 'Selected block'
                  : 'Object details'}
              </h2>
              <button onClick={() => setInspector(false)} aria-label="Close inspector">
                ×
              </button>
            </div>
            {view === 'actions' ? (
              <>
                <p className="c0-caption">
                  {holder.name} › Actions › {interactionNames[action]}
                </p>
                <h2>{title}</h2>
                {selected?.type === 'luna_flow' || !selected ? (
                  <>
                    <Field label="Player command">
                      <input readOnly value={command(action, holder.name)} />
                    </Field>
                    <p className="c0-note">
                      This entry is the handler for this standard interaction. Adding a requirement
                      changes this handler; a permissive default will not run behind it.
                    </p>
                    <Field label="When requirements fail">
                      <textarea
                        key={action}
                        defaultValue={
                          action === 'open' ? 'The chest is locked.' : 'You cannot put that there.'
                        }
                      />
                    </Field>
                    <button
                      onClick={() =>
                        selectBlock(
                          action === 'open' || action === 'close'
                            ? `luna_${action}`
                            : `c0_${action}`,
                        )
                      }
                    >
                      Open operation block
                    </button>
                  </>
                ) : (
                  <>
                    <p className="c0-note">{selected.name}</p>
                    {selected.item !== undefined && (
                      <Field
                        label="Item"
                        help="Command inputs are scoped to this action. Fixed objects are also available."
                      >
                        <select
                          value={selected.item}
                          onChange={(event) =>
                            workspaceRef.current
                              ?.getBlockById(selected.id)
                              ?.setFieldValue(event.target.value, 'item')
                          }
                        >
                          <optgroup label="From this command">
                            <option value="input:item">Command item</option>
                          </optgroup>
                          <optgroup label="Specific object">
                            {initialItems.map((item) => (
                              <option key={item.id} value={item.id}>
                                {item.name}
                              </option>
                            ))}
                          </optgroup>
                        </select>
                      </Field>
                    )}
                    {selected.text !== undefined && (
                      <Field label="SAY text">
                        <textarea
                          value={selected.text}
                          onChange={(event) => {
                            workspaceRef.current
                              ?.getBlockById(selected.id)
                              ?.setFieldValue(event.target.value, 'text');
                            setSelected({ ...selected, text: event.target.value });
                          }}
                        />
                      </Field>
                    )}
                    <button onClick={() => selectBlock('luna_flow')}>
                      Back to action settings
                    </button>
                  </>
                )}
                <hr />
                <h3>Try another action</h3>
                <button
                  onClick={() => {
                    setAction('put_in');
                    setConditional(false);
                  }}
                >
                  Put an item inside
                </button>
                <p className="c0-caption">No separate action is needed for each possible item.</p>
              </>
            ) : (
              <>
                <p className="c0-caption">Initial authored state · {holder.name}</p>
                <Field label="Name">
                  <input
                    value={holder.name}
                    onChange={(event) => editHolder({ name: event.target.value })}
                  />
                </Field>
                <Field label="Initial placement">
                  <select
                    aria-label="Initial placement"
                    value={holder.placement}
                    onChange={(event) =>
                      editHolder({ placement: event.target.value as Storage['placement'] })
                    }
                  >
                    <option value="study">Room: Study</option>
                    <option value="inventory">Player inventory</option>
                  </select>
                </Field>
                <Check
                  label="Portable"
                  checked={holder.portable}
                  change={(portable) => editHolder({ portable })}
                />
                <hr />
                <h2>Storage</h2>
                <Check
                  label="Can contain items"
                  checked={holder.inside}
                  change={(inside) => editHolder({ inside })}
                />
                {holder.inside && (
                  <>
                    <Field label="Opening">
                      <select
                        value={holder.opening}
                        onChange={(event) =>
                          editHolder({
                            opening: event.target.value as Storage['opening'],
                            open: event.target.value === 'always' || holder.open,
                          })
                        }
                      >
                        <option value="openable">Can be opened and closed</option>
                        <option value="always">Always open</option>
                      </select>
                    </Field>
                    {holder.opening === 'openable' && (
                      <Field label="Initially">
                        <select
                          value={holder.open ? 'open' : 'closed'}
                          onChange={(event) => editHolder({ open: event.target.value === 'open' })}
                        >
                          <option value="closed">Closed</option>
                          <option value="open">Open</option>
                        </select>
                      </Field>
                    )}
                  </>
                )}
                <Check
                  label="Items can be placed on top"
                  checked={holder.surface}
                  change={(surface) => editHolder({ surface })}
                />
                <p className="c0-caption">
                  An interior and a top surface are independent. Closing hides only the inside.
                </p>
                <button className="primary" onClick={() => setSetup([...offered])}>
                  Set up standard interactions
                </button>
                <hr />
                <h3>Initial contents</h3>
                <p>
                  {children.length} items ·{' '}
                  <button onClick={() => navigate('contents')}>Open Contents</button>
                </p>
              </>
            )}
          </aside>
        )}
      </div>
      {notice && (
        <div className="c0-toast" role="status">
          <span>{notice}</span>
          {undoItems && (
            <button
              onClick={() => {
                setItems(undoItems);
                setUndoItems(null);
                setNotice('Move undone.');
              }}
            >
              Undo move
            </button>
          )}
          <button onClick={() => setNotice('')} aria-label="Dismiss notice">
            ×
          </button>
        </div>
      )}
      {setup && (
        <Modal
          title="Set up standard interactions"
          close={() => setSetup(null)}
          className="c0-modal"
        >
          <h2>Set up standard interactions</h2>
          <p>
            Choose the commands for {holder.name.toLowerCase()}. You can edit their blocks and story
            text in Actions.
          </p>
          <div className="c0-setup-list">
            {offered.map((kind) => (
              <label className="c0-setup-row" key={kind}>
                <input
                  type="checkbox"
                  checked={setup.includes(kind)}
                  onChange={(event) =>
                    setSetup(
                      event.target.checked
                        ? [...setup, kind]
                        : setup.filter((entry) => entry !== kind),
                    )
                  }
                />
                <span>
                  <strong>{interactionNames[kind]}</strong>
                  <code>{command(kind, holder.name)}</code>
                </span>
                <small>
                  {kind.startsWith('put') ? (
                    'Create put verb'
                  ) : (
                    <>
                      Use existing{' '}
                      {kind === 'take_from' ? 'take' : kind === 'look' ? 'look in' : kind} verb
                    </>
                  )}
                </small>
              </label>
            ))}
          </div>
          <div className="c0-note">
            <strong>Existing custom commands are retained.</strong> A conflicting command would
            appear here for review, rather than silently adding another handler.
          </div>
          <div className="c0-dialog-actions">
            <button onClick={() => setSetup(null)}>Cancel</button>
            <button
              className="primary"
              disabled={setup.length === 0}
              onClick={() => {
                editHolder({ interactions: setup });
                setSetup(null);
                setView('actions');
                setAction(setup[0] ?? 'open');
                setNotice('Selected standard interactions added to this preview.');
              }}
            >
              Apply selected interactions
            </button>
          </div>
        </Modal>
      )}
      {add && (
        <Modal title="Add an item" close={() => setAdd(null)} className="c0-modal">
          <h2>Add an item {add.relation === 'inside' ? 'inside' : 'on top'}</h2>
          <p>{holder.name} · Initial contents</p>
          <div className="c0-tabs">
            <button
              aria-pressed={add.mode === 'new'}
              onClick={() => setAdd({ ...add, mode: 'new' })}
            >
              Create new object
            </button>
            <button
              aria-pressed={add.mode === 'existing'}
              onClick={() => setAdd({ ...add, mode: 'existing' })}
            >
              Move existing object
            </button>
          </div>
          {add.mode === 'new' ? (
            <Field label="Object name">
              <input
                autoFocus
                value={newName}
                onChange={(event) => setNewName(event.target.value)}
              />
            </Field>
          ) : (
            <>
              <Field label="Choose an object">
                <select value={existing} onChange={(event) => setExisting(event.target.value)}>
                  {items
                    .filter((item) => item.holder !== owner)
                    .map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.name} —{' '}
                        {item.holder === 'room'
                          ? 'Study'
                          : holders.find((entry) => entry.id === item.holder)?.name}
                      </option>
                    ))}
                </select>
              </Field>
              <p className="c0-note">
                Move from its current placement to{' '}
                {add.relation === 'inside' ? 'inside' : 'on top of'} {holder.name.toLowerCase()}.
                The object is not duplicated.
              </p>
            </>
          )}
          <div className="c0-dialog-actions">
            <button onClick={() => setAdd(null)}>Cancel</button>
            <button
              className="primary"
              disabled={
                add.mode === 'new'
                  ? !newName.trim()
                  : !items.some((item) => item.id === existing && item.holder !== owner)
              }
              onClick={() => {
                setUndoItems(structuredClone(items));
                if (add.mode === 'new')
                  setItems([
                    ...items,
                    {
                      id: crypto.randomUUID(),
                      name: newName.trim(),
                      holder: owner,
                      relation: add.relation,
                    },
                  ]);
                else
                  setItems(
                    items.map((item) =>
                      item.id === existing
                        ? { ...item, holder: owner, relation: add.relation }
                        : item,
                    ),
                  );
                setAdd(null);
                setNotice('Initial contents updated.');
              }}
            >
              {' '}
              {add.mode === 'new' ? 'Create here' : 'Move here'}
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
createRoot(document.getElementById('root')!).render(<App />);
