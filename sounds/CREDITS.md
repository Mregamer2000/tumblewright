# Sound credits

Every recording used by Tumblewright is CC0 (public domain). Credit isn't required, but here's where they came from.

| Source | Used for |
| --- | --- |
| "The Free Firearm Sound Library" — opengameart.org | Pistol, rifle, shotgun, sniper, NPC guns (close / mid / far), rocket launch and explosion body (Carl Gustav M45) |
| Kenney — "Impact Sounds" (kenney.nl) | Footsteps (grass, concrete, wood, snow, carpet), wood / metal / plastic / glass / soft impacts, punches |
| Kenney — "RPG Audio" | Doors, creaks, cloth, gun mechanics (pump, bolt), weapon draw |
| Kenney — "Interface Sounds" | Menus, hit marker, chat, placing, undo |
| Kenney — "Sci-fi Sounds" | Physics gun, tool gun, delete gun, thrusters, rocket flight, explosion sub-bass and crunch |
| "75 CC0 breaking / falling / hit sfx" — opengameart.org | Glass, wood and stone breaking, debris, car crashes |
| "40 CC0 water / splash / slime SFX" — opengameart.org | Splashes, lake water, gore slime |
| "100 CC0 SFX", "80 CC0 creature SFX" — opengameart.org | Doors, springs (bounce pad), grenade pin, zombie voices |
| "15 vocal male strain/hurt/pain/jump sounds", "grunts of male death and pain", "Female Hurt Grunts & Groans", "Horror scream1" — opengameart.org | NPC and player voices, nextbot jumpscare |
| "8 wet squish, slurp impacts", "Squish Sounds Effects" — opengameart.org | Gore |
| "Fantozzi's Footsteps (Grass/Sand & Stone)", "42 Snow and Gravel Footsteps" — opengameart.org | Sand, stone and snow footsteps |
| "Water Waves", "Muffled Distant Explosion", "racing car engine sound loops" — opengameart.org | Lake waves, far explosions, car engines |

Synthesized for the game (tools/sounds/synth.mjs): bullet casings and shotgun hulls, ricochets, near-miss cracks, swings and throws,
bone cracks, the prop cannon, balloon pops, tyre squeal, motor whir, physics gun hum, wind, distant city and birdsong.

Rebuild: `node tools/sounds/synth.mjs` then `node tools/sounds/build_sounds.mjs` (downloads live in sounds/cc0/dl, extracted to sounds/cc0/lib).
