# E10 외부 변경 감지 구현 플랜

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 앱 밖에서 파일이 바뀌면(에디터 되돌리기·파일 삭제·외부 편집) 수동 새로고침 없이 화면이 따라오게 한다.

**Architecture:** 순수 함수(굶지 않는 디바운스 + `.git/` 배제 필터) → main 워킹트리 감시 추가 → main 포커스 push → 렌더러 수신 → E2E.

**Tech Stack:** Electron main `fs.watch`, Vitest 순수 단위(가짜 타이머), Playwright Electron E2E.

**게이트 기준선(실측):** 루트 `pnpm test` **523** · `pnpm --filter @git-gui/desktop e2e` **100**(smoke 94 + hosting 6) · typecheck 6/6. **루트에 `build` 스크립트가 없다 — `pnpm --filter @git-gui/desktop build`.**

⚠️ **모든 Playwright 실행은 단일 포그라운드 Bash 호출 + `timeout: 600000`.** 기본 120초 제한에 걸려 자동 백그라운드되면 워크플로가 멈춘다. E8·E9에서 반복된 사고다.

**진단 근거(스펙 실측 재게):** 추적 안 된 파일 생성·삭제·추적 파일 수정은 `.git` 이벤트가 **0건**. `git checkout -- <file>`만 41ms 내 3건. 워킹트리 루트 감시 시 유휴 **0건** · 소스 1개 touch **1건** · 빌드 1회 **209건**(전부 gitignore 대상 `out/`). `git status --porcelain=v2`는 **20~100ms**.

---

### Task 1: 굶지 않는 디바운스 + `.git/` 배제 필터 (순수)

**Files:**
- Modify: `apps/desktop/src/main/watch-filter.ts`
- Test: `apps/desktop/test/watch-filter.test.ts`

기존 `createTrailingDebounce`는 hit이 계속 오면 **영원히 발화하지 않는다**. 개발 서버가 파일을 계속 쓰는 상황이 정확히 그 경우다. 최대 대기를 더한다. 이 함수는 `.git` 감시도 쓰므로 함께 개선된다.

- [x] **Step 1: 실패하는 테스트 먼저.** `watch-filter.test.ts`의 `describe('createTrailingDebounce', …)` 블록 안에 추가(이 파일은 `vi.useFakeTimers()` 관용을 이미 쓴다 — 실측 58~64행):

```ts
  it('hit이 계속 와도 maxWaitMs가 지나면 발화한다 — 개발 서버가 파일을 계속 쓰면 트레일링만으로는 굶는다', () => {
    const fire = vi.fn()
    const debounce = createTrailingDebounce(300, fire, 2000)
    // 100ms마다 hit — 트레일링 창(300)이 매번 갱신돼 혼자서는 영원히 발화하지 않는다
    for (let elapsed = 0; elapsed < 1900; elapsed += 100) {
      debounce.hit()
      vi.advanceTimersByTime(100)
    }
    expect(fire).not.toHaveBeenCalled()
    debounce.hit()
    vi.advanceTimersByTime(100)
    expect(fire).toHaveBeenCalledTimes(1)
  })

  it('maxWait 발화 후에는 새 사이클이다 — 다음 hit이 즉시 또 터지지 않는다', () => {
    const fire = vi.fn()
    const debounce = createTrailingDebounce(300, fire, 2000)
    for (let elapsed = 0; elapsed <= 2000; elapsed += 100) {
      debounce.hit()
      vi.advanceTimersByTime(100)
    }
    expect(fire).toHaveBeenCalledTimes(1)
    debounce.hit()
    vi.advanceTimersByTime(299)
    expect(fire).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(1)
    expect(fire).toHaveBeenCalledTimes(2)
  })

  it('maxWaitMs를 주지 않으면 기존 트레일링 동작 그대로다', () => {
    const fire = vi.fn()
    const debounce = createTrailingDebounce(300, fire)
    for (let elapsed = 0; elapsed < 5000; elapsed += 100) {
      debounce.hit()
      vi.advanceTimersByTime(100)
    }
    expect(fire).not.toHaveBeenCalled()
  })
```

