# Tumblewright

A multiplayer physics sandbox that runs in the browser: spawn props, weld contraptions, drive cars, fight ragdoll NPCs,
build maps together. Inspired by Garry's Mod and GoreBox. Everything (game, models, sounds) is in one `index.html`.

**Play:** https://tumblewright.vercel.app (or the GitHub Pages copy of this repository)

Host a room from the main menu and share the 6-letter code or the invite link. Players connect peer-to-peer (WebRTC);
the host runs the physics.

## Features

- Physics gun, tool gun (weld, rope, thrusters, wheels, motors, seats, painter, duplicator), delete gun and weapons
- Ragdoll NPCs with gore, voices and AI; zombies; nextbot chase mode
- Cars with engines you can hear, go-karts, trucks; host-set top speed
- Maps: gm_construct (with the white room, dark room, mirror room and tunnels), Flatgrass, Big City, Arena and more
- Customisable hotbar (weapons, tool modes, spawn items), spawn menu with favourites, save / load worlds and dupes
- 3D positional audio, four graphics tiers from a PS1 look to Ultra

## Project layout

| Path | What it is |
| --- | --- |
| `src/` | The game source, split into numbered parts that are concatenated into `index.html` |
| `tools/build.mjs` | Builds `index.html` from `src/` and embeds the assets |
| `assets/` | Prebuilt 3D models (GLB) |
| `sounds/clips/sounds.json` | Prebuilt sound banks; `sounds/CREDITS.md` lists the (CC0) sources |
| `tools/models/` | Blender script that generates every model (`build.ps1`) |
| `tools/sounds/` | Our sound synthesizer and the bank builder (needs ffmpeg and the source libraries) |
| `tools/owner/` | Owner access key (see below) |
| `tools/release/` | Publishing script and the Vercel functions (TURN relay credentials, keep-alive) |

## Building

```
node tools/build.mjs
```

Then open `index.html` or serve the folder with any static web server (for example `npx serve`).

## Owner access

People who know the owner code can use the host settings in any room (Esc → Owner access). `tools/owner/owner.json` holds a
public key and a private key encrypted with the code: the code is checked in the owner's own browser and the host verifies a
signed one-time challenge, so the code is never sent or stored. Run `node tools/owner/owner.mjs new` to set a new code.

## Credits

Sounds are CC0 recordings (Kenney.nl, OpenGameArt, The Free Firearm Sound Library) plus our own synthesis: see
`sounds/CREDITS.md`. Libraries: three.js, Rapier, Trystero, Supabase JS (loaded from CDNs).
