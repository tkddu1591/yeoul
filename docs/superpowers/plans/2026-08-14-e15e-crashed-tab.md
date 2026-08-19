# E15e 크래시 탭 처리 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax로 추적.

**Goal:** 활성 탭이 크래시해도 창이 인질이 되지 않게 한다 — 산 이웃 전환·죽음 표시·클릭 복구.

**Architecture:** main이 각 뷰의 `render-process-gone`을 잡는다. 레지스트리에 `crashed`를 표시하고 push하며, 활성이면 산 이웃으로 전환(인질 해방), 유일 탭이면 즉시 `reload()`. 복구는 `tabs:activate`가 겸한다(크래시 탭이면 reload 후 활성화). `did-finish-load`가 표시를 걷는다.

**Tech Stack:** Electron 35.7.5 · React 19 · Vitest · Playwright(`forcefullyCrashRenderer` — E15c 리뷰 프로브2가 검증한 API)

## Global Constraints

- **정본 스펙:** `docs/superpowers/specs/2026-08-14-e15e-crashed-tab-design.md`.
- **E15c 플랜의 Global Constraints 전부 계승** (`docs/superpowers/plans/2026-08-11-e15c-tab-bar.md` — E2E 단일 포그라운드+`timeout: 600000` · `npx playwright test` 재빌드 안 함 · `page.evaluate` 1인자 · 가시성 단언은 `getVisible()`로만 · 상수는 리터럴 · 순서가 곧 단언 · `packages/**` eslint 밖 · vitest에서 electron은 호출이 막음).
- **기준 게이트:** lint **0 errors / 5 warnings** · typecheck 6/6 · `pnpm test` **697** · e2e **162 / 0**.
- **알려진 플레이크(오귀속 금지):** git-adapter 단위 1건 타임아웃(정확히 15000ms).
- 주석·커밋·UI 문구 한글, "왜"를 실측과 함께. `useMemo`/`useCallback` 지양. 컴포넌트는 콜백만.

---

## File Structure

| 파일 | 책임 |
| --- | --- |
| **수정** `apps/desktop/src/main/window-registry.ts` + test | 탭에 `crashed` 상태 · `setCrashed(tabId, crashed)` · snapshot/list에 노출 |
| **수정** `apps/desktop/src/main/index.ts` | `render-process-gone` 훅 · 활성 승계 · 유일 탭 reload · `tabs:activate`의 reload 겸용 · reveal 정합 · `did-finish-load` 해제 |
| **수정** `packages/ipc-contract/src/index.ts` | `TabInfo.crashed?: boolean` |
| **수정** `apps/desktop/src/renderer/src/components/TabBar.tsx` + css | 죽음 표시 |
| **수정** `apps/desktop/e2e/smoke.spec.ts` | E2E 3건 |

---

### Task 1: main — 크래시 감지·인질 해방·유일 탭 재시동

**Files:** `window-registry.ts`(+test) · `index.ts` · `ipc-contract`(TabInfo) · `smoke.spec.ts`

**Interfaces:**
- Produces: `registry.setCrashed(tabId: number, crashed: boolean): void`(없는 탭 무해·변화 있을 때만 `onChange('windows')`) · `TabInfo.crashed?: boolean` · main의 `render-process-gone` 배선. Task 2가 쓴다.

- [x] **Step 1: 레지스트리 단위 테스트** — `setCrashed` 표시/해제·없는 탭 무해·`snapshot`/탭 목록에 실림·변화 없으면 무발화. 기존 25건 파일에 describe 추가. **실패 확인 후 구현.**
- [x] **Step 2: main 훅.** `createRepoView`(`index.ts:408`)의 뷰 생성부에 배선 — 앵커는 실측(파일이 바뀌었을 수 있다):

