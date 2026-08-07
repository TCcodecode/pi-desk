# Pi Desk 桌面分发计划

> 状态：第一阶段实施中。目标是先让用户能从 GitHub Releases 下载并安装，不等待 Apple 证书。

## 1. 背景与结论

当前 `pi-desk` 只有 `electron-vite build`，还没有安装包、Release workflow 或自动更新通道。

参考 Reasonix 的做法，分发应拆成四层：

1. CI 在原生平台 runner 上构建。
2. GitHub Release 保存带版本号的安装包和校验文件。
3. macOS 在没有 Developer ID 证书时先发布未签名包，并明确告诉用户如何一次性允许启动。
4. 获得证书后只切换签名/公证配置，不改变下载地址和用户安装路径。

第一阶段不做 R2/CDN、Homebrew、App Store 和应用内自动更新。它们会增加发布面，但不是验证产品分发闭环的前置条件。

## 2. 第一阶段产物

| 平台 | 产物 | 用途 |
| --- | --- | --- |
| macOS arm64 | `.dmg`、`.zip` | Apple Silicon 用户安装与备用下载 |
| macOS x64 | `.dmg`、`.zip` | Intel Mac 用户安装与备用下载 |
| Windows x64 | `.exe` NSIS、`.zip` | 常规安装与便携版 |
| Linux x64 | `.AppImage`、`.deb`、`.tar.gz` | 通用安装、Debian/Ubuntu、便携版 |
| 全平台 | `SHA256SUMS` | 下载完整性校验 |

统一命名：`PiDesk-<version>-<os>-<arch>.<ext>`。Release tag 使用 `v<semver>`，例如 `v0.2.0`。

## 3. 技术方案

### 打包工具

引入 `electron-builder`，复用现有 `electron-vite build` 输出：

```text
out/main/main.js
out/preload/preload.cjs
out/renderer/*
```

`asar` 默认开启；应用运行所需的 npm 依赖继续由根 `package.json` 的 `dependencies` 提供。workspace 包和 `pi-mcp-adapter` 已由 `electron.vite.config.ts` 打入 main bundle，不额外要求用户安装 Node、Pi CLI 或其他运行时。

### Release workflow

`.github/workflows/release.yml` 在推送 `v*` tag 后执行：

1. 运行已有的 typecheck、测试和 production build。
2. 使用原生 runner 构建 macOS arm64、macOS x64、Windows x64、Linux x64。
3. 各 job 上传临时 artifact。
4. 汇总 job 下载所有 artifact，生成 `SHA256SUMS`，创建 GitHub Release 并上传全部文件。

发布 job 使用固定的 tag 和提交 SHA；同一 tag 的并发发布被串行化，避免重复覆盖 Release。

### macOS 无证书策略

没有 Apple Developer ID 证书时：

- CI 设置 `CSC_IDENTITY_AUTO_DISCOVERY=false`，只构建未签名 `.app`/`.dmg`/`.zip`。
- Release 标题和说明明确标注“macOS 未签名版本”。
- 下载页给出 Control-click → Open，以及“系统设置 → 隐私与安全性 → 仍要打开”的一次性授权路径。
- 如果下载后的 quarantine 属性仍导致“已损坏”提示，再提供针对该 app 的 `xattr -dr com.apple.quarantine` 命令。
- 不要求用户关闭 Gatekeeper，也不提供全局关闭安全策略的命令。

这不是绕过签名验证来伪装可信应用，而是让用户在明确知道来源、确认校验值后，手动批准一次未签名软件。签名和公证完成后，安装说明自动切换为普通双击启动。

### 后续签名/公证

拿到 Apple Developer 账号和 Developer ID Application 证书后，增加 GitHub Secrets：

- `CSC_LINK` / `CSC_KEY_PASSWORD`
- `APPLE_API_KEY` / `APPLE_API_KEY_ID` / `APPLE_API_ISSUER`

