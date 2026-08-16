import { execFile } from 'node:child_process'

export const name = 'dsh-plugin-desktop-installer'
export const inject = ['webServer']

const GITHUB_SPEC = /^github:[A-Za-z0-9][A-Za-z0-9._-]*\/[A-Za-z0-9][A-Za-z0-9._-]*(?:#[^\s]+)?$/
const NPM_SPEC = /^(?:@[A-Za-z0-9][A-Za-z0-9._-]*\/)?[A-Za-z0-9][A-Za-z0-9._-]*(?:@[^\s]+)?$/
const PROFILE_SPEC = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/

function isValidSpec(value) {
  if (typeof value !== 'string') return false
  const s = value.trim()
  return GITHUB_SPEC.test(s) || NPM_SPEC.test(s)
}

function isValidProfile(value) {
  return typeof value === 'string' && PROFILE_SPEC.test(value)
    && value !== 'node_modules' && value !== '.' && value !== '..'
}

function sendJson(res, status, body) {
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.setHeader('Cache-Control', 'no-store')
  res.end(JSON.stringify(body))
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let raw = ''
    let overflow = false
    req.on('data', (chunk) => {
      if (overflow) return
      raw += chunk.toString('utf8')
      if (Buffer.byteLength(raw) > 4096) {
        overflow = true
        reject(new Error('请求内容过大'))
      }
    })
    req.on('end', () => {
      if (overflow) return
      try {
        resolve(JSON.parse(raw))
      } catch {
        reject(new Error('请求内容不是有效 JSON'))
      }
    })
    req.on('error', reject)
  })
}

function isLocal(req) {
  const address = (req.socket.remoteAddress ?? '').replace(/^::ffff:/i, '')
  return address === '::1' || address === '127.0.0.1'
}

export function apply(ctx) {
  const desktopRuntime = ctx.get('desktopRuntime')
  const desktopProfiles = ctx.get('desktopProfiles')
  const desktopPnpmBootstrap = ctx.get('desktopPnpmBootstrap')

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: '/api/dsh-plugin-installer/profiles',
    handler: async (req, res) => {
      if (req.method !== 'GET') {
        res.setHeader('Allow', 'GET')
        sendJson(res, 405, { ok: false, message: '仅支持 GET' })
        return
      }
      if (!isLocal(req)) {
        sendJson(res, 403, { ok: false, message: '拒绝跨来源请求' })
        return
      }
      const profiles = []
      let activeName
      if (desktopProfiles !== undefined) {
        try {
          const current = desktopProfiles.current
          if (current && typeof current.name === 'string') activeName = current.name
          const list = desktopProfiles.list()
          if (Array.isArray(list)) {
            for (const p of list) {
              if (p && typeof p.name === 'string') {
                profiles.push({ name: p.name, active: p.name === activeName, webCapable: p.webCapable === true })
              }
            }
          }
        } catch {
          // ignore discovery failures; fall through to defaults
        }
      }
      if (profiles.length === 0) {
        profiles.push({ name: 'desktop', active: true, webCapable: true })
        profiles.push({ name: 'web', active: false, webCapable: true })
      }
      sendJson(res, 200, { ok: true, profiles })
    },
  }), 'dsh-plugin-desktop-installer: profiles')

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: '/api/dsh-plugin-installer/restart',
    handler: async (req, res) => {
      if (req.method !== 'POST') {
        res.setHeader('Allow', 'POST')
        sendJson(res, 405, { ok: false, message: '仅支持 POST' })
        return
      }
      if (!isLocal(req)) {
        sendJson(res, 403, { ok: false, message: '拒绝跨来源请求' })
        return
      }
      if (desktopRuntime === undefined) {
        sendJson(res, 200, { ok: false, message: '当前运行环境没有 desktopRuntime（可能不是 DSH Desktop 桌面版）' })
        return
      }
      try {
        sendJson(res, 200, { ok: true, message: '正在重启 Desktop…' })
        desktopRuntime.requestRestart().catch(() => {})
      } catch (error) {
        sendJson(res, 200, { ok: false, message: error instanceof Error ? error.message : String(error) })
      }
    },
  }), 'dsh-plugin-desktop-installer: restart')

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: '/api/dsh-plugin-installer/install',
    handler: async (req, res) => {
      if (req.method !== 'POST') {
        res.setHeader('Allow', 'POST')
        sendJson(res, 405, { ok: false, message: '仅支持 POST' })
        return
      }
      if (!isLocal(req)) {
        sendJson(res, 403, { ok: false, message: '拒绝跨来源安装请求' })
        return
      }
      let body
      try {
        body = await readJson(req)
      } catch (error) {
        sendJson(res, 400, { ok: false, message: error instanceof Error ? error.message : String(error) })
        return
      }
      const spec = body && body.spec
      const profile = body && body.profile
      if (!isValidSpec(spec)) {
        sendJson(res, 400, { ok: false, message: '地址无效：应为 github:owner/repo#ref 或 npm 包名' })
        return
      }
      if (!isValidProfile(profile)) {
        sendJson(res, 400, { ok: false, message: 'profile 名称无效' })
        return
      }
      if (desktopPnpmBootstrap === undefined) {
        sendJson(res, 502, { ok: false, message: '当前环境缺少安装能力（需要 DSH Desktop 桌面版）' })
        return
      }

      const b = desktopPnpmBootstrap
      const trimmed = String(spec).trim()
      const inheritedPath = process.env.PATH ?? ''
      const env = {
        ...process.env,
        PATH: b.nodeBinDir ? `${b.nodeBinDir};${inheritedPath}` : inheritedPath,
        NODE: b.nodeShimPath,
        ELECTRON_RUN_AS_NODE: '1',
        DSH_HOME: b.homeDir,
        CI: 'true',
        npm_config_runtime: 'electron',
        npm_config_target: b.electronVersion,
        npm_config_disturl: 'https://electronjs.org/headers',
      }
      execFile(
        b.appExecutable,
        ['--expose-internals', b.dshBootstrapPath, 'plugin', '--profile', profile, 'add', trimmed],
        { cwd: b.activeProfileDir, encoding: 'utf8', windowsHide: true, env, maxBuffer: 8 * 1024 * 1024 },
        (error, stdout, stderr) => {
          const output = `${stdout ?? ''}\n${stderr ?? ''}`.slice(-8000)
          if (error) {
            sendJson(res, 502, { ok: false, message: error.message, output })
            return
          }
          sendJson(res, 200, { ok: true, profile, spec: trimmed, needsRestart: true, output })
        },
      )
    },
  }), 'dsh-plugin-desktop-installer: install')
}