그리고 `isRelevantGitEvent` describe 옆에 새 describe 추가:

```ts
describe('isWorkingTreeEvent', () => {
  it('워킹트리 파일을 받는다', () => {
    expect(isWorkingTreeEvent('src/app.ts')).toBe(true)
    expect(isWorkingTreeEvent('README.md')).toBe(true)
  })

  it('.git 아래는 버린다 — 전용 감시가 이미 본다(중복 발화 방지)', () => {
    expect(isWorkingTreeEvent('.git')).toBe(false)
    expect(isWorkingTreeEvent('.git/index')).toBe(false)
    expect(isWorkingTreeEvent('.git/refs/heads/main')).toBe(false)
  })

  it('.git으로 시작하는 다른 이름은 워킹트리 파일이다', () => {
    expect(isWorkingTreeEvent('.gitignore')).toBe(true)
    expect(isWorkingTreeEvent('.github/workflows/ci.yml')).toBe(true)
  })
})
```

`import` 줄에 `isWorkingTreeEvent`를 추가한다.

- [x] **Step 2: 실패 확인.** `npx vitest run apps/desktop/test/watch-filter.test.ts` — `isWorkingTreeEvent` 미정의로 실패하고, maxWait 테스트도 실패해야 한다. **출력을 그대로 보고한다.**

- [x] **Step 3: 구현.** `watch-filter.ts`의 기존:

```ts
/** 마지막 hit 후 delayMs가 지나면 fire를 1회 부른다 — git 한 명령의 이벤트 폭주를 묶는다 */
export function createTrailingDebounce(delayMs: number, fire: () => void): TrailingDebounce {
  let timer: ReturnType<typeof setTimeout> | null = null
  return {
    hit() {
      if (timer !== null) clearTimeout(timer)
      timer = setTimeout(() => {
        timer = null
        fire()
      }, delayMs)
    },
    dispose() {
      if (timer !== null) clearTimeout(timer)
      timer = null
    },
  }
}
```

교체:

```ts
/**
 * 마지막 hit 후 delayMs가 지나면 fire를 1회 부른다 — git 한 명령의 이벤트 폭주를 묶는다.
 * maxWaitMs를 주면 **첫 hit로부터** 그만큼 지났을 때 조용해지길 기다리지 않고 발화한다:
 * 트레일링만 있으면 개발 서버처럼 계속 쓰는 프로세스 앞에서 영원히 굶는다(E10).
 */
export function createTrailingDebounce(
  delayMs: number,
  fire: () => void,
  maxWaitMs?: number,
): TrailingDebounce {
  let timer: ReturnType<typeof setTimeout> | null = null
  let cycleStartedAt: number | null = null
  const clear = (): void => {
    if (timer !== null) clearTimeout(timer)
    timer = null
    cycleStartedAt = null
  }
  return {
    hit() {
      if (cycleStartedAt === null) cycleStartedAt = Date.now()
      const remaining =
        maxWaitMs === undefined ? delayMs : Math.min(delayMs, cycleStartedAt + maxWaitMs - Date.now())
      if (timer !== null) clearTimeout(timer)
      timer = setTimeout(
        () => {
          clear()
          fire()
        },
        Math.max(0, remaining),
      )
    },
    dispose: clear,
  }
}
```

⚠️ **`Date.now()`는 `vi.useFakeTimers()`가 함께 가짜로 만든다**(vitest 기본 `toFake`에 `Date` 포함). Step 1 테스트가 이 전제 위에 서 있으니, 만약 이 저장소 vitest 설정이 `Date`를 가짜로 만들지 않으면 **테스트가 통과하지 못한다 — 그때는 멈추고 보고하라.** 임의로 `performance.now()`나 실시간 대기로 바꾸지 말 것.

같은 파일 끝에 필터 추가:

```ts
/**
 * 워킹트리 감시 필터 (E10) — `.git` 아래는 전용 감시(isRelevantGitEvent)가 이미 본다.
 * **무시 목록을 두지 않는다**: 실측상 빌드 1회가 209 이벤트지만 디바운스가 재조회 1회로
 * 합치고 git status는 20~100ms다. .gitignore 의미론을 반쯤 흉내 내다 틀리는 쪽이 더 위험하다
 */
export function isWorkingTreeEvent(relativePath: string): boolean {
  return relativePath !== '.git' && !relativePath.startsWith('.git/')
}
```

