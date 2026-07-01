#!/usr/bin/env node
/**
 * 확인된 변경사항을 index.html에 자동 반영
 * 사용법: node scripts/apply-changes.js '<JSON>'
 */

import { readFileSync, writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dir = dirname(fileURLToPath(import.meta.url));
const INDEX = join(__dir, '..', 'index.html');

function mins(t) { const [h,m] = t.split(':').map(Number); return h*60+m; }

function applyChanges(changedPools) {
  let html = readFileSync(INDEX, 'utf-8');
  const log = [];

  for (const entry of changedPools) {
    const { id, pool, changes } = entry;

    for (const change of changes) {
      if (change.field === 'closedWeeks') {
        // closedWeeks:[1,3] → closedWeeks:[2,4]
        const oldPat = new RegExp(`(id:'${id}'[^}]{0,300}closedWeeks:\\[)${change.old.join(',')}(\\])`, 's');
        const replaced = html.replace(oldPat, `$1${change.new.join(',')}$2`);
        if (replaced === html) {
          log.push(`❌ ${pool}: closedWeeks 패턴 못 찾음`);
        } else {
          html = replaced;
          log.push(`✅ ${pool}: closedWeeks ${change.old} → ${change.new}`);
        }
      }

      if (change.field === 'adultPrice') {
        // weekdayPrice:{adult:3600, → weekdayPrice:{adult:4000,
        // 해당 pool id 다음에 나오는 첫 번째 adult 가격만 교체
        const poolBlock = html.match(new RegExp(`id:'${id}'[\\s\\S]{0,600}?weekdayPrice:\\{adult:\\d+`, 's'));
        if (!poolBlock) {
          log.push(`❌ ${pool}: adultPrice 패턴 못 찾음`);
          continue;
        }
        const oldPat = new RegExp(`(id:'${id}'[\\s\\S]{0,600}?weekdayPrice:\\{adult:)${change.old}`, 's');
        const replaced = html.replace(oldPat, `$1${change.new}`);
        if (replaced === html) {
          log.push(`❌ ${pool}: adultPrice 패턴 못 찾음`);
        } else {
          html = replaced;
          log.push(`✅ ${pool}: 요금 ${change.old}원 → ${change.new}원`);
        }
      }

      if (change.field === 'weekdaySlots') {
        // weekdaySlots:[{time:'06:00~07:50',dur:120},...] 통째로 교체
        const newSlotsStr = change.new.map(s => {
          const dur = mins(s.split('~')[1]) - mins(s.split('~')[0]);
          return `{time:'${s}',dur:${dur}}`;
        }).join(',');

        const oldPat = new RegExp(`(id:'${id}'[\\s\\S]{0,300}?weekdaySlots:\\[)[^\\]]+?(\\])`, 's');
        const replaced = html.replace(oldPat, `$1${newSlotsStr}$2`);
        if (replaced === html) {
          log.push(`❌ ${pool}: weekdaySlots 패턴 못 찾음`);
        } else {
          html = replaced;
          log.push(`✅ ${pool}: 평일 슬롯 업데이트 → ${change.new.join(', ')}`);
        }
      }
    }
  }

  writeFileSync(INDEX, html);
  return log;
}

// CLI 실행
const input = process.argv[2];
if (!input) { console.error('변경 JSON이 필요합니다'); process.exit(1); }

let changedPools;
try {
  changedPools = JSON.parse(input);
} catch(e) {
  console.error('JSON 파싱 실패:', e.message);
  process.exit(1);
}

const log = applyChanges(changedPools);
log.forEach(l => console.log(l));

const failed = log.filter(l => l.startsWith('❌'));
process.exit(failed.length > 0 ? 1 : 0);
