# AI Editing Guide: filling this setup guide with real materials

> **For AI assistants.** You'll be given this repository's `index.html` plus materials (manuals, photos, parts lists, wiring diagrams, notes). Your job is to replace the template content with accurate content for that specific drone. Follow these rules exactly.

## Golden rules

1. **Edit only the `GUIDE` object** in the first `<script>` block of `index.html` (between `const GUIDE = {` and its closing `};`). Never edit the CSS or the ENGINE script unless explicitly asked.
2. **Never invent specs.** Pin numbers, port names, voltages, parameter names and values, torque, screw sizes: use only what the materials state. If the materials don't say, keep or add a `verify: "..."` note on that step describing exactly what's unknown.
3. **Keep it simple for the reader.** `body` = the minimum someone needs to do the step. Put background, theory and edge cases in `details`. One action per numbered item. Start step titles with a verb.
4. **Every step needs at least one check.** Checks are things the reader can physically confirm ("Arrow on the FC points forward"), not "I read this".
5. **Safety is never removed.** Keep props-off gates, LiPo warnings and antenna-before-power warnings. Add more if the materials call for them.
6. **Keep ids stable.** Step `id`s are used for saved progress and links. Change ids only when a step's meaning changes; use lowercase-with-dashes.
7. When finished, set `meta.placeholder: false`, fill in `meta` (drone name, organization, support contact), bump `meta.version`, and remove every `verify` note you've actually resolved.
8. Open `index.html?edit` and confirm the banner says **"No content problems found."**
9. **Write the IT ticket** for QGroundControl (see *IT ticket* below). It must be submittable as-is after the reader fills in the blanks.
10. **Every item in the box needs a photo.** The parts photos *are* the checklist: readers tap a photo to confirm they have that item.
11. **Your work is checked by an automatic QA tool** (see *Quality check* below). A human runs it and pastes the report back to you. Avoid the mistakes listed there.

## Quality check: what will make QA fail

A human runs `qa.bat` on your files. It **fails** on any of these, so check before you hand files back:

| Mistake | Avoid it by |
|---|---|
| Missing comma, unclosed quote or bracket, **curly quotes** (“ ” ‘ ’) | Use straight quotes `"` only; put a comma after every item except the last |
| Unknown or misspelled field (`chekcs`, `form`, `colour`) | Use only the field names in this guide and ASSEMBLY_ANIMATION_GUIDE.md. Unknown fields fail QA, they are not ignored |
| Two steps with the same `id`, or a step with no `checks` | Unique lowercase-with-dashes ids; at least one physical check per step |
| `[[term]]` not defined in `GUIDE.glossary` | Add every term you bracket to the glossary |
| A photo/model path that doesn't exist, or wrong capitals (`Motor.JPG` vs `motor.jpg`) | Copy file names exactly; leave `image: ""` if you have no photo (that's only a warning) |
| An animation part name that isn't in the model | Only use names from the model's part list. **Ask the human to run `node tools/qa.mjs --list-parts <model>`** if you don't have it. Never guess part names |
| Unknown animation action, direction, ease or material preset | Use only the values listed in ASSEMBLY_ANIMATION_GUIDE.md |
| `{{f.field}}` in an IT ticket with no matching field | Every `{{f.x}}` needs `{ key: "x", label: "..." }` in `fields` |
| **FIT-CLASH / FIT-FLOAT** on a real CAD model | You **cannot** fix CAD. Don't move or resize parts. Tell the human which parts need fixing in CAD. Only if the human confirms the fit is intended, add the pair to `GUIDE.settings.qa.allow` |

**When you receive a QA report:** follow its *Instructions for the AI* section. Fix every ERROR exactly as its `Fix:` line says, change nothing else, and return complete files. Then fix the warnings you can, and list the ones you couldn't (e.g. VERIFY notes that need information you don't have).

## Structure

