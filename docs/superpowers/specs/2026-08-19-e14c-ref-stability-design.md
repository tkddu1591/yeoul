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

---

## 실행 중 실측 정정 (Task 1)

- **잠복 버그 재현엔 조건이 하나 더 필요하다**: 셸 첫 프롬프트가 접기 *이후* 도착하면 `dismissHint→setTabs` 리렌더의 attach ref 콜백이 refit을 우연히 대신 돌린다(레이스). **"빈 상태 힌트가 꺼진(첫 출력 도착) 조용한 상태에서 접기"**여야 안정적으로 빨강.
- **E14b 인수인계 처방 둘이 틀렸다**: ① "안정화하면 deps에 그대로 넣고 지운다"(open/groupKey 이펙트) — `sessions.tabs`를 넣으면 "마지막 탭 닫기→즉시 자동 재생성" 의미 변화(이펙트는 전이 기반 의미론). tabs 분기를 `activateGroup` 안으로 내려 이펙트가 tabs를 아예 안 읽게 해소. ② "액션을 ref로 고정" — v7 lint가 문자 그대로 거부(렌더 중 ref 전달=`refs` 에러, useState 값 필드 개서=`immutability` 에러, 실측). **모듈 레벨 팩토리 `createTerminalCore` + `useState` lazy init(인스턴스당 1회) + 코어 소유 스냅숏**으로 우회 — `useMemo`/`useCallback` 미사용.
- **v7 `exhaustive-deps`는 `obj.method()` 호출 시 수신자 `obj` 전체를 deps로 요구한다**(멤버로 불충분, 실측) — 액션을 상단에서 구조 분해로 해결. **후속 태스크(ConflictPanel·HistoryPanel)에 같은 함정 예상.**
