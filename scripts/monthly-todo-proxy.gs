/**
 * '수영장 운영 변경사항' 탭을 토큰 잠금으로 CSV 반환하는 최소 Apps Script 프록시.
 * (SEO 시트를 웹에 게시하지 않고 비공개로 유지 — ga4-proxy.gs와 동일한 ?token= 방식)
 *
 * ── 배포 (한 번) ──
 * 1) https://script.google.com → 새 프로젝트 → 이 파일 내용 전체 붙여넣기.
 * 2) 좌측 톱니(프로젝트 설정) → '스크립트 속성' → 속성 추가:
 *      이름 ACCESS_TOKEN / 값 = 길고 임의의 문자열(예: 40자 랜덤). 이게 비밀번호.
 * 3) 우측 상단 '배포 → 새 배포' → 유형 '웹 앱' →
 *      실행: 나(본인 계정) / 액세스 권한: '모든 사용자' → 배포.
 *      (처음이면 Sheets 접근 권한 승인 팝업 뜸 → 허용)
 * 4) 나온 웹 앱 URL 끝에 ?token=<위 값> 을 붙인 전체 URL을
 *      GitHub 레포 → Settings → Secrets → Actions 에 SEO_CHANGES_CSV_URL 로 저장.
 *      예: https://script.google.com/macros/s/AKfy.../exec?token=xxxxxxxx
 *
 * 탭 헤더 1행: 대상월(공지할 시점) | 발견일 | 적용일 | 내용
 * 반환은 '표시값'(getDisplayValues) — 시트에 보이는 그대로라 날짜 형식 안 깨짐.
 */
var SHEET_ID = '1yhCsJzDsAf9B7_vdkYHGIlsqECebw5iXYsbQ53DYTxU';
var TAB_NAME = '수영장 운영 변경사항';

function doGet(e) {
  var expected = PropertiesService.getScriptProperties().getProperty('ACCESS_TOKEN');
  var given = e && e.parameter && e.parameter.token;
  if (!expected || given !== expected) {
    return ContentService.createTextOutput('forbidden').setMimeType(ContentService.MimeType.TEXT);
  }
  var sh = SpreadsheetApp.openById(SHEET_ID).getSheetByName(TAB_NAME);
  if (!sh) {
    return ContentService.createTextOutput('tab-not-found: ' + TAB_NAME).setMimeType(ContentService.MimeType.TEXT);
  }
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
