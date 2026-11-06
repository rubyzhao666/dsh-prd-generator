// dsh-prd-generator · Host 半边：注册模型工具和随包 skill。
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { createSkillProvider } from './skills.js'
import { TOOLS } from './tools.js'

const ROOT = fileURLToPath(new URL('..', import.meta.url))

export const name = 'prd-generator'
export const inject = ['tools', 'skills']

export function apply(ctx) {
  // 工具在 Host 进程里执行，不受模型 bash 的沙箱限制。
  for (const tool of TOOLS) ctx.effect(() => ctx.tools.register(tool))

  // 随包 skill：模型通过 skill 工具加载，用户也能在 skill 列表里看到。
  ctx.effect(() =>
    ctx.skills.registerProvider(() =>
      createSkillProvider({
        providerName: 'prd-generator',
        dirs: [join(ROOT, 'skills')],
        pluginRoot: ROOT,
      }),
    ),
  )
}
