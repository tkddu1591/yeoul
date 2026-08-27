import { describe, expect, it } from 'vitest'
import { applicationUpdateRelease } from '../src/main/application-update-release'

describe('applicationUpdateRelease.version', () => {
  it('현재 버전보다 높은 안정 버전만 새 버전으로 판단한다', () => {
    expect(applicationUpdateRelease.version.isNewer('v0.2.0', '0.1.9')).toBe(true)
    expect(applicationUpdateRelease.version.isNewer('0.1.9', '0.1.9')).toBe(false)
    expect(applicationUpdateRelease.version.isNewer('0.1.8', '0.1.9')).toBe(false)
  })

  it('같은 코어 버전에서는 안정 버전을 사전 버전보다 높게 본다', () => {
    expect(applicationUpdateRelease.version.isNewer('0.2.0', '0.2.0-beta.2')).toBe(true)
    expect(applicationUpdateRelease.version.isNewer('0.2.0-beta.3', '0.2.0-beta.2')).toBe(true)
    expect(applicationUpdateRelease.version.isNewer('0.2.0-beta.1', '0.2.0')).toBe(false)
  })

  it('지원하지 않는 버전 형식은 업데이트로 취급하지 않는다', () => {
    expect(applicationUpdateRelease.version.isNewer('latest', '0.1.0')).toBe(false)
    expect(applicationUpdateRelease.version.isNewer('0.2', '0.1.0')).toBe(false)
  })
})

describe('applicationUpdateRelease.checksum', () => {
  it('shasum 형식에서 SHA-512 값만 읽는다', () => {
    const checksum = 'a'.repeat(128)
    expect(
      applicationUpdateRelease.checksum.getSha512(`${checksum}  Yeoul-0.1.0-universal.dmg\n`),
    ).toBe(checksum)
  })

  it('SHA-512가 아니면 거부한다', () => {
    expect(applicationUpdateRelease.checksum.getSha512('not-a-checksum  Yeoul.dmg')).toBeNull()
    expect(
      applicationUpdateRelease.checksum.getSha512(`${'a'.repeat(64)}  Yeoul.dmg`),
    ).toBeNull()
  })
})
