#!/usr/bin/env node
/**
 * 성남 수영장 시간표 크롤러
 * - 성남도시개발공사 6곳: 자유수영 섹션 파싱 → 변경 시 자동반영 후보(changed)
 * - 청소년청년재단 유스센터 3곳: 일일이용 섹션 파싱 → 변경 시 수동검토(youthChanged)
 * 변경 감지 시 exit 2 + JSON 출력
 */

import { writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __dir = dirname(fileURLToPath(import.meta.url));

const KNOWN = {
  tanchen:    { closedWeeks:[1,3], weekdaySlots:['06:00~07:50','12:00~13:50','15:00~16:50','19:00~20:50'], satSlots:['07:00~08:50','10:00~11:50','13:00~14:50','16:00~17:50'], sunSlots:['09:00~10:50','13:00~14:50','16:00~17:50'], adultPrice:3600 },
  seongnam:   { closedWeeks:[2,4], weekdaySlots:['06:00~07:50','09:00~10:50','12:00~13:50','19:00~20:50'], satSlots:['09:00~10:50','13:00~14:50','16:00~17:50'], sunSlots:['09:00~10:50','13:00~14:50','16:00~17:50'], adultPrice:3600 },
  hwangse:    { closedWeeks:[1,3], weekdaySlots:['06:00~06:50','07:00~07:50','10:00~10:50','11:00~11:50','16:00~16:50','17:00~17:50','19:00~19:50','20:00~20:50'], satSlots:['10:00~11:50','13:00~14:50','16:00~17:50'], sunSlots:['10:00~11:50','13:00~14:50','16:00~17:50'], adultPrice:3000 },
  pangyo:     { closedWeeks:[2,4], weekdaySlots:['12:00~12:50'], satSlots:['09:00~10:50','13:00~14:50','16:00~17:50'], sunSlots:['09:00~10:50','13:00~14:50','16:00~17:50'], adultPrice:3000 },
  pyengsaeng: { closedWeeks:[2,4], weekdaySlots:['16:00~17:50'], satSlots:['10:00~11:50','13:00~14:50','16:00~17:50'], sunSlots:['10:00~11:50','13:00~14:50','16:00~17:50'], adultPrice:3600 },
  geumgok:    { closedWeeks:[2,4], weekdaySlots:['06:00~06:50','07:00~07:50','09:00~09:50','10:00~10:50','11:00~11:50','19:00~19:50','20:00~20:50'], satSlots:['10:00~11:50','13:00~14:50','16:00~17:50'], sunSlots:['10:00~11:50','13:00~14:50','16:00~17:50'], adultPrice:3000 },
};

const POOLS_META = [
  { id:'tanchen',    name:'탄천종합운동장',       url:'https://spo.isdc.co.kr/tan_programGuide.do' },
  { id:'seongnam',   name:'성남종합운동장',       url:'https://spo.isdc.co.kr/sns_programGuide.do' },
  { id:'hwangse',    name:'황새울국민체육센터',   url:'https://spo.isdc.co.kr/programGuide.do' },
  { id:'pangyo',     name:'판교스포츠센터',       url:'https://spo.isdc.co.kr/pgs_dailyFreeGuide.do' },
  { id:'pyengsaeng', name:'평생스포츠센터',       url:'https://spo.isdc.co.kr/spo_programGuide.do' },
  { id:'geumgok',    name:'금곡공원국민체육센터', url:'https://spo.isdc.co.kr/ggp_programGuide.do' },
];

// ── 성남시청소년청년재단 유스센터 (구조가 달라 자동반영 대신 탐지·보고 전용) ──
const YOUTH_META = [
  { id:'yc_yatap',   name:'야탑유스센터', url:'https://www.snyouth.or.kr/fmcs/158' },
  { id:'yc_jungwon', name:'중원유스센터', url:'https://www.snyouth.or.kr/fmcs/57'  },
  { id:'yc_pangyo',  name:'판교유스센터', url:'https://www.snyouth.or.kr/fmcs/133' },
];

// 수정유스센터: 신축 건물 시범운영 중(2026-07-25~별도 공지시까지). 정식 운영시간안내
// 페이지(fmcs/32)에는 아직 수영장 시간표가 반영되지 않아, 위 3곳과 같은 표 파싱이 불가능함.
// 대신 공지사항 게시판(fmcs/22)의 고정 공지를 감시 → 공지가 바뀌면(일정 변경/종료 등) 수동 검토.
// 정식 페이지에 시간표가 등장하면(=정식 운영 전환) 별도로 알림 → 그때 YOUTH_META로 승격.
const SUJEONG_NOTICE = {
  id: 'yc_sujeong',
  name: '수정유스센터',
  boardUrl: 'https://www.snyouth.or.kr/fmcs/22',
  officialUrl: 'https://www.snyouth.or.kr/fmcs/32',
  knownActionValue: '7328334a4cc9faa679e34190215a7e1a',
  knownTitle: '수정유스센터 수영장 시범운영(일일 자유수영) 일정 안내',
};

// index.html에 하드코딩된 값과 동일하게 유지 (변경 감지 기준: 전체 슬롯 집합 + 휴관주차)
const KNOWN_YOUTH = {
  yc_yatap:   { closedWeeks:[1,3], slots:['08:00~08:50','12:00~12:50','20:00~20:50','06:30~08:00','09:00~10:30','11:00~12:30','13:30~15:00','15:30~17:00','17:30~19:00'] },
  yc_jungwon: { closedWeeks:[2,4], slots:['08:00~08:50','12:00~12:50','13:00~13:50','15:00~15:50','20:00~20:50','06:30~08:00','09:00~10:30','11:00~12:30','13:30~15:00','15:30~17:00','17:30~19:00'] },
  yc_pangyo:  { closedWeeks:[1,3], slots:['08:00~08:50','14:00~14:50','06:30~08:00','09:00~10:30','11:00~12:30','13:30~15:00','15:30~17:00','18:00~19:30'] },
};

function mins(t) { const [h,m] = t.split(':').map(Number); return h*60+m; }
function pad2(t) { const [h,m] = t.split(':'); return `${h.padStart(2,'0')}:${m}`; }

// 일시적 네트워크 실패로 오탐 이슈가 생기지 않도록 재시도 (기본 3회)
async function fetchText(url, tries = 3) {
  let lastErr;
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; schedule-checker/1.0)' },
        signal: AbortSignal.timeout(15000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.text();
    } catch (e) {
      lastErr = e;
      if (i < tries - 1) await new Promise(r => setTimeout(r, 2000 * (i + 1)));
    }
  }
  throw lastErr;
}

