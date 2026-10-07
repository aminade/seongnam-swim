/**
 * 안 읽은 공지('no-key') 전부를 "확인 완료"('manual-ok')로 바꿔 누적 카운트를 0으로 되돌린다.
 * Claude가 쌓인 글을 읽고 사이트에 반영한 뒤 실행한다. 사용: node scripts/notice-mark-read.js
 */
import { readFileSync, writeFileSync, copyFileSync } from 'fs';
import { STATE_PATH } from './notice-watch.js';

const state = JSON.parse(readFileSync(STATE_PATH, 'utf-8'));
let n = 0;
for (const e of Object.values(state.posts)) {
  if (e.status === 'no-key') { e.status = 'manual-ok'; e.listed = true; e.edited = false; n++; }
}
copyFileSync(STATE_PATH, `${STATE_PATH}.bak`);
writeFileSync(STATE_PATH, JSON.stringify(state, null, 1));
console.log(`확인 완료 처리 ${n}건 → 안 읽은 공지 0건`);
