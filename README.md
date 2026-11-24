# Interactive Drone Setup Guide (template)

A single-file, offline-capable, interactive setup guide for building and configuring a **PX4 quadcopter** with an **ExpressLRS radio**, **analog FPV video** and **QGroundControl**.

Send someone the folder (or just `index.html`) and they open it in a browser. That's the whole install.

## What the reader gets

| Feature | What it does |
|---|---|
| Step-by-step wizard | 8 phases, 38 steps. Each step must have its boxes ticked before **Next** unlocks. |
| Photo parts check | "What's in the box" (parts and tools) is a grid of photos. Tap a photo when you find the item, or flag it **Missing?**. Missing items show the support contact and appear in the report. |
| IT ticket for QGroundControl | A fill-in-the-blanks ticket that updates as you type, with a **Copy ticket** button to paste into any IT system. |
| 3D assembly animations | Build steps show the parts gliding into place on a 3D model, with guide lines, highlights, callouts, captions, play/scrub/step controls and drag-to-rotate. |
| Simple / Detailed toggle | Simple by default; "More detail" sections open automatically in Detailed mode. |
| Safety gates | Steps like the motor test require an explicit "props are off" confirmation first. |
| Glossary pop-ups | Dotted-underlined words (ESC, VTX, CRSF…) explain themselves on tap. |
| Interactive diagrams | PX4 Quad X motor order and spin direction (with a "play test order" animation), a tap-to-explore wiring diagram, a 5.8 GHz channel picker, and stick-mode gimbals. |
| Live hardware checks | In Chrome or Edge, **Connect drone** reads MAVLink over USB (Web Serial). It shows autopilot, arming state, live sticks, an artificial horizon, GPS, battery and PX4 messages, and auto-ticks the matching boxes. It is read-only, and Demo mode simulates the data. |
| Progress save and resume | Saved automatically in the browser (localStorage). Can be exported to and imported from a file. |
| Printable report | **Print / save as PDF** gives a completion certificate, every step's status and time, the reader's notes, and signature lines. |
| Deep links | `index.html#actuators` opens straight to a step. |
| Search | Press `/` to search all steps. |
| Mobile friendly | Works on phones (live checks need a desktop browser). |

## Sharing it

- **Easiest:** send the whole folder (zip it). Double-click `index.html` and it works fully offline. `index.html` alone also works, but without the 3D animations: those need `assembly3d.js`, `vendor/` and `models/` next to it.
- **Hosted:** enable GitHub Pages on this repo (Settings → Pages → deploy from branch). The guide is then at `https://<user>.github.io/<repo>/`.
- **Images:** if you add photos as files (e.g. `img/frame.jpg`), send the folder along with `index.html`, or host it.

## 3D assembly animations

- `assembly3d.js` is the player, `vendor/three.bundle.js` is three.js r187 (MIT, see `vendor/THREE_LICENSE.txt`), and `models/` holds the models.
- **[ASSEMBLY_ANIMATION_GUIDE.md](ASSEMBLY_ANIMATION_GUIDE.md)** is the full spec. Animations are plain data: "insert `motor*` from `up`, stagger 0.3 s".
- **`assembly-studio.html`**: open a `.glb`, see every part name and size, click parts to identify them, edit an animation and watch it live, and export an offline model file.
- **`tools/glb-to-js.mjs`**: `node tools/glb-to-js.mjs drone.glb drone --out models/drone.glb.js` wraps a CAD export for offline use (`--list` prints part names).
- Until real CAD arrives, a procedural placeholder quad (`models/placeholder-quad.js`) uses realistic part names.
- **`tools/step-to-glb.mjs`**: converts **STEP** files straight from CAD into an animatable GLB, keeping part names (`npm install occt-import-js` once).
- **Tested on real CAD:**
  - `examples/f450/`: an F450 frame from a real Fusion STEP (MIT). Every body is named, so each piece moves on its own. **This is the best reference.**
  - `examples/x500/`: the Holybro X500 from PX4's official Gazebo models (BSD-3).
  - Both are in Assembly Studio's examples list. See *Lessons from testing with real CAD* in the animation guide.

## Editing the content

**All content lives in one `GUIDE` object near the top of `index.html`.** The engine below it never needs to change.

- Humans: see the field reference in the comment block above `const GUIDE`.
- AI assistants: give them **[AI_EDITING_GUIDE.md](AI_EDITING_GUIDE.md)** plus your materials (manuals, photos, wiring diagrams, parts list).
- Open **`index.html?edit`** to see step ids, every ⚑ VERIFY note, and automatic content checks (duplicate ids, undefined glossary terms, unknown diagram types…).

## Status of the template content

The bundled content is **generic placeholder content** for a typical PX4 quad. It shows a "Template" ribbon until `meta.placeholder` is set to `false`. Items that change between PX4/QGC versions or between kits are marked with `verify:` notes (18 at the moment, including the IT ticket and parts photos). Resolve them against your exact hardware and firmware before handing the guide to real builders. In particular:

- Whether your PX4 build includes CRSF (`crsf_rc`) support for ELRS receivers, and the exact parameters.
- Flight-controller port names, ESC protocol, power-module calibration.
- Regional rules (registration, Remote ID, VTX licensing and power).

## Tech notes

- Plain HTML, CSS and vanilla JS. No build step. The only dependency is the bundled three.js, used just for the 3D views and loaded on demand.
- The live link uses the Web Serial API and parses MAVLink v1/v2 frames (CRC-validated) for HEARTBEAT, SYS_STATUS, GPS_RAW_INT, ATTITUDE, RC_CHANNELS and STATUSTEXT. It sends a GCS heartbeat once per second and **never writes parameters or commands**.
- Only one program can hold the USB port at once, so close QGroundControl before using the live check.
