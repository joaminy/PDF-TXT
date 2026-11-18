/* PDF → TXT — 오프라인용 서비스 워커.
   앱 파일을 기기에 보관해 인터넷 없이도 열리게 한다. 다른 주소로는 어떤 요청도 보내지 않는다.
   사용자의 PDF와 문자인식용 그림은 이 워커를 거치지 않는다(화면에서 바로 메모리로 읽는다).
   예외: Android ‘공유 → PDF→TXT’로 받은 PDF는 앱이 열릴 때까지 기기 안 임시 보관함에 잠깐 두고, 앱이 꺼내는 즉시 지운다. */
'use strict';
const VERSION = '__VERSION__';
const PREFIX = 'pdf2txt-app-';
const CACHE = PREFIX + VERSION;
const SHARE_CACHE = 'pdf2txt-share';
// 설치할 때 모두 받는 파일
const FILES = __FILES__;
// 문자인식 엔진처럼 큰 파일: 처음 쓸 때(또는 ‘미리 받기’) 받아서 보관한다. [경로, 허용하는 해시 목록]
const OPTIONAL = __OPTIONAL__;
const HASH = new Map(FILES.map(([p, h]) => [new URL(p, self.location.href).pathname, h]));
const OPT_HASH = new Map(OPTIONAL.map(([p, h]) => [new URL(p, self.location.href).pathname, h]));

/** 합성 응답에는 형식만 남긴다(압축·길이 머리글이 실제 내용과 어긋나지 않게) */
function plainHeaders(h) {
  return { 'Content-Type': (h && h.get('content-type')) || 'application/octet-stream' };
}

async function sha16(buf) {
  const d = new Uint8Array(await crypto.subtle.digest('SHA-256', buf));
  let s = '';
  for (let i = 0; i < 8; i++) s += d[i].toString(16).padStart(2, '0');
  return s;
}

// 새 버전 설치: 내용이 같은 파일은 기기에 있던 것을 옮기고, 바뀐 파일만 받는다.
// 받은 파일의 내용(해시)도 확인해, 서버에 아직 옛 파일이 남아 있으면 설치를 미루고 다음에 다시 시도한다.
// 문자인식 엔진은 이미 받아 둔 것만 새 보관함으로 옮긴다(새로 받지는 않는다).
self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    const oldNames = (await caches.keys()).filter((k) => k.startsWith(PREFIX) && k !== CACHE);
    const olds = await Promise.all(oldNames.map((k) => caches.open(k)));
    // hash: 해시 하나 또는 허용하는 해시 목록
    const ok = (h, hash) => (Array.isArray(hash) ? hash.includes(h) : h === hash);
    async function reuse(path, hash) {
      const have = await cache.match(path);
      if (have && ok(await sha16(await have.arrayBuffer()), hash)) return true;   // 지난번에 받다 끊긴 경우 이어 받기
      for (const oc of olds) {
        const r = await oc.match(path);
        if (!r) continue;
        const buf = await r.arrayBuffer();
        if (ok(await sha16(buf), hash)) {
          await cache.put(path, new Response(buf, { headers: plainHeaders(r.headers) }));
          return true;
        }
      }
      return false;
    }
    let next = 0;
    async function worker() {
      while (next < FILES.length) {
        const [path, hash] = FILES[next++];
        if (await reuse(path, hash)) continue;
        const res = await fetch(new Request(path, { cache: 'reload' }));
        if (!res.ok) throw new Error('HTTP ' + res.status + ' ' + path);
        const buf = await res.clone().arrayBuffer();
        if (await sha16(buf) !== hash) throw new Error('아직 옛 파일: ' + path);
        await cache.put(path, res);
      }
    }
    await Promise.all(Array.from({ length: 6 }, worker));
    for (const [path, hash] of OPTIONAL) {
      try { await reuse(path, hash); } catch (e) { /* 다음에 쓸 때 받는다 */ }
    }
    await self.skipWaiting();
  })());
});

// 보관함이 비었을 때(같은 주소의 다른 앱이나 기기가 정리한 경우) 인터넷이 되면 이 버전의 파일로 다시 채운다.
let healing = null;
function heal() {
  if (!healing) {
    healing = (async () => {
      const cache = await caches.open(CACHE);
      for (const [path, hash] of FILES) {
        if (await cache.match(path)) continue;
        let res;
        try { res = await fetch(new Request(path, { cache: 'reload' })); } catch (e) { return; }
        if (!res.ok) continue;
        const buf = await res.arrayBuffer();
        if (await sha16(buf) === hash) await cache.put(path, new Response(buf, { headers: plainHeaders(res.headers) }));
      }
    })().catch(() => {}).finally(() => { healing = null; });
  }
  return healing;
}

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    // 이 앱의 옛 버전 보관함만 지운다(같은 주소의 다른 앱 보관함은 건드리지 않는다)
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k.startsWith(PREFIX) && k !== CACHE).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

/** 큰 선택 파일: 보관함에 없으면 이 앱 주소에서 받아, 내용이 맞을 때만 보관한다. hashes: 허용하는 해시 목록 */
async function optionalFile(req, hashes) {
  const cache = await caches.open(CACHE);
  const hit = await cache.match(req, { ignoreSearch: true });
  if (hit) return hit;
  const res = await fetch(new Request(req.url, { cache: 'reload' }));
  if (!res.ok) return res;
  const buf = await res.arrayBuffer();
  const out = new Response(buf, { status: 200, headers: plainHeaders(res.headers) });
  if (hashes.includes(await sha16(buf))) await cache.put(new URL(req.url).pathname, out.clone());
  return out;
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (req.method === 'POST' && url.pathname.endsWith('/share-target')) {
    event.respondWith(receiveShare(req));
    return;
  }
  if (req.method !== 'GET') return;
  if (OPT_HASH.has(url.pathname)) {
    event.respondWith(optionalFile(req, OPT_HASH.get(url.pathname)).catch(() =>
      new Response('오프라인 상태입니다.', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } })));
    return;
  }
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const hit = await cache.match(req, { ignoreSearch: true });
    if (hit) return hit;
    if (req.mode === 'navigate') {
      const page = await cache.match('./index.html');
      if (page) return page;
    }
    try {
      const res = await fetch(req);
      if (res.ok && HASH.has(url.pathname)) {
        try { event.waitUntil(heal()); } catch (e) { heal(); }
      }
      return res;
    } catch (e) {
      return new Response('오프라인 상태입니다.', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
    }
  })());
});

// 다른 앱에서 ‘공유 → PDF→TXT’로 보낸 PDF를 기기 안 임시 보관함에 넣고 앱을 연다 (Android)
async function receiveShare(req) {
  try {
    const form = await req.formData();
    const files = form.getAll('pdf').filter((f) => f && typeof f === 'object' && f.size > 0);
    const cache = await caches.open(SHARE_CACHE);
    let i = 0;
    for (const f of files) {
      await cache.put(
        new Request('./__shared__/' + Date.now() + '-' + (i++)),
        new Response(f, { headers: { 'Content-Type': 'application/pdf', 'X-Name': encodeURIComponent(f.name || 'shared.pdf') } })
      );
    }
  } catch (e) { /* 받지 못하면 그냥 앱을 연다 */ }
  return Response.redirect(new URL('./?shared=1', self.registration.scope).href, 303);
}