- [x] **Step 4: 통과 확인 + 게이트.** 같은 vitest 명령 통과. 루트 `pnpm test` — **529**(523 + 신규 6). **실제 숫자를 보고한다** — 이 저장소는 `describe.each`로 테스트가 배로 느는 파일이 있어 예측이 빗나간 적이 있다(E9 실측).

- [x] **Step 5: Commit**

```bash
git add apps/desktop/src/main/watch-filter.ts apps/desktop/test/watch-filter.test.ts
git commit -m "feat(desktop): E10 굶지 않는 디바운스 + 워킹트리 이벤트 필터

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2: 워킹트리 감시 (main)

**Files:**
- Modify: `apps/desktop/src/main/repo-watcher.ts`
- Modify: `apps/desktop/src/main/git-handlers.ts`

- [x] **Step 1: `repo-watcher.ts`에 워킹트리 감시 추가.** 기존 `watchRepository`는 그대로 두고(`.git` 전용), 아래를 파일 끝에 추가한다. `import` 줄에 `isWorkingTreeEvent`를 더한다:

```ts
/** 워킹트리 이벤트는 파일 저장 한 번이 여러 건이라 묶고, 계속 쓰는 프로세스에 굶지 않게 상한을 둔다 */
const WORKTREE_MAX_WAIT_MS = 2000

/**
 * 저장소 루트(워킹트리)를 감시한다 (E10) — 파일 내용만 바뀌는 변화는 .git에 흔적이 없어
 * 기존 watchRepository로는 영원히 잡히지 않았다(실측: 추적 안 된 파일 생성·삭제·추적 파일
 * 수정 모두 .git 이벤트 0건). 실패는 기능 저하로만 — 던지지 않는다(watchRepository 관례)
 */
export function watchWorkingTree(rootPath: string, onChanged: () => void): () => void {
  const debounce = createTrailingDebounce(DEBOUNCE_MS, onChanged, WORKTREE_MAX_WAIT_MS)
  let watcher: FSWatcher | null = null
  try {
    watcher = watch(rootPath, { recursive: true }, (_type, file) => {
      if (file !== null && isWorkingTreeEvent(file.toString())) debounce.hit()
    })
    watcher.on('error', () => {
      watcher?.close()
      watcher = null
      debounce.dispose()
    })
  } catch {
    return () => {}
  }
  return () => {
    debounce.dispose()
    watcher?.close()
  }
}
```

- [x] **Step 2: `git-handlers.ts` 배선.** 기존(실측 142~164행) `repoWatch` 핸들러에서 `stopWatching` 하나만 쓰던 것을 **두 감시**로 바꾼다. 기존:

```ts
    stopWatching?.()
    const sender = event.sender
    stopWatching = watchRepository(gitDir, () => {
      if (!sender.isDestroyed()) sender.send(CHANNELS.repoChanged, path)
    })
    if (!watchCleanupHooked.has(sender)) {
      watchCleanupHooked.add(sender)
      sender.once('destroyed', () => {
        stopWatching?.()
        stopWatching = null
      })
    }
```

교체:

```ts
    stopWatching?.()
    const sender = event.sender
    const notify = (): void => {
      if (!sender.isDestroyed()) sender.send(CHANNELS.repoChanged, path)
    }
    // .git 감시는 HEAD·refs·상태 마커를, 워킹트리 감시는 파일 내용을 본다 — 목적이 달라 둘 다 필요하다 (E10)
    const stopGit = watchRepository(gitDir, notify)
    const stopTree = watchWorkingTree(path, notify)
    stopWatching = () => {
      stopGit()
      stopTree()
    }
    if (!watchCleanupHooked.has(sender)) {
      watchCleanupHooked.add(sender)
      sender.once('destroyed', () => {
        stopWatching?.()
        stopWatching = null
      })
    }
