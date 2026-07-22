/**
 * '수영장 운영 변경사항' 탭 프록시 (읽기 doGet + 쓰기 doPost), 토큰 잠금.
 * (SEO 시트를 웹에 게시하지 않고 비공개로 유지 — ga4-proxy.gs와 동일한 ?token= 방식)
 *
 * ── 배포/재배포 (코드 바꾸면 '새 버전'으로 다시 배포해야 반영됨) ──
 * 1) https://script.google.com → 프로젝트 → 이 파일 내용 전체 붙여넣기 → 저장(Cmd+S).
 * 2) ⚙️ 프로젝트 설정 → '스크립트 속성' → ACCESS_TOKEN = 길고 임의의 영문+숫자 문자열.
 * 3) 배포 → (첫 배포면)새 배포/웹 앱/실행:나/액세스:모든 사용자,
 *      (이미 배포됨이면)배포 관리 → 연필 → 버전 '새 버전' → 배포. URL 그대로 유지됨.
 * 4) 웹 앱 URL 끝에 ?token=<값> 붙인 전체 URL을 GitHub 시크릿 SEO_CHANGES_CSV_URL 로 저장.
 *      (읽기·쓰기 모두 이 한 URL 사용 — 읽기는 GET, 쓰기는 같은 URL로 POST)
 *
 * 탭 헤더 1행: 대상월(공지할 시점) | 발견일 | 적용일 | 내용
 * 읽기(GET): 탭을 CSV로 반환(getDisplayValues — 보이는 그대로).
 * 쓰기(POST JSON {month,disc,eff,text}): 한 행 append. 같은 (대상월,내용)이면 중복이라 skip.
 */
var SHEET_ID = '1yhCsJzDsAf9B7_vdkYHGIlsqECebw5iXYsbQ53DYTxU';
var TAB_NAME = '수영장 운영 변경사항';

function doGet(e) {
  if (!_auth(e)) return _t('forbidden');
  var sh = SpreadsheetApp.openById(SHEET_ID).getSheetByName(TAB_NAME);
  if (!sh) return _t('tab-not-found: ' + TAB_NAME);
  var values = sh.getDataRange().getDisplayValues();
  var csv = values.map(function (row) {
    return row.map(function (cell) {
      var s = (cell === null || cell === undefined) ? '' : String(cell);
      if (/[",\n]/.test(s)) s = '"' + s.replace(/"/g, '""') + '"';
      return s;
    }).join(',');
  }).join('\n');
  return ContentService.createTextOutput(csv).setMimeType(ContentService.MimeType.CSV);
}

function doPost(e) {
  if (!_auth(e)) return _t('forbidden');
  var body;
  try { body = JSON.parse((e && e.postData && e.postData.contents) || '{}'); }
  catch (err) { return _t('{"ok":false,"error":"bad-json"}'); }
  var month = _s(body.month), text = _s(body.text);
  if (!month || !text) return _t('{"ok":false,"error":"month/text required"}');
  var disc = _s(body.disc), eff = _s(body.eff);

  var lock = LockService.getScriptLock();
  try { lock.waitLock(10000); } catch (err) { return _t('{"ok":false,"error":"locked"}'); }
  try {
    var sh = SpreadsheetApp.openById(SHEET_ID).getSheetByName(TAB_NAME);
    if (!sh) return _t('{"ok":false,"error":"tab-not-found"}');
    var values = sh.getDataRange().getDisplayValues();
    var header = values[0] || [];
    var col = _mapCols(header);
    if (col.month < 0 || col.text < 0) return _t('{"ok":false,"error":"header missing"}');
    // 중복 방지: 같은 (대상월, 내용) 행이 이미 있으면 skip
    for (var r = 1; r < values.length; r++) {
      if (_norm(values[r][col.month]) === _norm(month) && _norm(values[r][col.text]) === _norm(text)) {
        return _t('{"ok":true,"dup":true}');
      }
    }
    var width = Math.max(header.length, col.text + 1, col.eff + 1, col.disc + 1, col.month + 1);
    var out = [];
    for (var i = 0; i < width; i++) out.push('');
    out[col.month] = month;
    if (col.disc >= 0) out[col.disc] = disc;
    if (col.eff >= 0) out[col.eff] = eff;
    out[col.text] = text;
    sh.appendRow(out);
    return _t('{"ok":true,"appended":true}');
  } finally {
    lock.releaseLock();
  }
}

function _auth(e) {
  var expected = PropertiesService.getScriptProperties().getProperty('ACCESS_TOKEN');
  var given = e && e.parameter && e.parameter.token;
  return !!expected && given === expected;
}
function _t(s) { return ContentService.createTextOutput(s).setMimeType(ContentService.MimeType.TEXT); }
function _s(v) { return (v === null || v === undefined) ? '' : String(v).trim(); }
function _norm(s) { return (s === null || s === undefined ? '' : String(s)).replace(/\s+/g, ' ').trim(); }
function _mapCols(header) {
  var c = { month: -1, disc: -1, eff: -1, text: -1 };
  for (var i = 0; i < header.length; i++) {
    var h = String(header[i]).replace(/\s+/g, '');
    if (c.month < 0 && /대상월|^월/.test(h)) c.month = i;
    else if (c.disc < 0 && /발견/.test(h)) c.disc = i;
    else if (c.eff < 0 && /(적용|변경일|변경날)/.test(h)) c.eff = i;
    else if (c.text < 0 && /(내용|변경사항|사항|항목)/.test(h)) c.text = i;
  }
  return c;
}
