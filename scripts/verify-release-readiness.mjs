import { readFileSync } from 'node:fs'

const packageJson = JSON.parse(
  readFileSync(new URL('../apps/desktop/package.json', import.meta.url), 'utf8'),
)
const tag = process.argv[2] ?? process.env.GITHUB_REF_NAME

if (typeof tag !== 'string' || !/^v\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(tag)) {
  console.error(`릴리스 태그 형식이 아니에요: ${tag ?? '없음'} (예: v0.1.0)`)
  process.exit(1)
}

const expected = `v${packageJson.version}`
if (tag !== expected) {
  console.error(`태그(${tag})와 앱 버전(${expected})이 달라요.`)
  process.exit(1)
}

console.log(`릴리스 버전 확인 통과: ${tag}`)
