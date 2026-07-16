import type { CommitSummary } from '@git-gui/domain'

/** 한 행의 그래프 렌더 정보 — 레인 index에 LANE_WIDTH를 곱해 x좌표를 얻는다 */
export interface GraphRow {
  /** 커밋 점이 놓이는 레인 */
  nodeLane: number
  /** 위에서 내려와 이 행을 그대로 지나가는 레인들 (점·합류 제외) */
  passLanes: number[]
  /** 위에서 내려온 선이 이 커밋 점으로 합류하는 레인들 (분기의 수렴) */
  joinLanes: number[]
  /** 점에서 아래로 뻗는 레인들 — 첫 부모 포함, root면 빈 배열 */
  forkLanes: number[]
  /** 이 행에서 거터 폭 계산에 쓸 레인 수 */
  laneCount: number
}

/**
 * log(최신순) 목록에 레인을 배정한다.
 * 각 레인은 "아래에서 만나기로 한 커밋 해시"를 기다린다 — 기다리던 커밋이 나타나면
 * 첫 레인이 점의 자리가 되고 나머지는 점으로 합류(join)한다. 첫 부모는 점의 레인을
 * 이어받고, 추가 부모는 기존 대기 레인으로 fork하거나 빈 레인을 재사용해 연다.
 */
export function buildGraph(commits: CommitSummary[]): GraphRow[] {
  const lanes: (string | null)[] = []
  const rows: GraphRow[] = []
  for (const commit of commits) {
    const before = [...lanes]
    const waiting: number[] = []
    for (let i = 0; i < before.length; i += 1) {
      if (before[i] === commit.hash) waiting.push(i)
    }
    let nodeLane: number
    if (waiting.length > 0) {
      nodeLane = waiting[0]!
    } else {
      const free = before.indexOf(null)
      nodeLane = free >= 0 ? free : before.length
    }
    while (lanes.length <= nodeLane) lanes.push(null)

    const passLanes: number[] = []
    for (let i = 0; i < before.length; i += 1) {
      if (before[i] !== null && before[i] !== commit.hash) passLanes.push(i)
    }
    const joinLanes = waiting.slice(1)
    for (const lane of joinLanes) lanes[lane] = null

    const forkLanes: number[] = []
    const firstParent = commit.parents[0] ?? null
    lanes[nodeLane] = firstParent
    if (firstParent !== null) forkLanes.push(nodeLane)
    for (const parent of commit.parents.slice(1)) {
      const existing = lanes.findIndex((hash, i) => hash === parent && i !== nodeLane)
      if (existing >= 0) {
        forkLanes.push(existing)
        continue
      }
      let lane = lanes.findIndex((hash, i) => hash === null && i !== nodeLane)
      if (lane < 0) {
        lanes.push(null)
        lane = lanes.length - 1
      }
      lanes[lane] = parent
      forkLanes.push(lane)
    }

    const laneCount = Math.max(before.length, lanes.length, nodeLane + 1)
    // 끝의 빈 레인은 다음 행부터 폭을 차지하지 않게 정리한다
    while (lanes.length > 0 && lanes[lanes.length - 1] === null) lanes.pop()

    rows.push({ nodeLane, passLanes, joinLanes, forkLanes, laneCount })
  }
  return rows
}