```js
const GUIDE = {
  meta:     { id, title, drone, organization, support, version, updated, placeholder },
  settings: { requireChecks, allowSkip, stickMode, rcMap, cells },
  parts:    [ { id, name, qty, image, note, group } ],   // group: "part" (default) or "tool" (optional)
  glossary: { "Term": "Plain-English definition" },
  phases:   [ { id, title, icon, summary, steps: [ step, ... ] } ]
};
```

### Step fields

| Field | Type | Notes |
|---|---|---|
| `id` | string, **required, unique** | `"mount-motors"` |
| `title` | string, **required** | Verb first, ≤ 50 chars |
| `time` | string | `"10 min"` |
| `level` | `"easy"` \| `"medium"` \| `"hard"` | |
| `warnings` | `[{ level, text }]` | level: `danger` (injury/fire/damage), `caution` (likely mistake), `info`, `tip` |
| `media` | `[{ type, src, alt, caption }]` | type `image` or `video`. `src: ""` shows a labelled placeholder; keep those as TODO markers for photos you don't have. YouTube URLs auto-embed. |
| `body` | rich text | The core instructions |
| `details` | rich text | Shown under "More detail" |
| `diagram` / `diagrams` | object / array | One diagram, or several in order (e.g. a 3D animation then a 2D wiring map). See *Diagrams* |
| `live` | string[] | Live data panels: `link`, `heartbeat`, `rc`, `sticks`, `attitude`, `gps`, `battery`, `messages` |
| `checks` | array | `"text"` or `{ text, auto }`. `auto` ticks itself when a real drone is connected: `link`, `px4`, `disarmed`, `rc`, `attitude`, `gps3d`, `battery` |
| `checklistFrom` | `"parts"` | Adds one checkbox per entry in `GUIDE.parts` |
| `gate` | `{ title, text, confirm }` | Full-stop safety acknowledgement before the step is shown |
| `troubleshoot` | `[{ q, a }]` | `q` = the symptom in the reader's words; `a` = rich text fix |
| `links` | `[{ label, url }]` | External docs |
| `verify` | string | Editor-only note. Visible in `?edit` mode only |

### Rich text

A plain string, or an array whose items are:

| Item | Renders as |
|---|---|
| `"text"` | paragraph |
| `["a", "b"]` | bullet list |
| `{ ol: ["a", "b"] }` | numbered list |
| `{ h: "Heading" }` | sub-heading |
| `{ note: "text" }` | small grey note |
| `{ code: "text" }` | code block |
| `{ table: [["H1","H2"],["c1","c2"]] }` | table (first row = header) |
| `{ copy: { id, label, fields, text } }` | fill-in-the-blanks text with a **Copy ticket** button (see *IT ticket*) |

