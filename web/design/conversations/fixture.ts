// N0-only display model and fixed Keeper walkthrough. This is not a second
// interpreter: there is no arbitrary condition/effect evaluator or serialization.
export type Gate = 'always' | 'quest_active' | 'carrying_key' | 'quest_complete';
export const gates: Record<Gate, string> = {
  always: 'Always available',
  quest_active: 'The Missing Key is active',
  carrying_key: 'Quest active + carrying brass key',
  quest_complete: 'The Missing Key is completed',
};
export type Reply = {
  id: string;
  text: string;
  gate: Gate;
  once: boolean;
  destination: string;
};
export type DialogueNode = {
  id: string;
  name: string;
  line: string;
  replies: Reply[];
  draft: boolean;
  terminal: boolean;
  position: { x: number; y: number };
};
export type Conversation = {
  id: string;
  name: string;
  nodes: DialogueNode[];
  entries: { first: string; active: string; completed: string };
};
export type Stage = {
  id: string;
  name: string;
  text: string;
  prerequisite: string;
  required: boolean;
};
export type Authoring = {
  conversations: Conversation[];
  quest: { name: string; introduction: string; completion: string; stages: Stage[] };
};
export const initial: Authoring = {
  conversations: [
    {
      id: 'keeper',
      name: 'The Keeper’s missing key',
      entries: { first: 'greeting', active: 'progress', completed: 'revisit' },
      nodes: [
        {
          id: 'greeting',
          name: 'First meeting',
          line: 'I have lost my key. Will you help me find it?',
          draft: false,
          terminal: false,
          position: { x: 20, y: 50 },
          replies: [
            {
              id: 'accept',
              text: 'Yes, I’ll help.',
              gate: 'always',
              once: true,
              destination: 'progress',
            },
            { id: 'decline', text: 'No, sorry.', gate: 'always', once: false, destination: 'end' },
          ],
        },
        {
          id: 'progress',
          name: 'Finding the key',
          line: 'Thank you for helping. Have you found my key?',
          draft: false,
          terminal: false,
          position: { x: 350, y: 50 },
          replies: [
            {
              id: 'ask',
              text: 'Where did you last see it?',
              gate: 'quest_active',
              once: true,
              destination: 'clue',
            },
            {
              id: 'handover',
              text: 'I found your key. Here it is.',
              gate: 'carrying_key',
              once: true,
              destination: 'thanks',
            },
            {
              id: 'leave',
              text: 'I’ll keep looking. Goodbye.',
              gate: 'always',
              once: false,
              destination: 'end',
            },
          ],
        },
        {
          id: 'clue',
          name: 'A useful clue',
          line: 'I was reading in the Study. Try looking near the desk.',
          draft: false,
          terminal: false,
          position: { x: 350, y: 380 },
          replies: [
            {
              id: 'back',
              text: 'Thank you. One more thing…',
              gate: 'always',
              once: false,
              destination: 'progress',
            },
          ],
        },
        {
          id: 'thanks',
          name: 'A grateful Keeper',
          line: 'My key! Thank you. Here are ten coins for your trouble.',
          draft: false,
          terminal: false,
          position: { x: 680, y: 50 },
          replies: [
            {
              id: 'finish',
              text: 'You’re welcome. Goodbye.',
              gate: 'always',
              once: false,
              destination: 'end',
            },
          ],
        },
        {
          id: 'revisit',
          name: 'On return',
          line: 'Thank you again for finding my key.',
          draft: false,
          terminal: true,
          position: { x: 680, y: 380 },
          replies: [],
        },
      ],
    },
  ],
  quest: {
    name: 'The Missing Key',
    introduction: 'The Keeper asked me to find a lost key.',
    completion: 'I returned the key to the Keeper.',
    stages: [
      {
        id: 'found',
        name: 'Find the key',
        text: 'I found the key in the Study.',
        prerequisite: '',
        required: true,
      },
      {
        id: 'returned',
        name: 'Return the key',
        text: 'I returned the key to the Keeper.',
        prerequisite: 'found',
        required: true,
      },
    ],
  },
};
export type Demo = {
  active: string | null;
  checkpoint: string | null;
  status: 'undiscovered' | 'active' | 'completed';
  key: 'study' | 'player' | 'keeper';
  coins: number;
  journal: string[];
  chosen: string[];
  visited: string[];
  starts: number;
  entries: number;
  rewards: number;
  foundHooks: number;
  revision: number;
  transcript: string[];
  notice: string;
};
export const freshDemo = (): Demo => ({
  active: null,
  checkpoint: null,
  status: 'undiscovered',
  key: 'study',
  coins: 0,
  journal: [],
  chosen: [],
  visited: [],
  starts: 0,
  entries: 0,
  rewards: 0,
  foundHooks: 0,
  revision: 0,
  transcript: ['You are in the Study with the Keeper.'],
  notice: 'Talk to the Keeper to begin.',
});
export function available(reply: Reply, state: Demo) {
  if (reply.once && state.chosen.includes(reply.id)) return false;
  switch (reply.gate) {
    case 'always':
      return true;
    case 'quest_active':
      return state.status === 'active';
    case 'carrying_key':
      return state.status === 'active' && state.key === 'player';
    case 'quest_complete':
      return state.status === 'completed';
  }
}
export function keeper(model: Authoring) {
  return model.conversations.find((c) => c.id === 'keeper')!;
}
export function offered(model: Authoring, state: Demo) {
  return (
    keeper(model)
      .nodes.find((n) => n.id === state.active)
      ?.replies.filter((r) => available(r, state)) ?? []
  );
}
function enter(state: Demo, model: Authoring, nodeId: string) {
  const node = keeper(model).nodes.find((n) => n.id === nodeId);
  if (!node || node.draft) {
    state.active = null;
    state.checkpoint = null;
    state.notice =
      'This destination is a construction draft. Reset the example for the scripted walkthrough.';
    return;
  }
  state.active = nodeId;
  state.checkpoint = nodeId;
  state.entries++;
  if (!state.visited.includes(nodeId)) state.visited.push(nodeId);
  state.transcript.push(`Keeper says: ${node.line}`);
  if (node.terminal || !node.replies.some((reply) => available(reply, state))) {
    state.active = null;
    state.checkpoint = null;
    state.notice =
      'The final dialogue ends this encounter. A later talk uses the configured entry rules.';
  }
}
// This deliberately scripts only the supplied example and never executes blocks.
export function demonstrate(model: Authoring, before: Demo, command: string): Demo {
  const state = structuredClone(before);
  state.notice = '';
  const input = command.trim().toLowerCase();
  if (input === 'look') {
    state.notice = 'You are in the Study. Inspection preserves the conversation.';
    return state;
  }
  if (input === 'quests' || input === 'quest') {
    state.notice = 'Quest log opened. Reading it runs no effects.';
    return state;
  }
  if (input === 'talk keeper') {
    if (state.active) {
      state.notice = 'Current conversation redisplayed; entry effects have not run again.';
      return state;
    }
    state.revision++;
    if (state.checkpoint) {
      state.active = state.checkpoint;
      state.notice = 'Resumed the entered checkpoint. No entry effects replayed.';
    } else
      enter(
        state,
        model,
        state.status === 'undiscovered'
          ? keeper(model).entries.first
          : state.status === 'active'
            ? keeper(model).entries.active
            : keeper(model).entries.completed,
      );
    return state;
  }
  if (input === 'bye') {
    if (state.active) {
      state.active = null;
      state.revision++;
      state.notice = 'Conversation paused. Talk to the Keeper to resume.';
    } else state.notice = 'No conversation is active.';
    return state;
  }
  if (input === 'take key') {
    if (state.key !== 'study') {
      state.notice = 'The key is no longer in the Study. Conversation unchanged.';
      return state;
    }
    state.active = null;
    state.key = 'player';
    state.revision++;
    state.transcript.push('You take the brass key.');
    if (state.status === 'active' && !state.foundHooks) {
      state.foundHooks++;
      state.journal.push(model.quest.stages.find((s) => s.id === 'found')!.text);
    }
    state.notice = 'World action succeeded; conversation paused. Talk to the Keeper to resume.';
    return state;
  }
  if (/^(reply\s+)?\d+$/.test(input)) {
    const index = Number(input.replace(/^reply\s+/, '')) - 1;
    const reply = offered(model, state)[index];
    if (!state.active || !reply) {
      state.notice = 'Choose one of the displayed response numbers. Nothing changed.';
      return state;
    }
    // Body/destination editing is visual exploration; only fixture reply IDs run.
    if (!['accept', 'decline', 'ask', 'handover', 'leave', 'back', 'finish'].includes(reply.id)) {
      state.notice = 'New replies are authoring-only in this scripted preview.';
      return state;
    }
    if (reply.id === 'handover' && (state.status !== 'active' || state.key !== 'player')) {
      state.notice =
        'The fixed example requires an active quest and the carried key. No effects ran.';
      return state;
    }
    state.revision++;
    state.chosen.push(reply.id);
    state.transcript.push(`You: ${reply.text}`);
    if (reply.id === 'accept' && state.status === 'undiscovered') {
      state.status = 'active';
      state.starts++;
      state.journal.push(model.quest.introduction);
      // The fixed walkthrough also handles finding the key before accepting.
      if (state.key === 'player' && !state.foundHooks) {
        state.foundHooks++;
        state.journal.push(model.quest.stages.find((s) => s.id === 'found')!.text);
      }
    }
    if (reply.id === 'handover') {
      state.key = 'keeper';
      state.status = 'completed';
      state.coins += 10;
      state.rewards++;
      state.journal.push(model.quest.stages.find((s) => s.id === 'returned')!.text);
    }
    if (reply.destination === 'end') {
      state.active = null;
      state.checkpoint = null;
      state.notice = 'Conversation ended. The next talk selects an entry using quest progress.';
    } else enter(state, model, reply.destination);
    return state;
  }
  state.notice =
    'Choose a displayed response number, or use a world command. Conversation unchanged.';
  return state;
}
