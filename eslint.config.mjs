// ============================================================
// eslint.config.mjs — optionale Prüfung, kein Teil der App.
//
// WOFÜR
// Ein Test sieht nur Code, den er auch ausführt. Ein Linter sieht allen
// Code, immer. Genau deshalb gibt es diese Datei: Beim Aufteilen von
// kraft.js fielen fünf Namen aus einem Import-Block, alle Tests blieben
// grün — weil die betroffenen Aktionen (Teilen, Umbenennen) von keinem
// Test aufgerufen wurden. Aufgefallen ist es erst beim Benutzen.
//
// `no-undef` findet diese Klasse vollständig und in Sekunden.
//
// BENUTZUNG
//   npm install     (einmalig — holt ESLint)
//   npm run lint
//
// `npm test` braucht das NICHT: die Tests laufen weiter ohne jede
// Abhängigkeit. Und ausgeliefert wird davon nichts — node_modules steht
// in .gitignore, auf GitHub Pages landet kein Byte davon.
// ============================================================

export default [
  {
    files: ['**/*.js'],
    ignores: ['node_modules/**'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: {
        // Browser-Umgebung
        window: 'readonly', document: 'readonly', navigator: 'readonly',
        location: 'readonly', history: 'readonly', screen: 'readonly',
        localStorage: 'readonly', caches: 'readonly', self: 'readonly',
        console: 'readonly', fetch: 'readonly', crypto: 'readonly',
        setTimeout: 'readonly', clearTimeout: 'readonly',
        setInterval: 'readonly', clearInterval: 'readonly',
        requestAnimationFrame: 'readonly', visualViewport: 'readonly',
        devicePixelRatio: 'readonly', getComputedStyle: 'readonly',
        matchMedia: 'readonly', performance: 'readonly',
        Blob: 'readonly', File: 'readonly', URL: 'readonly',
        FileReader: 'readonly', Image: 'readonly', alert: 'readonly',
        Intl: 'readonly', structuredClone: 'readonly', globalThis: 'readonly',
        // Node (nur für die Tests)
        process: 'readonly',
      },
    },
    rules: {
      // DIE Regel, um die es geht: ein Name, den es nirgends gibt.
      'no-undef': 'error',

      // Nützliche Nachbarn derselben Art — Dinge, die kein Test bemerkt,
      // weil der Code trotzdem läuft.
      'no-dupe-keys': 'error',          // zwei gleiche Schlüssel: einer gewinnt still
      'no-dupe-class-members': 'error',
      'no-unreachable': 'error',        // Code hinter return
      'no-self-assign': 'error',
      'no-constant-condition': ['error', { checkLoops: false }],

      // Warnung, kein Fehler: unbenutzte Namen sind ein Geruch, kein Defekt.
      'no-unused-vars': ['warn', { args: 'none', varsIgnorePattern: '^_' }],
    },
  },
];
