# Inkcity — style prototype (milestone 1)

Procedural storybook towers rendered as ink + watercolor (Three.js, custom G-buffer + compose pass).

```
npm install
npm run dev
```

URL params: `seed, h, lean, wonk, terrain=crag|island, pal=0|1|2, boil, hatch, line`.

- `src/tower.ts` — shape grammar (blocks, jetties, annexes, turrets, roofs, dormers, chimneys, bridges, plinth, terrain)
- `src/builder.ts` — geometry kit; every piece gets an id that gets inked at its borders
- `src/shaders.ts` — G-buffer (procedural ink patterns, hatching, shadow) + compose (wobbly/boiling lines, bleed, edge darkening, paper, clouds)
- `src/palettes.ts` — Sepia sketch / Comic ink / Watercolor
