# Lucide 图标系统设计

## 背景

pi-desk 当前同时使用手写 SVG、emoji、字母标记和 Unicode 符号作为图标。它们的线宽、视觉重量、色彩和占用空间不一致，使侧边栏、Timeline、Composer、资源检查器和设置面板看起来像由多套 UI 语法拼接而成。

本次改造采用 Lucide 作为统一的线性图标来源。目标是让图标退到辅助层，主要通过排版、间距、颜色和状态点表达层级；不借此引入整套新的 UI 框架，也不改变现有业务行为。

## 目标

- 全局使用一致的 outline 图标语言。
- 移除业务界面中的 emoji、字母图标和 Unicode 状态符号。
- 让图标尺寸、线宽、颜色和对齐方式可预测。
- 保留现有 Radix headless 交互原语和自有 CSS 视觉体系。
- 保持 Electron 包体、可访问性和现有测试行为稳定。

## 非目标

- 本阶段不重做整体布局、配色、字体或侧边栏信息架构。
- 不引入 Tailwind、shadcn、Ant Design、MUI 等新的 UI 皮肤体系。
- 不为每一行内容强行增加图标。
- 不为品牌 Logo、第三方服务 Logo 或产品标识替换商标资产。

## 视觉规范

### 图标来源

使用 `lucide-react` 的具名 React 组件导入，保留 tree-shaking 能力。图标默认使用 `currentColor`，由所在控件或文本层级决定颜色。

### 尺寸

| 用途 | 尺寸 |
|---|---:|
| 极小状态/辅助 | 12px |
| 侧边栏、紧凑按钮 | 14px |
| 默认控件和行内图标 | 16px |
| 独立操作、面板标题 | 20px |
| 空状态或大面积提示 | 24px |

除非有明确理由，不新增其他尺寸。

### 线宽与形态

- 默认 `strokeWidth={1.5}`。
- 12–14px 的图标如果在深色背景上不够清晰，可以使用 1.75，但不单独改变图形形态。
- 保持 outline、圆角端点和圆角连接；不混入 filled、duotone 或带装饰性背景的图标。
- 选用图形时优先选择结构简单、轮廓可在 14–16px 识别的图标。

### 颜色与状态

- 正常图标继承文本颜色，不在 JSX 中写死 hex 颜色。
- hover、active、disabled 沿用现有控件的颜色 token。
- running、idle、waiting、error 等列表状态优先使用 CSS 小圆点；需要明确语义时再配合可读文本或 aria-label。
- 只有确认、危险、成功等明确反馈场景允许使用状态颜色。
- 默认不为每个图标添加圆形或方形彩色背景。

## 组件边界

新增集中导出模块 `src/renderer/components/icons.tsx`，负责两件事：

1. 集中导入项目实际使用的 Lucide 图标，避免各页面随意选择同义图标。
2. 提供项目级尺寸和线宽封装，避免组件中散落不同的 `size`、`strokeWidth` 和颜色配置。

封装组件应默认设置 `aria-hidden="true"`，因为装饰性图标不应重复朗读文本。图标按钮仍必须由调用方提供 `aria-label`、`title` 或可见文本；图标本身不能替代操作名称。

## 页面映射

### SessionSidebar

- 新建会话：`Plus`。
- 搜索：`Search`。
- 项目展开/折叠：`ChevronRight`，展开时旋转 90 度。
- 项目目录：`Folder`。
- 设置：`Settings2`。
- 删除、复制路径、在 Finder 中显示等上下文菜单动作仅在菜单中使用对应图标，普通行不增加图标。
- 移除 `📂` 项目 emoji。

### Composer

- 目录：`Folder`。
- 文件：`File`。
- 会话/消息：`MessageSquare`。
- 移除 `📁`、`📄`、`💬`。

### Timeline

- 用户消息：`User`，不再额外使用字母头像。
- 思考：`Brain`。
- 工具调用：`Wrench`。
- 错误/审批：分别使用 `CircleAlert`、`ShieldAlert`。
- 完成：优先使用状态点；需要独立提示时使用 `Check`。
- 移除 `T` 等字母型 Timeline 图标，并减少默认彩色 icon tile。

### ResourceInspector

- 文件类型使用 `FileText`、`FileCode2`、`FileJson`、`FileCog` 等少量稳定映射。
- 目录使用 `Folder`。
- 状态使用小圆点或 `CircleCheck`、`CircleAlert`，不使用随机字母和多套背景色。

### SettingsDialog 与 SessionTabBar

- 外链：`ExternalLink`。
- 快捷键：`Keyboard`。
- 信息：`Info`。
- 更多：`MoreHorizontal`。
- 成功/失败：`Check`、`X`。
- 图钉：`Pin`，固定状态可以使用当前颜色填充，但不改变其他图标的全局 outline 规则。
- 移除 `↗`、`⌨`、`ℹ`、`…`、`✓`、`✕` 作为 UI 图标。

### 跨页面通用控件

- 所有关闭按钮统一使用 `X`，包括设置、帮助、项目选择、Session tree、Inspector 和 Tab 关闭按钮。
- 所有展开/折叠控件统一使用 `ChevronRight`，包括 Timeline activity、tool group 和 Inspector section；展开时旋转 90 度。
- Todo 状态使用 `CircleCheck`、`CircleDot`、`Minus`、`Circle` 的线性图标映射，保留现有状态颜色，不再把 Unicode 符号作为视觉标记。
- 键盘快捷键中的 `⌘`、`⌥`、`⇧` 仍作为可读的键帽文字保留，它们不是图标资产。
- 文案里的省略号（例如 `Loading…`、`Delete…`）仍作为文本保留，不替换为图标。

## 实施顺序

1. 添加 `lucide-react` 依赖和集中图标模块。
2. 先迁移全局控件：侧边栏、顶部操作、Tab 操作和设置动作。
3. 再迁移内容型图标：Composer、Timeline、ResourceInspector。
4. 删除不再使用的手写 SVG 和 emoji/Unicode 图标样式。
5. 检查暗色背景下的尺寸、线宽、垂直对齐和 hover/focus 状态。

每一步保持组件行为不变，避免在图标迁移中混入状态管理或布局重构。

## 验证标准

- `npm run typecheck` 通过。
- `npm test` 通过。
- `rg` 不再在渲染组件中发现本次范围内的 emoji 图标、字母型状态图标和 Unicode 图标。
- 图标按钮仍具备可访问名称，装饰性图标不重复读屏。
- 在侧边栏、Timeline、Composer、ResourceInspector 和 SettingsDialog 中，图标尺寸、颜色和线宽符合本规范。
- Electron 构建成功，未引入不必要的整包图标导入。

## 许可证记录

Lucide 采用 ISC License，允许商业使用。发布 Electron 应用时，在项目的第三方依赖说明或 About 页面保留 Lucide 的名称、版本和许可证文本；如使用品牌 Logo 图标，另行确认对应商标和资产许可。
