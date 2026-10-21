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
* **Primary balls never stop.** Rounds ricochet off pixels and steel forever.
  They start at 1–2 damage with no free area damage, pierce or damage growth.
  Growth and special powers require upgrades. Fragments expire after 18 seconds
  (24 with Diamond Dust) and cannot reproduce.
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
| **Rime** | 1 damage, 300 speed, 12 currency. Every fourth direct hit freezes a survivor for 4 seconds. Choose Glacier support or piercing Hail. |
| **Cairn** | 2 damage, 220 speed, 28 currency. A modest single-target stone. Choose Tectonic crushes or Obelisk precision. |
| **Volt** | 1 damage, 390 speed, 18 currency. A nimble spark. Choose Storm charge/chains or Rail speed/pierce. |

## Tech

Four trees hold **81 purchasable upgrades**: 22 per ball and 15 shared Field
upgrades. Each ball has four foundations, two mutually exclusive specializations,
six supporting nodes and an evolution per specialization, and two cross-ball
capstones. Choose Glacier **or** Hail, Tectonic **or** Obelisk, Storm **or** Rail.
The rival branch and its descendants become sealed. Field also offers a choice
between Twin Launch and Focused Launch.

Some combinations:

* **Freeze → Earth Strike:** Rime freezes; Tectonic Cairn instantly shatters any
  frozen breakable pixel. Avalanche freezes neighbors after a shatter.
* **Freeze → Ice Conductor:** frozen targets immediately trigger Volt's chain.
  Forked Sky charges nearby survivors; Tempest strengthens chains against ice.
* **Charge → Grounding:** Cairn consumes Volt's charge to trigger a local burst.
  Obelisk can instead use Lodestone for focused charged-target damage.
* **Fault → Ice Fault / Fault Grid:** Cairn's amber fault cracks improve later
  direct hits from every ball. Rime and Volt can specialize in exploiting them.
* **Three coatings → Convergence:** stack frost, fault and charge for shared
  direct damage bonuses. Reaction Salvage turns status kills into more currency.
* **Hail / Rail:** rechargeable pierce, ice chips, speed from steel, and
  pierce-driven acceleration offer focused alternatives to area builds.

Glacier crystals, Hail diamonds, layered stone, carved obelisks, Storm rings and
Rail needles replace the starting orbs. Six evolutions add crowns, orbiting
plates, halos or twin wakes. The field, tree previews and dock reflect upgrades.
Cached silhouettes remain active at high ball counts.

Scroll the tree or use the upgrade selector. Select a node to inspect its full
effect and prerequisites, then use its purchase button. Dashed red lines mark
exclusive choices. Nodes cost ✦, not ◆. Purchases immediately update primary
balls already in flight. Temporary pixel coatings use simulation time and are
not persisted; the field, upgrades and economy are saved as before.

Older saves keep their field, currency and selected ball. The previous trees
are reset once, refunding their historical skill-point costs so players can
choose a compatible new build. Internal ball IDs remain stable.

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
* Pixel coatings are sparse and capped at 10,000 active cells. Chain searches
  and area reactions have bounded reach and cannot recursively trigger chains.
* An adaptive quality step drops trails/particles if frame time climbs.
* The save file is the 1 MB health array deflated (~50 KB) plus meta.
