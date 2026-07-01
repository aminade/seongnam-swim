#!/usr/bin/env node
/**
 * 성남도시개발공사 수영장 시간표 크롤러
 * 자유수영 섹션만 파싱해서 index.html 데이터와 비교
 */

import { writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __dir = dirname(fileURLToPath(import.meta.url));

// index.html 기준 자유수영 데이터
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

// 자유수영 섹션 텍스트만 추출
function extractFreeSwimSection(html) {
  // 자유수영 키워드 주변 2000자 추출
  const idx = html.indexOf('자유수영');
  if (idx === -1) return '';
  // 자유수영 섹션 이후 다음 프로그램 섹션 전까지만
  const chunk = html.slice(Math.max(0, idx - 100), idx + 3000);
  return chunk;
}

// 시간 슬롯 파싱: 60분 또는 120분짜리 슬롯만 (자유수영 길이)
function parseSwimSlots(text) {
  const matches = [...text.matchAll(/(\d{2}:\d{2})\s*[~～]\s*(\d{2}:\d{2})/g)];
  const valid = [];
  for (const m of matches) {
    const [h1, m1] = m[1].split(':').map(Number);
    const [h2, m2] = m[2].split(':').map(Number);
    const dur = (h2 * 60 + m2) - (h1 * 60 + m1);
    if (dur === 60 || dur === 120) valid.push(`${m[1]}~${m[2]}`);
  }
  return [...new Set(valid)];
}

// 휴관 주차 파싱
function parseClosedWeeks(html) {
  const m = html.match(/매월\s*([1-5])\s*[·,]\s*([1-5])\s*번째\s*일요일/);
  if (m) return [parseInt(m[1]), parseInt(m[2])];
  const m2 = html.match(/매월\s*([1-5])\s*번째\s*일요일/);
  if (m2) return [parseInt(m2[1])];
  return null;
}

// 요금 파싱: 2000~5000원 범위만 (회원권 제외)
function parseAdultPrice(text) {
  const matches = [...text.matchAll(/일반[^0-9]*?([0-9,]+)\s*원/g)];
  for (const m of matches) {
    const price = parseInt(m[1].replace(/,/g, ''));
    if (price >= 2000 && price <= 6000) return price;
  }
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
      slots: parseSwimSlots(section || html),
      closedWeeks: parseClosedWeeks(html),
      adultPrice: parseAdultPrice(section || html),
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
    if (cur !== got) changes.push(`휴관주차 변경: ${known.closedWeeks.join('·')}번째 → ${crawled.closedWeeks.join('·')}번째 일요일`);
  }

  if (crawled.adultPrice && crawled.adultPrice !== known.adultPrice) {
    changes.push(`요금 변경: ${known.adultPrice.toLocaleString()}원 → ${crawled.adultPrice.toLocaleString()}원`);
  }

  if (crawled.slots.length > 0) {
    const allKnown = [...known.weekdaySlots, ...known.satSlots, ...known.sunSlots];
    const missing = allKnown.filter(s => !crawled.slots.includes(s) && known.weekdaySlots.includes(s));
    const newSlots = crawled.slots.filter(s => !allKnown.includes(s));
    if (missing.length) changes.push(`사라진 평일 슬롯: ${missing.join(', ')}`);
    if (newSlots.length) changes.push(`새 슬롯 감지: ${newSlots.join(', ')}`);
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
      results.push({ pool: pool.name, status: 'error', error: crawled.error });
      continue;
    }

    const changes = diff(pool.id, crawled);
    if (changes.length === 0) {
      console.log('이상 없음 ✓');
      results.push({ pool: pool.name, status: 'ok' });
    } else {
      console.log('⚠️  변경 감지!');
      changes.forEach(c => console.log(`   - ${c}`));
      results.push({ pool: pool.name, status: 'changed', changes });
    }
  }

  const changed = results.filter(r => r.status === 'changed');
  const errors  = results.filter(r => r.status === 'error');

  console.log('\n=== 요약 ===');
  if (changed.length === 0 && errors.length === 0) {
    console.log('모든 수영장 이상 없음 ✓');
  } else {
    if (changed.length) console.log(`⚠️  ${changed.length}곳 변경 → index.html 수동 업데이트 필요`);
    if (errors.length)  console.log(`❌ ${errors.length}곳 크롤링 실패`);
  }

  // GitHub Actions step summary
  if (process.env.GITHUB_STEP_SUMMARY) {
    const rows = results.map(r =>
      `| ${r.pool} | ${r.status==='ok'?'✅ 이상 없음':r.status==='changed'?'⚠️ 변경됨':'❌ 오류'} | ${r.changes?.join('<br>') || r.error || '-'} |`
    ).join('\n');
    const md = [
      `## 성남 수영장 시간표 점검 결과`,
      `> ${today}`,
      '',
      changed.length ? `⚠️ **${changed.map(r=>r.pool).join(', ')} 변경 감지** — index.html 수동 업데이트 필요` : '✅ **모든 수영장 이상 없음**',
      '',
      '| 수영장 | 상태 | 변경 내용 |',
      '|--------|------|-----------|',
      rows,
    ].join('\n');
    writeFileSync(process.env.GITHUB_STEP_SUMMARY, md);
  }

  process.exit(changed.length > 0 ? 2 : errors.length > 0 ? 1 : 0);
}

main().catch(e => { console.error(e); process.exit(1); });
