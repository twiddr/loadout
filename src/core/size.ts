// No imports: the sandboxed renderer bundles this file.

/** `900 B`, `48 KB` or `2.5 MB`. */
export function sizeText(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1048576) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / 1048576).toFixed(1)} MB`
}
