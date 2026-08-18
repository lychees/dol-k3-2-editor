# Uncharted Waters — Editor Suite

Browser-based editors for the [dol-k3-2](https://github.com/lychees/dol-k3-2)
sailing game (a three.js remake of *Uncharted Waters 2*).

**Open online: https://lychees.github.io/dol-k3-2-editor/editor/**

The online deployment reads the game data straight from the game's public
GitHub Pages site (GitHub Pages sends `Access-Control-Allow-Origin: *`, so
no assets are duplicated here). Edited files are exported as downloads —
merge them back into the game repo's `game/assets/` to apply.

## Editors

- **World map editor** (`editor/map.html`) — paint the 2160×1080
  `world_map.bin` (wrap-aware brush/rect/fill/eyedropper, undo/redo,
  port & discovery overlays, .bin import/export)
- **Random map viewer** (`editor/rando.html`) — preview the randomizer's
  generated world for any seed (identical to in-game generation), with
  port/discovery relocation preview and PNG export
- **Port map editor** (`editor/portmap.html`) — the 101 96×96 port scenes in
  `portmaps.bin`, with the correct per-port PORTCHIP tileset and a building
  overlay
- **Ship editor** (`editor/ships.html`) — all 22 ship types in `ships.json`,
  with ship image preview
- **Character editor** (`editor/mates.html`) — 50 mates + 28 barmaids + the 4
  original characters (Isabella's companions, `mates_extra.json`), with a
  portrait picker over `figures.png` and the waifu portraits
- **Story editor** (`editor/story.html`) — the 7 protagonists' main
  storylines (`story.json`: chapter name/goal/reward/text), with an
  in-game-style dialog preview
- **Economy editor** (`editor/goods.html`) — 13 regions × 46 goods price
  matrix and per-port specialties in `goods.json`
- **Port editor** (`editor/ports.html`) — drag ports on the world map; edit
  name/region/tileset/maid/building positions (`ports.json` + `port_meta.json`)
- **Discovery/town/ruin editor** (`editor/world.html`) — `villages.json`
  (with art picker), `towns.json`, `ruins.json`, click-to-place coordinates
- **Asset browser** (`editor/assets.html`) — every tileset, sprite, portrait
  atlas, plus music & SFX player

## Local use against a local game checkout

Clone the game repo too and serve the editor from inside it, so the editors
read/write your local `game/assets/` directly:

```bash
# in the dol-k3-2 repo
cd game
python -m http.server 8734
# open http://127.0.0.1:8734/editor/   (editor/ ships with the game repo)
```

The asset base is auto-detected: local `../assets/` wins when present;
otherwise the editors fall back to the live game site.

See `editor/FORMATS.md` for the full data format reference.

## Credits

Same asset credits as the game: data extracted from uw2ol / Uncharted
Waters 2 (Koei, 1993), non-commercial fan/educational use only.
