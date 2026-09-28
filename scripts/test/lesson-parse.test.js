/**
 * 금곡 강습 공지 파서 회귀 테스트 (실제 게시판을 읽지만 API는 안 씀).
 * 2026-10월 공지 기준: 관심 수영 강좌는 미개설, 배드민턴 06:00~07:50 개설,
 * 재등록 9/16~9/21, 신규 9/23(수) 11시, 1차 추첨 9/22 20:00~9/27 23:59 · 추첨 9/28 11:00.
 */
import { readFileSync } from 'fs';
import { spoPosts, spoBoardOf } from '../notice-sources.js';
import { extractPostText } from '../notice-extract.js';
import { parseSwimCourses, parseBadminton, parseSchedule, matchWatch, targetMonthOf } from '../lesson-parse.js';

const config = JSON.parse(readFileSync(new URL('../../data/lesson-watch.json', import.meta.url), 'utf-8'));
const posts = await spoPosts(spoBoardOf('geumgok'));
const program = posts.find(p => /10월 강습프로그램 및/.test(p.title));
const signup = posts.find(p => /10월 강습프로그램 수강신청/.test(p.title));
let fail = 0;
const check = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) fail++;
  console.log(`${ok ? '✅' : '❌'} ${label}${ok ? '' : `\n     받음: ${JSON.stringify(got)}\n     기대: ${JSON.stringify(want)}`}`);
};

const pText = (await extractPostText(program)).text;
const swim = parseSwimCourses(pText);
const bad = parseBadminton(pText);
check('대상 월', targetMonthOf(program.title), { year: 2026, month: 10 });
check('성인 수영 06시 강좌', swim.filter(c => c.hour === 6).map(c => c.course), ['상급5', '고급7']);
check('성인 수영 20시 강좌', swim.filter(c => c.hour === 20).map(c => c.course), ['상급5', '고급9']);
check('어린이수영 제외(16·17시 없음)', swim.filter(c => c.hour === 16 || c.hour === 17).length, 0);
check('배드민턴', bad, [{ hour: 6, time: '06:00~07:50', days: '월,화,수,목' }]);
check('관심 대조', matchWatch(config, swim, bad), [{ 종목: '배드민턴', 아이콘: '🏸', 항목: [{ name: '배드민턴', time: '06:00~07:50' }] }]);

const sText = (await extractPostText(signup)).text;
const sch = parseSchedule(sText, 2026, 10);
check('재등록 기간', [sch.reRegister?.from.date, sch.reRegister?.to.date], ['2026-09-16', '2026-09-21']);
check('신규 접수', [sch.signup?.date, sch.signup?.hour, sch.signup?.dow], ['2026-09-23', 11, '수']);
check('1차 추첨', [sch.lottery?.from.date, sch.lottery?.from.hour, sch.lottery?.to.date, sch.lottery?.draw.date, sch.lottery?.draw.hour],
  ['2026-09-22', 20, '2026-09-27', '2026-09-28', 11]);

console.log(fail ? `\n${fail}건 실패` : '\n전부 통과');
process.exit(fail ? 1 : 0);
