import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Activity,
  ArrowDownLeft,
  ArrowRight,
  ArrowUpRight,
  Box,
  Boxes,
  Check,
  CheckCheck,
  ChevronDown,
  ChevronRight,
  Circle,
  CircleHelp,
  Code2,
  Copy,
  Crosshair,
  Expand,
  FlaskConical,
  GitBranch,
  Layers3,
  LoaderCircle,
  Map,
  MousePointer2,
  Pause,
  Play,
  Plus,
  RotateCcw,
  ScanLine,
  ShieldCheck,
  Square,
  Terminal,
  TriangleAlert,
  Workflow,
  X,
  Zap,
} from 'lucide-react';
import { SCENARIOS } from './core/fixtures';
import { initialState } from './core/engine';
import { parseScenario } from './core/scenario';
import { findFeasibleTrace } from './verify/feasible';
import type { Evaluation, SceneSpec, Scenario, WorldState } from './core/types';
import type { AgentRun } from './agent-types';
import { runController } from './controller/runner';
import { COOPERATIVE_SOURCE, GREEDY_SOURCE } from './controller/sources';
import { Warehouse, type Poses } from './view/Warehouse';
import './styles.css';

type EventItem = { at: string; message: string; kind: string };
type RunRecord = {
  id: string;
  at: string;
  label: string;
  scenario: Scenario;
  scene?: SceneSpec;
  evaluation: Evaluation;
  baseline: Evaluation | null;
  source: string;
  reference: boolean;
};
type ReplayBridge = {
  load: (evaluation: Evaluation, scene?: SceneSpec) => void;
  advance: (tick: number) => void;
  getState: () => {
    tick: number;
    positions: Poses;
    visiblePositions: Poses;
    carrying: Record<string, boolean>;
    delivered: Record<string, boolean>;
    scenarioId: string;
    totalTicks: number;
  };
};
declare global {
  interface Window {
    fleetReplay?: ReplayBridge;
  }
}

const prettyRobot = (id: string, index: number) =>
  /^robot[\s_-]?\d+$/i.test(id) ? `AGV–0${index + 1}` : id.toUpperCase();
