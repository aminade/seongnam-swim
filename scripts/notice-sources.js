/**
 * 수영장 공지 게시판 수집기 — 모든 게시판을 같은 모양의 "글(post)" 목록으로 정규화한다.
 *
 *  post = { key, source, poolId, poolName, id, title, date('YYYY-MM-DD'), url,
 *           bodyHtml, attachments:[{name, ext, load: async()=>Buffer|null}],
 *           images:[{name, load: async()=>Buffer|null}] }   // 본문에 박힌 이미지
 *
 * 게시판별 구조:
 *  - 성남도시개발공사 6곳(spo.isdc.co.kr): selectNoticeList.ajax(JSON, 본문 HTML 포함).
 *    상세는 POST 전용이라 글 링크는 우리 중간 페이지(n.html)로 만든다. 첨부는 downloadFile.ajax.
 *  - 분당올림픽(ksponco.or.kr): 목록 HTML → 상세 HTML(view_cont). 본문 이미지는 상대경로.
 *  - 유스센터(snyouth.or.kr): 시설별 공지 게시판 목록 HTML → 상세 HTML(board_content), 첨부 /File/Download/<id>.
 */

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

export async function fetchRes(url, opts = {}, tries = 3) {
  let lastErr;
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url, {
        ...opts,
        headers: { 'User-Agent': UA, ...(opts.headers || {}) },
        signal: AbortSignal.timeout(opts.timeout || 30000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res;
    } catch (e) {
      const cause = e.cause ? ` (${e.cause.code || e.cause.message || e.cause})` : '';
      lastErr = new Error(`${e.message}${cause} — ${url}`);
      if (i < tries - 1) await new Promise(r => setTimeout(r, 2000 * (i + 1)));
    }
  }
  throw lastErr;
}
const fetchText = async (url, opts) => (await fetchRes(url, opts)).text();
const fetchBuf = async (url, opts) => Buffer.from(await (await fetchRes(url, opts)).arrayBuffer());

const decode = s => String(s || '')
  .replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
  .replace(/&#39;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n)).replace(/&amp;/g, '&');
export const htmlToText = html => decode(String(html || '')
  .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
  .replace(/<img[^>]*>/gi, ' ')
  .replace(/<br\s*\/?>|<\/(p|div|tr|li|h\d)>/gi, '\n')
  .replace(/<[^>]+>/g, ' '))
  .replace(/[ \t ]+/g, ' ').replace(/\s*\n\s*/g, '\n').trim();
const extOf = name => (String(name).split('?')[0].split('.').pop() || '').toLowerCase();

// 본문 HTML의 <img>: data URI는 바로 디코드, 상대/절대 URL은 base 기준으로 내려받는다.
// 아이콘·로고 같은 장식은 경로로 거른다.
function bodyImages(html, base) {
  const out = [];
  for (const m of String(html || '').matchAll(/<img[^>]+src="([^"]+)"/gi)) {
    const src = m[1];
    if (/\/(design|images?\/common|img\/common)\/|ico_|logo|btn_/i.test(src)) continue;
    const dm = src.match(/^data:image\/(png|jpe?g|gif|webp);base64,(.+)$/i);
    if (dm) { const buf = Buffer.from(dm[2], 'base64'); out.push({ name: `inline-${out.length}.${dm[1]}`, load: async () => buf }); continue; }
    const url = new URL(decode(src), base).href;
    out.push({ name: url.split('/').pop(), load: () => fetchBuf(url).catch(() => null) });
  }
  return out;
}

// ─────────────────────────── 성남도시개발공사 ───────────────────────────
export const SPO_BOARDS = [
  { up_id: '03', poolId: 'tanchen',    poolName: '탄천종합운동장' },
  { up_id: '02', poolId: 'seongnam',   poolName: '성남종합운동장' },
  { up_id: '01', poolId: 'hwangse',    poolName: '황새울국민체육센터' },
  { up_id: '04', poolId: 'pangyo',     poolName: '판교스포츠센터' },
  { up_id: '05', poolId: 'pyengsaeng', poolName: '평생스포츠센터' },
  { up_id: '06', poolId: 'geumgok',    poolName: '금곡공원국민체육센터' },
];
const SPO = 'https://spo.isdc.co.kr';
export const spoPostUrl = (up_id, idx) => `https://swim.andlife.app/n.html?b=${up_id}&i=${encodeURIComponent(idx)}`;

