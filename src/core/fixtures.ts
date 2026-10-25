import type { Cell, Scenario, SceneSpec } from './types';

// Original 9-cell aisle and passing loop. All other cells are solid warehouse racks.
const free = new Set(['1,3', '2,3', '3,3', '4,3', '5,3', '6,3', '2,2', '3,2', '4,2']);
const blocked: Cell[] = [];
for (let y = 0; y < 8; y++)
  for (let x = 0; x < 8; x++) if (!free.has(`${x},${y}`)) blocked.push([x, y]);
const base: Scenario = {
  schemaVersion: 1,
  id: 'crossroads',
  name: 'Crossroads',
  description: 'Opposing deliveries meet in a shared aisle. One robot must use the passing loop.',
  width: 8,
  height: 8,
  blocked,
  robots: [
    { id: 'amber', start: [1, 3], pickup: [1, 3], dropoff: [6, 3], color: '#f3b851' },
    { id: 'teal', start: [6, 3], pickup: [6, 3], dropoff: [1, 3], color: '#55d8cd' },
  ],
  events: [],
  horizon: 120,
};
export const SCENARIOS: Scenario[] = [
  structuredClone(base),
  {
    ...structuredClone(base),
    id: 'blocked-aisle',
    name: 'Blocked aisle',
    description:
      'The center aisle closes at tick 2. The announcement becomes an active obstacle once the cell is vacant.',
    events: [{ tick: 2, type: 'block', cell: [3, 3] }],
  },
  {
    ...structuredClone(base),
    id: 'shift-change',
    name: 'Shift change',
    description: 'Robots collect orders inside the aisle before making opposing deliveries.',
    robots: base.robots.map((r, i) => ({
      ...structuredClone(r),
      pickup: i === 0 ? [2, 3] : [5, 3],
    })),
  },
];
export const DEFAULT_SCENE: SceneSpec = {
  schemaVersion: 1,
  scenario: structuredClone(SCENARIOS[0]),
  style: { palette: 'cloud-workshop', tileScale: 1 },
  decorations: [
    { id: 'cloud-north', kind: 'cloud', cell: [1, 1], height: 0.5 },
    { id: 'crate-west', kind: 'crate', cell: [1, 5], height: 0.5 },
    { id: 'feather-east', kind: 'feather', cell: [6, 5], height: 0.25 },
  ],
};

/** Separate acceptance inputs. No precomputed answers or routes are exported. */
export const HOLDOUT_SCENARIOS: Scenario[] = [
  {
    ...structuredClone(base),
    id: 'holdout-reverse',
    name: 'Reverse dispatch',
    description: 'Opposing orders are assigned from the opposite starting stations.',
    robots: base.robots.map((r, i) => ({
      ...structuredClone(r),
      start: i === 0 ? [6, 3] : [1, 3],
      pickup: i === 0 ? [6, 3] : [1, 3],
      dropoff: i === 0 ? [1, 3] : [6, 3],
    })),
  },
  {
    ...structuredClone(base),
    id: 'holdout-late-block',
    name: 'Late closure',
    description: 'The center aisle closes at tick 4, once vacant.',
    events: [{ tick: 4, type: 'block', cell: [3, 3] }],
  },
  {
    ...structuredClone(base),
    id: 'holdout-outbound-pickup',
    name: 'Outbound collection',
    description:
      'Robots begin inside the aisle and collect at opposite end stations before delivering.',
    robots: base.robots.map((r, i) => ({
      ...structuredClone(r),
      start: i === 0 ? [2, 3] : [5, 3],
    })),
  },
];
