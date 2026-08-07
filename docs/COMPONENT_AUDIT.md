# Pi Desk UI 组件与样式审计报告

> 审计日期：2026-08-16 · 范围：`src/renderer/`（Electron + React 19 + TypeScript）
> 性质：纯只读审计 + 规范化执行计划。基线：`vitest` 52 个文件 / 513 个测试全绿（可写 HOME），`tsc --noEmit` 通过。

---

## 1. 现状总览（实测数据）

| 维度 | 实测值 | 结论 |
|---|---|---|
| 样式组织 | 单个 `styles.css` 8380 行、约 2795 条规则 | "token 化但未拆分的巨石" |
| `:root` 变量 | 2 个块，269 个唯一 token（第 2 块仅 2 个别名） | token 体系已存在且较完整 |
| `var()` 引用 | 2262 处，273 个不同 token（>269，存在未定义引用） | 有 token 缺口 |
| hex 颜色 | 210 处，**100% 已 token 化** | ✅ |
| rgba() 颜色 | 143 处，其中 **138 处在规则体内硬编码** | ⚠️ 最大 token 欠账 |
| 组件规模 | 41 个 `.tsx`；7 个 >680 行（App 1308 / Timeline 1067 / SettingsDialog 949 / Composer 880 / ResourceInspector 847 / HttpWorkbench 812 / SessionSidebar 698） | 巨型组件集中 |
| className 字符串 | TSX 中约 463 个不同类名 | 全局类名约定 |
| 内联样式 | 6 文件 11 处，其中 ~7 处为虚拟列表/动态布局的必要内联，~2 处应迁移 | 少量 |
| 对话框 | 6 个组件手写 backdrop 模式，**仅 3 个被应用挂载** | 重复 + 死代码 |
| 测试覆盖 | 41 个组件中多数有同名测试；**App.tsx 无专属测试** | 覆盖较好，App 除外 |

---

## 2. 核心发现

### 2.1 🔴 死代码（优先清理）

| 项目 | 证据 | 处置 |
|---|---|---|
| `TrustDialog.tsx` / `TreeDialog.tsx` / `ProjectPickerDialog.tsx` | 全 `src/` 无 import（仅各自 `.test.tsx` 引用） | 保留（规划中功能）但一并纳入 Dialog 规范化；或按用户决策删除 |
| `typography.ts`（`TYPOGRAPHY_FONT_FAMILIES` / `TYPOGRAPHY_SCALE`） | 仅被 `typography.test.ts` 引用，生产代码零消费，且与 `:root` 的 `--font-*`/`--text-*`/`--leading-*` 逐值重复 | 删除或改为从 CSS 变量读取 |
| 死 token：`--text-display`、`--leading-display`、`--space-8`、`--radius-lg` | `styles.css:10,17,27,35` 定义但零引用 | 清理 |
| `ResourceInspector.tsx:305-312` 本地 `formatRelativeTime` | 与共享 `formatRelativeTime.ts` 行为不一致（缺 "yesterday" 分支） | 删除本地副本，统一使用共享版 |

### 2.2 🔴 真实 Bug / 视觉不一致

1. **`--text-tertiary` 被引用但从未定义**（`styles.css:3281` `.topbar-left-panel-toggle.is-collapsed`）→ 该声明按 `unset` 处理，折叠按钮颜色回退。应补定义或改引用。
2. **diff 行 added/removed 配色 4 处重复且色值不一致**（`styles.css:2659-2660`、`2753-2754`、`4413-4414`、`4490-4491`）→ 同一「新增/删除行」在 composer / changes inspector / http workbench 中颜色不统一。应抽 `--diff-added-*` / `--diff-removed-*`。
3. **运行状态点光晕 3 套写法**（`rgba(77,103,135,0.25)` vs `0.18` vs `rgba(77,120,178)`），位于 `.session-dot.is-running`（579）、`.session-tab-dot.is-running`（1080）、`.status-dot.running`（1590/5352/7468）。
4. **焦点环体系混乱**：`--focus-ring`（L69，黑）与 `--interaction-focus-ring`（L45，灰）并存，规则体内另有大量 `rgba(49,157,255,α)` 硬编码焦点环。

### 2.3 对话框家族（6 组件重复模式）

**只有 3/6 被挂载**：`CommandPalette`、`SettingsDialog`、`HelpDialog`（App.tsx:1245-1305）；`TrustDialog` / `ProjectPickerDialog` / `TreeDialog` 是死代码。

