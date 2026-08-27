/**
 * 화면 어휘 사전 (E8) — 개발자 표준 용어 한 벌.
 *
 * 왜 모으는가: 이 앱은 원래 "쉬운 말"(저장하기·실험 공간·보관함)을 썼고, 나중에 그것을
 * 다시 모드로 되살릴 계획이다. 문구를 컴포넌트에 하드코딩하면 그때 200곳을 다시 고쳐야 한다.
 * 여기 모아 두면 두 번째 표 + 토글로 끝난다.
 *
 * 넣는 것: 화면에 보이는 어휘·짧은 라벨(버튼·탭·패널 제목).
 * 넣지 않는 것: 안내 문장·확인창 본문 — 문장은 리터럴로 두고 그 안의 어휘만 보간한다
 * (문장까지 키로 만들면 i18n 시스템 규모가 된다 — YAGNI).
 */
export const T = {
  // 변경·커밋
  commit: '커밋',
  commitMessage: '커밋 메시지',
  unstaged: '변경 사항',
  staged: '스테이지',
  diff: 'Diff',
  // 브랜치·이력
  branch: '브랜치',
  history: '커밋 히스토리',
  head: '현재 위치',
  detached: '분리 HEAD',
  tag: '태그',
  // 원격
  pull: '가져와 반영',
  push: '푸시',
  fetch: '페치',
  noUpstream: '업스트림 없음',
  pullRequest: '풀 리퀘스트',
  approve: '승인',
  // 통합 작업
  merge: '병합',
  rebase: '리베이스',
  conflict: '충돌',
  revert: '되돌리기',
  undoCommit: '마지막 커밋 취소',
  cherryPick: '체리픽',
  // 보관·워크트리
  stash: '스태시',
  worktree: '워크트리',
  prunable: '정리 대상',
} as const

/** 사전 키 — 잘못된 키 참조를 컴파일 타임에 막는다 */
export type TermKey = keyof typeof T
