/**
 * Popup controller.
 *
 * Holds no state of its own beyond the in-memory settings snapshot: every user
 * action is written straight to `chrome.storage.local`, and the content script
 * picks the change up through `chrome.storage.onChanged`.
 */
(() => {
  'use strict';

  const { LANGUAGES, t } = globalThis.OFDC;
  const Settings = globalThis.OFDC_SETTINGS;

  const dom = {
    settingsView: document.getElementById('view-settings'),
    languageView: document.getElementById('view-language'),
    openLanguage: document.getElementById('open-language'),
    closeLanguage: document.getElementById('close-language'),
    languageList: document.getElementById('language-list'),
    toggleVisibility: document.getElementById('toggle-visibility'),
    toggleLock: document.getElementById('toggle-lock'),
    alignGroup: document.getElementById('align-group'),
    opacity: document.getElementById('opacity'),
    opacityValue: document.getElementById('opacity-value'),
    scale: document.getElementById('scale'),
    scaleValue: document.getElementById('scale-value')
  };

  let state = Settings.normalize(null);

  const percent = (value) => `${Math.round(value * 100)}%`;

  /* ------------------------------------------------------------------ *
   * Rendering
   * ------------------------------------------------------------------ */

  /** Fills every `data-i18n` / `data-i18n-title` placeholder in the document. */
  function renderStrings(strings) {
    for (const node of document.querySelectorAll('[data-i18n]')) {
      node.textContent = strings[node.dataset.i18n] ?? '';
    }
    for (const node of document.querySelectorAll('[data-i18n-title]')) {
      node.title = strings[node.dataset.i18nTitle] ?? '';
    }
  }

  function renderControls(strings) {
    dom.toggleVisibility.textContent = state.visible ? strings.widgetDisable : strings.widgetEnable;
    dom.toggleVisibility.dataset.state = state.visible ? 'off' : 'on';

    dom.toggleLock.textContent = state.unlocked ? strings.lock : strings.unlock;
    dom.toggleLock.dataset.state = state.unlocked ? 'warn' : 'off';

    for (const button of dom.alignGroup.children) {
      button.setAttribute('aria-pressed', String(button.dataset.align === state.align));
    }

    dom.opacity.value = state.opacity;
    dom.scale.value = state.scale;
    dom.opacityValue.textContent = percent(state.opacity);
    dom.scaleValue.textContent = percent(state.scale);
  }

  /** Builds the language grid once; selection is refreshed separately. */
  function buildLanguageList() {
    const fragment = document.createDocumentFragment();

    for (const language of LANGUAGES) {
      const item = document.createElement('button');
      item.type = 'button';
      item.className = 'language';
      item.dataset.lang = language.code;
      // Native name only; the English one stays as a tooltip. Selection is
      // conveyed by the highlight, so nothing competes with the label for the
      // narrow width available.
      item.title = language.english;
      item.textContent = language.native;
      fragment.append(item);
    }

    dom.languageList.append(fragment);
  }

  function renderLanguageSelection() {
    for (const item of dom.languageList.children) {
      item.setAttribute('aria-selected', String(item.dataset.lang === state.lang));
    }
  }

  function render() {
    const strings = t(state.lang);
    renderStrings(strings);
    renderControls(strings);
    renderLanguageSelection();
  }

  /* ------------------------------------------------------------------ *
   * Persistence
   * ------------------------------------------------------------------ */

  /**
   * Applies a change locally for instant feedback, then persists it.
   * @param {object} partial
   */
  async function commit(partial) {
    state = Settings.normalize({ ...state, ...partial });
    render();
    state = await Settings.patch(partial);
  }

  /* ------------------------------------------------------------------ *
   * View switching
   * ------------------------------------------------------------------ */

  function showLanguageView(visible) {
    dom.settingsView.hidden = visible;
    dom.languageView.hidden = !visible;

    if (visible) {
      // Force a reflow so the enter transition plays from its initial state.
      dom.languageView.classList.add('view--enter');
      void dom.languageView.offsetWidth;
      dom.languageView.classList.remove('view--enter');
      dom.languageList.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' });
    }
  }

  /* ------------------------------------------------------------------ *
   * Events
   * ------------------------------------------------------------------ */

  function bindEvents() {
    dom.openLanguage.addEventListener('click', () => showLanguageView(true));
    dom.closeLanguage.addEventListener('click', () => showLanguageView(false));

    dom.toggleVisibility.addEventListener('click', () => commit({ visible: !state.visible }));
    dom.toggleLock.addEventListener('click', () => commit({ unlocked: !state.unlocked }));

    dom.alignGroup.addEventListener('click', (event) => {
      const align = event.target.closest('[data-align]')?.dataset.align;
      if (!align) return;

      // Re-snap to the chosen edge; the vertical position is deliberately kept.
      commit({
        align,
        position: { offset: align === 'center' ? 0 : Settings.EDGE_MARGIN }
      });
    });

    dom.opacity.addEventListener('input', (event) => commit({ opacity: event.target.value }));
    dom.scale.addEventListener('input', (event) => commit({ scale: event.target.value }));

    dom.languageList.addEventListener('click', (event) => {
      const lang = event.target.closest('[data-lang]')?.dataset.lang;
      if (!lang || lang === state.lang) return;
      commit({ lang });
    });
  }

  /* ------------------------------------------------------------------ *
   * Bootstrap
   * ------------------------------------------------------------------ */

  (async () => {
    buildLanguageList();
    bindEvents();
    state = await Settings.load();
    render();
  })();
})();
