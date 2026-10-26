// R0 interaction preview. This entry is isolated from the production app/build.
import {
  Children,
  cloneElement,
  isValidElement,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
} from 'react';
import { createRoot } from 'react-dom/client';
import * as Blockly from 'blockly/core';
// Keep the application's module initialization order for current block helpers.
import '../../src/HintBlocks';
import { blockWorkspaceOptions, loadEffectBlocks, registerBlocks } from '../../src/Blocks';
import { refreshChainEnds } from '../../src/blockRenderer';
import { character, location } from '../../src/model';
import Modal from '../../src/Modal';
import type { Effect, Project } from '../../src/contracts';
import logo from '../../../assets/logo-transparent.png';
import '../../src/styles.css';
import './styles.css';

type InputType = 'Object' | 'Character' | 'Location' | 'Boolean' | 'Integer' | 'Text';
type Parameter = { id: string; name: string; type: InputType; property?: string };
type Procedure = {
  id: string;
  name: string;
  description: string;
  inputs: Parameter[];
  example: boolean;
  say: boolean;
};
type Caller = 'action' | 'trigger';
type Arguments = { recipient: string; amount: number };
type Model = { procedures: Procedure[]; calls: Record<Caller, Arguments> };
type View = 'list' | 'definition' | 'caller';
type Panel = 'settings' | 'block' | 'uses';
const kinds: InputType[] = ['Object', 'Character', 'Location', 'Boolean', 'Integer', 'Text'];
const callNames: Record<Caller, string> = { action: 'Give bonus', trigger: 'First-entry bonus' };
const first: Model = {
  procedures: [
    {
      id: 'award',
      name: 'Award coins',
      description: 'A shared reward used by an action and a trigger.',
      example: true,
      say: false,
      inputs: [
        { id: 'recipient', name: 'recipient', type: 'Character', property: 'coins: Integer' },
        { id: 'amount', name: 'amount', type: 'Integer' },
      ],
    },
  ],
  calls: { action: { recipient: 'Keeper', amount: 5 }, trigger: { recipient: 'Guide', amount: 2 } },
};
const room = { ...location('Study'), id: 'study', actions: [] };
const previewProject: Project = {
  game: {
    id: 'r0',
    title: 'Shared rewards',
    description: '',
    author: '',
    format_version: 3,
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
  locations: [room],
  objects: [],
  characters: ['Keeper', 'Guide', 'Input: recipient'].map((name, index) => ({
    ...character('study'),
    id: ['keeper', 'guide', 'input-recipient'][index],
    name,
    state: { coins: 0 },
    actions: [],
  })),
  vocabulary: [],
  editor: { positions: {}, blocks: {}, routes: {}, templates: [] },
};
registerBlocks(previewProject);

// Proposed visual blocks keep Luna's existing renderer. These are not new core
// effects, and their data is never sent to a project API or to the Rust runner.
Blockly.Blocks.r0_call = {
  init(this: Blockly.Block) {
    this.appendDummyInput()
      .appendField('CALL')
      .appendField(new Blockly.FieldLabel('Award coins'), 'PROC');
    this.appendDummyInput()
      .appendField('recipient', 'RECIPIENT_LABEL')
      .appendField(
        new Blockly.FieldDropdown([
          ['Keeper', 'Keeper'],
          ['Guide', 'Guide'],
        ]),
        'RECIPIENT',
      )
      .appendField('amount', 'AMOUNT_LABEL')
      .appendField(new Blockly.FieldNumber(5), 'AMOUNT');
    this.setInputsInline(true);
    this.setPreviousStatement(true);
    this.setNextStatement(true);
    this.setColour('#7161c6');
    this.setTooltip(
      'One shared definition. Select this call to edit inputs or open its definition.',
    );
  },
};
Blockly.Blocks.r0_integer_input = {
  init(this: Blockly.Block) {
    this.appendDummyInput()
      .appendField('INPUT')
      .appendField(new Blockly.FieldLabel('amount'), 'NAME');
    this.setOutput(true, 'Number');
    this.setColour('#555f7f');
    this.setTooltip('An Integer local to this procedure call.');
  },
};
Blockly.Blocks.r0_positive_input = {
  init(this: Blockly.Block) {
    this.appendDummyInput()
      .appendField('INPUT')
      .appendField(new Blockly.FieldLabel('amount'), 'NAME')
      .appendField('> 0');
    this.setOutput(true, 'Boolean');
    this.setColour('#916b31');
  },
};

function Canvas({
  procedure,
  caller,
  args,
  view,
  onSelect,
  onArguments,
}: {
  procedure: Procedure;
  caller: Caller;
  args: Arguments;
  view: View;
  onSelect: (block: string) => void;
  onArguments: (patch: Partial<Arguments>) => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const callbacks = useRef({ onSelect, onArguments });
  callbacks.current = { onSelect, onArguments };
  const signature = JSON.stringify(procedure);
  useEffect(() => {
    const ws = Blockly.inject(host.current!, {
      ...blockWorkspaceOptions({ kind: 'flyoutToolbox', contents: [] }),
      media: '/node_modules/blockly/media/',
      trashcan: false,
    });
    Blockly.Events.disable();
    let call: Blockly.Block | null = null;
    try {
      const amountName = procedure.inputs.find((input) => input.id === 'amount')?.name ?? 'amount';
      const recipientName =
        procedure.inputs.find((input) => input.id === 'recipient')?.name ?? 'recipient';
      previewProject.characters[2].name = `Input: ${recipientName}`;
      let effects: Effect[] = [];
      if (view === 'definition' && procedure.example)
        effects = [
          {
            type: 'if',
            condition: { type: 'true' },
            then: [
              {
                type: 'update_property',
                entity: 'input-recipient',
                name: 'coins',
                op: 'add',
                operand: { type: 'literal', value: 5 },
              },
              {
                type: 'character_says',
                character: 'input-recipient',
                text: `Here are [Input: ${amountName}] coins.`,
              },
              {
                type: 'respond',
                id: 'example-replies',
                responses: ['I appreciate your help.', 'Thank you again.'],
                mode: 'repeat_last',
                fallback: '',
                exhaustion: 'once',
                on_exhausted: [],
              },
            ],
            otherwise: [{ type: 'say', text: 'The reward must be positive.' }],
          },
        ];
      else if (view === 'definition' && procedure.say)
        effects = [{ type: 'say', text: 'Your shared message.' }];
      else if (view === 'caller')
        effects = [
          {
            type: 'say',
            text: caller === 'action' ? 'Before the reward.' : 'You enter the Study.',
          },
          { type: 'say', text: 'The caller continues after the procedure.' },
        ];
      const root = loadEffectBlocks(ws, effects, {});
      root.setFieldValue(
        view === 'definition'
          ? `DEFINE PROCEDURE ${procedure.name}`
          : caller === 'action'
            ? 'WHEN GIVE BONUS RUNS'
            : 'WHEN PLAYER FIRST ENTERS STUDY',
        'FLOW_TITLE',
      );
      if (view === 'caller') {
        const before = root.getInputTargetBlock('DO')!;
        const after = before.getNextBlock()!;
        before.nextConnection!.disconnect();
        call = ws.newBlock('r0_call');
        call.setFieldValue(procedure.name, 'PROC');
        call.setFieldValue(
          procedure.inputs.find((p) => p.id === 'recipient')?.name ?? 'recipient',
          'RECIPIENT_LABEL',
        );
        call.setFieldValue(
          procedure.inputs.find((p) => p.id === 'amount')?.name ?? 'amount',
          'AMOUNT_LABEL',
        );
        call.setFieldValue(args.recipient, 'RECIPIENT');
        call.setFieldValue(args.amount, 'AMOUNT');
        before.nextConnection!.connect(call.previousConnection!);
        call.nextConnection!.connect(after.previousConnection!);
      } else if (procedure.example) {
        const name = procedure.inputs.find((p) => p.id === 'amount')?.name ?? 'amount';
        const branch = root.getInputTargetBlock('DO')!;
        branch.getInputTargetBlock('TEST')?.dispose(false);
        const test = ws.newBlock('r0_positive_input');
        test.setFieldValue(name, 'NAME');
        branch.getInput('TEST')!.connection!.connect(test.outputConnection!);
        const update = branch.getInputTargetBlock('THEN')!;
        update.getInput('OPERAND')!.connection!.setShadowState(null);
        update.getInputTargetBlock('OPERAND')?.dispose(false);
        const value = ws.newBlock('r0_integer_input');
        value.setFieldValue(name, 'NAME');
        update.getInput('OPERAND')!.connection!.connect(value.outputConnection!);
      }
      root.moveBy(24, 24);
      ws.getAllBlocks(false).forEach((block) => block.initSvg());
      ws.render();
      refreshChainEnds(ws);
      if (call) (call as Blockly.BlockSvg).select();
      ws.zoomToFit();
      if (ws.scale > 1) ws.setScale(1);
    } finally {
      Blockly.Events.enable();
    }
    const listener = (event: Blockly.Events.Abstract) => {
      if (event instanceof Blockly.Events.Selected && event.newElementId)
        callbacks.current.onSelect(ws.getBlockById(event.newElementId)?.type ?? '');
      if (event instanceof Blockly.Events.BlockChange && call && event.blockId === call.id) {
        if (event.name === 'RECIPIENT')
          callbacks.current.onArguments({ recipient: String(event.newValue) });
        if (event.name === 'AMOUNT')
          callbacks.current.onArguments({ amount: Number(event.newValue) });
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
    };
  }, [signature, view, caller, args.recipient, args.amount]);
  return (
    <div
      className="r0-canvas"
      ref={host}
      aria-label={view === 'caller' ? 'Caller block workspace' : 'Procedure block workspace'}
    />
  );
}
function Field({ label, children, help }: { label: string; children: ReactNode; help?: string }) {
  const helpId = useId();
  return (
    <label className="r0-field">
      <span>{label}</span>
      {Children.map(children, (child) =>
        isValidElement(child) &&
        typeof child.type === 'string' &&
        ['input', 'select', 'textarea'].includes(child.type)
          ? cloneElement(
              child as ReactElement<{ 'aria-label': string; 'aria-describedby'?: string }>,
              { 'aria-label': label, 'aria-describedby': help ? helpId : undefined },
            )
          : child,
      )}
      {help && (
        <small id={helpId} className="muted">
          {help}
        </small>
      )}
    </label>
  );
}
function App() {
  const [model, setModel] = useState<Model>(() => structuredClone(first));
  const [history, setHistory] = useState<{ model: Model; label: string }[]>([]);
  const [view, setView] = useState<View>('list');
  const [selected, setSelected] = useState('award');
  const [caller, setCaller] = useState<Caller>('action');
  const [returnTo, setReturnTo] = useState<Caller | null>(null);
  const [panel, setPanel] = useState<Panel>('settings');
  const [inspector, setInspector] = useState(true);
  const [play, setPlay] = useState(true);
  const [search, setSearch] = useState('');
  const [notice, setNotice] = useState('Choose a procedure, or open either example caller.');
  const [modal, setModal] = useState<'create' | 'input' | 'impact' | 'delete' | 'explain' | null>(
    null,
  );
  const [newName, setNewName] = useState('');
  const [newType, setNewType] = useState<InputType>('Integer');
  const [change, setChange] = useState<{ id: string; type: InputType } | null>(null);
  const [balances, setBalances] = useState<Record<string, number>>({ Keeper: 0, Guide: 0 });
  const [cursors, setCursors] = useState<Record<Caller, number>>({ action: 0, trigger: 0 });
  const [lines, setLines] = useState<string[]>([
    'Scripted preview: calls share one definition and retain separate response progress.',
  ]);
  const [last, setLast] = useState<{
    caller: Caller;
    recipient: string;
    amount: number;
    reply: number | null;
  } | null>(null);
  const procedure = model.procedures.find((p) => p.id === selected) ?? model.procedures[0];
  const amount = procedure?.inputs.find((p) => p.id === 'amount');
  const award = model.procedures.find((p) => p.id === 'award')!;
  const findings = award.inputs.flatMap((input) => {
    if (input.id === 'amount' && input.type !== 'Integer')
      return [
        'Reward body requires Integer',
        'Give bonus argument needs repair',
        'First-entry bonus argument needs repair',
      ];
    if (input.id === 'recipient' && input.type !== 'Character')
      return [
        'Reward body requires Character with coins: Integer',
        'Give bonus recipient needs repair',
        'First-entry bonus recipient needs repair',
      ];
    if (!['recipient', 'amount'].includes(input.id))
      return [`Give bonus needs ${input.name}`, `First-entry bonus needs ${input.name}`];
    return [];
  });
  const invalid = findings.length > 0;
  const duplicateInput =
    modal === 'input' &&
    !!procedure?.inputs.some((input) => input.name.toLowerCase() === newName.trim().toLowerCase());
  const uses = procedure?.id === 'award' ? 2 : 0;
  const edit = (label: string, apply: (draft: Model) => void) => {
    setHistory((old) => [...old, { model: structuredClone(model), label }]);
    const next = structuredClone(model);
    apply(next);
    setModel(next);
    setNotice(label + '. Preview changes stay in this browser tab.');
  };
  const editProcedure = (label: string, apply: (p: Procedure) => void) =>
    edit(label, (draft) => apply(draft.procedures.find((p) => p.id === procedure!.id)!));
  const undo = () => {
    const entry = history.at(-1);
    if (!entry) return;
    setModel(entry.model);
    setHistory(history.slice(0, -1));
    setNotice(`Undid: ${entry.label}. Input IDs and caller values were restored.`);
  };
  const openDefinition = (origin?: Caller) => {
    setSelected('award');
    setReturnTo(origin ?? null);
    setView('definition');
    setPanel('settings');
    setInspector(true);
  };
  const openCaller = (which: Caller) => {
    setCaller(which);
    setSelected('award');
    setView('caller');
    setPanel('block');
    setInspector(true);
    setReturnTo(null);
  };
  const updateArguments = (patch: Partial<Arguments>) =>
    edit('Change call inputs', (draft) => Object.assign(draft.calls[caller], patch));
  const reset = () => {
    setModel(structuredClone(first));
    setHistory([]);
    setSelected('award');
    setView('list');
    setPanel('settings');
    setReturnTo(null);
    setModal(null);
    setBalances({ Keeper: 0, Guide: 0 });
    setCursors({ action: 0, trigger: 0 });
    setLast(null);
    setLines(['Scripted preview reset.']);
    setNotice('Example reset. No project files changed.');
  };
  const simulate = (which: Caller) => {
    if (invalid) return;
    const args = model.calls[which];
    const reply = Math.min(cursors[which], 1);
    if (args.amount > 0) {
      setBalances((old) => ({ ...old, [args.recipient]: old[args.recipient] + args.amount }));
      setCursors((old) => ({ ...old, [which]: Math.min(old[which] + 1, 1) }));
    }
    setLines((old) => [
      ...old,
      `> ${which === 'action' ? 'use bonus' : '[first-entry trigger]'}`,
      ...(args.amount > 0
        ? [
            `${args.recipient}: Here are ${args.amount} coins.`,
            reply === 0 ? 'I appreciate your help.' : 'Thank you again.',
          ]
        : ['The reward must be positive.']),
      'The caller continues after the procedure.',
    ]);
    setLast({ caller: which, ...args, reply: args.amount > 0 ? reply + 1 : null });
  };
  return (
    <div className="r0-preview">
      <div className="r0-banner">
        <span>R0 design preview · simulated authoring and playtest · current block renderer</span>
        <span>Review proposal · docs/plans/block-procedures.md</span>
      </div>
      <header className="r0-header">
        <img src={logo} alt="Luna logo" />
        <strong>Luna Engine</strong>
        <span className="muted">/ Shared rewards</span>
        <div className="r0-top-actions">
          <button disabled={!history.length} onClick={undo} aria-label="Undo preview edit">
            Undo{history.length ? ` · ${history.at(-1)!.label}` : ''}
          </button>
          <button onClick={reset}>Reset example</button>
        </div>
      </header>
      <div className={`r0-shell ${!inspector ? 'r0-inspector-closed' : ''}`}>
        <nav className="r0-tree" aria-label="Project hierarchy">
          <strong>PROJECT</strong>
          <p className="muted">Shared rewards</p>
          <h3>Locations</h3>
          <p>◇ Study</p>
          <h3>Game data</h3>
          <button
            aria-current={view !== 'caller' ? 'page' : undefined}
            onClick={() => {
              setView('list');
              setReturnTo(null);
              setPanel('settings');
            }}
          >
            Procedures
          </button>
          <h3>Example callers</h3>
          <button
            aria-current={view === 'caller' && caller === 'action' ? 'page' : undefined}
            onClick={() => openCaller('action')}
          >
            Action · Give bonus
          </button>
          <button
            aria-current={view === 'caller' && caller === 'trigger' ? 'page' : undefined}
            onClick={() => openCaller('trigger')}
          >
            Trigger · First-entry bonus
          </button>
          <p className="r0-note">
            Templates create independent copies. Calls use one shared definition.
          </p>
        </nav>
        <main className="r0-workspace">
          <div className="r0-context">
            <nav aria-label="Editor navigation">
              <span>Shared rewards</span>
              <span aria-hidden="true"> › </span>
              {view === 'caller' ? (
                <>
                  <span>{caller === 'action' ? 'Study › Actions' : 'Triggers'}</span>
                  <span aria-hidden="true"> › </span>
                  <strong>{callNames[caller]}</strong>
                </>
              ) : (
                <>
                  <button onClick={() => setView('list')}>Procedures</button>
                  {view === 'definition' && (
                    <>
                      <span aria-hidden="true"> › </span>
                      <strong>{procedure?.name}</strong>
                    </>
                  )}
                </>
              )}
            </nav>
            {returnTo && view === 'definition' && (
              <button className="r0-return" onClick={() => openCaller(returnTo)}>
                ← Return to {callNames[returnTo]} → CALL
              </button>
            )}
          </div>
          <div className="r0-toolbar">
            <div>
              <h1>
                {view === 'list'
                  ? 'Procedures'
                  : view === 'definition'
                    ? procedure?.name
                    : callNames[caller]}
              </h1>
              <p className="muted">
                {view === 'list'
                  ? 'Build a shared flow, then call it wherever it is needed.'
                  : view === 'definition'
                    ? 'One definition. Changes affect its callers.'
                    : 'Select the CALL block, edit typed arguments, or open its definition.'}
              </p>
            </div>
            <div className="r0-buttons">
              {view === 'list' ? (
                <button
                  className="primary"
                  onClick={() => {
                    setNewName('');
                    setModal('create');
                  }}
                >
                  Add procedure
                </button>
              ) : (
                <>
                  <button
                    onClick={() => {
                      setPanel('settings');
                      setInspector(true);
                    }}
                  >
                    {view === 'definition' ? 'Procedure settings' : 'Flow settings'}
                  </button>
                  {view === 'definition' ? (
                    <button
                      onClick={() => {
                        setPanel('uses');
                        setInspector(true);
                      }}
                    >
                      Used by ({uses})
                    </button>
                  ) : (
                    <button
                      onClick={() => {
                        setPanel('block');
                        setInspector(true);
                      }}
                    >
                      Select CALL block
                    </button>
                  )}
                </>
              )}
            </div>
          </div>
          <div className="r0-notice" role="status">
            {notice}
          </div>
          {invalid && (
            <div className="r0-errors" role="alert">
              <strong>{findings.length} places need repair.</strong> {findings.join(' · ')}. Prior
              values stay available for repair or Undo.
              <button onClick={() => openDefinition()}>Open definition findings</button>
              <button onClick={undo}>Undo input type change</button>
            </div>
          )}
          {view === 'list' ? (
            <section className="r0-list" aria-label="Procedures list">
              <Field label="Search procedures">
                <input value={search} onChange={(e) => setSearch(e.target.value)} />
              </Field>
              {model.procedures
                .filter((p) => p.name.toLowerCase().includes(search.toLowerCase()))
                .map((p) => (
                  <article key={p.id}>
                    <div>
                      <h2>{p.name}</h2>
                      <p>{p.description || 'Add effects to this shared flow.'}</p>
                      <small className="muted">
                        {p.inputs.map((input) => `${input.name}: ${input.type}`).join(' · ') ||
                          'No inputs'}{' '}
                        · {p.id === 'award' ? '2 callers' : 'No callers'}
                      </small>
                    </div>
                    <button
                      onClick={() => {
                        setSelected(p.id);
                        setView('definition');
                        setPanel('settings');
                        setInspector(true);
                      }}
                    >
                      Open {p.name}
                    </button>
                  </article>
                ))}
            </section>
          ) : (
            <>
              <Canvas
                procedure={procedure!}
                caller={caller}
                args={model.calls[caller]}
                view={view}
                onSelect={(type) => {
                  setPanel(type === 'luna_flow' ? 'settings' : 'block');
                  setInspector(true);
                }}
                onArguments={updateArguments}
              />
              {view === 'definition' && !procedure!.example && (
                <div className="r0-empty">
                  <p>This procedure starts with an empty effects chain.</p>
                  <button
                    onClick={() =>
                      editProcedure('Insert SAY block', (p) => {
                        p.say = true;
                      })
                    }
                  >
                    Add SAY block
                  </button>
                </div>
              )}
            </>
          )}
          <section
            className={`r0-play ${!play ? 'r0-play-closed' : ''}`}
            aria-label="Scripted playtest preview"
          >
            <div className="r0-play-heading">
              <strong>Scripted playtest preview</strong>
              <button
                onClick={() => setPlay(!play)}
                aria-label={play ? 'Collapse preview playtest' : 'Expand preview playtest'}
              >
                {play ? 'Collapse' : 'Expand'}
              </button>
            </div>
            {play && (
              <>
                <p className="muted">
                  UI simulation only. Calls keep separate response progress, including with the same
                  input values.
                </p>
                <div className="r0-buttons">
                  <button disabled={invalid} onClick={() => simulate('action')}>
                    Run action call
                  </button>
                  <button disabled={invalid} onClick={() => simulate('trigger')}>
                    Run trigger call
                  </button>
                  <button disabled={!last} onClick={() => setModal('explain')}>
                    Explain last preview
                  </button>
                  <button
                    onClick={() => {
                      setBalances({ Keeper: 0, Guide: 0 });
                      setCursors({ action: 0, trigger: 0 });
                      setLast(null);
                      setLines(['Fresh scripted preview.']);
                    }}
                  >
                    Fresh preview
                  </button>
                </div>
                <div className="r0-play-content">
                  <div role="log" aria-label="Scripted transcript">
                    {lines.slice(-7).map((line, index) => (
                      <p key={index}>{line}</p>
                    ))}
                  </div>
                  <div className="r0-balances">
                    <p>
                      Keeper coins: <strong>{balances.Keeper}</strong>
                    </p>
                    <p>
                      Guide coins: <strong>{balances.Guide}</strong>
                    </p>
                    <p>
                      Next reply · action: {cursors.action + 1} / trigger: {cursors.trigger + 1}
                    </p>
                  </div>
                </div>
              </>
            )}
          </section>
        </main>
        {inspector ? (
          <aside className="r0-inspector" aria-label="Inspector">
            <div className="r0-inspector-heading">
              <strong>
                {panel === 'uses'
                  ? 'Used by'
                  : panel === 'block'
                    ? 'Selected block'
                    : view === 'caller'
                      ? 'Flow settings'
                      : 'Procedure settings'}
              </strong>
              <button onClick={() => setInspector(false)} aria-label="Collapse inspector">
                ›
              </button>
            </div>
            {view === 'list' ? (
              <p>
                Select a procedure to edit its shared effects and inputs. Use the example callers to
                inspect a CALL.
              </p>
            ) : panel === 'uses' ? (
              <>
                <h2>{procedure?.name}</h2>
                <p>Editing this definition affects {uses} callers.</p>
                {uses ? (
                  (['action', 'trigger'] as const).map((which) => (
                    <article className="r0-use" key={which}>
                      <strong>
                        {which === 'action' ? 'Study › Action' : 'Game › Trigger'} ·{' '}
                        {callNames[which]}
                      </strong>
                      <p>
                        {model.calls[which].recipient} · {model.calls[which].amount}
                      </p>
                      <button onClick={() => openCaller(which)}>
                        Open {callNames[which]} call
                      </button>
                    </article>
                  ))
                ) : (
                  <p>No call sites yet.</p>
                )}
                <button onClick={() => setPanel('settings')}>Back to procedure settings</button>
              </>
            ) : view === 'caller' && panel === 'block' ? (
              <>
                <h2>CALL {procedure?.name}</h2>
                <p className="muted">
                  {caller === 'action' ? 'Action' : 'Trigger'} · {callNames[caller]}
                </p>
                <Field label="recipient · Character" help="Requires coins: Integer.">
                  <select
                    value={model.calls[caller].recipient}
                    onChange={(e) => updateArguments({ recipient: e.target.value })}
                  >
                    <option>Keeper</option>
                    <option>Guide</option>
                    <option disabled>Visitor — missing coins: Integer</option>
                  </select>
                </Field>
                <Field
                  label={`${amount?.name ?? 'amount'} · ${amount?.type ?? 'Integer'}`}
                  help={
                    invalid
                      ? 'The previous Integer value is retained for explicit repair or Undo.'
                      : undefined
                  }
                >
                  <input
                    type="number"
                    value={model.calls[caller].amount}
                    disabled={invalid}
                    onChange={(e) => updateArguments({ amount: Number(e.target.value) })}
                  />
                </Field>
                {invalid && (
                  <p className="reference-error">
                    Argument type needs repair. Procedure body also needs an Integer input.
                  </p>
                )}
                <div className="r0-call-summary">
                  {procedure?.name}({model.calls[caller].recipient}, {model.calls[caller].amount})
                </div>
                <button className="primary" onClick={() => openDefinition(caller)}>
                  Open definition
                </button>
                <p>
                  Response progress belongs to this CALL occurrence. A separate caller starts with
                  its own first reply.
                </p>
                <button onClick={() => setPanel('settings')}>Back to flow settings</button>
              </>
            ) : view === 'caller' ? (
              <>
                <h2>{callNames[caller]}</h2>
                <p>
                  {caller === 'action' ? 'Command: use bonus' : 'Event: player first enters Study'}
                </p>
                <p>Before → CALL Award coins → After</p>
                <button onClick={() => setPanel('block')}>Select CALL block</button>
              </>
            ) : panel === 'block' ? (
              <>
                <h2>Procedure block</h2>
                <p>
                  Existing effect fields stay inside the blocks and remain available in this
                  inspector.
                </p>
                <p>
                  Input pickers are scoped to this procedure. Here, recipient is a Character with
                  coins: Integer, and {amount?.name ?? 'amount'} must be Integer.
                </p>
                <button onClick={() => setPanel('settings')}>Back to procedure settings</button>
              </>
            ) : (
              <>
                <Field label="Procedure name">
                  <input
                    key={procedure?.name}
                    defaultValue={procedure?.name}
                    onBlur={(e) => {
                      const name = e.target.value.trim();
                      if (name && name !== procedure?.name)
                        editProcedure('Rename procedure', (p) => {
                          p.name = name;
                        });
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') e.currentTarget.blur();
                    }}
                  />
                </Field>
                <Field label="Description">
                  <textarea
                    key={procedure?.id}
                    defaultValue={procedure?.description}
                    onBlur={(e) => {
                      if (e.target.value !== procedure?.description)
                        editProcedure('Edit procedure description', (p) => {
                          p.description = e.target.value;
                        });
                    }}
                  />
                </Field>
                <h3>Inputs</h3>
                <p className="muted">
                  Local to each call. Names can change while their references stay connected.
                </p>
                {procedure?.inputs.map((input) => (
                  <fieldset className="r0-input" key={input.id}>
                    <legend>{input.name}</legend>
                    <Field label={`Input name · ${input.name}`}>
                      <input
                        key={input.name}
                        defaultValue={input.name}
                        onBlur={(e) => {
                          const name = e.target.value.trim();
                          if (name && name !== input.name)
                            editProcedure('Rename input', (p) => {
                              p.inputs.find((i) => i.id === input.id)!.name = name;
                            });
                        }}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') e.currentTarget.blur();
                        }}
                      />
                    </Field>
                    <Field label={`Type · ${input.name}`}>
                      <select
                        value={input.type}
                        onChange={(e) => {
                          const type = e.target.value as InputType;
                          if (uses) {
                            setChange({ id: input.id, type });
                            setModal('impact');
                          } else
                            editProcedure('Change unused input type', (p) => {
                              p.inputs.find((i) => i.id === input.id)!.type = type;
                            });
                        }}
                      >
                        {kinds.map((kind) => (
                          <option key={kind}>{kind}</option>
                        ))}
                      </select>
                    </Field>
                    {input.property && (
                      <p>
                        Required property: <strong>{input.property}</strong>
                      </p>
                    )}
                  </fieldset>
                ))}
                <button
                  onClick={() => {
                    setNewName('');
                    setNewType('Integer');
                    setModal('input');
                  }}
                >
                  Add input
                </button>
                <div className="r0-policy">
                  <strong>Response progress</strong>
                  <p>
                    Separate at each CALL site. Saved with story progress; loading runs no effects.
                  </p>
                  <strong>STOP</strong>
                  <p>Ends this procedure and returns to its caller. END GAME stops every caller.</p>
                </div>
                <button onClick={() => setModal('delete')}>Delete procedure…</button>
              </>
            )}
          </aside>
        ) : (
          <button
            className="r0-expand"
            onClick={() => setInspector(true)}
            aria-label="Expand inspector"
          >
            ‹ Inspector
          </button>
        )}
      </div>
      {(modal === 'create' || modal === 'input') && (
        <Modal
          title={modal === 'create' ? 'Add procedure' : 'Add input'}
          close={() => setModal(null)}
        >
          <h2>{modal === 'create' ? 'Add procedure' : 'Add input'}</h2>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const name = newName.trim();
              if (!name) return;
              if (modal === 'create') {
                const id = crypto.randomUUID();
                edit('Add procedure', (draft) =>
                  draft.procedures.push({
                    id,
                    name,
                    description: '',
                    inputs: [],
                    example: false,
                    say: false,
                  }),
                );
                setSelected(id);
                setView('definition');
                setPanel('settings');
                setReturnTo(null);
                setInspector(true);
              } else
                editProcedure('Add input', (p) =>
                  p.inputs.push({ id: crypto.randomUUID(), name, type: newType }),
                );
              setModal(null);
            }}
          >
            <Field label="Name">
              <input value={newName} onChange={(e) => setNewName(e.target.value)} required />
              {duplicateInput && (
                <small className="reference-error">Choose a unique input name.</small>
              )}
            </Field>
            {modal === 'input' && (
              <Field label="Input type">
                <select value={newType} onChange={(e) => setNewType(e.target.value as InputType)}>
                  {kinds.map((kind) => (
                    <option key={kind}>{kind}</option>
                  ))}
                </select>
              </Field>
            )}
            <p>
              {modal === 'create'
                ? 'Start with an empty block flow and no inputs.'
                : 'Existing callers will need an explicit argument for this required input.'}
            </p>
            <div className="r0-buttons">
              <button type="button" onClick={() => setModal(null)}>
                Cancel
              </button>
              <button className="primary" disabled={!newName.trim() || duplicateInput}>
                Create {modal === 'create' ? 'procedure' : 'input'}
              </button>
            </div>
          </form>
        </Modal>
      )}
      {modal === 'impact' && change && (
        <Modal title="Review input change" close={() => setModal(null)}>
          <h2>Review input change</h2>
          <p>
            <strong>{procedure?.inputs.find((i) => i.id === change.id)?.name}</strong>:{' '}
            {procedure?.inputs.find((i) => i.id === change.id)?.type} → {change.type}
          </p>
          <p>
            This change affects the definition and {uses} callers. Old values are retained for
            repair; no conversion is guessed.
          </p>
          <ul>
            {change.id === 'amount' && (
              <li>Award coins · numeric condition and UPDATE PROPERTY require Integer.</li>
            )}
            {change.id === 'recipient' && (
              <li>
                Award coins · UPDATE PROPERTY and speech require Character with coins: Integer.
              </li>
            )}
            <li>
              Give bonus · current argument:{' '}
              {change.id === 'recipient' ? model.calls.action.recipient : model.calls.action.amount}
              .
            </li>
            <li>
              First-entry bonus · current argument:{' '}
              {change.id === 'recipient'
                ? model.calls.trigger.recipient
                : model.calls.trigger.amount}
              .
            </li>
          </ul>
          <p className="muted">
            Applying as a draft shows findings and prevents playtesting until repaired. Project Undo
            restores the complete change.
          </p>
          <div className="r0-buttons">
            <button onClick={() => setModal(null)}>Keep current type</button>
            <button
              className="primary"
              onClick={() => {
                editProcedure('Change input type', (p) => {
                  p.inputs.find((i) => i.id === change.id)!.type = change.type;
                });
                setPanel('settings');
                setModal(null);
              }}
            >
              Apply as draft
            </button>
          </div>
        </Modal>
      )}
      {modal === 'delete' && (
        <Modal title="Review procedure deletion" close={() => setModal(null)}>
          <h2>Delete {procedure?.name}?</h2>
          {uses ? (
            <>
              <p>
                Two CALL blocks use this definition. Reassign or remove those calls deliberately
                before deleting the procedure.
              </p>
              <p>Give bonus · First-entry bonus</p>
            </>
          ) : (
            <p>This procedure has no callers and can be removed.</p>
          )}
          <div className="r0-buttons">
            <button onClick={() => setModal(null)}>Cancel</button>
            <button
              className="danger"
              disabled={uses > 0}
              onClick={() => {
                edit('Delete unused procedure', (draft) => {
                  draft.procedures = draft.procedures.filter((p) => p.id !== procedure?.id);
                });
                setSelected('award');
                setView('list');
                setModal(null);
              }}
            >
              Delete unused procedure
            </button>
          </div>
        </Modal>
      )}
      {modal === 'explain' && last && (
        <Modal title="Scripted call explanation" close={() => setModal(null)}>
          <h2>Scripted call explanation</h2>
          <p>
            {callNames[last.caller]} → CALL {model.procedures.find((p) => p.id === 'award')?.name}
          </p>
          <dl>
            <dt>recipient · Character</dt>
            <dd>{last.recipient}, coins: Integer</dd>
            <dt>amount · Integer</dt>
            <dd>{last.amount}</dd>
            <dt>Progress scope</dt>
            <dd>{callNames[last.caller]} → this CALL → response sequence</dd>
            <dt>Reply used</dt>
            <dd>
              {last.reply === null
                ? 'No response consumed; amount was not positive.'
                : `${last.reply} of 2, independently of the other caller`}
            </dd>
          </dl>
          <p>
            {last.reply === null
              ? 'Failed positive-amount condition → refusal → return → continue caller.'
              : 'Update coins → speak → response → return → continue caller.'}
          </p>
          <p className="muted">
            Production explanations will observe the shared Rust executor. This trace is
            illustrative.
          </p>
          <div className="r0-buttons">
            <button
              onClick={() => {
                const origin = last.caller;
                setModal(null);
                openDefinition(origin);
              }}
            >
              Open shared definition
            </button>
            <button onClick={() => setModal(null)}>Close</button>
          </div>
        </Modal>
      )}
    </div>
  );
}
createRoot(document.getElementById('root')!).render(<App />);
