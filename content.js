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
  /** Same, while the page does not look like a running match. */
  const IDLE_RESCAN_COOLDOWN_MS = 4000;

  /* Zone marker geometry. */
  const MARKER_ID = 'ofdc-bar-marker';
  const MARKER_HEIGHT_PX = 4;
  /** Clearance between the strip and the game's bar, so nothing is covered. */
  const MARKER_GAP_PX = 3;
  /** How far the position pin sticks out above and below the strip. */
  const MARKER_PIN_OVERHANG_PX = 3;
  /** Ancestors examined above the counter when looking for the bar. */
  const BAR_SEARCH_DEPTH = 10;
  /** Narrower elements than this are text boxes, not progress bars. */
  const MIN_BAR_WIDTH_PX = 80;
  /** Height bounds of a single HUD row. */
  const MIN_BAR_HEIGHT_PX = 8;
  const MAX_BAR_HEIGHT_PX = 64;
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
  /** Clicks in one burst that toggle auto-follow mode. */
  const AUTO_TOGGLE_CLICKS = 3;
  /** Longest pause allowed between clicks of the same burst. */
  const BURST_WINDOW_MS = 600;

  const PALETTE = {
    ready: '#23d15d',
    saving: '#ff8904',
    dragging: '#ffb020',
    /** Auto-follow mode. Replaces the state colours outright — see below. */
    auto: '#3b9eff',
    applied: '#63e6ff',
    error: '#ff4d4d',
    surface: 'rgba(29, 37, 47, 0.94)'
  };

  const BASE_SHADOW = '0 2px 8px rgba(0, 0, 0, 0.45)';

  /** `1.5K / 12.1K`, `903/2400`, `1.2M / 3M` — all game-side spellings. */
  const COUNTER_PATTERN = /(\d+(?:[.,]\d+)?)\s*([KMB]?)\s*\/\s*(\d+(?:[.,]\d+)?)\s*([KMB]?)/i;

  /**
   * HUD hosts, most specific first. Used to anchor scans; missing elements are
   * simply skipped, so the list can safely outlive a game-side rename.
   */
  const HUD_SELECTORS = ['control-panel', 'player-panel', 'game-left-sidebar'];

  /** Matches the in-game routes (`/game/…`, `/w3/game/…`). */
  const MATCH_PAGE_PATTERN = /\/(?:w\d+\/)?game(?:\/|$)/;

  const isMatchPage = () => MATCH_PAGE_PATTERN.test(location.pathname);

  /** @type {HTMLDivElement|null} */
  let widget = null;
  /** @type {Element|null} Cached node that holds the troop counter. */
  let counterNode = null;
  /** @type {HTMLDivElement|null} Zone strip drawn over the game's troop bar. */
  let marker = null;
  /** @type {HTMLDivElement|null} Current-position pin inside the strip. */
  let markerPin = null;
  /** @type {Element|null} Cached game troop bar the strip aligns with. */
  let barNode = null;
  /** @type {HTMLInputElement|null} Cached troop-ratio slider. */
  let sliderNode = null;
  /** Percentage currently advised, or `null` while accumulating. */
  let advisedPercent = null;
  let flashTimer = 0;
  /** Click-burst tracking for the auto-follow toggle. */
  let burstCount = 0;
  let burstTimer = 0;
  /** @type {Element|null} Cached HUD host, revalidated instead of re-queried. */
  let hudNode = null;
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
    if (Date.now() >= flashUntil) widget.style.boxShadow = restingShadow();

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
    const magnitude = { K: 1e3, M: 1e6, B: 1e9 }[suffix.toUpperCase()] ?? 1;
    return Number.parseFloat(value.replace(',', '.')) * magnitude || 0;
  }

  /** Formats a troop count the way the game's HUD does. */
  function formatCompactNumber(value) {
    if (value >= 1e9) return `${(value / 1e9).toFixed(2)}B`;
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
   * Single bottom-up pass returning a subtree's text together with the deepest
   * rendered element whose own text satisfies `pattern`.
   *
   * Caching that element is what keeps sampling cheap: re-reading one small
   * node costs nothing, whereas `document.body.innerText` forces a full layout
   * on every tick.
   *
   * @param {Node} root
   * @param {RegExp} pattern
   * @returns {{text: string, match: Element|null}}
   */
  function scanChildren(root, pattern) {
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

      const result = scanElement(child, pattern);
      text += result.text;
      match ??= result.match;
    }

    return { text, match };
  }

  /**
   * Same scan for a single element, its own shadow tree included. Split from
   * `scanChildren` so a scan can start at an arbitrary host element — the game
   * HUD is one — rather than only at a document or shadow root.
   *
   * @param {Element} element
   * @param {RegExp} pattern
   * @returns {{text: string, match: Element|null}}
   */
  function scanElement(element, pattern) {
    let text = '';
    let match = null;

    if (element.shadowRoot) {
      const shadow = scanChildren(element.shadowRoot, pattern);
      text += shadow.text;
      match ??= shadow.match;
    }
    const light = scanChildren(element, pattern);
    text += light.text;
    match ??= light.match;

    // Considered only when no descendant matched, which yields the deepest hit.
    if (!match && pattern.test(text) && isRendered(element)) match = element;
    return { text, match };
  }

  /**
   * The in-game HUD, or `null` when it is not on screen.
   *
   * @returns {Element|null}
   */
  function hudRoot() {
    // Revalidating the cached host is two cheap checks; re-querying the
    // selector list costs a document search on every tick for no gain.
    if (hudNode?.isConnected && isRendered(hudNode)) return hudNode;

    hudNode = null;
    for (const selector of HUD_SELECTORS) {
      const element = document.querySelector(selector);
      if (element && isRendered(element)) {
        hudNode = element;
        break;
      }
    }
    return hudNode;
  }

  /**
   * Whether `node` sits inside `root`, shadow boundaries included.
   *
   * @param {Node|null} node
   * @param {Node} root
   * @returns {boolean}
   */
  function isWithin(node, root) {
    for (let current = node; current; current = current.parentElement ?? current.getRootNode()?.host ?? null) {
      if (current === root) return true;
    }
    return false;
  }

  /**
   * Finds the deepest rendered element matching `pattern`.
   *
   * Confined to the HUD, because the rest of the page is full of `x / y` text
   * that looks exactly like a troop counter — lobby player counts on the menu
   * being the obvious trap. The document-wide sweep is therefore allowed only
   * while a match is running, as a safety net for a future HUD rename.
   *
   * @param {RegExp} pattern
   * @returns {Element|null}
   */
  function findNode(pattern) {
    const hud = hudRoot();
    if (hud) {
      const found = scanElement(hud, pattern).match;
      if (found) return found;
    }
    return isMatchPage() ? scanElement(document.body, pattern).match : null;
  }

  /**
   * Returns the current/maximum troop pair, or `null` while the HUD is absent
   * (main menu, loading screen, spectator mode).
   *
   * @returns {{current: number, max: number}|null}
   */
  function readTroopCounter() {
    // A cached node is only trusted while it is attached, still rendered, and —
    // once the HUD exists — still part of it. Without the last check a node
    // picked up on the menu would survive into the match and keep feeding the
    // overlay a lobby's player count.
    const hud = hudRoot();
    const cacheValid = counterNode?.isConnected &&
                       isRendered(counterNode) &&
                       (!hud || isWithin(counterNode, hud));
    if (!cacheValid) counterNode = null;

    let match = counterNode ? COUNTER_PATTERN.exec(deepTextContent(counterNode)) : null;

    if (!match) {
      const now = Date.now();
      // Outside a match there is nothing to find, so sweeps are spaced further
      // apart. Deliberately a slowdown and not a hard gate: if the game ever
      // changes its URL scheme, the overlay degrades in speed, not in function.
      const cooldown = isMatchPage() ? RESCAN_COOLDOWN_MS : IDLE_RESCAN_COOLDOWN_MS;
      if (now - lastRescanAt < cooldown) return null;
      lastRescanAt = now;

      counterNode = findNode(COUNTER_PATTERN);
      match = counterNode ? COUNTER_PATTERN.exec(deepTextContent(counterNode)) : null;

      // Last resort: `innerText` is layout-based, so it sees rendered shadow
      // content the walk above may have missed. Restricted to a running match —
      // on the menu it would happily read the lobby list.
      if (!match && isMatchPage()) {
        counterNode = null;
        match = COUNTER_PATTERN.exec(document.body.innerText);
      }
      if (!match) return null;
    }

    const current = parseCompactNumber(match[1], match[2]);
    const max = parseCompactNumber(match[3], match[4]);
    return max > 0 && current > 0 ? { current, max } : null;
  }

  /* ------------------------------------------------------------------ *
   * Zone marker drawn over the game's troop bar
   * ------------------------------------------------------------------ */

  /**
   * Locates the game's troop bar without relying on its class names.
   *
   * The bar is identified by behaviour rather than markup: starting from the
   * counter, the first ancestor wide enough to be a bar and containing a child
   * whose width is the current fill ratio *is* the bar. That test verifies
   * itself against live numbers, so a HUD restyle cannot silently point the
   * marker at the wrong element.
   *
   * @param {number} ratio Current troops divided by the cap.
   * @returns {Element|null}
   */
  function findTroopBar(ratio) {
    if (barNode?.isConnected && isRendered(barNode)) return barNode;

    // The counter may have come from the `innerText` fallback, which caches no
    // node; locate one so the walk has a starting point.
    if (!counterNode) counterNode = findNode(COUNTER_PATTERN);
    if (!counterNode) return null;

    // The innermost bar-shaped element wins. In the game the counter is painted
    // across the whole bar, so the counter itself already has the bar's extent;
    // where a HUD instead uses a narrow label, the walk climbs to the first
    // ancestor wide enough to be a bar. Climbing any further would land on the
    // HUD row, which is wider than the bar and would misplace the strip.
    for (let node = counterNode, depth = 0; node && depth < BAR_SEARCH_DEPTH; depth++) {
      const rect = node.getBoundingClientRect();

      // Above a single row's height lie panels; aligning to those is meaningless.
      if (rect.height > MAX_BAR_HEIGHT_PX) break;

      if (rect.width >= MIN_BAR_WIDTH_PX && rect.height >= MIN_BAR_HEIGHT_PX) {
        barNode = node;
        return node;
      }

      // `host` continues the walk out of a shadow tree into its host element.
      node = node.parentElement ?? node.getRootNode()?.host ?? null;
    }

    barNode = null;
    return null;
  }

  /** Builds the marker strip once; it is repositioned, never rebuilt. */
  function createMarker() {
    if (marker) return;

    marker = document.createElement('div');
    marker.id = MARKER_ID;
    Object.assign(marker.style, {
      position: 'fixed',
      display: 'none',
      height: `${MARKER_HEIGHT_PX}px`,
      borderRadius: '2px',
      overflow: 'visible',
      pointerEvents: 'none',
      zIndex: '2147482999',
      // Hard stops, not a blend: the reserve boundary is a decision, not a mood.
      background: `linear-gradient(to right,
        ${PALETTE.saving}59 0%,
        ${PALETTE.saving}59 ${RESERVE_RATIO * 100}%,
        ${PALETTE.ready}59 ${RESERVE_RATIO * 100}%,
        ${PALETTE.ready}59 100%)`
    });

    // Where donating starts paying off.
    const targetTick = document.createElement('div');
    Object.assign(targetTick.style, {
      position: 'absolute',
      top: '-2px',
      bottom: '-2px',
      width: '2px',
      left: `${TARGET_RATIO * 100}%`,
      transform: 'translateX(-50%)',
      background: 'rgba(255, 255, 255, 0.85)',
      borderRadius: '1px'
    });
    marker.appendChild(targetTick);

    // Where the player currently stands.
    markerPin = document.createElement('div');
    Object.assign(markerPin.style, {
      position: 'absolute',
      top: `-${MARKER_PIN_OVERHANG_PX}px`,
      bottom: `-${MARKER_PIN_OVERHANG_PX}px`,
      width: '3px',
      transform: 'translateX(-50%)',
      borderRadius: '2px',
      transition: 'left 0.25s ease, background 0.25s ease'
    });
    marker.appendChild(markerPin);

    document.body.appendChild(marker);
  }

  const hideMarker = () => { if (marker) marker.style.display = 'none'; };

  /**
   * Aligns the strip with the game's bar and moves the pin.
   *
   * The strip is a sibling of the page, positioned over the bar every tick,
   * rather than a child injected into the game's own container: the game owns
   * its DOM, and a HUD re-render can never wipe something it does not contain.
   *
   * @param {{current: number, max: number}|null} troops
   */
  function renderMarker(troops) {
    if (!marker || !state.visible || !troops) {
      hideMarker();
      return;
    }

    const ratio = Settings.clamp(troops.current / troops.max, 0, 1);
    const bar = findTroopBar(ratio);
    if (!bar) {
      hideMarker();
      return;
    }

    const rect = bar.getBoundingClientRect();
    if (!rect.width) {
      hideMarker();
      return;
    }

    marker.style.display = 'block';
    marker.style.left = `${rect.left}px`;
    marker.style.width = `${rect.width}px`;
    marker.style.top = `${rect.top - MARKER_GAP_PX - MARKER_HEIGHT_PX}px`;
    marker.style.opacity = String(state.opacity);

    const colour = ratio <= RESERVE_RATIO ? PALETTE.saving : PALETTE.ready;
    markerPin.style.left = `${ratio * 100}%`;
    markerPin.style.background = colour;
    markerPin.style.boxShadow = `0 0 5px ${colour}`;
  }

  /**
   * Recomputes the hint shown in the overlay.
   *
   * Below the reserve threshold the player is told how much to accumulate;
   * above it, the percentage the donation slider should be set to in order to
   * give away everything above the reserve.
   */
  function renderAdvice() {
    if (!widget) return;
    if (!state.visible) {
      hideMarker();
      return;
    }

    const strings = t(state.lang);
    const troops = readTroopCounter();
    renderMarker(troops);

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

    // Auto-follow overrides the state colours rather than sitting alongside
    // them: while the extension drives the slider, "act now" versus "keep
    // saving" is no longer a call the player has to make, so the mode itself is
    // the more useful thing to signal.
    widget.style.color = state.autoApply
      ? PALETTE.auto
      : isSaving ? PALETTE.saving : PALETTE.ready;
    if (!state.unlocked && Date.now() >= flashUntil) widget.style.borderColor = widget.style.color;

    // Auto-follow: keep the slider on the advice as the numbers move. Writing
    // the same value is a no-op, so this costs nothing between changes.
    if (state.autoApply && advisedPercent !== null) applyPercentToSlider(advisedPercent);
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

  /**
   * Resting shadow of the overlay. Auto-follow mode is announced by a permanent
   * glow, so the player can tell at a glance that the slider is not theirs to
   * control right now.
   */
  function restingShadow() {
    return state.autoApply
      ? `0 0 0 2px ${PALETTE.auto}66, 0 0 14px ${PALETTE.auto}99, ${BASE_SHADOW}`
      : BASE_SHADOW;
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
      widget.style.boxShadow = restingShadow();
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

    // A burst of clicks toggles auto-follow. The individual clicks still apply
    // the advice, which is harmless: the slider is already where they put it.
    if (countBurstClick()) {
      toggleAutoApply();
      return;
    }

    if (advisedPercent === null) {
      flash(PALETTE.saving);
      return;
    }
    flash(applyPercentToSlider(advisedPercent) ? PALETTE.applied : PALETTE.error);
  }

  /**
   * Counts clicks arriving in quick succession.
   *
   * @returns {boolean} `true` on the click that completes a burst.
   */
  function countBurstClick() {
    burstCount += 1;
    clearTimeout(burstTimer);

    if (burstCount >= AUTO_TOGGLE_CLICKS) {
      burstCount = 0;
      return true;
    }
    burstTimer = setTimeout(() => { burstCount = 0; }, BURST_WINDOW_MS);
    return false;
  }

  /**
   * Switches auto-follow on or off.
   *
   * The mode is persisted like any other setting, so it survives a reload and
   * reaches every open game tab. The glow makes that state impossible to miss.
   */
  function toggleAutoApply() {
    state.autoApply = !state.autoApply;

    applyAppearance();
    flash(state.autoApply ? PALETTE.auto : PALETTE.dragging);
    if (state.autoApply && advisedPercent !== null) applyPercentToSlider(advisedPercent);

    Settings.patch({ autoApply: state.autoApply })
      .catch(() => { /* extension context invalidated */ });
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
    createMarker();

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
