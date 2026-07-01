#!/usr/bin/env node
/**
 * 성남도시개발공사 수영장 시간표 크롤러
 * 공식 사이트에서 자유수영 시간 & 휴관 정보를 가져와 index.html과 비교
 */

import { readFileSync, writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dir, '..');

// 현재 index.html에 박혀있는 데이터 기준값
const KNOWN = {
  tanchen:    { closedWeeks: [1,3], weekdaySlots: ['06:00~07:50','12:00~13:50','15:00~16:50','19:00~20:50'], satSlots: ['07:00~08:50','10:00~11:50','13:00~14:50','16:00~17:50'], sunSlots: ['09:00~10:50','13:00~14:50','16:00~17:50'], weekdayPrice: {adult:3600,teen:3000,child:2400} },
  seongnam:   { closedWeeks: [2,4], weekdaySlots: ['06:00~07:50','09:00~10:50','12:00~13:50','19:00~20:50'], satSlots: ['09:00~10:50','13:00~14:50','16:00~17:50'], sunSlots: ['09:00~10:50','13:00~14:50','16:00~17:50'], weekdayPrice: {adult:3600,teen:3000,child:2400} },
  hwangse:    { closedWeeks: [1,3], weekdaySlots: ['06:00~06:50','07:00~07:50','10:00~10:50','11:00~11:50','16:00~16:50','17:00~17:50','19:00~19:50','20:00~20:50'], satSlots: ['10:00~11:50','13:00~14:50','16:00~17:50'], sunSlots: ['10:00~11:50','13:00~14:50','16:00~17:50'], weekdayPrice: {adult:3000,teen:2500,child:2000} },
  pangyo:     { closedWeeks: [2,4], weekdaySlots: ['12:00~12:50'], satSlots: ['09:00~10:50','13:00~14:50','16:00~17:50'], sunSlots: ['09:00~10:50','13:00~14:50','16:00~17:50'], weekdayPrice: {adult:3000,teen:2500,child:2000} },
  pyengsaeng: { closedWeeks: [2,4], weekdaySlots: ['16:00~17:50'], satSlots: ['10:00~11:50','13:00~14:50','16:00~17:50'], sunSlots: ['10:00~11:50','13:00~14:50','16:00~17:50'], weekdayPrice: {adult:3600,teen:3000,child:2400} },
  geumgok:    { closedWeeks: [2,4], weekdaySlots: ['06:00~06:50','07:00~07:50','09:00~09:50','10:00~10:50','11:00~11:50','19:00~19:50','20:00~20:50'], satSlots: ['10:00~11:50','13:00~14:50','16:00~17:50'], sunSlots: ['10:00~11:50','13:00~14:50','16:00~17:50'], weekdayPrice: {adult:3000,teen:2500,child:2000} },
};

const POOLS_META = [
  { id:'tanchen',    name:'탄천종합운동장',     url:'https://spo.isdc.co.kr/tan_programGuide.do' },
  { id:'seongnam',   name:'성남종합운동장',     url:'https://spo.isdc.co.kr/sns_programGuide.do' },
  { id:'hwangse',    name:'황새울국민체육센터', url:'https://spo.isdc.co.kr/programGuide.do' },
  { id:'pangyo',     name:'판교스포츠센터',     url:'https://spo.isdc.co.kr/pgs_dailyFreeGuide.do' },
  { id:'pyengsaeng', name:'평생스포츠센터',     url:'https://spo.isdc.co.kr/spo_programGuide.do' },
  { id:'geumgok',    name:'금곡공원국민체육센터', url:'https://spo.isdc.co.kr/ggp_programGuide.do' },
];

// 시간 슬롯 파싱: HH:MM~HH:MM 패턴 추출
function parseSlots(html) {
  const matches = [...html.matchAll(/(\d{2}:\d{2})\s*[~～]\s*(\d{2}:\d{2})/g)];
  return [...new Set(matches.map(m => `${m[1]}~${m[2]}`))];
}

// 휴관 주차 파싱: "매월 X·Y번째 일요일" 패턴
function parseClosedWeeks(html) {
  const m = html.match(/매월\s*([1-5])(?:[·,\s]+([1-5]))?\s*번째\s*일요일/);
  if (!m) return null;
  return m[2] ? [parseInt(m[1]), parseInt(m[2])] : [parseInt(m[1])];
}

// 요금 파싱: 일반/성인 금액
function parsePrice(html) {
  const m = html.match(/일반[^0-9]*([0-9,]+)\s*원/);
  if (!m) return null;
  return parseInt(m[1].replace(/,/g, ''));
}