```

`import` 줄에 `watchWorkingTree`를 더한다.

- [x] **Step 3: 실측(필수) — 감시가 실제로 잡는지, 폭풍이 몇 번의 재조회가 되는지.** Playwright Electron 프로브로 실제 앱을 띄우고 저장소를 열어 다음을 **수치로** 보고한다:
  - (a) 앱 밖에서 추적 안 된 파일 생성 → 변경 목록에 뜨기까지 **ms**
  - (b) 그 파일 삭제 → 사라지기까지 **ms**
  - (c) 추적 파일 수정 → 뜨기까지 **ms**, 이어서 `git checkout --`로 되돌림 → 사라지기까지 **ms**
  - (d) **폭풍**: 저장소 안에서 파일 200개를 연속 생성(빌드 209 이벤트 재현) → 그동안 `externalRefresh`가 **몇 번** 불렸는지. **1~2회여야 한다.** 세는 방법은 스스로 정하되(예: 렌더러에 카운터를 노출) 방법을 보고에 적을 것.
  프로브는 측정 후 삭제.

- [x] **Step 4: 게이트.** typecheck · 루트 `pnpm test` 529 유지 · build · e2e **100 유지**(포그라운드, `timeout: 600000`). **자기 꼬리 억제 무회귀가 이 태스크의 최대 위험**이다 — 앱 내 작업(변경 취소·스태시 꺼내기)이 이제 워킹트리 이벤트를 낳는다. 기존 E2E가 깨지면 원인을 고친다(비활성·삭제 금지).

- [x] **Step 5: Commit**

```bash
git add apps/desktop/src/main
git commit -m "feat(desktop): E10 워킹트리 감시 — 파일만 바뀌는 변화도 따라온다

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

**Task 1·2 실행 편차 (소급 기록):** 없음 — 플랜의 코드·경로·숫자(529·100·`WATCH_SUPPRESS_MS` 800)가 전부 실측과 일치했다. 컨트롤러가 사전 확인한 가짜 타이머 전제(`vi.advanceTimersByTime(1000)` → `Date.now()` 정확히 +1000)도 성립.

**TDD 순서 증명(Step 2 실제 출력):** `isWorkingTreeEvent is not a function` ×3 + maxWait 2건 `expected "spy" to be called 1 times, but got 0 times` → **5 failed / 12 passed**. 구현 후 17/17.

**Step 3 실측(실제 앱, 렌더러 카운터 `window.__e10ExternalRefreshCount`):**

| 시나리오 | 반영까지 |
| --- | --- |
| 외부에서 추적 안 된 파일 생성 | **797ms** |
| 그 파일 삭제 | **797ms** |
| 추적 파일 수정 | **803ms** |
| `git checkout --`로 되돌림 | **806ms** |
| **파일 200개 폭풍** | `externalRefresh` **1회** (예상 1~2회) |

네 수치가 ~800ms에 몰린 건 디바운스(300ms)가 아니라 **macOS `fs.watch`(FSEvents)의 배치 지연이 지배적**이기 때문. 폭풍은 200 이벤트가 재조회 1회로 완전히 흡수됐다. 기존 E2E 100건 무회귀, 수정한 테스트 0건.

---

### Task 2-보완: 외부 재조회가 다음 외부 재조회를 막는다 (실측 발견)

**구현자가 프로브 중 발견하고 정직하게 보고한 결함.** 컨트롤러가 코드로 확인했다: `guard()`는 `finally`에서 **모든** 액션에 `lastGuardEndAt = Date.now()`를 찍는다(`repository-store.ts:389`). 그런데 `externalRefresh` 자신도 guard를 거친다. 따라서:

> 외부 변경 → `externalRefresh` 실행 → 종료 시 `lastGuardEndAt` 갱신 → **이후 800ms 안에 도착한 외부 변경은 조용히 버려진다**(`:487`).

**왜 심각한가:** 억제 창의 목적은 **앱 자신의 변경 액션** 직후 감시발 재조회가 방금 그린 화면을 다시 지우는 걸 막는 것이다. 읽기 전용 재조회가 다음 재조회를 막는 건 그 목적과 무관한 부작용이다. 게다가 위 실측대로 **FSEvents 지연이 ~800ms**라 억제 창과 거의 같아, 연속된 외부 편집의 두 번째가 **상시로** 누락된다 — 그리고 누락되면 다음 이벤트가 올 때까지 화면이 **영구히** 낡은 채로 남는다. 사용자 제보("업데이트가 안 된다")의 두 번째 원인이다.

