# E7i — 히스토리 ⌘F 전체 검색 설계 (git 위임)

2026-07-25 사용자 피드백: "트리 검색할 때 하단 리스트에 있는 건 검색이 안 되고, 트리를 내려야 거기서 걸린다 — 검색이 다 걸려야 할 것 같은데."

**원인(실측)**: 히스토리는 첫 50개만 불러오고 스크롤 바닥에서 200개씩 추가로 불러온다(`HISTORY_LIMIT=50`·`HISTORY_PAGE=200`·`HISTORY_MAX=10000`, repository-store.ts). E7h ⑥의 히스토리 ⌘F는 **그 시점까지 로드된 `history` 배열만** 매칭한다(HistoryPanel `findTexts()`) — 아직 안 불러온 아래쪽 커밋은 검색에 안 걸리고, 스크롤로 로드되어야 잡힌다.

**범위**: 히스토리 패널 ⌘F만. 실험 공간 트리 검색·커밋 상세 파일 필터·변경 목록 필터·diff 검색은 이미 전체 대상이라 무변.

## ① 엔진 — `history.search`

```ts
/** 히스토리 전체 검색 (E7i) — 목록에 아직 안 불러온 커밋까지 git이 찾는다.
 *  indices는 history.list와 같은 정렬(--date-order·같은 스코프) 기준 위치다 */
search(query: string, ref?: string): Promise<HistorySearchResult>

interface HistorySearchResult {
  /** 매치 커밋의 목록 순서 위치(오름차순) */
  indices: number[]
  /** indices와 같은 순서의 커밋 해시 */
  hashes: string[]
  /** 순서 스캔 상한(SEARCH_SCAN_MAX)에 걸려 뒤쪽을 못 본 경우 true */
  truncated: boolean
}
```

구현(두 번의 `git log`, 스코프 인자는 `history.list`와 **동일**하게 구성 — `--date-order`, ref 없으면 `--exclude=refs/stash|notes|replace` + `--all`, ref 있으면 `--end-of-options <ref>`):

1. **순서 스캔**: `git log <스코프> --date-order --format=%H --max-count=<SEARCH_SCAN_MAX>` → 해시 배열 → `해시→인덱스` Map.
2. **매치**: `git log <스코프> --date-order -i -F --grep=<query> --format=%H` → 매치 해시들. `-F`(고정 문자열)라 정규식 메타문자가 들어와도 오류·오작동이 없다. `--grep`은 제목+본문 전체를 본다(현재 UI는 제목만 매칭 — 상위 호환).
3. **해시 접두**: query가 `^[0-9a-fA-F]{4,40}$`이면, Map의 키 중 그 접두로 시작하는 해시도 매치에 합친다(현재 UI가 해시로도 찾으므로 동등 유지).
4. 매치 해시를 Map으로 인덱스화 → 오름차순 정렬 → 반환. Map에 없는 매치(스캔 상한 밖)는 버리고 `truncated: true`.

`SEARCH_SCAN_MAX = 50000` (그 이상은 `truncated`로 알린다 — 순서 스캔 비용 상한).

빈 query(`''`)는 git을 부르지 않고 `{ indices: [], hashes: [], truncated: false }`.

## ② IPC·store

- ipc-contract `GitApi.history.search(repoPath, query, ref?)` 추가(기존 `history.list` 옆), preload·main 핸들러 동일 패턴(`assertString` 검증).
- store에 `searchHistory(query): Promise<HistorySearchResult>` 추가 — `repoPath`·`historyRef`를 store가 넣어준다(호출부가 스코프를 신경 쓰지 않게). **guard를 쓰지 않는다**(검색은 busy 잠금·에러 배너 대상이 아니다 — 실패 시 빈 결과 반환, 조용히).
- 점프용 로드: `ensureHistoryLoaded(index): Promise<void>` — `index < history.length`면 no-op, 아니면 `historyLimit`을 `index+1` 이상(HISTORY_PAGE 배수로 올림, 상한 `SEARCH_JUMP_MAX = 50000`)으로 올려 스코프 유지 재조회(loadMoreHistory와 같은 규약: 조회 중이면 ref 유지, 사라졌으면 조용히 전체 그래프 복귀).

