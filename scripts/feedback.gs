// ═══════════════════════════════════════════════════════════════
// Swim Seongnam — 익명 피드백 수신기 (Google 스프레드시트 + 이메일 알림)
// Google Apps Script에 이 코드를 붙여넣고 웹 앱으로 배포하세요.
//
// index.html의 피드백 폼이 이 웹앱으로 익명 페이로드를 POST하면:
//   1. "내 드라이브/Projects/Swim Seongnam" 폴더의 'Swim 성남 피드백' 시트에 한 줄씩 누적
//      (폴더/시트가 없으면 자동 생성, 있으면 재사용 — 제출마다 새로 만들지 않음)
//   2. NOTIFY_EMAIL로 제출 알림 메일 발송
//   3. 스크린샷이 있으면 같은 폴더에 업로드하고 링크만 저장 (용량 절약)
//
// ── 배포 방법 ──────────────────────────────────────────────────
//  1. script.google.com → 기존 피드백 프로젝트 열기
//  2. 코드 전체를 이 내용으로 교체(전체 선택 후 붙여넣기) → 저장(Ctrl+S)
//  3. 배포 → 배포 관리 → 편집(연필) → 버전: 새 버전 → 배포  (URL 유지됨)
//  4. 처음이면 권한 승인(스프레드시트·메일·드라이브) 필요
//
//  ※ 특정 시트를 강제로 쓰고 싶으면 CONFIG.SHEET_ID에 시트 ID를 넣으세요.
//    (그 경우 폴더 탐색은 건너뛰고 그 시트만 사용 — 폴더로 옮겨도 ID는 안 바뀌므로 안전)
// ═══════════════════════════════════════════════════════════════

const CONFIG = {
  SHEET_ID:     '',                 // 비우면 아래 폴더에서 자동 탐색/생성
  SHEET_NAME:   '피드백',           // 스프레드시트 내부 탭 이름
  NOTIFY_EMAIL: 'aminade@gmail.com',
};

// 내 드라이브 아래 폴더 경로 + 스프레드시트 파일명
const FOLDER_PATH = ['Projects', 'Swim Seongnam'];
const SPREADSHEET_NAME = 'Swim 성남 피드백';

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

// 지정 폴더에서 시트를 찾아 재사용(없으면 그 폴더에 1회 생성)
function getSheet_() {
  let ss;
  if (CONFIG.SHEET_ID) {
    ss = SpreadsheetApp.openById(CONFIG.SHEET_ID);
  } else {
    const folder = getOrCreateFolder_(FOLDER_PATH);
    const files = folder.getFilesByName(SPREADSHEET_NAME);
    if (files.hasNext()) {
      ss = SpreadsheetApp.open(files.next());
    } else {
      ss = SpreadsheetApp.create(SPREADSHEET_NAME);            // 루트에 생성된 뒤
      DriveApp.getFileById(ss.getId()).moveTo(folder);         // 대상 폴더로 이동
    }
  }
  let sheet = ss.getSheetByName(CONFIG.SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(CONFIG.SHEET_NAME);
    sheet.appendRow(['접수시각', '유형', '수영장', '항목', '개선유형', '내용', '스크린샷']);
    sheet.setFrozenRows(1);
  }
  return sheet;
}

// 내 드라이브 기준으로 경로를 따라가며 폴더를 찾고, 없는 단계는 생성
function getOrCreateFolder_(pathArr) {
  let parent = DriveApp.getRootFolder();
  for (const name of pathArr) {
    const it = parent.getFoldersByName(name);
    parent = it.hasNext() ? it.next() : parent.createFolder(name);
  }
  return parent;
}

function saveScreenshot_(dataUrl) {
  const m = dataUrl.match(/^data:([^;]+);base64,(.*)$/);
  if (!m) return '';
  const contentType = m[1];
  const ext = (contentType.split('/')[1] || 'png').replace('jpeg', 'jpg');
  const bytes = Utilities.base64Decode(m[2]);
  const blob = Utilities.newBlob(bytes, contentType, 'feedback-' + Date.now() + '.' + ext);
  const folder = getOrCreateFolder_(FOLDER_PATH);   // 시트와 같은 폴더에 저장
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
