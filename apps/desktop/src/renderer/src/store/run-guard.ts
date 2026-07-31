/**
 * 스토어 작업의 두 갈래 — "저장소를 바꾸는 작업"과 "화면만 읽는 조회" (E14a).
 *
 * 왜 별도 모듈인가: repository-store.ts는 1678줄이고 git() IPC 브리지에 묶여 있어 단위 테스트가
 * 하나도 없다. 반면 이 두 함수는 (set, get, run)을 인자로 받아 스토어에 대해 순수하므로, 꺼내면
 * 가짜 set/get으로 테스트된다 — 이 저장소의 다른 순수 모듈 31개와 같은 패턴이다.
 *
 * 왜 갈랐는가 (사용자 제보: "파일 누르면 헤더부터 사이드바 전체가 깜빡인다"): 예전엔 guard 하나가
 * 조회에도 전역 busy를 켰다. busy는 렌더러 118곳에 스레드돼 있어, diff 하나 읽는 29ms 동안 헤더
 * 컨트롤 10개와 좌측 22개가 비활성이 됐다가 돌아왔다(실측: 헤더 속성 변형 30건). 더 나쁜 건
 * externalRefresh도 같은 경로라 **에디터에서 파일을 저장하기만 해도** 같은 일이 벌어졌다는 것이다
 * (실측: 헤더 변형 20건). E11이 버튼 색에 100ms 트랜지션을 걸어둔 탓에 29ms짜리 상태 변화가
 * 100ms에 걸쳐 번지며 더 잘 보였다.
 */

/** 조회 결과가 떨어지는 자리 — 액션이 아니라 화면 위치 기준이다(로딩을 보여줄 곳이 곧 그 자리다) */
export type ReadTarget = 'snapshot' | 'center' | 'right' | 'left' | 'reviews'

/** 대상 목록이 필요하면 createEmptyReads()의 키를 쓴다 — 정본을 하나로 둔다(죽은 export 방지) */
export function createEmptyReads(): Record<ReadTarget, number> {
  return { snapshot: 0, center: 0, right: 0, left: 0, reviews: 0 }
}

/** run-guard가 요구하는 최소 상태 — RepositoryStore가 이를 구조적으로 만족하므로 캐스팅이 없다 */
interface GuardState {
  busy: boolean
  error: string | null
  notice: string | null
  reads: Record<ReadTarget, number>
}

type GuardSet = (partial: Partial<GuardState>) => void
type GuardGet = () => GuardState

/** 작업 종료 후 이 시간 안의 감시 이벤트는 자기 작업의 꼬리로 보고 무시한다 (디바운스 300ms + 여유) */
export const WATCH_SUPPRESS_MS = 800

/** 마지막 쓰기 작업이 끝난 시각 — 감시발 재조회의 억제 창 기준 (E7b 실측 1: 트레일링 이벤트 흡수) */
let lastWriteEndAt = 0

export function isWithinSuppressWindow(now = Date.now()): boolean {
  return now - lastWriteEndAt < WATCH_SUPPRESS_MS
}

/** 억제 창을 즉시 닫는다 — 저장소를 새로 열 때(init) 이전 저장소의 꼬리를 끌고 오지 않게 한다 */
export function resetSuppression(): void {
  lastWriteEndAt = 0
}

/**
 * 대상별 최신 조회 번호. 조회는 겹쳐 돌 수 있으므로(전역 직렬화를 뺐다) 늦게 도착한 응답이
 * 최신 결과를 덮지 않게 막아야 한다 — HistoryPanel의 findSeqRef가 같은 문제를 같은 방식으로 푼다(E7i).
 */
const readSeq: Record<ReadTarget, number> = createEmptyReads()

/**
 * 진행 중인 모든 조회를 낡은 것으로 만든다 — 모든 target의 seq를 한 칸씩 올린다.
 *
 * 왜 1급 연산인가 (E14a 최종 리뷰 Blocking 2 · Important 1, 스펙 §2-4-2): seq는 target 안에서만
 * 도는데, 화면 상태를 갈아엎는 사건은 target 경계를 넘는다. 두 실측이 그걸 보였다 —
 * (1) `openRepository`가 도는 동안 옛 저장소의 조회가 끝나 **새 저장소 화면에 옛 저장소의 선택**이
 * 되살아났다, (2) 조회 중에 diff를 닫으면 in-flight 조회가 닫힌 선택을 되살렸다.
 * 두 경우 모두 "지금까지의 조회 결과는 전부 낡았다"가 정확한 의미라 무효화를 명시적으로 부른다.
 */
export function invalidateReads(): void {
  for (const target of Object.keys(readSeq) as ReadTarget[]) readSeq[target] += 1
}

