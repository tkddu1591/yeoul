import { describe, expect, it } from 'vitest'
import { detectState, type GitDirMarkers } from '../src/state'

const none: GitDirMarkers = {
  mergeHead: false,
  rebaseMerge: false,
  rebaseApply: false,
  cherryPickHead: false,
  revertHead: false,
  bisectLog: false,
}

describe('detectState', () => {
  it('마커가 없으면 normal', () => {
    expect(detectState(none)).toBe('normal')
  })

  it('MERGE_HEAD가 있으면 merging', () => {
    expect(detectState({ ...none, mergeHead: true })).toBe('merging')
  })

  it('rebase 디렉터리가 있으면 rebasing — merge 마커보다 우선', () => {
    expect(detectState({ ...none, rebaseMerge: true, mergeHead: true })).toBe('rebasing')
    expect(detectState({ ...none, rebaseApply: true })).toBe('rebasing')
  })

  it('CHERRY_PICK_HEAD가 있으면 cherry-picking', () => {
    expect(detectState({ ...none, cherryPickHead: true })).toBe('cherry-picking')
  })

  it('REVERT_HEAD가 있으면 reverting', () => {
    expect(detectState({ ...none, revertHead: true })).toBe('reverting')
  })

  it('BISECT_LOG가 있으면 bisecting', () => {
    expect(detectState({ ...none, bisectLog: true })).toBe('bisecting')
  })
})
