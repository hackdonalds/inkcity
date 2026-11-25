# Inkcity — style prototype (milestones 1–3)

Procedural storybook towers rendered as ink + watercolor (Three.js, custom G-buffer + compose pass).

```
npm install
npm run dev
```

## Playing

| Tool | Key | Click |
|---|---|---|
| Look | 1 | orbit / zoom / pan only |
| Build | 2 | ground → found a building · building → add a floor · Shift-click → remove top floor |
| Bridge | 3 | click one building, then another |
| Demolish | 4 | pull a building down |
| Undo | Ctrl+Z | |

"Generate town" builds a procedural settlement you can keep editing; "Empty site" starts from bare ground (`?empty=1`).
Each building is a small spec (seed, position, block count); blocks are seeded by index so growing a tower never changes the floors below.

URL params: `seed, h (main tower), n (buildings), lean, wonk, terrain=crag|island|hilltop, pal=0|1|2, boil, hatch, line`.

- `src/tower.ts` — settlement generator: terraced terrain (crag / island / hilltop), lots + MST paths with steps, foundations, high bridges, lamps, people, boat; building grammar (jetties, annexes, round blocks, turrets, oriels, outside stairs, scaffolding, cranes, arched/round windows, signs, lanterns, props, roofs, dormers, chimneys)
- `src/builder.ts` — geometry kit; every piece gets an id that gets inked at its borders
- `src/world.ts` — city state, per-building meshes, actions (found / grow / bridge / demolish), undo, ray picking
- `src/shaders.ts` — G-buffer (procedural ink patterns, hatching, shadow) + compose (wobbly/boiling lines, bleed, edge darkening, paper, clouds)
- `src/palettes.ts` — Sepia sketch / Comic ink / Watercolor
