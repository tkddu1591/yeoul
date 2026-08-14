import { describe, expect, it } from 'vitest'
import { tabLabels } from '../src/renderer/src/components/tab-labels'

describe('tabLabels', () => {
  it('마지막 폴더명이 라벨이다', () => {
    expect(tabLabels(['/Users/a/git-gui', '/tmp/api'])).toEqual(['git-gui', 'api'])
  })

  it('null은 새 탭', () => {
    expect(tabLabels([null])).toEqual(['새 탭'])
  })

  it('동명이면 구분되는 부모가 붙는다', () => {
    const labels = tabLabels(['/work/client/app', '/work/server/app'])
    expect(labels[0]).not.toBe(labels[1])
    expect(labels[0]).toContain('client')
    expect(labels[1]).toContain('server')
  })

  it('동명 셋도 전부 서로 다르다', () => {
    const labels = tabLabels(['/a/x/repo', '/a/y/repo', '/b/x/repo'])
    expect(new Set(labels).size).toBe(3)
  })

  it('빈 탭이 섞여도 저장소 라벨과 자리가 어긋나지 않는다', () => {
    expect(tabLabels(['/tmp/api', null, '/tmp/web'])).toEqual(['api', '새 탭', 'web'])
  })
})
