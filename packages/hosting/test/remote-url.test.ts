import { describe, expect, it } from 'vitest'
import { parseRemoteUrl } from '../src/remote-url'

describe('parseRemoteUrl', () => {
  it('https — .git이 있어도 없어도 같은 좌표다', () => {
    expect(parseRemoteUrl('https://github.com/octo/hello.git')).toEqual({
      host: 'github.com',
      owner: 'octo',
      repo: 'hello',
    })
    expect(parseRemoteUrl('https://github.com/octo/hello')).toEqual({
      host: 'github.com',
      owner: 'octo',
      repo: 'hello',
    })
  })

  it('scp형 ssh — git@github.com:octo/hello.git', () => {
    expect(parseRemoteUrl('git@github.com:octo/hello.git')).toEqual({
      host: 'github.com',
      owner: 'octo',
      repo: 'hello',
    })
  })

  it('ssh:// 형태 — 포트·사용자 정보를 허용한다', () => {
    expect(parseRemoteUrl('ssh://git@github.com:22/octo/hello.git')).toEqual({
      host: 'github.com',
      owner: 'octo',
      repo: 'hello',
    })
  })

  it('호스트 대소문자는 소문자로 정규화하고 owner/repo 표기는 보존한다', () => {
    expect(parseRemoteUrl('https://GitHub.COM/Octo/Hello.git')).toEqual({
      host: 'github.com',
      owner: 'Octo',
      repo: 'Hello',
    })
  })

  it('비GitHub 호스트도 좌표는 파싱된다 — GitHub 여부는 호출자가 host로 판정한다', () => {
    expect(parseRemoteUrl('https://gitlab.com/team/proj.git')).toEqual({
      host: 'gitlab.com',
      owner: 'team',
      repo: 'proj',
    })
  })

  it('로컬 경로·빈 문자열·이해할 수 없는 형태는 null이다', () => {
    expect(parseRemoteUrl('/tmp/git-gui-e2e-remote-abc')).toBeNull()
    expect(parseRemoteUrl('')).toBeNull()
    expect(parseRemoteUrl('https://github.com/only-owner')).toBeNull()
    expect(parseRemoteUrl('not a url')).toBeNull()
  })
})
