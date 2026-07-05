# Handoff: 익명 피드백 기능 (Swim, Seongnam)

## Overview
Swim Seongnam 웹페이지(`index.html`)에 **익명 사용자 피드백** 기능을 추가한다. 두 가지 목적:
1. **잘못된 정보 신고** — 특정 수영장의 특정 데이터 항목(시간표·요금 등)이 틀렸을 때 올바른 정보 + 스크린샷을 제보.
2. **불편한 점 / 개선 요청** — 서비스 사용 경험에 대한 자유 피드백.

진입점은 페이지 **푸터의 조용한 버튼** 하나이고, 누르면 하단에서 **바텀시트**가 올라와 두 유형을 탭으로 전환한다. 제출은 **완전 익명**(로그인·개인정보 없음).

## About the Design Files
이 폴더의 `Feedback Prototype.dc.html`은 **HTML로 만든 디자인 참조 프로토타입**이다 — 최종적으로 어떻게 보이고 동작하는지를 보여주는 목업이며, 그대로 복사해 넣는 프로덕션 코드가 아니다.

**중요:** 이 프로토타입은 내부 컴포넌트 프레임워크(`<x-dc>`, `{{ }}` 바인딩, `class Component extends DCLogic`, `support.js`)로 작성됐다. **이 프레임워크 문법을 실제 코드에 옮기면 안 된다.** 대상 파일 `index.html`은 순수 바닐라 구조다:
- 스타일: `<head>` 안 단일 `<style>` 블록, `.swim-app` 스코프의 **CSS 변수**로 팔레트 정의, 인라인이 아닌 클래스 기반.
- 로직: 파일 하단 단일 `<script>` 안 `document.addEventListener('DOMContentLoaded', ...)`, 프레임워크 없는 순수 DOM/JS.

→ **작업은 프로토타입이 보여주는 UI/동작을 `index.html`의 기존 패턴(CSS 변수 + 클래스 + 바닐라 JS)으로 재구현하는 것이다.**

## Fidelity
**High-fidelity.** 색상·타이포·간격·인터랙션이 최종안이다. 아래 값 그대로 픽셀 단위로 재현할 것. 단, 히어로 배경은 프로토타입에선 하늘색 그라데이션 플레이스홀더이며 **실제 `index.html`에는 이미 하늘색 수영장 사진이 들어가 있으므로 건드리지 말 것**(색 톤 확인용이었음).

## 대상 파일
- **적용 대상:** `index.html` (프로젝트 루트의 실제 페이지)
- **디자인 참조:** `Feedback Prototype.dc.html` (이 폴더에 동봉)
- 참고: `admin.html`, `scripts/*` (GA4 프록시, 스케줄 스크립트) — 백엔드 저장 연동 시 참고.

---

## Screens / Views

### 1. 진입점 — 푸터 버튼
- **Purpose:** 페이지 어디서든(스크롤 끝) 은은하게 피드백 시작.
- **Layout:** 기존 `.swim-footer`(max-width 600px, 중앙정렬) 안, 푸터 메타 텍스트 아래에 배치. 상단에 `1px solid var(--line)` 구분 없이 메타 밑 `margin-top:18px`.
- **Component — 고스트 버튼:**
  - 전체폭, `border:1.5px solid var(--teal-line) (#bfe2f4)`, `border-radius:11px`, `padding:11px 0`, `text-align:center`, `cursor:pointer`.
  - 1행(중앙, flex gap 8px): 아이콘 `✎`(14px, `--teal`) + 텍스트 **"피드백 보내기"**(600, 13px, `--teal #1fa6e8`).
  - 2행: **"잘못된 정보·불편한 점을 알려주세요"**(11px, 연한 회색 `#a8bccb`), `margin-top:3px`.
  - Hover: 배경 `#f3fafd`, 테두리 `--teal`.
  - Click → 바텀시트 오픈.

