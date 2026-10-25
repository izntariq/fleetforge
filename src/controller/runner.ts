import { initialState, step } from '../core/engine';
import type { Decision, Evaluation, Observation, Scenario, Trace } from '../core/types';
import { verifyTrace } from '../verify/trace';
import { SANDBOX_HTML } from './sandbox';
import { validateControllerSource, validateDecision } from './validation';

type SandboxCall = (method: 'init' | 'decide' | 'close', ...args: unknown[]) => Promise<unknown>;

async function createSandbox(): Promise<{ call: SandboxCall; close: () => void }> {
  const iframe = document.createElement('iframe');
  iframe.hidden = true;
  iframe.setAttribute('sandbox', 'allow-scripts');
  iframe.setAttribute('aria-hidden', 'true');
  iframe.title = 'Isolated robot controller';
  const pending = new Map<
    number,
    {
      resolve: (value: unknown) => void;
      reject: (error: Error) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();
  let seq = 0;
  let onReady: () => void;
  const ready = new Promise<void>((resolve) => {
    onReady = resolve;
  });
  const listener = (event: MessageEvent) => {
    if (event.source !== iframe.contentWindow || event.data?.channel !== 'fleetforge') return;
    if (event.data.ready) {
      onReady();
      return;
    }
    const task = pending.get(event.data.id);
    if (!task) return;
    pending.delete(event.data.id);
    clearTimeout(task.timer);
    if (event.data.error) task.reject(new Error(String(event.data.error)));
    else task.resolve(event.data.result);
  };
  window.addEventListener('message', listener);
  iframe.srcdoc = SANDBOX_HTML;
  document.body.append(iframe);
  const close = () => {
    iframe.contentWindow?.postMessage(
      { channel: 'fleetforge', id: ++seq, method: 'close', args: [] },
      '*',
    );
    window.removeEventListener('message', listener);
    iframe.remove();
    for (const task of pending.values()) {
      clearTimeout(task.timer);
      task.reject(new Error('Sandbox closed'));
    }
    pending.clear();
  };
  try {
    await Promise.race([
      ready,
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Sandbox did not initialize')), 3000),
      ),
    ]);
  } catch (error) {
    close();
    throw error;
  }
  const call: SandboxCall = (method, ...args) =>
    new Promise((resolve, reject) => {
      const id = ++seq;
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error('Controller sandbox timed out'));
      }, 1800);
      pending.set(id, { resolve, reject, timer });
      iframe.contentWindow?.postMessage({ channel: 'fleetforge', id, method, args }, '*');
    });
  return { call, close };
}

export async function runController(
  source: string,
  scenario: Scenario,
  candidateId: string,
): Promise<Evaluation> {
  validateControllerSource(source);
  let world = initialState(scenario);
  const trace: Trace = {
    scenarioId: scenario.id,
    candidateId,
    initial: structuredClone(world),
    transitions: [],
  };
  const sandbox = await createSandbox();
  try {
    await sandbox.call('init', source);
    let state: unknown = null;
    while (world.tick < scenario.horizon && !Object.values(world.delivered).every(Boolean)) {
      const observation: Observation = {
        ...structuredClone(world),
        scenario: structuredClone(scenario),
      };
      const decision: Decision = validateDecision(
        await sandbox.call('decide', observation, state),
        scenario.robots.map((r) => r.id),
      );
      state = decision.state;
      const transition = step(scenario, world, decision.moves);
      trace.transitions.push(transition);
      world = transition.after;
      if (!transition.valid) break;
    }
  } catch (error) {
    trace.controllerError = error instanceof Error ? error.message : String(error);
  } finally {
    sandbox.close();
  }
  return { trace, report: verifyTrace(scenario, trace) };
}
