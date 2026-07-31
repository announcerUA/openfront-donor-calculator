# OpenFront Donor Calc Pro

A Chrome extension for [openfront.io](https://openfront.io/) that tells you **exactly what to set the troop slider to** when donating to an ally — and sets it for you with one click.

The game shows how many troops you have. It does not tell you how many you can afford to give away. This overlay does the arithmetic every 400 ms and keeps a single number on screen.

---

## What it does

The overlay reads your troop counter (`4.85K / 13.4K`) from the game HUD and shows one of two hints:

| Overlay | Meaning |
| --- | --- |
| 🟢 `Slider: 49%` | You are above the reserve. Set the donation slider to 49% to give away everything above it. |
| 🟠 `Save up: 6.7K` | You are below the reserve. Keep accumulating until you reach this number. |

**Click the overlay to apply the number to the game's slider.** In `Save up` mode the click parks the slider at 1% instead, so nothing leaves your stockpile while you rebuild.

A short border flash confirms what happened:

- **cyan** — the slider was set;
- **orange** — nothing to apply (no counter on screen yet);
- **red** — no slider was found on the page.

### The model

- **Reserve — 35% of your troop cap.** Never donate below this; it is what you need to hold your borders.
- **Target — 50% of your troop cap.** The point at which donating becomes worthwhile.

Both live at the top of `content.js` as `RESERVE_RATIO` and `TARGET_RATIO`. Change them there if you play a different style.

---

## Install

The extension is not on the Chrome Web Store — load it from source:

1. Download or clone this repository.
2. Open `chrome://extensions`.
3. Turn on **Developer mode** (top right).
4. Click **Load unpacked** and select the project folder.
5. Open [openfront.io](https://openfront.io/) and start a match.

> **After updating the extension, reload the game tab.** Chrome leaves the old script running in tabs that were already open; it loses contact with the extension and the popup can no longer reach it. If that happens the overlay shows `↻ F5` — press F5.

---

## Settings

Click the extension icon.

| Control | Effect |
| --- | --- |
| **Enable / Disable Widget** | Shows or hides the overlay. |
| **Unlock** | Makes the overlay draggable. Drag it anywhere; the position is saved. |
| **Lock** | Fixes the overlay in place and turns it into the click-to-apply button. |
| **Screen Position** | Snaps the overlay to the left, centre or right edge and anchors it there, so it keeps its place when the window is resized. |
| **Opacity** | 20–100%. |
| **Size** | 50–150%. |
| **⚙ (gear)** | Language picker — 38 languages, the same list the game ships. |

Settings live in `chrome.storage.local` and apply instantly to every open game tab.

Note that a locked overlay is **not** click-through: clicks on it are consumed rather than passed to the map, otherwise clicking the overlay would issue an attack order underneath it. The overlay is small, and clicks anywhere else reach the game normally.

---

## How it works

**Finding the counter.** The game HUD is built from web components, so its text is inside shadow roots — `textContent` cannot see it. The extension walks the light DOM and every open shadow root in one bottom-up pass, takes the deepest element whose text contains a `current / max` pair, and requires it to be actually rendered (leftover hidden HUD fragments hold stale numbers). That element is cached, so subsequent samples read one small node instead of forcing a full-page layout. `document.body.innerText` remains as a last-resort fallback.

**Setting the slider.** The value is written through the native `HTMLInputElement.value` setter rather than by plain assignment — UI frameworks cache the last value they wrote and would otherwise ignore the change — and followed by `input` and `change` events with `composed: true` so they cross the shadow boundary. The slider's own `min`/`max`/`step` decide how the percentage is mapped.

**Position.** Stored as an offset from the active anchor (left edge, centre, or right edge) rather than absolute coordinates, so the overlay stays glued to its edge across window resizes, and clamped back into view if it would land off-screen.

---

## Files

| File | Purpose |
| --- | --- |
| `manifest.json` | Manifest V3. One permission: `storage`. |
| `content.js` | The overlay: rendering, dragging, counter tracking, click-to-apply. |
| `settings.js` | Settings schema, validation, and read-modify-write persistence shared by both sides. |
| `i18n.js` | Language catalogue and string tables for 38 locales. |
| `popup.html` / `popup.css` / `popup.js` | The settings panel. |
| `icons/` | Extension icons. |

The popup and the content script never message each other directly. Both read and write the same `chrome.storage.local` record and react to `chrome.storage.onChanged`, which cannot target the wrong tab and reaches every open game tab at once.

---

## Compatibility

Chrome and Chromium-based browsers (Edge, Brave, Opera) with Manifest V3 support. Requires open shadow roots in the game HUD, which is what OpenFront currently uses.

---

## Licence

Apache-2.0 license.
