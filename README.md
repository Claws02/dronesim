# Interactive Drone Setup Guide (template)

A single-file, offline-capable, interactive setup guide for building and configuring a **PX4 quadcopter** with an **ExpressLRS radio**, **analog FPV video** and **QGroundControl**.

Send someone `index.html` and they open it in a browser. That's the whole install.

## What the reader gets

| Feature | What it does |
|---|---|
| Step-by-step wizard | 8 phases, 38 steps. Each step must have its boxes ticked before **Next** unlocks. |
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

- **Easiest:** send `index.html` by email, chat or USB stick. It works from `file://`, fully offline (fonts fall back to system fonts).
- **Hosted:** enable GitHub Pages on this repo (Settings → Pages → deploy from branch). The guide is then at `https://<user>.github.io/<repo>/`.
- **Images:** if you add photos as files (e.g. `img/frame.jpg`), send the folder along with `index.html`, or host it.

## Editing the content

**All content lives in one `GUIDE` object near the top of `index.html`.** The engine below it never needs to change.

- Humans: see the field reference in the comment block above `const GUIDE`.
- AI assistants: give them **[AI_EDITING_GUIDE.md](AI_EDITING_GUIDE.md)** plus your materials (manuals, photos, wiring diagrams, parts list).
- Open **`index.html?edit`** to see step ids, every ⚑ VERIFY note, and automatic content checks (duplicate ids, undefined glossary terms, unknown diagram types…).

## Status of the template content

The bundled content is **generic placeholder content** for a typical PX4 quad. It shows a "Template" ribbon until `meta.placeholder` is set to `false`. Items that change between PX4/QGC versions or between kits are marked with `verify:` notes (17 at the moment). Resolve them against your exact hardware and firmware before handing the guide to real builders. In particular:

- Whether your PX4 build includes CRSF (`crsf_rc`) support for ELRS receivers, and the exact parameters.
- Flight-controller port names, ESC protocol, power-module calibration.
- Regional rules (registration, Remote ID, VTX licensing and power).

## Tech notes

- Plain HTML, CSS and vanilla JS. No build step and no dependencies.
- The live link uses the Web Serial API and parses MAVLink v1/v2 frames (CRC-validated) for HEARTBEAT, SYS_STATUS, GPS_RAW_INT, ATTITUDE, RC_CHANNELS and STATUSTEXT. It sends a GCS heartbeat once per second and **never writes parameters or commands**.
- Only one program can hold the USB port at once, so close QGroundControl before using the live check.
