# E7k — 헤더 반응형 + 워크트리 HEAD 카드 보강 설계

2026-07-27 사용자 피드백: ① "헤더가 브랜치명이 길어질 때 너무 길어져서 전체 앱 가로 스크롤이 생긴다" ② "워크트리 탭 호버 시 `HEAD 9223ea`처럼 해시만 나온다 — 커밋 제목·마지막 저장 시각·(분리됨이면) 소속 브랜치까지 보고 싶다".

## 실측 배경 (프로브)

`.app__header`는 `app__repo` / `app__status` / `app__actions` 3열 flex다. 폭 1200px 창에서 측정:

- `app__actions` **683px**(버튼 7개 — 받아오기·보관함·리뷰·백업·새로고침·터미널·설정), `app__status` **394px**(브랜치 스위처 180 상한 + 합치기 + 상태 + ↑↓ 배지), 합 1077 + gap 40 + padding 100 = **1217 > 1200**.
- 그 결과 `app__repo`가 **폭 0**으로 뭉개져 저장소 이름·경로가 통째로 사라진다(1200px에서 이미).
- 창을 970px로 좁히면 더 줄일 곳이 없어 `headerScrollWidth 1059 > clientWidth 970`, **문서 전체가 가로 스크롤**(`documentElement.scrollWidth 1059`).

즉 긴 브랜치명은 방아쇠일 뿐이고, 근본 원인은 **헤더의 어떤 요소도 줄어들지 않는 것**이다.

## ① 헤더 반응형 — 가로 스크롤 근절

- **문서 스크롤 차단**: `.app`에 `overflow: hidden`. 앱 셸은 절대 스크롤되지 않고, 스크롤은 각 패널이 자기 영역에서만 갖는다(기존 가상 스크롤 규칙과 일치).
- **좁아지면 액션 라벨 접기**: 창 폭이 임계값 미만이면 헤더 액션·합치기 버튼이 **아이콘만** 남는다(텍스트 라벨과 `pull`·`merge` 배지 숨김). 이름은 E7j의 Tooltip이 이미 담당하므로 정보 손실이 없다. 실측 683px → 아이콘만일 때 약 260px.
  - 임계값 **1180px**(실측 1217 필요폭에서 repo 최소폭을 확보하는 지점). 판정은 App이 이미 가진 `viewportWidth` 상태(E6a `computeColumns` 입력)를 재사용한다 — 새 리스너·미디어쿼리 없음.
  - 접힘 상태는 `.app__header--compact` 클래스 하나로 표현하고, 라벨·배지 숨김은 CSS가 담당한다(컴포넌트 분기 최소화).
- **repo 블록 최소 폭**: `.app__repo`에 `min-width: 120px`을 줘 저장소 이름이 통째로 사라지지 않게 하고, 이름·경로는 말줄임(기존 `max-width: 380px`는 `min(380px, 100%)` 성격으로 유지).
- **브랜치 스위처 상한 반응형**: 기본 180px, compact에서는 **120px**.
- 접힘 임계 아래에서도 필요폭이 창을 넘으면(초소형 창) 헤더는 잘리되 **문서는 스크롤되지 않는다**(overflow hidden). 창 최소폭이 960px이므로 실사용에서는 도달하지 않는다.

## ② 워크트리 HEAD 카드 보강

E7j의 호버 지연 호출(`worktrees.forkPoint`)을 **`worktrees.headInfo(path)` 하나로 통합·확장**한다. 호출 횟수·캐시 규칙(`경로::HEAD` 키, 호버 시에만, 실패는 조용히 null)은 그대로다.

```ts
interface WorktreeHeadInfo {
  /** HEAD 커밋 제목(첫 줄) */
  subject: string
  /** HEAD 커밋 시각(epoch 초) — 상대 시각 표시는 렌더가 formatRelativeTime으로 */
  committedAt: number
  /** 이 커밋을 포함하는 로컬 브랜치들(최대 3개) — 분리됨 워크트리에서만 의미가 있다 */
  containedIn: string[]
  /** 포함 브랜치가 3개를 넘어 잘렸는가 */
  containedTruncated: boolean
  /** 기준 브랜치에서 갈라진 지점 — 없으면 null (E7j 규칙 그대로) */
  fork: ForkPoint | null
}
```

수집 명령(모두 워크트리 경로를 cwd로):
- `git log -1 --format=%s%x1f%ct` → subject·committedAt (실측: `제목\x1f1785101297`)
- `git branch --contains HEAD --format=%(refname:short)` → 포함 브랜치(줄 단위, 실측 확인). 4개 이상이면 3개까지만 담고 `containedTruncated: true`.
- fork는 E7j 로직(origin/HEAD→main→master 기준, merge-base 필수, 동일 SHA 가드) 그대로.

카드 표시:

```
wt-beta
/Users/…/worktree/pivot-session/dataworks-frontend
출처 .codex · HEAD 7ecf755 · 로그인 폼 검증 추가 · 3일 전
main에서 갈라짐 · 1개 앞섬 · 1개 뒤처짐
분리됨 — feature/login·main에 포함된 저장          ← 분리됨일 때만
```

- 제목·시각은 항상 표시(정보가 오기 전에는 그 조각만 생략).
- **포함 브랜치 줄은 분리됨(`branch === null`) 워크트리에서만** 낸다 — 브랜치가 있으면 제목 줄에 이미 있어 중복이다. 3개 초과면 `외 N개`.
- 제목이 길면 카드가 감싸 준다(`white-space: pre-wrap` 기존 규칙).

## 에러·엣지

| 상황 | 처리 |
| --- | --- |
| 커밋이 없는 워크트리(unborn) | `log -1` 실패 → headInfo 전체 null(카드는 경로·출처·상태만) |
| 폴더가 사라진 워크트리(prunable) | git 실행 자체가 실패 → null(기존 "폴더가 없어졌어요" 줄 유지) |
| 포함 브랜치 0개(고아 분리 HEAD) | 그 줄 생략 |
| compact 전환 중 팝오버·툴팁 열림 | 레이아웃 변화로 위치가 어긋날 수 있어 창 리사이즈 시 Tooltip은 이미 닫힌다(E7j) |
| 전체화면 전환(신호등 패딩 접힘) | `viewportWidth`가 갱신돼 compact 판정이 따라온다 |
| 최소 창(960px) | compact + overflow hidden으로 가로 스크롤 없음 |

## 테스트

- **순수 단위**: compact 판정 함수(임계값 경계 1179/1180/1181), 포함 브랜치 상한·`외 N개` 문구 조립.
- **엔진 단위**: `headInfo`의 subject·committedAt 파싱, contains 목록·상한·truncated, unborn 실패 시 null, fork 필드가 E7j 규칙 유지.
- **E2E**: ① 창 970px·1200px에서 `documentElement.scrollWidth === clientWidth`(가로 스크롤 0) ② 970px에서 액션 라벨이 접히고 아이콘 버튼이 여전히 눌리는지 ③ 분리됨 워크트리 호버 카드에 제목·시각·포함 브랜치 줄이 뜨는지.
- **무회귀**: E7j 워크트리·툴팁 E2E, E7f 타이틀바(헤더 드래그·전체화면 패딩) 전건.
- **스크린샷**: 좁은 창의 접힌 헤더 1장 — 컨트롤러 육안 + 사용자 확인.

## 범위 밖 (후속)

- 액션 오버플로 메뉴(⋯로 접기), 헤더 항목 사용자 정렬, 포함 브랜치 전체 목록 팝오버, 원격 브랜치까지 contains 조회, 워크트리 목록에 시각 컬럼 상시 표시.
