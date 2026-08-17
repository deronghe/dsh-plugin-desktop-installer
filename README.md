# dsh-plugin-desktop-installer

在 DSH Desktop 的「设置」里提供三个能力：

- **重启 Desktop 按钮** —— 显示在设置面板右上角（关闭按钮旁），一键重启 Electron 桌面版。
- **按地址安装插件** —— 在「设置 → 插件 → 安装插件」标签页里，输入仓库地址并选择目标 profile（`desktop` / `web`）即可安装，装完可直接重启。
- **第三方插件管理** —— 在「设置 → 插件 → 第三方插件」标签页里，列出当前 profile 里从第三方安装的插件（内置 bundle 之外），并支持一键卸载、启用、停用。

底层复用 DSH Desktop 已有的原生能力：重启走 `desktopRuntime.requestRestart()`；安装/卸载走权威命令 `dsh plugin --profile <name> add|remove <spec>`（等价于 pnpm add/remove + 自动把 bundle reconcile 进 `dsh.profile.bundles`）。启用/停用直接编辑 profile 的 `package.json` 里的 `dsh.profile.bundles` 列表（加入/移除插件名），重启后生效。

## 安装

```sh
dsh plugin --profile desktop add github:deronghe/dsh-plugin-desktop-installer
```

地址支持两种格式：

- GitHub：`github:owner/repo` 或 `github:owner/repo#ref`
- npm：`包名` 或 `@scope/包名`（可选 `@version`）

安装后重启 Desktop 生效。

## 结构

- `lib/index.js` —— Host 半：注册 `/api/dsh-plugin-installer/{profiles,install,restart,installed,uninstall,set-enabled}` 六个 HTTP 接口。
- `lib/client.js` —— 浏览器半：设置里的重启按钮、安装表单与第三方插件管理列表。
- `cordis.patch.yml` —— 把本插件插入 profile 组合。

## 限制

- 安装/卸载能力依赖桌面版独有的 `desktopPnpmBootstrap`；纯 `web` profile（`dsh --profile web`）下没有这些服务，会提示「缺少安装能力」。启用/停用与列表只需读写 profile 的 `package.json`，不依赖桌面服务。
- 操作写入的是 `$DSH_HOME/profiles/<name>`，只对本机该 profile 生效。
