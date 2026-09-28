# 이 맥에서 자동으로 도는 것들 (성남 수영장)

> **"맥이 왜 새벽/저녁에 저절로 깨어나지?"** → 아래 ④ 맥 자동 깨우기 때문입니다.
> 확인: 터미널에서 `pmset -g sched` → `by 'seongnam-swim'` 줄이 이 작업이 건 예약입니다.

수영장 시간표 점검과 금곡 강습 알림은 GitHub 서버가 아니라 **이 맥**에서 실행됩니다
(해외 서버에서는 수영장 사이트 접속이 자주 막혀서). 그래서 맥이 제시간에 깨어 있어야 합니다.

| 시각(매일) | 무엇 | 담당 |
|---|---|---|
| 07:58 · 18:58 · 20:58 | 맥 깨우기 | ④ |
| 08:00 | 금곡 강습 알림(아침) | ② `com.seongnam-swim.lesson-morning` |
| 19:00 | 금곡 강습 알림(저녁) | ② `com.seongnam-swim.lesson-evening` |
| 21:00 | 수영장 시간표·공지 점검 | ② `com.seongnam-swim.nightly` |

## ① GitHub 러너
- 위치 `~/actions-runner/`, 로그인하면 자동 실행(`~/Library/LaunchAgents/actions.runner.aminade-seongnam-swim.seongnam-mac.plist`).
- 상태: `gh api repos/aminade/seongnam-swim/actions/runners`

## ② 예약 실행 (사용자 LaunchAgent)
- `com.seongnam-swim.*.plist` 3개 → `~/Library/LaunchAgents/`에 설치됨. 정해진 시각에 `trigger.sh`가 GitHub 워크플로를 즉시 실행시킨다.
- GitHub 자체 예약(cron)은 4시간 넘게 밀린 적이 있어서 쓰지 않는다.
- 강습 예약은 `-f mode=morning`/`mode=evening`을 넘긴다 → 맥이 잠들어 실행이 늦어져도 아침 실행은 아침 알림으로 처리.
- plist를 고치면 다시 설치: `cp scripts/mac/com.seongnam-swim.lesson-*.plist ~/Library/LaunchAgents/` 후 각각 `launchctl bootout gui/$(id -u)/<Label>` → `launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/<파일>`
- 기록: `~/.swim-notice/trigger.log`

## ③ 작업 중 잠자기 방지
- 워크플로 첫 단계가 `caffeinate`로 작업이 끝날 때까지 맥을 깨워 둔다(보통 1분~30분).
- 없으면 작업 중 잠들어 GitHub이 실행을 취소한다(2026-09-24·26 실제 발생).

## ④ 맥 자동 깨우기 (관리자 LaunchDaemon) — 2026-09-28 추가
- 맥이 잠들어 있으면 ②가 제시간에 못 돈다(깨어난 뒤에야 실행). 그래서 2분 먼저 깨운다.
- 구성
  - `/Library/LaunchDaemons/com.seongnam-swim.wake.plist` — 켜질 때 + 매일 00:05·08:05·19:05·21:05에 실행
  - `/usr/local/libexec/seongnam-swim-wake.sh` — 오늘·내일 깨우기 예약을 `pmset schedule wake`로 채움
  - 원본은 이 폴더의 `com.seongnam-swim.wake.plist`, `wake-schedule.sh`
- 기록: `/var/log/seongnam-swim-wake.log`
- 설치: `sudo bash scripts/mac/install-wake.sh`
- **끄기(제거)**: `sudo bash scripts/mac/install-wake.sh --uninstall` — 걸어 둔 예약까지 취소한다.
- 시각을 바꾸려면 `wake-schedule.sh`의 `TIMES`와 ②의 plist를 같이 고친 뒤 다시 설치.
- 한계
  - 맥이 **완전히 꺼져 있으면** 켜지지 않는다(잠자기 상태만 깨움).
  - 노트북 **덮개를 닫고 배터리로** 두면 깨어나도 곧 다시 잠들 수 있다. 전원 연결 권장.
- 설치 직후 macOS가 "백그라운드 항목 추가됨" 알림을 띄울 수 있다(시스템 설정 → 일반 → 로그인 항목에 보임). 정상이다.