## ③ UI — HistoryPanel

- 로컬 매칭(`findTexts`/`matchIndices`) **폐기**, 엔진 결과를 상태로 보유: `{ query, indices, truncated }`.
- 입력은 **200ms 디바운스** + **요청 순번(seq)** — 늦게 온 응답은 버려 타이핑 중 카운터 역전·깜빡임을 막는다. 쿼리가 바뀌면 위치는 0으로.
- 카운터는 **저장소 전체 기준 `현재/총`**. `truncated`면 총계 뒤에 `+`(예: `3/128+`).
- 다음/이전(Enter·↑↓·버튼): 목표 인덱스가 로드 범위 밖이면 `ensureHistoryLoaded(index)` 후 `scrollToIndex(index, {align:'center'})`. 하이라이트(`history-item--find-hit`)는 현재 매치 인덱스 기준(기존과 동일).
- 검색 중 스냅샷 갱신(감시·fetch)으로 목록이 바뀌면 **같은 쿼리로 재검색**(인덱스가 밀릴 수 있다). 위치는 `Math.min` 클램프.
- 조회(historyRef) 전환·해제 시에도 같은 쿼리로 재검색(스코프가 바뀌므로).
- ESC·✕ 닫기, `focusSignal`(E7h 보완) 등 기존 FindBar 규약 무변.

## 에러·엣지

| 상황 | 처리 |
| --- | --- |
| 검색 중 git 실패(손상 저장소 등) | 조용히 빈 결과(`0/0`) — 에러 배너 없음(검색은 조회성) |
| 매치가 스캔 상한 밖 | `truncated`로 `+` 표기 — 찾은 범위 안에서는 정상 점프 |
| 점프 목표가 `SEARCH_JUMP_MAX` 밖 | 그 매치로는 이동하지 않고 카운터만 유지(현실적으로 도달 불가 규모) |
| 조회 중(historyRef) 검색 | 그 계보로 스코프 — 목록과 항상 같은 대상 |
| 검색 도중 저장소·워크트리 전환 | seq로 이전 응답 폐기 + 쿼리 초기화(FindBar 닫힘은 기존 규약대로) |
| 대소문자 | 무시(`-i`) — 기존 로컬 매칭과 동일 |
| 특수문자(`*`, `(` 등) | `-F`로 고정 문자열 — 오류·오작동 없음 |

## 테스트

- **엔진 단위**(git-adapter): 메시지 매치·대소문자 무시·고정 문자열(정규식 메타 포함)·해시 접두·본문 매치·ref 스코프(다른 계보 커밋 제외)·인덱스가 `history.list` 순서와 일치·빈 쿼리 no-op.
- **E2E 2건**: ① 커밋 60+개 픽스처에서 **로드 범위 밖(초기 50개 밖)** 커밋을 ⌘F로 찾아 점프(하이라이트 확인) ② 카운터가 전체 기준(로드된 수보다 큰 총계) 표기.
- **무회귀**: E7h ⌘F 5건(diff·커밋 상세·변경 목록·hover 라우팅 포함) 그대로 통과.
- **플랜 사전 실측**: `history.list`의 스코프 인자 전체(정확 복제용), `git log -F --grep` 동작(본문 매치·대소문자), 60커밋 픽스처 생성 비용, store의 loadMoreHistory 재조회 규약.

## 범위 밖 (후속)

- 작성자·날짜·파일 경로 검색 필터, 검색 결과 목록형 표시(현재는 점프형), diff 패널의 파일 간 이어 찾기, 검색 히스토리, 정규식 옵션.
