const pad = (n: number) => String(n).padStart(2, '0')

export function fmtDate(unixSeconds: number): string {
  const d = new Date(unixSeconds * 1000)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

export function fmtDateTime(unixSeconds: number): string {
  const d = new Date(unixSeconds * 1000)
  return `${fmtDate(unixSeconds)} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export function fmtInt(n: number): string {
  return n.toLocaleString('en-US')
}

export const shortSha = (oid: string) => oid.slice(0, 7)
