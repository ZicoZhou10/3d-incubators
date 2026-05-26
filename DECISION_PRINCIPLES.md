# Decision Principles · 3D Incubators

> **Why this file exists:** Trade-offs are distributed. When you hit one, look here before asking anyone. If two principles conflict in your situation, the higher-numbered one wins. If none apply, write down the new principle you needed and we'll discuss.

Version 0.1 · 2026-05-21 · Subject to revision after each demo ships.

---

## 1. Cut > Carry
If something is not 10× better than the next-best alternative, kill it. "Almost good enough" is technical debt with PR. We ship fewer, sharper things on purpose.

## 2. Reaction Speed > Feature Surface
Time-to-feedback is the metric, not feature count. Prefer one feature that ships today over three that ship next week. If a feature can't be felt in <60 seconds of use, it's too deep.

## 3. Single Atomic Win per Demo
Each demo points at exactly one piece of inspiration. "What new pattern does this unlock?" → one sentence. If the answer needs a comma, split the demo.

## 4. Public by Default
Repos public. Notes public. Decisions public. The cost of being seen mid-mistake is lower than the cost of working in private. Private only for: in-flight API keys, partner-specific assets, unannounced launches.

## 5. Coding Agent is a Teammate, not a Tool
We dogfood agentic dev because we expect our users to. If a workflow we built can't be driven by Claude Code / Cursor from a fresh checkout in <30 min, we have a docs bug, not a feature gap.

## 6. Self-Use Tax
Before shipping anything, we use it ourselves at least once for a real purpose. If we won't use it, the demo is performative.

## 7. Memos > Meetings; Both < Demos
A demo running in a browser settles arguments. A 1-page memo settles directions. A meeting is the last resort, and it produces a memo or it didn't happen.

## 8. External Clock Always On
We always owe the public something dated: a demo this week, a writeup this month. Without an external clock the work calibrates to our own comfort, not user need.

## 9. Don't Compete with Aholo Studio
Studio is the commercial product. We are the lighthouse incubator. If a proposal looks like "Studio but better/different," it belongs in Studio, not here. Our purpose is to **open a new category**, not to win an existing one.

## 10. Errors are Curriculum
Every shipping cycle produces a list of "what surprised us." That list updates this file. Principles that survive 3 cycles become permanent; principles that get bypassed twice get retired.

## 11. Friction in the template costs N×
Anything that wasted 2 minutes building Demo 1 will waste 2N minutes building Demo N. When a friction point surfaces in a demo, **fix it upstream first** — in `template/`, in `scripts/new-demo.mjs`, in `packages/*`, or in the SDK contract — and only then in the current demo. Discovered while bootstrapping (`tsconfig.json` relative path, esbuild target, top-level await).

## 12. Verify against the artifact, not a proxy metric
"Did it render?" is answered by looking at the pixels — a screenshot — not by reading a stats counter. A proxy metric is a hypothesis about reality, not reality. Before blaming a dependency, reproduce it working in isolation (its own example/playground). Discovered the hard way: a blank-viewport bug was misdiagnosed for days by trusting `renderInfo.calls === 0`, and nearly escalated to another team — it was our own code. See `demos/prompt-to-object/RENDER_BUG_POSTMORTEM.md`.

**12.1 — Verify against the most complete original artifact, not a slice of it.** The same trap repeated one day later: we inspected only the GLB file (one slice of the Lux3D output) and concluded "no textures." The actual artifact was the ZIP — which contained the GLB *plus* 9 PBR PNGs the GLB never references. The textures were always there. Rule: when an artifact has obvious context (a container, a sibling file, an upstream ZIP, an HTTP envelope), inspect the container before judging the slice.

---

## Operating Cadence

| Cadence | Activity |
|---|---|
| Daily | Ship at least one visible thing — commit, demo, writeup, tweet |
| Weekly | Friday demo, 15 min, no slides, live in browser |
| Monthly | Kill one project. Double down on one. Write what we learned. |
| Quarterly | Publish a "Field Manual" issue — what we know now that we didn't 3 months ago |

---

## What This File is NOT

- Not a process document
- Not exhaustive
- Not stable — expect revision every demo
- Not a substitute for taste — taste is judged, not encoded
