/* 오늘의 자유수영 — 최소 서비스워커
 *
 * 목적은 오직 하나: 안드로이드 크롬이 "앱 설치"를 제안할 수 있게 하는 것.
 * (크롬은 fetch 핸들러가 있는 서비스워커 + manifest가 있어야 설치 대상으로 본다)
 *
 * ⚠️ 캐시를 두지 않는다. 이 사이트는 "오늘 휴장인가"를 보는 곳이라 옛 화면이 남으면
 *    잘못된 정보를 보여주게 된다. 그래서 요청을 그대로 네트워크로 흘려보내기만 한다.
 */
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', e => { e.respondWith(fetch(e.request)); });
