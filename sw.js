// ============================================================
// sw.js — minimaler Service Worker.
//
// ZWECK: Chrome/Samsung verlangen einen Service Worker, damit die App
// als installierbar gilt („App installieren" statt nur Verknüpfung).
//
// BEWUSST OHNE CACHE: Jede Anfrage geht direkt ans Netz. Dadurch gibt es
// keine veralteten Dateien nach einem Deploy — Updates sind sofort da.
// Wer später Offline-Fähigkeit will, ergänzt hier eine Cache-Strategie
// und zählt bei jedem Release den Cache-Namen hoch.
// ============================================================

self.addEventListener('install', () => {
  // Sofort aktiv werden, nicht auf das Schließen alter Tabs warten.
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  // Alte Caches (falls je welche angelegt wurden) aufräumen.
  e.waitUntil(
    caches.keys()
      .then((namen) => Promise.all(namen.map((n) => caches.delete(n))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', () => {
  // Kein respondWith → der Browser holt normal aus dem Netz.
  // Genau so bleibt die App immer aktuell.
});
