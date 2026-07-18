#!/usr/bin/env node
/**
 * 성남 수영장 공지 게시판 점검 + 공휴일 리마인더
 *
 * 1) 공지 크롤: 성남도개공 시설 게시판(selectNoticeList.ajax)에서 "N월 운영프로그램 및 휴장일 안내"의
 *    "■ N월 휴장일 안내" 블록을 파싱 → 우리 사이트(index.html)가 그 달에 계산하는 휴장일과 비교.
 *    - 공지가 없으면 = 기존 시간표대로(변경 없음).
 * 2) 공휴일 리마인더: data.go.kr 특일정보 API로 그 달 공휴일(대체공휴일 포함)을 조회 →
 *    목록을 안내하고, 우리 HOLIDAYS 세트에 빠진 공휴일이 있으면 경고.
 *
 * 우리 데이터의 단일 출처는 index.html (POOLS 배열 + HOLIDAYS 세트)을 직접 읽어 드리프트를 방지한다.
 *
 * 출력: /tmp/notice-check.json (Telegram 발송 스텝이 읽음). 차이/경고가 있으면 exit 2.
 * 환경변수: HOLIDAY_API_KEY (data.go.kr 서비스 키). 없으면 공휴일 리마인더는 건너뜀.
 */

import { readFileSync, writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dir = dirname(fileURLToPath(import.meta.url));
const INDEX = join(__dir, '..', 'index.html');

// ── 공지 게시판이 있는 시설 (성남도개공). up_id는 notice0N.do 규칙과 동일 ──
// 평생만 매월 "휴장일 안내"를 규칙적으로 올린다. 나머지는 올리면 비교, 없으면 변경 없음.
const NOTICE_POOLS = [
  { id: 'pyengsaeng', name: '평생스포츠센터',       up_id: '05' },
  { id: 'tanchen',    name: '탄천종합운동장',       up_id: '03' },
  { id: 'seongnam',   name: '성남종합운동장',       up_id: '02' },
  { id: 'hwangse',    name: '황새울국민체육센터',   up_id: '01' },
  { id: 'pangyo',     name: '판교스포츠센터',       up_id: '04' },
  { id: 'geumgok',    name: '금곡공원국민체육센터', up_id: '06' },
];

// ── index.html에서 진실을 읽는다 (POOLS 배열 + HOLIDAYS 세트) ──
function loadSiteData() {
  const html = readFileSync(INDEX, 'utf-8');

  // POOLS 배열: `const POOLS = [ ... ];` 의 대괄호 균형으로 정확히 추출 후 eval
  const start = html.indexOf('const POOLS = [');
  if (start === -1) throw new Error('index.html에서 POOLS 배열을 찾지 못함');
  const arrStart = html.indexOf('[', start);
  let depth = 0, end = -1;
  for (let i = arrStart; i < html.length; i++) {
    const c = html[i];
    if (c === '[') depth++;
    else if (c === ']') { depth--; if (depth === 0) { end = i; break; } }
  }
  const POOLS = eval(html.slice(arrStart, end + 1)); // 배열 리터럴(외부 참조 없음)

  // HOLIDAYS / LUNAR_HOLIDAYS 날짜 문자열
  const grab = (marker) => {
    const s = html.indexOf(marker);
    if (s === -1) return new Set();
    const block = html.slice(s, html.indexOf(']);', s));
    return new Set([...block.matchAll(/(\d{4}-\d{2}-\d{2})/g)].map(m => m[1]));
  };
  const HOLIDAYS = grab('const HOLIDAYS');

  return { POOLS, HOLIDAYS };
}

// ── 날짜 유틸 ──
const pad = n => String(n).padStart(2, '0');
const ymd = (y, m, d) => `${y}-${pad(m)}-${pad(d)}`;
function nthSundaysOfMonth(year, month /*1-12*/, weeks) {
  const res = {};
  let c = 0;
  for (let d = 1; d <= 31; d++) {
    const dt = new Date(year, month - 1, d);
    if (dt.getMonth() !== month - 1) break;
    if (dt.getDay() === 0) { c++; if (weeks.includes(c)) res[d] = `정기휴관(${c}주 일요일)`; }
  }
  return res;
}

// 우리 사이트가 (pool, year, month)에 휴장으로 계산하는 날짜 맵 {day: 사유}
function ourClosedDays(pool, year, month, HOLIDAYS) {
  const out = {};
  // 정기(주간) 휴관
  Object.assign(out, nthSundaysOfMonth(year, month, pool.closedWeeks || []));
  // 공휴일 휴관 ('all'만; 'lunar'는 설·추석만이라 여기선 별도 처리 생략 — 공지 비교 대상 아님)
  if (pool.closedOnHoliday === 'all') {
    for (const h of HOLIDAYS) {
      const [y, m, d] = h.split('-').map(Number);
      if (y === year && m === month) out[d] = out[d] || '공휴일 휴관';
    }
  }
  return out;
}

// ── 공지 게시판 크롤 ──
async function fetchText(url, opts = {}, tries = 3) {
  let lastErr;
  const timeout = opts.timeout || 15000;
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36', ...(opts.headers || {}) },
        signal: AbortSignal.timeout(timeout),
        ...opts,
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      if (opts.returnRes) return res;
      return await res.text();
    } catch (e) {
      // undici는 'fetch failed'만 노출하므로 실제 원인(e.cause)을 함께 남긴다
      const cause = e.cause ? ` (${e.cause.code || e.cause.message || e.cause})` : '';
      lastErr = new Error(`${e.message}${cause}`);
      if (i < tries - 1) await new Promise(r => setTimeout(r, 2000 * (i + 1)));
    }
  }
  throw lastErr;
}