// 게시판 AJAX는 세션 쿠키를 요구할 수 있어 notice0N.do를 먼저 GET해 쿠키를 받는다.
async function spoCookie(up_id) {
  try {
    const res = await fetchRes(`${SPO}/notice${up_id}.do`, { timeout: 20000 });
    const sc = res.headers.get('set-cookie');
    return sc ? sc.split(',').map(s => s.split(';')[0].trim()).join('; ') : '';
  } catch { return ''; }
}

async function spoPosts(board) {
  const { up_id } = board;
  const boardUrl = `${SPO}/notice${up_id}.do`;
  const cookie = await spoCookie(up_id);
  const headers = {
    'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8', 'X-Requested-With': 'XMLHttpRequest',
    Referer: boardUrl, Origin: SPO, ...(cookie ? { Cookie: cookie } : {}),
  };
  const text = await fetchText(`${SPO}/selectNoticeList.ajax`, {
    method: 'POST', timeout: 40000, headers, // 본문에 base64 이미지가 들어 있어 응답이 1MB+
    body: new URLSearchParams({ searchWord: '', page: '1', perPageNum: '10', brd_flg: '1', up_id }),
  });
  const rows = JSON.parse(text).data || [];
  return rows.map(r => {
    const files = [r.file_a, r.file_b, r.file_c];
    const attachments = files.map((name, no) => ({ name, no })).filter(f => f.name).map(f => ({
      name: f.name, ext: extOf(f.name),
      load: async () => {
        const buf = await fetchBuf(`${SPO}/downloadFile.ajax`, {
          method: 'POST', timeout: 60000,
          headers: { ...headers, Referer: `${SPO}/goNoticeView.do` },
          body: new URLSearchParams({ idx: String(r.idx), file_no: String(f.no), brd_flg: String(r.brd_flg || '1'),
            file_a: r.file_a || '', file_b: r.file_b || '', file_c: r.file_c || '' }),
        }).catch(() => null);
        if (!buf || /<!doctype|<html/i.test(buf.slice(0, 64).toString('latin1'))) return null; // 에러 페이지
        return buf;
      },
    }));
    // 등록일(enter_dt)보다 수정일(modify_dt)이 늦으면 그걸 쓴다 — 예전 글을 고쳐 재사용하는 경우가 있다(황새울).
    const date = [r.enter_dt, r.modify_dt].filter(Boolean).map(s => String(s).slice(0, 10)).sort().pop() || '';
    return {
      key: `spo${up_id}:${r.idx}`, source: 'spo', poolId: board.poolId, poolName: board.poolName,
      id: String(r.idx), title: String(r.sbjt || '').trim(), date, url: spoPostUrl(up_id, r.idx),
      bodyHtml: r.content || '', attachments, images: bodyImages(r.content, SPO + '/'),
    };
  });
}

// ─────────────────────────── 분당올림픽 ───────────────────────────
const KSP = 'https://www.ksponco.or.kr';
const KSP_LIST = `${KSP}/sports/board.es?mid=b10301000000&bid=0017`;