async function crawlPool(pool) {
  try {
    const res = await fetch(pool.url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; schedule-checker/1.0)' },
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const html = await res.text();
    return {
      slots: parseSlots(html),
      closedWeeks: parseClosedWeeks(html),
      adultPrice: parsePrice(html),
      rawLength: html.length,
    };
  } catch (e) {
    return { error: e.message };
  }
}

function diff(id, crawled) {
  const known = KNOWN[id];
  const changes = [];

  if (crawled.closedWeeks) {
    const cur = JSON.stringify(known.closedWeeks.sort());
    const got = JSON.stringify([...crawled.closedWeeks].sort());
    if (cur !== got) changes.push(`휴관주차 변경: ${known.closedWeeks} → ${crawled.closedWeeks}`);
  }

  if (crawled.adultPrice && crawled.adultPrice !== known.weekdayPrice.adult) {
    changes.push(`요금 변경: ${known.weekdayPrice.adult}원 → ${crawled.adultPrice}원`);
  }

  // 슬롯: 현재 known 슬롯이 크롤된 슬롯에 없으면 경고
  if (crawled.slots.length > 0) {
    const missing = known.weekdaySlots.filter(s => !crawled.slots.includes(s));
    const added   = crawled.slots.filter(s => !known.weekdaySlots.includes(s) && !known.satSlots?.includes(s) && !known.sunSlots?.includes(s));
    if (missing.length) changes.push(`슬롯 사라짐: ${missing.join(', ')}`);
    if (added.length)   changes.push(`새 슬롯 발견: ${added.join(', ')}`);
  }

  return changes;
}

async function main() {
  console.log(`\n=== 성남 수영장 시간표 점검 (${new Date().toLocaleDateString('ko-KR')}) ===\n`);

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
      console.log('변경 없음 ✓');
      results.push({ pool: pool.name, status: 'ok' });
    } else {
      console.log(`\n  ⚠️  변경 감지!`);
      changes.forEach(c => console.log(`     - ${c}`));
      results.push({ pool: pool.name, status: 'changed', changes });
    }
  }

  const changed = results.filter(r => r.status === 'changed');
  const errors  = results.filter(r => r.status === 'error');

  console.log('\n=== 요약 ===');
  if (changed.length === 0 && errors.length === 0) {
    console.log('모든 수영장 데이터 이상 없음 ✓');
  } else {
    if (changed.length > 0) {
      console.log(`⚠️  ${changed.length}곳 변경 감지 → 수동 확인 후 index.html 업데이트 필요`);
      changed.forEach(r => { console.log(`  - ${r.pool}`); r.changes.forEach(c => console.log(`    ${c}`)); });
    }
    if (errors.length > 0) {
      console.log(`❌ ${errors.length}곳 크롤링 실패 (사이트 점검 중일 수 있음)`);
    }
  }

  // GitHub Actions 출력
  const summary = changed.length > 0
    ? `⚠️ ${changed.map(r=>r.pool).join(', ')} 시간표 변경 감지`
    : errors.length > 0
    ? `❌ 크롤링 일부 실패 (${errors.map(r=>r.pool).join(', ')})`
    : '✅ 모든 수영장 이상 없음';

  // GitHub Actions step summary 기록
  if (process.env.GITHUB_STEP_SUMMARY) {
    const md = [
      `## 성남 수영장 시간표 점검 결과`,
      `> ${new Date().toLocaleDateString('ko-KR', {year:'numeric',month:'long',day:'numeric'})} 기준`,
      '',
      summary,
      '',
      '| 수영장 | 상태 | 비고 |',
      '|--------|------|------|',
      ...results.map(r => `| ${r.pool} | ${r.status==='ok'?'✅ 이상 없음':r.status==='changed'?'⚠️ 변경됨':'❌ 오류'} | ${r.changes?.join('<br>') || r.error || ''} |`),
      '',
      changed.length > 0 ? '> **조치 필요**: index.html 데이터를 공식 사이트 기준으로 수동 업데이트하세요.' : '',
    ].join('\n');
    writeFileSync(process.env.GITHUB_STEP_SUMMARY, md);
  }

  // 변경이 있으면 exit code 2 (Actions에서 감지용)
  process.exit(changed.length > 0 ? 2 : errors.length > 0 ? 1 : 0);
}

main().catch(e => { console.error(e); process.exit(1); });
