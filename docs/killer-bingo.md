# Killer Bingo — Feature Design

## Concept

Each player has a stick figure avatar displayed in a shared arena. Five positions on their bingo board are "danger positions": the 4 corners and the center cell. When a called number matches one of those positions, the player loses that limb. The avatar visually dismembers as the game progresses.

## Danger positions

Fixed board indices (flat 0–24):

| Index | Position | Limb |
|---|---|---|
| 0 | Top-left corner | Left arm |
| 4 | Top-right corner | Right arm |
| 12 | Center | Head |
| 20 | Bottom-left corner | Left leg |
| 24 | Bottom-right corner | Right leg |

Since boards are randomized, each player has a unique set of 5 danger numbers — no server-side assignment needed.

## Gameplay modes discussed

### A. Visual only (cosmetic layer)
Limb drops are purely visual. No gameplay consequence.
- Pro: zero rule change, easy to build, adds personality
- Con: novelty wears off quickly since losing limbs means nothing

### B. Elimination mode (recommended)
Lose all 5 limbs → cannot claim bingo that round.
- Adds real tension on every number call ("please not my corner")
- One extra server check: block bingo claim if player has 0 limbs remaining
- Creates two layers of drama: race to bingo + survival

### C. Survival bonus
Last player with any limbs at end of round earns a point alongside the bingo winner.
- Two win conditions per round
- Requires cross-round scoring (not yet built)

### D. Limb handicap
Each lost limb lowers the required line length (e.g. 4-in-a-row instead of 5).
- Helps dismembered players catch up
- More complex win validation

## Recommended path

1. Build visual layer first (stick figures + limb-drop animation) — see how it feels in play
2. Add elimination mode on top (single server check) — this is what makes it "killer"

## Implementation plan

### Server
- Add one query in `getRoomState` to fetch all players' boards
- Return `dangerNumbers: { [playerId]: [n1, n2, n3, n4, n5] }` in room-state payload
- For elimination mode: in `POST /api/boards/:boardId/bingo`, check if player has ≥1 limb remaining before accepting the claim

### Client
- New avatar strip section (below players strip)
- One SVG stick figure per player, player name underneath
- On every state update: compare each player's `dangerNumbers` against `calledNumbers` → mark hit limbs
- CSS animation: hit limb rotates and flies off with a comic impact flash (fires once, tracked to avoid re-triggering on re-render)

### Stick figure parts (SVG)
```
    O       head   (center, index 12)
    |
 \  |  /    arms   (top-left index 0, top-right index 4)
    |
   / \       legs   (bottom-left index 20, bottom-right index 24)
```

## Current state (shipped)

- SVG stick figures per player, positioned below the winner banner inside `.board-column`
- `dangerNumbers` sent in `room-state` payload from server (corners + center of each player's board)
- Limbs animate off on `number-called` event using CSS keyframe (`limb-drop`)
- `droppedLimbs` Set prevents re-triggering on re-render
- Elimination mode live: bingo claim blocked server-side if all 5 danger numbers have been called
- Game reset clears `droppedLimbs` and wipes avatar DOM so figures restore fresh
- Shared floor line: `border-bottom` on `.avatar-arena` acts as the stage surface

---

## Phase 2 — Comic character sprites (planned)

Replace SVG stick figures with layered PNG character art. 10 unique characters assigned per player.

### Approach: separate layer PNGs (Option A)

Each character = 6 separate PNG files, all the **same canvas size** (200×280px), each part positioned exactly where it sits on the assembled character. Overlaying all 6 at (0,0) produces the complete figure.

| File | Content |
|---|---|
| `[char]-torso.png` | chest + hips only, no head/arms/legs |
| `[char]-head.png` | head from neck up, top-center of canvas |
| `[char]-arm-l.png` | full left arm from shoulder, left side |
| `[char]-arm-r.png` | full right arm from shoulder, right side |
| `[char]-leg-l.png` | full left leg from hip, bottom-left |
| `[char]-leg-r.png` | full right leg from hip, bottom-right |

### 10 characters

| # | Character | Description |
|---|---|---|
| 1 | ninja | black outfit, white headband, angry eyes, sandals |
| 2 | pirate | eyepatch, tricorn hat, hook hand |
| 3 | robot | boxy metallic body, glowing eyes |
| 4 | wizard | tall hat, robes, long beard |
| 5 | knight | full armour, small visor |
| 6 | cowboy | hat, boots, sheriff badge |
| 7 | zombie | torn clothes, green skin |
| 8 | astronaut | white spacesuit, helmet |
| 9 | caveman | fur loincloth, club |
| 10 | superhero | cape, mask, fist raised |

### AI generation prompts

**Step 1 — Full body reference (per character):**
```
Comic book character, white background, thick black outlines, flat 2-color fill.
Chunky cartoon proportions, full body, front-facing, arms slightly out, legs apart.
Character: [NAME] — [DESCRIPTION].
Style: vintage comic, no gradients, no shadows. 200x280px.
```

**Step 2 — Each part (same template, vary PART line):**
```
Comic book character body part, white background, thick black outlines, flat 2-color fill.
Canvas size: 200x280px. Draw ONLY the [PART] of this character,
positioned exactly where it sits on a 200x280px full body.
All other areas must be pure white (empty).
Character style: [NAME] — [DESCRIPTION], same art style as reference.
No shadows, no gradients.
Part to draw: [PART — positioning description]
```

Parts to generate per character:
- Head only — from neck up, top-center of canvas
- Torso only — chest + hips, no head/arms/legs, center of canvas
- Left arm — full arm from shoulder, left side of canvas
- Right arm — full arm from shoulder, right side of canvas
- Left leg — full leg from hip, bottom-left of canvas
- Right leg — full leg from hip, bottom-right of canvas

**Step 3:** Run all PNGs through remove.bg for transparent backgrounds.

**Step 4:** Name as `ninja-torso.png`, `ninja-head.png`, `ninja-arm-l.png` etc.

### CSS implementation plan (pending art)

- Each player is assigned a character index (0–9) based on join order
- Avatar container uses `position: relative`; each part is `position: absolute; top: 0; left: 0`
- When a limb is lost: CSS animation flies that `<img>` off, then `display: none`
- Minor per-character `top/left` offset tweaks in a config object to correct AI alignment
- On game reset: all parts restore to visible, positioned state

### Open questions
- Does the host see the same arena as players? (yes, same room-state)
- Should the limb-drop trigger a shared sound effect?
- Cross-round: avatars reset on game reset ✅ (already implemented)