| 组件 | backdrop 类 | 面板类 | 点外关闭 | ESC | 关闭按钮 | 挂载 |
|---|---|---|---|---|---|---|
| HelpDialog | `palette-backdrop help-backdrop` | `help-dialog` | ✅ | ✅ window 监听 (41-48) | ✅ | ✅ |
| SettingsDialog | `palette-backdrop` | `settings-dialog settings-dialog-wide` | ✅ | ❌ | ✅ | ✅ |
| CommandPalette | `palette-backdrop` | `command-palette` | ✅ | ⚠️ 仅 input 局部 (39) | ❌ | ✅ |
| TreeDialog | `palette-backdrop` | `tree-dialog` | ✅ | ❌ | ✅ | ❌ |
| ProjectPickerDialog | `palette-backdrop` | `settings-dialog project-picker` | ✅ | ❌ | ✅ | ❌ |
| TrustDialog | `trust-backdrop`（z20, blur） | `trust-dialog` | ❌ 阻断式 | ❌ | ❌ | ❌ |

重复计数：`if (!open) return null` ×6、`role="dialog"` ×6、backdrop `onClick={onClose}` ×5、面板 `stopPropagation` ×5、X 关闭按钮 ×3。
CSS：`.palette-backdrop` 被 5 组件复用，`.trust-backdrop` 是几乎重复的定义（z10 vs z20）；6 个面板类在 light theme 层被成组重列 ≥6 次；`.palette-backdrop:has(.settings-dialog)`（6067）强依赖 DOM 嵌套。

### 2.4 样式 token 缺口（138 处硬编码 rgba）

- hex 已 100% token 化；**全部 alpha 叠加色仍硬编码**：`rgba(0,0,0,α)` ×41（阴影/遮罩）、`rgba(49,157,255,α)` ×11（焦点环）、`rgba(32,32,32,α)` ×9、`rgba(255,255,255,α)` ×8、`rgba(77,103,135,α)` ×6、`rgba(61,61,61,α)` ×6 等，约 45 个不同 RGB 三元组。
- Electron 43（Chromium ≥142）支持 `color-mix()`，可 `color-mix(in srgb, var(--x) α, transparent)` 收敛。
- `--sidebar-width` / `--right-panel-width` 是「幽灵 token」：仅 App.tsx 内联注入 + fallback，未在 `:root` 声明。
- 组件局部 token 未收编：`--http-code-*`（3756）、`--sidebar-action-right-inset`（466）等。
- 命名问题：`--text-*` 同时承载字号与颜色；`--swatch-*` 173 个以 hex 命名、无语义。

### 2.5 巨型组件拆分地图（详见分报告）

7 个文件 6561 行，共性：「纯函数逻辑 + 多区块渲染 + 未抽取内部组件」混合。最高收益拆分：

- **App.tsx**：`<Composer>` 接线在 `httpAgentChat`（928-956）与主布局（1149-1180）几乎逐字重复；7 处 localStorage 读写、2 处拖拽 resize、快捷键/事件分发 effect 可抽 hooks。
- **SettingsDialog**：OAuth 三件套（`OAuthProgressPanel`/`OAuthEventRow`/`OAuthPromptForm`，726-949）已自包含；三 Tab 可拆。
- **ResourceInspector**：`IndexPanel`（314-492）完全自包含；本地 `formatRelativeTime` 重复；`StatusDot`/`CollapsibleSection` 可共享。
- **Timeline**：`CopyButton`（746-766）、`ToolDiff`（769-795）可共享化；`toolPresentation`（472-629）纯逻辑可独立。
- **HttpWorkbench**：`HttpCodeEditor`（124-225，三 ref 同步滚动）自包含；`TreeNode`/`CreateAssetDialog` 可拆。
- **Composer**：Queue 面板（510-586）/ @picker（691-742）/ 附件托盘（743-767）/ 工具栏（768-867）可拆。
- **SessionSidebar**：`IconButton`（66-85 本地）、两处右键菜单结构重复、`ProjectTree` 最大块。

### 2.6 死代码与工程规范（第 4 份审计）

- **死 CSS 类 7 个**（定义了但 TSX 从未引用）：`breadcrumb`、`muted`、`topbar-left`、`has-plan-workspace`、`inspector-footer`、`http-editor`、`http-results-panel`；另有 28 个经动态拼接可达（非死）。
- **被引用但未定义的类 12 个**：`composer-input`、`plan-return-button`、`is-chat-open`、`is-chat-collapsed` 等（可能是历史遗留漏删）。
- **工程规范缺失**：无 ESLint / Prettier / stylelint / .editorconfig、无 `lint` script；`tsconfig` 严格模式已开启 ✅；TODO/FIXME/console.log 为零 ✅。
- **`formatRelativeTime` 3 份重复实现**：共享 `formatRelativeTime.ts` + `ResourceInspector` 本地副本 + 第 3 份（见 2.1 处置）。
- **无测试组件 7 个**：App.tsx（无专属测试）等。

