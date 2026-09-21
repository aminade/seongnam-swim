/**
 * 공지 대조 회귀 테스트 (API 호출 없음).
 * 2026년 9월에 놓쳤던 실제 공지 5건을 "AI가 이렇게 구조화했다"고 두고,
 *  - 수정 전 사이트(0e88f2d^)에선 전부 잡아내고
 *  - 수정 후 사이트(현재 index.html)에선 아무것도 안 나와야 한다.
 * 실행: node scripts/test/notice-compare.test.js
 */
import { execSync } from 'child_process';
import { writeFileSync, mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { loadSiteModel } from '../site-model.js';
import { compareFacts } from '../notice-watch.js';

const F = (o) => ({ relevant: true, summary: '', closures: [], openDays: [], specialSchedules: [], monthlyClosureList: null, unsupported: [], ...o });
const CASES = [
  ['geumgok', '금곡 10월 임시휴장', F({ closures: [
    { from: '2026-10-09', to: '2026-10-10', reason: '보수공사 임시휴장' },
    { from: '2026-10-11', to: '2026-10-11', reason: '정기휴장' }, { from: '2026-10-25', to: '2026-10-25', reason: '정기휴장' }],
    monthlyClosureList: { year: 2026, month: 10 } })],
  ['pangyo', '판교 10월 보수공사 + 특별운영', F({ closures: [{ from: '2026-10-01', to: '2026-10-25', reason: '보수공사' }],
    specialSchedules: [{ from: '2026-10-26', to: '2026-10-31', dayType: '평일', times: ['09:00~10:50', '13:00~14:50', '16:00~17:50'], adultPrice: 3600, replacesRegular: true, note: '' }] })],
  ['yc_yatap', '야탑유스 9월 공사 휴장 + 10월 평일 오전 임시 자유수영', F({ closures: [{ from: '2026-09-01', to: '2026-09-30', reason: '주차장 공사' }],
    specialSchedules: [{ from: '2026-10-01', to: '2027-09-30', dayType: '평일', times: ['10:00~10:50', '11:00~11:50'], adultPrice: 3000, replacesRegular: false, note: '종료일 미정' }] })],
  ['hwangse', '황새울 10월 주차공사 임시휴장', F({ closures: [
    { from: '2026-10-03', to: '2026-10-05', reason: '주차공사 임시휴장' }, { from: '2026-10-18', to: '2026-10-18', reason: '정기휴장' }],
    monthlyClosureList: { year: 2026, month: 10 } })],
  ['bdolympic', '분당올림픽 추석 휴관', F({ closures: [{ from: '2026-09-24', to: '2026-09-26', reason: '추석 연휴 휴관' }] })],
  ['seongnam', '성남 9월 휴장일', F({ closures: [
    { from: '2026-09-13', to: '2026-09-13', reason: '정기휴장' }, { from: '2026-09-24', to: '2026-09-26', reason: '추석' },
    { from: '2026-09-27', to: '2026-09-27', reason: '정기휴장' }], monthlyClosureList: { year: 2026, month: 9 } })],
];
const TODAY = new Date(2026, 8, 12); // 9/12 — 공지들이 막 올라오던 시점
// 수정 전 = 오늘 아침 사이트(0e88f2d^). 야탑은 그 뒤에도 빠져 있었으므로 0e88f2d 기준으로도 잡혀야 한다.

const dir = mkdtempSync(join(tmpdir(), 'site-'));
const oldIndex = join(dir, 'index.old.html');
writeFileSync(oldIndex, execSync('git show 0e88f2d^:index.html', { maxBuffer: 1 << 26 }));
const before = loadSiteModel(oldIndex);
const after = loadSiteModel();

let fail = 0;
for (const [pool, name, facts] of CASES) {
  const b = compareFacts(before, pool, facts, TODAY);
  const a = compareFacts(after, pool, facts, TODAY);
  const expectCatch = pool !== 'seongnam'; // 성남 9월은 원래부터 맞았음 → 양쪽 다 조용해야 함
  const ok = (expectCatch ? b.length > 0 : b.length === 0) && a.length === 0;
  if (!ok) fail++;
  console.log(`${ok ? '✅' : '❌'} ${name}`);
  b.forEach(i => console.log(`     수정 전: ${i.text}`));
  a.forEach(i => console.log(`     수정 후(남으면 안 됨): ${i.text}`));
}
// ── 오탐 방지: 첫 AI 시험(2026-09-22)에서 나온 잘못된 알림 패턴. 현재 사이트에서 조용해야 한다. ──
const T2 = new Date(2026, 8, 22);
const month = (from, to, times) => ({ from, to, dayType: '일요일·공휴일', times, adultPrice: 3600, replacesRegular: true, note: '' });
const QUIET = [
  // 판교 9월: AI가 월간 일·공휴일 시간표를 특별 시간표로 넣었지만, 같은 글에 24~27 휴장이 있음
  ['pangyo', '판교 9월 월간표 + 추석/정기휴장', F({ closures: [{ from: '2026-09-24', to: '2026-09-26', reason: '추석' }, { from: '2026-09-27', to: '2026-09-27', reason: '정기휴장' }],
    specialSchedules: [month('2026-09-01', '2026-09-30', ['09:00~10:50', '13:00~14:50', '16:00~17:50'])] }), new Set()],
  // 금곡 10월 강습·자유이용 안내: 휴장일은 별도 글(10월 휴장일 및 임시휴장 안내)에만 있음 → 다른 글의 휴장일로 상쇄
  ['geumgok', '금곡 10월 월간표 + 별도 휴장일 글', F({ specialSchedules: [month('2026-10-01', '2026-10-31', ['10:00~11:50', '13:00~14:50', '16:00~17:50'])] }),
    new Set(['2026-10-09', '2026-10-10', '2026-10-11', '2026-10-25'])],
];
for (const [pool, name, facts, known] of QUIET) {
  const a = compareFacts(after, pool, facts, T2, known);
  const ok = a.length === 0;
  if (!ok) fail++;
  console.log(`${ok ? '✅' : '❌'} (오탐 방지) ${name}`);
  a.forEach(i => console.log(`     남으면 안 됨: ${i.text}`));
}

console.log(fail ? `\n${fail}건 실패` : '\n전부 통과');
process.exit(fail ? 1 : 0);
