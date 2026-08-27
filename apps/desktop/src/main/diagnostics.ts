import { app, crashReporter } from 'electron'
import { appendFileSync, mkdirSync, renameSync, statSync } from 'node:fs'
import { join } from 'node:path'

const MAX_LOG_BYTES = 1024 * 1024

interface DiagnosticEntry {
  area: 'application' | 'git' | 'renderer' | 'update'
  message: string
  detail?: string
}

function directoryPath(): string {
  return join(app.getPath('userData'), 'diagnostics')
}

function logPath(): string {
  return join(directoryPath(), 'runtime.log')
}

function rotateLog(): void {
  const current = logPath()
  try {
    if (statSync(current).size < MAX_LOG_BYTES) return
    renameSync(current, join(directoryPath(), 'runtime.previous.log'))
  } catch {
    // 첫 기록·동시 종료 등 진단 자체의 실패는 앱을 막지 않는다.
  }
}

function writeEntry(entry: DiagnosticEntry): void {
  try {
    mkdirSync(directoryPath(), { recursive: true, mode: 0o700 })
    rotateLog()
    const detail = entry.detail === undefined ? '' : `\n${entry.detail}`
    appendFileSync(
      logPath(),
      `[${new Date().toISOString()}] [${entry.area}] ${entry.message}${detail}\n`,
      { encoding: 'utf8', mode: 0o600 },
    )
  } catch {
    // 진단 기록은 본 기능보다 낮은 우선순위다. 디스크 오류를 다시 예외로 만들지 않는다.
  }
}

function startCollection(): void {
  const crashDirectory = join(directoryPath(), 'crashes')
  try {
    mkdirSync(crashDirectory, { recursive: true, mode: 0o700 })
    app.setPath('crashDumps', crashDirectory)
    crashReporter.start({
      productName: 'Yeoul',
      uploadToServer: false,
      compress: true,
      globalExtra: {
        channel: app.isPackaged ? 'release' : 'development',
      },
    })
  } catch (cause) {
    writeEntry({
      area: 'application',
      message: 'Crashpad 초기화 실패',
      detail: cause instanceof Error ? cause.stack : String(cause),
    })
  }

  // 기본 uncaughtException 종료 동작을 바꾸지 않고 기록만 관찰한다.
  process.on('uncaughtExceptionMonitor', (cause) => {
    writeEntry({ area: 'application', message: cause.message, detail: cause.stack })
  })
}

export const diagnostics = {
  collection: { start: startCollection },
  entry: { write: writeEntry },
  directory: { getPath: directoryPath },
}
