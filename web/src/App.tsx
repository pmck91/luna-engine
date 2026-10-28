import Routines, { RoutineCreation, RoutineInspector, routineBlockId } from './Routines';
import RoutineProgress from './RoutineProgress';
import PlayerUndo from './PlayerUndo';
import { routine, routineFor, routinePage } from './routineModel';
import ScheduledTimers, { TimerCreation, TimerInspector } from './ScheduledTimers';
import PendingTimers from './PendingTimers';
import { timer } from './turnModel';
import Narrative, { NarrativeInspector } from './Narrative';
import NarrativePlayer, { NarrativeJournal, NarrativeProgressInspector } from './NarrativePlayer';
import { narrativeItem, narrativeRemovalDestination } from './narrativeAuthoring';
import Procedures, { ProcedureInspector } from './Procedures';
import { ProcedureScope } from './ProcedureScope';
import { procedure } from './procedureModel';
import { setCallDefinition } from './procedureEditing';
import {
  Fragment,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
} from 'react';
import type {
  ConfigView,
  CheckStart,
  Diagnostic,
  DiskView,
  HelpMode,
  PlaytestView,
  PlaytestSetup,
  Project,
  ProjectListItem,
  ProjectView,
} from './contracts';
import { ApiError, bundle, request } from './api';
import logoUrl from '../../assets/logo-transparent.png';
import {
  character,
  action as makeAction,
  flow,
  script,
  flowOwner,
  gameDataPages,
  owner,
  location as makeLocation,
  object as makeObject,
} from './model';
import { lockedStudy } from './example';
import { Check, StateInspector, Text } from './Forms';
import Inspector from './Inspector';
import WorldMap from './WorldMap';
import type { BlockSelection, BlockView, BlocksHandle } from './Blocks';
import BlockInspector from './BlockInspector';
import { useNavigation } from './navigation';
import { authoringRoom } from './authoring';
import ReferenceCreation from './ReferenceCreation';
import ReferenceManager, { ReferenceActions, type ReferenceRequest } from './ReferenceManager';
import { referencePlan, usedBy, type ReferenceSite, type ReferenceTarget } from './references';
import {
  connectedFindings,
  findingSite,
  prepareDraftValidation,
  type Finding,
} from './diagnostics';
import { FindingContext, FindingsList, FindingSubject, InlineFindings } from './FindingContext';
import { activeFindings, validationKey } from './warnings';
import { ProjectHistory, type EditContext } from './projectHistory';
import Actions from './Actions';
import Contents from './Contents';
import ContainerSetup from './ContainerSetup';
import { ancestry, objectHierarchy, parentId } from './containerModel';
import Hints from './Hints';
import Triggers from './Triggers';
import { projectTriggers, triggerPage } from './triggerModel';
import HintInspector from './HintInspector';
import type { HintSelection } from './HintBlocks';
import Templates, { type TemplateContext } from './Templates';
import { defaultLayout, restoredNavigation, usePreferenceWriter } from './preferences';
import ResizeHandle from './ResizeHandle';
import ProjectSearch from './ProjectSearch';
import Modal from './Modal';
import ExitCreation from './ExitCreation';
import Tutorial from './Tutorial';
import AuthoringHelp from './AuthoringHelp';
import PlaytestTools from './PlaytestTools';
import {
  historyCanReplay,
  playContentKey,
  resultLogs,
  runLogs,
  stateKey,
  type PlaytestLog,
} from './playtest';
import CommandExplanation from './CommandExplanation';
import {
  ExplanationFocus,
  explanationIsCurrent,
  traceTitle,
  type ExplanationRecord,
} from './explanations';
export default function App() {
  const [config, setConfig] = useState<ConfigView | null>(null);
  const [root, setRoot] = useState('');
  const [projects, setProjects] = useState<ProjectListItem[]>([]);
  const [view, setView] = useState<ProjectView | null>(null);
  const [doc, setDoc] = useState<Project | null>(null);
  const [selected, setSelected] = useState('');
  const [search, setSearch] = useState('');
  const [layout, setLayout] = useState(defaultLayout);
  const [projectSearch, setProjectSearch] = useState('');
  const [fieldSelection, setFieldSelection] = useState<ReferenceSite | null>(null);
  const [showSearch, setShowSearch] = useState(false);
  const [tutorialVisible, setTutorialVisible] = useState(false);
  const [tutorialSteps, setTutorialSteps] = useState<string[]>([]);
  const [showExitCreation, setShowExitCreation] = useState(false);
  const [helpTopic, setHelpTopic] = useState<string | null>(null);
  const [newTutorial, setNewTutorial] = useState(false);
  const [playtestFocused, setPlaytestFocused] = useState(false);
  const flushPreferences = useRef<(() => void) | null>(null);
  const [mode, setMode] = useState<
    | 'map'
    | 'actions'
    | 'hints'
    | 'triggers'
    | 'contents'
    | 'procedures'
    | 'conversations'
    | 'quests'
    | 'routines'
  >('map');
  const [containerSetup, setContainerSetup] = useState<string | null>(null);
  const [procedureReturns, setProcedureReturns] = useState<
    Array<{
      definition: string;
      scriptId: string;
      blockId: string;
      name: string;
      selection: BlockSelection;
    }>
  >([]);
  const [routineCreation, setRoutineCreation] = useState<BlockSelection | null>(null);
  const [timerCreation, setTimerCreation] = useState<BlockSelection | null>(null);
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
  const playerCommand = useRef<HTMLInputElement>(null);
  const [play, setPlay] = useState<PlaytestView | null>(null);
  const [logs, setLogs] = useState<PlaytestLog[]>([]);
  const [playStart, setPlayStart] = useState<CheckStart>({ type: 'fresh', location: null });
  const [playInitialState, setPlayInitialState] = useState<string | null>(null);
  const [recordExplanations, setRecordExplanations] = useState(true);
  const [explanationRecord, setExplanationRecord] = useState<ExplanationRecord | null>(null);
  const [showExplanation, setShowExplanation] = useState(false);
  const [explanationFocus, setExplanationFocus] = useState<{
    record: ExplanationRecord;
    index: number;
  } | null>(null);
  const [playRecordingHelp, setPlayRecordingHelp] = useState<HelpMode | ''>('');
  const [playtestTools, setPlaytestTools] = useState<{ setupId?: string; checkId?: string } | null>(
    null,
  );
  const [input, setInput] = useState('');
  const [plain, setPlain] = useState(false);
  const [showJournal, setShowJournal] = useState(false);
  const [showState, setShowState] = useState(false);
  const [busy, setBusy] = useState(false);
  const commandFocus = useRef<{ submitted: Element | null; session: string } | null>(null);
  const [commandCompletion, setCommandCompletion] = useState(0);
  const [history, setHistory] = useState<string[]>([]);
  const [historyAt, setHistoryAt] = useState(0);
  const [playSource, setPlaySource] = useState('');
  const [playHelpMode, setPlayHelpMode] = useState<HelpMode | ''>('');
  const [playProject, setPlayProject] = useState<Project | null>(null);
  const current = useRef({ doc, view, conflict, selected, procedureReturns });
  current.current = { doc, view, conflict, selected, procedureReturns };
  const saved = useRef('');
  const projectHistory = useRef(new ProjectHistory());
  const [, refreshHistory] = useState(0);
  const fieldSession = useRef(0);
  const creationTransaction = useRef<{ group: string; label: string } | null>(null);
  useEffect(() => {
    if (busy || !commandFocus.current) return;
    const { submitted, session } = commandFocus.current;
    commandFocus.current = null;
    if (play?.session !== session) return;
    // Run after React has enabled the input. An animation frame can precede
    // that commit, and focusing a disabled input then has no effect in Firefox.
    const active = document.activeElement;
    if (!active || active === document.body || active === submitted) playerCommand.current?.focus();
  }, [busy, commandCompletion, play?.session]);
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
  const validationVersion = doc ? validationKey(doc) : '';
  const playVersion = doc ? playContentKey(doc, playHelpMode) : '';
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
    flushPreferences.current?.();
    const preferences = v.preferences;
    const navigation = restoredNavigation(v.project, preferences?.navigation);
    projectHistory.current.reset();
    refreshHistory((n) => n + 1);
    blockViews.current = Object.fromEntries(
      Object.entries(preferences?.block_views ?? {}).filter(
        (entry): entry is [string, BlockView] => !!entry[1],
      ),
    );
    hintViews.current = Object.fromEntries(
      Object.entries(preferences?.hint_views ?? {}).filter(
        (entry): entry is [string, 'blocks' | 'forms'] =>
          typeof entry[1] === 'string' && ['blocks', 'forms'].includes(entry[1]),
      ),
    );
    mapView.current = preferences?.map_view
      ? { ...preferences.map_view, zoom: preferences.map_view.scale }
      : undefined;
    inspectorPositions.current = Object.fromEntries(
      Object.entries(preferences?.inspector_scroll ?? {}).filter(
        (entry): entry is [string, number] => typeof entry[1] === 'number',
      ),
    );
    inspectorFocus.current = {};
    inspectorSections.current = Object.fromEntries(
      Object.entries(preferences?.expanded_sections ?? {}).filter(
        (entry): entry is [string, string[]] => !!entry[1],
      ),
    );
    setLayout(preferences?.layout ?? defaultLayout);
    setInspectorCollapsed(preferences?.layout.inspector_collapsed ?? false);
    setPlaytestCollapsed(preferences?.layout.playtest_collapsed ?? false);
    setProjectSearch(preferences?.project_search ?? '');
    setTutorialVisible(preferences?.tutorial_visible ?? false);
    setTutorialSteps(preferences?.tutorial_steps ?? []);
    setShowSearch(false);
    setPlaytestFocused(false);
    saved.current = JSON.stringify(v.project);
    setView(v);
    setDoc(v.project);
    setSelected(navigation.selected);
    setSearch(navigation.search);
    setConflict(false);
    setComparison(null);
    setMessage('');
    setStatus('Saved');
    setProcedureReturns([]);
    setPlay(null);
    setExplanationRecord(null);
    setExplanationFocus(null);
    setShowExplanation(false);
    setPlaytestTools(null);
    setPlayStart({ type: 'fresh', location: null });
    setPlayInitialState(null);
    setPlayProject(null);
    setLogs([]);
    setMode(navigation.mode);
    setFlowSelections(navigation.flowSelections);
    setFlowBreadcrumb(navigation.flowBreadcrumb);
    setTriggerFilter(navigation.triggerFilter);
    setHintSelection(navigation.hintSelection);
    setBlockSelections(
      Object.fromEntries(
        Object.entries(navigation.selectedBlocks).map(([flowId, blockId]) => [
          flowId,
          {
            flowId,
            blockId,
            kind: 'root',
            label: 'Flow',
            connected: true,
            address: '',
            value: null,
            fields: [],
          },
        ]),
      ),
    );
    setTemplateContext(null);
    setReferenceRequest(null);
    setRevealTarget(navigation.fieldSelection);
    setFieldSelection(navigation.fieldSelection);
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
      !procedure(next, key) &&
      !timer(next, key) &&
      !routineFor(next, key) &&
      !key.startsWith(`${routinePage}:`) &&
      !narrativeItem(next, key) &&
      !key.startsWith(`${gameDataPages.conversations}:`) &&
      !Object.values(gameDataPages).some((page) => page === key)
    ) {
      const caller = current.current.procedureReturns
        .slice()
        .reverse()
        .find((frame) => frame.definition === key && script(next, frame.scriptId));
      if (caller) {
        setSelected(caller.scriptId);
        setFlowBreadcrumb(caller.scriptId);
        const target = flow(next, caller.scriptId);
        setMode(
          narrativeItem(next, caller.scriptId)
            ? 'conversation' in narrativeItem(next, caller.scriptId)!
              ? 'conversations'
              : 'quests'
            : routineFor(next, caller.scriptId)
              ? 'routines'
              : procedure(next, caller.scriptId)
                ? 'procedures'
                : timer(next, caller.scriptId) || (target && 'event' in target)
                  ? 'triggers'
                  : 'actions',
        );
        if (target && 'event' in target) setTriggerFilter(flowOwner(next, target.id)?.id ?? '');
        setBlockSelections((old) => ({ ...old, [caller.scriptId]: caller.selection }));
        setProcedureReturns((old) => old.filter((frame) => frame.definition !== key));
      } else if (previous && narrativeItem(previous, key)) {
        const item = narrativeItem(previous, key)!;
        const parent = narrativeRemovalDestination(previous, key, key)!;
        const destination = narrativeItem(next, parent)
          ? parent
          : 'conversation' in item
            ? gameDataPages.conversations
            : gameDataPages.quests;
        setSelected(destination);
        setMode('conversation' in item ? 'conversations' : 'quests');
      } else if (previous && routineFor(previous, key)) {
        setSelected(routinePage);
        setMode('routines');
      } else if (previous && timer(previous, key)) {
        setSelected(gameDataPages.scheduled);
        setMode('triggers');
      } else if (previous && procedure(previous, key)) {
        setSelected(gameDataPages.procedures);
        setMode('procedures');
      } else {
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
    setFieldSelection(null);
    setPlaytestFocused(false);
    const project = current.current.doc;
    setFlowBreadcrumb('');
    const narrative = project && narrativeItem(project, key);
    if (
      narrative ||
      key === gameDataPages.conversations ||
      key === gameDataPages.quests ||
      key.startsWith(`${gameDataPages.conversations}:`)
    ) {
      setSelected(key);
      setMode(
        narrative
          ? 'conversation' in narrative
            ? 'conversations'
            : 'quests'
          : key === gameDataPages.quests
            ? 'quests'
            : 'conversations',
      );
      setConnecting(false);
      setInspectorCollapsed(false);
      return;
    }
    if (
      key === routinePage ||
      key.startsWith(`${routinePage}:`) ||
      (project && routineFor(project, key))
    ) {
      const r = project && routineFor(project, key);
      setSelected(r?.id ?? key);
      setMode('routines');
      setConnecting(false);
      setInspectorCollapsed(false);
      setFlowBreadcrumb(r?.id ?? '');
      return;
    }
    if (key === gameDataPages.scheduled || (project && timer(project, key))) {
      setSelected(key);
      setMode('triggers');
      setTriggerFilter('');
      setConnecting(false);
      setInspectorCollapsed(false);
      setFlowBreadcrumb(key === gameDataPages.scheduled ? '' : key);
      return;
    }
    if (key === gameDataPages.procedures || (project && procedure(project, key))) {
      setSelected(key);
      setMode('procedures');
      setConnecting(false);
      setInspectorCollapsed(false);
      setFlowBreadcrumb(key === gameDataPages.procedures ? '' : key);
      return;
    }
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
    } else if (
      mode === 'triggers' ||
      mode === 'procedures' ||
      mode === 'conversations' ||
      mode === 'quests' ||
      mode === 'routines' ||
      (mode === 'contents' &&
        !project?.objects.find((o) => o.id === key && (o.storage?.container || o.storage?.surface)))
    ) {
      setMode('map');
    }
  };
  useEffect(() => {
    if (Object.values(gameDataPages).some((page) => page === selected))
      inspectorContent.current?.scrollTo({ top: 0 });
  }, [selected]);
  const save = useCallback((): Promise<void> => {
    flushPreferences.current?.();
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
          if (
            active &&
            current.current.doc &&
            validationKey(current.current.doc) === validationVersion
          )
            setValidation({
              version: validationVersion,
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
  }, [validationVersion, error]);
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
    transcript.current?.scrollTo({
      top: transcript.current.scrollHeight,
      behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches
        ? 'instant'
        : 'smooth',
    });
  }, [logs]);
  const start = async (at?: string, setup?: PlaytestSetup) => {
    if (!doc) return;
    setBusy(true);
    try {
      const result = await request<PlaytestView>('/playtests', 'POST', {
        project: doc,
        location: at ?? null,
        help_mode: playHelpMode || null,
        setup: setup ?? null,
      });
      if (current.current.view?.handle !== view?.handle) return;
      setPlay(result);
      setExplanationRecord(null);
      setExplanationFocus(null);
      setShowExplanation(false);
      setPlayRecordingHelp(playHelpMode);
      setPlayProject(structuredClone(doc));
      setPlaySource(playVersion);
      setLogs(result.result.messages.map((spans) => ({ spans })));
      setShowState(false);
      setHistory([]);
      setHistoryAt(0);
      setPlayStart(
        setup ? { type: 'setup', setup: setup.id } : { type: 'fresh', location: at ?? null },
      );
      setPlayInitialState(stateKey(result.state));
      setInput('');
      return result;
    } catch (e) {
      error(e);
    } finally {
      setBusy(false);
    }
  };
  const send = async (
    submitted?: string,
    reply?: { offer_token: string; reply_id: string },
    nativeUndo = false,
  ) => {
    const command = (submitted ?? input).trim();
    if (!play || !command || busy) return;
    const submittedFocus = document.activeElement;
    setInput('');
    const next = [...history, command];
    setHistory(next);
    setHistoryAt(next.length);
    setLogs((old) => [...old, { command }]);
    setBusy(true);
    setExplanationRecord(null);
    setExplanationFocus(null);
    try {
      const result = await request<PlaytestView>(
        `/playtests/${play.session}/${nativeUndo ? 'undo' : reply ? 'replies' : 'commands'}`,
        'POST',
        {
          ...(nativeUndo ? {} : (reply ?? { command })),
          explain: recordExplanations,
        },
      );
      if (current.current.view?.handle !== view?.handle) return;
      setPlay(result.result.control?.type === 'quit' ? null : result);
      setLogs((old) => [...old, ...resultLogs(result.result)]);
      if (result.result.explanation && playProject) {
        const explanation = result.result.explanation;
        setExplanationRecord({
          explanation,
          source: result.source,
          project: playProject,
          contentKey: playSource,
          help: playRecordingHelp,
          status: result.result.status,
          input_resolution: result.result.input_resolution,
          selected_flow: result.result.selected_flow,
        });
        if (explanation.error)
          setLogs((old) => [
            ...old,
            { spans: [{ text: `Command rolled back: ${explanation.error}`, colour: 'red' }] },
          ]);
      }
    } catch (e) {
      error(e);
    } finally {
      commandFocus.current = { submitted: submittedFocus, session: play.session };
      setCommandCompletion((n) => n + 1);
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
      if (newTutorial) setTutorialVisible(true);
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
    const narrative = narrativeItem(doc, key);
    const target: ReferenceTarget = narrative
      ? { kind: narrative.kind, id: key }
      : routine(doc, key)
        ? { kind: 'routine', id: key }
        : timer(doc, key)
          ? { kind: 'timer', id: key }
          : procedure(doc, key)
            ? { kind: 'procedure', id: key }
            : flow(doc, key)
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
    if (narrative)
      select(
        'conversation' in narrative
          ? narrative.kind === 'conversation'
            ? gameDataPages.conversations
            : narrative.conversation.id
          : narrative.kind === 'quest'
            ? gameDataPages.quests
            : narrative.quest.id,
      );
    else if (target.kind === 'routine') select(routinePage);
    else if (target.kind === 'timer') select(gameDataPages.scheduled);
    else if (target.kind === 'procedure') select(gameDataPages.procedures);
    else setSelected(parent?.id ?? doc?.game.id ?? '');
  };
  const reveal = (site: ReferenceSite) => {
    if (!doc) return;
    const r = routineFor(doc, site.flowId ?? site.subject);
    if (r && site.flowId !== r.id) {
      const at = r.steps.findIndex((s) => s.id === (site.flowId ?? site.subject));
      site = {
        ...site,
        flowId: r.id,
        routineId: r.id,
        path: at < 0 ? site.path : `steps.${at}${site.path ? '.' + site.path : ''}`,
      };
    }
    if (site.procedureId) site = { ...site, flowId: site.procedureId };
    if (site.setupId || site.checkId) {
      setShowDiagnostics(false);
      setPlaytestTools({ setupId: site.setupId, checkId: site.checkId });
      return;
    }
    navigation.beginTransition();
    setShowDiagnostics(false);
    setInspectorCollapsed(false);
    setPlaytestFocused(false);
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
    if (!site.flowId && !site.puzzleId && !site.templateId)
      setFieldSelection({
        subject: site.subject,
        path: site.path,
        scope: site.scope,
        ownerId: site.ownerId,
      });
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
  const activeNarrative = doc ? narrativeItem(doc, selected) : undefined;
  const activeNarrativeScript = doc && activeNarrative ? script(doc, selected) : undefined;
  const activeProcedure = doc ? procedure(doc, selected) : undefined;
  const activeRoutine = doc ? routineFor(doc, selected) : undefined;
  const activeRoutineScript = doc && activeRoutine ? script(doc, activeRoutine.id) : undefined;
  const routineCharacter = selected.startsWith(`${routinePage}:`)
    ? selected.slice(routinePage.length + 1)
    : (activeRoutine?.character ?? '');
  const activeTimer = doc ? timer(doc, selected) : undefined;
  const scheduled = selected === gameDataPages.scheduled || !!activeTimer;
  const activeFlow = doc && flow(doc, selected);
  const creationRoom = doc ? authoringRoom(doc, selected) : '';
  const creationRoomName =
    doc?.locations.find((room) => room.id === creationRoom)?.name ?? 'a room';
  const actionOwner = doc && (owner(doc, selected) ?? flowOwner(doc, selected));
  const objectTree = doc ? objectHierarchy(doc) : [];
  const objectDepth = new Map(objectTree.map((entry) => [entry.object.id, entry.depth]));
  const storageOwner =
    actionOwner &&
    'placement' in actionOwner &&
    (actionOwner.storage?.container || actionOwner.storage?.surface)
      ? actionOwner
      : null;
  const ownerAncestors =
    doc && actionOwner && 'placement' in actionOwner ? ancestry(doc, actionOwner.id) : [];
  const hintOwner = actionOwner && 'hints' in actionOwner ? actionOwner : null;
  useEffect(() => {
    if (mode === 'contents' && !storageOwner) setMode('map');
  }, [mode, storageOwner?.id]);
  const actionFlow =
    (activeFlow && !('event' in activeFlow) ? activeFlow : undefined) ??
    (doc && actionOwner && flow(doc, flowSelections[actionOwner.id])) ??
    actionOwner?.actions[0] ??
    (actionOwner && 'exits' in actionOwner ? actionOwner.exits[0] : undefined);
  const activeTrigger = scheduled
    ? undefined
    : activeFlow && 'event' in activeFlow
      ? activeFlow
      : doc
        ? projectTriggers(doc).find((item) => !triggerFilter || item.ownerId === triggerFilter)
            ?.trigger
        : undefined;
  const inspectedFlow =
    mode === 'routines'
      ? activeRoutineScript
      : mode === 'conversations' || mode === 'quests'
        ? activeNarrativeScript
        : mode === 'procedures'
          ? activeProcedure
          : mode === 'triggers'
            ? scheduled
              ? activeTimer
              : activeTrigger
            : activeFlow;
  const inspectedOwner = doc && inspectedFlow ? flowOwner(doc, inspectedFlow.id) : actionOwner;
  const inspectedBlock =
    (mode === 'routines' ||
      mode === 'actions' ||
      mode === 'triggers' ||
      mode === 'procedures' ||
      mode === 'conversations' ||
      mode === 'quests') &&
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
  const openDefinition = (id: string, from = inspectedBlock) => {
    if (!from && inspectedFlow)
      from = {
        flowId: inspectedFlow.id,
        blockId: '',
        kind: 'root',
        label: 'Flow settings',
        connected: true,
        address: '',
        value: null,
        fields: [],
      };
    if (from)
      setProcedureReturns((old) => [
        ...old.slice(-30),
        {
          definition: id,
          scriptId: from.flowId,
          blockId: from.blockId,
          selection: structuredClone(from),
          name: (doc && script(doc, from.flowId)?.name) || 'caller',
        },
      ]);
    blocks.current?.selectBlock(null);
    setBlockSelections((old) => {
      const next = { ...old };
      delete next[id];
      return next;
    });
    select(id);
  };
  const returnToCaller = () => {
    const frame = procedureReturns.at(-1);
    if (!frame) return;
    setProcedureReturns((old) => old.slice(0, -1));
    select(frame.scriptId);
    setBlockSelections((old) => ({
      ...old,
      [frame.scriptId]: { ...frame.selection, flowId: frame.scriptId, blockId: frame.blockId },
    }));
  };
  const createDefinition = () => {
    if (
      inspectedBlock?.value &&
      [
        'start_routine',
        'pause_routine',
        'resume_routine',
        'stop_routine',
        'routine_status',
      ].includes(inspectedBlock.value.type)
    ) {
      setRoutineCreation(structuredClone(inspectedBlock));
      return;
    }
    if (
      inspectedBlock &&
      inspectedBlock.value &&
      ['schedule_timer', 'cancel_timer', 'timer_pending'].includes(inspectedBlock.value.type)
    ) {
      setTimerCreation(structuredClone(inspectedBlock));
      return;
    }
    if (!inspectedBlock || inspectedBlock.value?.type !== 'call') return;
    const call = inspectedBlock.value;
    const definition = {
      id: crypto.randomUUID(),
      name: 'New procedure',
      description: '',
      inputs: [],
      effects: [],
    };
    edit(
      (p) => {
        (p.procedures ??= []).push(definition);
        setCallDefinition(p, inspectedBlock.flowId, inspectedBlock.blockId, call.id, definition.id);
      },
      { label: 'Create procedure for call' },
    );
    openDefinition(definition.id);
  };
  const navigationKey = JSON.stringify([
    selected,
    mode,
    triggerFilter,
    hintSelection,
    flowBreadcrumb,
    inspectedBlock?.blockId,
    fieldSelection ? [fieldSelection.subject, fieldSelection.path] : null,
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
        (
          field?.querySelector<HTMLElement>('[aria-label$=" value"]') ??
          field?.querySelector<HTMLElement>('input, textarea, select')
        )?.focus({ preventScroll: true });
      }
    });
    return () => cancelAnimationFrame(frame);
  }, [revealTarget, selected, mode, inspectedBlock?.blockId]);
  const inspectorPositions = useRef<Record<string, number>>({});
  const inspectorSections = useRef<Record<string, string[]>>({});
  const inspectorFocus = useRef<
    Record<string, { label: string; start: number | null; end: number | null }>
  >({});
  useLayoutEffect(() => {
    const pane = inspectorContent.current;
    if (!pane) return;
    const scope = view?.handle;
    const rememberSections = () => {
      if (current.current.view?.handle !== scope) return;
      inspectorSections.current[navigationKey] = [...pane.querySelectorAll('details[open]')].map(
        (details) => details.querySelector('summary')?.textContent?.trim() ?? '',
      );
    };
    pane.addEventListener('toggle', rememberSections, true);
    const expanded = inspectorSections.current[navigationKey];
    if (expanded)
      for (const details of pane.querySelectorAll('details'))
        details.open = expanded.includes(
          details.querySelector('summary')?.textContent?.trim() ?? '',
        );
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
      pane.removeEventListener('toggle', rememberSections, true);
      if (current.current.view?.handle === scope)
        inspectorPositions.current[navigationKey] = pane.scrollTop;
    };
  }, [navigationKey, view?.handle]);
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
      fieldSelection,
      procedureReturns,
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
      setProcedureReturns(entry.procedureReturns);
      setFieldSelection(entry.fieldSelection);
      setRevealTarget(entry.fieldSelection);
      setConnecting(false);
    },
  );
  const historyControls = {
    undoLabel: projectHistory.current.undoLabel,
    redoLabel: projectHistory.current.redoLabel,
    replay: replayProject,
  };
  flushPreferences.current = usePreferenceWriter(
    view?.handle,
    () => ({
      layout: {
        ...layout,
        inspector_collapsed: inspectorCollapsed,
        playtest_collapsed: playtestCollapsed,
      },
      navigation: JSON.parse(
        JSON.stringify({
          selected,
          mode,
          search,
          triggerFilter,
          flowSelections,
          flowBreadcrumb,
          selectedBlocks: Object.fromEntries(
            Object.entries(blockSelections).map(([id, selection]) => [id, selection.blockId]),
          ),
          hintSelection,
          fieldSelection,
        }),
      ),
      block_views: blockViews.current,
      map_view: mapView.current
        ? { x: mapView.current.x, y: mapView.current.y, scale: mapView.current.zoom }
        : null,
      hint_views: hintViews.current,
      inspector_scroll: Object.fromEntries(Object.entries(inspectorPositions.current).slice(-100)),
      expanded_sections: Object.fromEntries(Object.entries(inspectorSections.current).slice(-100)),
      project_search: projectSearch,
      tutorial_visible: tutorialVisible,
      tutorial_steps: tutorialSteps,
    }),
    error,
  );
  useEffect(() => {
    const shortcut = (event: KeyboardEvent) => {
      if (
        !doc ||
        !(event.ctrlKey || event.metaKey) ||
        event.altKey ||
        event.key.toLowerCase() !== 'k'
      )
        return;
      if (
        event.target instanceof HTMLElement &&
        event.target.closest(
          'input,textarea,select,[contenteditable="true"],dialog[open],[role="dialog"]',
        )
      )
        return;
      event.preventDefault();
      setShowSearch(true);
    };
    document.addEventListener('keydown', shortcut);
    return () => document.removeEventListener('keydown', shortcut);
  }, [!!doc]);
  const rawDiagnostics = validation.version === validationVersion ? validation.findings : [];
  const diagnostics = doc ? activeFindings(doc, rawDiagnostics) : rawDiagnostics;
  const countErrors = diagnostics.filter(
    (d) => d.scope !== 'draft' && d.severity === 'error',
  ).length;
  const countWarnings = diagnostics.filter(
    (d) => d.scope !== 'draft' && d.severity === 'warning',
  ).length;
  const inspectorHidden = inspectorCollapsed || playtestFocused;
  const hierarchyHidden = layout.hierarchy_collapsed || playtestFocused;
  const traceTarget =
    doc && explanationFocus && explanationIsCurrent(explanationFocus.record, doc)
      ? (() => {
          const source = explanationFocus.record.explanation.steps[explanationFocus.index]?.source;
          return source
            ? findingSite(doc, {
                subject: source.subject,
                field: source.path,
                severity: 'warning',
                message: '',
              })
            : null;
        })()
      : null;
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
              <button onClick={() => setShowSearch(true)} title="Search project (Ctrl/Cmd K)">
                Search project
              </button>
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
            <div className="eyebrow">BUILD YOUR NEXT ADVENTURE</div>
            <h1>
              Build a world.
              <br />
              Let words open it.
            </h1>
            <p>
              Build a living world to explore. Write an interactive Story. Let your imagination go
              wild!
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
        <main
          className={`workspace ${inspectorHidden ? 'inspector-collapsed' : ''} ${hierarchyHidden ? 'hierarchy-collapsed' : ''} ${playtestFocused ? 'playtest-focused' : ''} ${playtestCollapsed ? 'playtest-collapsed' : ''}`}
          style={
            {
              '--hierarchy-size': `${layout.hierarchy_width}px`,
              '--inspector-size': `${layout.inspector_width}px`,
              '--playtest-size': `${layout.playtest_height}px`,
            } as CSSProperties
          }
        >
          <nav className="hierarchy" aria-label="Project hierarchy">
            <div className="hierarchy-heading">
              <h3>Project</h3>
              <button
                className="panel-toggle"
                aria-label={hierarchyHidden ? 'Expand hierarchy' : 'Collapse hierarchy'}
                aria-expanded={!hierarchyHidden}
                aria-controls="hierarchy-content"
                onClick={() => {
                  if (playtestFocused) {
                    setPlaytestFocused(false);
                    setLayout((layout) => ({ ...layout, hierarchy_collapsed: false }));
                  } else
                    setLayout((layout) => ({
                      ...layout,
                      hierarchy_collapsed: !layout.hierarchy_collapsed,
                    }));
                }}
              >
                {hierarchyHidden ? '›' : '‹'}
              </button>
            </div>
            <div id="hierarchy-content" hidden={hierarchyHidden}>
              <input
                aria-label="Filter entities"
                placeholder="Filter entities…"
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
                  items: objectTree.map((entry) => entry.object),
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
                        style={
                          'placement' in e
                            ? { paddingLeft: 16 + Math.min(objectDepth.get(e.id) ?? 0, 4) * 12 }
                            : undefined
                        }
                        className={`tree-item ${e.id === selected || (mode === 'actions' && actionOwner?.id === e.id) ? 'active' : ''}`}
                        onClick={() => select(e.id)}
                      >
                        <span>◇</span>
                        <span>
                          {e.name}
                          {'placement' in e && parentId(e.placement) && (
                            <small className="tree-placement">
                              {e.placement.type === 'inside' ? 'inside' : 'on'}{' '}
                              {doc.objects.find((o) => o.id === parentId(e.placement))?.name}
                            </small>
                          )}
                        </span>
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
                  { id: routinePage, name: 'Routines', icon: '↻' },
                  { id: gameDataPages.procedures, name: 'Procedures', icon: 'ƒ' },
                  { id: gameDataPages.conversations, name: 'Conversations', icon: '☏' },
                  { id: gameDataPages.quests, name: 'Quests', icon: '⚑' },
                  { id: gameDataPages.endings, name: 'Endings', icon: '⚑' },
                ].map((item) => (
                  <button
                    key={item.id}
                    className={`tree-item ${selected === item.id || (item.id === gameDataPages.triggers && mode === 'triggers') || (item.id === routinePage && mode === 'routines') || (item.id === gameDataPages.procedures && mode === 'procedures') || (item.id === gameDataPages.conversations && mode === 'conversations') || (item.id === gameDataPages.quests && mode === 'quests') ? 'active' : ''}`}
                    aria-current={
                      selected === item.id ||
                      (item.id === gameDataPages.triggers && mode === 'triggers') ||
                      (item.id === routinePage && mode === 'routines') ||
                      (item.id === gameDataPages.procedures && mode === 'procedures') ||
                      (item.id === gameDataPages.conversations && mode === 'conversations') ||
                      (item.id === gameDataPages.quests && mode === 'quests')
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
                <button className="tree-item" onClick={() => setHelpTopic('start')}>
                  Authoring guide
                </button>
                <button
                  className="tree-item"
                  onClick={() => setTutorialVisible((visible) => !visible)}
                >
                  {tutorialVisible
                    ? 'Hide first-adventure tutorial'
                    : 'Show first-adventure tutorial'}
                </button>
                <button className="tree-item" onClick={() => setHelpTopic('keyboard')}>
                  Keyboard shortcuts
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
            </div>
          </nav>
          {!hierarchyHidden && (
            <ResizeHandle
              label="Resize hierarchy"
              value={layout.hierarchy_width}
              min={160}
              max={360}
              change={(hierarchy_width) => setLayout((layout) => ({ ...layout, hierarchy_width }))}
              reset={() =>
                setLayout((layout) => ({
                  ...layout,
                  hierarchy_width: defaultLayout.hierarchy_width,
                }))
              }
            />
          )}
          <div className="center">
            <section className="canvas-section">
              {explanationFocus && (
                <div className="explanation-source-bar" role="note">
                  <span>
                    {traceTarget
                      ? `Recorded step ${explanationFocus.index + 1}: ${traceTitle(explanationFocus.record.project, explanationFocus.record.explanation.steps[explanationFocus.index].kind)}`
                      : 'Game content changed; the recorded source highlight is cleared.'}
                  </span>
                  <button
                    onClick={() => {
                      setExplanationRecord(explanationFocus.record);
                      setShowExplanation(true);
                    }}
                  >
                    Return to explanation
                  </button>
                  <button onClick={() => setExplanationFocus(null)}>Clear highlight</button>
                </div>
              )}
              {tutorialVisible && (
                <Tutorial
                  project={doc}
                  completed={tutorialSteps}
                  setCompleted={setTutorialSteps}
                  dismiss={() => setTutorialVisible(false)}
                  go={(step) => {
                    setInspectorCollapsed(false);
                    setPlaytestFocused(false);
                    if (step === 'room')
                      select(
                        doc.locations.find((room) => room.id === creationRoom)?.id ??
                          doc.locations[0]?.id ??
                          doc.game.id,
                      );
                    else if (step === 'ending') select(gameDataPages.endings);
                    else if (step === 'playtest') setPlaytestCollapsed(false);
                    else if (step === 'export') setShowDiagnostics(true);
                    else if (step === 'object' && !doc.objects.length)
                      edit((p) => {
                        const item = makeObject(creationRoom);
                        p.objects.push(item);
                        select(item.id);
                        setMode('map');
                      });
                    else {
                      const target = doc.objects[0] ?? doc.locations[0];
                      if (!target) return;
                      if (step === 'object') {
                        select(target.id);
                        setMode('map');
                      } else {
                        const rule = target.actions.at(-1);
                        if (rule) select(rule.id);
                        else {
                          edit((p) => {
                            const created = makeAction(target.id, 'pull');
                            owner(p, target.id)!.actions.push(created);
                            select(created.id);
                          });
                        }
                        setMode('actions');
                      }
                    }
                  }}
                />
              )}
              <nav className="breadcrumbs" aria-label="Editor navigation">
                <button
                  aria-label="Navigate back"
                  disabled={!navigation.canBack}
                  onClick={() => {
                    setRevealTarget(null);
                    navigation.back();
                  }}
                >
                  ←
                </button>
                <button
                  aria-label="Navigate forward"
                  disabled={!navigation.canForward}
                  onClick={() => {
                    setRevealTarget(null);
                    navigation.forward();
                  }}
                >
                  →
                </button>
                <button onClick={() => select(doc.game.id)}>{doc.game.title}</button>
                {ownerAncestors.map((key) => (
                  <Fragment key={key}>
                    <span aria-hidden="true">›</span>
                    <button onClick={() => select(key)}>
                      {owner(doc, key) && 'name' in owner(doc, key)!
                        ? (owner(doc, key)! as { name: string }).name
                        : key}
                    </button>
                  </Fragment>
                ))}
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
                  {mode === 'routines'
                    ? 'Routines'
                    : mode === 'conversations'
                      ? 'Conversations'
                      : mode === 'quests'
                        ? 'Quests'
                        : mode === 'map'
                          ? 'World map'
                          : mode === 'hints'
                            ? 'Hints'
                            : mode === 'contents'
                              ? 'Contents'
                              : mode === 'procedures'
                                ? 'Procedures'
                                : mode === 'triggers'
                                  ? 'Triggers'
                                  : 'Actions'}
                </span>
                {mode === 'triggers' && scheduled && (
                  <>
                    <span aria-hidden="true">›</span>
                    <button onClick={() => select(gameDataPages.scheduled)}>Scheduled</button>
                  </>
                )}
                {activeNarrative && (
                  <>
                    <span aria-hidden="true">›</span>
                    <button
                      onClick={() =>
                        select(
                          'conversation' in activeNarrative
                            ? activeNarrative.conversation.id
                            : activeNarrative.quest.id,
                        )
                      }
                    >
                      {'conversation' in activeNarrative
                        ? activeNarrative.conversation.name
                        : activeNarrative.quest.title}
                    </button>
                    {activeNarrative.kind === 'reply' && (
                      <>
                        <span aria-hidden="true">›</span>
                        <button onClick={() => select(activeNarrative.node.id)}>
                          {activeNarrative.node.name}
                        </button>
                      </>
                    )}
                    {!['conversation', 'quest'].includes(activeNarrative.kind) && (
                      <>
                        <span aria-hidden="true">›</span>
                        <span>
                          {'name' in activeNarrative.value
                            ? activeNarrative.value.name
                            : activeNarrative.kind === 'reply'
                              ? activeNarrative.reply.text || 'New reply'
                              : 'Quest hook'}
                        </span>
                      </>
                    )}
                  </>
                )}
                {!activeNarrative && breadcrumbFlow && (
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
                          ? String(breadcrumbFlow.event).replaceAll('_', ' ')
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
                  <button
                    className={mode === 'map' ? 'active' : ''}
                    onClick={() => {
                      if (
                        scheduled ||
                        mode === 'routines' ||
                        mode === 'procedures' ||
                        mode === 'conversations' ||
                        mode === 'quests'
                      )
                        select(doc.game.id);
                      setMode('map');
                    }}
                  >
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
                  {actionOwner && doc.characters.some((c) => c.id === actionOwner.id) && (
                    <button
                      onClick={() => select(`${gameDataPages.conversations}:${actionOwner.id}`)}
                    >
                      Conversations
                    </button>
                  )}
                  {storageOwner && (
                    <button
                      className={mode === 'contents' ? 'active' : ''}
                      onClick={() => {
                        setSelected(storageOwner.id);
                        setFlowBreadcrumb('');
                        setConnecting(false);
                        setMode('contents');
                      }}
                    >
                      Contents
                    </button>
                  )}
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
                {actionOwner && 'location' in actionOwner && (
                  <button
                    className={mode === 'routines' ? 'active' : ''}
                    onClick={() => select(`${routinePage}:${actionOwner.id}`)}
                  >
                    Character routines
                  </button>
                )}
                <button
                  onClick={() => {
                    const source =
                      mode === 'routines'
                        ? activeRoutine?.steps.find(
                            (step) => step.id === blockSelections[activeRoutine.id]?.routineStepId,
                          )
                        : mode === 'conversations' || mode === 'quests'
                          ? activeNarrativeScript
                          : mode === 'actions'
                            ? actionFlow
                            : mode === 'triggers'
                              ? scheduled
                                ? activeTimer
                                : activeTrigger
                              : mode === 'procedures'
                                ? activeProcedure
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
                  <button onClick={() => setShowExitCreation(true)}>Add exit…</button>
                )}
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
                    : mode === 'routines'
                      ? 'Keep every step in one group · one step attempt per charged turn'
                      : mode === 'conversations'
                        ? 'Connect dialogue and authored replies, then build the selected logic'
                        : mode === 'quests'
                          ? 'Author stages, earned journal lines and status hooks'
                          : mode === 'procedures'
                            ? 'Shared definitions with typed local inputs'
                            : mode === 'hints'
                              ? 'Author progressive clues and optional solutions'
                              : mode === 'triggers'
                                ? scheduled
                                  ? 'Schedule events after player turns'
                                  : 'Command, state, and value triggers'
                                : mode === 'contents'
                                  ? 'Arrange initial contents and set up interactions'
                                  : actionOwner
                                    ? 'Choose an action or exit, then build its logic'
                                    : 'Select an object, location, or character'}
                </span>
              </div>
              {(activeRoutine || activeTimer || (mode === 'procedures' && activeProcedure)) &&
                procedureReturns.at(-1)?.definition ===
                  (activeRoutine ?? activeTimer ?? activeProcedure)?.id && (
                  <div className="procedure-return">
                    <button
                      disabled={!script(doc, procedureReturns.at(-1)!.scriptId)}
                      onClick={returnToCaller}
                    >
                      ← Return to {procedureReturns.at(-1)!.name} →{' '}
                      {procedureReturns.at(-1)!.selection.value?.type === 'call'
                        ? 'CALL'
                        : procedureReturns.at(-1)!.selection.label}
                    </button>
                  </div>
                )}
              {mode === 'triggers' && (
                <div className="trigger-group-tabs tabs" role="group" aria-label="Trigger groups">
                  <button
                    className={!scheduled ? 'active' : ''}
                    aria-pressed={!scheduled}
                    onClick={() => select(gameDataPages.triggers)}
                  >
                    Command, state and value
                  </button>
                  <button
                    className={scheduled ? 'active' : ''}
                    aria-pressed={scheduled}
                    onClick={() => select(gameDataPages.scheduled)}
                  >
                    Scheduled
                  </button>
                </div>
              )}
              <div className="canvas">
                {mode === 'conversations' || mode === 'quests' ? (
                  <Narrative
                    key={mode}
                    project={doc}
                    selected={selected}
                    kind={mode}
                    edit={edit}
                    select={select}
                    blocksRef={blocks}
                    selectedBlock={blockSelections[selected]?.blockId}
                    onBlockSelect={selectBlock}
                    blockViews={blockViews}
                    history={historyControls}
                    error={error}
                  />
                ) : mode === 'routines' ? (
                  <Routines
                    project={doc}
                    active={activeRoutine}
                    character={routineCharacter}
                    edit={edit}
                    select={select}
                    history={historyControls}
                    blocksRef={blocks}
                    blockViews={blockViews}
                    onBlockSelect={selectBlock}
                    selectedBlock={activeRoutine && blockSelections[activeRoutine.id]?.blockId}
                    error={error}
                  />
                ) : mode === 'procedures' ? (
                  <Procedures
                    project={doc}
                    active={activeProcedure}
                    edit={edit}
                    select={select}
                    blocksRef={blocks}
                    selectedBlock={activeProcedure && blockSelections[activeProcedure.id]?.blockId}
                    onBlockSelect={selectBlock}
                    blockViews={blockViews}
                    history={historyControls}
                    error={error}
                  />
                ) : mode === 'contents' && storageOwner ? (
                  <Contents
                    key={storageOwner.id}
                    project={doc}
                    holder={storageOwner}
                    edit={edit}
                    select={select}
                    setup={() => setContainerSetup(storageOwner.id)}
                  />
                ) : mode === 'map' ? (
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
                ) : mode === 'triggers' && scheduled ? (
                  <ScheduledTimers
                    project={doc}
                    active={activeTimer}
                    edit={edit}
                    select={select}
                    history={historyControls}
                    blocksRef={blocks}
                    blockViews={blockViews}
                    onBlockSelect={selectBlock}
                    selectedBlock={activeTimer && blockSelections[activeTimer.id]?.blockId}
                    error={error}
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
            {!playtestCollapsed && !playtestFocused && (
              <ResizeHandle
                label="Resize playtest"
                orientation="horizontal"
                reverse
                value={layout.playtest_height}
                min={play?.result.undo?.enabled ? 340 : 180}
                max={640}
                change={(playtest_height) =>
                  setLayout((layout) => ({ ...layout, playtest_height }))
                }
                reset={() =>
                  setLayout((layout) => ({
                    ...layout,
                    playtest_height: defaultLayout.playtest_height,
                  }))
                }
              />
            )}
            <section
              className={`playtest ${playtestCollapsed ? 'is-collapsed' : ''} ${play?.result.conversation ? 'has-conversation' : ''} ${!playtestCollapsed && play?.result.undo?.enabled ? 'has-player-undo' : ''}`}
              aria-label="Playtest"
            >
              <div className="playtest-toolbar">
                <h2>Playtest</h2>
                {!playtestCollapsed && (
                  <button onClick={() => setPlaytestFocused((focused) => !focused)}>
                    {playtestFocused ? 'Return to editor' : 'Focus playtest'}
                  </button>
                )}
                <span className="session-status">
                  {play
                    ? `● ${busy ? 'Command running' : playSource !== playVersion ? 'Edits need restart' : play.state.ending ? 'Ended' : 'Running'}`
                    : 'Ready to start'}
                </span>
                <div className="playtest-controls" hidden={playtestCollapsed}>
                  <button disabled={!play} onClick={() => setShowJournal(true)}>
                    Quest log
                  </button>
                  <button disabled={busy} onClick={() => setPlaytestTools({})}>
                    Setups &amp; checks
                  </button>
                  <button
                    disabled={busy || countErrors > 0}
                    onClick={() => {
                      void start();
                    }}
                  >
                    {play ? 'Fresh start' : 'Start playtest'}
                  </button>
                  <select
                    aria-label="Start at location"
                    disabled={busy || countErrors > 0}
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
                  onClick={() => {
                    setPlaytestFocused(false);
                    setPlaytestCollapsed((collapsed) => !collapsed);
                  }}
                >
                  <span aria-hidden="true">{playtestCollapsed ? '▴' : '▾'}</span>
                </button>
              </div>
              {!playtestCollapsed && (
                <PlayerUndo
                  view={play?.result.undo}
                  busy={busy}
                  ended={!!play?.state.ending}
                  hints={!!playProject?.game.hints_enabled}
                  undo={() => void send('undo', undefined, true)}
                />
              )}
              <div id="playtest-content" className="playtest-content" hidden={playtestCollapsed}>
                {play && (
                  <div className="playtest-revision">
                    <span>
                      {play.source.title} · {play.source.content_version} · snapshot{' '}
                      {play.source.revision.slice(0, 8)} ·{' '}
                      {playSource === playVersion ? 'Up to date' : 'Earlier game content'}
                    </span>
                    {playSource !== playVersion && (
                      <div className="playtest-restart" role="note">
                        <span>
                          Your game has changed. This session keeps its original game and state.
                        </span>
                        <button disabled={busy || countErrors > 0} onClick={() => void start()}>
                          Restart with latest edits
                        </button>
                        <span>
                          Continue here, or capture a setup before restarting. Restarting begins a
                          fresh game.
                        </span>
                      </div>
                    )}
                  </div>
                )}
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
                        <p key={i} className={log.restoration ? 'restoration-line' : undefined}>
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
                {play?.result.turns && (
                  <PendingTimers
                    view={play.result.turns}
                    project={playProject!}
                    sourceCurrent={playSource === playVersion}
                    reveal={reveal}
                    wait={() => void send('wait')}
                    busy={busy || !!play.state.ending}
                  />
                )}
                {!!play?.result.routines?.length && (
                  <RoutineProgress
                    views={play.result.routines}
                    project={playProject!}
                    sourceCurrent={playSource === playVersion}
                    reveal={reveal}
                  />
                )}
                {play?.result.conversation && (
                  <NarrativePlayer
                    project={playProject!}
                    view={play.result.conversation}
                    plain={plain}
                    busy={busy}
                    select={(offer_token, reply_id, number) =>
                      void send(`reply ${number}`, { offer_token, reply_id })
                    }
                    pause={() => void send('bye')}
                  />
                )}
                {play?.result.pending_clarification && (
                  <div className="pending-command" role="note" aria-label="Pending command">
                    <span>
                      Waiting for a choice: {play.result.pending_clarification.original_command}
                    </span>
                    <button type="button" disabled={busy} onClick={() => void send('cancel')}>
                      Cancel pending command
                    </button>
                  </div>
                )}
                <form
                  className="command-input"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void send();
                  }}
                >
                  <span>&gt;</span>
                  <input
                    ref={playerCommand}
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
                  <Check
                    label="Record explanations"
                    value={recordExplanations}
                    onChange={setRecordExplanations}
                  />
                  <button
                    disabled={!explanationRecord || busy}
                    onClick={() => setShowExplanation(true)}
                  >
                    Explain last command
                  </button>
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
                  <button disabled={!play || busy} onClick={() => setShowState(true)}>
                    World state inspector
                  </button>
                </div>
              </div>
            </section>
          </div>
          {!inspectorHidden && (
            <ResizeHandle
              label="Resize inspector"
              reverse
              value={layout.inspector_width}
              min={280}
              max={560}
              change={(inspector_width) => setLayout((layout) => ({ ...layout, inspector_width }))}
              reset={() =>
                setLayout((layout) => ({
                  ...layout,
                  inspector_width: defaultLayout.inspector_width,
                }))
              }
            />
          )}
          <aside
            className={`inspector-panel ${inspectorHidden ? 'is-collapsed' : ''}`}
            aria-label="Inspector"
          >
            <div className="inspector-toolbar">
              {!inspectorHidden &&
                (mode === 'conversations' || mode === 'quests' ? (
                  <button
                    className="inspector-back"
                    onClick={() => {
                      if (inspectedBlock) {
                        blocks.current?.selectBlock(null);
                        setBlockSelections((old) => {
                          const next = { ...old };
                          delete next[selected];
                          return next;
                        });
                      } else if (activeNarrative && activeNarrative.kind === 'reply')
                        select(activeNarrative.node.id);
                      else select(gameDataPages[mode]);
                    }}
                  >
                    ←{' '}
                    {inspectedBlock
                      ? 'Narrative settings'
                      : activeNarrative?.kind === 'reply'
                        ? 'Back to node'
                        : mode === 'conversations'
                          ? 'Conversations'
                          : 'Quests'}
                  </button>
                ) : mode === 'routines' ? (
                  <button className="inspector-back" onClick={() => select(routinePage)}>
                    ← Routines
                  </button>
                ) : mode === 'triggers' && scheduled ? (
                  <button
                    className="inspector-back"
                    onClick={() => select(gameDataPages.scheduled)}
                  >
                    ← Scheduled triggers
                  </button>
                ) : mode === 'procedures' ? (
                  <button
                    className="inspector-back"
                    onClick={() => select(gameDataPages.procedures)}
                  >
                    ← Procedures
                  </button>
                ) : mode === 'hints' && hintOwner ? (
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
                aria-label={inspectorHidden ? 'Expand inspector' : 'Collapse inspector'}
                aria-expanded={!inspectorHidden}
                aria-controls="inspector-content"
                title={inspectorHidden ? 'Expand inspector' : 'Collapse inspector'}
                onClick={() => {
                  if (playtestFocused) {
                    setPlaytestFocused(false);
                    setInspectorCollapsed(false);
                  } else setInspectorCollapsed((collapsed) => !collapsed);
                }}
              >
                <span aria-hidden="true">{inspectorHidden ? '‹' : '›'}</span>
                {inspectorHidden && <span>Inspector</span>}
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
              hidden={inspectorHidden}
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
                {(mode === 'conversations' || mode === 'quests') && !inspectedBlock ? (
                  <NarrativeInspector
                    key={selected}
                    project={doc}
                    selected={selected}
                    edit={edit}
                    select={select}
                    reveal={reveal}
                  />
                ) : mode === 'procedures' && !inspectedBlock ? (
                  activeProcedure ? (
                    <ProcedureInspector
                      key={activeProcedure.id}
                      project={doc}
                      definition={activeProcedure}
                      edit={edit}
                      select={select}
                      reveal={reveal}
                      remove={() => remove(activeProcedure.id)}
                    />
                  ) : (
                    <>
                      <h2>Procedures</h2>
                      <p>Select or add a procedure to edit its inputs and shared effects.</p>
                    </>
                  )
                ) : mode === 'hints' && hintOwner ? (
                  <HintInspector
                    project={doc}
                    ownerId={hintOwner.id}
                    selection={hintSelection}
                    select={(selection) => setHintSelection(selection)}
                    edit={edit}
                  />
                ) : mode === 'routines' ? (
                  activeRoutine ? (
                    <RoutineInspector
                      key={activeRoutine.id}
                      project={doc}
                      definition={activeRoutine}
                      selection={blockSelections[activeRoutine.id]}
                      edit={edit}
                      select={select}
                      selectBlock={(id) => blocks.current?.selectBlock(id)}
                      clear={() => {
                        blocks.current?.selectBlock(routineBlockId(doc, activeRoutine.id) ?? null);
                        setBlockSelections((old) => {
                          const next = { ...old };
                          delete next[activeRoutine.id];
                          return next;
                        });
                      }}
                      changeBlock={(selection, value) =>
                        blocks.current?.updateBlock(
                          selection,
                          value,
                          current.current.doc ?? undefined,
                        )
                      }
                      openDefinition={openDefinition}
                      createDefinition={createDefinition}
                      remove={() => remove(activeRoutine.id)}
                      error={error}
                    />
                  ) : (
                    <>
                      <h2>Routines</h2>
                      <p>
                        Select a routine or create one for a character. Its steps stay together in
                        one Blockly group.
                      </p>
                    </>
                  )
                ) : mode === 'triggers' && scheduled && !inspectedBlock ? (
                  activeTimer ? (
                    <TimerInspector
                      key={activeTimer.id}
                      project={doc}
                      definition={activeTimer}
                      edit={edit}
                      select={select}
                      remove={() => remove(activeTimer.id)}
                    />
                  ) : (
                    <>
                      <h2>Scheduled triggers</h2>
                      <p>Select or add a named timer to build its guard and effects.</p>
                    </>
                  )
                ) : mode === 'triggers' && !scheduled && !activeTrigger ? (
                  <>
                    <h2>Triggers</h2>
                    <p className="muted">Add a trigger to build its conditions and effects.</p>
                  </>
                ) : inspectedBlock ? (
                  <BlockInspector
                    project={doc}
                    selection={inspectedBlock}
                    openDefinition={openDefinition}
                    createDefinition={createDefinition}
                    help={() => setHelpTopic('blocks')}
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
                    contents={(id) => {
                      select(id);
                      setMode('contents');
                      setConnecting(false);
                    }}
                    containerSetup={setContainerSetup}
                  />
                )}
              </FindingSubject.Provider>
            </div>
          </aside>
        </main>
      )}
      {showJournal && play && (
        <NarrativeJournal
          entries={play.quest_log}
          plain={plain}
          close={() => setShowJournal(false)}
        />
      )}
      {showSearch && doc && (
        <ProjectSearch
          project={doc}
          query={projectSearch}
          setQuery={setProjectSearch}
          close={() => setShowSearch(false)}
          reveal={reveal}
        />
      )}
      {containerSetup && doc?.objects.find((o) => o.id === containerSetup) && (
        <ContainerSetup
          project={doc}
          object={doc.objects.find((o) => o.id === containerSetup)!}
          edit={edit}
          select={select}
          close={() => setContainerSetup(null)}
        />
      )}
      {showExitCreation && doc && (
        <ExitCreation
          project={doc}
          source={creationRoom}
          edit={edit}
          select={select}
          close={() => setShowExitCreation(false)}
        />
      )}
      {helpTopic && (
        <AuthoringHelp
          initial={helpTopic}
          block={helpTopic === 'blocks' ? inspectedBlock?.label : undefined}
          close={() => setHelpTopic(null)}
          tutorial={() => setTutorialVisible(true)}
        />
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
          findings={rawDiagnostics}
          edit={edit}
          filter={findingFilter}
          setFilter={setFindingFilter}
          pending={validation.version !== validationVersion}
          close={() => setShowDiagnostics(false)}
          reveal={reveal}
        />
      )}
      {projectModal && (
        <Modal title="New project" close={() => setProjectModal(false)}>
          <div className="section-heading">
            <h2>Create a project</h2>
            <button aria-label="Close new project" onClick={() => setProjectModal(false)}>
              ×
            </button>
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
              onChange={(value) => {
                setExample(value);
                if (value) setNewTutorial(false);
              }}
            />
            <Check
              label="Follow the first-adventure tutorial"
              value={newTutorial}
              onChange={(value) => {
                setNewTutorial(value);
                if (value) setExample(false);
              }}
            />
            <p className="muted">
              Leave both unchecked to start blank. Guidance can be opened later from Authoring
              guide.
            </p>
            <p className="muted">
              {config?.projects_root}/{newFolder}
            </p>
            <button className="primary">Create project</button>
          </form>
        </Modal>
      )}
      {routineCreation && doc && (
        <RoutineCreation
          project={doc}
          edit={edit}
          from={routineCreation}
          close={() => setRoutineCreation(null)}
          created={(id) => openDefinition(id, routineCreation)}
        />
      )}
      {timerCreation && doc && (
        <TimerCreation
          project={doc}
          edit={edit}
          from={timerCreation}
          close={() => setTimerCreation(null)}
          created={(id) => openDefinition(id, timerCreation)}
        />
      )}
      {showState && play && playProject && (
        <Modal title="World state" close={() => setShowState(false)} className="wide">
          <div className="section-heading">
            <h2>World state</h2>
            <button onClick={() => setShowState(false)}>Close</button>
          </div>
          <NarrativeProgressInspector
            sourceCurrent={playSource === playVersion}
            project={playProject}
            state={play.state}
            reveal={(id) => {
              setShowState(false);
              select(id);
            }}
          />
          <StateInspector
            state={play.state}
            project={playProject}
            onApply={(state) => {
              return request<PlaytestView>(`/playtests/${play.session}/state`, 'PUT', {
                state,
              }).then((v) => {
                setPlay(v);
                if (stateKey(v.state) !== stateKey(play.state)) setPlayInitialState(null);
                setShowState(false);
                setLogs((old) => [
                  ...old,
                  { spans: [{ text: 'Test state applied.', colour: null }] },
                ]);
              });
            }}
          />
        </Modal>
      )}
      {playtestTools && doc && (
        <PlaytestTools
          key={view?.handle}
          project={doc}
          play={play}
          history={history}
          historyUsable={historyCanReplay(playStart, playInitialState, doc.editor.playtest)}
          initialStart={playStart}
          helpMode={playHelpMode}
          initialSelection={playtestTools}
          isCurrent={playSource === playVersion}
          edit={edit}
          close={() => setPlaytestTools(null)}
          explain={(record) => {
            setExplanationRecord(record);
            setShowExplanation(true);
          }}
          revealFlow={(id) =>
            reveal({
              subject: id,
              flowId: id,
              ownerId: flowOwner(doc, id)?.id,
              path: '',
              scope: 'content',
            })
          }
          restore={async (setup) => {
            const restored = await start(undefined, setup);
            if (!restored)
              throw new Error('Setup was not restored. Check the project and try again.');
          }}
          openRun={(run, snapshot, check) => {
            setPlay({
              quest_log: run.quest_log,
              session: run.session,
              state: run.state,
              source: run.source,
              result: {
                ...(run.steps.at(-1)?.result ?? {
                  messages: [],
                  trace: [],
                  state_changed: false,
                  status: 'ok',
                  control: null,
                  selected_flow: null,
                }),
                conversation: run.conversation ?? undefined,
                undo: run.undo,
              },
            });
            setPlayProject(snapshot);
            setPlayHelpMode(check.help_mode ?? '');
            setPlayRecordingHelp(check.help_mode ?? '');
            const last = run.steps.at(-1)?.result;
            setExplanationRecord(
              last?.explanation
                ? {
                    explanation: last.explanation,
                    project: snapshot,
                    source: run.source,
                    contentKey: playContentKey(snapshot, check.help_mode ?? ''),
                    help: check.help_mode ?? '',
                    status: last.status,
                    input_resolution: last.input_resolution,
                    selected_flow: last.selected_flow,
                  }
                : null,
            );
            setExplanationFocus(null);
            setPlaySource(playContentKey(snapshot, check.help_mode ?? ''));
            setPlayStart(check.start);
            setPlayInitialState(stateKey(run.initial_state));
            setLogs(runLogs(run));
            setHistory(run.steps.map((step) => step.command));
            setHistoryAt(run.steps.length);
            setInput('');
            setShowState(false);
            setPlaytestCollapsed(false);
          }}
        />
      )}
      {showExplanation && explanationRecord && doc && (
        <CommandExplanation
          record={explanationRecord}
          project={doc}
          reveal={(site) => {
            setShowExplanation(false);
            reveal(site);
          }}
          close={() => setShowExplanation(false)}
          inspect={(index) => {
            if (!explanationIsCurrent(explanationRecord, doc)) return;
            const source = explanationRecord.explanation.steps[index]?.source;
            if (!source) return;
            setExplanationFocus({ record: explanationRecord, index });
            setShowExplanation(false);
            reveal(
              findingSite(doc, {
                subject: source.subject,
                field: source.path,
                severity: 'warning',
                message: '',
              }),
            );
          }}
        />
      )}
      {comparison && doc && (
        <Modal
          title="Compare external changes"
          close={() => setComparison(null)}
          className="compare"
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
        </Modal>
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
          if ('id' in reference.target) {
            const parent = narrativeRemovalDestination(doc, reference.target.id, selected);
            if (parent) select(parent);
          }
        } else setReferenceRequest(reference);
      }}
    >
      <ProcedureScope.Provider
        value={
          doc
            ? {
                project: doc,
                procedure: mode === 'procedures' ? activeProcedure : undefined,
                scriptId: inspectedFlow?.id ?? '',
              }
            : null
        }
      >
        <ExplanationFocus.Provider value={traceTarget}>
          <FindingContext.Provider value={{ findings: diagnostics, reveal: revealTarget }}>
            <ReferenceCreation
              project={doc}
              edit={edit}
              reserved={config?.reserved ?? []}
              onTimerCreated={(id) => openDefinition(id)}
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
                    if ('id' in target) {
                      const parent = narrativeRemovalDestination(doc, target.id, selected);
                      if (parent) {
                        select(parent);
                        return;
                      }
                    }
                    if (
                      'id' in target &&
                      (selected === target.id || flowOwner(doc, selected)?.id === target.id)
                    )
                      select(
                        target.kind === 'routine'
                          ? routinePage
                          : target.kind === 'timer'
                            ? gameDataPages.scheduled
                            : target.kind === 'procedure'
                              ? gameDataPages.procedures
                              : (flowOwner(doc, target.id)?.id ?? doc.game.id),
                      );
                  }}
                />
              )}
            </ReferenceCreation>
          </FindingContext.Provider>
        </ExplanationFocus.Provider>
      </ProcedureScope.Provider>
    </ReferenceActions.Provider>
  );
}
