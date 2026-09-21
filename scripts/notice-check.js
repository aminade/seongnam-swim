#!/usr/bin/env node
/**
 * 성남 수영장 공지 감시 + 공휴일 리마인더 + 말일 TO-DO
 *
 * 1) 공지 감시(notice-watch.js): 모든 수영장 게시판의 새 글·수정된 글을 전부 읽는다.
 *    본문·첨부(PDF/HWP/이미지)는 로컬에서 텍스트로 뽑고(무료), 운영 관련 글만 Claude(Sonnet)로 해석해
 *    우리 사이트(index.html)와 대조한다. 제목만 보고 고르지 않는다 — 2026-09에 놓친 공지가 전부
 *    "재등록 안내"·"강습 안내" 같은 제목 안에 있었다.
 * 2) 공휴일 리마인더: data.go.kr 특일정보 API로 그 달 공휴일 조회 → 우리 HOLIDAYS에 빠진 게 있으면 경고.
 * 3) 매월 말일: 다음 달 1일 TO-DO.
 *
 * 출력: /tmp/notice-check.json (텔레그램 스텝이 읽음). 알릴 것이 있으면 exit 2.
 * 환경변수: ANTHROPIC_API_KEY(공지 해석), NOTICE_MODEL(기본 claude-sonnet-5), HOLIDAY_API_KEY, SEO_CHANGES_CSV_URL
 */

import { writeFileSync } from 'fs';
import { buildMonthlyTodo } from './monthly-todo.js';
import { loadSiteModel } from './site-model.js';
import { watchNotices } from './notice-watch.js';
import { fetchRes } from './notice-sources.js';

const pad = n => String(n).padStart(2, '0');
const fetchText = async url => (await fetchRes(url)).text();

// ── 공휴일 리마인더 (data.go.kr 특일정보) ──
async function fetchOfficialHolidays(year, month, apiKey) {
  // 서비스키는 보통 URL-encoding된 값이 발급됨. URLSearchParams는 재인코딩하므로,
  // 안전하게 decode 후 넣는다(이미 decode 상태면 그대로).
  let key = apiKey;
  try { key = decodeURIComponent(apiKey); } catch { /* 그대로 */ }
  const params = new URLSearchParams({
    serviceKey: key, solYear: String(year), solMonth: pad(month), numOfRows: '50', _type: 'json',
  });
  const url = `https://apis.data.go.kr/B090041/openapi/service/SpcdeInfoService/getRestDeInfo?${params}`;
  const text = await fetchText(url);
  let json;
  try { json = JSON.parse(text); }
  catch { throw new Error(`공휴일 API 응답 파싱 실패(키 미승인/오류 가능): ${text.slice(0, 120)}`); }
  const items = json?.response?.body?.items?.item;
  const arr = !items ? [] : Array.isArray(items) ? items : [items];
  // isHoliday==='Y'만(공휴일). locdate: YYYYMMDD 숫자
  return arr
    .filter(it => String(it.isHoliday).trim() === 'Y')
    .map(it => {
      const s = String(it.locdate);
      return { date: `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`, name: String(it.dateName).trim() };
    });
}