```ts
  // 크래시한 렌더러는 destroyed가 아니라 수명 배선이 안 돈다 (E15c 리뷰 I-2 실측).
  // 탭바가 각 렌더러 안에 있으므로 여기서 main이 안 움직이면 활성 탭 크래시 = 창 인질이다
  view.webContents.on('render-process-gone', (_event, details) => {
    const tabId = view.webContents.id
    console.error(`탭 렌더러 크래시 (tab ${tabId}): ${details.reason}`)
    registry.setCrashed(tabId, true)
    const where = registry.windowOfTab(tabId)
    if (where === undefined) return
    const state = registry.getWindow(where.windowId)
    if (state === undefined) return
    const living = state.tabs.filter((id) => id !== tabId && !isTabCrashed(id))
    if (living.length === 0) {
      // 유일한(또는 전부 죽은) 탭 — 죽은 뷰엔 아무것도 그릴 수 없어 재시동이 유일한 복구다
      view.webContents.reload()
      return
    }
    if (state.activeTab === tabId) {
      // 인질 해방 — removeTab 승계와 같은 오른쪽 우선
      const next = pickSuccessor(state.tabs, tabId, living)
      registry.setActiveTab(where.windowId, next)
      showActiveTab(where.windowId)
    }
  })
```

  위 `isTabCrashed`·`pickSuccessor`는 실제 레지스트리/헬퍼 모양에 맞춘다 — **승계 규칙은 `removeTab`의 오른쪽 우선을 재사용하고 복제하지 않는다**(레지스트리에서 추출 가능하면 추출). `showActiveTab`은 기존 함수.
- [x] **Step 3: `did-finish-load`에서 해제.** 기존 `once('did-finish-load')`(`:183`)는 show용 1회다 — 해제는 **`on`**으로 따로 건다(reload마다 와야 한다). `registry.setCrashed(tabId, false)`.
- [x] **Step 4: E2E 2건.** ① 탭 둘·활성 크래시(`page.evaluate`로 그 뷰의 webContents에 `forcefullyCrashRenderer()` — 리뷰 프로브2 방식: `app.evaluate`에서 `webContents.fromId(id).forcefullyCrashRenderer()`) → 산 이웃이 활성(`getVisible()`), 산 탭의 `tabs.list`에 `crashed: true` ② 유일 탭 크래시 → 자동 재시동(`repo-path`가 다시 뜬다). **수정 전 빨강 확인**(①은 지금 코드에서 죽은 뷰가 활성으로 남으므로 `getVisible()` 단언이 실패해야 한다 — 초록이면 보고).
- [x] **Step 5: 반증** — 훅 제거→①② 빨강, 승계만 제거→①만 빨강. 게이트(697+신규 · e2e 164) 후 커밋.

### Task 2: 표시와 복구 — TabBar 죽음 표시 + activate의 reload 겸용 + reveal 정합

**Files:** `TabBar.tsx`+css · `index.ts`(`tabs:activate`·`revealExistingTab`) · `smoke.spec.ts`

- [x] **Step 1: `tabs:activate`가 크래시 탭이면 reload 후 활성화.** reload는 비동기 재시동이므로 활성화는 즉시 하되 화면은 `did-finish-load`가 채운다(배경색이 흰 프레임을 막는다 — E15c Task 1 실측). `revealExistingTab`(`:388`)도 같은 분기 — **한 곳으로 모은다**(reveal과 activate가 다른 복구를 하면 안 된다).
- [x] **Step 2: TabBar 죽음 표시.** `crashed`면 라벨 흐림 + 경고 글리프(기존 토큰 톤 — E7g의 흐림 관례를 먼저 읽는다). 툴팁/접근 이름에 "응답 없음 — 누르면 다시 열어요". testid `tab-crashed-<id>`.
- [x] **Step 3: E2E 1건** — 탭 둘·비활성 크래시 → 산 탭바에 죽음 표시(`tab-crashed-<id>` 가시) → 클릭 → 되살아나 활성(`getVisible()` + `repo-path`) + 표시 걷힘(`toHaveCount(0)`).
- [x] **Step 4: 반증** — 표시 렌더 제거→표시 단언만 빨강 · activate의 reload 분기 제거→복구 단언만 빨강. 게이트(e2e 165) 후 커밋.

### Task 3: 최종 게이트 + 실행 기록

- [x] 게이트 다섯(lint·typecheck·test·build·e2e). 이 플랜 말미에 실행 기록(편차·반증 출력·숫자). README `§현재 상태` 한 줄. 커밋.

Expected 최종: lint 0/5w · 6/6 · **697+신규** · 성공 · **165 / 0**

---

## 실행 중 실측 정정 (컨트롤러)

### Task 1