구현자는 이를 "Task 3이 `refresh()`로 메우는 알려진 간극"으로 보고 손대지 않았다 — **판단은 합리적이나 결론은 틀렸다.** Task 3의 포커스 갱신은 **창을 떠났다 돌아올 때만** 동작한다. 앱을 보고 있는 채로 외부 편집이 이어지면 아무것도 메우지 못한다.

- [x] **Step 1: 읽기 전용 재조회는 억제 창을 무장하지 않는다.** `guard`에 억제 무장 여부를 넘길 수 있게 하고(기본은 지금처럼 무장), **`refresh`와 `externalRefresh`만 무장하지 않게** 한다. 두 함수는 스냅샷을 다시 뜰 뿐 저장소를 바꾸지 않으므로 자기 꼬리 이벤트를 낳지 않는다 — 애초에 억제할 대상이 아니다.
  구현 형태는 `guard`의 기존 시그니처·관용을 **실독**하고 그에 맞춘다(예: 4번째 선택 인자). `busy` 재진입 방어는 **그대로 유지**해야 한다 — 그건 다른 목적이다.

- [x] **Step 2: 회귀를 E2E로 고정.** 이 결함은 순수 함수가 아니라 스토어 배선에 있어 단위 테스트로 못 덮는다(이 저장소는 렌더러 단위 테스트 기반이 없다). **연속 외부 변경 2건**을 억제 창보다 짧은 간격으로 일으키고 **둘 다 반영되는지** 단언한다. Task 4의 E2E 3건에 이어 붙이되, 이 테스트는 **보완 이전 코드에서 반드시 실패**해야 한다 — 확인하고 결과를 보고할 것.

- [x] **Step 3: 자기 꼬리 억제 무회귀 확인(필수).** 이 변경의 위험은 반대 방향이다 — 앱 내 액션 직후 감시발 재조회가 화면을 되돌리는 현상이 되살아나면 안 된다. `WATCH_SUPPRESS_MS`가 지키던 그 시나리오(변경 취소·스태시 꺼내기 직후)를 기존 E2E와 수동 프로브로 확인하고 **본 것을 보고**한다.

- [x] **Step 4: 게이트** — typecheck · 루트 529 · build · e2e(포그라운드, `timeout: 600000`).

- [x] **Step 5: Commit**

```bash
git add apps/desktop/src/renderer/src/store/repository-store.ts apps/desktop/e2e/smoke.spec.ts
git commit -m "fix(desktop): E10 읽기 전용 재조회가 다음 외부 재조회를 막지 않게

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```



### Task 3: 포커스 갱신 (main → 렌더러)

**Files:**
- Modify: `packages/ipc-contract/src/index.ts`
- Modify: `apps/desktop/src/main/index.ts`
- Modify: `apps/desktop/src/preload/index.ts`
- Modify: `apps/desktop/src/renderer/src/store/repository-store.ts`

- [x] **Step 1: 채널.** `WINDOW_CHANNELS`(전체화면 push가 쓰는 그 객체 — **실독해 정확한 이름·위치를 확인**)에 `focused: 'window:focused'`를 더한다. `repo:*`가 아니라 `window:*`인 이유: 저장소가 아니라 **창** 사건이다(전체화면 push와 같은 계열).

- [x] **Step 2: main.** `index.ts`의 `createWindow()` 안, 기존 전체화면 push 옆(실측 59~64행)에 추가:

```ts
  // 창으로 돌아오면 재조회 — 감시가 못 잡은 잔여와 감시가 죽은 경우(watch error로 조용히 닫힘)를 메운다 (E10)
  window.on('focus', () => {
    window.webContents.send(WINDOW_CHANNELS.focused)
  })
```

- [x] **Step 3: preload.** 전체화면 구독과 **같은 관용**으로 `onWindowFocused(listener): () => void`를 노출한다. `preload/index.ts`의 전체화면 부분을 실독하고 그 형태를 그대로 따를 것(리스너 래핑·removeListener 반환).