### 2. 바텀시트 — 공통 셸
- **Purpose:** 피드백 입력 컨테이너.
- **Layout & 애니메이션:**
  - 백드롭: 화면 전체 `rgba(16,48,63,.55)`, fade-in 0.22s. 클릭 시 닫힘.
  - 시트: 화면 하단 고정, `max-height:94%`, 세로 스크롤, `background:#fff`, `border-radius:22px 22px 0 0`, `box-shadow:0 -10px 34px rgba(0,0,0,.3)`. slide-up 0.3s `cubic-bezier(.2,.8,.2,1)`.
  - 패딩 `18px 22px 26px`.
  - 상단 드래그 핸들: `38×4px`, `radius 3px`, `#d9edf7`, 중앙, `margin-bottom:16px`.
  - 제목 **"피드백 보내기"**: Noto Sans KR 800, 18px, `#10303f`, `letter-spacing:-.3px`.
- **탭 토글**(`margin-top:15px`): 컨테이너 `background:var(--surface-2) #eaf4fb`, `radius:10px`, `padding:4px`, flex gap 6px. 각 탭 `flex:1`, 중앙정렬, `padding:9px 0`, `font:600 12.5px`.
  - **활성 탭:** `background:#fff`, `radius:7px`, `box-shadow:0 1px 3px rgba(16,48,63,.1)`, `color:#10303f`.
  - **비활성 탭:** 배경 없음, `color:#5c7b8b`.
  - 탭1 = `⚑ 잘못된 정보`, 탭2 = `✎ 불편한 점`. 기본 활성 = 잘못된 정보.

### 3. 탭 A — 잘못된 정보 신고
- **레이블** "어느 정보인가요?" (600, 11px, `#5c7b8b`, `letter-spacing:.4px`, `margin:17px 0 7px`).
- **선택 필드 2개**(flex gap 8px, 각 `flex:1`, `position:relative`):
  - **수영장 (필수):** 클릭 시 드롭다운. 라벨 미선택 시 "수영장 선택"(placeholder 색 `#9db6c4`), 선택 시 수영장명(`#10303f`). 오른쪽 `⌄`.
  - **항목 (선택):** 라벨 "항목 (선택)". 동일 드롭다운 패턴.
  - 필드 스타일:
    - 미선택(값 없음): `border:1px solid var(--line)`, `background:var(--bg)`, `radius:8px`, `padding:11px 12px`, `font:600 13px`, 텍스트 `#9db6c4`.
    - 값 있음: 동일하나 텍스트 `#10303f`.
    - 열림(드롭다운 오픈): `border:1.5px solid var(--teal)`, `background:#fff`.
  - **드롭다운 팝오버:** 필드 바로 아래 `top:46px`, `position:absolute`, `z-index:5`, `background:#fff`, `border:1px solid var(--teal-line)`, `radius:10px`, `overflow:hidden`, `box-shadow:0 8px 22px rgba(16,48,63,.16)`.
    - 옵션 행: `padding:11px 14px`, `font:500 13px`, `#10303f`, 행 사이 `border-top:1px solid var(--surface-2)`, `cursor:pointer`.
    - 선택된 행: `font-weight:600`, `color:var(--teal)`, `background:var(--surface-2)`.
  - **수영장 목록:** 탄천종합운동장 / 성남종합운동장 / 황새울국민체육센터 / 판교스포츠센터 / 평생스포츠센터 / 금곡공원국민체육센터 (index.html의 `POOLS` 배열과 동일하게).
  - **항목 목록:** 자유수영 시간표 / 요금 / 휴관일 · 휴관 주 / 운영 상태 / 위치 · 주소 / 기타.
- **레이블** "올바른 정보" (동일 레이블 스타일, `margin:16px 0 7px`).
- **textarea:** 전체폭, `border:1px solid var(--line)`, `radius:8px`, `padding:12px`, `min-height:76px`, `font-size:13px`, `line-height:1.6`, `color:#10303f`, placeholder 색 `#9db6c4`. placeholder = "예) 평일 15:00 자유수영은 없어졌어요. 실제로는 16:00부터예요."

### 4. 탭 B — 불편한 점
- **레이블** "어떤 점이 불편했나요?" (`margin:17px 0 9px`).
- **유형 칩**(flex wrap, gap 7px): 사용법이 헷갈려요 / 원하는 정보가 없어요 / 보기 불편해요 / 기능 제안 / 기타.
  - 칩 기본: `border:1px solid var(--line)`, `radius:20px`, `padding:8px 13px`, `font:500 12px`, `#5c7b8b`, `cursor:pointer`.
  - 칩 선택: `border:1.5px solid var(--teal)`, `background:var(--surface-2)`, `font-weight:600`, `#10303f`. (단일 선택)
