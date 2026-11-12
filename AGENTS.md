# AGENTS.md

Guide for AI coding agents (and humans) working on **MC Build Visualizer**.

## What this is
A browser 3D voxel editor for sketching Minecraft Java builds (target: **26.3**, DataVersion `5023`). Friends can view shared builds read-only. Builds export to the game as Sponge `.schem` files.

## Stack
- Vite + TypeScript (strict) + Three.js. Static output, deployed to GitHub Pages (`base: './'`).
- `jszip` for reading the Minecraft client jar and resource packs.
- Vitest for unit tests (`test/`).
- No other runtime deps. NBT writing and gzip (`CompressionStream`) are hand-rolled or native. Do not add a dependency for a few lines of code.

## Commands
```
npm run dev      # dev server
npm test         # vitest
npm run build    # typecheck + production build to dist/
```
Run `npm test` and `npm run build` before calling any change done.

## Layout
```
src/
  main.ts        app wiring: input, projects, import/export
  world/         World (16³ chunks of Uint16 palette ids, 0 = air) + History (undo/redo)
  render/        Renderer (scene, orbit, picking) + chunk mesher
  io/            buildFile (JSON format), store (IndexedDB projects + cached jar), nbt (writer), schem (Sponge v3), materials
  assets/        pack.ts (jar/pack zip → JSON + PNG blobs), models.ts (pure resolver + baker), atlas.ts, tint.ts
  render/blockModels.ts  baked model cache per blockstate: atlas UVs, tint, layer, full-face coverage for culling
  tools/         placement.ts (pure: in-game state derivation + fence/pane/wall connections), mirrorState (X/Z mirror of facing/hinge/shape/rotation/sides)
  ui/            palette.ts (search list, 1–9 hotbar in localStorage, property panel with per-prop 'auto')
  camera/        firstPerson.ts: Body (pure AABB physics: gravity, jump, 0.6 step-up, fly) + pointer-lock controller
  blockentities/ index.ts: hand-made boxes (Java entity UV unwrap) for blocks without JSON elements
  render/signText.ts  sign text planes (system monospace font, not bundled)
test/            vitest specs
```

## Core model
- Blocks are full **blockstate strings** (`minecraft:oak_stairs[facing=north,half=bottom]`) interned in `World.palette`. Chunks store palette ids.
- Every edit goes through `History.do(sets)`, so it is one undo step. `World.apply` notifies `onChange` with dirty chunk keys, including neighbour chunks, because border faces change.
- `onChange` triggers re-meshing and a debounced IndexedDB autosave.

## Assets & rendering (M2)
- Users load their own jar: Prism Launcher keeps it at `~/.local/share/PrismLauncher/libraries/com/mojang/minecraft/<ver>/minecraft-<ver>-client.jar`.
- `npm run dev` auto-loads that jar (newest version, or `MC_JAR=/path/to.jar`) via the dev-only `/__local-jar` route in `vite.config.ts`. It is never part of `dist/`.
- 26.x model quirks handled: texture values may be `{sprite, force_translucent}`; element rotation may be `{x,y,z}`; `shade_direction_override`; face `texture` without `#` (heavy_core).
- Render layers: opaque / cutout (alpha 0 pixels) / translucent (semi-alpha pixels or `force_translucent`, plus water). Unlit materials; vanilla per-face shade baked into vertex colors.
- Culling: a face with `cullface` hides when the neighbour fully covers the opposite face with opaque geometry, or the neighbour is the same block covering it (glass-glass).
- Blocks without elements (block entities) render as particle-textured cubes until M7.
- `test/models.test.ts` bakes every vanilla blockstate when the Prism 26.3 jar exists locally (skipped otherwise).

## Placement (M3)
- `derive()` mimics in-game placement from clicked face, camera look and hit height: facing rules per block family, axis, top/bottom halves, slab type, button/lever `face`, sign `rotation`, lanterns, wall torch/sign variants, two-cell doors/tall plants/beds.
- Property panel values other than `auto` override derived ones.
- Every edit goes through `commit()` in `main.ts`, which re-connects fences/panes/walls around changed cells in the same undo step.
- Not yet: stairs `shape`, slab merging into `double`, removing both halves of doors/beds.

## Tools & first person (M4)
- Box / hollow box: two clicks (left = fill with the derived state, right = clear), Esc cancels, capped at 500k cells per edit.
- Mirror planes at X/Z = a map cell x ↔ 2a − 1 − x (a = 0.5 mirrors through cell 0). Applied inside `commit()`, so every tool mirrors.
- Slice (`renderer.maxY`) hides blocks above Y from meshing, picking and collision.
- First person (F): in-game controls (left break, right place, middle pick, wheel = hotbar, double-tap Space = fly). Collision box = AABB of a model's quads, only for models with cullfaces (plants/torches are walk-through). y < 0 is solid ground unless flying.

