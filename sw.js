/* Service worker: ทำให้ติดตั้งเป็นแอปบนมือถือได้ (แสดงโลโก้บนหน้าจอหลัก)
   ใช้แบบ network-first: ออนไลน์ได้ข้อมูลล่าสุดเสมอ ออฟไลน์จะเปิดหน้าที่เคยโหลดไว้ */
const CACHE = 'money-v1';

self.addEventListener('install', function () { self.skipWaiting(); });
self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (k) { return k !== CACHE; }).map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});

self.addEventListener('fetch', function (e) {
  const req = e.request;
  const url = new URL(req.url);
  // ไม่ยุ่งกับ GitHub API / CDN / การบันทึก
  if (req.method !== 'GET' || url.origin !== self.location.origin) return;
  // ไฟล์ฐานข้อมูลมี ?t=... ทุกครั้ง: เก็บแคชไว้ key เดียว (ใช้ตอนออฟไลน์)
  const isDb = url.pathname.endsWith('/data/money.sqlite');
  const cacheKey = isDb ? url.origin + url.pathname : req;
  e.respondWith(
    fetch(req).then(function (res) {
      if (res.ok) {
        const copy = res.clone();
        caches.open(CACHE).then(function (c) { c.put(cacheKey, copy); });
      }
      return res;
    }).catch(function () {
      return caches.match(cacheKey, { ignoreSearch: !isDb }).then(function (r) {
        return r || Response.error();
      });
    })
  );
});