---

## 3. 共享原语清单（建议新增 `src/renderer/components/ui/`）

| 原语 | 替换目标 | 关键点 |
|---|---|---|
| `<Dialog>` | 6 个手写对话框 | props：`open/label/backdropClassName/panelClassName/closeOnBackdrop/closeOnEscape/panelProps`；窗口级 ESC 监听；`trust-backdrop` 场景 z20 |
| `<IconButton>` | SessionSidebar 本地 IconButton、各对话框 X 按钮 | label/title/accent + className 透传 |
| `<CopyButton>` + `useCopyToClipboard` | Timeline:746、HttpWorkbench:478、App:217、SessionSidebar:430/561 | copied 态 1.2s 复位；execCommand 降级只保留一份 |
| `<UnifiedDiff>` | Timeline `ToolDiff` + ChangeInspector:164 | 行着色 + 14 行上限 |
| `<Toggle>` | ResourceInspector switch ×3、SettingsDialog MCP switch | checked/onChange/disabled/label |
| `<SessionStatusDot>` + `sessionStatusClass` | ResourceInspector:171、SessionSidebar:87、SessionTabBar | running 光晕统一 |
| `<EmptyState>` | Timeline:74、HttpWorkbench:629/798、SettingsDialog:642、SessionSidebar:357/462、ChangeInspector:285 | icon/title/hint/action + className 透传 |
| `<Badge>` | `tab-badge`、`StatusBadge`、`timeline-status`、`mcp-tag` | variant/tone |
| `<SearchField>` | SessionSidebar:314、SettingsDialog:352 | 带清除按钮 |
| `useLocalStorageState<T>` | App 7 处 + HttpWorkbench 2 处 | try/catch 静默降级 |
| `useResizeHandle` | App:266/1010 + HttpWorkbench:570 | 边界钳制参数化；body cursor/userSelect 恢复；卸载清理 |
| `ModalBackdrop` | SettingsDialog:325、HttpWorkbench:722 | onClick 关闭 + 内容 stopPropagation |

---

## 4. 执行计划（按风险递增）

| 阶段 | 内容 | 风险 | 验证 |
|---|---|---|---|
| **P0** | 纯逻辑抽离：Timeline `toolPresentation`、ResourceInspector 格式化函数、删除本地 `formatRelativeTime`、HttpWorkbench 高亮助手 | 极低 | 现有测试 + 新增纯单测 |
| **P1** | 共享原语 + hooks（上表）；`Dialog` 替换 6 对话框；ESC/aria 统一 | 低 | Timeline/HttpWorkbench/SettingsDialog/SessionSidebar 测试 |
| **P2** | SettingsDialog 拆 Tabs + OAuthPanel | 低 | SettingsDialog.test（449 行覆盖全 Tab） |
| **P3** | ResourceInspector：IndexPanel 独立 + ContextTab/ToolsTab/ExtensionsTab + 共享 CollapsibleSection/StatusDot | 低→中 | ResourceInspector.test（671 行） |
| **P4** | Timeline：ChangeSummary/ToolGroupView/per-kind rows（守住 memo 比较器） | 中 | Timeline.test（745 行） |
| **P5** | Composer：QueuePanel/AtMentionPicker/AttachmentTray/Toolbar | 中 | Composer.test（398 行） |
| **P6** | HttpWorkbench：HttpCodeEditor/TreeNode/CreateAssetDialog/ResponseDrawer | 中 | HttpWorkbench.test（329 行） |
| **P7** | SessionSidebar：ProjectTree/SessionRow/SessionContextMenu | 中 | SessionSidebar.test（301 行） |
| **P8** | App.tsx：hooks + WelcomeBlock/TopBar 提取 + Composer props 去重（**先补 App 测试再动**） | 高 | smoke/interaction/layout/app.send-flow 间接覆盖 |
| **P9** | Token 修复：`--text-tertiary` 补定义、diff/tint/focus-ring rgba 收敛（`color-mix`）、死 token 清理、z-index token | 低 | theme.test + 视觉回归 |

---

## 5. 风险与陷阱（拆分时必守）

