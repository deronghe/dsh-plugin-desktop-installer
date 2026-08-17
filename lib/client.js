window.__ModuleLoader__.load({ id: 'dsh-plugin-desktop-installer', factory: (require) => {
  const module = { exports: {} }
  const exports = module.exports
  const React = require('react')
  const { Button } = require('@deepseek-ai/dsh-client-ui-primitives')

  const CSS = [
    '.dxi-action{display:flex;min-width:0;align-items:center;gap:8px}',
    '.dxi-action-error{max-width:180px;overflow:hidden;color:var(--dsw-alias-state-error-primary);font-size:12px;line-height:18px;text-overflow:ellipsis;white-space:nowrap}',
    '.dxi-install{display:grid;gap:12px;padding:8px 2px;color:var(--dsw-alias-label-primary);font-size:13px}',
    '.dxi-hint{margin:0;color:var(--dsw-alias-label-secondary);font-size:12px;line-height:18px}',
    '.dxi-row{display:flex;align-items:center;gap:8px;flex-wrap:wrap}',
    '.dxi-input,.dxi-select{box-sizing:border-box;height:34px;border:1px solid var(--dsw-alias-border-l1);border-radius:6px;padding:0 10px;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-base);font:inherit;font-size:13px}',
    '.dxi-input{flex:1 1 220px;min-width:0}',
    '.dxi-select{min-width:150px}',
    '.dxi-label{color:var(--dsw-alias-label-secondary);font-size:12px;white-space:nowrap}',
    '.dxi-status{padding:8px 10px;border-radius:6px;font-size:12px;line-height:18px;border:1px solid var(--dsw-alias-border-l1)}',
    '.dxi-ok{color:var(--dsw-alias-state-success-primary)}',
    '.dxi-err{color:var(--dsw-alias-state-error-primary)}',
    '.dxi-output{margin:0;max-height:140px;overflow:auto;padding:8px 10px;border-radius:6px;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-secondary);font-size:11px;line-height:16px;white-space:pre-wrap;word-break:break-word}',
    '.dxi-list{display:grid;gap:8px}',
    '.dxi-item{display:flex;align-items:center;gap:10px;padding:10px 12px;border:1px solid var(--dsw-alias-border-l1);border-radius:8px}',
    '.dxi-item-meta{flex:1 1 auto;min-width:0;display:grid;gap:2px}',
    '.dxi-item-name{color:var(--dsw-alias-label-primary);font-size:13px;font-weight:600}',
    '.dxi-item-spec{color:var(--dsw-alias-label-secondary);font-size:11px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
    '.dxi-item-version{color:var(--dsw-alias-label-secondary);font-size:11px;line-height:16px}',
    '.dxi-item-version-new{color:var(--dsw-alias-state-warn-label)}',
    '.dxi-badge{flex:0 0 auto;padding:2px 8px;border-radius:999px;font-size:11px;line-height:16px;border:1px solid var(--dsw-alias-border-l1)}',
    '.dxi-badge-on{color:var(--dsw-alias-state-success-primary)}',
    '.dxi-badge-off{color:var(--dsw-alias-label-secondary)}',
    '.dxi-danger{color:var(--dsw-alias-state-error-primary)}',
    '.dxi-empty{margin:0;color:var(--dsw-alias-label-secondary);font-size:13px}',
  ].join('\n')

  async function callApi(path, options) {
    const res = await fetch(path, options)
    let data = null
    try { data = await res.json() } catch { /* non-JSON body */ }
    return data
  }

  function RestartButton() {
    const [restarting, setRestarting] = React.useState(false)
    const [error, setError] = React.useState('')
    const onClick = async () => {
      if (restarting) return
      setRestarting(true)
      setError('')
      try {
        const res = await callApi('/api/dsh-plugin-installer/restart', { method: 'POST' })
        if (!(res && res.ok)) {
          setRestarting(false)
          setError((res && res.message) || '无法重启 Desktop')
        }
      } catch (e) {
        setRestarting(false)
        setError(e && e.message ? e.message : String(e))
      }
    }
    return React.createElement('div', { className: 'dxi-action' },
      error ? React.createElement('span', { className: 'dxi-action-error', role: 'alert' }, error) : null,
      React.createElement(Button, { variant: 'outline', size: 'sm', disabled: restarting, onClick }, '重启 Desktop'),
    )
  }

  function InstallTab() {
    const [spec, setSpec] = React.useState('')
    const [profile, setProfile] = React.useState('')
    const [profiles, setProfiles] = React.useState([])
    const [status, setStatus] = React.useState('idle')
    const [message, setMessage] = React.useState('')
    const [output, setOutput] = React.useState('')
    const [restarting, setRestarting] = React.useState(false)

    React.useEffect(() => {
      let alive = true
      callApi('/api/dsh-plugin-installer/profiles', { method: 'GET' }).then((res) => {
        if (!alive) return
        const list = (res && Array.isArray(res.profiles)) ? res.profiles : []
        setProfiles(list)
        const active = list.find((p) => p && p.active) || list[0]
        if (active && active.name) setProfile(active.name)
      }).catch(() => {
        if (!alive) return
        setProfiles([{ name: 'desktop', active: true }, { name: 'web', active: false }])
        setProfile('desktop')
      })
      return () => { alive = false }
    }, [])

    const onInstall = async () => {
      const s = spec.trim()
      if (!s) { setStatus('error'); setMessage('请输入仓库地址'); setOutput(''); return }
      if (!profile) { setStatus('error'); setMessage('请选择目标 profile'); setOutput(''); return }
      setStatus('installing')
      setMessage('')
      setOutput('')
      try {
        const res = await callApi('/api/dsh-plugin-installer/install', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ spec: s, profile }),
        })
        if (res && res.ok) {
          setStatus('success')
          setMessage('安装成功：' + (res.spec || s) + ' → profile「' + (res.profile || profile) + '」。需要重启 Desktop 才能生效。')
          setOutput(res.output || '')
        } else {
          setStatus('error')
          setMessage((res && res.message) || '安装失败')
          setOutput((res && res.output) || '')
        }
      } catch (e) {
        setStatus('error')
        setMessage(e && e.message ? e.message : String(e))
      }
    }

    const onRestart = async () => {
      if (restarting) return
      setRestarting(true)
      try {
        const res = await callApi('/api/dsh-plugin-installer/restart', { method: 'POST' })
        if (!(res && res.ok)) setMessage((res && res.message) || '无法重启 Desktop')
      } catch (e) {
        setMessage(e && e.message ? e.message : String(e))
      } finally {
        setRestarting(false)
      }
    }

    return React.createElement('div', { className: 'dxi-install' },
      React.createElement('p', { className: 'dxi-hint' }, '输入仓库地址安装插件（github:owner/repo#ref 或 npm 包名），并选择安装到哪个 profile。安装后需重启 Desktop 才生效。'),
      React.createElement('div', { className: 'dxi-row' },
        React.createElement('input', {
          className: 'dxi-input',
          type: 'text',
          value: spec,
          placeholder: 'github:owner/repo#ref 或 npm 包名',
          onChange: (e) => setSpec(e.target.value),
          disabled: status === 'installing',
        }),
      ),
      React.createElement('div', { className: 'dxi-row' },
        React.createElement('label', { className: 'dxi-label' }, '目标 profile'),
        React.createElement('select', {
          className: 'dxi-select',
          value: profile,
          onChange: (e) => setProfile(e.target.value),
          disabled: status === 'installing',
        },
          profiles.map((p) => React.createElement('option', { key: p.name, value: p.name },
            p.name + (p.active ? '（当前）' : ''))),
        ),
        React.createElement(Button, {
          variant: 'primary',
          size: 'sm',
          onClick: onInstall,
          disabled: status === 'installing' || !spec.trim() || !profile,
        }, status === 'installing' ? '安装中…' : '安装'),
      ),
      status === 'success' ? React.createElement('div', { className: 'dxi-status dxi-ok' },
        message,
        React.createElement('div', { style: { marginTop: '8px' } },
          React.createElement(Button, { variant: 'outline', size: 'sm', onClick: onRestart, disabled: restarting }, restarting ? '重启中…' : '立即重启 Desktop'),
        ),
      ) : null,
      status === 'error' ? React.createElement('div', { className: 'dxi-status dxi-err' }, message) : null,
      output ? React.createElement('pre', { className: 'dxi-output' }, output) : null,
    )
  }

  function ThirdPartyTab() {
    const [profile, setProfile] = React.useState('')
    const [profiles, setProfiles] = React.useState([])
    const [plugins, setPlugins] = React.useState([])
    const [loaded, setLoaded] = React.useState(false)
    const [busy, setBusy] = React.useState(false)
    const [confirming, setConfirming] = React.useState('')
    const [message, setMessage] = React.useState('')
    const [messageKind, setMessageKind] = React.useState('')
    const [output, setOutput] = React.useState('')
    const [restarting, setRestarting] = React.useState(false)
    const [checks, setChecks] = React.useState({})
    const [checking, setChecking] = React.useState(false)

    React.useEffect(() => {
      let alive = true
      callApi('/api/dsh-plugin-installer/profiles', { method: 'GET' }).then((res) => {
        if (!alive) return
        const list = (res && Array.isArray(res.profiles)) ? res.profiles : []
        setProfiles(list)
        const active = list.find((p) => p && p.active) || list[0]
        if (active && active.name) setProfile(active.name)
      }).catch(() => {
        if (!alive) return
        setProfiles([{ name: 'desktop', active: true }, { name: 'web', active: false }])
        setProfile('desktop')
      })
      return () => { alive = false }
    }, [])

    const refresh = React.useCallback(() => {
      if (!profile) return
      setLoaded(false)
      callApi('/api/dsh-plugin-installer/installed?profile=' + encodeURIComponent(profile), { method: 'GET' })
        .then((res) => {
          setPlugins((res && Array.isArray(res.plugins)) ? res.plugins : [])
          setLoaded(true)
        })
        .catch(() => {
          setPlugins([])
          setLoaded(true)
        })
    }, [profile])

    React.useEffect(() => { refresh() }, [refresh])

    const onToggle = async (p, enabled) => {
      if (busy) return
      setBusy(true)
      setMessage('')
      setOutput('')
      try {
        const res = await callApi('/api/dsh-plugin-installer/set-enabled', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: p.name, profile, enabled }),
        })
        if (res && res.ok) {
          setPlugins((res && Array.isArray(res.plugins)) ? res.plugins : [])
          setMessageKind('ok')
          setMessage('已' + (enabled ? '启用' : '停用') + '「' + p.name + '」，需要重启 Desktop 生效。')
        } else {
          setMessageKind('err')
          setMessage((res && res.message) || '操作失败')
        }
      } catch (e) {
        setMessageKind('err')
        setMessage(e && e.message ? e.message : String(e))
      } finally {
        setBusy(false)
      }
    }

    const onUninstall = async (p) => {
      if (busy) return
      if (confirming !== p.name) {
        setConfirming(p.name)
        setTimeout(() => setConfirming((current) => (current === p.name ? '' : current)), 3000)
        return
      }
      setConfirming('')
      setBusy(true)
      setMessage('')
      setOutput('')
      try {
        const res = await callApi('/api/dsh-plugin-installer/uninstall', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: p.name, profile }),
        })
        if (res && res.ok) {
          setMessageKind('ok')
          setMessage('已卸载「' + p.name + '」，需要重启 Desktop 生效。')
          setOutput(res.output || '')
          refresh()
        } else {
          setMessageKind('err')
          setMessage((res && res.message) || '卸载失败')
          setOutput((res && res.output) || '')
        }
      } catch (e) {
        setMessageKind('err')
        setMessage(e && e.message ? e.message : String(e))
      } finally {
        setBusy(false)
      }
    }

    const onRestart = async () => {
      if (restarting) return
      setRestarting(true)
      try {
        const res = await callApi('/api/dsh-plugin-installer/restart', { method: 'POST' })
        if (!(res && res.ok)) setMessage((res && res.message) || '无法重启 Desktop')
      } catch (e) {
        setMessage(e && e.message ? e.message : String(e))
      } finally {
        setRestarting(false)
      }
    }

    const runCheck = async () => {
      if (!profile || checking || busy) return
      setChecking(true)
      setMessage('')
      setOutput('')
      try {
        const res = await callApi('/api/dsh-plugin-installer/check-updates?profile=' + encodeURIComponent(profile), { method: 'GET' })
        if (res && res.ok && Array.isArray(res.plugins)) {
          const map = {}
          for (const p of res.plugins) map[p.name] = p
          setChecks(map)
        } else {
          setMessageKind('err')
          setMessage((res && res.message) || '检测失败')
        }
      } catch (e) {
        setMessageKind('err')
        setMessage(e && e.message ? e.message : String(e))
      } finally {
        setChecking(false)
      }
    }

    const onUpdate = async (p) => {
      if (busy) return
      setBusy(true)
      setMessage('')
      setOutput('')
      try {
        const res = await callApi('/api/dsh-plugin-installer/update', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: p.name, profile }),
        })
        if (res && res.ok) {
          setMessageKind('ok')
          setMessage('已更新「' + p.name + '」，需要重启 Desktop 生效。')
          setOutput(res.output || '')
          setChecks({})
          refresh()
        } else {
          setMessageKind('err')
          setMessage((res && res.message) || '更新失败')
          setOutput((res && res.output) || '')
        }
      } catch (e) {
        setMessageKind('err')
        setMessage(e && e.message ? e.message : String(e))
      } finally {
        setBusy(false)
      }
    }

    const fmtVersion = (p) => (p && p.type === 'github' && typeof p.installed === 'string' && typeof p.latest === 'string')
      ? { from: p.installed.slice(0, 7), to: p.latest.slice(0, 7) }
      : { from: p ? (p.installed || '未知') : '未知', to: p ? (p.latest || '未知') : '未知' }

    return React.createElement('div', { className: 'dxi-install' },
      React.createElement('p', { className: 'dxi-hint' }, '列出当前 profile 里从第三方安装的插件。可切换启用/停用、卸载，或检测并更新到最新版本；这些改动都需重启 Desktop 才生效。'),
      React.createElement('div', { className: 'dxi-row' },
        React.createElement('label', { className: 'dxi-label' }, 'profile'),
        React.createElement('select', {
          className: 'dxi-select',
          value: profile,
          onChange: (e) => setProfile(e.target.value),
          disabled: busy,
        },
          profiles.map((p) => React.createElement('option', { key: p.name, value: p.name },
            p.name + (p.active ? '（当前）' : ''))),
        ),
        React.createElement(Button, { variant: 'outline', size: 'sm', onClick: refresh, disabled: busy }, '刷新'),
        React.createElement(Button, { variant: 'outline', size: 'sm', onClick: runCheck, disabled: busy || checking }, checking ? '检测中…' : '检测更新'),
      ),
      !loaded
        ? React.createElement('p', { className: 'dxi-empty' }, '加载中…')
        : plugins.length === 0
          ? React.createElement('p', { className: 'dxi-empty' }, '该 profile 暂无第三方插件')
          : React.createElement('div', { className: 'dxi-list' },
            plugins.map((p) => {
              const check = checks[p.name]
              const version = check ? fmtVersion(check) : null
              return React.createElement('div', { key: p.name, className: 'dxi-item' },
                React.createElement('div', { className: 'dxi-item-meta' },
                  React.createElement('div', { className: 'dxi-item-name' }, p.name),
                  React.createElement('div', { className: 'dxi-item-spec', title: p.spec }, p.spec),
                  check
                    ? (check.error
                      ? React.createElement('div', { className: 'dxi-item-version' }, '无法检测：' + check.error)
                      : check.hasUpdate
                        ? React.createElement('div', { className: 'dxi-item-version dxi-item-version-new' },
                          '检测到新版本：' + version.from + ' → ' + version.to)
                        : React.createElement('div', { className: 'dxi-item-version' }, '该插件已是最新版本'))
                    : null,
                ),
                React.createElement('span', { className: 'dxi-badge ' + (p.enabled ? 'dxi-badge-on' : 'dxi-badge-off') },
                  p.enabled ? '已启用' : '已停用'),
                React.createElement(Button, {
                  variant: 'outline',
                  size: 'sm',
                  onClick: () => onToggle(p, !p.enabled),
                  disabled: busy,
                }, p.enabled ? '停用' : '启用'),
                check && check.hasUpdate && !check.error
                  ? React.createElement(Button, { variant: 'primary', size: 'sm', onClick: () => onUpdate(p), disabled: busy }, '更新')
                  : null,
                React.createElement(Button, {
                  variant: 'outline',
                  size: 'sm',
                  className: 'dxi-danger',
                  onClick: () => onUninstall(p),
                  disabled: busy,
                }, confirming === p.name ? '确认卸载' : '卸载'),
              )
            }),
          ),
      message ? React.createElement('div', { className: 'dxi-status ' + (messageKind === 'err' ? 'dxi-err' : 'dxi-ok') },
        message,
        messageKind === 'ok' ? React.createElement('div', { style: { marginTop: '8px' } },
          React.createElement(Button, { variant: 'outline', size: 'sm', onClick: onRestart, disabled: restarting }, restarting ? '重启中…' : '立即重启 Desktop'),
        ) : null,
      ) : null,
      output ? React.createElement('pre', { className: 'dxi-output' }, output) : null,
    )
  }

  function apply(ctx) {
    const styleTag = document.createElement('style')
    styleTag.textContent = CSS
    styleTag.dataset.plugin = 'dsh-plugin-desktop-installer'
    document.head.appendChild(styleTag)
    ctx.effect(() => () => { styleTag.remove() }, 'dsh-plugin-desktop-installer: styles')

    ctx.slots.inject('settings.action', () => ctx.slots.register(
      { name: 'settings.action', id: 'restart-desktop', order: 20, label: '重启 Desktop' },
      () => React.createElement(RestartButton, null),
    ))

    ctx.slots.inject('settings.plugins.tab', () => ctx.slots.register(
      { name: 'settings.plugins.tab', id: 'install-by-address', order: 30, label: '安装插件' },
      () => React.createElement(InstallTab, null),
    ))

    ctx.slots.inject('settings.plugins.tab', () => ctx.slots.register(
      { name: 'settings.plugins.tab', id: 'third-party-plugins', order: 40, label: '第三方插件' },
      () => React.createElement(ThirdPartyTab, null),
    ))
  }

  exports.apply = apply
  exports.inject = ['slots']
  return module.exports
} })