- **레이블** "자세한 내용" (`margin:17px 0 7px`).
- **textarea:** 위와 동일하나 `min-height:96px`. placeholder = "예) 캘린더에서 특정 수영장만 골라 보고 싶어요. 지금은 전체가 다 보여서 찾기 힘들어요."

### 5. 스크린샷 첨부 (두 탭 공통)
- `margin-top:12px`, flex gap 10px.
- **첨부 전:** `＋` 박스(`62×62px`, `border:1.5px dashed var(--teal-line)`, `radius:10px`, 세로 중앙, `background:#f8fcfe`, `cursor:pointer`) — 안에 `＋`(18px, teal) + "스샷"(9px, `#5c7b8b`). 박스는 `<label>`로 감싸 숨긴 `<input type="file" accept="image/*">`를 트리거. 옆에 안내문 "스크린샷을 첨부하면 / 확인이 더 빨라져요 (선택)" (10.5px, `#9db6c4`).
- **첨부 후:** 같은 자리에 62×62 썸네일(`object-fit:cover`, `radius:10px`, `border:1px solid var(--line)`), 우상단 제거 버튼 `×`(18px 원, `rgba(16,48,63,.65)`, 흰 글자). FileReader로 dataURL 미리보기.

### 6. 보내기 버튼 (두 탭 공통)
- `margin-top:16px`, 전체폭, `radius:11px`, `padding:15px 0`, 중앙, `font:700 14px`, 흰 글자.
- **활성:** `background:var(--teal) #1fa6e8`, `cursor:pointer`.
- **비활성:** `background:var(--teal-line) #bfe2f4`, `opacity:.7`, `cursor:default`.
- 아래 익명 안내: "익명으로 전송돼요 · 개인정보를 수집하지 않아요" (10.5px, `#9db6c4`, 중앙, `margin-top:11px`).

### 7. 완료 화면 (제출 성공)
- 시트 내용이 완료 상태로 교체. 패딩 `34px 26px 30px`, 중앙정렬. (드래그 핸들 유지)
- 체크 배지: 62px 원(`background:var(--surface-2)`) 안에 40px 원(`background:var(--teal)`) 안에 `✓`(22px, 흰색). pop 애니메이션 0.4s (scale .7→1.08→1).
- 제목 "피드백을 보냈어요" (Noto Sans KR 800, 19px, `#10303f`, `margin-top:20px`).
- 본문 "확인 후 정보에 반영할게요.\n함께 고쳐주셔서 고마워요." (13px, `#5c7b8b`, `line-height:1.7`).
- **요약 칩**(inline-flex, `margin-top:20px`, `background:var(--bg)`, `border:1px solid var(--line)`, `radius:20px`, `padding:8px 14px`): 아이콘 + 내용.
  - 잘못된 정보: `⚑`(색 `--sun #f47c72`) + "{수영장명} · {항목}" (항목 없으면 수영장명만).
  - 불편한 점: `✎`(색 `--teal`) + "{선택한 유형 칩}".
- 닫기 버튼: `margin-top:26px`, 전체폭, `background:var(--surface-2)`, `border:1px solid var(--line)`, `radius:11px`, `padding:15px 0`, `font:700 14px`, `color:var(--teal)`, `cursor:pointer`. (⚠ 진한 남색 금지 — 연한 톤)

---

## Interactions & Behavior
- **오픈:** 푸터 버튼 클릭 → 시트 slide-up + 백드롭 fade-in. **오픈 시 폼 전체 초기화**(탭=잘못된 정보, 수영장·항목·유형·텍스트·이미지·드롭다운 상태 리셋).
- **닫기:** 백드롭 클릭 또는 완료 화면의 "닫기" → 시트 제거, 드롭다운 닫힘.
- **탭 전환:** 두 탭 상호 배타. 전환 시 열려있던 드롭다운 닫기.
- **드롭다운:** 수영장/항목 서로 배타적으로 열림(하나 열면 다른 하나 닫힘). 옵션 선택 시 해당 드롭다운 닫힘.
- **보내기 활성 조건**(실시간):
  - 잘못된 정보 탭: 수영장 선택됨 **AND** 올바른 정보 텍스트 비어있지 않음(trim > 0). 항목은 선택 아님.
  - 불편한 점 탭: 유형 칩 선택됨 **AND** 자세한 내용 텍스트 비어있지 않음.
  - 조건 미충족 시 버튼 비활성(연한 파랑 + opacity .7), 클릭 무시.