- [x] **Step 4: 렌더러 구독.** `repository-store.ts`의 `init`에서 감시 구독 바로 아래(실측 437~440행 `git().repo.onChanged(…)`)에 추가:

```ts
    // 창 복귀 시 재조회 — 억제 창(WATCH_SUPPRESS_MS)을 일부러 무시한다. 사용자가 명시적으로
    // 돌아온 순간이라 최신화가 우선이고, 자기 꼬리 억제는 감시발 자동 재조회를 위한 장치다 (E10)
    window.api.onWindowFocused(() => {
      if (get().repoPath !== null) void get().refresh()
    })
```

⚠️ `externalRefresh`가 아니라 **`refresh`**를 부른다 — `externalRefresh`는 억제 창에 걸려 조용히 반환할 수 있다. 실제 API 이름·형태는 preload 실독에 맞춘다(위 `window.api` 표기는 예시).

- [x] **Step 5: 수동 확인(E2E로 못 덮는다).** 스펙이 밝힌 대로 E2E는 숨김 창이라 `focus` 이벤트가 오지 않는다. `pnpm --filter @git-gui/desktop dev`로 앱을 띄우고 저장소를 연 뒤: 앱 밖에서 파일을 수정 → 다른 앱으로 갔다가 → Git GUI로 돌아왔을 때 즉시 반영되는지 확인하고 **본 것을 그대로 보고**한다. 확인이 불가능하면 **불가능하다고 적을 것 — 덮었다고 말하지 말 것.**

- [x] **Step 6: 게이트.** typecheck(ipc-contract 포함 6/6) · 루트 529 · build · e2e 100.

- [x] **Step 7: Commit**

