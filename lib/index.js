import { execFile } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

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

// In-box bundles ship with the profile template and are not third-party plugins.
const INBOX_BUNDLES = new Set([
  '@deepseek-ai/dsh-base',
  '@deepseek-ai/dsh-web-app',
  '@deepseek-ai/dsh-headless',
])

const PKG_NAME_RE = /^(@[A-Za-z0-9][A-Za-z0-9._-]*\/)?[A-Za-z0-9][A-Za-z0-9._-]*$/

function isValidPkgName(value) {
  return typeof value === 'string' && PKG_NAME_RE.test(value) && value !== 'node_modules'
}

function queryParam(url, key) {
  try {
    return new URL(url, 'http://localhost').searchParams.get(key)
  } catch {
    return null
  }
}

function profileDirFor(bootstrap, profile) {
  const home = (bootstrap && bootstrap.homeDir) || process.env.DSH_HOME || join(homedir(), '.dsh')
  return join(home, 'profiles', profile)
}

function readManifest(dir) {
  try {
    return JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'))
  } catch {
    return null
  }
}

/** Third-party plugins of one profile: dependencies minus in-box bundles, with their enabled state. */
function listThirdParty(dir) {
  const manifest = readManifest(dir)
  if (manifest === null) return []
  const deps = manifest.dependencies ?? {}
  const bundles = new Set(manifest.dsh?.profile?.bundles ?? [])
  const plugins = []
  for (const [name, spec] of Object.entries(deps)) {
    if (INBOX_BUNDLES.has(name)) continue
    plugins.push({ name, spec: String(spec), enabled: bundles.has(name) })
  }
  plugins.sort((a, b) => a.name.localeCompare(b.name))
  return plugins
}

/**
 * Persist the enabled flag by adding/removing the package name from
 * `dsh.profile.bundles` (the list the profile boots). `dsh plugin` reconciles
 * this list on the CLI, but enable/disable is a profile-manifest edit here so
 * a restart alone is enough.
 */
function setPluginEnabled(dir, name, enabled) {
  const manifest = readManifest(dir)
  if (manifest === null) return { ok: false, message: '读取 profile 的 package.json 失败' }
  const current = Array.isArray(manifest.dsh?.profile?.bundles) ? manifest.dsh.profile.bundles : []
  const bundles = new Set(current)
  if (enabled) bundles.add(name)
  else bundles.delete(name)
  if (manifest.dsh === undefined) manifest.dsh = {}
  if (manifest.dsh.profile === undefined) manifest.dsh.profile = {}
  manifest.dsh.profile.bundles = [...bundles]
  writeFileSync(join(dir, 'package.json'), `${JSON.stringify(manifest, null, 2)}\n`)
  return { ok: true }
}

/**
 * Run one authoritative `dsh plugin --profile <name> <add|remove> <target>`
 * through the packaged Electron CLI (RunAsNode), the same path the install
 * route uses.
 */
function runPluginCommand(bootstrap, profile, action, target, onDone) {
  const b = bootstrap
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
    ['--expose-internals', b.dshBootstrapPath, 'plugin', '--profile', profile, action, target],
    { cwd: b.activeProfileDir, encoding: 'utf8', windowsHide: true, env, maxBuffer: 8 * 1024 * 1024 },
    onDone,
  )
}

function readInstalledVersion(dir, name) {
  try {
    const manifest = JSON.parse(readFileSync(join(dir, 'node_modules', name, 'package.json'), 'utf8'))
    return typeof manifest.version === 'string' ? manifest.version : null
  } catch {
    return null
  }
}

function readDepSpec(dir, name) {
  const manifest = readManifest(dir)
  const spec = manifest?.dependencies?.[name]
  return typeof spec === 'string' ? spec : undefined
}

/** Pinned commits per `owner/repo` from the profile lockfile's codeload tarball URLs. */
function readLockCommits(dir) {
  const commits = new Map()
  try {
    const lock = readFileSync(join(dir, 'pnpm-lock.yaml'), 'utf8')
    for (const m of lock.matchAll(/codeload\.github\.com\/([^/\s]+\/[^/\s]+)\/tar\.gz\/([0-9a-f]{40})/g)) {
      commits.set(m[1].toLowerCase(), m[2])
    }
  } catch { /* no lockfile — no git installs to report */ }
  return commits
}

/** Extract `owner/repo` from github: specs and git+https://github.com/… URLs. */
function gitRepoOf(spec) {
  const s = String(spec)
  const short = /^github:([A-Za-z0-9][A-Za-z0-9._-]*\/[A-Za-z0-9][A-Za-z0-9._-]*)/.exec(s)
  if (short) return short[1].replace(/\.git$/, '')
  const url = /github\.com[/:]([A-Za-z0-9][A-Za-z0-9._-]*\/[A-Za-z0-9][A-Za-z0-9._-]*)/.exec(s)
  if (url) return url[1].replace(/\.git$/, '')
  return null
}