// 게시판 AJAX는 세션 쿠키를 요구할 수 있어, notice{up_id}.do를 먼저 GET해 쿠키를 확보한다.
async function fetchNoticeList(up_id) {
  const boardUrl = `https://spo.isdc.co.kr/notice${up_id}.do`;
  let cookie = '';
  try {
    const res = await fetchText(boardUrl, { returnRes: true, timeout: 20000 });
    const sc = res.headers.get('set-cookie');
    if (sc) cookie = sc.split(',').map(s => s.split(';')[0].trim()).join('; ');
  } catch { /* 쿠키 없이도 시도 */ }

  const body = new URLSearchParams({
    searchWord: '', page: '1', perPageNum: '10', brd_flg: '1', up_id,
  });
  const text = await fetchText('https://spo.isdc.co.kr/selectNoticeList.ajax', {
    method: 'POST',
    timeout: 40000, // 응답이 1MB+라 넉넉히
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
      'X-Requested-With': 'XMLHttpRequest',
      Referer: boardUrl,
      Origin: 'https://spo.isdc.co.kr',
      ...(cookie ? { Cookie: cookie } : {}),
    },
    body,
  });
  const json = JSON.parse(text);
  return Array.isArray(json.data) ? json.data : [];
}

// "N월 운영프로그램 및 휴장일 안내" 중 target월에 해당하는 최신 글
function findMonthlyNotice(rows, month) {
  const re = new RegExp(`${month}\\s*월\\s*운영프로그램\\s*및\\s*휴장일\\s*안내`);
  return rows.find(r => re.test((r.sbjt || '').replace(/\s+/g, ' '))) || null;
}