async function kspPosts() {
  const html = await fetchText(KSP_LIST);
  const rows = [];
  const seen = new Set();
  for (const m of html.matchAll(/list_no=(\d+)[^"]*"[^>]*>([\s\S]*?)<\/a>([\s\S]*?)<\/tr>/g)) {
    if (seen.has(m[1])) continue;
    seen.add(m[1]);
    const date = (m[3].match(/\d{4}-\d{2}-\d{2}/) || [''])[0];
    rows.push({ id: m[1], title: htmlToText(m[2]), date });
  }
  const posts = [];
  for (const r of rows) {
    const url = `${KSP}/sports/board.es?mid=b10301000000&bid=0017&act=view&list_no=${r.id}`;
    let body = '';
    let attachments = [];
    try {
      const v = await fetchText(url);
      const s = v.lastIndexOf('<', v.indexOf('class="view_cont"'));
      const e = v.indexOf('class="btn_area"', s);
      body = v.indexOf('class="view_cont"') === -1 ? '' : v.slice(s, e === -1 ? s + 30000 : e);
      // 첨부: <a href="/sports/boardDownload.es?..." class="file_down"><span class="text">파일명</span>
      attachments = [...body.matchAll(/href="([^"]*boardDownload\.es[^"]*)"\s+class="file_down">\s*<span class="text">([\s\S]*?)<\/span>/gi)].map(a => {
        const name = htmlToText(a[2]) || 'file';
        const href = new URL(decode(a[1]), KSP).href;
        return { name, ext: extOf(name), load: () => fetchBuf(href).catch(() => null) };
      });
    } catch (e) { body = ''; r.error = e.message; }
    posts.push({
      key: `ksp:${r.id}`, source: 'ksp', poolId: 'bdolympic', poolName: '분당올림픽스포츠센터',
      id: r.id, title: r.title, date: r.date, url, bodyHtml: body, attachments, images: bodyImages(body, KSP),
      error: r.error,
    });
  }
  return posts;
}

// ─────────────────────────── 유스센터 ───────────────────────────
const SNY = 'https://www.snyouth.or.kr';
export const YOUTH_BOARDS = [
  { board: 148, poolId: 'yc_yatap',   poolName: '야탑유스센터' },
  { board: 47,  poolId: 'yc_jungwon', poolName: '중원유스센터' },
  { board: 123, poolId: 'yc_pangyo',  poolName: '판교유스센터' },
  { board: 22,  poolId: 'yc_sujeong', poolName: '수정유스센터' },
];

async function youthPosts(b) {
  const listUrl = `${SNY}/fmcs/${b.board}`;
  let html = await fetchText(listUrl);
  // 가끔 200으로 빈 틀(글 목록 없음)이 오므로 한 번 더 받아 본다.
  if (!/action-value=[0-9a-f]{32}/.test(html)) { await new Promise(r => setTimeout(r, 3000)); html = await fetchText(listUrl); }
  const rows = [];
  for (const tr of html.match(/<tr[\s\S]*?<\/tr>/g) || []) {
    const h = tr.match(/action-value=([0-9a-f]{32})/);
    if (!h) continue;
    const a = tr.match(/<a[^>]*action-value[^>]*>([\s\S]*?)<\/a>/);
    const date = (tr.match(/\d{4}-\d{2}-\d{2}/) || [''])[0];
    rows.push({ id: h[1], title: htmlToText(a ? a[1] : ''), date });
  }
  const posts = [];
  for (const r of rows.slice(0, 15)) {
    const url = `${listUrl}?action=read&action-value=${r.id}`;
    let body = '';
    let attachments = [];
    try {
      const v = await fetchText(url);
      const c = v.indexOf('class="board_content');
      const s = v.lastIndexOf('<', c);
      const e = v.indexOf('class="btn-common-box', c);
      const seg = c === -1 ? '' : v.slice(s, e === -1 ? s + 60000 : e);
      const f = seg.indexOf('class="files"');
      body = f === -1 ? seg : seg.slice(0, f);
      const files = f === -1 ? '' : seg.slice(f);
      attachments = [...files.matchAll(/<div class="name">([\s\S]*?)<\/div>[\s\S]*?href="(\/File\/Download\/[0-9a-f]+)"/g)].map(m => {
        const name = htmlToText(m[1]);
        return { name, ext: extOf(name), load: () => fetchBuf(SNY + m[2], { timeout: 60000 }).catch(() => null) };
      });
    } catch (e) { r.error = e.message; }
    posts.push({
      key: `sny${b.board}:${r.id}`, source: 'sny', poolId: b.poolId, poolName: b.poolName,
      id: r.id, title: r.title, date: r.date, url, bodyHtml: body, attachments, images: bodyImages(body, SNY),
      error: r.error,
    });
  }
  return posts;
}

// 모든 게시판을 모아 반환. 게시판 하나가 실패해도 나머지는 계속한다.
export async function collectPosts({ log = console.log } = {}) {
  const jobs = [
    ...SPO_BOARDS.map(b => ({ name: b.poolName, poolId: b.poolId, run: () => spoPosts(b) })),
    { name: '분당올림픽스포츠센터', poolId: 'bdolympic', run: kspPosts },
    ...YOUTH_BOARDS.map(b => ({ name: b.poolName, poolId: b.poolId, run: () => youthPosts(b) })),
  ];
  const posts = [];
  const errors = [];
  for (const j of jobs) {
    try {
      const got = await j.run();
      if (!got.length) throw new Error('글 0건(게시판 구조 변경 의심)');
      posts.push(...got);
      log(`  ${j.name}: ${got.length}건`);
    } catch (e) {
      log(`  ${j.name}: 오류 ${e.message}`);
      errors.push({ pool: j.name, poolId: j.poolId, error: e.message });
    }
  }
  return { posts, errors };
}