- **승계는 main이 아니라 레지스트리 `setCrashed` 안이다** (플랜 스니펫과 편차 — 옳은 재배치). 불변식("activeTab은 쓸 수 있는 탭")의 주인이 레지스트리이고, 크래시 여부를 아는 것도 레지스트리뿐이며, electron을 못 무는 vitest 제약상 순수부에 있어야 단위 테스트된다(11건). main 훅은 `setCrashed` → 전부 죽음이면 `reload()` → `showActiveTab`만.
- **`removeTab` 승계 구멍을 덤으로 수리** — 크래시 탭을 안 걸러 [A(활성)·B(크래시)·C]에서 A를 닫으면 크래시 B로 승계해 창이 도로 인질이 됐다. 산 이웃 우선으로 고침(전부 크래시면 관례대로 — 불변식 우선).
- **크래시 탭도 `webContents.close()`가 파괴까지 완주한다**(프로브 실측 — 고아 0). 정상 닫힘이 레지스트리를 먼저 지우는 순서 덕에 뒤따르는 `render-process-gone`은 무해 흡수.
- `snapshot`에 crashed를 싣지 않는다(플랜과 편차) — 영속 경계인데 크래시는 재시작하면 무의미하고 sanitize까지 파급된다. "crashed는 snapshot 무변"을 단위로 못박음.
- 훅 앵커는 `createRepoView`가 아니라 **`createTab`**(수명 배선이 사는 자리).
- **Task 2로 넘기는 경계**: 마지막 산 탭을 닫아 **전부 크래시만 남으면** reload가 없다 — removeTab 경로에는 "전부 죽었으면 재시동" 분기가 아직 없다.

### Task 2

- **복구 분기의 "한 곳"은 `tabs:activate`가 아니라 `showActiveTab`이다** (플랜과 편차 — 옳은 재배치). "화면에 세울 활성 탭이 크래시 상태면 reload" 한 분기가, 활성을 크래시 탭에 놓을 수 있는 경로 **전부**를 지나는 길목에 산다: 클릭 복구(tabs:activate)·reveal(revealExistingTab)·유일 탭 크래시(render-process-gone)·**마지막 산 탭 닫힘(closeTab — Task 1이 넘긴 경계, 별도 분기 없이 여기서 공짜로 덮인다)**·렌더러 자멸 정리(destroyed 훅). Task 1이 크래시 훅에 두었던 "전부 죽음이면 reload" 특례도 이 분기로 접었다 — 반증 ②에서 훅 경로 테스트(유일 탭 재시동)까지 같이 빨개지는 것이 통합의 켤레 증거다.
- **E2E는 1건이 아니라 2건** — 플랜의 표시+클릭 복구 1건에, 경계(마지막 산 탭을 닫아 크래시 탭만 남음 → 재시동) 1건을 더했다(e2e 164→166). 경계를 E2E로 문 이유: closeTab의 승계·reload는 electron 실물(webContents.close·reload) 없이는 안 돌고, 레지스트리 승계는 단위 11건이 이미 문다.
- **라벨 흐림은 opacity가 아니라 `--color-text-faint`다** — 경고 글리프가 이름 버튼 **안**에 살아서(표시를 보고 누르는 자리가 곧 복구 버튼) opacity면 글리프까지 같이 바랜다. 색 상속은 글리프의 자기 색(`--color-danger`)이 덮는다. E7g의 흐림도 대부분 faint 색이다(opacity-disabled는 disabled 전용).
- **harness 스크린샷 30초 인질 발견·수리** — close 직전 진단 스크린샷(firstWindow)이 끝 상태에서 숨은 뷰면 페인트하지 않아(E15c 스펙 §2) 캐시 프레임이 없을 때 30초를 다 기다렸다(표시·복구 테스트 31.5s 실측 — 형제 크래시+reload를 지난 세션은 캐시 프레임이 없더라). **제품 버그 아님을 프로브로 확인**: 숨은 A는 스크린샷 timeout이지만 다시 켜면 정상 페인트(129KB). `timeout: 5000`으로 상한(31.5s→6.5s).
- 반증 실측: ① 글리프 렌더 무력화 → `tab-crashed` 가시 단언 2곳(표시 테스트 :7132·경계 테스트 :7222)만 빨강, Task 1 두 건 초록. ② showActiveTab reload 분기 무력화 → 복구(repo-path 재등장) 단언 3곳(:7067 유일 탭·:7168 클릭 복구·:7257 경계)만 빨강, 승계만 무는 Task 1 ① 초록 — 죽은 뷰가 활성으로 서기만 하는 것(가시성 단언 통과)까지 설계대로.
- 게이트: lint 0/5w · typecheck 6/6 · `pnpm test` 708 · e2e **166 / 0**.