// HTML에서 자유수영 전용 섹션을 추출
// 전략: "자유수영"이 포함된 <tr> 또는 <td>/<th> 행부터 다음 프로그램 행 전까지
function extractFreeSwimSection(html) {
  // 태그 제거 함수
  const stripTags = s => s.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

  // 방법 1: 자유수영 행이 포함된 테이블 행 추출
  // <tr> 단위로 분리해서 자유수영이 있는 행과 그 다음 몇 개 행 추출
  const trMatches = [...html.matchAll(/<tr[\s\S]*?<\/tr>/gi)];
  let freeSwimRows = [];
  let inFreeSwim = false;

  for (let i = 0; i < trMatches.length; i++) {
    const row = trMatches[i][0];
    const text = stripTags(row);
    if (text.includes('자유수영')) {
      inFreeSwim = true;
    }
    if (inFreeSwim) {
      freeSwimRows.push(row);
      // 다음 프로그램 이름이 나오면 중단 (자유수영 이후 행 중 다른 프로그램명 포함 시)
      const STOP_WORDS = ['수중', '아쿠아', '강습', '수영교실', '배드민턴', '헬스', '헬스장', '피트니스', '요가', '필라테스', '탁구', '배구'];
      if (inFreeSwim && freeSwimRows.length > 1 && STOP_WORDS.some(w => text.includes(w))) {
        break;
      }
      if (freeSwimRows.length > 30) break; // 최대 30행
    }
  }

  if (freeSwimRows.length > 0) return freeSwimRows.join('\n');

  // 방법 2: 자유수영 키워드 주변 텍스트 (테이블 구조가 없을 때)
  const idx = html.indexOf('자유수영');
  if (idx === -1) return '';
  return html.slice(Math.max(0, idx - 200), idx + 2000);
}