```bash
git add packages/ipc-contract apps/desktop/src
git commit -m "feat(desktop): E10 창 복귀 시 재조회 — 감시 사각지대를 메운다

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

**Task 2-보완 실행 결과:** `guard(set, get, run, armSuppression = true)`로 바꾸고 `finally`의 `lastGuardEndAt` 갱신을 조건부로. **`refresh`·`externalRefresh`만** `false`를 넘긴다 — 나머지 약 50개 호출부는 무변경(기본값이 기존 동작). 억제 **검사**(`:487`)는 그대로 두고 **무장**만 변이 액션으로 좁혔다.

**회귀 테스트가 무는지 증명:** 보완을 `git stash`로 되돌린 상태에서 신규 E2E가 **실패**(`Expected: "3", Received: "2"` — 두 번째 외부 변경이 조용히 유실). 되돌린 것을 복원하면 **통과**(3.4초). 공허하지 않다.

**반대 방향 확인(이 변경의 진짜 위험):** 억제 창이 지키던 시나리오 — 브랜치 전환(자동 보관 notice 표시) 직후 억제 창 안에서 외부 커밋을 일으키고, 400ms 뒤 **notice가 여전히 보이는지** 확인했다. 통과. 근거가 정확하다: `guard()`는 모든 호출 시작에서 `notice: null`을 찍으므로, 억제가 뚫렸다면 방금 그린 notice가 지워졌을 것이다. E7c 링크드 워크트리 테스트 등 같은 800ms 창에 의존하는 기존 테스트도 전부 통과.

**Task 3 실행 편차:** 브리핑의 `window.api`는 예시였고 실제는 **`window.windowApi`**였다(구현자가 `env.d.ts`·`App.tsx`의 기존 `onFullScreen` 사용처를 실독해 확인). `repository-store.ts`에 `git`/`hosting`과 같은 관용의 `windowApi()` 헬퍼를 추가했다.

**Task 3 수동 확인 — 하지 못했고, 그 판단이 옳았다:** 구현자가 포커스 확인을 위해 전체 화면 캡처를 시도했다가 **사용자의 무관한 창들(대화·다른 프로젝트·금액이 보이는 화면)이 함께 찍힌 것을 보고 즉시 삭제하고 그 접근을 중단**했다. 잘라내기로 우회하지 않은 것이 맞다. 또한 자신이 띄우지 않은 기존 Electron 프로세스는 건드리지 않았다. **"확인 못 했다"고 정직하게 보고했다** — 이후 Task 4가 프로그래밍 방식(`app.evaluate`로 main 프로세스의 `BrowserWindow.focus()` 호출)으로 이 간극을 닫는다.



### Task 4: E2E 3건 + 최종 게이트 + README

**Files:** `apps/desktop/e2e/smoke.spec.ts` · `README.md`

세 테스트 모두 **E10 이전 코드에서는 반드시 실패**한다(수동 새로고침 없이는 영원히 안 뜬다) — 회귀 검출력이 확실하다.

- [x] **Step 1: E2E 3건.** 기존 관용을 따른다: `createRepoWithChange()`, `check-unstaged-<이름>`→`stage-selected`, `GIT_GUI_USER_DATA` 격리. 파일 조작은 `node:fs/promises`의 `writeFile`/`rm`(이미 import돼 있는지 실독).

```ts
test('E10 — 앱 밖에서 만든 파일이 새로고침 없이 나타난다', async () => { … })
test('E10 — 앱 밖에서 지운 파일이 새로고침 없이 사라진다', async () => { … })
test('E10 — 앱 밖에서 되돌린 수정이 새로고침 없이 사라진다', async () => { … })
```

각각: 앱을 띄우고 목록이 안정된 뒤 → **앱 API를 쓰지 않고** `writeFile`/`rm`/`execGitOrThrow(['checkout','--',…])`로 저장소를 바꾼다 → `expect(...).toBeVisible()`/`toHaveCount(0)` 등으로 **폴링 단언**(Playwright가 자동 재시도한다 — `waitForTimeout` 고정 대기 금지). 세 번째는 수정→변경으로 뜸→`checkout --`→사라짐까지 한 흐름으로 본다.

- [x] **Step 2: 각 신규 테스트 `-g`로 2회씩** 돌려 비플레이키 확인, 결과를 붙인다. 디바운스 300ms + 감시 지연이 있어 **타이밍에 민감한 테스트**다 — 불안정하면 고정 대기를 넣지 말고 단언 타임아웃을 늘려라.

- [x] **Step 3: 최종 게이트.** typecheck 6/6 · 루트 **529** · build · smoke **97**(94+3) · e2e **103**(97+6) · `last-screen` 아티팩트 0건.

- [x] **Step 4: README.** 기존 E9 문장(**실독**) 뒤에 추가:

```markdown
E10: 앱 밖에서 파일이 바뀌면(에디터 되돌리기·파일 삭제·외부 편집) 새로고침 없이 화면이 따라옵니다. 창으로 돌아올 때도 다시 조회합니다.
```

- [x] **Step 5: Commit**

```bash
git add apps/desktop/e2e/smoke.spec.ts README.md
git commit -m "test(desktop): E10 E2E 3건 — 외부 생성·삭제·되돌림 + README

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

**Task 4 실행 결과 — 포커스 미검증 간극이 닫혔다.** 두 에이전트가 "확인 불가"로 넘겼던 항목을 `app.evaluate(({BrowserWindow}) => BrowserWindow.getAllWindows()[0].focus())`로 main 프로세스를 직접 몰아 검증했다(E9a의 CDP IME와 같은 계열의 해법). 영구 테스트로 추가.

**가는 길에 막힌 두 가지(둘 다 실측):** ① **contextBridge 노출 객체는 deep-freeze돼 있다** — `Object.isFrozen(gitApi.repo) === true`라 `repo.status`를 감싸 호출 횟수를 세려던 첫 시도가 조용히 무시돼 5초 타임아웃으로 실패했다. ② **이미 포커스된 창에 `focus()`를 다시 불러도 `'focus'`는 발화하지 않는다** — 전이(false→true)가 없으면 이벤트도 없다. `GIT_GUI_E2E_SHOW=1` 창이 생성 직후 이미 포커스인 경우가 있어, **`blur()`로 포커스 없음을 확정한 뒤 `focus()`**를 불러야 매번 확실한 전이가 만들어진다(격리 프로브로 4연속 재현).

