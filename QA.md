# Quality check (QA): how to use it

One command checks the whole guide and every 3D model it uses, then writes **`QA_REPORT.md`**: PASS or FAIL, plus the exact fix for each problem, written so an AI can follow it.

## One-time setup

Install **Node.js LTS** (free, from nodejs.org). On a managed computer, ask IT. Nothing else needs installing.

## The loop (every time the AI hands back files)

```
 ┌──────────────────────────────────────────────────────────────────────┐
 │ 1. Give the AI your materials + AI_EDITING_GUIDE.md                  │
 │ 2. Save the files it returns into this folder (replace the old ones) │
 │ 3. Double-click  qa.bat   (Mac: qa.command · Linux: ./qa.sh)         │
 │ 4. PASS? Done. Commit / open a pull request.                         │
 │    FAIL? QA_REPORT.md opens. Copy ALL of it and paste it to the AI   │
 │          with the prompt below. Go back to step 2.                   │
 └──────────────────────────────────────────────────────────────────────┘
```

**Prompt to paste with the report:**

```
Here is the QA report for the guide. Follow the "Instructions for the AI" section in it:
fix every ERROR exactly as described, keep all part names, step ids and safety gates,
and return the complete updated file(s). Then list any warnings you could not fix.

<paste QA_REPORT.md here>
```

The AI never runs anything. You run QA, it reads the report.

## Checking a new 3D model (e.g. a SolidWorks export)

Before anyone writes animations for a model, check the model on its own:

1. Export it: SolidWorks **File → Save As → Extended Reality (\*.glb)**, with Draco compression **off**. Or export STEP and convert it with `tools/step-to-glb.mjs` (see ASSEMBLY_ANIMATION_GUIDE.md).
2. **Drag the `.glb` file onto `qa.bat`** (or run `node tools/qa.mjs model.glb`).
3. Read the result:

| Result | What to do |
|---|---|
| `FIT-CLASH`: two parts overlap | **Real CAD problem:** send it to whoever owns the CAD. **Intended** fit (shaft in a hub, screw in a hole): add the pair to the allow-list (below) |
| `FIT-FLOAT`: a part touches nothing | Usually an unmated part in the CAD assembly: fix the mate and re-export. If it really hangs free (battery lead), add it to `floatingOK` |
| `MODEL-DRACO` | Re-export with Draco compression off |
| `MODEL-HEAVY` / `MODEL-SIZE` | Shrink the model (ASSEMBLY_ANIMATION_GUIDE.md → *Shrinking a heavy model*) |
| `MODEL-WHITE` | Give those parts a colour/appearance in CAD |
| `MODEL-NAMES` | Name the parts in CAD (one name per physical part) |
| PASS | Convert it with `tools/glb-to-js.mjs`, then give it to the AI with ASSEMBLY_ANIMATION_GUIDE.md |

Large models are slower to check. A 250k-triangle model takes about 35 seconds; the guide's placeholder takes under 2 seconds.

To see a model's part names (useful to paste to the AI): `node tools/qa.mjs --list-parts model.glb`

## Allow-list for intended fits

In `index.html`, `GUIDE.settings.qa`:

```js
qa: {
  allow: [["motor*", "prop*"]],                         // these pairs may overlap, in every model
  floatingOK: ["battery_lead"],                         // these parts may touch nothing
  models: { "f450": { allow: [["Arm?", "Body7"]] } }    // just for one model
}
```

Only list fits that are **intended in the real hardware**. Never use the allow-list to silence a real assembly mistake. Example: the bundled F450 CAD fails with "`Arm1` overlaps `Body7` by 10 mm", because its simplified centre block passes through the arms. That's a known simplification, so `["Arm?", "Body7"]` is the right fix.

## What gets checked

| Check | Catches |
|---|---|
| **Guide syntax** | Missing commas, unclosed quotes/brackets, curly quotes (“ ”). Reports the exact line |
| **Guide content** | Duplicate or missing step ids, misspelled fields (e.g. `chekcs` → "did you mean checks?"), steps without checkboxes, undefined `[[glossary]]` words, unknown diagram/panel types, broken IT-ticket fields |
| **Files** | Photos, media and models that don't exist, **or exist with different capitals** (`Motors.JPG` vs `motors.jpg`: works on Windows, breaks on a web server) |
| **3D animations** | Part names that aren't in the model ("did you mean motor1?"), unknown actions, unreadable directions, misspelled keys (`form` → `from`), unknown material presets |
| **Fit** | Parts that overlap (clash), parts that touch nothing (floating), standoffs/posts not seated at both ends |
| **Model hygiene** | File size, triangle count, plain-white materials, embedded lights, unnamed or duplicate part names |

**Warnings** (e.g. unresolved VERIFY notes, parts without photos, template ribbon still on) don't fail QA, but they're listed so nothing is forgotten before release.

`qa-report.json` holds the same results in machine-readable form, for automation later. Both report files are ignored by git.

## Troubleshooting

| Problem | Fix |
|---|---|
| "Node.js is not installed" | Install Node.js LTS (ask IT on a managed computer) |
| Mac says qa.command "can't be opened" | Right-click → **Open** the first time (macOS blocks downloaded scripts) |
| "STEP files must be converted first" | Run `tools/step-to-glb.mjs` first (needs `npm install occt-import-js` once) |
| QA itself crashes | Send the message to whoever maintains this repo. It's a bug in QA, not in your content |