---

## 실행 기록 (Task 3)

### 태스크별 요약

- **Task 1** (`5faf361`): `render-process-gone` 감지 + 레지스트리 `crashed`(단위 11건) — 활성 크래시는 산 이웃 승계로 인질 해방, 전부 죽음이면 reload. E2E 2건. 편차 상세는 정정 절.
- **Task 2** (`82d0e5a`): TabBar 죽음 표시(faint 라벨+danger 글리프)·클릭 복구·`showActiveTab` 통합 reload 분기(닫기 경계까지 공짜로 덮음). E2E 2건(경계 1건 추가). 편차 상세는 정정 절.
- **Task 3** (이 커밋): 게이트 다섯 재확인 · 스크린샷 1장 · 이 기록.

### 플랜 오류/편차 판정

정정 절의 편차들 — 승계 위치(main 훅→레지스트리)·훅 앵커(`createRepoView`→`createTab`)·snapshot 노출(싣지 않음)·복구 "한 곳"(`tabs:activate`→`showActiveTab`)·E2E 수(3→4) — 을 놓고 보면, E15b·E15c 실행 기록의 관찰("**틀린 건 전부 읽지 않고 적은 것**")은 **이번에도 성립한다**. 앵커 줄 번호(`:408`·`:183`·`:388`)와 복구 분기의 자리는 코드를 다시 읽지 않고 기억으로 적은 것이고(플랜 스스로 "앵커는 실측 — 파일이 바뀌었을 수 있다"라고 자백까지 해 두었다), snapshot 노출은 snapshot이 영속 경계라는 역할(sanitize 파급)을 읽지 않은 것이다. 반대로 읽고 적은 것 — `forcefullyCrashRenderer`(E15c 리뷰 프로브2 실측 인용)·`removeTab` 오른쪽 우선 재사용·`did-finish-load`의 once/on 구분 — 은 전부 맞았다. 새 갈래 하나: **자기 설계의 함의를 끝까지 밀지 않은 오류** — "전부 죽음이면 reload"를 크래시 훅에만 두면 크래시 순간이 아닌 경로(마지막 산 탭 닫힘)가 새는데, 플랜은 이 경로를 못 봤고 Task 1이 경계로 명시해 넘겨 Task 2의 통합 분기가 덮었다. 뿌리는 같다 — 적기 전에 (코드든 자기 설계든) 끝까지 확인하지 않음.

### 이 에픽의 발견 (제품 밖)

- **harness 스크린샷 30초 인질** (상세·프로브는 Task 2 정정 절): 숨은 뷰는 페인트하지 않는다는 제품의 옳은 동작(E15c 스펙 §2)이 harness의 close 직전 진단 스크린샷과 만나 캐시 프레임이 없으면 30초를 다 기다렸다. E15c부터 잠복하다 "형제 크래시+reload를 지난 세션"(캐시 프레임 없음)에서 처음 발현 — 제품 버그 아님을 프로브로 확인하고 `timeout: 5000` 상한으로 수리(31.5s→6.5s).

### 최종 게이트 다섯

| 게이트 | 기대 | 실제 |
| --- | --- | --- |
| `pnpm lint` | 0 errors / 5 warnings | **0 errors / 5 warnings** ✅ |
| `pnpm typecheck` | 6/6 | **6/6** ✅ |
| `pnpm test` | 697+신규 | **708 passed / 56 files** (38.45s) — 알려진 git-adapter 플레이크(15000ms)는 이번 실행엔 없었다 |
| `pnpm --filter @git-gui/desktop build` | 성공 | **성공** ✅ (renderer 1,740.69 kB, 1.53s) |
| `pnpm --filter @git-gui/desktop e2e` | 165 / 0 (정정 후 166) | **166 passed / 0 failed** (4.7m) |

E15e가 더한 것: 단위 **+11**(697 → 708) · E2E **+4**(162 → 166).

**스크린샷**(Playwright 창 캡처 — OS 화면 캡처 아님): 탭 둘 중 비활성 탭이 죽음 표시(경고 글리프 + faint 라벨)된 산 탭바 — 활성 탭은 멀쩡히 변경·히스토리를 그리고 있다. 임시 스펙으로 촬영 후 스펙은 삭제.