## Export (M5)
- `.schem` = gzipped NBT, root `{ Schematic: { Version 3, DataVersion, Width/Height/Length, Offset [0,0,0], Metadata, Blocks: { Palette, Data } } }`. Data is varint palette ids in `x + z*W + y*W*L` order. Load in-game with WorldEdit `//schem load <name>` then `//paste`.
- DataVersion comes from the jar's `version.json` (`world_version`, 5023 for 26.3), editable in the sidebar.
- Palette keys hold only the props our models use; WorldEdit fills the rest with defaults. No BlockEntities until M7.
- Material list maps blocks to items (`itemName`), counts doors/beds once, double slabs twice, candles/pickles by count.

## Sharing & block entities (M6, M7)
- `BlockModels.portable(state)` gives atlas-independent quads (`PQuad`); the mesher maps them onto the atlas. Share files store them as `baked` (26 numbers per quad) plus each sprite's average color.
- Viewer (`?build=<url>`): fetches the JSON (http/https, ≤ 50 MB, fully validated), hides edit UI (`body.viewer`, `.edit-only`/`.view-only`), never autosaves. With a cached/dev jar it renders textured; otherwise baked shapes in flat colors (cutout plants become solid squares, glass opaque).
- Block entities: `box()` follows the entity texture unwrap (top row [top][bottom], side row [east][front][west][back]), front = north, then rotated. Solid ones get `cull: 'down'` on their floor face, which also gives them collision. Signs/beds/bells have JSON models in 26.3.
- Sign text lives in `world.texts` ("x,y,z" → 4 lines, ≤ 90 chars), saved in build files, exported as `minecraft:sign`/`hanging_sign` BlockEntities with plain-string messages. Not in undo history. Placing a sign or pressing E on one opens the editor.
- Dev builds expose `window.__mcbv = { renderer, world }` for scripted screenshots.

## Build file format (`src/io/buildFile.ts`)
- `{ format: 'mc-build-visualizer', version, name, palette, chunks }`. Chunks are RLE `[count, id, ...]` over 4096 cells, index `(y*16 + z)*16 + x`.
- Bump `version` on any breaking change and keep loading older versions.
- `deserialize` is a **trust boundary** (imports and `?build=` URLs). Validate everything before mutating the world.
- v2 (M6) adds baked geometry per used blockstate (element boxes, UVs, texture names, average colors), so the viewer needs no Mojang models.

## Licensing rules (do not break)
- **Never commit, host or bundle Mojang assets** (textures, models, blockstates, fonts from the client jar). Users load their own jar locally. It is cached in their browser only.
- No textures are hosted (user decision 2026-11-12: vanilla only, no CC pack for now). Viewers use their own jar, or flat average colors stored in the share file.
- The sign font must be openly licensed (CC0/OFL), not Mojang's.
- `.gitignore` excludes `*.jar`. Keep it that way.

## Roadmap (milestones)
1. ✅ Scaffold, colored-cube chunks, orbit, place/remove, undo/redo, IndexedDB autosave + project list, JSON import/export.
2. ✅ Jar/pack loader, model resolver (variants, multipart, parents, rotations, uvlock), texture atlas, model mesher with culling, transparency, biome tint (plains), fluids.
3. ✅ Searchable palette, 1–9 hotbar, middle-click pick block, in-game-style state derivation + property panel.
4. ✅ Box fill/hollow, layer slice, X/Z mirror, first-person walk (AABB collision from model elements) with double-tap-Space fly.
5. ✅ Material list, Sponge Schematic v3 `.schem` (DataVersion configurable, default 5023 = 26.3), PNG screenshot.
6. ✅ Baked geometry in build file, `?build=<url>` read-only viewer (orbit + walk), flat-color fallback.
7. ✅ Block entities (chests, shulkers, banners, heads, pot, conduit, copper golem statue, end portal/gateway) + sign text (rendered, saved, exported to NBT).
8. ✅ GitHub Pages deploy workflow (`.github/workflows/deploy.yml`: test + build on push to `main`, publish `dist/`).

## Conventions
- Keep the smallest change that fully works. Do not add speculative options or abstractions.
- Mark known limits as `// shortcut: <limit>, <when to upgrade>`.
- Comments explain *why*, not *what*.
- New non-trivial logic (resolver, mesher, NBT, state derivation) gets a Vitest spec.
- Input: a click without drag edits, a drag orbits. Left = place, right = remove.
