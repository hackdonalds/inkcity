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
| Trade | 3 | pick a trade in the trade bar, then click a house to open that shop on its ground floor (or close it) |
| Brace | 4 | prop a building up with timber braces (+stability) |
| Bridge | 5 | click one building, then another (both get steadier) |
| Demolish | 6 | pull a building down (refunds a little) |
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
- **Neighbours shape each other**: houses built flush in a row share one roofline (the oldest sets pitch and covering; a slightly lower house raises its eaves to meet its neighbour) with chimney stacks on the party walls; some terrace houses have an arched *close* through the ground floor; two houses standing close get a stepped alley between them with a stone arch or a little bridge-room over it. Generated towns start with a few little terraces.
- **Trades**: woodcutters, masons, potters, granaries and the inn look like carpenters' shops, stoneyards, pot shelves, hoist lofts and taverns; houses you fit out as shops show their trade (bakery with a domed bread oven, smithy with forge and anvil, butcher's hanging rail, brewer's copper, dyer's vats, weaver's loom window, cooper, tailor, apothecary, chandler, school with a slate and bell) with painted hanging signs, shop goods, shutters that fold open by day and windows lit at night. Shopkeepers work their fittings (the anvil rings), neighbours walk over to buy bread or candles and carry them home, children sit at lessons, pedlars go door to door and a town crier rings the news in the square.
- **Ageing & wealth**: buildings weather with age, unhappiness and wobbliness — moss on roofs, grime and flaking plaster, patched roofs, boarded windows, crooked signs — and a thriving town brightens up with fresh paint, flower boxes and gilded signs.
- **Façades** follow rules: aligned window columns, a taller first floor, string courses, quoins, window surrounds, pilasters and bay-window stacks.
- **Construction** shows new floors as ink sketches in scaffolding before the paint washes in. Washing lines, pennants, birds, boats, smoke, ivy on old stone, trees.
- **Photo mode** (P): hide the UI, set time/weather/palette, add a torn-paper border and title cartouche, save a high-res PNG.

### The land

- **Water**: streams are traced down the hills and carved into the ground (to the sea, off the site edge, or — on the crag — over the edge as a waterfall into the clouds); ponds with reeds and lily pads lie in hollows. Nothing can be built on water; paths cross it on little plank footbridges. Islands have an old pier and boathouse on the beach.
- **Plant life** grows in layers — boulders, then trees, bushes, flower patches and grass — each avoiding the ones before, buildings, paths, fields and water. Woods have clearings and edges; heather and rocks on ridges and steep ground, reeds on banks. Each site has its own flora: wind-bent pines, gorse and dune grass on the island; pines, juniper, heather and boulders on the crag; oaks, hazel and wildflower meadows on the hilltop.
- **Farmland**: farms get fields in rows that are ploughed, sown, grow, ripen and are harvested over an 8-day cycle, orchards, haystacks and carts, all fenced (island), hedged (hilltop) or dry-stone walled (crag).
- **Landmarks of nature**: standing stones, ruins, cave mouths in cliffs, the village well, a wayside shrine with a bench, benches at viewpoints, and trampled earth beside the busiest paths.
- **Soil**: fertility is high near streams and ponds and on flat meadow, low on steep rock and sand; a farm makes ×0.4 – ×1.6 food depending on the soil round it (the build tooltip shows it).
- **Woods**: a woodcutter makes ×(0.35 + 0.08 per mature tree within 16 m, max ×1.2) wood and fells the nearest tree every other day per staffed floor; stumps sprout after 3 days and are full trees again after 10. Clear-cutting is a real trade-off.
- **Wells** (6 stone + 2 wood) can only be dug where the groundwater is at most 4.5 m down (low ground, near streams and ponds); homes within 14 m of a well are happier (up to +10).
- **Fishing piers** (14 wood + 2 stone, island shores only): two fishermen land 4 food each a day.
- **Ruins** can be cleared with the Demolish tool for 15 stone and 2 wood, freeing the ground.

### Management

- **Resources**: wood, stone, tiles, food. Woodcutters, stonecutters, tile kilns (burn wood) and farms produce them when staffed (2 workers per block); residents eat ½ food a day.
- **Shops** (Trade tool): a house's ground floor can take one of 12 trades. Each costs a fit-out, needs 1–2 workers, and works only when staffed and supplied. Bakery (food → bread; eaten bread saves 1.6 food each, +5 happiness), butcher (+3 food), brewery (food → ale; ale at the inn +6), smithy (wood + stone → tools; each tool takes 25% off a building job's wood and stone), carpenter (buildings in reach age slower), cooper (food, bread and ale stop spoiling), weaver (food → cloth, needs a farm), tailor and dyer (use cloth), apothecary (families give up later), chandler, school (newcomers ×1.5). Every working shop cheers the homes within 18 m; a home with 3 kinds of shop in reach becomes *comfortable* (+1 resident a floor) and with 6 *fine* (+2), and looks smarter for it. Generated towns start with a few shops.
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
- `src/facades.ts` — façade composition, closes, alleys, terrace roofs, condition dressing
- `src/trades.ts` — trades: signs, icons, shop goods, workshop fittings
- `src/context.ts` — what a building knows about its neighbours (passed to `buildBuilding`)
- `src/ageing.ts` — building condition from age, happiness and stability
- `src/landmarks.ts` — market, windmill, lighthouse, bell tower, inn yard
- `src/landscape.ts` — the land model: stream/pond carving, water test, soil, groundwater, nature landmarks, woods state (felled/regrowing trees)
- `src/water.ts` · `src/flora.ts` · `src/farmland.ts` · `src/features.ts` — water, layered plant life, fields and boundaries, landmarks of nature + the well and pier buildings; `src/groundlife.ts` wires them into the terrain/ground builders
- `src/ambient.ts` — pennants, laundry, birds, boats, windmill sails
- `src/requests.ts` — resident requests
- `src/photo.ts` — photo-mode frame and cartouche
- `scripts/prep-characters.mjs` — strips/compresses the KayKit characters into `public/characters/`
- `src/smoke.ts` — stateless chimney smoke
- `src/audio.ts` — synthesised ambience + sound effects
- `src/world.ts` — city state, per-building meshes, actions (found / grow / bridge / demolish), undo, ray picking
- `src/shaders.ts` — G-buffer (procedural ink patterns, hatching, shadow) + compose (wobbly/boiling lines, bleed, edge darkening, paper, clouds)
- `src/palettes.ts` — Sepia sketch / Comic ink / Watercolor
