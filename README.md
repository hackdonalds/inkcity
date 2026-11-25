# Inkcity — style prototype (milestones 1–2)

Procedural storybook towers rendered as ink + watercolor (Three.js, custom G-buffer + compose pass).

```
npm install
npm run dev
```

URL params: `seed, h (main tower), n (buildings), lean, wonk, terrain=crag|island|hilltop, pal=0|1|2, boil, hatch, line`.

- `src/tower.ts` — settlement generator: terraced terrain (crag / island / hilltop), lots + MST paths with steps, foundations, high bridges, lamps, people, boat; building grammar (jetties, annexes, round blocks, turrets, oriels, outside stairs, scaffolding, cranes, arched/round windows, signs, lanterns, props, roofs, dormers, chimneys)
- `src/builder.ts` — geometry kit; every piece gets an id that gets inked at its borders
- `src/shaders.ts` — G-buffer (procedural ink patterns, hatching, shadow) + compose (wobbly/boiling lines, bleed, edge darkening, paper, clouds)
- `src/palettes.ts` — Sepia sketch / Comic ink / Watercolor