// 자유수영 섹션에서 시간 슬롯만 추출 (60분 또는 120분)
function parseSwimSlots(section) {
  const matches = [...section.matchAll(/(\d{2}:\d{2})\s*[~～]\s*(\d{2}:\d{2})/g)];
  const valid = [];
  for (const m of matches) {
    const dur = mins(m[2]) - mins(m[1]);
    if (dur === 60 || dur === 120) valid.push(`${m[1]}~${m[2]}`);
  }
  return [...new Set(valid)];
}

// 자유수영 요금: 2,000~6,000원 범위
function parseAdultPrice(section) {
  const stripped = section.replace(/<[^>]+>/g, ' ');
  // "일반" 또는 "성인" 뒤에 나오는 금액
  const matches = [...stripped.matchAll(/(?:일반|성인)[^\d]{0,10}([\d,]+)\s*원/g)];
  for (const m of matches) {
    const price = parseInt(m[1].replace(/,/g, ''));
    if (price >= 2000 && price <= 6000) return price;
  }
  return null;
}

// 휴관 주차
function parseClosedWeeks(html) {
  const m = html.match(/매월\s*([1-5])\s*[·,]\s*([1-5])\s*번째\s*일요일/);
  if (m) return [parseInt(m[1]), parseInt(m[2])].sort((a,b)=>a-b);
  const m2 = html.match(/매월\s*([1-5])\s*번째\s*일요일/);
  if (m2) return [parseInt(m2[1])];
  return null;
}

async function crawlPool(pool) {
  try {
    const html = await fetchText(pool.url);
    const section = extractFreeSwimSection(html);

    return {
      slots: parseSwimSlots(section),
      closedWeeks: parseClosedWeeks(html),
      adultPrice: parseAdultPrice(section),
      sectionLength: section.length,
    };
  } catch (e) {
    return { error: e.message };
  }
}

function diff(id, crawled) {
  const known = KNOWN[id];
  const changes = [];

  if (crawled.closedWeeks) {
    const cur = JSON.stringify([...known.closedWeeks].sort());
    const got = JSON.stringify([...crawled.closedWeeks].sort());
    if (cur !== got) {
      changes.push({
        field: 'closedWeeks',
        old: known.closedWeeks,
        new: crawled.closedWeeks,
        desc: `휴관주차: 매월 ${known.closedWeeks.join('·')}번째 → ${crawled.closedWeeks.join('·')}번째 일요일`,
      });
    }
  }

  if (crawled.adultPrice && crawled.adultPrice !== known.adultPrice) {
    changes.push({
      field: 'adultPrice',
      old: known.adultPrice,
      new: crawled.adultPrice,
      desc: `요금: ${known.adultPrice.toLocaleString()}원 → ${crawled.adultPrice.toLocaleString()}원`,
    });
  }

  if (crawled.slots.length > 0) {
    const allKnown = [...known.weekdaySlots, ...known.satSlots, ...known.sunSlots];
    // 평일 슬롯 중 사라진 것
    const missing = known.weekdaySlots.filter(s => !crawled.slots.includes(s));
    // 아직 알려지지 않은 새 슬롯 (60/120분짜리)
    const added = crawled.slots.filter(s => !allKnown.includes(s));
    if (missing.length || added.length) {
      changes.push({
        field: 'weekdaySlots',
        old: known.weekdaySlots,
        new: crawled.slots.filter(s => {
          const dur = mins(s.split('~')[1]) - mins(s.split('~')[0]);
          return dur === 60 || dur === 120;
        }),
        missing,
        added,
        desc: [
          missing.length ? `사라진 슬롯: ${missing.join(', ')}` : '',
          added.length   ? `새 슬롯 감지: ${added.join(', ')}` : '',
        ].filter(Boolean).join(' / '),
      });
    }
  }

  return changes;
}

