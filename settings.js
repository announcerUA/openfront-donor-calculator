/**
 * Single source of truth for the persisted widget configuration.
 *
 * Both the popup and the content script mutate the same `chrome.storage.local`
 * record, so every write goes through `patch()`, which performs a
 * read-modify-write instead of overwriting the whole object. Without it a stale
 * popup snapshot would clobber the position the user has just dragged in-game.
 *
 * Exposed API:
 *   OFDC_SETTINGS.STORAGE_KEY
 *   OFDC_SETTINGS.DEFAULTS
 *   OFDC_SETTINGS.normalize(raw)
 *   OFDC_SETTINGS.load()
 *   OFDC_SETTINGS.patch(partial)
 */
(() => {
  'use strict';

  const STORAGE_KEY = 'widgetSettings';

  /** Distance kept between the widget and the viewport edge when snapping. */
  const EDGE_MARGIN = 20;

  /**
   * `position.offset` is measured against the active anchor, not against the
   * viewport origin:
   *   left   → distance from the left edge
   *   right  → distance from the right edge
   *   center → signed distance from the horizontal centre
   * This keeps the widget glued to its edge across resolution changes.
   */
  const DEFAULTS = Object.freeze({
    visible: true,
    unlocked: false,
    /** Auto-follow mode: the overlay keeps the game's slider on its advice. */
    autoApply: false,
    opacity: 1,
    scale: 1,
    lang: 'ru',
    align: 'left',
    position: { offset: EDGE_MARGIN, top: null }
  });

  const ALIGNMENTS = ['left', 'center', 'right'];

  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

  const toNumber = (value, fallback) => {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  };

  /**
   * Coerces an arbitrary stored record into a valid settings object.
   * Guards against values written by older extension versions.
   *
   * @param {unknown} raw
   * @returns {object}
   */
  function normalize(raw) {
    const source = (raw && typeof raw === 'object') ? raw : {};
    const position = (source.position && typeof source.position === 'object') ? source.position : {};

    return {
      visible: source.visible !== false,
      unlocked: source.unlocked === true,
      autoApply: source.autoApply === true,
      opacity: clamp(toNumber(source.opacity, DEFAULTS.opacity), 0.2, 1),
      scale: clamp(toNumber(source.scale, DEFAULTS.scale), 0.5, 1.5),
      lang: typeof source.lang === 'string' ? source.lang : DEFAULTS.lang,
      align: ALIGNMENTS.includes(source.align) ? source.align : DEFAULTS.align,
      position: {
        offset: toNumber(position.offset, EDGE_MARGIN),
        top: position.top === null || position.top === undefined
          ? null
          : toNumber(position.top, null)
      }
    };
  }

  /**
   * Reads and normalizes the stored settings.
   * @returns {Promise<object>}
   */
  function load() {
    return new Promise((resolve) => {
      chrome.storage.local.get([STORAGE_KEY], (data) => {
        resolve(normalize(data?.[STORAGE_KEY]));
      });
    });
  }

  /**
   * Merges a partial update into the stored settings.
   *
   * @param {object} partial Fields to override; `position` is merged shallowly.
   * @returns {Promise<object>} The settings record as persisted.
   */
  async function patch(partial) {
    const current = await load();
    const next = normalize({
      ...current,
      ...partial,
      position: { ...current.position, ...(partial.position || {}) }
    });

    await chrome.storage.local.set({ [STORAGE_KEY]: next });
    return next;
  }

  globalThis.OFDC_SETTINGS = Object.freeze({
    STORAGE_KEY,
    EDGE_MARGIN,
    ALIGNMENTS,
    DEFAULTS,
    clamp,
    normalize,
    load,
    patch
  });
})();
