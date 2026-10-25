export type Cell = [number, number];
export type Move = 'N' | 'E' | 'S' | 'W' | 'WAIT';
export type Robot = { id: string; start: Cell; pickup: Cell; dropoff: Cell; color?: string };
export type Scenario = {
  schemaVersion: 1;
  id: string;
  name: string;
  description: string;
  width: 8;
  height: 8;
  blocked: Cell[];
  robots: Robot[];
  events: { tick: number; type: 'block'; cell: Cell }[];
  horizon: 120;
};
export type SceneSpec = {
  schemaVersion: 1;
  scenario: Scenario;
  style: { palette: 'cloud-workshop' | 'industrial'; tileScale: 1 };
  decorations: {
    id: string;
    kind: 'crate' | 'cloud' | 'feather';
    cell: Cell;
    height: 0.25 | 0.5;
  }[];
};
export type WorldState = {
  tick: number;
  positions: Record<string, Cell>;
  carrying: Record<string, boolean>;
  delivered: Record<string, boolean>;
  activeBlocks: Cell[];
  announcedEvents: number[];
};
export type Observation = WorldState & { scenario: Scenario };
export type Decision = { moves: Record<string, Move>; state: unknown };
export type Transition = {
  before: WorldState;
  after: WorldState;
  moves: Record<string, Move>;
  valid: boolean;
  errors: string[];
};
export type Trace = {
  scenarioId: string;
  initial: WorldState;
  transitions: Transition[];
  candidateId: string;
  controllerError?: string;
};
export type Check = {
  id: string;
  passed: boolean;
  observed: string | number | boolean;
  expected: string | number | boolean;
};
export type VerificationReport = {
  status: 'passed' | 'failed' | 'blocked';
  checks: Check[];
  delivered: number;
  total: number;
  ticks: number;
  illegalMoves: number;
  deadlockTick: number | null;
  summary: string;
};
export type Evaluation = { trace: Trace; report: VerificationReport };
export type FeasibilityResult = {
  status: 'feasible' | 'infeasible' | 'budget_exhausted';
  actions: Record<string, Move>[];
  explored: number;
};
export type Candidate = {
  id: string;
  name: string;
  source: string;
  provenance: 'seeded-fault' | 'local-reference' | 'gemini-managed';
  createdAt: string;
};
