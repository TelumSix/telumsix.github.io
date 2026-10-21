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
| Drag **backwards**, release | Sling a ball from where you pressed: it flies **opposite** the drag (longer pull = faster) |
| Right-drag / middle-drag / Space+drag | Pan the camera |
| WASD / arrow keys | Pan the camera |
| Mouse wheel / field-map buttons | Zoom |
| Click the field map | Jump the camera |
| `1`–`9` | Select a ball |
| `T` | Tech tree |
| `H` | Help |
| `M` | Mute |
| ♪ button | Sound mixer: master, effects and chime volume sliders |
| `Esc` | Close panels / cancel a shot |

## Rules

* A pixel is **five ball diameters** wide. The field is a 1000 × 1000 grid.
* **Every cell is a pixel** except a small starting arena (~290 cells). Pixels are
  either breakable (**grey**, health 1–10, heating yellow → orange → red as they
  take damage) or **steel** (white).
* **Balls never stop.** Every round ricochets off pixels and steel forever,
  damaging whatever it touches. Every bounce feeds the ball's own gimmick and
  every few bounces the streak adds damage and size. Late in a run there can be
  thousands of balls in flight — the HUD counts them.
* **Fog of war:** fog is pitch black. A pixel only shows once a neighbouring cell
  is broken; each break reveals a 3-pixel-deep band, and pixels still touching
  the fog are drawn a little darker. Ground you have already cleared is lit as a
  shade lighter than the fog, so you can read your tunnels at a glance.
* **Steel** pixels are unbreakable and form one connected web: dashed arteries
  run across the whole field and are decorated with rings, wheels, ladders,
  combs, zigzags, open polygons and gates. Every gap in the web keeps regions
  reachable, and a connectivity pass carves the shortest possible exit out of
  any pocket that a shape still seals off.
* **Shards** (gold gems) are always visible, even in the dark. They pay
  **skill points ✦** used by the tech tree. Shards further from the centre are
  worth more.
* Destroying pixels pays **currency ◆**, which is what launching balls costs.
  Every ball has its own reload time (shown as a bar on its dock card) and every
  launch makes that ball **1.5× pricier**, so a swarm pays for itself while
  spamming a single type gets expensive.

## Balls

Every ball is built around what happens when it bounces.

| Ball | Ability |
| --- | --- |
| Spark | Cheap 1-damage ricochet, sharpens with every streak |
| Rubber | +5% speed on every bounce (up to +70%) |
| Slug | 3 damage per bounce plus a crush on the pixels around it |
| Bouncer | +1 damage / +12% size each time it hits steel |
| Bumper | Shockwave on every bounce instead of a single pixel |
| Ricochet | Learns +1 pierce every second bounce |
| Echo | Shockwave every third bounce |
| Spore | Sheds two bouncing sparks every eighth bounce |
| Nova | Five-pixel blast every tenth bounce |

## Tech

Three branches:

* **Arsenal** — unlocks the nine balls.
* **Upgrades** — shared stats: damage, speed, radius, **momentum** (faster
  bounce streaks), **kinetic edge** (bigger streak hits), **elastic field**
  (every ball speeds up as it bounces), **kinetic harvest** (bounces pay
  currency), **resonance field** (periodic shockwaves), **mitosis** (periodic
  sparks), yield, reload speed, volley, discount and bounty.
* **Ball Upgrades** — a six-chip per-ball track: Damage, Speed, Size, Reload,
  signature and a second special. The signature differs per ball: Spark
  quickens its streak, Rubber gains speed faster, Slug crushes harder, Bouncer
  ramps harder on steel, Bumper and Echo widen their shockwaves, Ricochet raises
  its pierce cap, Spore blooms more sparks, Nova widens its pulse. The special
  adds another twist, from Chain sparks and Fracture crushes to Overwind speed
  caps, Needle pierce, Feedback pulses and Chain Nova.

Nodes cost ✦, not ◆. Maxing everything costs roughly 220 skill points.

## Sound

Everything is synthesised. Click the **♪** button for master / effects / chime
volume sliders; **M** mutes. Volumes and mute state persist.

## Performance notes

* Health / steel / shard / visibility live in flat `Uint8Array`s (5 MB for the
  whole million-pixel world).
* Rendering is chunked: 40×40 cells per cached offscreen canvas, repainted only
  when dirty and only for chunks on screen. Fog is baked into the chunks.
* Balls are sub-stepped swept-ish colliders (no tunnelling even at 4000 u/s),
  with a hard cap of 7000 live rounds. Rendering culls off-screen balls and
  switches to a quad batching path above 2000 balls.
* Measured in Chromium: 7000 balls at ~144 fps on a 1675×809 viewport.
* An adaptive quality step drops trails/particles if frame time climbs.
* The save file is the 1 MB health array deflated (~50 KB) plus meta.
