# PI Desk Layout Specification

## 目标

在调整图标和配色之前，先固定 PI Desk 的空间节奏：三栏尺寸、区域高度、组件 padding、组件间距、文字字号和图标占位尺寸都必须有明确规则。布局以“对话和代码为主、导航与上下文为辅”为原则。

本规范采用平衡密度：比传统 IDE 更轻，比普通聊天界面更有信息承载力。

## 1. 基础设计令牌

### 间距

以 4px 为基础单位，只允许优先使用以下值：

```text
--space-1:  4px   图标与文字、紧凑标签
--space-2:  8px   控件内部、同行元素
--space-3: 12px   输入框、按钮、卡片内部
--space-4: 16px   组件之间、内容区 padding
--space-5: 20px   区块之间
--space-6: 24px   页面边缘、主要内容留白
--space-8: 32px   大区块之间
```

禁止为了视觉微调继续引入 5px、7px、9px、13px、17px 等单次间距，除非是 1px 边框或明确的像素对齐。

### 圆角

```text
--radius-sm:  6px   小按钮、keycap、列表状态
--radius-md:  8px   普通按钮、输入框、列表行
--radius-lg: 12px   Composer、主要卡片、弹窗
--radius-xl: 16px   大型对话框
```

### 字号与行高

```text
--text-display: 24px / 32px   空状态主标题
--text-title:   15px / 20px   区域标题、Session 主标题
--text-message: 13.5px / 21px 正文、消息、Markdown
--text-body:    13px / 20px   普通 UI 文本、项目名称
--text-ui:      12px / 16px   按钮、选择器、Inspector 数据
--text-meta:    11px / 16px   辅助信息、标签、Tab
--text-micro:   10px / 14px   状态、快捷键、诊断信息
--text-mono:    12px / 18px   代码、路径、Diff、工具预览
```

10px 以下只用于非主要状态信息，不用于可操作控件、正文或项目/Session 名称。

## 2. 三栏外壳

```text
Sidebar:      248px target，224px minimum，320px maximum
Resizer:        4px
Main column:   minmax(0, 1fr)
Inspector:     300px target
```

应用窗口的可用内容宽度目标为 1200px 以上；在 1040px 到 1199px 之间，Sidebar 使用 224px，Inspector 仍由现有开关控制，不额外制造横向滚动。

三栏之间不使用厚重阴影分隔，使用 1px 边框和背景层级区分。拖拽区保持 4px 命中范围，视觉线不超过 1px。

## 3. 左侧 Sidebar

### 外壳

```text
顶部 padding:  48px 12px 0
底部 padding:  12px
内容区 gap:    16px
```

顶部 48px 用于兼容 macOS hidden-inset 标题栏；Windows 也保持相同顶部节奏，避免平台之间产生两套布局。

### 品牌与操作区

```text
品牌行高度:     32px
品牌与操作 gap:  8px
品牌文字:       15px / 20px，600
品牌行下方:     12px
```

品牌是导航标识，不与搜索、设置等操作使用同等视觉重量。

### 搜索与 New Session

```text
搜索框高度:       32px
搜索框 padding:    0 8px
搜索图标与文字:    8px
搜索与 New Session: 8px
New Session 高度:  34px
按钮左右 padding:  10px
```

### 项目树与 Session 列表

```text
区块标题高度:      28px
区块标题左右 padding: 8px
项目行高度:        32px
项目行 padding:     0 8px
项目名称:          13px / 20px，600
Session 行高度:    28px
Session 行 padding: 0 8px
Session 名称:      12px / 16px，400–500
Session meta:      11px / 16px
项目与 Session 缩进: 20px
项目区块之间:      16px
```

项目行承担展开/选择两个状态时，仍只使用一个 32px 行高；不要通过额外上下 padding 让项目树逐层变高。

### 底部用户区

```text
顶部边框:       1px
边框上方 padding: 12px
用户行高度:     36px
用户头像/图标槽: 20px
图标与文字:     8px
```

## 4. Topbar 与 Session Tab

```text
Topbar 高度:       44px
Topbar padding:     0 12px
左右操作 gap:       8px
Session Tab 高度:   32px
Tab 之间 gap:       4px
Tab 内部 padding:   0 8px
Tab 主标题:         12px / 16px，500
Tab 辅助项目名:     10px / 14px，500
Topbar 操作按钮:    30px 高
```

