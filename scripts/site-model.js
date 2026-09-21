/**
 * 우리 사이트(index.html)의 수영장 데이터 + 휴관·시간표 계산 함수를 그대로 불러온다.
 * 사이트와 감시 스크립트가 같은 코드(isClosedDay·slotsFor 등)를 쓰도록 해 드리프트를 막는다.
 *
 *   const site = loadSiteModel();          // 기본: 저장소의 index.html
 *   site.isClosedDay(pool, date) / site.closedReason(pool, date, true) / site.slotsFor(pool, date)
 *
 * 경로는 SITE_INDEX 환경변수로 바꿀 수 있다(회귀 테스트에서 예전 버전 index.html로 돌릴 때).
 */

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dir = dirname(fileURLToPath(import.meta.url));
export const DEFAULT_INDEX = join(__dir, '..', 'index.html');

function slice(html, startMarker, endMarker) {
  const s = html.indexOf(startMarker);
  const e = html.indexOf(endMarker, s);
  if (s === -1 || e === -1) throw new Error(`index.html에서 '${startMarker}'~'${endMarker}' 구간을 찾지 못함`);
  return html.slice(s, e);
}

export function loadSiteModel(path = process.env.SITE_INDEX || DEFAULT_INDEX) {
  const html = readFileSync(path, 'utf-8');
  // POOLS 배열 ~ POOL_SHORT 직전, HOLIDAYS ~ 시간 유틸(mins) 직전: 데이터 + 순수 함수만 들어 있다.
  const pools = slice(html, 'const POOLS = [', 'const POOL_SHORT');
  const logic = slice(html, 'const HOLIDAYS', 'function mins(');
  // 예전 버전 index.html(회귀 테스트용)엔 없는 함수가 있을 수 있어 typeof로 감싼다.
  const opt = n => `${n}: typeof ${n} === 'function' ? ${n} : undefined`;
  const src = `${pools}\n${logic}\nreturn { POOLS, HOLIDAYS, LUNAR_HOLIDAYS, isHoliday, isClosedDay, closedReason, slotsFor, priceFor, dateStr,
    ${['isNotOperating', 'isExtraClosed', 'specialFor', 'poolExistsOn'].map(opt).join(', ')} };`;
  // eslint-disable-next-line no-new-func
  const model = new Function(src)();
  model.poolById = Object.fromEntries(model.POOLS.map(p => [p.id, p]));
  return model;
}
