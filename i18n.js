/**
 * Localization layer shared by the popup UI and the in-game content script.
 *
 * The module is intentionally dependency-free and attaches a single frozen
 * namespace to `globalThis`, so it can be injected both as a content script and
 * as a classic <script> tag in the popup without a bundler.
 *
 * Exposed API:
 *   OFDC.LANGUAGES      — ordered language catalogue (mirrors the game's list)
 *   OFDC.DEFAULT_LANG   — fallback locale used for missing keys
 *   OFDC.t(lang)        — resolves a locale to a complete string table
 */
(() => {
  'use strict';

  const DEFAULT_LANG = 'en';

  /**
   * Language catalogue, ordered exactly like the in-game language picker.
   * `flag` holds a plain emoji so the popup needs no bundled image assets.
   */
  const LANGUAGES = [
    { code: 'ru',    flag: '🇷🇺', native: 'Русский',              english: 'Russian' },
    { code: 'en',    flag: '🇬🇧', native: 'English',              english: 'English' },
    { code: 'uk',    flag: '🇺🇦', native: 'Українська',           english: 'Ukrainian' },
    { code: 'ar',    flag: '🇸🇦', native: 'العربية',               english: 'Arabic', rtl: true },
    { code: 'bn',    flag: '🇧🇩', native: 'বাংলা',                 english: 'Bengali' },
    { code: 'pt-BR', flag: '🇧🇷', native: 'Português Brasileiro', english: 'Brazilian Portuguese' },
    { code: 'bg',    flag: '🇧🇬', native: 'Български',            english: 'Bulgarian' },
    { code: 'ca',    flag: '🎗️', native: 'Català',               english: 'Catalan' },
    { code: 'zh-CN', flag: '🇨🇳', native: '简体中文',              english: 'Chinese Simplified' },
    { code: 'cs',    flag: '🇨🇿', native: 'Čeština',              english: 'Czech' },
    { code: 'da',    flag: '🇩🇰', native: 'Dansk',                english: 'Danish' },
    { code: 'nl',    flag: '🇳🇱', native: 'Nederlands',           english: 'Dutch' },
    { code: 'eo',    flag: '🟩',  native: 'Esperanto',            english: 'Esperanto' },
    { code: 'et',    flag: '🇪🇪', native: 'Eesti keel',           english: 'Estonian' },
    { code: 'pt',    flag: '🇵🇹', native: 'Português',            english: 'European Portuguese' },
    { code: 'fi',    flag: '🇫🇮', native: 'Suomi',                english: 'Finnish' },
    { code: 'fr',    flag: '🇫🇷', native: 'Français',             english: 'French' },
    { code: 'gl',    flag: '🏳️', native: 'Galego',               english: 'Galician' },
    { code: 'de',    flag: '🇩🇪', native: 'Deutsch',              english: 'German' },
    { code: 'el',    flag: '🇬🇷', native: 'Ελληνικά',             english: 'Greek' },
    { code: 'he',    flag: '🇮🇱', native: 'עברית',                english: 'Hebrew', rtl: true },
    { code: 'hi',    flag: '🇮🇳', native: 'हिन्दी',                  english: 'Hindi' },
    { code: 'hu',    flag: '🇭🇺', native: 'Magyar',               english: 'Hungarian' },
    { code: 'id',    flag: '🇮🇩', native: 'Bahasa Indonesia',     english: 'Indonesian' },
    { code: 'it',    flag: '🇮🇹', native: 'Italiano',             english: 'Italian' },
    { code: 'ja',    flag: '🇯🇵', native: '日本語',                english: 'Japanese' },
    { code: 'ko',    flag: '🇰🇷', native: '한국어',                 english: 'Korean' },
    { code: 'mk',    flag: '🇲🇰', native: 'Македонски',           english: 'Macedonian' },
    { code: 'fa',    flag: '🇮🇷', native: 'فارسی',                 english: 'Persian', rtl: true },
    { code: 'pl',    flag: '🇵🇱', native: 'Polski',               english: 'Polish' },
    { code: 'sh',    flag: '🇷🇸', native: 'Srpsko-Hrvatski',      english: 'Serbo-Croatian' },
    { code: 'sk',    flag: '🇸🇰', native: 'Slovenčina',           english: 'Slovak' },
    { code: 'sl',    flag: '🇸🇮', native: 'Slovenščina',          english: 'Slovenian' },
    { code: 'es',    flag: '🇪🇸', native: 'Español',              english: 'Spanish' },
    { code: 'sv',    flag: '🇸🇪', native: 'Svenska',              english: 'Swedish' },
    { code: 'gsw',   flag: '🇨🇭', native: 'Schwiizerdütsch',      english: 'Swiss-German' },
    { code: 'tok',   flag: '🏴',  native: 'toki pona',            english: 'Toki Pona' },
    { code: 'tr',    flag: '🇹🇷', native: 'Türkçe',               english: 'Turkish' }
  ];

  /**
   * String tables. Every locale defines the full key set; `t()` still merges
   * over the English table so future keys degrade gracefully instead of
   * rendering `undefined`.
   */
  const STRINGS = {
    en: {
      title: 'Widget Settings', langTitle: 'Select Language', language: 'Language',
      widgetEnable: 'Enable Widget', widgetDisable: 'Disable Widget',
      unlock: 'Unlock (Drag)', lock: 'Lock',
      position: 'Screen Position', left: 'Left', center: 'Center', right: 'Right',
      opacity: 'Opacity', scale: 'Size',
      waiting: 'Waiting…', save: 'Save up:', slider: 'Slider:'
    },
    ru: {
      title: 'Настройки виджета', langTitle: 'Выбор языка', language: 'Язык',
      widgetEnable: 'Включить виджет', widgetDisable: 'Выключить виджет',
      unlock: 'Открепить (перетаскивание)', lock: 'Закрепить',
      position: 'Позиция на экране', left: 'Лево', center: 'Центр', right: 'Право',
      opacity: 'Прозрачность', scale: 'Размер',
      waiting: 'Ожидание…', save: 'Копим:', slider: 'Ползунок:'
    },
    uk: {
      title: 'Налаштування віджета', langTitle: 'Вибір мови', language: 'Мова',
      widgetEnable: 'Увімкнути віджет', widgetDisable: 'Вимкнути віджет',
      unlock: 'Відкріпити (перетягування)', lock: 'Закріпити',
      position: 'Позиція на екрані', left: 'Ліво', center: 'Центр', right: 'Право',
      opacity: 'Прозорість', scale: 'Розмір',
      waiting: 'Очікування…', save: 'Копимо:', slider: 'Повзунок:'
    },
    ar: {
      title: 'إعدادات الأداة', langTitle: 'اختيار اللغة', language: 'اللغة',
      widgetEnable: 'تفعيل الأداة', widgetDisable: 'إيقاف الأداة',
      unlock: 'إلغاء التثبيت (السحب)', lock: 'تثبيت',
      position: 'الموضع على الشاشة', left: 'يسار', center: 'وسط', right: 'يمين',
      opacity: 'الشفافية', scale: 'الحجم',
      waiting: 'في الانتظار…', save: 'اجمع:', slider: 'المؤشر:'
    },
    bn: {
      title: 'উইজেট সেটিংস', langTitle: 'ভাষা নির্বাচন', language: 'ভাষা',
      widgetEnable: 'উইজেট চালু করুন', widgetDisable: 'উইজেট বন্ধ করুন',
      unlock: 'আনলক (টেনে সরান)', lock: 'লক',
      position: 'স্ক্রিনে অবস্থান', left: 'বাম', center: 'মাঝ', right: 'ডান',
      opacity: 'স্বচ্ছতা', scale: 'আকার',
      waiting: 'অপেক্ষা…', save: 'জমান:', slider: 'স্লাইডার:'
    },
    'pt-BR': {
      title: 'Configurações do widget', langTitle: 'Selecionar idioma', language: 'Idioma',
      widgetEnable: 'Ativar widget', widgetDisable: 'Desativar widget',
      unlock: 'Desbloquear (arrastar)', lock: 'Bloquear',
      position: 'Posição na tela', left: 'Esquerda', center: 'Centro', right: 'Direita',
      opacity: 'Opacidade', scale: 'Tamanho',
      waiting: 'Aguardando…', save: 'Acumule:', slider: 'Controle:'
    },
    bg: {
      title: 'Настройки на джаджата', langTitle: 'Избор на език', language: 'Език',
      widgetEnable: 'Включи джаджата', widgetDisable: 'Изключи джаджата',
      unlock: 'Освободи (влачене)', lock: 'Заключи',
      position: 'Позиция на екрана', left: 'Ляво', center: 'Център', right: 'Дясно',
      opacity: 'Прозрачност', scale: 'Размер',
      waiting: 'Изчакване…', save: 'Натрупай:', slider: 'Плъзгач:'
    },
    ca: {
      title: 'Configuració del giny', langTitle: 'Selecció d\'idioma', language: 'Idioma',
      widgetEnable: 'Activa el giny', widgetDisable: 'Desactiva el giny',
      unlock: 'Desbloqueja (arrossega)', lock: 'Bloqueja',
      position: 'Posició a la pantalla', left: 'Esquerra', center: 'Centre', right: 'Dreta',
      opacity: 'Opacitat', scale: 'Mida',
      waiting: 'Esperant…', save: 'Acumula:', slider: 'Control:'
    },
    'zh-CN': {
      title: '小部件设置', langTitle: '选择语言', language: '语言',
      widgetEnable: '启用小部件', widgetDisable: '关闭小部件',
      unlock: '解锁（拖动）', lock: '锁定',
      position: '屏幕位置', left: '左', center: '中', right: '右',
      opacity: '不透明度', scale: '大小',
      waiting: '等待中…', save: '积攒：', slider: '滑块：'
    },
    cs: {
      title: 'Nastavení widgetu', langTitle: 'Výběr jazyka', language: 'Jazyk',
      widgetEnable: 'Zapnout widget', widgetDisable: 'Vypnout widget',
      unlock: 'Odemknout (táhnout)', lock: 'Zamknout',
      position: 'Pozice na obrazovce', left: 'Vlevo', center: 'Střed', right: 'Vpravo',
      opacity: 'Průhlednost', scale: 'Velikost',
      waiting: 'Čekání…', save: 'Šetři:', slider: 'Posuvník:'
    },
    da: {
      title: 'Widget-indstillinger', langTitle: 'Vælg sprog', language: 'Sprog',
      widgetEnable: 'Aktivér widget', widgetDisable: 'Deaktivér widget',
      unlock: 'Lås op (træk)', lock: 'Lås',
      position: 'Placering på skærmen', left: 'Venstre', center: 'Midte', right: 'Højre',
      opacity: 'Gennemsigtighed', scale: 'Størrelse',
      waiting: 'Venter…', save: 'Spar op:', slider: 'Skyder:'
    },
    nl: {
      title: 'Widget-instellingen', langTitle: 'Taal kiezen', language: 'Taal',
      widgetEnable: 'Widget inschakelen', widgetDisable: 'Widget uitschakelen',
      unlock: 'Ontgrendelen (slepen)', lock: 'Vergrendelen',
      position: 'Schermpositie', left: 'Links', center: 'Midden', right: 'Rechts',
      opacity: 'Doorzichtigheid', scale: 'Grootte',
      waiting: 'Wachten…', save: 'Sparen:', slider: 'Schuifregelaar:'
    },
    eo: {
      title: 'Agordoj de fenestraĵo', langTitle: 'Elekto de lingvo', language: 'Lingvo',
      widgetEnable: 'Ŝalti fenestraĵon', widgetDisable: 'Malŝalti fenestraĵon',
      unlock: 'Malfiksi (treni)', lock: 'Fiksi',
      position: 'Pozicio sur ekrano', left: 'Maldekstre', center: 'Centre', right: 'Dekstre',
      opacity: 'Maldiafaneco', scale: 'Grando',
      waiting: 'Atendante…', save: 'Kolektu:', slider: 'Ŝovilo:'
    },
    et: {
      title: 'Vidina sätted', langTitle: 'Keele valik', language: 'Keel',
      widgetEnable: 'Lülita vidin sisse', widgetDisable: 'Lülita vidin välja',
      unlock: 'Vabasta (lohista)', lock: 'Lukusta',
      position: 'Asukoht ekraanil', left: 'Vasak', center: 'Kesk', right: 'Parem',
      opacity: 'Läbipaistvus', scale: 'Suurus',
      waiting: 'Ootel…', save: 'Kogu:', slider: 'Liugur:'
    },
    pt: {
      title: 'Definições do widget', langTitle: 'Selecionar idioma', language: 'Idioma',
      widgetEnable: 'Ativar widget', widgetDisable: 'Desativar widget',
      unlock: 'Desbloquear (arrastar)', lock: 'Bloquear',
      position: 'Posição no ecrã', left: 'Esquerda', center: 'Centro', right: 'Direita',
      opacity: 'Opacidade', scale: 'Tamanho',
      waiting: 'A aguardar…', save: 'Acumula:', slider: 'Cursor:'
    },
    fi: {
      title: 'Widgetin asetukset', langTitle: 'Kielen valinta', language: 'Kieli',
      widgetEnable: 'Ota widget käyttöön', widgetDisable: 'Poista widget käytöstä',
      unlock: 'Vapauta (raahaa)', lock: 'Lukitse',
      position: 'Sijainti näytöllä', left: 'Vasen', center: 'Keski', right: 'Oikea',
      opacity: 'Läpinäkyvyys', scale: 'Koko',
      waiting: 'Odotetaan…', save: 'Säästä:', slider: 'Liukusäädin:'
    },
    fr: {
      title: 'Paramètres du widget', langTitle: 'Choix de la langue', language: 'Langue',
      widgetEnable: 'Activer le widget', widgetDisable: 'Désactiver le widget',
      unlock: 'Déverrouiller (glisser)', lock: 'Verrouiller',
      position: 'Position à l\'écran', left: 'Gauche', center: 'Centre', right: 'Droite',
      opacity: 'Opacité', scale: 'Taille',
      waiting: 'En attente…', save: 'Accumulez :', slider: 'Curseur :'
    },
    gl: {
      title: 'Configuración do widget', langTitle: 'Selección de idioma', language: 'Idioma',
      widgetEnable: 'Activar widget', widgetDisable: 'Desactivar widget',
      unlock: 'Desbloquear (arrastrar)', lock: 'Bloquear',
      position: 'Posición na pantalla', left: 'Esquerda', center: 'Centro', right: 'Dereita',
      opacity: 'Opacidade', scale: 'Tamaño',
      waiting: 'Agardando…', save: 'Acumula:', slider: 'Control:'
    },
    de: {
      title: 'Widget-Einstellungen', langTitle: 'Sprache wählen', language: 'Sprache',
      widgetEnable: 'Widget aktivieren', widgetDisable: 'Widget deaktivieren',
      unlock: 'Entsperren (ziehen)', lock: 'Sperren',
      position: 'Bildschirmposition', left: 'Links', center: 'Mitte', right: 'Rechts',
      opacity: 'Deckkraft', scale: 'Größe',
      waiting: 'Warten…', save: 'Sparen:', slider: 'Regler:'
    },
    el: {
      title: 'Ρυθμίσεις widget', langTitle: 'Επιλογή γλώσσας', language: 'Γλώσσα',
      widgetEnable: 'Ενεργοποίηση widget', widgetDisable: 'Απενεργοποίηση widget',
      unlock: 'Ξεκλείδωμα (σύρσιμο)', lock: 'Κλείδωμα',
      position: 'Θέση στην οθόνη', left: 'Αριστερά', center: 'Κέντρο', right: 'Δεξιά',
      opacity: 'Διαφάνεια', scale: 'Μέγεθος',
      waiting: 'Αναμονή…', save: 'Μάζεψε:', slider: 'Ρυθμιστικό:'
    },
    he: {
      title: 'הגדרות הווידג\'ט', langTitle: 'בחירת שפה', language: 'שפה',
      widgetEnable: 'הפעל ווידג\'ט', widgetDisable: 'כבה ווידג\'ט',
      unlock: 'שחרור (גרירה)', lock: 'נעילה',
      position: 'מיקום במסך', left: 'שמאל', center: 'מרכז', right: 'ימין',
      opacity: 'שקיפות', scale: 'גודל',
      waiting: 'ממתין…', save: 'לצבור:', slider: 'מחוון:'
    },
    hi: {
      title: 'विजेट सेटिंग्स', langTitle: 'भाषा चुनें', language: 'भाषा',
      widgetEnable: 'विजेट चालू करें', widgetDisable: 'विजेट बंद करें',
      unlock: 'अनलॉक (खींचें)', lock: 'लॉक',
      position: 'स्क्रीन पर स्थिति', left: 'बाएँ', center: 'मध्य', right: 'दाएँ',
      opacity: 'पारदर्शिता', scale: 'आकार',
      waiting: 'प्रतीक्षा…', save: 'जमा करें:', slider: 'स्लाइडर:'
    },
    hu: {
      title: 'Widget beállításai', langTitle: 'Nyelv kiválasztása', language: 'Nyelv',
      widgetEnable: 'Widget bekapcsolása', widgetDisable: 'Widget kikapcsolása',
      unlock: 'Feloldás (húzás)', lock: 'Rögzítés',
      position: 'Képernyőpozíció', left: 'Bal', center: 'Közép', right: 'Jobb',
      opacity: 'Átlátszóság', scale: 'Méret',
      waiting: 'Várakozás…', save: 'Gyűjts:', slider: 'Csúszka:'
    },
    id: {
      title: 'Pengaturan widget', langTitle: 'Pilih bahasa', language: 'Bahasa',
      widgetEnable: 'Aktifkan widget', widgetDisable: 'Nonaktifkan widget',
      unlock: 'Buka kunci (seret)', lock: 'Kunci',
      position: 'Posisi layar', left: 'Kiri', center: 'Tengah', right: 'Kanan',
      opacity: 'Transparansi', scale: 'Ukuran',
      waiting: 'Menunggu…', save: 'Kumpulkan:', slider: 'Penggeser:'
    },
    it: {
      title: 'Impostazioni widget', langTitle: 'Selezione lingua', language: 'Lingua',
      widgetEnable: 'Attiva widget', widgetDisable: 'Disattiva widget',
      unlock: 'Sblocca (trascina)', lock: 'Blocca',
      position: 'Posizione sullo schermo', left: 'Sinistra', center: 'Centro', right: 'Destra',
      opacity: 'Opacità', scale: 'Dimensione',
      waiting: 'In attesa…', save: 'Accumula:', slider: 'Cursore:'
    },
    ja: {
      title: 'ウィジェット設定', langTitle: '言語選択', language: '言語',
      widgetEnable: 'ウィジェットを有効化', widgetDisable: 'ウィジェットを無効化',
      unlock: '固定解除（ドラッグ）', lock: '固定',
      position: '画面上の位置', left: '左', center: '中央', right: '右',
      opacity: '不透明度', scale: 'サイズ',
      waiting: '待機中…', save: '貯める:', slider: 'スライダー:'
    },
    ko: {
      title: '위젯 설정', langTitle: '언어 선택', language: '언어',
      widgetEnable: '위젯 켜기', widgetDisable: '위젯 끄기',
      unlock: '잠금 해제 (드래그)', lock: '잠금',
      position: '화면 위치', left: '왼쪽', center: '가운데', right: '오른쪽',
      opacity: '불투명도', scale: '크기',
      waiting: '대기 중…', save: '모으기:', slider: '슬라이더:'
    },
    mk: {
      title: 'Поставки на виџетот', langTitle: 'Избор на јазик', language: 'Јазик',
      widgetEnable: 'Вклучи виџет', widgetDisable: 'Исклучи виџет',
      unlock: 'Отклучи (влечење)', lock: 'Заклучи',
      position: 'Позиција на екранот', left: 'Лево', center: 'Центар', right: 'Десно',
      opacity: 'Проѕирност', scale: 'Големина',
      waiting: 'Чекање…', save: 'Собирај:', slider: 'Лизгач:'
    },
    fa: {
      title: 'تنظیمات ابزارک', langTitle: 'انتخاب زبان', language: 'زبان',
      widgetEnable: 'فعال‌سازی ابزارک', widgetDisable: 'غیرفعال‌سازی ابزارک',
      unlock: 'آزاد کردن (کشیدن)', lock: 'قفل کردن',
      position: 'موقعیت در صفحه', left: 'چپ', center: 'وسط', right: 'راست',
      opacity: 'شفافیت', scale: 'اندازه',
      waiting: 'در انتظار…', save: 'ذخیره کن:', slider: 'لغزنده:'
    },
    pl: {
      title: 'Ustawienia widżetu', langTitle: 'Wybór języka', language: 'Język',
      widgetEnable: 'Włącz widżet', widgetDisable: 'Wyłącz widżet',
      unlock: 'Odblokuj (przeciąganie)', lock: 'Zablokuj',
      position: 'Pozycja na ekranie', left: 'Lewo', center: 'Środek', right: 'Prawo',
      opacity: 'Przezroczystość', scale: 'Rozmiar',
      waiting: 'Oczekiwanie…', save: 'Zbieraj:', slider: 'Suwak:'
    },
    sh: {
      title: 'Postavke widgeta', langTitle: 'Izbor jezika', language: 'Jezik',
      widgetEnable: 'Uključi widget', widgetDisable: 'Isključi widget',
      unlock: 'Otključaj (povlačenje)', lock: 'Zaključaj',
      position: 'Položaj na ekranu', left: 'Levo', center: 'Centar', right: 'Desno',
      opacity: 'Prozirnost', scale: 'Veličina',
      waiting: 'Čekanje…', save: 'Skupljaj:', slider: 'Klizač:'
    },
    sk: {
      title: 'Nastavenia widgetu', langTitle: 'Výber jazyka', language: 'Jazyk',
      widgetEnable: 'Zapnúť widget', widgetDisable: 'Vypnúť widget',
      unlock: 'Odomknúť (ťahanie)', lock: 'Zamknúť',
      position: 'Pozícia na obrazovke', left: 'Vľavo', center: 'Stred', right: 'Vpravo',
      opacity: 'Priehľadnosť', scale: 'Veľkosť',
      waiting: 'Čakanie…', save: 'Šetri:', slider: 'Posuvník:'
    },
    sl: {
      title: 'Nastavitve pripomočka', langTitle: 'Izbira jezika', language: 'Jezik',
      widgetEnable: 'Vklopi pripomoček', widgetDisable: 'Izklopi pripomoček',
      unlock: 'Odkleni (vlečenje)', lock: 'Zakleni',
      position: 'Položaj na zaslonu', left: 'Levo', center: 'Sredina', right: 'Desno',
      opacity: 'Prosojnost', scale: 'Velikost',
      waiting: 'Čakanje…', save: 'Zbiraj:', slider: 'Drsnik:'
    },
    es: {
      title: 'Ajustes del widget', langTitle: 'Selección de idioma', language: 'Idioma',
      widgetEnable: 'Activar widget', widgetDisable: 'Desactivar widget',
      unlock: 'Desbloquear (arrastrar)', lock: 'Bloquear',
      position: 'Posición en pantalla', left: 'Izquierda', center: 'Centro', right: 'Derecha',
      opacity: 'Opacidad', scale: 'Tamaño',
      waiting: 'Esperando…', save: 'Acumula:', slider: 'Control:'
    },
    sv: {
      title: 'Widget-inställningar', langTitle: 'Välj språk', language: 'Språk',
      widgetEnable: 'Aktivera widget', widgetDisable: 'Inaktivera widget',
      unlock: 'Lås upp (dra)', lock: 'Lås',
      position: 'Position på skärmen', left: 'Vänster', center: 'Mitten', right: 'Höger',
      opacity: 'Genomskinlighet', scale: 'Storlek',
      waiting: 'Väntar…', save: 'Spara:', slider: 'Reglage:'
    },
    gsw: {
      title: 'Widget-Iistellige', langTitle: 'Sprooch uuswähle', language: 'Sprooch',
      widgetEnable: 'Widget iischalte', widgetDisable: 'Widget uusschalte',
      unlock: 'Uufschliesse (zieh)', lock: 'Zuemache',
      position: 'Position uf em Bildschirm', left: 'Links', center: 'Mitti', right: 'Rächts',
      opacity: 'Duursichtigkeit', scale: 'Grössi',
      waiting: 'Wartet…', save: 'Spare:', slider: 'Regler:'
    },
    tok: {
      title: 'lipu lawa pi ilo lili', langTitle: 'o pali e toki', language: 'toki',
      widgetEnable: 'o open e ilo lili', widgetDisable: 'o pini e ilo lili',
      unlock: 'ken tawa (o tawa e ona)', lock: 'awen',
      position: 'ma pi ilo lili', left: 'poka open', center: 'insa', right: 'poka pini',
      opacity: 'suno', scale: 'suli',
      waiting: 'o awen…', save: 'o kama jo e:', slider: 'palisa:'
    },
    tr: {
      title: 'Widget ayarları', langTitle: 'Dil seçimi', language: 'Dil',
      widgetEnable: 'Widget\'ı aç', widgetDisable: 'Widget\'ı kapat',
      unlock: 'Serbest bırak (sürükle)', lock: 'Kilitle',
      position: 'Ekrandaki konum', left: 'Sol', center: 'Orta', right: 'Sağ',
      opacity: 'Saydamlık', scale: 'Boyut',
      waiting: 'Bekleniyor…', save: 'Biriktir:', slider: 'Kaydırıcı:'
    }
  };

  /** Memoised merge results, keyed by language code. */
  const tableCache = new Map();

  /**
   * Resolves a language code to a complete string table.
   * Unknown codes and partially translated locales fall back to English.
   *
   * @param {string} lang Language code from the catalogue.
   * @returns {Readonly<Record<string, string>>}
   */
  function t(lang) {
    const code = STRINGS[lang] ? lang : DEFAULT_LANG;
    let table = tableCache.get(code);
    if (!table) {
      table = Object.freeze({ ...STRINGS[DEFAULT_LANG], ...STRINGS[code] });
      tableCache.set(code, table);
    }
    return table;
  }

  globalThis.OFDC = Object.freeze({
    LANGUAGES: Object.freeze(LANGUAGES),
    DEFAULT_LANG,
    t
  });
})();
