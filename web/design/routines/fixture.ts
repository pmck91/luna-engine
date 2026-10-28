// CR0 interaction illustration only. This is not the shared Rust game executor.
import type { Condition } from '../../src/contracts';
export type RootCondition = 'always' | 'never' | 'gate_open' | 'gate_closed';
export const startOptions: [string, string][] = [
  ['Started by blocks', 'blocks'],
  ['On game start', 'initial'],
  ['When condition becomes true', 'condition'],
];
export const repeatOptions: [string, string][] = [
  ['Finish routine', 'finish'],
  ['Repeat from step 1', 'loop'],
  ['Repeat while condition is true', 'while'],
  ['Repeat until condition is true', 'until'],
];
export const conversationOptions: [string, string][] = [
  ['Hold this character’s routine', 'hold'],
  ['Continue routine', 'continue'],
];
export const conditionOptions: [string, RootCondition][] = [
  ['Garden gate is open', 'gate_open'],
  ['Garden gate is closed', 'gate_closed'],
  ['Always', 'always'],
  ['Never', 'never'],
];
export function conditionBlock(value: RootCondition): Condition {
  if (value === 'always') return { type: 'true' };
  if (value === 'never') return { type: 'false' };
  const opened: Condition = { type: 'opened', object: 'gate' };
  return value === 'gate_open' ? opened : { type: 'not', condition: opened };
}
function matches(value: RootCondition, gate: boolean) {
  return (
    value === 'always' || (value === 'gate_open' && gate) || (value === 'gate_closed' && !gate)
  );
}
export const startLabel = (r: Routine) => startOptions.find(([, value]) => value === r.start)![0];
export const repeatLabel = (r: Routine) =>
  repeatOptions.find(([, value]) => value === r.repeat)![0];
export type Kind = 'move' | 'wait' | 'say' | 'effects';
export type Step = {
  id: string;
  kind: Kind;
  destination: string;
  turns: number;
  text: string;
  guard: 'always' | 'gate_open';
  blocked: 'retry' | 'skip' | 'pause';
  nearby: boolean;
};
export type Routine = {
  id: string;
  name: string;
  character: string;
  start: 'blocks' | 'initial' | 'condition';
  startCondition: RootCondition;
  repeat: 'finish' | 'loop' | 'while' | 'until';
  repeatCondition: RootCondition;
  conversation: boolean;
  steps: Step[];
};
export type Model = { routines: Routine[]; caller: string; busy: 'keep' | 'replace' };
export const characters = [
  { id: 'keeper', name: 'Keeper', room: 'study' },
  { id: 'gardener', name: 'Gardener', room: 'garden' },
];
export const rooms = [
  { id: 'study', name: 'Study' },
  { id: 'garden', name: 'Garden' },
  { id: 'dev', name: 'Offstage room' },
];
export const person = (id: string) => characters.find((c) => c.id === id)!.name;
export const room = (id: string) => rooms.find((r) => r.id === id)!.name;
export const kinds: { id: Kind; name: string; detail: string }[] = [
  { id: 'move', name: 'Move', detail: 'Move this character directly to a room.' },
  { id: 'wait', name: 'Wait', detail: 'Spend a chosen number of routine turns here.' },
  { id: 'say', name: 'Say', detail: 'Speak when the player can see this character.' },
  {
    id: 'effects',
    name: 'Effects',
    detail: 'Run ordinary Luna blocks, including IF / ELSE and CALL.',
  },
];
export function newStep(kind: Kind, id: string): Step {
  return {
    id,
    kind,
    destination: 'garden',
    turns: 2,
    text: kind === 'say' ? 'All quiet here.' : 'The patrol bell rings.',
    guard: 'always',
    blocked: 'retry',
    nearby: true,
  };
}
export function stepTitle(s: Step) {
  return s.kind === 'move'
    ? `Move to ${room(s.destination)}`
    : s.kind === 'wait'
      ? `Wait ${s.turns} turn${s.turns === 1 ? '' : 's'}`
      : s.kind === 'say'
        ? 'Say “' + (s.text || '…') + '”'
        : 'Run effects';
}
export const initial: Model = {
  caller: 'patrol',
  busy: 'keep',
  routines: [
    {
      id: 'patrol',
      name: 'Evening patrol',
      character: 'keeper',
      start: 'initial',
      startCondition: 'gate_open',
      repeat: 'loop',
      repeatCondition: 'gate_open',
      conversation: true,
      steps: [
        { ...newStep('move', 'garden-step'), guard: 'gate_open' },
        newStep('wait', 'wait-step'),
        newStep('say', 'say-step'),
        { ...newStep('move', 'study-step'), destination: 'study' },
      ],
    },
    {
      id: 'rest',
      name: 'Retire for the night',
      character: 'keeper',
      start: 'blocks',
      startCondition: 'gate_open',
      repeat: 'finish',
      repeatCondition: 'gate_open',
      conversation: true,
      steps: [{ ...newStep('move', 'rest-step'), destination: 'dev' }],
    },
    {
      id: 'rounds',
      name: 'Garden rounds',
      character: 'gardener',
      start: 'blocks',
      startCondition: 'gate_open',
      repeat: 'loop',
      repeatCondition: 'gate_open',
      conversation: true,
      steps: [newStep('say', 'rounds-say'), newStep('wait', 'rounds-wait')],
    },
  ],
};
export type Progress = {
  routine: string;
  index: number;
  remaining: number | null;
  status: 'running' | 'paused' | 'stopped' | 'completed';
  reason: string;
};
export type Play = {
  turn: number;
  location: string;
  gate: boolean;
  conversation: string | null;
  progress: Record<string, Progress>;
  activated: string[];
  locations: Record<string, string>;
  log: string[];
  trace: string;
  ended: boolean;
};
function starting(r: Routine): Progress {
  return {
    routine: r.id,
    index: 0,
    remaining: null,
    status: 'running',
    reason: 'First step on the next charged turn.',
  };
}
export function fresh(m: Model): Play {
  const automatic = m.routines.filter(
    (r) => r.start === 'initial' || (r.start === 'condition' && matches(r.startCondition, true)),
  );
  return {
    turn: 0,
    location: 'garden',
    gate: true,
    conversation: null,
    ended: false,
    locations: Object.fromEntries(characters.map((c) => [c.id, c.room])),
    progress: Object.fromEntries(automatic.map((r) => [r.character, starting(r)])),
    activated: automatic.map((r) => r.id),
    log: ['You are in the Garden. The Keeper is in the Study.'],
    trace: automatic.length
      ? 'Automatic routines armed. Their first steps run on turn 1.'
      : 'No routines start automatically. START or a matching condition arms the next charged turn.',
  };
}
export type Input =
  | 'wait'
  | 'look'
  | 'help'
  | 'talk'
  | 'bye'
  | 'close'
  | 'open'
  | 'start'
  | 'replace'
  | 'pause'
  | 'resume'
  | 'stop'
  | 'end';
