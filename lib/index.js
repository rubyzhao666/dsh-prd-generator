// dsh-prd-generator · Host 半边：注册模型工具、随包 skill，以及 /prd-generator/ 只读 PRD 项目页
// （供左侧栏「PRD 项目」iframe 使用）。
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { createSkillProvider } from './skills.js'
import { TOOLS } from './tools.js'
import { BASE, createHandler } from './web.js'

const ROOT = fileURLToPath(new URL('..', import.meta.url))

export const name = 'prd-generator'
export const inject = ['tools', 'skills', 'webServer']

export function apply(ctx) {
  // 工具在 Host 进程里执行，不受模型 bash 的沙箱限制。
  for (const tool of TOOLS) ctx.effect(() => ctx.tools.register(tool))

  // 只读 PRD 项目页：GET/HEAD /prd-generator/（列表）与 /prd-generator/p/<id>（详情）。
  // 数据来自本机 registry + 磁盘上的 prd.json，不写盘、不发起外部请求。
  ctx.effect(() =>
    ctx.webServer.register({
      kind: 'prefix',
      path: BASE,
      handler: createHandler(),
    }),
  )

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