/** Numeric version parts, ignoring prefixes and prerelease/build suffixes. */
function versionParts(v) {
  return String(v).replace(/^[v=]/, '').split(/[^\d]/).filter(part => part !== '').map(Number)
}

/** True when `a` sorts strictly newer than `b` by numeric dotted parts. */
function isNewer(a, b) {
  const pa = versionParts(a)
  const pb = versionParts(b)
  const len = Math.max(pa.length, pb.length)
  for (let i = 0; i < len; i++) {
    const x = pa[i] ?? 0
    const y = pb[i] ?? 0
    if (x > y) return true
    if (x < y) return false
  }
  return false
}

async function fetchJson(url, headers, timeoutMs = 10000) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch(url, { headers, signal: controller.signal })
    if (!res.ok) return null
    return await res.json()
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

function githubHeaders() {
  const token = process.env.GITHUB_TOKEN
  const headers = { 'User-Agent': 'dsh-plugin-desktop-installer', Accept: 'application/vnd.github+json' }
  if (token) headers.Authorization = `Bearer ${token}`
  return headers
}

async function fetchNpmLatest(name) {
  const data = await fetchJson(`https://registry.npmjs.org/${name}/latest`, { Accept: 'application/json' })
  return data && typeof data.version === 'string' ? data.version : null
}

/** HEAD commit of a GitHub repo's default branch, via the latest-commit list. */
async function fetchGithubHead(repo) {
  const data = await fetchJson(`https://api.github.com/repos/${repo}/commits?per_page=1`, githubHeaders())
  return Array.isArray(data) && data.length > 0 && typeof data[0]?.sha === 'string' ? data[0].sha : null
}

