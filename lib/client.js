window.__ModuleLoader__.load({ id: 'dsh-plugin-desktop-installer', factory: (require) => {
  const module = { exports: {} }
  const exports = module.exports
  const React = require('react')

  const CSS = [
    '.dxi-install{display:grid;gap:12px;padding:8px 2px;color:var(--dsw-alias-label-primary);font-size:13px}',
    '.dxi-hint{margin:0;color:var(--dsw-alias-label-secondary);font-size:12px;line-height:18px}',
    '.dxi-row{display:flex;align-items:center;gap:8px;flex-wrap:wrap}',
    '.dxi-input,.dxi-select{box-sizing:border-box;height:34px;border:1px solid var(--dsw-alias-border-l1);border-radius:6px;padding:0 10px;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-base);font:inherit;font-size:13px}',
    '.dxi-input{flex:1 1 220px;min-width:0}',
    '.dxi-select{min-width:150px}',
    '.dxi-label{color:var(--dsw-alias-label-secondary);font-size:12px;white-space:nowrap}',
    '.dxi-btn,.dxi-restart-btn{display:inline-flex;align-items:center;justify-content:center;height:32px;padding:0 14px;border:1px solid var(--dsw-alias-border-l1);border-radius:6px;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-base);font:inherit;font-size:12px;cursor:pointer}',
    '.dxi-btn:disabled,.dxi-restart-btn:disabled{opacity:.55;cursor:default}',
    '.dxi-btn-primary{border-color:transparent;color:#fff;background:var(--dsw-alias-brand-primary)}',
    '.dxi-restart-btn{height:30px;padding:0 12px}',
    '.dxi-status{padding:8px 10px;border-radius:6px;font-size:12px;line-height:18px;border:1px solid var(--dsw-alias-border-l1)}',
    '.dxi-ok{color:var(--dsw-alias-state-success-primary)}',
    '.dxi-err{color:var(--dsw-alias-state-error-primary)}',
    '.dxi-output{margin:0;max-height:140px;overflow:auto;padding:8px 10px;border-radius:6px;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-secondary);font-size:11px;line-height:16px;white-space:pre-wrap;word-break:break-word}',
  ].join('\n')

  async function callApi(path, options) {
    const res = await fetch(path, options)
    let data = null
    try { data = await res.json() } catch { /* non-JSON body */ }
    return data
  }

  function RestartButton() {
    const [state, setState] = React.useState('idle')
    const [msg, setMsg] = React.useState('')
    const onClick = async () => {
      if (state === 'restarting') return
      setState('restarting')
      setMsg('')
      try {
        const res = await callApi('/api/dsh-plugin-installer/restart', { method: 'POST' })
        if (!(res && res.ok)) {
          setState('error')
          setMsg((res && res.message) || '无法重启 Desktop')
        }
      } catch (e) {
        setState('error')
        setMsg(e && e.message ? e.message : String(e))
      }
    }
    return React.createElement('button', {
      type: 'button',
      className: 'dxi-restart-btn',
      onClick,
      disabled: state === 'restarting',
      title: msg || undefined,
    }, state === 'restarting' ? '重启中…' : '重启 Desktop')
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
        React.createElement('button', {
          type: 'button',
          className: 'dxi-btn dxi-btn-primary',
          onClick: onInstall,
          disabled: status === 'installing' || !spec.trim() || !profile,
        }, status === 'installing' ? '安装中…' : '安装'),
      ),
      status === 'success' ? React.createElement('div', { className: 'dxi-status dxi-ok' },
        message,
        React.createElement('div', { style: { marginTop: '8px' } },
          React.createElement('button', { type: 'button', className: 'dxi-btn', onClick: onRestart, disabled: restarting }, restarting ? '重启中…' : '立即重启 Desktop'),
        ),
      ) : null,
      status === 'error' ? React.createElement('div', { className: 'dxi-status dxi-err' }, message) : null,
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
  }

  exports.apply = apply
  exports.inject = ['slots']
  return module.exports
} })
