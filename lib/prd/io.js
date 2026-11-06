// 文件落盘的小工具：保证目录存在、按顺序写文件、返回路径与字节数。

import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

export async function writeOutputFiles(dir, entries) {
  await mkdir(dir, { recursive: true })
  const files = []
  for (const entry of entries) {
    const path = join(dir, entry.fileName)
    const content = entry.content
    await writeFile(path, content, 'utf8')
    files.push({
      format: entry.format,
      path,
      bytes: Buffer.byteLength(content, 'utf8'),
    })
  }
  return files
}