Session Tab 默认保持单行标题。只有确实需要同时显示项目名时才采用两行结构；快捷键不参与常态信息层级，优先作为 tooltip 或帮助面板信息。

## 5. 中间 Timeline

```text
聊天内容最大宽度:  760px
页面左右最小留白:  24px
Timeline 顶部:     24px
Timeline 底部:     20px
消息组之间:        20px
同一消息内段落:    12px
消息辅助信息:      8px
正文:              13.5px / 21px
工具预览与路径:    12px / 18px Mono
```

消息区域和 Composer 使用同一条内容轴线，不能分别使用不同的最大宽度或左右 padding。

## 6. 空状态

```text
空状态内容最大宽度:  520px
品牌/状态图形槽:      48px
图形与标题:           20px
标题:                 24px / 32px
标题与说明:           12px
说明:                 13px / 20px
说明与快捷操作:       32px
快捷操作卡片 gap:     8px
卡片 padding:         12px
```

空状态图形只作为辅助锚点，不占用比输入框更强的视觉权重。后续图标调整时，图形槽尺寸保持不变。

## 7. Composer

Composer 是中间区域的主要交互焦点。

```text
Composer 外部底部:     16px
Composer 与 Timeline:  12px
Composer 卡片 padding: 12px
Composer 圆角:         12px
输入区高度:            76px
输入文字:              13.5px / 21px
工具栏高度:            32px
工具栏上方:            8px
工具之间 gap:          8px
控制项左右 padding:    8px
发送按钮:              32px × 32px
快捷键提示上方:        8px
快捷键提示:            10px / 14px Mono
```

工具栏按优先级分为主操作和上下文设置。主操作固定在左侧，发送固定在右侧；项目、分支、Thinking 等低频设置不应挤压输入区。

## 8. 右侧 Inspector

```text
Inspector 宽度:       300px
Header 高度:         44px
Header 左右 padding: 16px
Inspector Tab 高度:  36px
Tab 文字:            11px / 16px
内容左右 padding:    16px
区块之间:            16px
区块标题高度:        28px
数据行最小高度:      28px
数据行之间:          8px
主要数据:            12px / 16px
状态/说明:            10–11px / 14–16px
```

Inspector 的 Tab 不使用过大的字号或上下 padding；四个 Tab 必须在 300px 宽度内保持清晰，不发生文字挤压。

## 9. 弹窗与浮层

```text
普通弹窗左右 padding: 16px
弹窗 Header 高度:     48px
弹窗区块之间:         16px
列表行最小高度:       36px
列表行左右 padding:   12px
帮助快捷键槽:         26px × 24px
浮层与触发器距离:     8px
```

弹窗内部继续使用同一套字号和 4px 间距，不单独创建更小的字体体系。

## 10. 图标占位与命中区域

这部分只规定布局槽位，不规定具体图标方案：

```text
小图标槽:             16px
普通图标槽:           18px
主要操作图标槽:       20px
紧凑按钮最小命中区:   28px × 28px
普通按钮最小命中区:   32px × 32px
图标与文字 gap:       8px
```

图标视觉尺寸可以是 14/16/18px，但可点击元素的命中区域不能随图标缩小。

## 11. 实施顺序

1. 先统一 spacing、radius、字号和区域尺寸 token。
2. 再调整 Sidebar、Topbar、Timeline、Composer、Inspector 的布局。
3. 验证宽窗口和 1040px 窗口下的内容轴线、文字换行和控件不溢出。
4. 布局稳定后，再应用深度配色规范。
5. 最后替换和细调图标，图标只改变视觉表达，不改变既定槽位和命中区域。

## 验收标准

- 主要区域只使用规范中的高度、padding 和间距。
- 正文、项目名、Session 名称和辅助信息不低于对应字号层级。
- Composer、Timeline 和 Inspector 不出现互相错位的内容轴线。
- 1040px 以上窗口不出现主要控件横向溢出。
- 图标更换不会改变按钮尺寸、行高或文字对齐。
- 配色和图标调整可以在布局规范之上独立进行。

