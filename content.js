/**
 * OpenFront Donor Calculator — in-page overlay.
 *
 * Responsibilities:
 *   1. Render a draggable, click-through-capable HUD element on top of the game.
 *   2. Track the player's troop counter and translate it into a donation hint.
 *   3. Stay in sync with the popup through `chrome.storage.local`.
 *
 * The overlay never mutates the game DOM: it only reads text nodes and appends a
 * single positioned container to <body>.
 */
(() => {
  'use strict';

  const { t } = globalThis.OFDC;
  const Settings = globalThis.OFDC_SETTINGS;

  const WIDGET_ID = 'ofdc-overlay';

  /** How often the troop counter is sampled, in milliseconds. */
  const SAMPLE_INTERVAL_MS = 400;
  /** Minimum delay between full DOM sweeps when the cached node is stale. */
  const RESCAN_COOLDOWN_MS = 1000;
  /** How long the previous hint stays on screen once the counter disappears. */
  const STALE_ADVICE_MS = 3000;
  /** Distance from the bottom used the first time the overlay is shown. */
  const DEFAULT_BOTTOM_OFFSET = 190;
  /** Portion of the overlay that must remain inside the viewport. */
  const MIN_VISIBLE_PX = 32;
  /**
   * Viewport size below which clamping is skipped. A window that is minimised,
   * still laying out, or hidden in a background tab reports a degenerate size;
   * clamping against it would collapse the saved position to the corner.
   */
  const MIN_CLAMPABLE_VIEWPORT_PX = 240;

  /**
   * Donation model: keep a defensive reserve of the troop cap and treat half of
   * the cap as the point where donating becomes worthwhile.
   */
  const RESERVE_RATIO = 0.35;
  const TARGET_RATIO = 0.50;
  /** Slider position used while accumulating: send as little as possible. */
  const SAVING_SLIDER_PERCENT = 1;

  /** How long the click acknowledgement stays on screen. */
  const FLASH_DURATION_MS = 280;

  const PALETTE = {
    ready: '#23d15d',
    saving: '#ff8904',
    dragging: '#ffb020',
    applied: '#63e6ff',
    error: '#ff4d4d',
    surface: 'rgba(29, 37, 47, 0.94)'
  };

  const BASE_SHADOW = '0 2px 8px rgba(0, 0, 0, 0.45)';

  /** `1.5K / 12.1K`, `903/2400`, `1.2M / 3M` — all game-side spellings. */
  const COUNTER_PATTERN = /(\d+(?:[.,]\d+)?)\s*([KM]?)\s*\/\s*(\d+(?:[.,]\d+)?)\s*([KM]?)/i;

  /** @type {HTMLDivElement|null} */
  let widget = null;
  /** @type {Element|null} Cached node that holds the troop counter. */
  let counterNode = null;
  /** @type {HTMLInputElement|null} Cached troop-ratio slider. */
  let sliderNode = null;
  /** Percentage currently advised, or `null` while accumulating. */
  let advisedPercent = null;
  let flashTimer = 0;
  /** Timestamp until which the click acknowledgement owns the border colour. */
  let flashUntil = 0;
  let lastRescanAt = 0;
  let lastAdviceAt = 0;
  let state = Settings.normalize(null);

  const dragSession = {
    active: false,
    pointerId: null,
    startClientX: 0,
    startClientY: 0,
    startOffset: 0,
    startTop: 0
  };

  /* ------------------------------------------------------------------ *
   * Overlay construction
   * ------------------------------------------------------------------ */

  function createWidget() {
    if (document.getElementById(WIDGET_ID)) return;

    widget = document.createElement('div');
    widget.id = WIDGET_ID;
    Object.assign(widget.style, {
      position: 'fixed',
      zIndex: '2147483000',
      padding: '6px 14px',
      backgroundColor: PALETTE.surface,
      border: `2px solid ${PALETTE.ready}`,
      borderRadius: '6px',
      color: PALETTE.ready,
      font: 'bold 16px/1.2 Arial, Helvetica, sans-serif',
      letterSpacing: '0.2px',
      whiteSpace: 'nowrap',
      userSelect: 'none',
      touchAction: 'none',
      boxShadow: BASE_SHADOW,
      transformOrigin: 'top left'
    });
    widget.textContent = t(state.lang).waiting;

    widget.addEventListener('pointerdown', beginDrag);
    widget.addEventListener('pointermove', continueDrag);
    widget.addEventListener('pointerup', endDrag);
    widget.addEventListener('pointercancel', endDrag);
    widget.addEventListener('click', onWidgetClick);

    // The overlay sits on top of the map, where a stray click would issue an
    // attack order. Every interaction with it stops here.
    for (const type of ['pointerdown', 'pointerup', 'mousedown', 'mouseup', 'click', 'dblclick', 'contextmenu']) {
      widget.addEventListener(type, (event) => event.stopPropagation());
    }

    document.body.appendChild(widget);
  }

  /* ------------------------------------------------------------------ *
   * Geometry
   * ------------------------------------------------------------------ */

  const defaultTop = () => Math.max(MIN_VISIBLE_PX, window.innerHeight - DEFAULT_BOTTOM_OFFSET);

  /**
   * Writes the current anchor, offset and scale onto the element.
   * The horizontal anchor mirrors `state.align`, so a viewport resize keeps the
   * overlay attached to the same screen edge instead of drifting.
   */
  function applyGeometry() {
    if (!widget) return;

    const { align, scale, position } = state;
    const top = position.top ?? defaultTop();

    widget.style.transformOrigin =
      align === 'center' ? 'top center' : align === 'right' ? 'top right' : 'top left';
    widget.style.transform =
      align === 'center' ? `translateX(-50%) scale(${scale})` : `scale(${scale})`;

    widget.style.top = `${top}px`;
    widget.style.bottom = 'auto';

    if (align === 'right') {
      widget.style.right = `${position.offset}px`;
      widget.style.left = 'auto';
    } else if (align === 'center') {
      widget.style.left = `calc(50% + ${position.offset}px)`;
      widget.style.right = 'auto';
    } else {
      widget.style.left = `${position.offset}px`;
      widget.style.right = 'auto';
    }
  }

  /**
   * Pulls the overlay back inside the viewport after a drag, an alignment
   * change or a window resize.
   *
   * @returns {boolean} `true` when the stored position had to be corrected.
   */
  function clampToViewport() {
    if (!widget || !state.visible) return false;
    if (window.innerWidth < MIN_CLAMPABLE_VIEWPORT_PX ||
        window.innerHeight < MIN_CLAMPABLE_VIEWPORT_PX) return false;

    const rect = widget.getBoundingClientRect();
    if (!rect.width || !rect.height) return false;

    const slackX = Math.max(0, window.innerWidth - rect.width);
    const maxTop = Math.max(0, window.innerHeight - Math.min(rect.height, MIN_VISIBLE_PX * 2));

    const offset = state.align === 'center'
      ? Settings.clamp(state.position.offset, -slackX / 2, slackX / 2)
      : Settings.clamp(state.position.offset, 0, slackX);
    const top = Settings.clamp(state.position.top ?? defaultTop(), 0, maxTop);

    const changed = offset !== state.position.offset || top !== state.position.top;
    state.position = { offset, top };
    if (changed) applyGeometry();
    return changed;
  }

  /* ------------------------------------------------------------------ *
   * Dragging
   * ------------------------------------------------------------------ */

  function beginDrag(event) {
    if (!state.unlocked || event.button !== 0) return;

    dragSession.active = true;
    dragSession.pointerId = event.pointerId;
    dragSession.startClientX = event.clientX;
    dragSession.startClientY = event.clientY;
    dragSession.startOffset = state.position.offset;
    dragSession.startTop = state.position.top ?? defaultTop();

    widget.setPointerCapture(event.pointerId);
    widget.style.cursor = 'grabbing';
    event.preventDefault();
  }

  function continueDrag(event) {
    if (!dragSession.active || event.pointerId !== dragSession.pointerId) return;
    moveTo(event);
  }

  /** Maps a pointer position onto the anchor-relative offsets. */
  function moveTo(event) {
    const dx = event.clientX - dragSession.startClientX;
    const dy = event.clientY - dragSession.startClientY;

    // A right-anchored overlay moves against the cursor delta by definition.
    state.position = {
      offset: state.align === 'right' ? dragSession.startOffset - dx : dragSession.startOffset + dx,
      top: dragSession.startTop + dy
    };
    applyGeometry();
  }

  function endDrag(event) {
    if (!dragSession.active || event.pointerId !== dragSession.pointerId) return;

    moveTo(event);
    dragSession.active = false;
    dragSession.pointerId = null;
    if (widget.hasPointerCapture(event.pointerId)) widget.releasePointerCapture(event.pointerId);
    widget.style.cursor = state.unlocked ? 'grab' : 'default';

    clampToViewport();
    persistPosition();
  }

  /** Persists the dragged position so locking the overlay no longer resets it. */
  function persistPosition() {
    Settings.patch({ position: { ...state.position } })
      .catch(() => { /* extension context invalidated; the overlay stays usable */ });
  }

  /* ------------------------------------------------------------------ *
   * Appearance
   * ------------------------------------------------------------------ */

  function applyAppearance() {
    if (!widget) return;

    widget.style.display = state.visible ? 'block' : 'none';
    widget.style.opacity = String(state.opacity);

    if (state.unlocked) {
      // Unlocked: the overlay must receive pointer events to be draggable.
      widget.style.pointerEvents = 'auto';
      widget.style.cursor = 'grab';
      widget.style.border = `2px dashed ${PALETTE.dragging}`;
    } else {
      // Locked: the overlay acts as a button that applies the advised percentage.
      widget.style.pointerEvents = 'auto';
      widget.style.cursor = 'pointer';
      widget.style.borderStyle = 'solid';
      widget.style.borderColor = widget.style.color || PALETTE.ready;
    }
  }

  /**
   * Applies a full settings record to the overlay.
   * @param {object} next Normalized settings.
   */
  function applySettings(next) {
    const alignChanged = next.align !== state.align;
    state = next;

    applyAppearance();
    applyGeometry();

    // Snapping to a new edge can push the overlay off-screen on narrow windows.
    if (alignChanged && clampToViewport()) persistPosition();

    tick();
  }

  /* ------------------------------------------------------------------ *
   * Troop counter tracking
   * ------------------------------------------------------------------ */

  /**
   * @param {string} value Digits with an optional decimal separator.
   * @param {string} suffix `K`, `M` or an empty string.
   * @returns {number}
   */
  function parseCompactNumber(value, suffix) {
    const magnitude = { K: 1e3, M: 1e6 }[suffix.toUpperCase()] ?? 1;
    return Number.parseFloat(value.replace(',', '.')) * magnitude || 0;
  }

  /** Formats a troop count the way the game's HUD does. */
  function formatCompactNumber(value) {
    if (value >= 1e6) return `${(value / 1e6).toFixed(2)}M`;
    if (value >= 1e3) return `${(value / 1e3).toFixed(1)}K`;
    return String(Math.floor(value));
  }

  /**
   * Elements that either carry no user-visible text or are prohibitively
   * expensive to walk.
   */
  const SKIPPED_TAGS = new Set(['script', 'style', 'noscript', 'template', 'svg', 'canvas', 'iframe']);

  /**
   * Reports whether an element is actually rendered. The game keeps HUD
   * fragments in the DOM after leaving a match, and those carry stale numbers —
   * without this check the overlay would happily latch onto a hidden leftover
   * and freeze on the values it held when the panel was hidden.
   *
   * @param {Element} element
   * @returns {boolean}
   */
  function isRendered(element) {
    if (typeof element.checkVisibility === 'function') {
      return element.checkVisibility({ contentVisibilityAuto: true, visibilityProperty: true });
    }
    const rect = element.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  /**
   * Text of a subtree including open shadow trees.
   *
   * `Node.textContent` stops at the shadow boundary, and the game renders its
   * HUD as web components, so plain `textContent` returns nothing useful once a
   * match is running.
   *
   * @param {Node} root
   * @returns {string}
   */
  function deepTextContent(root) {
    let text = '';
    for (const child of root.childNodes) {
      if (child.nodeType === Node.TEXT_NODE) {
        text += child.data;
      } else if (child.nodeType === Node.ELEMENT_NODE &&
                 child.id !== WIDGET_ID &&
                 !SKIPPED_TAGS.has(child.localName)) {
        if (child.shadowRoot) text += deepTextContent(child.shadowRoot);
        text += deepTextContent(child);
      }
    }
    return text;
  }

  /**
   * Single bottom-up pass that returns both the text of a subtree and the
   * deepest rendered element whose text contains the troop counter.
   *
   * Caching that element is what keeps sampling cheap: re-reading one small
   * node costs nothing, whereas `document.body.innerText` forces a full layout
   * on every tick.
   *
   * @param {Node} root
   * @returns {{text: string, match: Element|null}}
   */
  function scanForCounter(root) {
    let text = '';
    let match = null;

    for (const child of root.childNodes) {
      if (child.nodeType === Node.TEXT_NODE) {
        text += child.data;
        continue;
      }
      if (child.nodeType !== Node.ELEMENT_NODE ||
          child.id === WIDGET_ID ||
          SKIPPED_TAGS.has(child.localName)) {
        continue;
      }

      let childText = '';
      if (child.shadowRoot) {
        const shadow = scanForCounter(child.shadowRoot);
        childText += shadow.text;
        match ??= shadow.match;
      }
      const light = scanForCounter(child);
      childText += light.text;
      match ??= light.match;

      text += childText;
      // Only considered when no descendant matched, which yields the deepest hit.
      if (!match && COUNTER_PATTERN.test(childText) && isRendered(child)) match = child;
    }

    return { text, match };
  }

  /**
   * Returns the current/maximum troop pair, or `null` while the HUD is absent
   * (main menu, loading screen, spectator mode).
   *
   * @returns {{current: number, max: number}|null}
   */
  function readTroopCounter() {
    // A cached node is only trusted while it is attached and still rendered:
    // the HUD is torn down and rebuilt on every map transition.
    if (counterNode && !(counterNode.isConnected && isRendered(counterNode))) counterNode = null;

    let match = counterNode ? COUNTER_PATTERN.exec(deepTextContent(counterNode)) : null;

    if (!match) {
      const now = Date.now();
      if (now - lastRescanAt < RESCAN_COOLDOWN_MS) return null;
      lastRescanAt = now;

      counterNode = scanForCounter(document.body).match;
      match = counterNode ? COUNTER_PATTERN.exec(deepTextContent(counterNode)) : null;

      // Last resort: `innerText` is layout-based, so it sees rendered shadow
      // content the walk above may have missed in an exotic HUD layout.
      if (!match) {
        counterNode = null;
        match = COUNTER_PATTERN.exec(document.body.innerText);
      }
      if (!match) return null;
    }

    const current = parseCompactNumber(match[1], match[2]);
    const max = parseCompactNumber(match[3], match[4]);
    return max > 0 && current > 0 ? { current, max } : null;
  }

  /**
   * Recomputes the hint shown in the overlay.
   *
   * Below the reserve threshold the player is told how much to accumulate;
   * above it, the percentage the donation slider should be set to in order to
   * give away everything above the reserve.
   */
  function renderAdvice() {
    if (!widget || !state.visible) return;

    const strings = t(state.lang);
    const troops = readTroopCounter();

    if (!troops) {
      // Brief gaps happen while the HUD re-renders, so the last hint is kept for
      // a moment. Past that the counter is genuinely gone (menu, defeat screen)
      // and showing a stale number would be worse than showing nothing.
      if (Date.now() - lastAdviceAt > STALE_ADVICE_MS) {
        widget.textContent = strings.waiting;
        // No counter means no advice to apply; a click would act on stale data.
        advisedPercent = null;
      }
      return;
    }

    lastAdviceAt = Date.now();

    const reserve = troops.max * RESERVE_RATIO;
    const isSaving = troops.current <= reserve;

    if (isSaving) {
      // Still below the reserve: the right move is to give nothing away, so a
      // click parks the slider at its minimum.
      advisedPercent = SAVING_SLIDER_PERCENT;
      widget.textContent = `${strings.save} ${formatCompactNumber(troops.max * TARGET_RATIO)}`;
    } else {
      advisedPercent = Math.round(((troops.current - reserve) / troops.current) * 100);
      widget.textContent = `${strings.slider} ${advisedPercent}%`;
    }

    widget.style.color = isSaving ? PALETTE.saving : PALETTE.ready;
    if (!state.unlocked && Date.now() >= flashUntil) widget.style.borderColor = widget.style.color;
  }

  /* ------------------------------------------------------------------ *
   * Applying the advice to the game's donation slider
   * ------------------------------------------------------------------ */

  /**
   * Collects every range input on the page, including those inside open shadow
   * roots, which is where the game keeps its HUD controls.
   *
   * @param {ParentNode} root
   * @param {HTMLInputElement[]} [found]
   * @returns {HTMLInputElement[]}
   */
  function collectRangeInputs(root, found = []) {
    for (const input of root.querySelectorAll('input[type="range"]')) found.push(input);
    for (const element of root.querySelectorAll('*')) {
      if (element.shadowRoot) collectRangeInputs(element.shadowRoot, found);
    }
    return found;
  }

  /**
   * Resolves the troop-ratio slider. Hidden inputs are rejected, which rules out
   * sliders belonging to closed menus (audio settings and the like).
   *
   * @returns {HTMLInputElement|null}
   */
  function findSlider() {
    if (sliderNode?.isConnected && isRendered(sliderNode)) return sliderNode;
    sliderNode = collectRangeInputs(document.body).find(isRendered) ?? null;
    return sliderNode;
  }

  /**
   * Drives a range input from script the way a real user would.
   *
   * The value is written through the prototype's native setter because UI
   * frameworks cache the last value they wrote; assigning `input.value`
   * directly can leave that cache untouched and the change is then ignored.
   *
   * @param {number} percent Position to set, 0–100.
   * @returns {boolean} `false` when no usable slider exists.
   */
  function applyPercentToSlider(percent) {
    const input = findSlider();
    if (!input) return false;

    const min = Number.parseFloat(input.min) || 0;
    const max = Number.parseFloat(input.max) || 100;
    const step = Number.parseFloat(input.step) || 1;

    // The game's slider is already graduated in percent (1–100), so the advised
    // number maps onto it one-to-one. A 0–1 slider means the same quantity
    // expressed as a fraction; anything else is rescaled proportionally.
    let target;
    if (max <= 1.5) target = percent / 100;
    else if (max >= 90) target = percent;
    else target = min + (max - min) * (percent / 100);

    const snapped = Settings.clamp(min + Math.round((target - min) / step) * step, min, max);
    const value = String(Number(snapped.toFixed(4)));
    if (input.value === value) return true;

    const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input), 'value')?.set;
    if (setter) setter.call(input, value); else input.value = value;

    // `composed` lets the events cross the shadow boundary the slider lives in.
    for (const type of ['input', 'change']) {
      input.dispatchEvent(new Event(type, { bubbles: true, composed: true }));
    }
    return true;
  }

  /** Briefly tints the overlay's border to acknowledge a click. */
  function flash(color) {
    // The sampler repaints the border on every tick; hold it off until the
    // acknowledgement has been seen.
    flashUntil = Date.now() + FLASH_DURATION_MS;
    widget.style.borderColor = color;
    widget.style.boxShadow = `0 0 0 3px ${color}44, ${BASE_SHADOW}`;

    clearTimeout(flashTimer);
    flashTimer = setTimeout(() => {
      widget.style.boxShadow = BASE_SHADOW;
      tick();
    }, FLASH_DURATION_MS);
  }

  /**
   * Click-to-apply: sets the game's donation slider to the percentage currently
   * shown. Only active while the overlay is locked — unlocked, the pointer
   * belongs to dragging.
   */
  function onWidgetClick(event) {
    if (state.unlocked) return;
    event.preventDefault();

    if (advisedPercent === null) {
      flash(PALETTE.saving);
      return;
    }
    flash(applyPercentToSlider(advisedPercent) ? PALETTE.applied : PALETTE.error);
  }

  /* ------------------------------------------------------------------ *
   * Bootstrap
   * ------------------------------------------------------------------ */

  /**
   * Mirrors a settings change made elsewhere — in practice, by the popup.
   *
   * Storage is the only channel between the two: unlike `tabs.sendMessage` it
   * cannot target the wrong tab and it reaches every open game tab at once.
   */
  function onSettingsChanged(changes, area) {
    const change = area === 'local' ? changes[Settings.STORAGE_KEY] : null;
    if (!change) return;

    const next = Settings.normalize(change.newValue);

    // Our own position writes come back as a change event. Re-applying them is
    // harmless except mid-drag, where the pointer — not storage — is
    // authoritative.
    if (dragSession.active) next.position = state.position;

    applySettings(next);
  }

  /**
   * Reloading the extension orphans the content scripts of already-open tabs:
   * the overlay keeps running but its `chrome.*` bridge is dead, so the popup
   * can no longer reach it. Detect that and tell the player to reload.
   */
  function isExtensionAlive() {
    try {
      return Boolean(chrome.runtime?.id);
    } catch {
      return false;
    }
  }

  /** Periodic sampler; isolated so a DOM hiccup can never kill the timer. */
  function tick() {
    if (!isExtensionAlive()) {
      widget.textContent = '↻ F5';
      widget.style.color = PALETTE.saving;
      widget.style.borderColor = PALETTE.saving;
      return;
    }

    try {
      renderAdvice();
    } catch {
      // The HUD changed shape underneath us; drop the cache and retry later.
      counterNode = null;
    }
  }

  function init() {
    createWidget();

    // Registered before any work that could throw, so the popup can always
    // reach the overlay even if reading the game HUD fails.
    chrome.storage.onChanged.addListener(onSettingsChanged);
    window.addEventListener('resize', () => {
      if (clampToViewport()) persistPosition();
    });
    setInterval(tick, SAMPLE_INTERVAL_MS);

    Settings.load().then((stored) => {
      applySettings(stored);
      // Measure only once the overlay has actually been laid out.
      requestAnimationFrame(() => clampToViewport());
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})();