- **제출:** 활성일 때만 동작 → 요약 생성 → 완료 화면 표시. (아래 State + 백엔드 참고)

## State Management
필요한 상태 변수:
- `sheetOpen` (bool), `submitted` (bool)
- `tab` ('report' | 'improve')
- `poolOpen`, `itemOpen` (bool — 드롭다운)
- `pool`, `item`, `cat` (선택된 값, 문자열)
- `reportText`, `improveText` (textarea 내용)
- `img` (첨부 이미지 dataURL 또는 null)
- `summary` ({ icon, color, text } — 완료 화면용)

전이 트리거: 위 Interactions 참고. 바닐라 구현 시 모듈 스코프 객체 하나로 상태를 두고, 관련 DOM만 갱신하는 `render()`/토글 함수로 처리하면 index.html 스타일과 맞는다.

## 백엔드 저장 (익명 페이로드)
프로토타입은 프론트 동작까지만 구현(제출 시 완료 화면 표시). 실제 저장은 별도 필요:
- 페이로드 예시: `{ type, pool, item, text, hasImage, createdAt }` (+ 이미지).
- 이 프로젝트에 이미 Google Apps Script(`scripts/ga4-proxy.gs`)와 `admin.html`이 있으므로 **Apps Script + 스프레드시트**로 받는 것이 자연스럽다.
- 스크린샷은 용량이 크므로 Base64 인라인보다 **Google Drive 업로드 후 링크 저장**을 권장.
- 익명이므로 개인정보·쿠키·식별자 수집 금지.

## Design Tokens (index.html의 `.swim-app` CSS 변수)
- `--bg:#f1f9fd`  `--surface:#ffffff`  `--surface-2:#eaf4fb`
- `--line:#d9edf7`  `--line-strong:#c3ddec`
- `--text:#10303f`  `--muted:#5c7b8b`  `--faint:#9db6c4`
- `--teal:#1fa6e8`  `--teal-soft:#e2f2fb`  `--teal-line:#bfe2f4`
- `--green:#2bb888`  `--sun:#f47c72`
- 추가로 이 기능에서 쓴 값: 버튼 안내문 회색 `#a8bccb`, 첨부박스 배경 `#f8fcfe`.
- **폰트:** 본문 `Pretendard`, 제목 `'Noto Sans KR'`(700/800), 숫자 `'Sora'`. (index.html에 이미 로드됨)
- **radius:** 시트 22px, 카드/필드/버튼 8~11px, 칩/요약칩 20px, 핸들 3px.
- **애니메이션:** fade 0.22s, slide-up 0.3s cubic-bezier(.2,.8,.2,1), 체크 pop 0.4s.

## Assets
- 별도 이미지 없음. 아이콘은 텍스트 글리프(`⚑ ✎ ✓ ＋ × ⌄ ›`) 사용. 코드베이스에 아이콘 시스템이 있으면 대체 가능.
- 히어로 사진은 index.html의 기존 것을 그대로 사용(변경 금지).

## Files
- `Feedback Prototype.dc.html` — 인터랙티브 디자인 참조(프레임워크 프로토타입, 문법 복사 금지 / 동작·스타일 참조용).
- `screenshots/` — 각 화면 캡처(아래):
  - `0-entry-button.png` — 푸터 진입 버튼(맥락 포함, 캡처용으로 행 일부·히어로 높이만 축소함)
  - `2-report-tab.png` — 잘못된 정보 신고 탭 (수영장·항목 선택된 상태)
  - `3-improve-tab.png` — 불편한 점 탭 (유형 칩 선택 상태)
  - `4-done.png` — 제출 완료 화면
  - ※ 스크린샷은 캡처 편의를 위해 프레임 크기를 임시로 줄인 것이며, 실제 비율·전체 높이는 `Feedback Prototype.dc.html`을 브라우저에서 열어 확인할 것.
