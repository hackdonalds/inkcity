# Inkcity — style prototype (milestones 1–4)

Procedural storybook towers rendered as ink + watercolor (Three.js, custom G-buffer + compose pass).

```
npm install
npm run dev
```

## Playing

| Tool | Key | Click |
|---|---|---|
| Look | 1 | orbit / zoom / pan only |
| Build | 2 | ground → found the building type picked in the build bar · building → add a floor · Shift-click → remove top floor |
| Brace | 3 | prop a building up with timber braces (+stability) |
| Bridge | 4 | click one building, then another (both get steadier) |
| Demolish | 5 | pull a building down (refunds a little) |
| Undo | Ctrl+Z | also restores resources |
| Pause | Space | the clock: one day = 8 s at ▶ |

### Management

- **Resources**: wood, stone, tiles, food. Woodcutters, stonecutters, tile kilns (burn wood) and farms produce them when staffed (2 workers per block); residents eat ½ food a day.
- **Materials drive the look**: each floor is paid in timber (6 wood → plank/plaster walls) or stone (5 stone + 2 wood → stone/brick walls); *Auto* uses stone when affordable. Roofs are clay tiles if 2 tiles are in stock, otherwise wooden shingles.
- **Residents** move in while there is free housing, food and happiness ≥ 40; hunger, crowding, unemployment and living in wobbly towers make them unhappy and leave. Bridges cheer people up.
- **Stability**: tall + narrow + leaning + timber floors = load; stone base, braces (up to 4) and bridges add capacity. Shaky towers visibly sway; below zero the top floors break off and fall. Tooltips preview the stability a new floor or brace would give.

"Generate town" builds a procedural settlement you can keep editing; "Empty site" starts from bare ground (`?empty=1`).
Each building is a small spec (seed, position, block count); blocks are seeded by index so growing a tower never changes the floors below.

URL params: `seed, h (main tower), n (buildings), lean, wonk, terrain=crag|island|hilltop, pal=0|1|2, boil, hatch, line`.

- `src/tower.ts` — settlement generator: terraced terrain (crag / island / hilltop), lots + MST paths with steps, foundations, high bridges, lamps, people, boat; building grammar (jetties, annexes, round blocks, turrets, oriels, outside stairs, scaffolding, cranes, arched/round windows, signs, lanterns, props, roofs, dormers, chimneys)
- `src/builder.ts` — geometry kit; every piece gets an id that gets inked at its borders
- `src/world.ts` — city state, per-building meshes, actions (found / grow / bridge / demolish), undo, ray picking
- `src/shaders.ts` — G-buffer (procedural ink patterns, hatching, shadow) + compose (wobbly/boiling lines, bleed, edge darkening, paper, clouds)
- `src/palettes.ts` — Sepia sketch / Comic ink / Watercolor
