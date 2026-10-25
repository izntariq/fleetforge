import { chromium, type Browser } from '@playwright/test';
import { initialState, step } from '../src/core/engine';
import type { Evaluation, Observation, Scenario, SceneSpec, Trace } from '../src/core/types';
import { verifyTrace } from '../src/verify/trace';
import { validateControllerSource, validateDecision } from '../src/controller/validation';
import { SANDBOX_HTML } from '../src/controller/sandbox';

async function launch(): Promise<Browser> {
  return chromium.launch({
    channel: process.platform === 'darwin' ? 'chrome' : undefined,
    headless: true,
  });
}

/** Candidate JavaScript executes only inside a browser Worker. Node replays its moves. */
export async function evaluateSource(
  source: string,
  scenario: Scenario,
  candidateId: string,
): Promise<Evaluation> {
  validateControllerSource(source);
  const browser = await launch();
  const context = await browser.newContext();
  let world = initialState(scenario);
  const trace: Trace = {
    scenarioId: scenario.id,
    candidateId,
    initial: structuredClone(world),
    transitions: [],
  };
  try {
    const page = await context.newPage();
    await page.setContent(SANDBOX_HTML);
    await page.evaluate(
      (source) =>
        (
          window as unknown as { fleetSandbox: { init: (source: string) => void } }
        ).fleetSandbox.init(source),
      source,
    );
    let state: unknown = null;
    while (world.tick < scenario.horizon && !Object.values(world.delivered).every(Boolean)) {
      const observation: Observation = {
        ...structuredClone(world),
        scenario: structuredClone(scenario),
      };
      const raw = await page.evaluate(
        ({ observation, state }) =>
          (
            window as unknown as {
              fleetSandbox: {
                decide: (observation: Observation, state: unknown) => Promise<unknown>;
              };
            }
          ).fleetSandbox.decide(observation, state),
        { observation, state },
      );
      const decision = validateDecision(
        raw,
        scenario.robots.map((robot) => robot.id),
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
    await context.close();
    await browser.close();
  }
  return { trace, report: verifyTrace(scenario, trace) };
}

export async function renderEvaluation(
  evaluation: Evaluation,
  scene: SceneSpec,
): Promise<{ mimeType: string; data: string }> {
  const browser = await launch();
  try {
    const page = await browser.newPage({
      viewport: { width: 1440, height: 1000 },
      deviceScaleFactor: 1,
    });
    await page.goto(process.env.FLEETFORGE_WEB_URL ?? 'http://127.0.0.1:5173', {
      waitUntil: 'networkidle',
    });
    await page.waitForFunction(
      () => Boolean((window as unknown as { fleetReplay?: unknown }).fleetReplay),
      { timeout: 15000 },
    );
    await page.evaluate(
      ({ evaluation, scene }) => {
        const bridge = (
          window as unknown as {
            fleetReplay: {
              load: (evaluation: Evaluation, scene: SceneSpec) => void;
              advance: (tick: number) => void;
            };
          }
        ).fleetReplay;
        bridge.load(evaluation, scene);
      },
      { evaluation, scene },
    );
    await page.waitForTimeout(300);
    await page.evaluate(
      (tick) =>
        (
          window as unknown as { fleetReplay: { advance: (tick: number) => void } }
        ).fleetReplay.advance(tick),
      evaluation.report.deadlockTick ?? evaluation.report.ticks,
    );
    await page.waitForTimeout(500);
    const screenshot = await page.screenshot({ type: 'png' });
    return { mimeType: 'image/png', data: screenshot.toString('base64') };
  } finally {
    await browser.close();
  }
}
