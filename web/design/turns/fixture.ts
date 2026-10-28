// T0 interaction data only. No canonical definition, save or runtime schema.
export type Timer = {
  id: string;
  name: string;
  priority: number;
  guard: 'always' | 'door_open';
  close: boolean;
  message: string | null;
  draft: boolean;
};
export type Cost = 'default' | 'spend' | 'free';
export type Model = {
  timers: Timer[];
  schedule: { timer: string; after: number; pending: 'restart' | 'keep' };
  cancelTimer: string;
  pendingTimer: string;
  actionCost: Cost;
  replyCost: Cost;
  policy: { actions: boolean; replies: boolean; blocked: boolean; look: boolean; hints: boolean };
};
export const initial: Model = {
  timers: [
    {
      id: 'door-closes',
      name: 'Door closes',
      priority: 0,
      guard: 'door_open',
      close: true,
      message: 'The stone door swings shut.',
      draft: false,
    },
  ],
  schedule: { timer: 'door-closes', after: 3, pending: 'restart' },
  cancelTimer: 'door-closes',
  pendingTimer: 'door-closes',
  actionCost: 'default',
  replyCost: 'default',
  policy: { actions: true, replies: true, blocked: false, look: false, hints: false },
};
export const costs = [
  { id: 'default', name: 'Use game default' },
  { id: 'spend', name: 'Spend 1 turn' },
  { id: 'free', name: 'Free action' },
];
export const spends = (cost: Cost, fallback: boolean) =>
  cost === 'default' ? fallback : cost === 'spend';
