# E14c — 참조 안정화 (exhaustive-deps 억제 12곳 해소)

> E14b가 남긴 인수인계. 각 억제에는 "왜 지금은 못 푸는지 + E14c가 뭘 바꾸면 풀리는지"
> 주석이 달려 있다(E14b Task 7) — **그 주석들이 이 에픽의 태스크 목록이다.**
> 실측(2026-08-19): 억제 12곳, 파일 4개(App.tsx·TerminalDock.tsx·ConflictPanel.tsx·HistoryPanel.tsx).

## 1. 왜 지금 하는가 — 잠복 버그가 하나 실재한다

**`TerminalDock`의 `[]` 이펙트 둘이 마운트 시점 `sessions`를 굳혀 `refitActive`가 항상
`activeId: null`로 불리고 fit이 0회다**(E14b 실측: 17회 전부). 창 리사이즈는
`sessions.attach` ref 콜백의 부수효과가 가려 주지만, **사이드 접기 refit은 실제로
깨져 있다** — dock 1160/view 1136인데 xterm 737(오른쪽 35% 빈 공간). E12부터 잠복.

**검증은 리사이즈가 아니라 접기로 해야 한다**(E14b 명시).

## 2. 해소 전략 (E14b 인수인계 그대로 — 라인 번호는 낡았으니 주석으로 찾는다)

| 대상 | 전략 |
| --- | --- |
| `App.tsx` 3곳 | **가장 값싸다** — zustand 액션은 안정 참조다. `useRepositoryStore((s) => s.액션)` 셀렉터로 받으면 끝 |
| `TerminalDock` 5곳 | `useTerminalSessions` 반환 안정화 — **이게 곧 §1 잠복 버그의 수정이다** |
| `HistoryPanel`·`ConflictPanel` ×2 | 참조 안정화로 **안 풀린다** — `headIndex`/`items`를 ref로 읽어야 한다(주석의 처방 그대로) |

주의: **`useMemo`/`useCallback` 지양 지침과의 긴장** — 반환 안정화가 memo류를 요구하면
그건 최후 수단이고, 먼저 모듈 소유 상태·ref·셀렉터로 푼다. 어쩔 수 없이 쓰면 왜인지 기록.

## 3. 게이트 래칫

`exhaustive-deps`는 warning이라 게이트가 새 위반을 못 막는다(E14b 인수인계). 억제가 0이
된 뒤 **`--max-warnings 5`**(TanStack 5건만 잔존)를 lint 명령에 박아 재유입을 막는다.

## 4. 하지 않는 것

- TanStack Virtual `incompatible-library` 5건(별개 문제 — E14b가 영구 warn으로 결정)
- 성능 최적화(E14b §6 기준선이 "성능으로는 정당화 안 된다"고 실측)

## 5. 성공 기준

- `eslint-disable.*exhaustive-deps` **0곳** · lint `--max-warnings 5` 게이트 통과
- **사이드 접기 후 xterm이 새 폭을 쓴다**(E2E — 잠복 버그의 사용자 가시 수정)
- 기존 동작 무변: 735 tests · e2e 172 이상 · **E2E 중 창 절대 안 보임**