// ── 유스센터 파싱 ──────────────────────────────────────────────
// "수영장 일일이용" 섹션만 추출 (일반 운영시간 표·이용수칙 등은 제외)
function extractYouthSwimSection(html) {
  const startIdx = html.indexOf('수영장 일일이용');
  if (startIdx === -1) return '';
  // '시설 및 안내'·'대표전화'는 표 캡션으로 이른 위치에 등장해 오절단되므로 제외.
  // 슬롯 표 뒤에 안정적으로 오는 경계어만 사용 + 길이 상한(안전망).
  const rest = html.slice(startIdx, startIdx + 4000);
  const stopWords = ['이용수칙', '공지사항', '라이선스', '공공누리'];
  let end = rest.length;
  for (const w of stopWords) {
    const i = rest.indexOf(w, 10);
    if (i !== -1 && i < end) end = i;
  }
  return rest.slice(0, end);
}

// 자유수영 슬롯 추출 (평일 50분 / 주말 90분) — 부제 시간대 헤더(수백 분)는 제외
function parseYouthSlots(section) {
  const stripped = section.replace(/<[^>]+>/g, ' ');
  const matches = [...stripped.matchAll(/(\d{1,2}:\d{2})\s*[~～]\s*(\d{1,2}:\d{2})/g)];
  const valid = [];
  for (const m of matches) {
    const dur = mins(m[2]) - mins(m[1]);
    if (dur >= 40 && dur <= 120) valid.push(`${pad2(m[1])}~${pad2(m[2])}`);
  }
  return [...new Set(valid)];
}

// "매월 1, 3주 일요일"(숫자) 또는 "첫째주, 셋째주 … 일요일"(한글 서수) 모두 처리
function parseYouthClosedWeeks(html) {
  const text = html.replace(/<[^>]+>/g, ' ');
  // 숫자형
  const m = text.match(/매월\s*([1-5])\s*[,·]\s*([1-5])\s*주/);
  if (m) return [parseInt(m[1]), parseInt(m[2])].sort((a,b)=>a-b);
  // 한글 서수형 (휴관 안내 문장 범위 내에서만)
  const region = (text.match(/(?:휴관|매월)[\s\S]{0,60}?일요일/) || [])[0];
  if (region) {
    const ORD = { '첫째':1, '둘째':2, '셋째':3, '넷째':4, '다섯째':5 };
    const found = Object.entries(ORD).filter(([k]) => region.includes(k)).map(([,v]) => v);
    if (found.length) return [...new Set(found)].sort((a,b)=>a-b);
  }
  return null;
}

async function crawlYouthPool(pool) {
  try {
    const html = await fetchText(pool.url);
    const section = extractYouthSwimSection(html);
    return {
      slots: parseYouthSlots(section),
      closedWeeks: parseYouthClosedWeeks(html),
      sectionLength: section.length,
    };
  } catch (e) {
    return { error: e.message };
  }
}

function diffYouth(id, crawled) {
  const known = KNOWN_YOUTH[id];
  const changes = [];

  if (crawled.closedWeeks) {
    if (JSON.stringify(known.closedWeeks) !== JSON.stringify(crawled.closedWeeks)) {
      changes.push({
        field: 'closedWeeks',
        old: known.closedWeeks,
        new: crawled.closedWeeks,
        desc: `휴관주차: 매월 ${known.closedWeeks.join('·')}주 → ${crawled.closedWeeks.join('·')}주 일요일`,
      });
    }
  }

  // 페이지에서 슬롯을 하나라도 뽑았을 때만 비교 (파싱 실패 시 오탐 방지)
  if (crawled.slots.length > 0) {
    const missing = known.slots.filter(s => !crawled.slots.includes(s));
    const added   = crawled.slots.filter(s => !known.slots.includes(s));
    if (missing.length || added.length) {
      changes.push({
        field: 'slots',
        missing,
        added,
        desc: [
          missing.length ? `사라진 슬롯: ${missing.join(', ')}` : '',
          added.length   ? `새 슬롯 감지: ${added.join(', ')}` : '',
        ].filter(Boolean).join(' / '),
      });
    }
  }

  return changes;
}