// 본문에서 "■ N월 휴장일 안내" 블록 → {day: 사유}
function parseNoticeClosures(contentHtml, month) {
  let txt = contentHtml.replace(/<[^>]+>/g, ' ').replace(/&nbsp;|&middot;|&#183;/g, ' ').replace(/\s+/g, ' ');
  const block = txt.match(new RegExp(`■?\\s*${month}\\s*월\\s*휴장일\\s*안내(.*?)(?:■|할인혜택|이용수칙|$)`));
  if (!block) return null; // 휴장일 섹션 자체를 못 찾음
  const seg = block[1];
  const days = {};
  // "8월 9일(일) 정기휴장일" 또는 "15일(토) 광복절"
  for (const m of seg.matchAll(/(?:(\d{1,2})\s*월\s*)?(\d{1,2})\s*일\s*\(([월화수목금토일])\)\s*([가-힣]+)/g)) {
    days[parseInt(m[2], 10)] = m[4];
  }
  return days;
}

function diffClosures(noticeDays, ourDays) {
  const nk = new Set(Object.keys(noticeDays).map(Number));
  const ok = new Set(Object.keys(ourDays).map(Number));
  const onlyNotice = [...nk].filter(d => !ok.has(d)).sort((a, b) => a - b); // 공지엔 있는데 우린 안 닫음
  const onlyOurs = [...ok].filter(d => !nk.has(d)).sort((a, b) => a - b);   // 우린 닫는데 공지엔 없음
  return { onlyNotice, onlyOurs };
}

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
  const now = new Date();
  // 대상 월: 25일 이후 실행이면 다음 달(프리뷰), 아니면 이번 달
  let year = now.getFullYear(), month = now.getMonth() + 1;
  if (now.getDate() >= 25) { month++; if (month > 12) { month = 1; year++; } }
  const label = `${year}. ${pad(month)}`;
  console.log(`\n=== 공지·공휴일 점검 (대상 ${label}) ===\n`);

  const { POOLS, HOLIDAYS } = loadSiteData();
  const poolById = Object.fromEntries(POOLS.map(p => [p.id, p]));

  // ── 1) 공지 비교 ──
  const noticeResults = [];
  for (const np of NOTICE_POOLS) {
    const pool = poolById[np.id];
    if (!pool) continue;
    process.stdout.write(`${np.name} 공지 확인... `);
    try {
      const rows = await fetchNoticeList(np.up_id);
      const notice = findMonthlyNotice(rows, month);
      if (!notice) {
        console.log('월 공지 없음 → 기존 시간표대로 (변경 없음)');
        noticeResults.push({ id: np.id, pool: np.name, status: 'no-notice' });
        continue;
      }
      const noticeDays = parseNoticeClosures(notice.content || '', month);
      if (!noticeDays) {
        console.log('휴장일 블록 파싱 실패 → 수동 확인');
        noticeResults.push({ id: np.id, pool: np.name, status: 'parse-fail', noticeTitle: notice.sbjt });
        continue;
      }
      const ourDays = ourClosedDays(pool, year, month, HOLIDAYS);
      const { onlyNotice, onlyOurs } = diffClosures(noticeDays, ourDays);
      if (onlyNotice.length === 0 && onlyOurs.length === 0) {
        console.log('일치 ✓');
        noticeResults.push({ id: np.id, pool: np.name, status: 'ok' });
      } else {
        console.log('⚠️ 차이 감지');
        noticeResults.push({
          id: np.id, pool: np.name, status: 'diff',
          noticeTitle: notice.sbjt,
          onlyNotice: onlyNotice.map(d => ({ day: d, reason: noticeDays[d] })),
          onlyOurs: onlyOurs.map(d => ({ day: d, reason: ourDays[d] })),
        });
      }
    } catch (e) {
      console.log(`오류: ${e.message}`);
      noticeResults.push({ id: np.id, pool: np.name, status: 'error', error: e.message });
    }
  }

  // ── 2) 공휴일 리마인더 ──
  let holidayInfo = null;
  const apiKey = process.env.HOLIDAY_API_KEY;
  if (apiKey) {
    process.stdout.write(`\n${label} 공휴일 조회(data.go.kr)... `);
    try {
      const official = await fetchOfficialHolidays(year, month, apiKey);
      const missing = official.filter(h => !HOLIDAYS.has(h.date)); // 우리 HOLIDAYS에 없는 공휴일
      console.log(`${official.length}건${missing.length ? `, ⚠️ 우리 데이터 누락 ${missing.length}건` : ''}`);
      holidayInfo = { year, month, official, missing };
    } catch (e) {
      console.log(`오류: ${e.message}`);
      holidayInfo = { year, month, error: e.message };
    }
  } else {
    console.log('\n(HOLIDAY_API_KEY 미설정 — 공휴일 리마인더 건너뜀)');
  }

  // ── 요약/출력 ──
  const diffs = noticeResults.filter(r => r.status === 'diff');
  const noticeErrors = noticeResults.filter(r => r.status === 'error' || r.status === 'parse-fail');
  const holidayMissing = holidayInfo?.missing?.length || 0;
  const alert = diffs.length > 0 || holidayMissing > 0;

  console.log('\n=== 요약 ===');
  console.log(`공지 차이: ${diffs.length}건 / 공지 오류·미파싱: ${noticeErrors.length}건`);
  if (holidayInfo?.official) console.log(`${label} 공휴일: ${holidayInfo.official.map(h => `${h.date.slice(5)} ${h.name}`).join(', ') || '없음'}`);
  if (holidayMissing) console.log(`⚠️ 우리 데이터 누락 공휴일: ${holidayInfo.missing.map(h => `${h.date} ${h.name}`).join(', ')}`);

  writeFileSync('/tmp/notice-check.json', JSON.stringify({
    target: { year, month, label },
    noticeResults, holidayInfo,
    summary: { diffs: diffs.length, noticeErrors: noticeErrors.length, holidayMissing },
  }, null, 2));

  process.exit(alert ? 2 : noticeErrors.length ? 1 : 0);
}

main().catch(e => { console.error(e); process.exit(1); });
