const VERSION_PATTERN = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/
const CHECKSUM_PATTERN = /^[a-fA-F0-9]{128}$/

function versionParts(version: string): { core: number[]; prerelease: string | null } | null {
  const normalized = version.startsWith('v') ? version.slice(1) : version
  if (!VERSION_PATTERN.test(normalized)) return null
  const [core, prerelease = null] = normalized.split('-', 2)
  return { core: core!.split('.').map(Number), prerelease }
}

function isNewer(candidate: string, current: string): boolean {
  const next = versionParts(candidate)
  const installed = versionParts(current)
  if (next === null || installed === null) return false

  for (let index = 0; index < 3; index += 1) {
    const difference = next.core[index]! - installed.core[index]!
    if (difference !== 0) return difference > 0
  }

  if (next.prerelease === installed.prerelease) return false
  if (next.prerelease === null) return true
  if (installed.prerelease === null) return false
  return next.prerelease.localeCompare(installed.prerelease, 'en', { numeric: true }) > 0
}

function getSha512(content: string): string | null {
  const checksum = content.trim().split(/\s+/, 1)[0]
  return checksum !== undefined && CHECKSUM_PATTERN.test(checksum) ? checksum.toLowerCase() : null
}

export const applicationUpdateRelease = {
  version: { isNewer },
  checksum: { getSha512 },
}