**계측 방법(공허하지 않음의 근거):** 새로고침 버튼(`data-testid="refresh"`, `store.busy`에 `disabled`가 묶임)에 `MutationObserver`를 걸어 `disabled` 전이 횟수를 센다 — `guard()`가 `busy: true`로 도는 순간은 `refresh()`가 실제 실행됐다는 직접 증거다. **테스트 내내 파일을 전혀 건드리지 않으므로** 워킹트리 감시는 이 전이를 만들 수 없다. 재조회 후에도 `unstaged-count`가 `0` 그대로임을 함께 단언해 "화면은 안 바뀌었지만 재조회는 돌았다"는 신호만 남겼다.

**신규 4건 `-g` 2회씩 전부 통과(8/8, flake 0):** 생성 2.6s·2.6s / 삭제 2.6s·2.6s / 되돌림 2.6s·2.6s / 포커스 1.9s·2.4s.

**게이트 실측:** typecheck 6/6 · 루트 **529** · build 성공 · smoke **99**(95+4) · e2e **105** · `last-screen` 아티팩트 0건.

**미증명으로 남긴 것(정직 기록):** 신규 3건이 pre-E10 코드에서 실패함을 **리버트로 직접 증명하지는 않았다**(Task 1·2가 이미 들어간 상태였다). 대신 감시 소스를 읽어 세 시나리오가 `.git`에 흔적을 남기지 않음을 코드로 확인했고, 스펙의 독립 실측(0건)과 일치한다. `git checkout -- <file>`이 인덱스를 건드리지 않는 이유도 확인했다 — 인덱스는 이미 HEAD와 같고 워크디렉터리만 되돌리므로.



## 게이트 표 (누적)

| 시점 | 루트 테스트 | smoke | e2e 합 |
| --- | --- | --- | --- |
| 시작 | 523 | 94 | 100 |
| Task 1 후 | +6 → **529** | 94 | 100 |
| Task 2 후 | 529 유지 | 94 유지 | 100 유지 |
| Task 3 후 | 529 유지 | 94 유지 | 100 유지 |
| Task 2-보완 후 | 529 유지 | +1 → **95** | **101** |
| Task 4 후 | 529 | +4 → **99** | **105** |

## Self-Review (플랜 자체 점검)

1. **스펙 커버리지**: ①워킹트리 감시=T2(+필터 T1) · ②굶지 않는 디바운스=T1 · ③포커스 갱신=T3 · ④자기 꼬리 억제 관계=T2 Step 4 위험 명시 + T3 Step 4의 `refresh` 선택 근거. 에러표: 루트 소멸=`watch` error 핸들러(T2 Step 1) · 링크드 워크트리=`.git/` 접두 필터(T1) · 큰 저장소=T2 Step 3 (d) 폭풍 실측 · 저장소 전환=`stopWatching` 교체 유지(T2 Step 2) · 숨김 창 포커스=T3 Step 5 수동 확인 명시.
2. **자리표시자**: 없음. "실독하라"고 남긴 4곳(`WINDOW_CHANNELS` 위치·preload 전체화면 관용·`window.api` 실제 표기·README E9 문단 위치)은 **플랜이 단정하면 틀릴 수 있는 값**이라 의도적으로 지시로 남겼다. E2E 본문은 관용이 이미 확립돼 있어 시나리오와 금지사항(고정 대기 금지)을 지정했다.
3. **타입 정합**: `createTrailingDebounce`의 3번째 인자는 **선택**이라 기존 `.git` 감시 호출부(인자 2개)가 그대로 컴파일된다 — T1이 T2보다 먼저다. `isWorkingTreeEvent`는 T1에서 정의되고 T2가 소비한다.
4. **알려진 위험**: ① `Date.now()`가 가짜 타이머에 포함되지 않으면 T1 테스트가 통과 못 한다 → 멈추고 보고하도록 명시. ② 앱 자신의 워킹트리 쓰기가 자기 꼬리 이벤트를 늘린다 → T2 Step 4가 최대 위험으로 지목. ③ E2E 3건이 타이밍 민감 → 고정 대기 금지 + 타임아웃 조절로 지시.