1. **memo 边界**：Timeline 自定义比较器按 prop 引用判等；拆分子组件严禁引入新的内联箭头函数/对象进 `TurnProps`。
2. **虚拟化卸载**：滚出视口的 turn 会被卸载，局部 expand 状态重置（已接受）；不要把 expand 提升到随虚拟化卸载的层级。
3. **吸底阈值耦合**：App 吸底 80px 与 Timeline 虚拟化重粘 100px 两处硬编码，拆分滚动逻辑时保持一致。
4. **textarea ref 与光标恢复**：Composer 的 `textareaRef` 与 3 个 caret ref 必须留在同一组件；IME 组合输入守卫（`isComposing || keyCode===229`）不得丢失。
5. **焦点管理**：SettingsDialog 关闭重置、SessionSidebar 重命名 `focus/select`、Radix `onOpenAutoFocus` 需保留。
6. **stopPropagation 语义**：backdrop 关闭 vs 内层点击、项目行右键菜单冒泡需保持。
7. **拖拽全局监听**：三处 resize 均需恢复 `body.cursor/userSelect` 并处理卸载残留。
8. **localStorage 受限环境**：所有读写保持 try/catch 静默降级，否则 smoke 测试崩溃。
9. **Radix Portal**：SessionSidebar ContextMenu/AlertDialog 保持 Portal 包裹；`ContextMenu.Item onSelect` 语义（非 onClick）不变。
10. **HttpCodeEditor 三 ref 同步滚动**（gutter/highlight/inlay）必须共处一处。

---

## 6. 规范化执行进展（本轮已完成）

| 项 | 内容 | 状态 |
|---|---|---|
| 共享原语 | `ui/Dialog.tsx`（backdrop+ESC+aria 统一）、`ui/CopyButton.tsx`、`ui/IconButton.tsx`、`ui/CollapsibleSection.tsx`、`ui/useCopyToClipboard.ts`、`ui/useDragResize.ts`、`ui/useLocalStorageState.ts` | ✅ |
| Dialog 家族 | 6 个手写对话框全部改用共享 `Dialog`；ESC 处理统一为窗口监听（SettingsDialog/TreeDialog/ProjectPickerDialog 补齐 ESC）；TrustDialog 保持阻断式（`closeOnBackdrop/closeOnEscape=false`） | ✅ |
| hooks 接入 | App.tsx 7 处 localStorage→`useLocalStorageState`（含 motion/workspaceMode 语义保留）；2 处 resize→`useDragResize`；HttpWorkbench 2+1 处同步替换 | ✅ |
| ResourceInspector | `IndexPanel.tsx` 独立（自包含，314-492 行迁移）；`CollapsibleSection` 共享化；本地 `formatRelativeTime` 删除、统一用共享版（签名放宽 `iso?: string`） | ✅ |
| Timeline | 纯逻辑（`describeTool`/`groupTimelineTools`/`toolPreview`/`toolResultSummary`/duration 等 270 行）→ `toolPresentation.ts`；`CopyButton` 共享化；本地类型移入新文件并 re-export | ✅ |
| SettingsDialog | OAuth 三件套（`OAuthProgressPanel`/`OAuthEventRow`/`OAuthPromptForm`，220 行）→ `OAuthPanel.tsx`；949→718 行 | ✅ |
| HttpWorkbench | `HttpCodeEditor.tsx`（含高亮 helper 与 `HttpResponseInlay` 类型）独立；812→629 行 | ✅ |
| Composer | `ComposerQueuePanel.tsx` 独立；880→817 行 | ✅ |
| App.tsx | 两处 `<Composer>` 接线（~30 属性）去重为 `composerProps`；localStorage/resize hooks 接入；1308→1249 行 | ✅ |
| token 修复 | `--text-tertiary` 未定义 bug → `--text-muted`；死 token `--text-display`/`--leading-display`/`--space-8`/`--radius-lg` 删除；diff 行配色 4+3 处统一为 `--diff-added-*`/`--diff-removed-*`（暗/亮双主题） | ✅ |
| typography.ts | 死重复删除（生产零引用）；`typography.test.ts` 保留 CSS 侧校验、删除 TS 常量测试 | ✅ |
| 内联样式 | ComposerMenu 静态 rotate → `.composer-menu-chevron` 类；树缩进魔法数字 3 处 → `--tree-indent-step: 14px`（ChangeInspector×2、HttpWorkbench×1） | ✅ |
| rgba → color-mix | 新增 14 个 `--swatch-*` 基色 token（000000/319dff/202020/ffffff/3d3d3d/262722/f599c6/282a30/6583c4/416daf/22231f/0f1116/161f2c/1f2b3a）；**105 处**多站点家族 rgba → `color-mix(in srgb, var(--swatch-x) α%, transparent)`；:root 定义与 19 处单次使用 tint 保留 | ✅ |
| 金色残留 ⚠️ | `rgba(228,185,97,*)` 暖金 glow（`.session-tab.is-pinned.active`、`.send-button:hover`）违反"gold only on switcher"契约（theme.test 禁止 `#e4b961` hex）——保留字面量以维持视觉零变化，待用户决策是否改为中性黑 shadow | 📋 待决 |
| z-index | 13 个硬编码值 → 13 个语义 token（`--z-base/raised/drawer/floating/backdrop/dialog/popover/command/menu/context-menu/alert-overlay/alert/topbar`），21 处替换，值逐一保持 | ✅ |
| 验证 | `tsc` 双配置通过；vitest 52 文件/513 测试全绿（可写 HOME） | ✅ |
| 死 CSS 类 | 7 个死类清理：`breadcrumb`/`muted`/`topbar-left`/`has-plan-workspace`/`inspector-footer`/`http-editor`/`http-results-panel` 规则删除（含成组选择器处理）；**例外**：`.http-editor` 是 theme.test 契约类，恢复保留；`has-plan-workspace` 实为 5 条复合选择器死规则，一并清理 | ✅ |
| App 测试 | 新增 `App.test.tsx`（6 测试）：欢迎屏三态、Help 对话框开关、mod+K 命令面板、inspector 切换；此前 App 无专属测试 | ✅ |
| App 拆分 | `WelcomeBlock.tsx` + `TopBar.tsx` 提取；1308→**1155 行** | ✅ |
| ESLint | 引入 `eslint.config.js`（flat config：js + typescript-eslint + react-hooks 经典规则）；`npm run lint` **0 错误 6 警告**（exhaustive-deps，既有 store 同步模式）；修复真实代码未用变量 10+ 处、`any` 测试豁免、`{}`→`Record<string, never>`×6、`_` 前缀豁免 | ✅ |
| 性能：切 tab 卡顿 | 实测 React commit 成本极小（30 轮/真实 markdown 负载仅 ~13ms）；**根因**：App 传给 Timeline 的 3 个回调是内联箭头 → Timeline memo 比较器永不生效 → 每次 store 更新（流式 delta 每 ~100ms 一次）都整体重渲染时间线并重解析 markdown。修复：回调 useCallback 化（比较器恢复生效）+ `alignActiveTabWithSession` 无变化时不再触发 store 更新；新增 `perf.tab-switch.test.tsx` 渲染循环守卫（断言每次切 tab ≤8 次 commit）。**剩余瓶颈（记录）**：IPC 快照整体传输（长会话全量 timeline 序列化，主进程+渲染进程双阻塞）、App 整店订阅 + SessionSidebar/Composer/ResourceInspector 未 memo（`changeAgentMode` 等非稳定引用） | ✅ 修复 + 📋 后续 |