Inline markup inside any text: `**bold**`, `*italic*`, `` `code` ``, `[label](https://url)`, `[[glossary term]]` or `[[term|shown text]]`, and tokens `{{drone}}`, `{{support}}`, `{{vtx}}` (the reader's chosen video channel).

Every `[[term]]` must exist in `GUIDE.glossary` (case-insensitive). Editor mode flags missing ones.

### Diagrams

| `type` | Options |
|---|---|
| `quadX` | `mode: "motors"` or `"props"`; optional `motors: [{ n, x, y, dir }]` (x: 1 = right, y: -1 = front; dir `CW`/`CCW`) for other layouts |
| `wiring` | `focus: ["fc","esc",...]` highlights parts. Optional `components: [{ id, label, x, y, w, h, note }]` in a 640×375 space and `links: [{ from, to, kind, label, dx, dy }]` (kind: `power`, `signal`, `data`, `video`) to redraw for a different kit |
| `vtx` | `recommended: { band, ch }`, optional `bands: ["R","F"]` |
| `sticks` | `mode: 1` or `2` (live when connected) |
| `parts` | renders `GUIDE.parts` as a photo grid. On a step with `checklistFrom: "parts"`, **each photo is a tap-to-confirm checkbox** with a "Missing?" flag. Missing items are shown with the support contact and listed in the printed report |
| `assembly3d` | animated 3D assembly: parts glide into place. **Full spec: [ASSEMBLY_ANIMATION_GUIDE.md](ASSEMBLY_ANIMATION_GUIDE.md)** |

## What's in the box (parts photos)

- One entry per physical item the reader should find, **including tools** (all tools ship in the box). Tools get `group: "tool"` and are shown under their own heading (`settings.partGroups` sets the heading text).
- `image`: a clear photo of that exact item, ideally on a plain background, 4:3. Relative paths (`img/parts/motor.jpg`) need the `img` folder shipped next to `index.html`. Leave `""` only if no photo exists; it shows a labelled placeholder, so add a `verify` note.
- `name` should match what's printed on the packaging or bag label, so the reader can match it.
- `qty` = how many the reader should count.

## IT ticket (QGroundControl)

Readers can't install software on managed computers, so step `qgc-install` gives them a pre-filled IT ticket to copy. It's a `{ copy: ... }` rich-text block:

```js
{copy: {
  id: "qgc-ticket",                       // unique; also used to save what the reader typed
  label: "IT ticket: QGroundControl install",
  fields: [                               // inputs shown above the text; {{f.key}} in text is replaced live
    { key: "name", label: "Your name" },
    { key: "os",   label: "Operating system", options: ["Windows", "macOS", "Linux"] }   // options = dropdown
  ],
  text: [ "Subject: ...", "", "Requester: {{f.name}}", "..." ]   // one array item per line; {{drone}} also works
}}
```

When adapting it for an organisation:
1. Match the organisation's ticket system: subject line style, required fields (cost centre, asset tag, approver...) and the category ("Software request").
2. Keep the **business justification** and **technical notes for IT**: USB serial access, internet for firmware downloads, Linux `dialout`/ModemManager notes.
3. If the materials name an approved-software catalogue entry or a self-service portal, mention it in the step body. The block itself stays copy/paste text.
4. Empty fields appear as `[Field label]` in the copied text, so the ticket stays readable even if a field is skipped.
5. Re-check the official download URL and license. Remove the step's `verify` note only after confirming them.

## 3D assembly animations

If the materials include a 3D model, add `assembly3d` diagrams to the build steps. Follow **[ASSEMBLY_ANIMATION_GUIDE.md](ASSEMBLY_ANIMATION_GUIDE.md)**: convert STEP files with `node tools/step-to-glb.mjs` (GLB files skip this), wrap and list part names with `node tools/glb-to-js.mjs`, then write `steps` using those names. **Map CAD motor names to PX4 numbers from their positions** (`examples/f450/` shows how), and never assume the CAD numbering matches. Until a real model exists, the template uses the procedural `placeholder-quad`.

## Workflow to follow

1. Read all materials. List the kit's actual parts and replace `GUIDE.parts`.
2. Walk the template phase by phase. For each step: keep, rewrite, split, or delete it, and add steps the materials need (e.g. soldering a specific board).
3. Replace placeholder media `src: ""` and every part `image: ""` with real image paths where provided; otherwise leave the placeholder with a descriptive `caption` and a `verify` note.
4. Rewrite the IT ticket for the organisation (see *IT ticket*).
5. If a 3D model is provided, convert it and update each `assembly3d` diagram (`model` + part names).
6. If the wiring differs, override `components`/`links` in the `wiring` diagram rather than describing it only in text.
7. Resolve or add `verify` notes. Then report back to the human with a list of **remaining `verify` items** and anything in the materials that contradicted the template.

## Prompt you can paste into another AI

```
You are editing a single-file interactive drone setup guide (index.html, attached),
using the materials I've attached. Follow AI_EDITING_GUIDE.md exactly: edit only the
GUIDE object, never invent specs (add `verify` notes instead), keep all safety gates,
keep body text simple and move extra info to `details`. Give every parts-list item a
photo, write the QGroundControl IT ticket for our organisation, and if a 3D model is
attached, follow ASSEMBLY_ANIMATION_GUIDE.md to add assembly animations. Avoid every
mistake in the "Quality check" table: your output will be checked by a QA tool.
Return the full updated index.html, then a list of remaining verify items and any
contradictions.
```
