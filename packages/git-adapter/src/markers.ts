import { access } from 'node:fs/promises'
import { join } from 'node:path'
import type { GitDirMarkers } from '@git-gui/domain'

async function exists(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

export async function readGitDirMarkers(gitDir: string): Promise<GitDirMarkers> {
  const [mergeHead, rebaseMerge, rebaseApply, cherryPickHead, revertHead, bisectLog] =
    await Promise.all([
      exists(join(gitDir, 'MERGE_HEAD')),
      exists(join(gitDir, 'rebase-merge')),
      exists(join(gitDir, 'rebase-apply')),
      exists(join(gitDir, 'CHERRY_PICK_HEAD')),
      exists(join(gitDir, 'REVERT_HEAD')),
      exists(join(gitDir, 'BISECT_LOG')),
    ])
  return { mergeHead, rebaseMerge, rebaseApply, cherryPickHead, revertHead, bisectLog }
}