/** Latest git tag of a repo (release name), or null when it has no tags. */
async function fetchGithubLatestTag(repo) {
  const data = await fetchJson(`https://api.github.com/repos/${repo}/tags?per_page=1`, githubHeaders())
  return Array.isArray(data) && data.length > 0 && typeof data[0]?.name === 'string' ? data[0].name : null
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

      const trimmed = String(spec).trim()
      runPluginCommand(desktopPnpmBootstrap, profile, 'add', trimmed, (error, stdout, stderr) => {
        const output = `${stdout ?? ''}\n${stderr ?? ''}`.slice(-8000)
        if (error) {
          sendJson(res, 502, { ok: false, message: error.message, output })
          return
        }
        sendJson(res, 200, { ok: true, profile, spec: trimmed, needsRestart: true, output })
      })
    },
  }), 'dsh-plugin-desktop-installer: install')

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: '/api/dsh-plugin-installer/installed',
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
      const profile = queryParam(req.url, 'profile')
      if (!isValidProfile(profile)) {
        sendJson(res, 400, { ok: false, message: 'profile 名称无效' })
        return
      }
      const dir = profileDirFor(desktopPnpmBootstrap, profile)
      sendJson(res, 200, { ok: true, profile, plugins: listThirdParty(dir) })
    },
  }), 'dsh-plugin-desktop-installer: installed')

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: '/api/dsh-plugin-installer/uninstall',
    handler: async (req, res) => {
      if (req.method !== 'POST') {
        res.setHeader('Allow', 'POST')
        sendJson(res, 405, { ok: false, message: '仅支持 POST' })
        return
      }
      if (!isLocal(req)) {
        sendJson(res, 403, { ok: false, message: '拒绝跨来源卸载请求' })
        return
      }
      let body
      try {
        body = await readJson(req)
      } catch (error) {
        sendJson(res, 400, { ok: false, message: error instanceof Error ? error.message : String(error) })
        return
      }
      const name = body && body.name
      const profile = body && body.profile
      if (!isValidPkgName(name)) {
        sendJson(res, 400, { ok: false, message: '插件名称无效' })
        return
      }
      if (!isValidProfile(profile)) {
        sendJson(res, 400, { ok: false, message: 'profile 名称无效' })
        return
      }
      if (desktopPnpmBootstrap === undefined) {
        sendJson(res, 502, { ok: false, message: '当前环境缺少卸载能力（需要 DSH Desktop 桌面版）' })
        return
      }
      const trimmed = String(name).trim()
      runPluginCommand(desktopPnpmBootstrap, profile, 'remove', trimmed, (error, stdout, stderr) => {
        const output = `${stdout ?? ''}\n${stderr ?? ''}`.slice(-8000)
        if (error) {
          sendJson(res, 502, { ok: false, message: error.message, output })
          return
        }
        sendJson(res, 200, { ok: true, profile, name: trimmed, needsRestart: true, output })
      })
    },
  }), 'dsh-plugin-desktop-installer: uninstall')

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: '/api/dsh-plugin-installer/set-enabled',
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
      let body
      try {
        body = await readJson(req)
      } catch (error) {
        sendJson(res, 400, { ok: false, message: error instanceof Error ? error.message : String(error) })
        return
      }
      const name = body && body.name
      const profile = body && body.profile
      const enabled = body && body.enabled === true
      if (!isValidPkgName(name)) {
        sendJson(res, 400, { ok: false, message: '插件名称无效' })
        return
      }
      if (!isValidProfile(profile)) {
        sendJson(res, 400, { ok: false, message: 'profile 名称无效' })
        return
      }
      const dir = profileDirFor(desktopPnpmBootstrap, profile)
      const manifest = readManifest(dir)
      if (manifest === null || !(name in (manifest.dependencies ?? {}))) {
        sendJson(res, 400, { ok: false, message: '该插件未安装在此 profile' })
        return
      }
      const result = setPluginEnabled(dir, name, enabled)
      if (!result.ok) {
        sendJson(res, 500, result)
        return
      }
      sendJson(res, 200, { ok: true, name, enabled, needsRestart: true, plugins: listThirdParty(dir) })
    },
  }), 'dsh-plugin-desktop-installer: set-enabled')

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: '/api/dsh-plugin-installer/check-updates',
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
      const profile = queryParam(req.url, 'profile')
      if (!isValidProfile(profile)) {
        sendJson(res, 400, { ok: false, message: 'profile 名称无效' })
        return
      }
      const dir = profileDirFor(desktopPnpmBootstrap, profile)
      const commits = readLockCommits(dir)
      const plugins = await Promise.all(listThirdParty(dir).map(async (p) => {
        const repo = gitRepoOf(p.spec)
        const type = repo !== null ? 'github' : 'npm'
        let installed = null
        let latest = null
        let ref = null // 'tag' | 'commit' | null
        let error = null
        if (type === 'github') {
          // Prefer tag-based version numbers when the repo publishes tags;
          // otherwise fall back to lockfile commit vs default-branch HEAD.
          const installedVersion = readInstalledVersion(dir, p.name)
          const latestTag = await fetchGithubLatestTag(repo)
          if (latestTag !== null && installedVersion !== null) {
            installed = installedVersion
            latest = latestTag.replace(/^[vV]/, '')
            ref = 'tag'
          } else {
            installed = commits.get(repo.toLowerCase()) ?? null
            latest = await fetchGithubHead(repo)
            ref = 'commit'
          }
        } else {
          installed = readInstalledVersion(dir, p.name)
          latest = await fetchNpmLatest(p.name)
        }
        if (latest === null && error === null) error = '无法获取最新版本'
        const hasUpdate = installed !== null && latest !== null
          && (ref === 'commit' ? installed !== latest : isNewer(latest, installed))
        return { name: p.name, spec: p.spec, enabled: p.enabled, type, installed, latest, ref, hasUpdate, error }
      }))
      sendJson(res, 200, { ok: true, profile, plugins })
    },
  }), 'dsh-plugin-desktop-installer: check-updates')

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: '/api/dsh-plugin-installer/update',
    handler: async (req, res) => {
      if (req.method !== 'POST') {
        res.setHeader('Allow', 'POST')
        sendJson(res, 405, { ok: false, message: '仅支持 POST' })
        return
      }
      if (!isLocal(req)) {
        sendJson(res, 403, { ok: false, message: '拒绝跨来源更新请求' })
        return
      }
      let body
      try {
        body = await readJson(req)
      } catch (error) {
        sendJson(res, 400, { ok: false, message: error instanceof Error ? error.message : String(error) })
        return
      }
      const name = body && body.name
      const profile = body && body.profile
      if (!isValidPkgName(name)) {
        sendJson(res, 400, { ok: false, message: '插件名称无效' })
        return
      }
      if (!isValidProfile(profile)) {
        sendJson(res, 400, { ok: false, message: 'profile 名称无效' })
        return
      }
      if (desktopPnpmBootstrap === undefined) {
        sendJson(res, 502, { ok: false, message: '当前环境缺少更新能力（需要 DSH Desktop 桌面版）' })
        return
      }
      const dir = profileDirFor(desktopPnpmBootstrap, profile)
      const spec = readDepSpec(dir, name)
      if (spec === undefined) {
        sendJson(res, 400, { ok: false, message: '该插件未安装在此 profile' })
        return
      }
      // Re-running add re-resolves the source: git HEAD for github specs,
      // dist-tag latest for registry installs.
      const target = spec.startsWith('github:') ? spec.replace(/#.*$/, '') : `${name}@latest`
      runPluginCommand(desktopPnpmBootstrap, profile, 'add', target, (error, stdout, stderr) => {
        const output = `${stdout ?? ''}\n${stderr ?? ''}`.slice(-8000)
        if (error) {
          sendJson(res, 502, { ok: false, message: error.message, output })
          return
        }
        sendJson(res, 200, { ok: true, profile, name, needsRestart: true, output })
      })
    },
  }), 'dsh-plugin-desktop-installer: update')
}