/**
 * 저장소를 바꾸는 작업. 전역 busy로 직렬화하고, 시작할 때 error·notice를 지우며
 * (사용자가 뭔가 새로 시작했다는 신호다), 끝나면 억제 창을 무장한다.
 * 예전 guard(armSuppression=true)와 동작이 같다.
 *
 * 진입 시 invalidateReads()를 부르는 것만이 E14a에서 는 동작이다 — 쓰기는 상태를 갈아엎으므로
 * 그 전에 시작된 조회 결과는 전부 낡았다 (스펙 §2-4-2 B2). 재진입 거부로 되돌아가는 경우엔
 * 아무 일도 일어나지 않으므로 무효화도 하지 않는다.
 */
export async function runWrite(
  set: GuardSet,
  get: GuardGet,
  run: () => Promise<void>,
): Promise<boolean> {
  if (get().busy) return false
  invalidateReads()
  set({ busy: true, error: null, notice: null })
  try {
    await run()
    return true
  } catch (cause) {
    set({ error: toErrorMessage(cause) })
    return false
  } finally {
    lastWriteEndAt = Date.now()
    set({ busy: false })
  }
}

/**
 * 화면만 읽는 조회. 전역 busy를 건드리지 않고 대상별 카운터만 올렸다 내린다.
 * error·notice를 지우지 않고 억제 창도 무장하지 않는 것은 이제 구성상 저절로 지켜진다 —
 * E10이 armSuppression=false라는 인자로 표현하던 규칙이 함수가 나뉘면서 구조로 옮겨왔다.
 *
 * run에 isCurrent를 넘기는 이유: 결과를 스토어에 넣는 set()은 여기가 아니라 run 안에서 일어난다.
 * 그래서 runRead만으로는 늦게 온 응답을 막을 수 없다 — 느린 조회 A와 빠른 조회 B가 겹치면 B가
 * 먼저 떨어진 뒤 A가 다른 파일의 diff로 덮어쓴다. 지금까지는 busy 재진입 거부가 이 경합을 우연히
 * 막고 있었고, 그걸 빼는 순간 열린다. 호출부는 결과 set을 반드시 if (isCurrent())로 감싼다.
 *
 * target과 writes를 가른 이유 (스펙 §2-4-2 B1): target은 **표시용**(스피너가 뜰 자리)이고 writes는
 * **이 조회가 실제로 건드리는 상태**다. refresh는 target이 'snapshot'이지만 reviveSelections로
 * center·right 상태까지 쓴다 — 이때 writes를 안 넓히면 사용자가 그사이 누른 파일을 늦게 끝난
 * refresh가 되돌려 놓는다(실측: 마지막으로 누른 파일=b.txt인데 화면엔 a.txt). 그래서 writes의
 * 모든 seq를 올리고, isCurrent()는 **전부**에서 최신일 때만 참이다.
 */
export async function runRead(
  set: GuardSet,
  get: GuardGet,
  target: ReadTarget,
  run: (isCurrent: () => boolean) => Promise<void>,
  writes: ReadTarget[] = [target],
): Promise<boolean> {
  const claimed = writes.map((write) => [write, (readSeq[write] += 1)] as const)
  const isCurrent = () => claimed.every(([write, seq]) => seq === readSeq[write])
  // set이 함수형 갱신자를 안 받으므로(StoreSet은 Partial만 받는다) get()으로 읽어 펼친다.
  // get()과 set() 사이에 await가 없어 단일 스레드에서 안전하다
  set({ reads: { ...get().reads, [target]: get().reads[target] + 1 } })
  try {
    await run(isCurrent)
    return true
  } catch (cause) {
    if (isCurrent()) set({ error: toErrorMessage(cause) })
    return false
  } finally {
    set({ reads: { ...get().reads, [target]: get().reads[target] - 1 } })
  }
}

/**
 * IPC 에러 메시지의 Electron 래핑 접두사를 벗겨 사용자 메시지만 남긴다 (GitError 등 커스텀 이름 포함)
 *
 * repository-store.ts에 있던 것을 오류 처리와 같은 자리로 옮겼다 — 순수 함수이고, 이제 이 파일의
 * runWrite·runRead가 스토어 액션 50개의 오류 문구를 전부 만들어내는 자리이기 때문이다. 벗기지
 * 않으면 사용자가 보던 "저장할 게 없어요"가
 * "Error invoking remote method 'git:commit': Error: 저장할 게 없어요"가 된다 (E14a).
 */
export function toErrorMessage(cause: unknown): string {
  const message = cause instanceof Error ? cause.message : String(cause)
  return message.replace(/^Error invoking remote method '[^']+': (?:\w*Error: )?/, '')
}
