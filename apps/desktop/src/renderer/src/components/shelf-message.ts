/** git stash가 붙이는 "On <branch>: "/"WIP on <branch>: " 접두사를 배지용으로 분리한다 (E1a 이관) */
export function parseShelfMessage(message: string): { branch: string | null; text: string } {
  const match = /^(?:WIP on|On) ([^:]+): (.*)$/.exec(message)
  if (match === null) return { branch: null, text: message }
  return { branch: match[1]!, text: match[2]! }
}
