# Inkcity — style prototype (milestones 1–5)

Procedural storybook towers rendered as ink + watercolor (Three.js, custom G-buffer + compose pass).

```
npm install
npm run dev
```

Play online: https://hackdonalds.github.io/inkcity/ — deployed by `.github/workflows/pages.yml` on every push to `main`.

## Playing

| Tool | Key | Click |
|---|---|---|
| Look | 1 | orbit / zoom / pan only |
| Build | 2 | ground → found the building type picked in the build bar (hover beside or behind a house to snap a neighbour flush against it — terraces share walls and steady each other) · building → add a floor · Shift-click → remove top floor |
| Brace | 3 | prop a building up with timber braces (+stability) |
| Bridge | 4 | click one building, then another (both get steadier) |
| Demolish | 5 | pull a building down (refunds a little) |
| Undo | Ctrl+Z | also restores resources |
| Pause | Space | the clock: one day = 20 s at ▶ |
| Frame / Help | F / ? | re-frame the camera on the town · show controls |
| Save | Ctrl+S | to the selected slot (also: Load, Export/Import JSON in the panel; autosave every day) |

### Atmosphere

- **Day / night**: the sun sweeps across the sky each day; dusk warms the light, night turns the page into a blue ink wash with stars, lit windows and glowing lamps.
- **Weather** (changes day to day, or pin it in the panel): fog washes distant things back into the paper, rain draws slanted ink streaks — and boosts farms by 25%.
- **Chimney smoke** is real geometry drawn through the same ink + watercolour pipeline.
- **Sound** is synthesised live with WebAudio (no assets): wind, sea (on islands), rain, birds by day, crickets by night, hammering, chiselling, creaks, and collapses. 🔊 toggles it.

URL extras: `cycle=0&tod=0.86` (freeze the time of day, 0 dawn → 0.72 dusk → night), `weather=clear|fog|rain`, `load=1|2|3|auto`.

### Life & goals

- **Citizens** are procedural: each is assembled from mixed KayKit Adventurers parts (CC0, Kay Lousberg) — arms, body, head, legs, hat, cape — recoloured per part, reproportioned, with children and elders; no two living citizens look alike. They keep a daily routine with layered animations: chopping wood, dressing stone, hoeing, minding stalls, hauling crates/sacks/baskets, sweeping doorsteps, playing the lute, drinking at the inn, sitting by the fountain or in the grass, strolling in pairs deep in conversation, lighting the lamps at dusk; children play catch, tag and jump about. Hover anyone to see who they are and what they're doing.
- **Requests**: named residents ask for things (a farm, braces for a creaking tower, more homes, a taller tower, a bridge, a landmark, a stone house). A "!" floats over the asker; meet the goal before the deadline for a reward.
- **Landmarks** unlock with population: market (10), inn (15), windmill (20, turning sails), lighthouse (25, islands), bell tower (30). Each is unique and has a perk.
- **Storms** are forecast a day ahead (two with a bell tower). They strain every tower — shaky ones fall, and falling floors smash whatever they land on.
- **Building variety**: battlemented tops, mansard, gambrel and onion-dome roofs, roof gardens, dovecotes, water cisterns, weathervanes, wooden galleries, shopfronts with awnings, window awnings, hanging baskets, exterior chimney flues, rain spouts, ladders — on top of jetties, oriels, turrets, crow-stepped gables, outside stairs, cranes and more.
- **Construction** shows new floors as ink sketches in scaffolding before the paint washes in. Washing lines, pennants, birds, boats, smoke, ivy on old stone, trees.
- **Photo mode** (P): hide the UI, set time/weather/palette, add a torn-paper border and title cartouche, save a high-res PNG.

### Management

- **Resources**: wood, stone, tiles, food. Woodcutters, stonecutters, tile kilns (burn wood) and farms produce them when staffed (2 workers per block); residents eat ½ food a day.
- **Materials drive the look**: each floor is paid in timber (6 wood → plank/plaster walls) or stone (5 stone + 2 wood → stone/brick walls); *Auto* uses stone when affordable. Roofs are clay tiles if 2 tiles are in stock, otherwise wooden shingles.
- **Residents** move in while there is free housing, food and happiness ≥ 40; hunger, crowding, unemployment and living in wobbly towers make them unhappy and leave. Bridges cheer people up.
- **Stability**: tall + narrow + leaning + timber floors = load; stone base, braces (up to 4) and bridges add capacity. Shaky towers visibly sway; below zero the top floors break off and fall. Tooltips preview the stability a new floor or brace would give.

"Generate town" builds a procedural settlement you can keep editing; "Empty site" starts from bare ground (`?empty=1`).
Each building is a small spec (seed, position, block count); blocks are seeded by index so growing a tower never changes the floors below.

Defaults: sea island, seed 7, 14 buildings, main tower 8, no lean/wonk, Comic ink. Settings live in the drawer behind the top-left button. On touch screens: one finger orbits, pinch zooms, two fingers pan, tap previews and a sheet confirms.

URL params: `seed, h (main tower), n (buildings), lean, wonk, terrain=crag|island|hilltop, pal=0|1|2, boil, hatch, line`.

- `src/tower.ts` — settlement generator: terraced terrain (crag / island / hilltop), lots + MST paths with steps, foundations, high bridges, lamps, people, boat; building grammar (jetties, annexes, round blocks, turrets, oriels, outside stairs, scaffolding, cranes, arched/round windows, signs, lanterns, props, roofs, dormers, chimneys)
- `src/builder.ts` — geometry kit; every piece gets an id that gets inked at its borders
- `src/citizens.ts` — procedural citizen assembly (part mixing, recolouring, proportions)
- `src/residents.ts` — citizens' daily planner, layered animations, pair/child games
- `src/props.ts` — hand props (tools, lute, mug, crates…)
- `src/landmarks.ts` — market, windmill, lighthouse, bell tower, inn yard
- `src/ambient.ts` — pennants, laundry, birds, boats, windmill sails
- `src/requests.ts` — resident requests
- `src/photo.ts` — photo-mode frame and cartouche
- `scripts/prep-characters.mjs` — strips/compresses the KayKit characters into `public/characters/`
- `src/smoke.ts` — stateless chimney smoke
- `src/audio.ts` — synthesised ambience + sound effects
- `src/world.ts` — city state, per-building meshes, actions (found / grow / bridge / demolish), undo, ray picking
- `src/shaders.ts` — G-buffer (procedural ink patterns, hatching, shadow) + compose (wobbly/boiling lines, bleed, edge darkening, paper, clouds)
- `src/palettes.ts` — Sepia sketch / Comic ink / Watercolor
