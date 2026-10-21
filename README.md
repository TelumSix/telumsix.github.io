# PIXEL FIELD

A drag-to-shoot destruction game played across **1,000,000 pixel cells**.

## Run

```bash
npm start        # http://localhost:4173
```

Or just open `index.html` — there is no build step and no dependencies.

```bash
npm test         # world generation / fog / physics / save round-trip checks
```

## Controls

| Input | Action |
| --- | --- |
| Drag **backwards**, release | Sling a ball from **cleared ground**: it flies **opposite** the drag. The drag only aims — launch speed is fixed per ball |
| Right-drag / middle-drag / Space+drag | Pan the camera |
| WASD / arrow keys | Pan the camera |
| Mouse wheel / field-map buttons | Zoom |
| Click the field map | Jump the camera |
| `1`–`3` | Select a ball |
| `T` | Tech tree |
| `H` | Help |
| `M` | Mute |
| ♪ button | Sound mixer: master, effects and chime volume sliders |
| `Esc` | Close panels / cancel a shot |

## Rules

* A pixel is **five ball diameters** wide. The field is a 1000 × 1000 grid.
* **Every cell is a pixel** except a small starting arena (~290 cells). Pixels are
  either breakable or **steel** (white). Every undamaged breakable pixel is the
  same neutral grey; losing health heats it yellow → orange → red. Health is
  1–40 and climbs with distance from the starting arena: the centre is fragile,
  the outer edges are the toughest.
* **Balls never stop.** Every round ricochets off pixels and steel forever,
  damaging whatever it touches. Every bounce feeds the ball's own gimmick and
  every few bounces the streak adds damage and size. Late in a run there can be
  thousands of balls in flight — the HUD counts them.
* **Fog of war:** fog is pitch black. A pixel only shows once a neighbouring cell
  is broken; each break reveals a 3-pixel-deep band, and pixels still touching
  the fog are drawn a little darker. Ground you have already cleared is lit as a
  shade lighter than the fog, so you can read your tunnels at a glance.
  Balls can only be launched from **cleared ground** — never from fog or from
  inside a solid pixel — though a shot may fly straight into the dark.
* **Steel** pixels are unbreakable and form one connected web: dashed arteries
  run across the whole field and are decorated with rings, wheels, ladders,
  combs, zigzags, open polygons and gates. **Steel never encloses a region** —
  a connectivity pass guarantees every breakable pixel stays reachable on every
  seed, so no shape can seal off a pocket of the field.
* **Shards** (gold gems) are always visible, even in the dark. They pay
  **skill points ✦** used by the tech tree. Shards further from the centre are
  worth more.
* Destroying pixels pays **currency ◆**, which is what launching balls costs.
  Every ball has its own reload time (shown as a bar on its dock card) and its
  own **demand surcharge**: each launch adds +20% of the base price, and the
  surcharge cools by 0.6 units/s while that ball rests, up to a 2.6× cap. Spam
  one ball and it gets expensive for a moment; switch balls or pace your shots
  and the price settles back down instead of growing forever.

## Balls

The game starts with three standard rounds. All three are unlocked from the
first launch, and each has its own expansive skill tree. Launch speed is fixed
per ball type and never depends on how far you pull the sling; only the
direction comes from the drag.

| Ball | Ability |
| --- | --- |
| **Arc** | Balanced energy round. Bounce streaks sharpen it, Chain Reaction sheds sparks and Resonance drops shockwaves. |
| **Maul** | Slow heavy round. Every impact crushes nearby pixels, steel ramps its damage and size, and Blast Charge detonates on the first impact. |
| **Drift** | Fast slim round. Winds up speed on every bounce, learns pierce, then sheds sparks and pulses. |

## Tech

Four trees share one panel:

* **Arc** — a balanced tree around streak damage, pierce, chain sparks and
  shockwaves. **Momentum Pierce** makes every streak grant pierce;
  **Conductor** makes chain sparks hit harder; **Overload** supercharges pulses.
* **Maul** — a heavy tree around crush, shockwaves, steel ramp and detonation.
  **Seismic Crush** adds a shockwave to every crush; **Aftershock** grows crush
  damage with every bounce; **Quake** releases periodic shockwaves.
* **Drift** — a speed/pierce tree. **Needle** pierces on every bounce,
  **Elasticity** and **Kick** wind up speed, and **Phase Drive** turns pierce
  hits into more speed.
* **Field** — shared economy and power: damage, yield, discount, volley,
  momentum, bounty, kinetic harvest, resonance field and mitosis. There are no
  size or reload nodes.

Nodes cost ✦, not ◆. Purchased upgrades apply immediately, including to every
ball already in flight.

## Sound

Everything is synthesised. Click the **♪** button for master / effects / chime
volume sliders; **M** mutes. Volumes and mute state persist.

## Performance notes

* Health / steel / shard / visibility live in flat `Uint8Array`s (6 MB for the
  whole million-pixel world).
* Rendering is chunked: 40×40 cells per cached offscreen canvas, repainted only
  when dirty and only for chunks on screen. Fog is baked into the chunks.
* Balls are sub-stepped swept-ish colliders (no tunnelling even at 4000 u/s),
  with a hard cap of 7000 live rounds. Rendering culls off-screen balls and
  switches to a quad batching path above 2000 balls.
* Measured in Chromium: 7000 balls at ~144 fps on a 1675×809 viewport.
* An adaptive quality step drops trails/particles if frame time climbs.
* The save file is the 1 MB health array deflated (~50 KB) plus meta.
