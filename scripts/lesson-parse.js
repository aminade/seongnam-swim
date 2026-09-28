/**
 * 금곡 강습 공지 → 관심 강좌·접수 일정 (규칙 파싱, AI·API 안 씀).
 *
 * 두 공지를 읽는다(제목으로 매칭):
 *   1) "…N월 강습프로그램…"                → 개설 강좌·시간 (성인 수영 / 배드민턴)
 *   2) "…N월 강습프로그램 수강신청 및 추첨제 안내" → 재등록·신규접수·추첨 일정
 *
 * 표를 글자로만 뽑으면 칸이 뭉개질 수 있어, 파싱이 어긋나면 값을 비우고(null) 알림에 원본 링크를 함께 보낸다.
 * 사람이 링크로 확인하는 것을 전제로 한 파서다.
 */

const TIME_RE = /(\d{1,2}):(\d{2})\s*~\s*(\d{1,2}):(\d{2})/;
// 강습반 이름: 기초1·기초반·초급2·중급3·상급5·고급9 …
const COURSE_RE = /(기초반|기초\d+|초급\d+|중급\d+|상급\d+|고급\d+)/g;

const lines = text => String(text || '').split('\n').map(l => l.trim()).filter(Boolean);
// "○ 수영(진도수료제)" 처럼 시작해 다음 '○' 항목 전까지
function section(text, startRe, stopRes = []) {
  const ls = lines(text);
  const i = ls.findIndex(l => startRe.test(l));
  if (i === -1) return [];
  const out = [];
  for (let j = i + 1; j < ls.length; j++) {
    if (/^○/.test(ls[j]) || stopRes.some(r => r.test(ls[j]))) break;
    out.push(ls[j]);
  }
  return out;
}

// 수영(성인) 개설 강좌 → [{hour, time, course}]. 어린이수영 구간은 제외한다.
export function parseSwimCourses(text) {
  const ls = section(text, /^○\s*수영/, [/어린이/]);
  const out = [];
  let cur = null;
  for (const l of ls) {
    const t = l.match(TIME_RE);
    if (t) { cur = { hour: +t[1], time: `${t[1].padStart(2, '0')}:${t[2]}~${t[3].padStart(2, '0')}:${t[4]}` }; }
    if (!cur) continue;
    const rest = t ? l.slice(l.indexOf(t[0]) + t[0].length) : l;
    for (const m of rest.matchAll(COURSE_RE)) out.push({ ...cur, course: m[1] });
  }
  return out;
}

// 배드민턴 강습 → [{hour, time, days}]
export function parseBadminton(text) {
  const ls = section(text, /^○\s*배드민턴/);
  const out = [];
  for (const l of ls) {
    const t = l.match(TIME_RE);
    if (!t) continue;
    const d = l.match(/\(([월화수목금토일,·\s]+)\)/);
    out.push({ hour: +t[1], time: `${t[1].padStart(2, '0')}:${t[2]}~${t[3].padStart(2, '0')}:${t[4]}`, days: d ? d[1].replace(/\s/g, '') : null });
  }
  return out;
}

// 관심 목록(data/lesson-watch.json)과 대조 → [{종목, 아이콘, 항목:[{course,time}]}]
export function matchWatch(config, swim, badminton) {
  const res = [];
  const sw = config.관심?.수영;
  if (sw) {
    const want = new Set(sw.강좌 || []);
    const hours = new Set(sw.시작시각 || []);
    const hit = swim.filter(c => want.has(c.course) && hours.has(c.hour));
    if (hit.length) res.push({ 종목: '수영', 아이콘: sw.아이콘 || '🏊', 항목: hit.map(h => ({ name: h.course, time: h.time })) });
  }
  const bd = config.관심?.배드민턴;
  if (bd) {
    const hours = new Set(bd.시작시각 || []);
    const hit = badminton.filter(c => hours.has(c.hour));
    if (hit.length) res.push({ 종목: '배드민턴', 아이콘: bd.아이콘 || '🏸', 항목: hit.map(h => ({ name: '배드민턴', time: h.time })) });
  }
  return res;
}

// ── 수강신청 안내 → 일정 ──
// 대상 월(N월 강습)의 접수는 보통 전달에 진행된다. 일자만 적힌 값(추첨 "22일")은 신규접수 월을 기준으로 채운다.
const pad = n => String(n).padStart(2, '0');
const mk = (y, m, d, hh = null, mm = 0) => ({ date: `${y}-${pad(m)}-${pad(d)}`, hour: hh, minute: mm });

export function parseSchedule(text, targetYear, targetMonth) {
  const flat = String(text || '').replace(/\s+/g, ' ');
  // 접수 월 = 대상 월의 전달
  let m = targetMonth - 1, y = targetYear;
  if (m === 0) { m = 12; y -= 1; }

  const out = { reRegister: null, signup: null, lottery: null };

  // 재등록(기존회원): 처음 나오는 "9/16 ~ 9/21"
  const re = flat.match(/(\d{1,2})\/(\d{1,2})\s*~\s*(\d{1,2})\/(\d{1,2})/);
  if (re) out.reRegister = { from: mk(y, +re[1], +re[2]), to: mk(y, +re[3], +re[4]) };

  // 신규(관내) 접수: "9/23(수) 11시"
  const sg = flat.match(/(\d{1,2})\/(\d{1,2})\s*\(([월화수목금토일])\)\s*(\d{1,2})\s*시/);
  if (sg) out.signup = { ...mk(y, +sg[1], +sg[2], +sg[4]), dow: sg[3] };

  // 1차 추첨: "1차 추첨 22일 20:00 ∼ 27일 23:59 28일 11:00"
  const lt = flat.match(/1\s*차\s*추첨\s*(\d{1,2})\s*일\s*(\d{1,2}):(\d{2})\s*[∼~-]\s*(\d{1,2})\s*일\s*(\d{1,2}):(\d{2})\s*(\d{1,2})\s*일\s*(\d{1,2}):(\d{2})/);
  if (lt) {
    out.lottery = {
      from: mk(y, m, +lt[1], +lt[2], +lt[3]),
      to: mk(y, m, +lt[4], +lt[5], +lt[6]),
      draw: mk(y, m, +lt[7], +lt[8], +lt[9]),
    };
  }
  return out;
}

// 제목에서 대상 월 뽑기: "… 2026년 10월 강습프로그램 …" / "… 10월 강습프로그램 …"
export function targetMonthOf(title, today = new Date()) {
  const y = title.match(/(\d{4})\s*년/);
  const m = title.match(/(\d{1,2})\s*월/);
  if (!m) return null;
  const month = +m[1];
  let year = y ? +y[1] : today.getFullYear();
  if (!y && month < today.getMonth() + 1) year += 1; // 연말에 다음 해 1월 공지가 뜨는 경우
  return { year, month };
}
