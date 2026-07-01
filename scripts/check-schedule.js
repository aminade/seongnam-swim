#!/usr/bin/env node
/**
 * 성남도시개발공사 수영장 시간표 크롤러
 * 자유수영 테이블 섹션만 정밀 파싱 → 변경 감지 시 JSON 출력
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

function mins(t) { const [h,m] = t.split(':').map(Number); return h*60+m; }

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
    const res = await fetch(pool.url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; schedule-checker/1.0)' },
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const html = await res.text();
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

  console.log('\n=== 요약 ===');
  if (changed.length === 0 && errors.length === 0) {
    console.log('모든 수영장 이상 없음 ✓');
  } else {
    if (changed.length) console.log(`⚠️  ${changed.length}곳 변경 감지`);
    if (errors.length)  console.log(`❌ ${errors.length}곳 크롤링 실패`);
  }

  // GitHub Actions step summary
  if (process.env.GITHUB_STEP_SUMMARY) {
    const rows = results.map(r =>
      `| [${r.pool}](${r.url}) | ${r.status==='ok'?'✅ 이상 없음':r.status==='changed'?'⚠️ 변경 감지':'❌ 오류'} | ${r.changes?.map(c=>c.desc).join('<br>') || r.error || '-'} |`
    ).join('\n');
    writeFileSync(process.env.GITHUB_STEP_SUMMARY, [
      `## 성남 수영장 시간표 점검 — ${today}`,
      '',
      changed.length ? `⚠️ **${changed.length}곳 변경 감지** — 이슈를 확인하세요` : '✅ **모든 수영장 이상 없음**',
      '',
      '| 수영장 | 상태 | 내용 |',
      '|--------|------|------|',
      rows,
    ].join('\n'));
  }

  // 변경 결과를 파일로 저장 (apply workflow에서 읽음)
  writeFileSync('/tmp/schedule-changes.json', JSON.stringify({ date: today, changed, errors }, null, 2));

  process.exit(changed.length > 0 ? 2 : errors.length > 0 ? 1 : 0);
}

main().catch(e => { console.error(e); process.exit(1); });
