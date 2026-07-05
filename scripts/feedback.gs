// ═══════════════════════════════════════════════════════════════
// Swim Seongnam — 익명 피드백 수신기 (Google 스프레드시트 + 이메일 알림)
// Google Apps Script에 이 코드를 붙여넣고 웹 앱으로 배포하세요.
//
// index.html의 피드백 폼이 이 웹앱으로 익명 페이로드를 POST하면:
//   1. 지정한 스프레드시트에 한 줄씩 자동 누적
//   2. NOTIFY_EMAIL로 제출 알림 메일 발송
//   3. 스크린샷이 있으면 Google Drive에 업로드하고 링크만 저장 (용량 절약)
//
// ── 배포 방법 ──────────────────────────────────────────────────
//  1. script.google.com → 새 프로젝트
//  2. 이 코드 전체 붙여넣기
//  3. 아래 CONFIG 3개 값 설정:
//       - SHEET_ID    : 피드백을 쌓을 구글 시트 ID (시트 URL의 /d/와 /edit 사이 문자열)
//                       비워두면 스크립트에 연결된 시트를 자동 사용/생성
//       - NOTIFY_EMAIL: 알림 받을 이메일 (예: aminade@gmail.com)
//       - DRIVE_FOLDER_ID: 스크린샷 저장 폴더 ID (선택, 비우면 내 드라이브 루트)
//  4. 상단 메뉴 → 배포 → 새 배포
//       - 유형: 웹 앱
//       - 다음 사용자로 실행: 나(본인 계정)
//       - 액세스 권한: 모든 사용자
//  5. 처음 배포 시 권한 승인(스프레드시트·메일·드라이브 접근) 필요
//  6. 배포 후 나오는 /exec URL을 index.html의 FEEDBACK_ENDPOINT에 붙여넣기
//
//  ⚠ 코드 수정 후에는 "배포 관리 → 편집(연필) → 새 버전"으로 재배포해야 반영됩니다.
// ═══════════════════════════════════════════════════════════════

const CONFIG = {
  SHEET_ID:        '',                 // 비우면 자동 생성/연결
  SHEET_NAME:      '피드백',
  NOTIFY_EMAIL:    'aminade@gmail.com',
  DRIVE_FOLDER_ID: '',                 // 스크린샷 저장 폴더 (선택)
};

const TYPE_LABEL = { report: '잘못된 정보', improve: '불편한 점' };

function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents);

    // 스크린샷이 있으면 Drive 업로드 → 링크만 시트/메일에 저장
    let imageUrl = '';
    if (data.hasImage && data.image) {
      imageUrl = saveScreenshot_(data.image);
    }

    const sheet = getSheet_();
    const createdAt = data.createdAt ? new Date(data.createdAt) : new Date();
    const typeLabel = TYPE_LABEL[data.type] || data.type || '';

    // 컬럼: 접수시각 | 유형 | 수영장 | 항목 | 개선유형 | 내용 | 스크린샷
    sheet.appendRow([
      createdAt,
      typeLabel,
      data.pool || '',
      data.item || '',
      data.cat || '',
      data.text || '',
      imageUrl,
    ]);

    if (CONFIG.NOTIFY_EMAIL) {
      notify_(data, typeLabel, imageUrl, createdAt);
    }

    return json_({ ok: true });
  } catch (err) {
    return json_({ ok: false, error: String(err) });
  }
}

// 브라우저에서 URL을 직접 열어 배포 상태를 확인할 때 사용
function doGet() {
  return json_({ ok: true, message: 'Swim Seongnam feedback endpoint is live.' });
}

// ── 헬퍼 ──────────────────────────────────────────────────────

function getSheet_() {
  const ss = CONFIG.SHEET_ID
    ? SpreadsheetApp.openById(CONFIG.SHEET_ID)
    : SpreadsheetApp.getActiveSpreadsheet() || SpreadsheetApp.create('Swim Seongnam 피드백');
  let sheet = ss.getSheetByName(CONFIG.SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(CONFIG.SHEET_NAME);
    sheet.appendRow(['접수시각', '유형', '수영장', '항목', '개선유형', '내용', '스크린샷']);
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function saveScreenshot_(dataUrl) {
  const m = dataUrl.match(/^data:([^;]+);base64,(.*)$/);
  if (!m) return '';
  const contentType = m[1];
  const ext = (contentType.split('/')[1] || 'png').replace('jpeg', 'jpg');
  const bytes = Utilities.base64Decode(m[2]);
  const blob = Utilities.newBlob(bytes, contentType, 'feedback-' + Date.now() + '.' + ext);
  const folder = CONFIG.DRIVE_FOLDER_ID
    ? DriveApp.getFolderById(CONFIG.DRIVE_FOLDER_ID)
    : DriveApp.getRootFolder();
  const file = folder.createFile(blob);
  file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  return file.getUrl();
}

function notify_(data, typeLabel, imageUrl, createdAt) {
  const target = data.type === 'report'
    ? (data.pool || '(수영장 미지정)') + (data.item ? ' · ' + data.item : '')
    : (data.cat || '');
  const subject = '[Swim 피드백] ' + typeLabel + ' — ' + (target || '내용 확인');
  const lines = [
    '유형: ' + typeLabel,
    data.type === 'report'
      ? '대상: ' + target
      : '개선 유형: ' + (data.cat || ''),
    '',
    '내용:',
    data.text || '(없음)',
    '',
    '스크린샷: ' + (imageUrl || '없음'),
    '접수시각: ' + Utilities.formatDate(createdAt, 'Asia/Seoul', 'yyyy-MM-dd HH:mm:ss'),
    '',
    '※ 익명 제출입니다. 개인정보·식별자는 수집하지 않습니다.',
  ];
  MailApp.sendEmail(CONFIG.NOTIFY_EMAIL, subject, lines.join('\n'));
}

function json_(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