通过 electron-builder 在 macOS runner 上完成 Developer ID 签名、Hardened Runtime、公证和 ticket stapling。下载 URL、版本 tag 和 artifact 名称保持不变，因此不需要迁移用户或重做官网入口。

### 自动更新边界

Windows 的 NSIS 安装版与 Linux AppImage 使用 `electron-updater`：启动后只检查新版，左下角显示升级点；用户点击后才下载，下载完成后再次确认重启安装。`.zip`、`.deb` 保持手动更新。Release workflow 上传 `latest*.yml` 与 `.blockmap` 元数据，供客户端验证和下载更新。

未签名 macOS 包不启用原地自更新，避免更新流程遇到 Gatekeeper 拒绝或留下半更新状态。待 macOS 签名/公证稳定后，再打开同一个 `electron-updater` 管道的 macOS 分支。

## 4. 实施步骤

### Phase 1：本地可打包

- [x] 确认 Electron/Vite 输出路径和主进程入口。
- [x] 添加 `electron-builder` 开发依赖。
- [x] 在 `package.json` 添加 `dist`、`dist:mac`、`dist:win`、`dist:linux` 命令和 build 配置。
- [x] 本地生成 macOS arm64/x64 的 `.dmg` 和 `.zip`，并完成打包应用启动冒烟。

### Phase 2：GitHub Releases

- [x] 添加多平台 workflow、并发控制和 tag 校验。
- [x] 上传/汇总 artifacts，生成 `SHA256SUMS`。
- [ ] 在 GitHub Actions 中验证 macOS 无证书构建不会因找不到签名身份失败。
- [ ] 发布第一个 `v0.2.0-rc.1`，用一台 Apple Silicon Mac 和一台 Intel Mac 实测。

### Phase 3：安装体验

- [x] 更新 README 的下载、安装、macOS 首次启动和卸载说明。
- [ ] 增加 release checklist：版本号、artifact 数量、SHA256、启动、数据迁移、升级覆盖安装。
- [ ] 记录用户反馈中最常见的 Gatekeeper/Windows SmartScreen/Linux 依赖问题。

### Phase 4：签名、公证和更新

- [ ] 申请 Apple Developer Program 与 Developer ID Application。
- [ ] 在临时 keychain 中验证签名、公证、staple 和离线 Gatekeeper 检查。
- [ ] 开启 macOS 普通双击安装，移除“未签名”提示。
- [ ] 再评估 `electron-updater`、稳定/预览通道和 CDN 镜像。

## 5. 变更范围

预计第一阶段涉及：

```text
package.json
package-lock.json
.github/workflows/release.yml
README.md
docs/superpowers/plans/2026-08-10-pi-desk-release-distribution.md
```

不改动 `electron/main.ts`、会话存储协议和 renderer 业务逻辑。分发是外围能力，不能影响现有开发启动方式 `npm run dev`。

## 6. 完成标准

- `npm ci && npm run build` 成功。
- `npm run dist:mac` 在无 Apple 证书环境下生成 `.dmg` 和 `.zip`。
- GitHub tag 发布能得到四个平台矩阵的安装包和 `SHA256SUMS`。
- 用户不需要安装 Node、npm、Pi CLI 或额外 agent runtime。
- macOS 用户按照 README 的一次性授权步骤可启动应用；Gatekeeper 未被全局关闭。
- 现有测试、类型检查和开发模式不回归。

## 7. 参考

- [Reasonix README](https://github.com/esengine/deepseek-reasonix)
- [Reasonix desktop release workflow](https://github.com/esengine/deepseek-reasonix/blob/main-v2/.github/workflows/release-desktop.yml)
- [Apple Developer ID](https://developer.apple.com/developer-id/)
- [Apple：打开来自未知开发者的 app](https://support.apple.com/en-ie/guide/mac-help/-mh40616/mac)
- [Electron code signing](https://www.electronjs.org/docs/latest/tutorial/code-signing)
