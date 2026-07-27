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

self.addEventListener('fetch', (e) => {
  const req = e.request;
  // Nur eigene GET-Anfragen anfassen. Fremdes (Schriften o.Ä.) läuft normal.
  if (req.method !== 'GET') return;
  let url;
  try { url = new URL(req.url); } catch { return; }
  if (url.origin !== self.location.origin) return;

  // „Kein Cache" hieß bisher nur: der Service Worker legt keinen an. Der
  // normale HTTP-Cache des Browsers greift trotzdem — GitHub Pages liefert
  // statische Dateien mit Gültigkeitsdauer aus. In einer installierten PWA
  // gibt es kein „Hard Reload", deshalb konnte ein Deploy minutenlang
  // unsichtbar bleiben. `cache: 'reload'` geht am HTTP-Cache vorbei und
  // frischt ihn zugleich auf — damit stimmt endlich, was oben steht.
  e.respondWith(
    fetch(req, { cache: 'reload' })
      // Kein Netz? Dann lieber eine womöglich ältere Fassung aus dem
      // HTTP-Cache als eine kaputte Seite.
      .catch(() => fetch(req, { cache: 'force-cache' }))
  );
});