### 后续建议（未做，记录在案）
- 死 CSS 类 7 个（`breadcrumb`/`muted`/`topbar-left`/`has-plan-workspace`/`inspector-footer`/`http-editor`/`http-results-panel`）→ 单独清理 pass（涉及成组选择器，风险中等）。
- **"12 个被引用未定义类"已逐核：全部非问题** —— 3 个实为误报（`change-tree-folder`/`tool-group`/`http-code-line` 均有规则）；其余 9 个要么经祖先选择器生效（`composer-input`→`.composer-card textarea`、`http-tree-branch`→`.http-tree-row`、`plan-inspector-empty`/`mcp-server-list`/`plan-return-button`/`settings-mcp-section`/`settings-motion-state` 继承父级），要么是纯状态标记（`is-chat-open`/`is-chat-collapsed`，折叠由内联 grid 控制）。无真实样式缺口，可不动。
- SessionSidebar 的 `ProjectTree`/`SessionRow`/右键菜单、App 的 `WelcomeBlock`/`TopBar` 进一步拆分（依赖间接测试，需先补 App 测试）。
- 19 处单次使用 rgba tint → 可后续补 swatch 或保留字面量。
- `--text-*` 命名空间过载（字号 vs 颜色）→ 建议拆 `--font-size-*`。
- 引入 ESLint/Prettier + `lint` script（当前完全缺失）。

---

*附：详细子报告（对话框 / token / 巨型组件 / 死代码与规范）已由 4 个并行审计代理产出，本文为合并结论。*
