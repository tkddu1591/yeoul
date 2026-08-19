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

- [ ] **Step 1: 레지스트리 단위 테스트** — `setCrashed` 표시/해제·없는 탭 무해·`snapshot`/탭 목록에 실림·변화 없으면 무발화. 기존 25건 파일에 describe 추가. **실패 확인 후 구현.**
- [ ] **Step 2: main 훅.** `createRepoView`(`index.ts:408`)의 뷰 생성부에 배선 — 앵커는 실측(파일이 바뀌었을 수 있다):

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
- [ ] **Step 3: `did-finish-load`에서 해제.** 기존 `once('did-finish-load')`(`:183`)는 show용 1회다 — 해제는 **`on`**으로 따로 건다(reload마다 와야 한다). `registry.setCrashed(tabId, false)`.
- [ ] **Step 4: E2E 2건.** ① 탭 둘·활성 크래시(`page.evaluate`로 그 뷰의 webContents에 `forcefullyCrashRenderer()` — 리뷰 프로브2 방식: `app.evaluate`에서 `webContents.fromId(id).forcefullyCrashRenderer()`) → 산 이웃이 활성(`getVisible()`), 산 탭의 `tabs.list`에 `crashed: true` ② 유일 탭 크래시 → 자동 재시동(`repo-path`가 다시 뜬다). **수정 전 빨강 확인**(①은 지금 코드에서 죽은 뷰가 활성으로 남으므로 `getVisible()` 단언이 실패해야 한다 — 초록이면 보고).
- [ ] **Step 5: 반증** — 훅 제거→①② 빨강, 승계만 제거→①만 빨강. 게이트(697+신규 · e2e 164) 후 커밋.

### Task 2: 표시와 복구 — TabBar 죽음 표시 + activate의 reload 겸용 + reveal 정합

**Files:** `TabBar.tsx`+css · `index.ts`(`tabs:activate`·`revealExistingTab`) · `smoke.spec.ts`

- [ ] **Step 1: `tabs:activate`가 크래시 탭이면 reload 후 활성화.** reload는 비동기 재시동이므로 활성화는 즉시 하되 화면은 `did-finish-load`가 채운다(배경색이 흰 프레임을 막는다 — E15c Task 1 실측). `revealExistingTab`(`:388`)도 같은 분기 — **한 곳으로 모은다**(reveal과 activate가 다른 복구를 하면 안 된다).
- [ ] **Step 2: TabBar 죽음 표시.** `crashed`면 라벨 흐림 + 경고 글리프(기존 토큰 톤 — E7g의 흐림 관례를 먼저 읽는다). 툴팁/접근 이름에 "응답 없음 — 누르면 다시 열어요". testid `tab-crashed-<id>`.
- [ ] **Step 3: E2E 1건** — 탭 둘·비활성 크래시 → 산 탭바에 죽음 표시(`tab-crashed-<id>` 가시) → 클릭 → 되살아나 활성(`getVisible()` + `repo-path`) + 표시 걷힘(`toHaveCount(0)`).
- [ ] **Step 4: 반증** — 표시 렌더 제거→표시 단언만 빨강 · activate의 reload 분기 제거→복구 단언만 빨강. 게이트(e2e 165) 후 커밋.

### Task 3: 최종 게이트 + 실행 기록

- [ ] 게이트 다섯(lint·typecheck·test·build·e2e). 이 플랜 말미에 실행 기록(편차·반증 출력·숫자). README `§현재 상태` 한 줄. 커밋.

Expected 최종: lint 0/5w · 6/6 · **697+신규** · 성공 · **165 / 0**
