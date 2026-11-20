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

## Structure

```js
const GUIDE = {
  meta:     { id, title, drone, organization, support, version, updated, placeholder },
  settings: { requireChecks, allowSkip, stickMode, rcMap, cells },
  parts:    [ { id, name, qty, image, note } ],
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
| `diagram` | object | See *Diagrams* |
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

Inline markup inside any text: `**bold**`, `*italic*`, `` `code` ``, `[label](https://url)`, `[[glossary term]]` or `[[term|shown text]]`, and tokens `{{drone}}`, `{{support}}`, `{{vtx}}` (the reader's chosen video channel).

Every `[[term]]` must exist in `GUIDE.glossary` (case-insensitive). Editor mode flags missing ones.

### Diagrams

| `type` | Options |
|---|---|
| `quadX` | `mode: "motors"` or `"props"`; optional `motors: [{ n, x, y, dir }]` (x: 1 = right, y: -1 = front; dir `CW`/`CCW`) for other layouts |
| `wiring` | `focus: ["fc","esc",...]` highlights parts. Optional `components: [{ id, label, x, y, w, h, note }]` in a 640×375 space and `links: [{ from, to, kind, label, dx, dy }]` (kind: `power`, `signal`, `data`, `video`) to redraw for a different kit |
| `vtx` | `recommended: { band, ch }`, optional `bands: ["R","F"]` |
| `sticks` | `mode: 1` or `2` (live when connected) |
| `parts` | renders `GUIDE.parts` as a photo grid |

## Workflow to follow

1. Read all materials. List the kit's actual parts and replace `GUIDE.parts`.
2. Walk the template phase by phase. For each step: keep, rewrite, split, or delete it, and add steps the materials need (e.g. soldering a specific board).
3. Replace placeholder media `src: ""` with real image paths where provided; otherwise leave the placeholder with a descriptive `caption`.
4. If the wiring differs, override `components`/`links` in the `wiring` diagram rather than describing it only in text.
5. Resolve or add `verify` notes. Then report back to the human with a list of **remaining `verify` items** and anything in the materials that contradicted the template.

## Prompt you can paste into another AI

```
You are editing a single-file interactive drone setup guide (index.html, attached),
using the materials I've attached. Follow AI_EDITING_GUIDE.md exactly: edit only the
GUIDE object, never invent specs (add `verify` notes instead), keep all safety gates,
keep body text simple and move extra info to `details`. Return the full updated
index.html, then a list of remaining verify items and any contradictions you found.
```
