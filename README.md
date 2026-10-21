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
  either breakable or **steel** (white). Undamaged breakable pixels are
  grey stone or brown soil in scattered patches. The first damaging hit reveals
  an absolute HP colour: violet/blue at high health, through green and yellow
  to orange/red at low health. Equal remaining HP has the same base colour.
  Health is doubled, up to 80 HP; shards now have 2 HP.
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
* Destroying pixels pays **currency ◆**: rounded `(2 + sqrt(original HP))`
  before Refinery and Reclamation. An 8-HP pixel pays 5; an 80-HP pixel pays 11.
  New games start with 150 currency, enough to try the roster.
* Launch prices grow permanently with primary launches of that type and the
  whole fleet. Growth is superlinear, so passive income cannot fund endless
  cheap replication. A separate demand surcharge adds 30% per recent shot,
  cools at 0.35 units/s, and caps at 2.8× the investment price. Discounts still
  apply. Twin Launch costs 60% extra and records both primaries.

## Balls

The game starts with three standard rounds. All three are unlocked from the
first launch, and each has its own expansive skill tree. Launch speed is fixed
per ball type and never depends on how far you pull the sling; only the
direction comes from the drag.

| Ball | Ability |
| --- | --- |
| **Rime** | 1 damage, 300 speed, 24 base currency. Every fourth direct hit freezes a survivor for 4 seconds. Choose Glacier support or piercing Hail. |
| **Cairn** | 2 damage, 220 speed, 48 base currency. A modest single-target stone. Choose Tectonic crushes or Obelisk precision. |
| **Volt** | 1 damage, 390 speed, 32 base currency. A nimble spark. Choose Storm charge/chains or Rail speed/pierce. |

**Pierce** spends one charge to damage and pass through one breakable pixel.
It deals normal direct-hit damage and preserves motion until the ball fully
exits that pixel, including with its final charge. Steel always reflects it.
Passed cells are forgotten after exiting, so later visits hit normally and
the ignore list stays bounded. Pierce spreads statuses through rows of pixels,
reaches deeper targets, and feeds Phase Drive. A pale arc shows live charges.

## Tech

Four trees hold **126 purchasable upgrades**: 34 per ball and 24 shared Field
upgrades. Each ball has four foundations, two mutually exclusive specializations,
six supporting nodes and an evolution per specialization, and two cross-ball
capstones. Choose Glacier **or** Hail, Tectonic **or** Obelisk, Storm **or** Rail.
The rival specialization stays sealed. Seven late gateways reopen selected
rival talents through explicit alternate prerequisites; those borrowed talents
and their dependent upgrades survive saves. For example, Winter Crown can
reach Thaw Passage and return to Ice Needle; Aurora Lance can use Cloud Passage
to learn Arc Wire. Reunion reconnects the two Field support paths without
granting the other launch specialization.

Additional choices include Stillwater versus White Wind, Deep Core versus
Branching Fault, Polarity versus Free Current, Surveyor versus Reaction Economy,
and Relay Network versus Hard Impact. Nonexclusive upgrades add soil damage,
refreshing frost, wound bonuses, spreading faults, pierce from kills, and
periodic direct-hit echoes.

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

Balls **always remain round**. Frost rims, stone bands, engraved surfaces and
electric arcs decorate circular cores. Upgrades add snow, dust, ion, twin,
ribbon or aurora wakes that follow recent motion through ricochets. Six
evolutions add circular rims and stronger trail identities. Tree previews and
dock icons also stay round; cached spherical sprites serve dense scenes.

Drag/scroll the tree or use its zoom/fit controls. Every tree is laid out
automatically from its requirements: each depth is a column and each branch
keeps its own lane, so links stay short and crossings are rare. Hovering a node
shows its full effect and prerequisites; clicking it buys the upgrade
immediately. Dashed red lines mark exclusive choices. Nodes cost ✦, not ◆.
Purchases immediately update primary balls already in flight. Temporary pixel
coatings use simulation time and are not persisted; the field, upgrades and
economy are saved as before.

Older saves keep their field, currency and selected ball. The previous trees
are reset once, refunding their historical skill-point costs so players can
choose a compatible new build. Internal ball IDs remain stable.
The expanded trees preserve current builds. Older field health is scaled once
while preserving cleared cells, partial damage, steel layout and shard positions.
Primary balls now persist, including earned growth and spent pierce; temporary
fragments expire on reload. Launch investment persists across reloads and new
fields. Older saves without launch counts use their recorded shot total; a
returning player with neither a fleet nor launch funds receives a small reserve.

Run `npm run balance` for reproducible 120-second opening and specialized-build
probes. Add `-- --seconds=600` for ten minutes, or `-- --legacy` to compare the old
economy against the same combat. These are tuning probes, not player forecasts:
they launch from the centre once per second and hold upgrades fixed.

## Sound

Everything is synthesised around one warm C-major harmony. Dense impacts
coalesce into one note every 180 ms, with lower volume as density rises.
Steel and bounce sounds fill gaps rather than competing with destruction.
Soft attacks, lower registers, a low-pass filter and compression reduce sharp
transients; polyphony is capped at 12 voices, with room reserved for UI/shards.
There is one quiet delay repeat with no feedback accumulation.
Click **♪** for master / effects / chime sliders; **M** mutes and clears
scheduled notes. Volumes and mute state persist.

## Performance notes

* Health / steel / shard / visibility / soil live in flat `Uint8Array`s (7 MB for the
  whole million-pixel world).
* Rendering is chunked: 40×40 cells per cached offscreen canvas, repainted only
  when dirty and only for chunks on screen. Fog is baked into the chunks.
* Balls are sub-stepped swept-ish colliders (no tunnelling even at 4000 u/s),
  with a hard cap of 7000 live rounds. Rendering culls off-screen balls and
  switches to a quad batching path above 2000 balls.
* Pixel coatings are sparse and capped at 10,000 active cells. Chain searches
  and area reactions have bounded reach and cannot recursively trigger chains.
* Faceted ice, glowing fault cracks and animated charge use at most 44 cached
  64×64 textures. Rich overlays and simple distant tints have separate draw
  budgets. Status accents and lightning links are pooled and capped at 64/32
  live effects, with lower emission budgets at reduced quality.
* An adaptive quality step drops trails/particles if frame time climbs.
* The save file is the 1 MB health array deflated (~63 KB), primary ball
  snapshots, launch counts and other metadata.
