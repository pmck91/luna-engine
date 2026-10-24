import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type {
  ConfigView,
  Diagnostic,
  DiskView,
  GameState,
  HelpMode,
  PlaytestView,
  Project,
  ProjectListItem,
  ProjectView,
  Span,
} from './contracts';
import { ApiError, bundle, request } from './api';
import logoUrl from '../../assets/logo-transparent.png';
import {
  character,
  flow,
  flowOwner,
  gameDataPages,
  owner,
  location as makeLocation,
  object as makeObject,
} from './model';
import { lockedStudy } from './example';
import { Check, Field, StateInspector, Text } from './Forms';
import Inspector from './Inspector';
import WorldMap from './WorldMap';
import type { BlockSelection, BlockView, BlocksHandle } from './Blocks';
import BlockInspector from './BlockInspector';
import { useNavigation } from './navigation';
import { authoringRoom } from './authoring';
import ReferenceCreation from './ReferenceCreation';
import ReferenceManager, { ReferenceActions, type ReferenceRequest } from './ReferenceManager';
import { referencePlan, usedBy, type ReferenceSite, type ReferenceTarget } from './references';
import { connectedFindings, prepareDraftValidation, type Finding } from './diagnostics';
import { FindingContext, FindingsList, FindingSubject, InlineFindings } from './FindingContext';
import { ProjectHistory, type EditContext } from './projectHistory';
import Actions from './Actions';
import Hints from './Hints';
import Triggers from './Triggers';
import { projectTriggers, triggerPage } from './triggerModel';
import HintInspector from './HintInspector';
import type { HintSelection } from './HintBlocks';
import Templates, { type TemplateContext } from './Templates';
type Log = { command?: string; spans?: Span[] };
export default function App() {
  const [config, setConfig] = useState<ConfigView | null>(null);
  const [root, setRoot] = useState('');
  const [projects, setProjects] = useState<ProjectListItem[]>([]);
  const [view, setView] = useState<ProjectView | null>(null);
  const [doc, setDoc] = useState<Project | null>(null);
  const [selected, setSelected] = useState('');
  const [search, setSearch] = useState('');
  const [mode, setMode] = useState<'map' | 'actions' | 'hints' | 'triggers'>('map');
  const [triggerFilter, setTriggerFilter] = useState('');
  const [flowSelections, setFlowSelections] = useState<Record<string, string>>({});
  const [flowBreadcrumb, setFlowBreadcrumb] = useState('');
  const [hintSelection, setHintSelection] = useState<HintSelection | null>(null);
  const [templateContext, setTemplateContext] = useState<TemplateContext | null>(null);
  const blocks = useRef<BlocksHandle>(null);
  const blockViews = useRef<Record<string, BlockView>>({});
  const hintViews = useRef<Record<string, 'blocks' | 'forms'>>({});
  const mapView = useRef<{ x: number; y: number; zoom: number } | undefined>(undefined);
  const [blockSelections, setBlockSelections] = useState<Record<string, BlockSelection>>({});
  const selectBlock = useCallback((selection: BlockSelection | null, activate = false) => {
    if (!selection) return;
    setBlockSelections((old) => ({ ...old, [selection.flowId]: selection }));
    if (activate) {
      setSelected(selection.flowId);
      setFlowBreadcrumb(selection.flowId);
    }
  }, []);
  const [inspectorCollapsed, setInspectorCollapsed] = useState(false);
  const [playtestCollapsed, setPlaytestCollapsed] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [message, setMessage] = useState('');
  const [status, setStatus] = useState('Saved');
  const [conflict, setConflict] = useState(false);
  const [comparison, setComparison] = useState<DiskView | null>(null);
  const [validation, setValidation] = useState<{ version: string; findings: Finding[] }>({
    version: '',
    findings: [],
  });
  const [referenceRequest, setReferenceRequest] = useState<ReferenceRequest | null>(null);
  const [revealTarget, setRevealTarget] = useState<ReferenceSite | null>(null);
  const [templateSelection, setTemplateSelection] = useState<string | undefined>();
  const [showDiagnostics, setShowDiagnostics] = useState(false);
  const [findingFilter, setFindingFilter] = useState('all');
  const [projectModal, setProjectModal] = useState(false);
  const [newTitle, setNewTitle] = useState('My adventure');
  const [newFolder, setNewFolder] = useState('my-adventure');
  const [example, setExample] = useState(false);
  const [play, setPlay] = useState<PlaytestView | null>(null);
  const [logs, setLogs] = useState<Log[]>([]);
  const [input, setInput] = useState('');
  const [plain, setPlain] = useState(false);
  const [showState, setShowState] = useState(false);
  const [busy, setBusy] = useState(false);
  const [history, setHistory] = useState<string[]>([]);
  const [historyAt, setHistoryAt] = useState(0);
  const [playSource, setPlaySource] = useState('');
  const [playHelpMode, setPlayHelpMode] = useState<HelpMode | ''>('');
  const [playProject, setPlayProject] = useState<Project | null>(null);
  const current = useRef({ doc, view, conflict, selected });
  current.current = { doc, view, conflict, selected };
  const saved = useRef('');
  const projectHistory = useRef(new ProjectHistory());
  const [, refreshHistory] = useState(0);
  const fieldSession = useRef(0);
  const creationTransaction = useRef<{ group: string; label: string } | null>(null);
  useEffect(() => {
    const nextSession = () => {
      fieldSession.current++;
    };
    document.addEventListener('focusin', nextSession);
    document.addEventListener('pointerdown', nextSession);
    return () => {
      document.removeEventListener('focusin', nextSession);
      document.removeEventListener('pointerdown', nextSession);
    };
  }, []);
  const queue = useRef(Promise.resolve());
  const transcript = useRef<HTMLDivElement>(null);
  const inspectorContent = useRef<HTMLDivElement>(null);
  const editingVersion = doc ? JSON.stringify(doc) : '';
  const playVersion = `${playHelpMode}:${doc ? JSON.stringify({ ...doc, editor: undefined }) : ''}`;
  const error = useCallback((e: unknown) => {
    const text = e instanceof Error ? e.message : String(e);
    setMessage(text);
    if (e instanceof ApiError && e.status === 409) {
      setConflict(true);
      setStatus('External changes');
    }
  }, []);
  const refreshProjects = useCallback(
    () => request<ProjectListItem[]>('/projects').then(setProjects).catch(error),
    [error],
  );
  useEffect(() => {
    void request<ConfigView>('/config')
      .then((c) => {
        setConfig(c);
        setRoot(c.projects_root ?? '');
        if (c.projects_root) void refreshProjects();
      })
      .catch(error);
  }, [error, refreshProjects]);
  const apply = (v: ProjectView) => {
    projectHistory.current.reset();
    refreshHistory((n) => n + 1);
    blockViews.current = {};
    hintViews.current = {};
    mapView.current = undefined;
    saved.current = JSON.stringify(v.project);
    setView(v);
    setDoc(v.project);
    setSelected(v.project.game.id);
    setConflict(false);
    setComparison(null);
    setMessage('');
    setStatus('Saved');
    setPlay(null);
    setPlayProject(null);
    setLogs([]);
    setMode('map');
    setFlowSelections({});
    setFlowBreadcrumb('');
    setTriggerFilter('');
    setHintSelection(null);
    setBlockSelections({});
    setTemplateContext(null);
    setReferenceRequest(null);
    setRevealTarget(null);
    setValidation({ version: '', findings: [] });
    setFindingFilter('all');
  };
  const edit = useCallback((f: (p: Project) => void, context: EditContext = {}) => {
    const old = current.current.doc;
    if (!old) return;
    const next = structuredClone(old);
    f(next);
    if (creationTransaction.current) {
      // Declaration and assignment share a draft and publish only after both succeed.
      current.current.doc = next;
      return;
    }
    const active = document.activeElement;
    const textField = active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement;
    const fieldLabel = textField
      ? active.labels?.[0]?.textContent?.trim() || active.getAttribute('aria-label')
      : null;
    const options = {
      ...(textField
        ? {
            group: `field-${fieldSession.current}`,
            label: fieldLabel ? `Edit ${fieldLabel}` : 'Edit text',
          }
        : {}),
      ...context,
    };
    if (!projectHistory.current.record(old, next, options)) return;
    refreshHistory((n) => n + 1);
    current.current.doc = next;
    setDoc(next);
    setStatus(
      current.current.conflict
        ? 'External changes'
        : JSON.stringify(next) === saved.current
          ? 'Saved'
          : 'Unsaved changes',
    );
  }, []);
  const replayProject = useCallback((redo: boolean) => {
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    fieldSession.current++;
    const next = redo ? projectHistory.current.redo() : projectHistory.current.undo();
    if (!next) return;
    const previous = current.current.doc;
    const key = current.current.selected;
    current.current.doc = next;
    if (
      !owner(next, key) &&
      !flow(next, key) &&
      !Object.values(gameDataPages).some((page) => page === key)
    ) {
      const parent = previous && flowOwner(previous, key);
      const entity = previous && owner(previous, key);
      const room =
        entity && 'placement' in entity && entity.placement.type === 'location'
          ? entity.placement.location
          : entity && 'location' in entity
            ? entity.location
            : undefined;
      setSelected(
        parent && owner(next, parent.id)
          ? parent.id
          : room && owner(next, room)
            ? room
            : next.game.id,
      );
      setMode('map');
    }
    setDoc(next);
    setStatus(
      current.current.conflict
        ? 'External changes'
        : JSON.stringify(next) === saved.current
          ? 'Saved'
          : 'Unsaved changes',
    );
    refreshHistory((n) => n + 1);
  }, []);
  useEffect(() => {
    const shortcut = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.altKey) return;
      const target = event.target;
      if (
        target instanceof HTMLElement &&
        target.closest('input, textarea, [contenteditable="true"], dialog[open]')
      )
        return;
      const key = event.key.toLowerCase();
      if (key !== 'z' && key !== 'y') return;
      event.preventDefault();
      event.stopImmediatePropagation();
      replayProject(key === 'y' || event.shiftKey);
    };
    document.addEventListener('keydown', shortcut, true);
    return () => document.removeEventListener('keydown', shortcut, true);
  }, [replayProject]);
  const select = (key: string, includeFlow = true) => {
    const project = current.current.doc;
    setFlowBreadcrumb('');
    if (key === gameDataPages.triggers || key.startsWith(triggerPage())) {
      setSelected(gameDataPages.triggers);
      setTriggerFilter(key === gameDataPages.triggers ? '' : key.slice(triggerPage().length));
      setConnecting(false);
      setInspectorCollapsed(false);
      setMode('triggers');
      return;
    }
    const page = project?.game.endings.some((ending) => ending.id === key)
      ? gameDataPages.endings
      : Object.values(gameDataPages).find((page) => page === key);
    setSelected(page ?? key);
    if (page) {
      setConnecting(false);
      setInspectorCollapsed(false);
      setMode('map');
      return;
    }
    const selectedFlow = project && flow(project, key);
    if (project && selectedFlow) {
      if (includeFlow) setFlowBreadcrumb(key);
      setConnecting(false);
      const parent = flowOwner(project, key)!;
      if ('event' in selectedFlow) {
        if (mode !== 'triggers' || (triggerFilter && triggerFilter !== parent.id))
          setTriggerFilter(parent.id);
        setMode('triggers');
        setInspectorCollapsed(false);
      } else {
        setFlowSelections((previous) => ({ ...previous, [parent.id]: key }));
        setMode('actions');
      }
    } else if (mode === 'triggers') {
      setMode('map');
    }
  };
  useEffect(() => {
    if (Object.values(gameDataPages).some((page) => page === selected))
      inspectorContent.current?.scrollTo({ top: 0 });
  }, [selected]);
  const save = useCallback((): Promise<void> => {
    const operation = queue.current.then(async () => {
      const { doc, view, conflict } = current.current;
      if (!doc || !view) return;
      if (conflict)
        throw new Error('External changes need resolving. Reload, compare, or Save As.');
      const snapshot = JSON.stringify(doc);
      if (snapshot === saved.current) {
        setStatus('Saved');
        return;
      }
      setStatus('Saving…');
      const result = await request<ProjectView>(`/projects/${view.handle}`, 'PUT', {
        project: doc,
        revision: view.revision,
      });
      saved.current = snapshot;
      current.current.view = result;
      setView(result);
      setStatus(JSON.stringify(current.current.doc) === snapshot ? 'Saved' : 'Unsaved changes');
    });
    queue.current = operation.catch(error);
    return operation;
  }, [error]);
  useEffect(() => {
    if (!doc || conflict || editingVersion === saved.current) return;
    const timer = setTimeout(() => {
      void save().catch(error);
    }, 1500);
    return () => clearTimeout(timer);
  }, [editingVersion, conflict, save, error]);
  useEffect(() => {
    if (!doc) return;
    let active = true;
    const timer = setTimeout(() => {
      const drafts = prepareDraftValidation(doc);
      void Promise.all([
        request<Diagnostic[]>('/validate', 'POST', doc),
        drafts.hasDrafts
          ? request<Diagnostic[]>('/validate', 'POST', drafts.project)
          : Promise.resolve([]),
      ])
        .then(([runtime, draft]) => {
          if (active && JSON.stringify(current.current.doc) === editingVersion)
            setValidation({
              version: editingVersion,
              findings: [...connectedFindings(doc, runtime), ...drafts.findings(draft)],
            });
        })
        .catch((problem) => {
          if (active) error(problem);
        });
    }, 600);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [editingVersion, error]);
  useEffect(() => {
    if (!view) return;
    const timer = setInterval(() => {
      if (status === 'Saving…') return;
      void request<DiskView>(`/projects/${view.handle}/disk`)
        .then((disk) => {
          if (disk.revision !== current.current.view?.revision) {
            setConflict(true);
            setStatus('External changes');
          }
        })
        .catch(error);
    }, 5000);
    return () => clearInterval(timer);
  }, [view?.handle, status, error]);
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (current.current.doc && JSON.stringify(current.current.doc) !== saved.current)
        e.preventDefault();
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, []);
  useEffect(() => {
    transcript.current?.scrollTo({ top: transcript.current.scrollHeight, behavior: 'smooth' });
  }, [logs]);
  const start = async (at?: string) => {
    if (!doc) return;
    setBusy(true);
    try {
      const result = await request<PlaytestView>('/playtests', 'POST', {
        project: doc,
        location: at ?? null,
        help_mode: playHelpMode || null,
      });
      setPlay(result);
      setPlayProject(structuredClone(doc));
      setPlaySource(playVersion);
      setLogs(result.result.messages.map((spans) => ({ spans })));
      setShowState(false);
      setHistory([]);
      setHistoryAt(0);
    } catch (e) {
      error(e);
    } finally {
      setBusy(false);
    }
  };
  const send = async () => {
    if (!play || !input.trim() || busy) return;
    const command = input.trim();
    setInput('');
    const next = [...history, command];
    setHistory(next);
    setHistoryAt(next.length);
    setLogs((old) => [...old, { command }]);
    setBusy(true);
    try {
      const result = await request<PlaytestView>(`/playtests/${play.session}/commands`, 'POST', {
        command,
      });
      setPlay(result.result.control?.type === 'quit' ? null : result);
      setLogs((old) => [...old, ...result.result.messages.map((spans) => ({ spans }))]);
    } catch (e) {
      error(e);
    } finally {
      setBusy(false);
    }
  };
  const create = async () => {
    try {
      if (view && doc && editingVersion !== saved.current) await save();
      const v = await request<ProjectView>('/projects', 'POST', {
        folder: newFolder,
        title: newTitle,
      });
      if (example) {
        const project = lockedStudy(v.project);
        const updated = await request<ProjectView>(`/projects/${v.handle}`, 'PUT', {
          project,
          revision: v.revision,
        });
        apply(updated);
      } else apply(v);
      setProjectModal(false);
      void refreshProjects();
    } catch (e) {
      error(e);
    }
  };
  const open = async (folder: string) => {
    try {
      if (doc && editingVersion !== saved.current) await save();
      apply(await request<ProjectView>('/open', 'POST', { folder }));
    } catch (e) {
      error(e);
    }
  };
  const saveAs = async () => {
    if (!view || !doc) return;
    const folder = window.prompt('New project folder name');
    if (!folder) return;
    try {
      apply(
        await request<ProjectView>(`/projects/${view.handle}/save-as`, 'POST', {
          folder,
          project: doc,
        }),
      );
      void refreshProjects();
    } catch (e) {
      error(e);
    }
  };
  const exportGame = async () => {
    if (!view || !doc) return;
    try {
      await save();
      const data = await bundle(view.handle);
      const url = URL.createObjectURL(data);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${view.folder}.luna`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) {
      error(e);
    }
  };
  const remove = (key: string) => {
    if (!doc) return;
    const target: ReferenceTarget = flow(doc, key)
      ? { kind: 'flow', id: key }
      : { kind: 'entity', id: key };
    if (usedBy(doc, target).length) {
      setReferenceRequest({ target, action: 'delete' });
      return;
    }
    if (!window.confirm('Delete this unused content? You can undo this change.')) return;
    const parent = doc && flowOwner(doc, key);
    edit((p) => {
      const result = referencePlan(p, target);
      if (result.errors.length) throw new Error(result.errors.join(' '));
      Object.assign(p, result.project);
    });
    setSelected(parent?.id ?? doc?.game.id ?? '');
  };
  const reveal = (site: ReferenceSite) => {
    if (!doc) return;
    setShowDiagnostics(false);
    setInspectorCollapsed(false);
    setRevealTarget({ ...site });
    if (site.templateId) {
      setTemplateSelection(site.templateId);
      setTemplateContext({ ownerId: doc.game.id, flowId: null, selectedEffects: null });
    } else if (site.puzzleId && site.ownerId) {
      setSelected(site.ownerId);
      setMode('hints');
      const clue = site.path.match(/^clues\.(\d+)/);
      setHintSelection({
        ownerId: site.ownerId,
        puzzleId: site.puzzleId,
        part: site.stageId
          ? clue
            ? { type: 'clue', stageId: site.stageId, index: Number(clue[1]) }
            : site.path.startsWith('solution')
              ? { type: 'solution', stageId: site.stageId }
              : { type: 'stage', stageId: site.stageId }
          : { type: 'puzzle' },
      });
    } else if (site.flowId) {
      blocks.current?.selectBlock(null);
      setBlockSelections((old) => {
        const next = { ...old };
        delete next[site.flowId!];
        return next;
      });
      select(site.flowId);
    } else if (doc.vocabulary.some((verb) => verb.id === site.subject))
      select(gameDataPages.vocabulary);
    else select(site.subject);
  };
  const upload = async (file: File) => {
    if (!view) return;
    try {
      await save();
      const v = current.current.view!;
      const draftAtUpload = JSON.stringify(current.current.doc);
      const response = await fetch(
        `/api/v1/projects/${v.handle}/assets?name=${encodeURIComponent(file.name)}&revision=${v.revision}`,
        {
          method: 'POST',
          headers: { 'x-luna-token': sessionStorage.getItem('luna-token') ?? '' },
          body: file,
        },
      );
      if (!response.ok) throw new Error((await response.json()).error);
      const result = (await response.json()) as ProjectView;
      saved.current = JSON.stringify(result.project);
      const next =
        JSON.stringify(current.current.doc) === draftAtUpload
          ? result.project
          : {
              ...current.current.doc!,
              game: { ...current.current.doc!.game, assets: result.project.game.assets },
            };
      current.current.view = result;
      current.current.doc = next;
      setView(result);
      setDoc(next);
      setStatus(JSON.stringify(next) === saved.current ? 'Saved' : 'Unsaved changes');
    } catch (e) {
      error(e);
    }
  };
  const activeFlow = doc && flow(doc, selected);
  const creationRoom = doc ? authoringRoom(doc, selected) : '';
  const creationRoomName =
    doc?.locations.find((room) => room.id === creationRoom)?.name ?? 'a room';
  const actionOwner = doc && (owner(doc, selected) ?? flowOwner(doc, selected));
  const hintOwner = actionOwner && 'hints' in actionOwner ? actionOwner : null;
  const actionFlow =
    (activeFlow && !('event' in activeFlow) ? activeFlow : undefined) ??
    (doc && actionOwner && flow(doc, flowSelections[actionOwner.id])) ??
    actionOwner?.actions[0] ??
    (actionOwner && 'exits' in actionOwner ? actionOwner.exits[0] : undefined);
  const activeTrigger =
    activeFlow && 'event' in activeFlow
      ? activeFlow
      : doc
        ? projectTriggers(doc).find((item) => !triggerFilter || item.ownerId === triggerFilter)
            ?.trigger
        : undefined;
  const inspectedFlow = mode === 'triggers' ? activeTrigger : activeFlow;
  const inspectedOwner = doc && inspectedFlow ? flowOwner(doc, inspectedFlow.id) : actionOwner;
  const inspectedBlock =
    (mode === 'actions' || mode === 'triggers') &&
    inspectedFlow &&
    blockSelections[inspectedFlow.id]?.kind !== 'root'
      ? blockSelections[inspectedFlow.id]
      : undefined;
  // A default flow keeps the workspace useful without adding an unchosen breadcrumb.
  const breadcrumbFlow =
    inspectedFlow && (flowBreadcrumb === inspectedFlow.id || inspectedBlock)
      ? inspectedFlow
      : undefined;
  useEffect(() => {
    if (mode === 'triggers') inspectorContent.current?.scrollTo({ top: 0 });
  }, [mode, activeTrigger?.id]);
  useEffect(() => {
    if (
      mode === 'triggers' &&
      activeFlow &&
      'event' in activeFlow &&
      actionOwner &&
      triggerFilter &&
      triggerFilter !== actionOwner.id
    )
      setTriggerFilter(actionOwner.id);
  }, [mode, activeFlow, actionOwner, triggerFilter]);
  const navigationKey = JSON.stringify([
    selected,
    mode,
    triggerFilter,
    hintSelection,
    flowBreadcrumb,
    inspectedBlock?.blockId,
  ]);
  useEffect(() => {
    if (!revealTarget) return;
    const frame = requestAnimationFrame(() => {
      const pane = inspectorContent.current;
      if (!pane) return;
      const fields = [...pane.querySelectorAll<HTMLElement>('[data-field-path]')].filter(
        (field) =>
          !field.dataset.fieldSubject || field.dataset.fieldSubject === revealTarget.subject,
      );
      const field = fields
        .filter((field) => {
          const path = field.dataset.fieldPath!;
          return (
            revealTarget.path === path ||
            revealTarget.path.startsWith(`${path}.`) ||
            path.startsWith(`${revealTarget.path}.`)
          );
        })
        .sort((a, b) => b.dataset.fieldPath!.length - a.dataset.fieldPath!.length)[0];
      for (const existing of pane.querySelectorAll('.finding-focus'))
        existing.classList.remove('finding-focus');
      const target = field ?? pane.querySelector<HTMLElement>('.inline-findings');
      if (target) {
        if (target instanceof HTMLDetailsElement) target.open = true;
        for (
          let ancestor = target.parentElement;
          ancestor && ancestor !== pane;
          ancestor = ancestor.parentElement
        )
          if (ancestor instanceof HTMLDetailsElement) ancestor.open = true;
        target.classList.add('finding-focus');
        target.scrollIntoView({ block: 'nearest' });
        field
          ?.querySelector<HTMLElement>('input, textarea, select')
          ?.focus({ preventScroll: true });
      }
    });
    return () => cancelAnimationFrame(frame);
  }, [revealTarget, selected, mode, inspectedBlock?.blockId]);
  const inspectorPositions = useRef<Record<string, number>>({});
  const inspectorFocus = useRef<
    Record<string, { label: string; start: number | null; end: number | null }>
  >({});
  useLayoutEffect(() => {
    const pane = inspectorContent.current;
    if (!pane) return;
    pane.scrollTop = inspectorPositions.current[navigationKey] ?? 0;
    const remembered = inspectorFocus.current[navigationKey];
    if (remembered) {
      const label = [...pane.querySelectorAll('label')].find(
        (label) => label.textContent?.trim() === remembered.label,
      );
      const control = label?.control;
      if (
        control instanceof HTMLInputElement ||
        control instanceof HTMLTextAreaElement ||
        control instanceof HTMLSelectElement
      ) {
        control.focus({ preventScroll: true });
        if (
          !(control instanceof HTMLSelectElement) &&
          remembered.start !== null &&
          remembered.end !== null
        ) {
          try {
            control.setSelectionRange(remembered.start, remembered.end);
          } catch {
            /* number and checkbox fields have no caret */
          }
        }
      }
    }
    return () => {
      inspectorPositions.current[navigationKey] = pane.scrollTop;
    };
  }, [navigationKey]);
  const navigation = useNavigation(
    view?.handle ?? '',
    navigationKey,
    {
      selected,
      mode,
      triggerFilter,
      hintSelection,
      search,
      flowSelections,
      flowBreadcrumb,
      blockSelections,
    },
    (entry) => {
      setSelected(entry.selected);
      setMode(entry.mode);
      setTriggerFilter(entry.triggerFilter);
      setHintSelection(entry.hintSelection);
      setSearch(entry.search);
      setFlowSelections(entry.flowSelections);
      setFlowBreadcrumb(entry.flowBreadcrumb);
      setBlockSelections(entry.blockSelections);
      setConnecting(false);
    },
  );
  const historyControls = {
    undoLabel: projectHistory.current.undoLabel,
    redoLabel: projectHistory.current.redoLabel,
    replay: replayProject,
  };
  const diagnostics = validation.version === editingVersion ? validation.findings : [];
  const countErrors = diagnostics.filter(
    (d) => d.scope !== 'draft' && d.severity === 'error',
  ).length;
  const countWarnings = diagnostics.filter(
    (d) => d.scope !== 'draft' && d.severity === 'warning',
  ).length;
  const editor = (
    <div className="app">
      <header>
        <div className="brand">
          <img className="brand-logo" src={logoUrl} alt="" width="38" height="38" />
          <strong>Luna Engine</strong>
          {doc && <span className="project-title">/ {doc.game.title}</span>}
        </div>
        <div className="header-actions">
          <span className={`save-status ${conflict ? 'warning' : ''}`} role="status">
            {doc && status}
          </span>
          {doc && (
            <>
              <button
                aria-label="Undo project change"
                title={
                  projectHistory.current.undoLabel
                    ? `Undo: ${projectHistory.current.undoLabel} (Ctrl/Cmd Z)`
                    : 'Nothing to undo'
                }
                disabled={!projectHistory.current.undoLabel}
                onClick={() => replayProject(false)}
              >
                Undo
              </button>
              <button
                aria-label="Redo project change"
                title={
                  projectHistory.current.redoLabel
                    ? `Redo: ${projectHistory.current.redoLabel} (Ctrl/Cmd Shift Z)`
                    : 'Nothing to redo'
                }
                disabled={!projectHistory.current.redoLabel}
                onClick={() => replayProject(true)}
              >
                Redo
              </button>
            </>
          )}
          <button onClick={() => setProjectModal(true)} disabled={!config?.projects_root}>
            New
          </button>
          <select
            aria-label="Open project"
            value=""
            disabled={!config?.projects_root}
            onChange={(e) => {
              if (e.target.value) void open(e.target.value);
            }}
          >
            <option value="">Open…</option>
            {projects.map((p) => (
              <option key={p.folder} value={p.folder}>
                {p.title}
              </option>
            ))}
          </select>
          <button
            disabled={!doc || conflict}
            onClick={() => {
              void save().catch(error);
            }}
          >
            Save
          </button>
          <button
            disabled={!doc}
            onClick={() => {
              void saveAs();
            }}
          >
            Save As
          </button>
          <button disabled={!doc} onClick={() => setShowDiagnostics((v) => !v)}>
            Validate {countErrors > 0 && <span className="error-count">{countErrors} errors</span>}
            {countWarnings > 0 && <span className="warning-count">{countWarnings} warnings</span>}
          </button>
          <button
            className="primary"
            disabled={!doc || conflict || countErrors > 0}
            onClick={() => {
              void exportGame();
            }}
          >
            Export .luna
          </button>
        </div>
      </header>
      {message && (
        <div className="banner error" role="alert">
          <span>{message}</span>
          <button aria-label="Dismiss message" onClick={() => setMessage('')}>
            ×
          </button>
        </div>
      )}
      {conflict && view && (
        <div className="banner warning">
          <span>Project files changed outside Luna. Autosave is paused.</span>
          <button
            onClick={() => {
              if (window.confirm('Reload from disk and discard in-memory edits?'))
                void request<ProjectView>('/open', 'POST', { folder: view.folder })
                  .then(apply)
                  .catch(error);
            }}
          >
            Reload from disk
          </button>
          <button
            onClick={() => {
              void request<DiskView>(`/projects/${view.handle}/disk`)
                .then(setComparison)
                .catch(error);
            }}
          >
            Compare changes
          </button>
          <button
            onClick={() => {
              void saveAs();
            }}
          >
            Save As
          </button>
        </div>
      )}
      {view?.recovery && (
        <div className="banner warning">
          <span>A recovery draft is available.</span>
          <button
            onClick={() => {
              setDoc(view.recovery!.project);
              setStatus('Recovered draft');
              if (view.recovery!.revision !== view.revision) setConflict(true);
              setView({ ...view, recovery: null });
            }}
          >
            Recover draft
          </button>
          <button
            onClick={() => {
              saved.current = '';
              setView({ ...view, recovery: null });
              void save().catch(error);
            }}
          >
            Discard recovery draft
          </button>
        </div>
      )}
      {!config?.projects_root ? (
        <main className="welcome">
          <div className="welcome-card">
            <img
              className="welcome-logo"
              src={logoUrl}
              alt="Luna Engine logo: a black cat sitting on a golden crescent moon"
              width="112"
              height="112"
            />
            <div className="eyebrow">LOCAL WORLDS. YOUR STORIES.</div>
            <h1>
              A world begins
              <br />
              with a few words.
            </h1>
            <p>
              Choose a local directory for your projects. Luna keeps readable game files here, ready
              for your own Git workflow.
            </p>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void request<ConfigView>('/config', 'POST', { projects_root: root })
                  .then((c) => {
                    setConfig(c);
                    void refreshProjects();
                  })
                  .catch(error);
              }}
            >
              <Text label="Projects directory (absolute path)" value={root} onChange={setRoot} />
              <button className="primary">Use this directory</button>
            </form>
          </div>
        </main>
      ) : !doc ? (
        <main className="welcome">
          <div className="welcome-card">
            <img
              className="welcome-logo"
              src={logoUrl}
              alt="Luna Engine logo: a black cat sitting on a golden crescent moon"
              width="112"
              height="112"
            />
            <div className="eyebrow">YOUR NEXT ADVENTURE</div>
            <h1>
              Build a world.
              <br />
              Let words open it.
            </h1>
            <p>
              Connect places, give objects a story, and play it all through a real command parser.
            </p>
            <button className="primary" onClick={() => setProjectModal(true)}>
              Create a project
            </button>
            {projects.length > 0 && (
              <div className="recent">
                <h3>Your projects</h3>
                {projects.map((p) => (
                  <button
                    className="list-item"
                    key={p.folder}
                    onClick={() => {
                      void open(p.folder);
                    }}
                  >
                    ◇ {p.title}
                    <span>→</span>
                  </button>
                ))}
              </div>
            )}
            <small>{config.projects_root}</small>
          </div>
        </main>
      ) : (
        <main className={`workspace ${inspectorCollapsed ? 'inspector-collapsed' : ''}`}>
          <nav className="hierarchy" aria-label="Project hierarchy">
            <h3>Project</h3>
            <input
              aria-label="Search project"
              placeholder="Search the world…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <p className="creation-context" id="creation-room-context">
              New objects and characters go in <strong>{creationRoomName}</strong>.
            </p>
            {[
              {
                title: 'Locations',
                items: doc.locations,
                add: () =>
                  edit((p) => {
                    const l = makeLocation();
                    p.locations.push(l);
                    select(l.id);
                    setInspectorCollapsed(false);
                    setMode('map');
                  }),
              },
              {
                title: 'Objects',
                items: doc.objects,
                add: () =>
                  edit((p) => {
                    const o = makeObject(creationRoom);
                    p.objects.push(o);
                    select(o.id);
                    setInspectorCollapsed(false);
                  }),
              },
              {
                title: 'Characters',
                items: doc.characters,
                add: () =>
                  edit((p) => {
                    const c = character(creationRoom);
                    p.characters.push(c);
                    select(c.id);
                    setInspectorCollapsed(false);
                  }),
              },
            ].map((section) => (
              <section key={section.title}>
                <div className="section-heading">
                  <h4>{section.title}</h4>
                  <button
                    aria-label={`Add ${section.title.toLowerCase().replace(/s$/, '')}`}
                    title={`Add ${section.title.toLowerCase().replace(/s$/, '')}${section.title === 'Locations' ? '' : ` to ${creationRoomName}`}`}
                    aria-describedby={
                      section.title === 'Locations' ? undefined : 'creation-room-context'
                    }
                    onClick={section.add}
                  >
                    +
                  </button>
                </div>
                {section.items
                  .filter((e) => e.name.toLowerCase().includes(search.toLowerCase()))
                  .map((e) => (
                    <button
                      key={e.id}
                      className={`tree-item ${e.id === selected || (mode === 'actions' && actionOwner?.id === e.id) ? 'active' : ''}`}
                      onClick={() => select(e.id)}
                    >
                      <span>◇</span>
                      {e.name}
                    </button>
                  ))}
              </section>
            ))}
            <hr />
            <section aria-label="Game data">
              <div className="section-heading">
                <h4>Game data</h4>
              </div>
              {[
                { id: gameDataPages.variables, name: 'Variables', icon: '◈' },
                { id: gameDataPages.vocabulary, name: 'Command vocabulary', icon: '⌘' },
                { id: gameDataPages.triggers, name: 'Triggers', icon: '⚡' },
                { id: gameDataPages.endings, name: 'Endings', icon: '⚑' },
              ].map((item) => (
                <button
                  key={item.id}
                  className={`tree-item ${selected === item.id || (item.id === gameDataPages.triggers && mode === 'triggers') ? 'active' : ''}`}
                  aria-current={
                    selected === item.id ||
                    (item.id === gameDataPages.triggers && mode === 'triggers')
                      ? 'page'
                      : undefined
                  }
                  onClick={() => select(item.id)}
                >
                  <span aria-hidden="true">{item.icon}</span>
                  {item.name}
                </button>
              ))}
            </section>
            <section aria-label="Tools">
              <h3>Tools</h3>
              <button className="tree-item" onClick={() => select(doc.game.id)}>
                ⚙ Game settings
              </button>
              <button
                className="tree-item"
                onClick={() => {
                  void request(`/projects/${view!.handle}/folder`, 'POST').catch(error);
                }}
              >
                ▣ Open project folder
              </button>
              <details className="assets">
                <summary>Assets · {doc.game.assets.length}</summary>
                {doc.game.assets.map((a) => (
                  <small key={a}>{a}</small>
                ))}
                <label className="file-button">
                  Add asset
                  <input
                    type="file"
                    onChange={(e) => {
                      if (e.target.files?.[0]) void upload(e.target.files[0]);
                    }}
                  />
                </label>
              </details>
            </section>
            <small className="local-note">
              ● Local project
              <br />
              {view?.folder}
            </small>
          </nav>
          <div className="center">
            <section className="canvas-section">
              <nav className="breadcrumbs" aria-label="Editor navigation">
                <button
                  aria-label="Navigate back"
                  disabled={!navigation.canBack}
                  onClick={navigation.back}
                >
                  ←
                </button>
                <button
                  aria-label="Navigate forward"
                  disabled={!navigation.canForward}
                  onClick={navigation.forward}
                >
                  →
                </button>
                <button onClick={() => select(doc.game.id)}>{doc.game.title}</button>
                {actionOwner && actionOwner.id !== doc.game.id && (
                  <>
                    <span aria-hidden="true">›</span>
                    <button onClick={() => select(actionOwner.id)}>
                      {'title' in actionOwner ? actionOwner.title : actionOwner.name}
                    </button>
                  </>
                )}
                <span aria-hidden="true">›</span>
                <span>
                  {mode === 'map'
                    ? 'World map'
                    : mode === 'hints'
                      ? 'Hints'
                      : mode === 'triggers'
                        ? 'Triggers'
                        : 'Actions'}
                </span>
                {breadcrumbFlow && (
                  <>
                    <span aria-hidden="true">›</span>
                    <button
                      onClick={() => {
                        setFlowBreadcrumb(breadcrumbFlow.id);
                        blocks.current?.selectBlock(null);
                        setBlockSelections((old) => {
                          const next = { ...old };
                          delete next[breadcrumbFlow.id];
                          return next;
                        });
                      }}
                    >
                      {breadcrumbFlow.name ||
                        ('event' in breadcrumbFlow
                          ? breadcrumbFlow.event.replaceAll('_', ' ')
                          : 'Action')}
                    </button>
                  </>
                )}
                {inspectedBlock && (
                  <>
                    <span aria-hidden="true">›</span>
                    <span aria-current="location">
                      {inspectedBlock.label}
                      {!inspectedBlock.connected && ' (draft)'}
                    </span>
                  </>
                )}
              </nav>
              <div className="canvas-toolbar">
                <div className="tabs">
                  <button className={mode === 'map' ? 'active' : ''} onClick={() => setMode('map')}>
                    World map
                  </button>
                  <button
                    className={mode === 'actions' ? 'active' : ''}
                    disabled={!actionOwner}
                    onClick={() => {
                      setConnecting(false);
                      if (actionFlow)
                        select(
                          actionFlow.id,
                          activeFlow?.id === actionFlow.id && flowBreadcrumb === actionFlow.id,
                        );
                      setMode('actions');
                    }}
                  >
                    Actions
                  </button>
                  <button
                    className={mode === 'hints' ? 'active' : ''}
                    disabled={!hintOwner}
                    onClick={() => {
                      setConnecting(false);
                      if (hintOwner) setSelected(hintOwner.id);
                      setMode('hints');
                    }}
                  >
                    Hints
                  </button>
                </div>
                <button
                  onClick={() => {
                    const source =
                      mode === 'actions'
                        ? actionFlow
                        : mode === 'triggers'
                          ? activeTrigger
                          : undefined;
                    setTemplateContext({
                      ownerId:
                        (source && flowOwner(doc, source.id)?.id) ?? actionOwner?.id ?? doc.game.id,
                      flowId: source?.id ?? null,
                      selectedEffects: source ? (blocks.current?.selectedEffects() ?? null) : null,
                    });
                  }}
                >
                  Block templates
                </button>
                {mode === 'map' && (
                  <button
                    className={`exit-tool ${connecting ? 'active' : ''}`}
                    aria-pressed={connecting}
                    onClick={() => setConnecting((value) => !value)}
                  >
                    Exit tool
                  </button>
                )}
                <span>
                  {mode === 'map'
                    ? connecting
                      ? 'Click a source room, then a target room · Esc cancels'
                      : `${doc.locations.length} locations · ${doc.locations.reduce((n, l) => n + l.exits.length, 0)} routes`
                    : mode === 'hints'
                      ? 'Author progressive clues and optional solutions'
                      : mode === 'triggers'
                        ? 'Command, state, and value triggers'
                        : actionOwner
                          ? 'Choose an action or exit, then build its logic'
                          : 'Select an object, location, or character'}
                </span>
              </div>
              <div className="canvas">
                {mode === 'map' ? (
                  <WorldMap
                    project={doc}
                    view={mapView.current}
                    onViewChange={(viewport) => {
                      mapView.current = viewport;
                    }}
                    selected={selected}
                    select={(key) => {
                      setSelected(key);
                      setFlowBreadcrumb(flow(doc, key) ? key : '');
                      const parent = flowOwner(doc, key);
                      if (parent) setFlowSelections((old) => ({ ...old, [parent.id]: key }));
                    }}
                    edit={edit}
                    connecting={connecting}
                  />
                ) : mode === 'triggers' ? (
                  <Triggers
                    project={doc}
                    history={historyControls}
                    active={activeTrigger}
                    ownerFilter={triggerFilter}
                    filterOwner={(id) => {
                      setTriggerFilter(id);
                      setSelected(gameDataPages.triggers);
                    }}
                    edit={edit}
                    select={select}
                    error={error}
                    blocksRef={blocks}
                    blockViews={blockViews}
                    onBlockSelect={selectBlock}
                    selectedBlock={activeTrigger && blockSelections[activeTrigger.id]?.blockId}
                  />
                ) : mode === 'hints' && hintOwner ? (
                  <Hints
                    key={hintOwner.id}
                    project={doc}
                    history={historyControls}
                    views={hintViews}
                    blockViews={blockViews}
                    ownerId={hintOwner.id}
                    selection={hintSelection}
                    select={(selection) => {
                      setHintSelection(selection);
                    }}
                    edit={edit}
                    error={error}
                  />
                ) : mode === 'actions' && actionOwner ? (
                  <Actions
                    key={actionOwner.id}
                    project={doc}
                    history={historyControls}
                    ownerId={actionOwner.id}
                    active={actionFlow ?? undefined}
                    edit={edit}
                    select={select}
                    error={error}
                    blocksRef={blocks}
                    blockViews={blockViews}
                    onBlockSelect={selectBlock}
                    selectedBlock={actionFlow && blockSelections[actionFlow.id]?.blockId}
                  />
                ) : (
                  <div className="canvas-empty">
                    Select an entity, then add or select a command action or trigger in the
                    inspector.
                  </div>
                )}
              </div>
            </section>
            <section
              className={`playtest ${playtestCollapsed ? 'is-collapsed' : ''}`}
              aria-label="Playtest"
            >
              <div className="playtest-toolbar">
                <h2>Playtest</h2>
                <span className="session-status">
                  {play
                    ? `● ${play.state.ending ? 'Ended' : playSource !== playVersion ? 'Restart to apply edits' : 'Running'}`
                    : 'Ready to start'}
                </span>
                <div className="playtest-controls" hidden={playtestCollapsed}>
                  <button
                    disabled={busy || countErrors > 0}
                    onClick={() => {
                      void start();
                    }}
                  >
                    {play ? 'Restart' : 'Start playtest'}
                  </button>
                  <select
                    aria-label="Start at location"
                    value=""
                    onChange={(e) => {
                      if (e.target.value) void start(e.target.value);
                    }}
                  >
                    <option value="">Start at…</option>
                    {doc.locations.map((l) => (
                      <option key={l.id} value={l.id}>
                        {l.name}
                      </option>
                    ))}
                  </select>
                  <Check label="Plain text" value={plain} onChange={setPlain} />
                  <select
                    aria-label="Playtest help"
                    value={playHelpMode}
                    onChange={(e) => setPlayHelpMode(e.target.value as HelpMode | '')}
                  >
                    <option value="">Help: game setting</option>
                    <option value="off">Help: off</option>
                    <option value="basic">Help: basic</option>
                    <option value="full">Help: full</option>
                  </select>
                </div>
                <button
                  className="panel-toggle"
                  aria-label={playtestCollapsed ? 'Expand playtest' : 'Collapse playtest'}
                  aria-expanded={!playtestCollapsed}
                  aria-controls="playtest-content"
                  title={playtestCollapsed ? 'Expand playtest' : 'Collapse playtest'}
                  onClick={() => setPlaytestCollapsed((collapsed) => !collapsed)}
                >
                  <span aria-hidden="true">{playtestCollapsed ? '▴' : '▾'}</span>
                </button>
              </div>
              <div id="playtest-content" className="playtest-content" hidden={playtestCollapsed}>
                <div
                  className="transcript"
                  ref={transcript}
                  role="log"
                  aria-label="Game transcript"
                >
                  {logs.length ? (
                    logs.map((log, i) =>
                      log.command ? (
                        <p className="command-line" key={i}>
                          &gt; {log.command}
                        </p>
                      ) : (
                        <p key={i}>
                          {log.spans?.map((s, j) => (
                            <span
                              key={j}
                              style={{
                                color: !plain && s.colour ? `var(--colour-${s.colour})` : undefined,
                              }}
                            >
                              {s.text}
                            </span>
                          ))}
                        </p>
                      ),
                    )
                  ) : (
                    <p className="muted">
                      Your story will appear here. Start a playtest to explore it.
                    </p>
                  )}
                </div>
                <form
                  className="command-input"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void send();
                  }}
                >
                  <span>&gt;</span>
                  <input
                    aria-label="Player command"
                    placeholder="Type a command, e.g. examine painting"
                    value={input}
                    disabled={!play || busy}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'ArrowUp') {
                        e.preventDefault();
                        const n = Math.max(0, historyAt - 1);
                        setHistoryAt(n);
                        setInput(history[n] ?? '');
                      }
                      if (e.key === 'ArrowDown') {
                        e.preventDefault();
                        const n = Math.min(history.length, historyAt + 1);
                        setHistoryAt(n);
                        setInput(history[n] ?? '');
                      }
                    }}
                  />
                  <button disabled={!play || busy}>Run ↵</button>
                </form>
                <div className="debug-toolbar">
                  <details>
                    <summary>Parser trace</summary>
                    <pre>{play?.result.trace.join('\n') || 'No command matches yet.'}</pre>
                  </details>
                  <details>
                    <summary>Command history</summary>
                    {history.map((h, i) => (
                      <button key={i} onClick={() => setInput(h)}>
                        {h}
                      </button>
                    ))}
                  </details>
                  <button disabled={!play} onClick={() => setShowState(true)}>
                    World state inspector
                  </button>
                </div>
              </div>
            </section>
          </div>
          <aside
            className={`inspector-panel ${inspectorCollapsed ? 'is-collapsed' : ''}`}
            aria-label="Inspector"
          >
            <div className="inspector-toolbar">
              {!inspectorCollapsed &&
                (mode === 'hints' && hintOwner ? (
                  <button
                    className="inspector-back"
                    onClick={() => {
                      setSelected(hintOwner.id);
                      setMode('map');
                    }}
                  >
                    ← Back to {hintOwner.name}
                  </button>
                ) : inspectedFlow && inspectedOwner ? (
                  <button
                    className="inspector-back"
                    onClick={() => select(inspectedOwner.id)}
                    title={`Back to ${'title' in inspectedOwner ? inspectedOwner.title : inspectedOwner.name} properties`}
                  >
                    ← Back to{' '}
                    {'title' in inspectedOwner ? inspectedOwner.title : inspectedOwner.name}
                  </button>
                ) : (
                  <span>Properties</span>
                ))}
              <button
                className="panel-toggle"
                aria-label={inspectorCollapsed ? 'Expand inspector' : 'Collapse inspector'}
                aria-expanded={!inspectorCollapsed}
                aria-controls="inspector-content"
                title={inspectorCollapsed ? 'Expand inspector' : 'Collapse inspector'}
                onClick={() => setInspectorCollapsed((collapsed) => !collapsed)}
              >
                <span aria-hidden="true">{inspectorCollapsed ? '‹' : '›'}</span>
                {inspectorCollapsed && <span>Inspector</span>}
              </button>
            </div>
            <div
              id="inspector-content"
              ref={inspectorContent}
              onBlurCapture={(event) => {
                const input = event.target;
                if (
                  input instanceof HTMLInputElement ||
                  input instanceof HTMLTextAreaElement ||
                  input instanceof HTMLSelectElement
                ) {
                  const label = input.labels?.[0]?.textContent?.trim();
                  if (label)
                    inspectorFocus.current[navigationKey] = {
                      label,
                      start: input instanceof HTMLSelectElement ? null : input.selectionStart,
                      end: input instanceof HTMLSelectElement ? null : input.selectionEnd,
                    };
                }
              }}
              onScroll={(event) => {
                inspectorPositions.current[navigationKey] = event.currentTarget.scrollTop;
              }}
              className="inspector"
              hidden={inspectorCollapsed}
            >
              <FindingSubject.Provider
                value={
                  mode === 'triggers' && activeTrigger
                    ? activeTrigger.id
                    : mode === 'hints' && hintSelection
                      ? 'stageId' in hintSelection.part
                        ? hintSelection.part.stageId
                        : hintSelection.puzzleId
                      : selected
                }
              >
                {!inspectedBlock && (
                  <InlineFindings
                    subject={
                      mode === 'triggers' && activeTrigger
                        ? activeTrigger.id
                        : mode === 'hints' && hintSelection
                          ? 'stageId' in hintSelection.part
                            ? hintSelection.part.stageId
                            : hintSelection.puzzleId
                          : selected
                    }
                  />
                )}
                {mode === 'hints' && hintOwner ? (
                  <HintInspector
                    project={doc}
                    ownerId={hintOwner.id}
                    selection={hintSelection}
                    select={(selection) => setHintSelection(selection)}
                    edit={edit}
                  />
                ) : mode === 'triggers' && !activeTrigger ? (
                  <>
                    <h2>Triggers</h2>
                    <p className="muted">Add a trigger to build its conditions and effects.</p>
                  </>
                ) : inspectedBlock ? (
                  <BlockInspector
                    project={doc}
                    selection={inspectedBlock}
                    change={(selection, value) =>
                      blocks.current?.updateBlock(
                        selection,
                        value,
                        current.current.doc ?? undefined,
                      )
                    }
                    settings={() => {
                      blocks.current?.selectBlock(null);
                      setBlockSelections((old) => {
                        const next = { ...old };
                        delete next[inspectedBlock.flowId];
                        return next;
                      });
                    }}
                  />
                ) : (
                  <Inspector
                    project={doc}
                    selected={mode === 'triggers' && activeTrigger ? activeTrigger.id : selected}
                    edit={edit}
                    select={select}
                    remove={remove}
                    error={error}
                  />
                )}
              </FindingSubject.Provider>
            </div>
          </aside>
        </main>
      )}
      {templateContext && doc && (
        <Templates
          project={doc}
          context={templateContext}
          initialTemplate={templateSelection}
          edit={edit}
          select={select}
          append={(effects) => {
            if (!blocks.current)
              throw new Error('Open an action or trigger before inserting blocks.');
            blocks.current.appendEffects(effects);
          }}
          close={() => setTemplateContext(null)}
        />
      )}
      {showDiagnostics && doc && (
        <FindingsList
          project={doc}
          findings={diagnostics}
          filter={findingFilter}
          setFilter={setFindingFilter}
          pending={validation.version !== editingVersion}
          close={() => setShowDiagnostics(false)}
          reveal={reveal}
        />
      )}
      {projectModal && (
        <div className="modal-backdrop">
          <section className="modal" role="dialog" aria-modal="true" aria-label="New project">
            <div className="section-heading">
              <h2>Create a project</h2>
              <button onClick={() => setProjectModal(false)}>×</button>
            </div>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void create();
              }}
            >
              <Text label="Project title" value={newTitle} onChange={setNewTitle} />
              <Text label="Folder name" value={newFolder} onChange={setNewFolder} />
              <Check
                label="Start with The Locked Study example"
                value={example}
                onChange={setExample}
              />
              <p className="muted">
                {config?.projects_root}/{newFolder}
              </p>
              <button className="primary">Create project</button>
            </form>
          </section>
        </div>
      )}
      {showState && play && playProject && (
        <div className="modal-backdrop">
          <section className="modal wide" role="dialog" aria-modal="true" aria-label="World state">
            <div className="section-heading">
              <h2>World state</h2>
              <button onClick={() => setShowState(false)}>Close</button>
            </div>
            <StateInspector
              state={play.state}
              project={playProject}
              onApply={(state) => {
                return request<PlaytestView>(`/playtests/${play.session}/state`, 'PUT', {
                  state,
                }).then((v) => {
                  setPlay(v);
                  setShowState(false);
                  setLogs((old) => [
                    ...old,
                    { spans: [{ text: 'Test state applied.', colour: null }] },
                  ]);
                });
              }}
            />
          </section>
        </div>
      )}
      {comparison && doc && (
        <div className="modal-backdrop">
          <section
            className="modal compare"
            role="dialog"
            aria-modal="true"
            aria-label="Compare external changes"
          >
            <div className="section-heading">
              <h2>Compare project changes</h2>
              <button onClick={() => setComparison(null)}>Close</button>
            </div>
            <div className="comparison">
              <div>
                <h3>In-memory draft</h3>
                <pre>{JSON.stringify(doc, null, 2)}</pre>
              </div>
              <div>
                <h3>Current files on disk</h3>
                <pre>{JSON.stringify(comparison.project, null, 2)}</pre>
              </div>
            </div>
            <button
              className="danger"
              onClick={() => {
                if (window.confirm('Replace the disk content with your in-memory draft?')) {
                  const v = { ...view!, revision: comparison.revision };
                  current.current.view = v;
                  current.current.conflict = false;
                  setView(v);
                  setConflict(false);
                  setComparison(null);
                  saved.current = '';
                  void save().catch(error);
                }
              }}
            >
              Save draft over this disk revision
            </button>
          </section>
        </div>
      )}
    </div>
  );
  return (
    <ReferenceActions.Provider
      value={(reference) => {
        if (doc && reference.action === 'delete' && !usedBy(doc, reference.target).length) {
          edit(
            (p) => {
              const result = referencePlan(p, reference.target);
              if (result.errors.length) throw new Error(result.errors.join(' '));
              Object.assign(p, result.project);
            },
            { label: 'Delete unused content' },
          );
        } else setReferenceRequest(reference);
      }}
    >
      <FindingContext.Provider value={{ findings: diagnostics, reveal: revealTarget }}>
        <ReferenceCreation
          project={doc}
          edit={edit}
          reserved={config?.reserved ?? []}
          transact={(label, change) => {
            const previous = creationTransaction.current;
            const before = current.current.doc;
            const context = { group: crypto.randomUUID(), label };
            creationTransaction.current = context;
            try {
              change();
              const after = current.current.doc;
              current.current.doc = before;
              creationTransaction.current = previous;
              if (after && after !== before)
                edit((project) => Object.assign(project, after), context);
            } catch (error) {
              current.current.doc = before;
              throw error;
            } finally {
              creationTransaction.current = previous;
            }
          }}
        >
          {editor}
          {doc && referenceRequest && (
            <ReferenceManager
              key={JSON.stringify(referenceRequest)}
              project={doc}
              request={referenceRequest}
              close={() => setReferenceRequest(null)}
              edit={edit}
              reveal={reveal}
              removed={(target) => {
                if (
                  'id' in target &&
                  (selected === target.id || flowOwner(doc, selected)?.id === target.id)
                )
                  select(flowOwner(doc, target.id)?.id ?? doc.game.id);
              }}
            />
          )}
        </ReferenceCreation>
      </FindingContext.Provider>
    </ReferenceActions.Provider>
  );
}