// 게시판 목록에서 최상단 고정("공지") 글의 action-value 해시 + 제목 추출
function extractPinnedNotice(html) {
  const m = html.match(/action-value=([a-f0-9]{32})"[^>]*>\s*(?:<span[^>]*>)?\s*([^<]{5,100})/);
  return m ? { actionValue: m[1], title: m[2].trim() } : null;
}

async function crawlSujeongNotice(cfg) {
  const [boardHtml, officialHtml] = await Promise.all([
    fetchText(cfg.boardUrl),
    fetchText(cfg.officialUrl),
  ]);
  const pinned = extractPinnedNotice(boardHtml);
  // 정식 페이지에 실제 시간표가 채워졌는지 = 기존 유스센터 파서 재사용 (있으면 정식 운영 전환 신호)
  const officialSlots = parseYouthSlots(extractYouthSwimSection(officialHtml));
  return { pinned, officialSlots };
}

function diffSujeongNotice(cfg, crawled) {
  const changes = [];
  if (crawled.pinned && crawled.pinned.actionValue !== cfg.knownActionValue) {
    changes.push({
      field: 'notice',
      old: cfg.knownTitle,
      new: crawled.pinned.title,
      desc: `공지 변경 감지: "${cfg.knownTitle}" → "${crawled.pinned.title}" (수동 확인 필요)`,
    });
  }
  if (crawled.officialSlots.length > 0) {
    changes.push({
      field: 'officialPage',
      desc: `정식 운영시간안내 페이지(fmcs/32)에 시간표 등장(${crawled.officialSlots.length}개 슬롯) — 정식 운영 전환 가능성, 표준 유스센터 파싱으로 전환 검토`,
    });
  }
  return changes;
}

async function main() {
  const today = new Date().toLocaleDateString('ko-KR', {year:'numeric', month:'long', day:'numeric'});
  console.log(`\n=== 성남 수영장 시간표 점검 (${today}) ===\n`);

  const results = [];
  for (const pool of POOLS_META) {
    process.stdout.write(`${pool.name} 크롤링 중... `);
    const crawled = await crawlPool(pool);

    if (crawled.error) {
      console.log(`오류: ${crawled.error}`);
      results.push({ id: pool.id, pool: pool.name, url: pool.url, status: 'error', error: crawled.error });
      continue;
    }

    console.log(`(자유수영 섹션 ${crawled.sectionLength}자)`);
    const changes = diff(pool.id, crawled);
    if (changes.length === 0) {
      console.log(`  → 이상 없음 ✓`);
      results.push({ id: pool.id, pool: pool.name, url: pool.url, status: 'ok' });
    } else {
      console.log(`  → ⚠️ 변경 감지!`);
      changes.forEach(c => console.log(`     ${c.desc}`));
      results.push({ id: pool.id, pool: pool.name, url: pool.url, status: 'changed', changes });
    }
  }

  const changed = results.filter(r => r.status === 'changed');
  const errors  = results.filter(r => r.status === 'error');

  // ── 유스센터 (탐지·보고 전용, 자동반영 안 함) ──
  const youthResults = [];
  for (const pool of YOUTH_META) {
    process.stdout.write(`${pool.name} 크롤링 중... `);
    const crawled = await crawlYouthPool(pool);
    if (crawled.error) {
      console.log(`오류: ${crawled.error}`);
      youthResults.push({ id: pool.id, pool: pool.name, url: pool.url, status: 'error', error: crawled.error });
      continue;
    }
    console.log(`(일일이용 섹션 ${crawled.sectionLength}자)`);
    const changes = diffYouth(pool.id, crawled);
    if (changes.length === 0) {
      console.log(`  → 이상 없음 ✓`);
      youthResults.push({ id: pool.id, pool: pool.name, url: pool.url, status: 'ok' });
    } else {
      console.log(`  → ⚠️ 변경 감지! (수동 검토 필요)`);
      changes.forEach(c => console.log(`     ${c.desc}`));
      youthResults.push({ id: pool.id, pool: pool.name, url: pool.url, status: 'changed', changes });
    }
  }
  // 수정유스센터: 시범운영 공지 감시 (정식 페이지 미반영 기간 한정)
  process.stdout.write(`${SUJEONG_NOTICE.name} 공지 확인 중... `);
  try {
    const crawled = await crawlSujeongNotice(SUJEONG_NOTICE);
    const changes = diffSujeongNotice(SUJEONG_NOTICE, crawled);
    if (changes.length === 0) {
      console.log(`  → 이상 없음 ✓`);
      youthResults.push({ id: SUJEONG_NOTICE.id, pool: SUJEONG_NOTICE.name, url: SUJEONG_NOTICE.boardUrl, status: 'ok' });
    } else {
      console.log(`  → ⚠️ 변경 감지! (수동 검토 필요)`);
      changes.forEach(c => console.log(`     ${c.desc}`));
      youthResults.push({ id: SUJEONG_NOTICE.id, pool: SUJEONG_NOTICE.name, url: SUJEONG_NOTICE.boardUrl, status: 'changed', changes });
    }
  } catch (e) {
    console.log(`오류: ${e.message}`);
    youthResults.push({ id: SUJEONG_NOTICE.id, pool: SUJEONG_NOTICE.name, url: SUJEONG_NOTICE.boardUrl, status: 'error', error: e.message });
  }

  const youthChanged = youthResults.filter(r => r.status === 'changed');
  const youthErrors  = youthResults.filter(r => r.status === 'error');

  const anyChanged = changed.length + youthChanged.length;
  const anyErrors  = errors.length + youthErrors.length;

  console.log('\n=== 요약 ===');
  if (anyChanged === 0 && anyErrors === 0) {
    console.log('모든 수영장 이상 없음 ✓');
  } else {
    if (changed.length)      console.log(`⚠️  공사 ${changed.length}곳 변경 감지 (자동반영 대상)`);
    if (youthChanged.length) console.log(`⚠️  유스센터 ${youthChanged.length}곳 변경 감지 (수동 검토)`);
    if (anyErrors)           console.log(`❌ ${anyErrors}곳 크롤링 실패`);
  }

  // GitHub Actions step summary
  if (process.env.GITHUB_STEP_SUMMARY) {
    const rowOf = r =>
      `| [${r.pool}](${r.url}) | ${r.status==='ok'?'✅ 이상 없음':r.status==='changed'?'⚠️ 변경 감지':'❌ 오류'} | ${r.changes?.map(c=>c.desc).join('<br>') || r.error || '-'} |`;
    const publicRows = results.map(rowOf).join('\n');
    const youthRows  = youthResults.map(rowOf).join('\n');
    writeFileSync(process.env.GITHUB_STEP_SUMMARY, [
      `## 성남 수영장 시간표 점검 — ${today}`,
      '',
      anyChanged ? `⚠️ **${anyChanged}곳 변경 감지** — 이슈를 확인하세요` : '✅ **모든 수영장 이상 없음**',
      '',
      '### 성남도시개발공사 (자동반영 대상)',
      '| 수영장 | 상태 | 내용 |',
      '|--------|------|------|',
      publicRows,
      '',
      '### 유스센터 (수동 검토)',
      '| 수영장 | 상태 | 내용 |',
      '|--------|------|------|',
      youthRows,
    ].join('\n'));
  }

  // 변경 결과를 파일로 저장 (apply workflow에서 읽음)
  // changed = 공사(자동반영), youthChanged = 유스센터(수동 검토 — CHANGES_JSON에 넣지 않음)
  writeFileSync('/tmp/schedule-changes.json', JSON.stringify({ date: today, changed, errors, youthChanged, youthErrors }, null, 2));

  process.exit(anyChanged > 0 ? 2 : anyErrors > 0 ? 1 : 0);
}

main().catch(e => { console.error(e); process.exit(1); });
