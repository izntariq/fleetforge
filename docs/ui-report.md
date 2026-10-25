# FleetForge interface delivery

Implemented a responsive graphite workspace with a dominant, original Three.js warehouse. The scene uses actual fixture geometry, low storage racks, procedural concrete grain, dock markings, AGV chassis/wheels/sensors/payloads, shadows, robot labels, exact recorded route overlays, and supported SceneSpec palette/decorations. Cameras support orbit dragging, scroll zoom, and a top view.

The local workflow runs actual seeded and cooperative controller source through the isolated browser runner. It shows independent verification evidence and retains replayable session history. Source can be inspected, edited, copied, and re-evaluated. Local mode explicitly identifies the built-in reference and never labels the reference as an agent result.

Replay uses canonical states and interpolates only the visual position between adjacent recorded ticks. `window.fleetReplay.load(evaluation, scene?)`, `.advance(tick)` and `.getState()` expose the replay for rendered feedback and browser acceptance checks. `visiblePositions` is read from the actual Three.js AGV mesh groups after rendering. Consumers should wait two animation frames after loading or advancing before capturing/checking visible positions.

Obstacle placement accepts a clicked initially traversable aisle cell away from mission endpoints. It validates the full candidate with `parseScenario` and independently checks bounded feasibility before committing the scene. Invalid, duplicate, over-budget, or infeasible edits preserve the old scene. A supported event closes that cell at tick 4 once vacant. Changing a fixture resets stale evidence and pending local results are rejected by generation token.

Managed mode reads actual server capability status, starts/polls real jobs, shows real event records and interaction/environment IDs, adopts evaluations only on the accepted `completed` state, and applies each completed run once. Cancellation displays the real returned state instead of assuming success. Failed, incomplete, and cancelled states clear the busy UI; provisional evaluations never appear as verified repairs. Managed runs are disabled without configured credentials and for locally edited scenes that differ from registered fixtures.

## Verification

- Browser user-flow tests were authored first in `tests/browser/app.spec.ts`.
- The initial test command could not execute because Playwright dependencies had not yet installed.
- Fresh `npm run build` passed TypeScript and Vite. Vite reports a bundle-size advisory because Three.js is included.
- Fresh `npm test` passed 59 tests in 9 files.
- Browser tests and visual screenshot inspection were not executed after the parent reported that automatic review denied browser-origin access. No alternate browser path was attempted. Visual quality, WebGL rendering, actual browser sandbox execution, keyboard flows, and layout remain pending browser validation.
- No live Managed API execution was performed by this UI task.

Browser acceptance coverage is ready for the actual failure → local repair → verification → source flow; scrubbed mesh positions versus canonical positions; stale mission evidence reset; and the explicit no-key Managed state. The source dialog supports keyboard trapping, Escape, and focus restoration. Responsive CSS supports phone, tablet, and desktop sizes without font-network dependencies.