async function main() {
  // 실행 시각을 KST로 환산(Actions는 UTC). getUTC*로 KST 벽시계를 읽는다.
  const DOW = ['일', '월', '화', '수', '목', '금', '토'];
  const kst = new Date(Date.now() + 9 * 3600 * 1000);
  const runLabel = `${kst.getUTCMonth() + 1}/${kst.getUTCDate()}(${DOW[kst.getUTCDay()]})`;
  // 공휴일 리마인더 대상 월: 25일 이후 실행이면 다음 달(미리 보기), 아니면 이번 달
  let year = kst.getUTCFullYear(), month = kst.getUTCMonth() + 1;
  if (kst.getUTCDate() >= 25) { month++; if (month > 12) { month = 1; year++; } }
  const label = `${year}. ${pad(month)}`;
  console.log(`\n=== 공지·공휴일 점검 (${runLabel} 실행) ===\n`);

  const site = loadSiteModel();

  // ── 1) 공지 감시 ──
  let watch = null;
  try {
    const today = new Date(kst.getUTCFullYear(), kst.getUTCMonth(), kst.getUTCDate());
    watch = await watchNotices({ site, today });
  } catch (e) {
    console.log(`공지 감시 오류: ${e.message}`);
    watch = { error: e.message, fresh: [], pending: [], needsImpl: [], manual: [], errors: [], stats: {} };
  }

  // ── 2) 공휴일 리마인더 ──
  let holidayInfo = null;
  const apiKey = process.env.HOLIDAY_API_KEY;
  if (apiKey) {
    process.stdout.write(`\n${label} 공휴일 조회(data.go.kr)... `);
    try {
      const official = await fetchOfficialHolidays(year, month, apiKey);
      const missing = official.filter(h => !site.HOLIDAYS.has(h.date)); // 우리 HOLIDAYS에 없는 공휴일
      console.log(`${official.length}건${missing.length ? `, ⚠️ 우리 데이터 누락 ${missing.length}건` : ''}`);
      holidayInfo = { year, month, official, missing };
    } catch (e) {
      console.log(`오류: ${e.message}`);
      holidayInfo = { year, month, error: e.message };
    }
  } else {
    console.log('\n(HOLIDAY_API_KEY 미설정 — 공휴일 리마인더 건너뜀)');
  }

  // ── 3) 매월 말일: 다음 달 1일 TO-DO (수영장 영업 변경사항 + 이전 달 SEO 성과 기록) ──
  // 말일이 아니면 null. 네트워크(구글시트 CSV) 실패가 점검 전체를 깨지 않도록 격리한다.
  let monthlyTodo = null;
  try {
    monthlyTodo = await buildMonthlyTodo();
    if (monthlyTodo) console.log(`\n${monthlyTodo.comingLabel} TO-DO 생성: 변경 ${monthlyTodo.changes.length}건${monthlyTodo.error ? ` (${monthlyTodo.error})` : ''}`);
  } catch (e) {
    console.log(`\nTO-DO 생성 오류: ${e.message}`);
  }

  // ── 요약/출력 ──
  const holidayMissing = holidayInfo?.missing?.length || 0;
  const w = watch;
  const alert = w.fresh.length > 0 || w.pending.length > 0 || w.needsImpl.length > 0 || w.manual.length > 0
    || w.errors.length > 0 || !!w.error || holidayMissing > 0;

  console.log('\n=== 요약 ===');
  const st = w.stats || {};
  console.log(`글 ${st.posts ?? '-'}건 확인 · 새로/수정 읽음 ${st.read ?? '-'} · 운영 관련 ${st.ops ?? '-'} · AI 해석 ${st.ai ?? '-'}`
    + (st.ai ? ` (토큰 입력 ${st.inputTokens}·출력 ${st.outputTokens})` : ''));
  for (const f of w.fresh) { console.log(`  📢 ${f.poolName} 「${f.title}」`); f.items.forEach(i => console.log(`      ${i.text}`)); }
  for (const f of w.pending) { console.log(`  ⏳ ${f.poolName} 「${f.title}」`); f.items.forEach(i => console.log(`      ${i.text}`)); }
  for (const n of w.needsImpl) console.log(`  🛠 ${n.poolName}: ${n.description}`);
  for (const m of w.manual) console.log(`  🔎 ${m.poolName} 「${m.title}」 — ${m.reason}`);
  for (const e of w.errors) console.log(`  ⚠️ ${e.pool}: ${e.error}`);
  if (holidayInfo?.official) console.log(`${label} 공휴일: ${holidayInfo.official.map(h => `${h.date.slice(5)} ${h.name}`).join(', ') || '없음'}`);
  if (holidayMissing) console.log(`⚠️ 우리 데이터 누락 공휴일: ${holidayInfo.missing.map(h => `${h.date} ${h.name}`).join(', ')}`);

  writeFileSync('/tmp/notice-check.json', JSON.stringify({
    target: { year, month, label, runLabel, isFirstOfMonth: kst.getUTCDate() === 1 },
    watch, holidayInfo, monthlyTodo,
  }, null, 2));

  process.exit(alert ? 2 : 0);
}

main().catch(e => { console.error(e); process.exit(1); });