const tickState = (evaluation: Evaluation | null, scenario: Scenario, tick: number): WorldState => {
  if (!evaluation) return initialState(scenario);
  const index = Math.min(Math.floor(tick), evaluation.trace.transitions.length);
  return index <= 0 ? evaluation.trace.initial : evaluation.trace.transitions[index - 1].after;
};
function App() {
  const [scenario, setScenario] = useState<Scenario>(SCENARIOS[0]);
  const [evaluation, setEvaluation] = useState<Evaluation | null>(null);
  const [baseline, setBaseline] = useState<Evaluation | null>(null);
  const [tick, setTick] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [camera, setCamera] = useState<'orbit' | 'top'>('orbit');
  const [routes, setRoutes] = useState(true);
  const [placing, setPlacing] = useState(false);
  const [source, setSource] = useState(GREEDY_SOURCE);
  const [sourceOpen, setSourceOpen] = useState(false);
  const [sourceTab, setSourceTab] = useState<'candidate' | 'baseline'>('candidate');
  const [busy, setBusy] = useState(false);
  const [referenceApplied, setReferenceApplied] = useState(false);
  const [error, setError] = useState('');
  const [events, setEvents] = useState<EventItem[]>([]);
  const [status, setStatus] = useState({ configured: false, model: '', agent: '' });
  const [mode, setMode] = useState<'local' | 'managed'>('local');
  const [run, setRun] = useState<AgentRun | null>(null);
  const [request, setRequest] = useState('');
  const [runPanel, setRunPanel] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [obstacleCount, setObstacleCount] = useState(0);
  const [sceneSpec, setSceneSpec] = useState<SceneSpec | undefined>();
  const [history, setHistory] = useState<RunRecord[]>([]);
  const adoptedRun = useRef('');
  const generation = useRef(0);
  const renderedPoses = useRef<Poses>({});
  const current = useRef({ scenario, evaluation, tick });
  current.current = { scenario, evaluation, tick };
  const totalTicks = evaluation?.trace.transitions.length ?? 0;
  const state = tickState(evaluation, scenario, tick);
  const poses: Poses = Object.fromEntries(
    scenario.robots.map((robot) => {
      const position = state.positions[robot.id];
      const next =
        evaluation?.trace.transitions[Math.floor(tick)]?.after.positions[robot.id] || position;
      const fraction = tick - Math.floor(tick);
      return [
        robot.id,
        [
          position[0] + (next[0] - position[0]) * fraction,
          position[1] + (next[1] - position[1]) * fraction,
        ],
      ];
    }),
  );
  const pushEvent = (message: string, kind = 'info') =>
    setEvents((old) => [...old, { at: new Date().toISOString(), message, kind }]);
  useEffect(() => {
    fetch('/api/status')
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then(setStatus)
      .catch(() => setStatus({ configured: false, model: '', agent: '' }));
  }, []);
  useEffect(() => {
    if (!sourceOpen && !helpOpen) return;
    const previousFocus = document.activeElement as HTMLElement | null;
    const dialog = document.querySelector<HTMLElement>('[role="dialog"]');
    dialog?.querySelector<HTMLElement>('button')?.focus();
    const keyboard = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setSourceOpen(false);
        setHelpOpen(false);
      }
      if (event.key !== 'Tab' || !dialog) return;
      const controls = Array.from(
        dialog.querySelectorAll<HTMLElement>('button:not(:disabled), textarea, [tabindex="0"]'),
      );
      const first = controls[0],
        last = controls[controls.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    };
    document.addEventListener('keydown', keyboard);
    return () => {
      document.removeEventListener('keydown', keyboard);
      previousFocus?.focus();
    };
  }, [sourceOpen, helpOpen]);
  useEffect(() => {
    window.fleetReplay = {
      load: (next, scene) => {
        generation.current++;
        if (scene) {
          setScenario(scene.scenario);
          setSceneSpec(scene);
        }
        setEvaluation(next);
        setPlaying(false);
        setTick(0);
      },
      advance: (next) => {
        const value = Math.max(
          0,
          Math.min(next, current.current.evaluation?.trace.transitions.length ?? 0),
        );
        setPlaying(false);
        setTick(value);
        current.current.tick = value;
      },
      getState: () => {
        const c = current.current;
        const snapshot = tickState(c.evaluation, c.scenario, c.tick);
        return {
          tick: c.tick,
          positions: snapshot.positions,
          visiblePositions: renderedPoses.current,
          carrying: snapshot.carrying,
          delivered: snapshot.delivered,
          scenarioId: c.scenario.id,
          totalTicks: c.evaluation?.trace.transitions.length ?? 0,
        };
      },
    };
    return () => {
      delete window.fleetReplay;
    };
  }, []);
  useEffect(() => {
    if (!playing || !evaluation) return;
    let previous = performance.now();
    let frame: number;
    const advance = (now: number) => {
      const delta = (Math.min(now - previous, 100) / 650) * speed;
      previous = now;
      setTick((old) => {
        if (old + delta >= totalTicks) {
          setPlaying(false);
          return totalTicks;
        }
        return old + delta;
      });
      frame = requestAnimationFrame(advance);
    };
    frame = requestAnimationFrame(advance);
    return () => cancelAnimationFrame(frame);
  }, [playing, evaluation, totalTicks, speed]);
  useEffect(() => {
    if (!run || ['completed', 'failed', 'cancelled', 'incomplete'].includes(run.status)) return;
    let alive = true;
    const token = generation.current;
    const poll = async () => {
      try {
        const response = await fetch(`/api/runs/${run.id}`);
        if (!response.ok) throw new Error('Could not retrieve agent run.');
        const next: AgentRun = await response.json();
        if (!alive || token !== generation.current) return;
        setRun(next);
      } catch (e) {
        if (alive) {
          setError(String(e));
          setBusy(false);
        }
      }
    };
    const timer = window.setInterval(poll, 1000);
    void poll();
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [run?.id, run?.status]);
  useEffect(() => {
    if (!run || !['completed', 'failed', 'cancelled', 'incomplete'].includes(run.status)) return;
    setBusy(false);
    if (run.error) setError(run.error);
    if (
      run.status !== 'completed' ||
      !run.evaluation ||
      !run.candidate ||
      adoptedRun.current === run.id
    )
      return;
    adoptedRun.current = run.id;
    setEvaluation(run.evaluation);
    setTick(0);
    setPlaying(true);
    setReferenceApplied(false);
    setSource(run.candidate.source);
    setScenario(run.scene.scenario);
    setSceneSpec(run.scene);
    setHistory((old) =>
      [
        {
          id: run.id,
          at: new Date().toISOString(),
          label: 'Managed Agent',
          scenario: run.scene.scenario,
          scene: run.scene,
          evaluation: run.evaluation!,
          baseline,
          source: run.candidate!.source,
          reference: false,
        },
        ...old,
      ].slice(0, 20),
    );
  }, [run]);
  const selectScenario = (next: Scenario) => {
    generation.current++;
    setScenario(next);
    setSceneSpec(undefined);
    setEvaluation(null);
    setBaseline(null);
    setTick(0);
    setPlaying(false);
    setBusy(false);
    setReferenceApplied(false);
    setSource(GREEDY_SOURCE);
    setEvents([]);
    setRun(null);
    setError('');
    setObstacleCount(0);
    setPlacing(false);
  };
  const simulate = async (kind: 'failure' | 'reference' | 'custom') => {
    const token = ++generation.current;
    setBusy(true);
    setPlacing(false);
    setError('');
    setPlaying(false);
    setRun(null);
    try {
      if (kind === 'failure') {
        setEvents([]);
        pushEvent('Running the seeded greedy controller in an isolated worker.');
        const result = await runController(GREEDY_SOURCE, scenario, 'seeded-greedy');
        if (token !== generation.current) return;
        setBaseline(result);
        setEvaluation(result);
        setSource(GREEDY_SOURCE);
        setReferenceApplied(false);
        pushEvent(result.report.summary, result.report.status === 'passed' ? 'success' : 'warning');
        setHistory((old) =>
          [
            {
              id: `local-${Date.now()}-${token}`,
              at: new Date().toISOString(),
              label: 'Seeded baseline',
              scenario,
              scene: sceneSpec,
              evaluation: result,
              baseline: result,
              source: GREEDY_SOURCE,
              reference: false,
            },
            ...old,
          ].slice(0, 20),
        );
      } else {
        setEvents([]);
        pushEvent(
          kind === 'reference'
            ? 'Loading the built-in cooperative reference controller.'
            : 'Executing your edited controller in an isolated worker.',
        );
        let before = baseline;
        if (!before) {
          pushEvent('Reproducing the seeded failure for an independent comparison.');
          before = await runController(GREEDY_SOURCE, scenario, 'seeded-greedy');
          if (token !== generation.current) return;
          setBaseline(before);
        }
        const nextSource = kind === 'reference' ? COOPERATIVE_SOURCE : source;
        const result = await runController(
          nextSource,
          scenario,
          kind === 'reference' ? 'local-cooperative' : 'edited-controller',
        );
        if (token !== generation.current) return;
        setSource(nextSource);
        setEvaluation(result);
        setReferenceApplied(kind === 'reference');
        pushEvent('Recomputed every transition against the trusted simulation rules.');
        pushEvent(result.report.summary, result.report.status === 'passed' ? 'success' : 'warning');
        setHistory((old) =>
          [
            {
              id: `local-${Date.now()}-${token}`,
              at: new Date().toISOString(),
              label: kind === 'reference' ? 'Local reference' : 'Edited controller',
              scenario,
              scene: sceneSpec,
              evaluation: result,
              baseline: before,
              source: nextSource,
              reference: kind === 'reference',
            },
            ...old,
          ].slice(0, 20),
        );
      }
      setTick(0);
      setPlaying(true);
    } catch (e) {
      if (token === generation.current) {
        setError(e instanceof Error ? e.message : String(e));
        pushEvent('Controller evaluation stopped. Inspect the error and source.', 'warning');
      }
    } finally {
      if (token === generation.current) setBusy(false);
    }
  };
  const startManaged = async (task: 'repair' | 'generate') => {
    if (!status.configured || obstacleCount > 0) return;
    generation.current++;
    setBusy(true);
    setPlacing(false);
    setError('');
    setEvents([]);
    setPlaying(false);
    setEvaluation(null);
    setReferenceApplied(false);
    try {
      const response = await fetch('/api/runs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scenarioId: scenario.id, task, request }),
      });
      const next = await response.json();
      if (!response.ok) throw new Error(next.error || 'Agent run could not start.');
      setRun(next);
      setRunPanel(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };
  const cancelManaged = async () => {
    if (!run) return;
    try {
      const response = await fetch(`/api/runs/${run.id}/cancel`, { method: 'POST' });
      if (!response.ok) throw new Error();
      setRun(await response.json());
    } catch {
      setError('Cancellation could not be confirmed.');
    }
  };
  const addObstacle = useCallback(
    (cell: [number, number]) => {
      if (busy) return;
      if (
        scenario.blocked.some((c) => c[0] === cell[0] && c[1] === cell[1]) ||
        scenario.robots.some((r) =>
          [r.start, r.pickup, r.dropoff].some((c) => c[0] === cell[0] && c[1] === cell[1]),
        )
      ) {
        setError('Choose an open aisle cell away from a robot, pickup, or delivery bay.');
        return;
      }
      try {
        const next = parseScenario({
          ...scenario,
          events: [...scenario.events, { tick: 4, type: 'block', cell }],
        });
        const feasibility = findFeasibleTrace(next, 25000);
        if (feasibility.status !== 'feasible') {
          setError(
            `Obstacle rejected: ${feasibility.status === 'infeasible' ? 'it makes the delivery mission infeasible' : 'feasibility could not be established within the search budget'}. The current scene is unchanged.`,
          );
          return;
        }
        generation.current++;
        setScenario(next);
        setSceneSpec(undefined);
        setObstacleCount((n) => n + 1);
        setEvaluation(null);
        setBaseline(null);
        setTick(0);
        setPlaying(false);
        setPlacing(false);
        setReferenceApplied(false);
        setRun(null);
        setError('');
        setEvents([
          {
            at: new Date().toISOString(),
            message: `Obstacle scheduled at cell ${cell.join(', ')} on tick 4. Feasibility independently established. Run a controller to test this scene.`,
            kind: 'info',
          },
        ]);
      } catch (e) {
        setError(
          `Obstacle rejected: ${e instanceof Error ? e.message : String(e)}. The current scene is unchanged.`,
        );
      }
    },
    [scenario, busy],
  );
  const verified = evaluation?.report.status === 'passed';
  const failure = evaluation && !verified;
  const verificationLabel = busy
    ? 'Evaluating…'
    : verified
      ? 'Verified'
      : failure
        ? 'Failure reproduced'
        : 'Ready to simulate';
  const shownEvents = run?.events?.length ? run.events : events;
  const passedChecks = evaluation?.report.checks.filter((check) => check.passed).length ?? 0;
  return (
    <div className="app-shell">
      <header className="topbar">
        <a className="brand" href="/" aria-label="FleetForge home">
          <span className="brand-mark">
            <Boxes size={21} strokeWidth={1.7} />
          </span>
          FleetForge<span className="beta">LAB</span>
        </a>
        <nav className="primary-nav" aria-label="Main navigation">
          <button className={!runPanel ? 'active' : ''} onClick={() => setRunPanel(false)}>
            <Layers3 size={15} />
            Workspace
          </button>
          <button className={runPanel ? 'active' : ''} onClick={() => setRunPanel(true)}>
            <Workflow size={15} />
            Run history{evaluation && <span className="nav-dot" />}
          </button>
        </nav>
        <div className="header-right">
          <span className="system-state">
            <span />
            Simulation engine online
          </span>
          <button
            className="icon-button help"
            aria-label="About this workspace"
            onClick={() => setHelpOpen(true)}
          >
            <CircleHelp size={18} />
          </button>
          <span className="avatar">FF</span>
        </div>
      </header>
      <div className="workspace-intro">
        <div>
          <div className="eyebrow">ROBOTICS / SIMULATION WORKSPACE</div>
          <h1>A proving ground for robot fleets.</h1>
          <p>Break a controller. Make a repair. Prove it in motion.</p>
        </div>
        <div className="intro-meta">
          <span className="version">
            <GitBranch size={13} /> fleetforge / sandbox
          </span>
          <span>
            Deterministic engine <span className="tiny-dot" /> v0.1.0
          </span>
        </div>
      </div>
      <main className="workspace">
        <aside className="mission-panel">
          <div className="panel-heading">
            <span>MISSION CONTROL</span>
            <span className="small-pill">{String(SCENARIOS.length).padStart(2, '0')}</span>
          </div>
          <div className="mission-list">
            {SCENARIOS.map((item, index) => (
              <button
                key={item.id}
                aria-label={`${String(index + 1).padStart(2, '0')} ${item.name} Mission`}
                className={`mission-item ${scenario.id === item.id ? 'selected' : ''}`}
                disabled={busy}
                onClick={() => selectScenario(item)}
              >
                <span className="mission-number">0{index + 1}</span>
                <span className="mission-copy">
                  <strong>{item.name}</strong>
                  <small>
                    {index === 0
                      ? 'Coordination'
                      : index === 1
                        ? 'Dynamic obstacles'
                        : 'In-aisle pickup'}
                  </small>
                </span>
                {scenario.id === item.id ? (
                  <span className="selected-dot" />
                ) : (
                  <ChevronRight size={14} />
                )}
              </button>
            ))}
          </div>
          <div className="mission-details">
            <div className="section-label">THE CHALLENGE</div>
            <p>{scenario.description}</p>
            <div className="detail-row">
              <span>Environment</span>
              <strong>8 × 8 warehouse</strong>
            </div>
            <div className="detail-row">
              <span>Fleet size</span>
              <strong>02 robots</strong>
            </div>
            <div className="detail-row">
              <span>Tick budget</span>
              <strong>{scenario.horizon} ticks</strong>
            </div>
            <div className="detail-row">
              <span>Obstacle events</span>
              <strong>{String(scenario.events.length).padStart(2, '0')}</strong>
            </div>
          </div>
          <div className="fleet-section">
            <div className="section-label">
              FLEET <span>02 ACTIVE</span>
            </div>
            {scenario.robots.map((robot, index) => (
              <div className="robot-card" key={robot.id}>
                <div className={`robot-icon robot-${index}`} style={{ color: robot.color }}>
                  <Box size={18} />
                </div>
                <div>
                  <strong>{prettyRobot(robot.id, index)}</strong>
                  <span>
                    {state.delivered[robot.id]
                      ? 'Delivery complete'
                      : state.carrying[robot.id]
                        ? 'Carrying payload'
                        : 'Awaiting pickup'}
                  </span>
                </div>
                <span
                  className={`robot-light robot-${index}`}
                  style={{ background: robot.color }}
                />
                <div className="robot-coordinates">
                  <span>
                    <ArrowUpRight size={12} />
                    {robot.pickup.join(', ')}
                  </span>
                  <span>
                    <ArrowDownLeft size={12} />
                    {robot.dropoff.join(', ')}
                  </span>
                </div>
              </div>
            ))}
          </div>
          <div className="sidebar-footer">
            <ShieldCheck size={16} />
            <span>
              Every move independently verified.
              <br />
              <small>Simulation only. Built for exploration.</small>
            </span>
          </div>
        </aside>
        <section className="center-panel" aria-label="Simulation workspace">
          <div className="stage-heading">
            <div className="stage-title">
              <span className="live-dot" />
              <h2>{scenario.name}</h2>
              <span className="environment-tag">WAREHOUSE 01</span>
            </div>
            <button
              className="icon-button"
              aria-label="Reset camera"
              onClick={() => setCamera('orbit')}
            >
              <Expand size={15} />
            </button>
          </div>
          <div className="stage-wrap">
            {runPanel && (
              <section className="history-panel" aria-label="Run history">
                <div>
                  <span>
                    <Workflow size={15} />
                    RUN HISTORY <small>THIS SESSION</small>
                  </span>
                  <button
                    className="icon-button"
                    aria-label="Close run history"
                    onClick={() => setRunPanel(false)}
                  >
                    <X size={16} />
                  </button>
                </div>
                {history.length ? (
                  history.map((item) => (
                    <button
                      className="history-row"
                      disabled={busy}
                      key={item.id}
                      onClick={() => {
                        generation.current++;
                        setScenario(item.scenario);
                        setSceneSpec(item.scene);
                        setEvaluation(item.evaluation);
                        setBaseline(item.baseline);
                        setSource(item.source);
                        setReferenceApplied(item.reference);
                        setTick(0);
                        setPlaying(false);
                        setRun(null);
                        setRunPanel(false);
                        setEvents([
                          {
                            at: new Date().toISOString(),
                            message: `Loaded recorded ${item.label.toLowerCase()} run. ${item.evaluation.report.summary}`,
                            kind: 'info',
                          },
                        ]);
                      }}
                    >
                      <span
                        className={
                          item.evaluation.report.status === 'passed'
                            ? 'history-passed'
                            : 'history-failed'
                        }
                      >
                        {item.evaluation.report.status === 'passed' ? (
                          <ShieldCheck size={17} />
                        ) : (
                          <TriangleAlert size={17} />
                        )}
                      </span>
                      <span>
                        <strong>{item.scenario.name}</strong>
                        <small>
                          {item.label} · {item.evaluation.report.ticks} ticks ·{' '}
                          {item.evaluation.report.delivered}/{item.evaluation.report.total}{' '}
                          deliveries
                        </small>
                      </span>
                      <time>
                        {new Date(item.at).toLocaleTimeString([], {
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </time>
                      <ChevronRight size={13} />
                    </button>
                  ))
                ) : (
                  <div className="history-empty">
                    <Terminal size={23} />
                    <strong>No recorded runs yet.</strong>
                    <p>
                      Reproduce a failure or evaluate a controller.
                      <br />
                      Its measured outcome and replay will appear here.
                    </p>
                  </div>
                )}
              </section>
            )}
            <Warehouse
              scenario={scenario}
              state={state}
              poses={poses}
              evaluation={evaluation}
              sceneSpec={sceneSpec}
              onRenderedPositions={(positions) => {
                renderedPoses.current = positions;
              }}
              camera={camera}
              routes={routes}
              onCell={addObstacle}
              placing={placing}
            />
            <div className="stage-topline">
              <span className={`stage-status ${verified ? 'good' : failure ? 'warning' : ''}`}>
                <span />
                {verified ? 'VERIFIED REPLAY' : failure ? 'FAULT REPLAY' : 'SIMULATION READY'}
              </span>
              <span className="stage-tick">
                TICK <strong>{String(Math.floor(tick)).padStart(3, '0')}</strong> /{' '}
                {String(totalTicks || scenario.horizon).padStart(3, '0')}
              </span>
            </div>
            <div className="view-controls">
              <button
                className={camera === 'orbit' ? 'active' : ''}
                aria-label="Orbit camera"
                onClick={() => setCamera('orbit')}
              >
                <Boxes size={14} />
                Orbit
              </button>
              <button
                className={camera === 'top' ? 'active' : ''}
                aria-label="Top camera"
                onClick={() => setCamera('top')}
              >
                <Map size={14} />
                Top
              </button>
            </div>
            <div className="scene-tools">
              <button
                className={routes ? 'active' : ''}
                aria-label="Toggle route overlays"
                title="Toggle route overlays"
                onClick={() => setRoutes((v) => !v)}
              >
                <GitBranch size={16} />
              </button>
              <button
                className={placing ? 'active' : ''}
                aria-label="Add obstacle"
                title="Add obstacle at tick 4"
                onClick={() => setPlacing((v) => !v)}
                disabled={busy}
              >
                <Plus size={17} />
              </button>
            </div>
            {placing && (
              <div className="placement-notice">
                <MousePointer2 size={14} />
                Click an open aisle to schedule an obstacle
                <button aria-label="Cancel obstacle placement" onClick={() => setPlacing(false)}>
                  <X size={14} />
                </button>
              </div>
            )}
            <div className="stage-bottom">
              <span className="legend">
                <i className="teal" style={{ background: scenario.robots[0].color }} />
                {prettyRobot(scenario.robots[0].id, 0)}
                <i className="orange" style={{ background: scenario.robots[1].color }} />
                {prettyRobot(scenario.robots[1].id, 1)}
                <i className="dock-key" />
                Dock
              </span>
              <span className="camera-hint">
                <MousePointer2 size={11} /> Drag to orbit · Scroll to zoom
              </span>
            </div>
            <div className="axis">
              <span>Y</span>
              <i />
              <b>X</b>
              <em>Z</em>
            </div>
          </div>
          <div className="playback">
            <button
              className="icon-button reset"
              aria-label="Restart replay"
              disabled={!evaluation}
              onClick={() => {
                setTick(0);
                setPlaying(false);
              }}
            >
              <RotateCcw size={15} />
            </button>
            <button
              className="play-button"
              aria-label={playing ? 'Pause replay' : 'Play replay'}
              disabled={!evaluation}
              onClick={() => {
                if (tick >= totalTicks) setTick(0);
                setPlaying((v) => !v);
              }}
            >
              {playing ? (
                <Pause size={15} fill="currentColor" />
              ) : (
                <Play size={15} fill="currentColor" />
              )}
            </button>
            <span className="playback-time">
              {String(Math.floor(tick)).padStart(3, '0')}
              <span> / {String(totalTicks).padStart(3, '0')}</span>
            </span>
            <input
              aria-label="Replay tick"
              type="range"
              min="0"
              max={totalTicks || 1}
              step="0.01"
              value={tick}
              disabled={!evaluation}
              onChange={(e) => {
                setPlaying(false);
                setTick(Number(e.target.value));
              }}
              style={
                {
                  '--progress': `${totalTicks ? (tick / totalTicks) * 100 : 0}%`,
                } as React.CSSProperties
              }
            />
            <button
              className="speed-button"
              aria-label="Playback speed"
              onClick={() => setSpeed((v) => (v === 1 ? 2 : v === 2 ? 0.5 : 1))}
            >
              {speed}×<ChevronDown size={12} />
            </button>
          </div>
          <div className="evidence-heading">
            <span>
              <Activity size={14} />
              VERIFICATION EVIDENCE
            </span>
            <span>Trusted engine · canonical trace</span>
          </div>
          <div className="evidence-grid">
            <div>
              <span className="metric-label">DELIVERIES</span>
              <strong data-testid="delivery-count">
                {evaluation
                  ? `${evaluation.report.delivered} / ${evaluation.report.total}`
                  : '— / 2'}
                <Box size={17} />
              </strong>
              <small>
                {verified
                  ? 'All payloads delivered'
                  : evaluation
                    ? 'Incomplete mission'
                    : 'Waiting for a run'}
              </small>
            </div>
            <div>
              <span className="metric-label">COMPLETION</span>
              <strong>
                {evaluation ? evaluation.report.ticks : '—'}
                <em>ticks</em>
              </strong>
              <small>
                {baseline && verified
                  ? `${baseline.report.ticks} ticks in baseline`
                  : '120 tick maximum'}
              </small>
            </div>
            <div>
              <span className="metric-label">ILLEGAL MOVES</span>
              <strong className={evaluation?.report.illegalMoves ? 'orange-text' : ''}>
                {evaluation ? evaluation.report.illegalMoves : '—'}
                <ShieldCheck size={17} />
              </strong>
              <small>{evaluation ? 'Recomputed from trace' : 'No unverified claims'}</small>
            </div>
            <div>
              <span className="metric-label">RULE CHECKS</span>
              <strong>
                {evaluation ? `${passedChecks} / ${evaluation.report.checks.length}` : '—'}
                <CheckCheck size={17} />
              </strong>
              <small>{evaluation ? 'Independent verification' : 'Run to collect evidence'}</small>
            </div>
          </div>
          <div className="comparison">
            <div className="comparison-icon">
              <GitBranch size={16} />
            </div>
            <div>
              <strong>
                {verified
                  ? 'A working fleet. The evidence to back it.'
                  : failure
                    ? 'A small conflict. A fleet-wide standstill.'
                    : 'The smallest fleet. The hardest shared aisle.'}
              </strong>
              <p>
                {verified
                  ? `${baseline ? `Baseline ${baseline.report.delivered}/${baseline.report.total} → candidate ${evaluation.report.delivered}/${evaluation.report.total}. ` : ''}${evaluation.report.illegalMoves} illegal moves. ${evaluation.report.ticks} ticks. Independently verified.`
                  : failure
                    ? evaluation.report.summary
                    : 'Two robots, one shared environment. See where a greedy controller breaks.'}
              </p>
            </div>
            {verified ? (
              <span className="comparison-badge">
                <Check size={12} /> VERIFIED
              </span>
            ) : (
              <span className="comparison-badge neutral">
                {evaluation ? 'NEEDS REPAIR' : 'READY TO TEST'}
              </span>
            )}
          </div>
        </section>
        <aside className="engine-panel">
          <div className="panel-heading">
            <span>CONTROLLER LAB</span>
            <Terminal size={14} />
          </div>
          <div className="mode-label">EXECUTION MODE</div>
          <div className="mode-picker">
            <button className={mode === 'local' ? 'active' : ''} onClick={() => setMode('local')}>
              Local reference
            </button>
            <button
              className={mode === 'managed' ? 'active' : ''}
              onClick={() => setMode('managed')}
            >
              <Zap size={11} />
              Managed agent
            </button>
          </div>
          {mode === 'local' ? (
            <div className="mode-description">
              <span className="mode-dot" />
              Built-in reference controllers.
              <br />
              <span>No API key required. Runs in your browser.</span>
            </div>
          ) : (
            <div className={`mode-description ${!status.configured ? 'offline' : ''}`}>
              <span className="mode-dot" />
              {status.configured
                ? 'Gemini Managed Agent configured.'
                : 'Managed Agent not configured.'}
              <br />
              <span>
                {obstacleCount > 0
                  ? 'Reset the mission to use its registered managed scene.'
                  : status.configured
                    ? status.model
                    : 'Set GEMINI_API_KEY to enable agent runs.'}
              </span>
            </div>
          )}
          <div className="experiment-flow">
            <div className="flow-step">
              <span className={`step-number ${evaluation ? 'done' : ''}`}>
                {evaluation ? <Check size={12} /> : '1'}
              </span>
              <div>
                <strong>Reproduce the failure</strong>
                <p>A greedy route meets a shared aisle.</p>
              </div>
            </div>
            <button
              className="secondary-button"
              aria-label="Reproduce failure"
              onClick={() => void simulate('failure')}
              disabled={busy}
            >
              {busy && !referenceApplied ? (
                <LoaderCircle size={14} className="spin" />
              ) : (
                <Play size={13} />
              )}
              Reproduce failure
              <ArrowRight size={14} />
            </button>
            <div className="flow-connector" />
            <div className="flow-step">
              <span className={`step-number ${verified ? 'done' : ''}`}>
                {verified ? <Check size={12} /> : '2'}
              </span>
              <div>
                <strong>
                  {mode === 'local' ? 'Repair the coordination' : 'Let the agent repair it'}
                </strong>
                <p>
                  {mode === 'local'
                    ? 'Try a cooperative planning strategy.'
                    : 'Source, simulation, feedback, revision.'}
                </p>
              </div>
            </div>
            {mode === 'managed' && (
              <textarea
                className="agent-request"
                aria-label="Agent instructions"
                maxLength={4000}
                placeholder="Optional: give the agent a constraint…"
                value={request}
                onChange={(e) => setRequest(e.target.value)}
              />
            )}
            <button
              className="primary-button"
              aria-label={mode === 'local' ? 'Apply local repair' : 'Repair with Managed Agent'}
              disabled={busy || (mode === 'managed' && (!status.configured || obstacleCount > 0))}
              onClick={() =>
                void (mode === 'local' ? simulate('reference') : startManaged('repair'))
              }
            >
              {busy ? (
                <LoaderCircle size={15} className="spin" />
              ) : mode === 'local' ? (
                <Workflow size={15} />
              ) : (
                <Zap size={15} />
              )}
              {busy
                ? 'Evaluating controller…'
                : mode === 'local'
                  ? 'Apply local repair'
                  : 'Repair with Managed Agent'}
              {!busy && <ArrowRight size={15} />}
            </button>
            {mode === 'managed' && (
              <button
                className="text-button generate"
                disabled={busy || !status.configured || obstacleCount > 0}
                onClick={() => void startManaged('generate')}
              >
                <Plus size={12} /> Generate a candidate scene
              </button>
            )}
            <div className="flow-connector" />
            <div className="flow-step">
              <span className={`step-number ${verified ? 'done' : ''}`}>
                {verified ? <Check size={12} /> : '3'}
              </span>
              <div>
                <strong>Verify every move</strong>
                <p>Independent checks. Visible proof.</p>
              </div>
            </div>
          </div>
          <div className={`verification-box ${verified ? 'passed' : failure ? 'failed' : ''}`}>
            <div>
              {busy ? (
                <LoaderCircle size={17} className="spin" />
              ) : verified ? (
                <ShieldCheck size={18} />
              ) : failure ? (
                <TriangleAlert size={18} />
              ) : (
                <ScanLine size={18} />
              )}
              <strong data-testid="verification-status">{verificationLabel}</strong>
            </div>
            <p>
              {verified
                ? `${passedChecks} rule checks passed. Canonical replay ready.`
                : failure
                  ? `${evaluation.report.delivered} of ${evaluation.report.total} deliveries completed.`
                  : 'Run a controller to inspect its behavior.'}
            </p>
          </div>
          <button
            className="source-button"
            aria-label="View source"
            onClick={() => {
              setSourceOpen(true);
              setSourceTab('candidate');
            }}
          >
            <Code2 size={16} />
            <span>
              View source
              <small>{referenceApplied ? 'cooperative-controller.js' : 'controller.js'}</small>
            </span>
            <ArrowUpRight size={14} />
          </button>
          <div className="run-log">
            <div className="section-label">
              {runPanel ? 'RUN HISTORY' : 'ACTIVITY'}
              <span>
                {shownEvents.length
                  ? `${String(shownEvents.length).padStart(2, '0')} EVENTS`
                  : 'LIVE'}
              </span>
            </div>
            {!shownEvents.length ? (
              <div className="empty-log">
                <div className="terminal-line">
                  <span>❯</span> workspace initialized
                  <span className="cursor" />
                </div>
                <p>
                  Your run events appear here.
                  <br />
                  Start with a reproducible failure.
                </p>
              </div>
            ) : (
              <ol>
                {shownEvents.map((event, index) => (
                  <li key={`${event.at}-${index}`} className={event.kind}>
                    <span className="log-dot">
                      {event.kind === 'success' ? (
                        <Check size={9} />
                      ) : (
                        <Circle size={5} fill="currentColor" />
                      )}
                    </span>
                    <p>{event.message}</p>
                    <time>
                      {new Date(event.at).toLocaleTimeString([], {
                        hour: '2-digit',
                        minute: '2-digit',
                        hour12: false,
                      })}
                    </time>
                  </li>
                ))}
              </ol>
            )}
            {run && (
              <div className="run-identifiers">
                <span>
                  Run <code>{run.id}</code>
                </span>
                {run.interactionId && (
                  <span>
                    Interaction <code>{run.interactionId}</code>
                  </span>
                )}
                {run.environmentId && (
                  <span>
                    Environment <code>{run.environmentId}</code>
                  </span>
                )}
                {busy && (
                  <button className="text-button" onClick={() => void cancelManaged()}>
                    <Square size={10} />
                    Cancel run
                  </button>
                )}
              </div>
            )}
          </div>
          {error && (
            <div className="error-message" role="alert">
              <TriangleAlert size={14} />
              <p>{error}</p>
              <button onClick={() => setError('')} aria-label="Dismiss error">
                <X size={12} />
              </button>
            </div>
          )}
          <div className="engine-footer">
            <span className="tiny-dot" />
            {mode === 'local'
              ? 'LOCAL EXECUTION'
              : status.configured
                ? 'MANAGED EXECUTION'
                : 'AGENT OFFLINE'}
            <span>v0.1</span>
          </div>
        </aside>
      </main>
      <footer className="page-footer">
        <span>
          <Boxes size={13} />
          Built for the moments between “it runs” and “it works.”
        </span>
        <span>
          Original simulation <i>·</i> Reproducible by design
        </span>
      </footer>
      {sourceOpen && (
        <div
          className="modal-backdrop"
          onClick={(e) => {
            if (e.target === e.currentTarget) setSourceOpen(false);
          }}
        >
          <section
            role="dialog"
            aria-modal="true"
            aria-label="Controller source"
            className="source-modal"
          >
            <div className="modal-heading">
              <div>
                <Code2 size={20} />
                <span>
                  <strong>Controller source</strong>
                  <small>Real JavaScript, evaluated in an isolated worker.</small>
                </span>
              </div>
              <button
                className="icon-button"
                aria-label="Close source"
                onClick={() => setSourceOpen(false)}
              >
                <X size={18} />
              </button>
            </div>
            <div className="source-tabs">
              <button
                className={sourceTab === 'candidate' ? 'active' : ''}
                onClick={() => setSourceTab('candidate')}
              >
                Current candidate
              </button>
              <button
                className={sourceTab === 'baseline' ? 'active' : ''}
                onClick={() => setSourceTab('baseline')}
              >
                Seeded baseline
              </button>
              <span>
                {sourceTab === 'baseline'
                  ? 'SEEDED FAULT'
                  : referenceApplied
                    ? 'BUILT-IN REFERENCE'
                    : run?.candidate?.provenance === 'gemini-managed'
                      ? 'GEMINI MANAGED'
                      : 'LOCAL CONTROLLER'}
              </span>
            </div>
            <textarea
              spellCheck={false}
              aria-label="Controller JavaScript"
              value={sourceTab === 'baseline' ? GREEDY_SOURCE : source}
              readOnly={sourceTab === 'baseline'}
              onChange={(e) => {
                setSource(e.target.value);
                setReferenceApplied(false);
              }}
            />
            <div className="source-modal-footer">
              <button
                className="secondary-button"
                onClick={() => {
                  void navigator.clipboard
                    .writeText(sourceTab === 'baseline' ? GREEDY_SOURCE : source)
                    .then(() => {
                      setCopied(true);
                      setTimeout(() => setCopied(false), 1500);
                    });
                }}
              >
                <Copy size={13} />
                {copied ? 'Copied' : 'Copy source'}
              </button>
              <button
                className="primary-button"
                disabled={busy || sourceTab === 'baseline'}
                onClick={() => {
                  setSourceOpen(false);
                  void simulate('custom');
                }}
              >
                <Play size={13} />
                Evaluate source
                <ArrowRight size={14} />
              </button>
            </div>
          </section>
        </div>
      )}
      {helpOpen && (
        <div className="modal-backdrop">
          <section
            className="help-modal"
            role="dialog"
            aria-modal="true"
            aria-label="About FleetForge"
          >
            <button
              className="icon-button close-help"
              aria-label="Close help"
              onClick={() => setHelpOpen(false)}
            >
              <X size={18} />
            </button>
            <span className="brand-mark">
              <Boxes size={25} />
            </span>
            <h2>
              A proving ground.
              <br />
              For the whole fleet.
            </h2>
            <p>
              FleetForge runs two robot controllers against a deterministic warehouse simulation.
              Every recorded move is independently checked for collisions, obstacles, and completed
              deliveries.
            </p>
            <p>
              Local reference mode uses a human-authored planner. Managed Agent mode requires a
              configured server API key and shows actual run events and generated source.
            </p>
            <div>
              <ShieldCheck size={16} />
              This is an experimental simulation, not a real robot safety system.
            </div>
            <button className="primary-button" onClick={() => setHelpOpen(false)}>
              Back to the workspace
              <ArrowRight size={14} />
            </button>
          </section>
        </div>
      )}
    </div>
  );
}
export default App;