export function illustrate(before: Play, m: Model, input: Input, failing: boolean): Play {
  const p = structuredClone(before);
  if (p.ended) return p;
  if (input === 'look' || input === 'help') {
    p.log.push(
      input === 'look'
        ? `You look around the ${room(p.location)}.`
        : 'WAIT advances one turn; LOOK and HELP are free.',
    );
    p.trace = 'Free input. No routine step, retry or wait countdown runs.';
    return p;
  }
  if (input === 'bye') {
    p.conversation = null;
    for (const progress of Object.values(p.progress)) {
      if (progress.reason.startsWith('Held'))
        progress.reason = 'Conversation closed; continue on the next charged turn.';
    }
    p.trace = 'Conversation closed for free. The routine can continue on the next charged turn.';
    p.log.push('You finish the conversation.');
    return p;
  }
  const skip = new Set<string>();
  const protectedSpeakers = new Set(p.conversation ? [p.conversation] : []);
  if (input === 'talk') {
    p.conversation = 'keeper';
    protectedSpeakers.add('keeper');
    p.log.push('Keeper: “Can I help you?”');
  }
  if (input === 'close') p.gate = false;
  if (input === 'open') p.gate = true;
  const target = m.routines.find((r) => r.id === (input === 'replace' ? 'rest' : m.caller))!;
  const current = p.progress[target.character];
  if (input === 'start' || input === 'replace') {
    if (
      input === 'start' &&
      m.busy === 'keep' &&
      current &&
      ['running', 'paused'].includes(current.status)
    ) {
      p.log.push('Existing routine kept. Choose Replace current routine to switch or restart.');
    } else {
      p.progress[target.character] = starting(target);
      if (!p.activated.includes(target.id)) p.activated.push(target.id);
      skip.add(target.character);
      p.log.push(`${person(target.character)}: ${target.name} armed for the next charged turn.`);
    }
  }
  if (input === 'pause' && current?.routine === target.id && current.status === 'running') {
    current.status = 'paused';
    current.reason = 'Paused by an authored PAUSE ROUTINE block.';
  }
  if (input === 'resume' && current?.routine === target.id && current.status === 'paused') {
    current.status = 'running';
    current.reason = 'Resumed; continue on the next charged turn.';
    skip.add(target.character);
  }
  if (input === 'stop' && current?.routine === target.id) {
    current.status = 'stopped';
    current.remaining = null;
    current.reason = 'Stopped. START begins again at step 1.';
  }
  p.turn++;
  p.trace =
    'Player action → due timers (not illustrated here) → at most one step per character → conversation reconciliation.';
  if (input === 'end') {
    p.ended = true;
    for (const progress of Object.values(p.progress)) {
      progress.status = 'stopped';
      progress.reason = 'Story ended.';
      progress.remaining = null;
    }
    p.log.push('The workshop closes. Story ended.');
    return failing
      ? {
          ...structuredClone(before),
          trace:
            'Illustrated late failure: ending, action, clock and routine progress all rolled back.',
        }
      : p;
  }
  // Conditional activation is once per new game, never an implicit restart.
  // Another active routine is kept; the unstarted automatic routine waits for it.
  for (const r of m.routines) {
    const busy = p.progress[r.character];
    if (
      r.start !== 'condition' ||
      p.activated.includes(r.id) ||
      !matches(r.startCondition, p.gate) ||
      (busy && ['running', 'paused'].includes(busy.status))
    )
      continue;
    p.progress[r.character] = starting(r);
    p.activated.push(r.id);
    skip.add(r.character);
  }
  for (const r of m.routines) {
    const progress = p.progress[r.character];
    if (
      !progress ||
      progress.routine !== r.id ||
      progress.status !== 'running' ||
      skip.has(r.character)
    )
      continue;
    if (r.conversation && protectedSpeakers.has(r.character)) {
      progress.reason = 'Held for conversation. The step and wait remainder are preserved.';
      continue;
    }
    const s = r.steps[progress.index];
    if (!s) continue;
    if (progress.remaining === null && s.guard === 'gate_open' && !p.gate) {
      progress.reason = 'Blocked: Garden gate is closed.';
      if (s.blocked === 'retry') continue;
      if (s.blocked === 'pause') {
        progress.status = 'paused';
        continue;
      }
      progress.reason += ' Skipped this step; the next step waits for another turn.';
    } else if (s.kind === 'wait') {
      progress.remaining = (progress.remaining ?? s.turns) - 1;
      progress.reason =
        progress.remaining > 0
          ? `Waiting: ${progress.remaining} eligible turn(s) left.`
          : 'Wait complete. Next step on the next charged turn.';
      if (progress.remaining > 0) continue;
    } else if (s.kind === 'move') {
      const from = p.locations[r.character];
      p.locations[r.character] = s.destination;
      if (from !== s.destination)
        p.log.push(`${person(r.character)} moves from ${room(from)} to ${room(s.destination)}.`);
      progress.reason = 'Direct move completed; no player exit actions ran.';
    } else if (s.kind === 'say') {
      if (!s.nearby || p.locations[r.character] === p.location) {
        p.log.push(`${person(r.character)}: “${s.text}”`);
        progress.reason = 'Speech completed once.';
      } else progress.reason = 'Speech out of earshot. Step completed silently.';
    } else {
      p.log.push(p.gate ? s.text : 'The gate is still shut.');
      progress.reason = 'Ordinary effect flow completed once.';
    }
    progress.remaining = null;
    if (progress.index + 1 < r.steps.length) progress.index++;
    else if (
      r.repeat === 'loop' ||
      (r.repeat === 'while' && matches(r.repeatCondition, p.gate)) ||
      (r.repeat === 'until' && !matches(r.repeatCondition, p.gate))
    ) {
      progress.index = 0;
      if (r.repeat === 'while' || r.repeat === 'until')
        progress.reason += ' Repeat condition checked; next cycle on a later turn.';
    } else {
      progress.status = 'completed';
      progress.reason =
        r.repeat === 'finish'
          ? 'Routine complete. No further steps run.'
          : 'Repeat condition finished the routine after its last step.';
    }
  }
  if (p.conversation && p.locations[p.conversation] !== p.location) {
    p.log.push('The character left. The conversation is interrupted.');
    p.conversation = null;
  }
  if (failing)
    return {
      ...structuredClone(before),
      trace:
        'Illustrated late failure: action, clock, movement, speech and progress all rolled back. No story output committed.',
    };
  return p;
}
