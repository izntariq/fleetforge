# Agent prompts

`engineer.md` and `repair.md` are actual runtime templates loaded by `server/prompts.ts`. The server appends an authoritative scene, frozen hash, run ID, controller contract, attempt budget and allowed tool list. The Managed Agent returns standalone JavaScript through application tools; the server records immutable source and independently computes acceptance.

`adversary.md` and `demo.md` are preparation templates for a future independent scenario-search run and pitch preparation. They are not automatically launched by the application. Do not present them as completed managed runs.

Run sequence:

1. Select a public scenario and reproduce the seeded fault locally.
2. Configure the server key, select Managed Agent mode, and request a repair.
3. Retain actual IDs, failing report, returned source and rendered images.
4. Accept only the runner's completed, independently verified result.
5. Execute a separate generation task and retain its scene and image critique for the Track 2 demonstration.
