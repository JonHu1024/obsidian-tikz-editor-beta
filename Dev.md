# Dev.md — TikZ Editor 插件实际架构速查（对接用）

> 作用对象：`D:\Codes\LittleTools\ObsidianPlugin\tikz-editor`。
> 参考交互：EasyTikZ、TikZJax、draw.io。

---

## 〇、最近会话变更（2026-08-07 第二次：cd 参考编辑器键盘"新纪元"，测试 181 项全 PASS）

本次只动 **cd 参考编辑器（Preact `src/cd/`）的键盘** + 相关键位注册/状态栏/测试，picture 模式未动。

1. **废除全部 hjkl（六宫格/方向键替换）**：
   - 移动选中格：`↑↓←→` 或小键盘数字 **1/2/3/4/6/7/8/9**（九宫格，y 向下，`App.js` 的 `dirs` map）。
   - `a`（`cd.arrowFlow`）起手后，方向只能是**方向键/数字九宫格**（hjkl 不再是合法方向），下一键一步建箭并保持选中。
   - 恢复 **x 两步流**：`x` → 方向键移动目标格 → `Enter`/`x` 确认建箭（与旧 x→x 两按不同，现在是"锚起点、键盘选终点"）。
2. **多字符命令缓冲（App 层 `_cmdSeq`，600ms 窗口归零）**：`ok` 插入并退出、`cp` 复制代码、`dd`（无箭头选中时）清空格子文本。App 层 letter 处理先于 undo/redo/`x`，且 TEXTAREA 守卫在最早（代码面板打字绝不触发）。
3. **`r` 全局 redo**：`CdPanel.buildKeys()` 现在传 `redo:[s["cd.redo"]??"r", mod+y]`；App 层 `kb("redo",["r","mod+y"])` 命中。
4. **箭头选中（Properties 键盘，仍旧全部在参考 UI）**：反转 `R`→`op`；cycle 尾/头/标签位置 `t`/`h`/`l`；线型（旧 `d/D/=/2`）→ `ds` 虚线 / `dt` 点线 / `sd` 实线 / `db` 双线；平移/弯曲 = `↑/↓`(+Shift)；删除 `Delete` → `dd`；Enter 改标签。
5. **新增 `e` 重绑定终点**（重要）：箭头选中按 `e` → `App.startRebindEnd`（箭头取消选中，把终点格当游标），方向键移动、`Enter` 用 `applyRebindEnd` 固定、`Esc`/`Alt` 用 `cancelRebind` 取消并恢复选中。loop 箭头的 `e` 走 rotate。
   - ⚠️ `startRebindEnd` 以 props 回调传给 Properties，**必须是箭头函数**（曾因未绑定，点击时 `this` 为 undefined，报 `Cannot read properties of undefined (reading 'state')`）。
6. **keybindings.ts 重构**：
   - `cd` 组：去 nav/cellBelow/cellAbove，改为 `editCell`/`arrowFlow`/`arrowTarget`(=x)/`clearCell`(=dd)/`redo`(=r)/`copyCode`(=cp)。
   - `cdarrow` 组：新 id 对应新键（`reverse=op`、`cycleTail=t`、`cycleHead=h`、`cycleLabelPos=l`、`lineDashed=ds`、`lineDotted=dt`、`lineSolid=sd`、`lineDouble=db`、`linePhantom=p`、`shiftLeft/Right=↑/↓`、`bendLeft/Right=Shift+↑/↓`、`delete=dd`、`rebindEnd=e`、`loopRotate=e`、`editLabel=Enter`）。
   - **旧 cdarrow id（`swap`/`tipPicker`/`rebindStart`/`labelPos`/`labelLong`/`bend*`/`resetBend`/`lineX`/`loop*` 等）全部保留在原处**、label 加 `(legacy)` 前缀——插件**自身 NORMAL 模式（picture 环境）的箭头编辑**（`op` 交换端点、`a` 头选择器、…) 仍依赖这些 id（测试 32/33/40）。参考编辑器按键是硬编码的，不受注册表影响。
7. **StatusBar.svelte / CdPanel.svelte**：cd 提示文案改为新键位（硬编码字符串，不再 `kb()` 渲染已删的 nav id）；`startCd` 状态栏消息也更新。
8. **测试**：改了 `src/cd/*` 必须重跑 `node test/build-harness.mjs`（`npm run build` 只编 main.js，不会更新 harness.js，否则跑的是旧 bundle）。cd 键盘用例（39/46/47/49/51/52）改用方向键/序列键 + `r` 反转→`op`、`Delete`→`dd`；**新增 53**（`x` 两步流、`e` 重绑定 + Esc 取消、`dd` 清格）。断言总数 **181**，全 PASS。

---

## 〇（历史）、最近会话变更（2026-08-07 第一次：cd 模式四个特性 + 环境迁移，全部完成并全绿）

本次会话只动了 **tikzcd (cd) 模式**，没有动 picture 模式的逻辑。变更点（详见 §五bis/§六/§八）：

1. **单元格/箭头文字直接渲染原文**（不再包 `\\(…\\)`，显示即所输）：
   - `src/cd/typeset.js`：只剥 `\(\)`/`\[\]` 定界符，删掉了剥裸括号 `(…)` 的 hack。
   - `src/cd/GridCell.js` / `GridArrow.js`：value 直接渲染 `this.props.value`。
2. **左舞台 60% + 右代码面板 40%（常驻，替代 CodeBox modal）**：
   - `src/cd/App.js` render：`#root.te-cd-root` → `.te-cd-stage`（Grid + Properties + 工具箱）+ `.te-cd-code`（标题栏 Insert/Back、textarea、底部 Parse）。
   - 工具箱只剩 Pan/Arrow/Undo/Redo；`CodeBox.js` 已删除；`showCodeBox`/`confirmLinkCopy`/`handleCopyCode`/`openCodeBox` 全部移除。
   - `codeValue` 在 `handleDataChange` 与 `moveInHistory` 里同步（undo/redo 后代码面板跟着变）。
   - 修复 bug：`moveInHistory` 的局部变量曾叫 `diagram`，遮蔽了模块 `diagram`，导致 `diagram.toTeX` 抛错、cd 的 `u` undo 静默失效。
3. **键盘箭头流：`a` + 方向一步建箭**（同 tikzpicture 的 `a`+方向；旧的 `x`→方向→`x` 两步流已删）：
   - `App.js` `_onKeyDown`：`a` 起手（键位 `cd.arrowFlow`，可配置），下一个方向键（方向键 / hjkl / **数字 1-9** 九宫格，y 向下）直接 `placeKeyboardArrow(arrowFlowFrom+d, arrowFlowFrom)` 建箭并保持选中；Escape/其他键取消。
   - 顶部新增 **TEXTAREA 守卫**：在代码面板打字不触发任何快捷键。
   - `d` 在箭头选中时让位给 Properties（App 层 `selectedArrow != null` 直接 return）。
   - `src/components/Preview/CdPanel.svelte`：arrowFlow 回落键 `"x"` → `"a"`，状态栏文案更新。
   - `src/vim/keybindings.ts`：`cd.arrowFlow` 的 desc 更新（def 本来就已是 `a`）。
4. **箭头样式键徽标（badge）**：
   - `src/cd/Toolbox.js` Button 新增 `badge` prop（`<span class="badge">`）。
   - `src/cd/Properties.js`：每个按钮带徽标 + keydown map 扩展：`R` 反转、`t/m/h` 尾、`T/n/H` 头、`d/D/=/+/2` 线型、`s/S/b/B` 平移/弯曲、`↑/↓`(+Shift)、`a/l/'` 标签位置、`e` 旋转 loop、`0` 复位弯移（新增 `resetbend` handler）、Enter 改标签、Del 删除；guard 加了 TEXTAREA 判断。
   - `styles.css` 尾部新增：`.te-cd #root.te-cd-root` 分栏、`.te-cd-stage/.te-cd-code*`、`.toolbox li.button .badge`。
5. **测试（176 项全 PASS，测试 50/51/52 重写）**：
   - 50：60/40 分栏 + 实时代码面板 + Parse 重同步（注意 harness 的 `#root` 是挂载点，断言用 `querySelector(".te-cd-root")`）。
   - 51：`a`+`l` 一步建箭 + 空节点 + 箭头保持选中（`#properties.show`）。
   - 52：Copy Code 按钮已移除、Arrow/Pan toggle、徽标存在（R/d/D/…）、打字 `d` 直接虚线、Back 退出。
6. **环境迁移（Windows 原生 node 可跑，不再依赖 WSL）**：
   - `npm install --no-save @esbuild/win32-x64@0.21.5`（重装依赖后要重装一次）。
   - `test/run-test.mjs` 开头自动探测 chromium：Windows 走 `%USERPROFILE%\AppData\Local\ms-playwright\chromium-1217\chrome-win64\chrome.exe`，Linux 走 `$HOME/.cache/ms-playwright/chromium-1228/…`。
   - 命令见 §九：`tsc` / `esbuild production` / `build-harness` / `run-test`，全部 Windows 原生 node 直接跑。

---

## 一、这是什么

Obsidian 插件：一个可视化 TikZ 编辑器，带类 Vim 的无鼠标编辑模式、实时预览、
属性面板、对象拖拽/缩放。支持两种生成环境：

- **tikzpicture（`picture`）**：完整功能（text / 各类 shape / arrow / function / axis / grid）。
- **tikzcd（`cd`）**：网格化 "单元格" 视角，只做 文本 + 箭头（可配置键位）。

核心亮点：**所有键盘命令可配置**（Settings → Keybindings，逐命令 + 多键序列 + `mod+N`）。

---

## 二、技术栈

| 层面 | 选型 | 备注 |
|------|------|------|
| UI | **Svelte 4** | 编译时组件，Obsidian 插件主流 |
| 语言 | **TypeScript** | `tsc -noEmit -skipLibCheck` 校验 |
| 渲染 | **TikZJax (WASM)** | 打包了 patched 渲染器脚本，TeX 内核(~10MB)按需下载一次，缓存进 IndexedDB，之后离线 |
| 构建 | **esbuild + esbuild-svelte** | `esbuild.config.mjs` |
| 代码编辑 | **CodeMirror 6**（`@codemirror/*`，Obsidian 内置） | Code 标签页 |
| 数学 | **KaTeX** | 内联 CSS，作用域限 `.te-root` |
| 测试 | **Playwright-core + 自产 harness** | 无真实浏览器 UI 依赖 |
| 后端 | `pako` 解压 .gz 内核；无服务端 | |

> ⚠️ 构建/测试在 **Windows 原生 node** 上跑（需 `@esbuild/win32-x64`；WSL 也可，但本机 WSL node 已不可用）。见 §九。

---

## 三、源码布局（实际）

```
src/
├── main.ts                    # 插件入口：注册命令/ribbon/设置tab，打开 Modal
├── settings.ts                # 设置项 + 默认值 + Settings Tab UI（含 Keybindings 分组）
├── TikZEditorModal.ts         # Obsidian Modal，承载 Svelte 根组件，loadFromContext 解析代码块
├── EditorController.ts        # 核心控制器单例 `editor`（对象/箭头/cd/历史/相机）
├── state.ts               # Svelte stores（跨组件共享状态）
├── types.d.ts                 # CJS/资源模块类型声明
│
├── core/                      # 与 Obsidian 解耦的核心逻辑
│   ├── types.ts               # 数据模型 TikZGraph/TikZObject + 工具函数
│   ├── TikZParser.ts          # 解析 TikZ 代码 -> 数据模型（tikzpicture + tikzcd 两套）
│   ├── TikZGenerator.ts       # 数据模型 -> TikZ 代码
│   ├── TikZEngine.ts          # TikZJax 封装（WASM 内核按需下载 + IndexedDB 缓存 + render）
│   ├── HistoryManager.ts      # Undo/Redo（快照克隆）
│   ├── SVGExporter.ts         # SVG 导出
│   └── (资源) fonts-embedded.css / katex-inline.css / tikzjax-bundle.tikzjaxjs
│
├── vim/
│   ├── VimController.ts       # Vim 模式状态机（NORMAL/INSERT/ARROW_EDITING）+ 命令分发
│   └── keybindings.ts         # 键位注册表 + 默认键 + keyMatches(charmap)
│
├── utils/
│   ├── geometry.ts            # cm <-> 屏幕坐标换算 PT_PER_CM=28.3465
│   ├── colors.ts              # 命名颜色表 + SHAPES 列表
│   ├── math.ts                # 表达式解析/求值（函数面板）
│   └── mathText.ts            # $math$ -> HTML 渲染
│
└── components/                # Svelte 组件
    ├── App.svelte             # 根组件：窗口级 keydown/keyup(Vim + toolHeld)、KaTeX css、布局、cdMode 整屏切换
    ├── Preview/
    │   ├── Toolbar.svelte       # 创建/Undo/Copy Code/Insert/cd 工具，见 §五
    │   ├── PreviewCanvas.svelte # 左侧编辑画布：伪渲染(直接画模型)、拖拽/缩放/pan、tikzpicture 使用
    │   ├── InsertOverlay.svelte # INSERT 模式的文本编辑浮层
    │   ├── StatusBar.svelte     # 模式 + 命令缓冲 + 提示（配置驱动）
    │   ├── CdPanel.svelte       # tikzcd (cd) 模式宿主：内嵌 Preact 参考编辑器 port，见 §五bis
    │   └── (孤儿) PreviewPanel.svelte / TruePreview.svelte  # 未接入
    ├── Properties/
    │   ├── PropertiesPanel.svelte # 属性区容器（导航 + 各 Section；仅 picture 模式）
    │   ├── GraphSection / AxisSection / GridSection / FunctionsSection
    │   ├── NodesSection           # 节点(对象)属性
    │   ├── ReferenceSection       # 参考文档（只读）
    │   └── CodeSection.svelte     # CodeMirror 6 代码标签页（Edit/Run 双态）
    └── shared/
        ├── ArrowTipPicker.svelte
        ├── ColorPicker.svelte
        └── ShapePicker.svelte

cd/                           # yishn/tikzcd-editor (MIT) 的 Preact port
├── App.js                    # 入口组件：键盘(方向键/九宫格 移动、a+方向、x 两步、dd/cp/ok、u/r undo/redo) + 状态 + 历史
├── diagram.ts                # graph(=TikZGraph) ↔ diagram({nodes,edges}) 双向桥（CELL=1.6）
├── Grid.js / GridCell.js / GridArrow.js
├── Properties.js / Toolbox.js
├── helper.js / geometry.js / typeset.js
├── icons.ts + img/           # SVG 图标（esbuild 打包成 dataurl）
└── (样式在根 styles.css 的 `.te-cd` 作用域)
```

---

## 四、核心数据流

```
用户操作（键盘 Vim / 鼠标 / 属性面板）
        ↓
VimController.keydown() 或 鼠标 handle / Svelte 绑定
        ↓
EditorController.* (mutate() 克隆+变更+记历史)
        ↓
graph store 更新  →  PreviewCanvas 重画 + StatusBar 反馈
                  →  (CodeSection / engine.render 生成最终 TikZ)
        ↓
TikZGenerator.generateTikZ(graph)  -> TikZ 代码字符串
        ↓
TikZEngine.render()（真实 TeX 预览，参考）
```

**渲染策略（重点）**：左侧编辑画布是 **伪渲染**——每个对象直接画成 SVG 元素
（所见即所得、命中区 = 可见图形 = 编辑框，天然无错位）。真正的 TeX 渲染（TikZJax）
仅作"参考/校验"，不易参与编辑。错位校准通过 Settings → 校准流程修正 cm↔px 偏移。

---

## 五、模块职责速览

### settings.ts + keybindings.ts（键位可配置化）

- `TikZEditorSettings.keybinds: Record<string,string>`：每命令一行。缺失 id 回落 `DEFAULT_KEYS`。
- `src/vim/keybindings.ts` 定义：
  - `KEYBINDS: KeybindDef[]`（id/group/label/desc/def）——唯一键位真相来源。
  - `DEFAULT_KEYS = fromEntries(...)`。
  - `keyMatches(binding, e)`：支持 `mod+N`、别名逗号分隔、单字符、命名键（Enter/Space/...）。
  - `charKey(binding)`。
- group：`normal | cd | cdarrow | tool | system`。Settings Tab 按 group 分组渲染 text input + Reset。

### EditorController（`editor` 单例）
围绕模型 + 历史的命令实现，典型方法（`src/EditorController.ts`）：
- 加载/变更：`attach(plugin)`、`loadGraph`、`mutate(fn, merge)`（克隆 → 变更 → 记史）、`computeContentExtent`/`refreshCanvasExtent`（无限画布自动增长）。
- 相机：`zoomBy/zoomAt`、`pan* cm↔local`、`ensureVisible/centerOnContent/screenCenterCm`。
- 对象 CRUD：`createText/createShape/createFunction/createArrow`、`deleteSelected`、`moveSelected/dragObject`、`cycleSelection/selectByClick/selectAndCenter`、`swapArrow/reanchorArrowEndpoints`、`moveArrow/resizeArrow`、`setArrowStyle/setArrowTip/Tips`。
- 箭头创建流程：`beginArrowFlow`（dir 九宫格 / pick 端选择）、`onPick`（点击/Tab+Enter）、`confirmPick`、`cancelArrowFlow`、`getArrowFreeEndpoint`。
- 插入文字：`startInsert(id, field)` / `finishInsert`，字段 `text | textBelow | expression`。
- Undo/Redo：`HistoryManager`；`undo/redo/clearBuffer`。
- **tikz-cd (cd) 支持**：`cdCursorMove/cdCursorEnter/cdCursorAtCm`、`createCdArrowBetween`、`insertCdCell(id, below)`、`addLoopToCell`、`toggleEnv`（picture↔cd）、及一组 `setCd*` 样式控制（tail/head/labelPos/labelLong/bend/shift/loop/dash）。

### VimController（状态机 + 命令分发）`src/vim/VimController.ts`
- 模式：`NORMAL | INSERT | ARROW_EDITING`。
- **全部键位配置驱动**：`kb(id)` = 测试 override（`setTestKeybinds`）?? settings.keybinds[id] ?? DEFAULT_KEYS[id]。
- 命令以 `CommandDef{id, ...}` 注册，用 id 绑定到 editor 方法；匹配支持别名/多键（`redo`,`op`,`env`,`ok`）。
- NORMAL 下 cd 网格导航：**在 cdMode 下整个 vim 层被旁路**（`App.svelte.onKeyDown` 头两行 `if (cdMode) return;`）——cd 的键盘全部由 `src/cd/App.js` 的 document 监听器接管。`env` 命令仅在 picture 模式可用作入口，退出 cd 用工具箱 "Back to editor" 按钮（`onExit`）而非 vim。
- `Ctrl/Alt+Z/Y`、`svg`、`ok`、`focusNodesSearch` 等系统命令。

### PreviewCanvas.svelte（左侧画布核心）
- 绘制：对象 → 元素；选中环；resize handle；cd 网格线 + 当前单元格高亮（**仅 picture 模式**；cd 模式整屏由 `CdPanel` 替换，见下）。

### §五bis — tikzcd (cd) 模式 = Preact 参考编辑器 port（`src/cd/`）
- 沿用 `yishn/tikzcd-editor`（MIT）的 UI 与状态模型（`{nodes, edges}`），改动点：
  - 无 location.hash/enter URL：代码改为右侧**常驻代码面板**（左舞台 60% + 右代码 40%，`#root.te-cd-root` 内 `.te-cd-stage`/`.te-cd-code`），不再有 modal（CodeBox.js 已删除）。
  - 桥接：每次 diagram 变更 → `diagramToGraph` → `editor.mutate`（`env:"cd"`，覆盖 objects），使 Code 标签/Insert/退出一致。
  - 新增键盘（2026-08-07 二次重构）：方向键/小键盘数字 1-9 移动选中格（**hjkl 已废除**）；`a`（可配置 `cd.arrowFlow`）起手，下一个方向键（方向键/数字 1-9，九宫格布局、y 向下）**一步**建箭并选中（同 tikzpicture 的 `a`+方向）；`x` 锚当前格为起点、方向键选终点、`Enter`/`x` 确认建箭；`u`/`Ctrl+Z` undo、`r`/`Ctrl+Y` redo（走自身 history + `onDiagramChange` 回写）；`dd` 清空格子文本。
  - **插件风格键**：`ok`（o→k 多字符缓冲）= 插入代码并自动关闭；`cp` 复制代码；`Alt`/`Escape` 退出覆盖层；`Tab` 循环（箭头选中循环同起点箭头，否则循环单元格）；`i`/`Enter` 进入格编辑。
  - **箭头样式快捷键 + 徽标（2026-08-07 二次更新）**：箭头选中时 Properties 面板每个按钮带 ≤3 字符键徽标（badge），直接打字即设样式：`op` 反转、`t` 尾循环、`h` 头循环、`l` 标签位置循环、`ds` 虚线 / `dt` 点线 / `sd` 实线 / `db` 双线、`↑/`(+Shift) 平移/弯曲、`e` 重绑定终点（loop 时旋转）、`dd` 删除箭头、Enter 改标签。Properties 的 keydown map 接管（App 层在箭头选中时对相关键放行/return）。
  - 图标经 `icons.ts` + esbuild `dataurl` loader 内联（`.svg`）。**icon() 必须兜底 `img/` 前缀**：icons.ts 的 key 带 `img/` 前缀，而所有调用点传 `tools/...`/`arrow/...`/`properties/...`（`ICONS[p] ?? ICONS["img/"+p]`），否则所有图标/箭头空。
  - **typesetClear 绝不能销毁原文**：cd 组件 `componentWillUpdate` 曾 `innerHTML=""` + typesetClear 换成 `_` 占位，导致 `typesetPromise` 只读到 `_`（KaTeX 报错），单元格/箭头文字"消失"。现在 typesetClear 是 no-op、不再 wipe（原始 text 由 Preact 每次更新替换）。
  - **单元格/箭头文字直接渲染原文**：GridCell/GridArrow 的值不再包 `\\(…\\)`（KaTeX 经 typeset.js 只剥 `\(\)`/`\[\]` 定界符，不再剥裸括号 `(…)`），显示即所输。
- 样式：全部在 `styles.css` 的 **`.te-cd` 作用域**下；`CdPanel` 根 div 必须带 `te-cd` class，否则 `#grid ol` 不会 display:grid、箭头没位置（测试踩过）。布局/徽标 CSS 在 styles.css 尾部（`.te-cd #root.te-cd-root`、`.te-cd-stage`、`.te-cd-code*`、`.toolbox li.button .badge`）。
- 键盘绑定来自 `CdPanel.buildKeys()`：`arrowFlow`（默认 "a"，可配置 `cd.arrowFlow`）、`undo`（`normal.undo`+mod+z）、`redo`（`cd.redo` 即 "r" + mod+y）。App.js 的 `match()` 支持数组键。keydown 最顶部有 **TEXTAREA 守卫**（在代码面板打字绝不触发快捷键）。
- 注：`diagramToGraph` 每次重生成对象 id，故测试里箭头对象不能按 id 追引用（见 §八）。

### Toolbar / StatusBar
- Toolbar：text/Shape/Arrow 创建、Undo/Redo、Insert；cd 模式下 main Toolbar 不渲染（被 CdPanel 顶替），cd 自己的工具箱只含 Arrow/Pan/Undo/Redo，Insert/Back 移到代码面板标题栏（`.te-cd-code-bar`），Parse 在面板底部。
- **cd 模式也渲染插件 `StatusBar`**（App.svelte 的 cd 分支在 CdPanel 下方），显示 `[tikzcd] NORMAL MODE` + 状态消息；cd 模式的命令提示在 statusMessage（"click a cell to edit, Shift-drag…, a+direction draws an arrow…"）。
- cd 键位提醒：`ok`/`cp`/`dd`（多字符缓冲）、`a`/`x`（建箭）、`u`/`r`/`Tab`/`i`/`e` 都是 **CdApp 自己**的 document keydown（不走插件 vim 层，vim 在 cd 模式仍旁路；箭头选中的 `op/dt/ds/…` 由 Properties 面板的 keydown map 接管）；编辑格/代码面板打字时除 Escape/Alt 外全部让位给输入框（TEXTAREA 守卫）。

---

## 六、易踩的"坑"

1. **`mutate(fn)` 先克隆再应用** —— 想在 callback 外捕获并修改的对象引用会在克隆后丢失。必须在 callback 内操作 `g`。
2. **构建/测试在 Windows 原生 node 即可**（本机已装 `@esbuild/win32-x64`，若重装依赖会回退成 linux-x64 报 platform mismatch，需 `npm install --no-save @esbuild/win32-x64@0.21.5`）。tsc：`node node_modules\typescript\bin\tsc -noEmit -skipLibCheck`（**别用 `npx tsc`**，会误装 tsc@2.0.3 垃圾包）。测试脚本会自动找 chromium：Windows 走 `%USERPROFILE%\AppData\Local\ms-playwright\chromium-1217\chrome-win64\chrome.exe`，WSL/Linux 走 `$HOME/.cache/ms-playwright/chromium-1228/…`。
3. **cd 模式主体是 Preact（`src/cd/`），不是 Svelte**：入口 `CdPanel.svelte` 只挂容器 + 桥接；cd 的 document 级 keydown 由 `CdApp` 注册，退出的 destroy 用 `render(null)` 清理。
4. **cd 的 undo/redo 必须回写**：`moveInHistory` 走完自身 history 后要调 `onDiagramChange`（否则 plugin graph 不更新，Code 标签/退出时不一致）。⚠️ `moveInHistory` 里局部变量不能叫 `diagram`（会遮蔽模块 `diagram`，`diagram.toTeX` 直接炸、undo 静默失效）。
5. **键盘箭头流一步建箭**：`a` 起手快照 `arrowFlowFrom`，下一个方向键（方向键/数字 1-9，**hjkl 不再合法**）直接 `placeKeyboardArrow(arrowFlowFrom+d, arrowFlowFrom)` 建箭+选中；非方向键/Escape 取消。另有一套 **x 两步流**（`x` 锚当前格、方向键移目标、`Enter`/`x` 确认）在 App 的 `_xFrom` 分支。
6. **`.te-cd-wrap` 必须同时带 `te-cd` class**，否则根 styles.css 的 `.te-cd *`/`#grid ol` 无效，参考 UI 退化成无序列表。
7. **TikZJax 内核按需下载**（`s3.us-east-2.amazonaws.com`）+ IndexedDB 缓存；测试环境不真正下载（`testMarkCoreReady` 可跳过）。
8. **复位键位**：Settings 有 Reset；测试通过 `window.__te.setKeybinds` 注入测试键位，避免污染。
9. 文本换行用 `\\`，支持 `$...$` 数学；中文不受 TikZJax 支持（显示明确错误）。
10. **键盘建箭后要让箭头保持选中**：`placeKeyboardArrow` 传 `selectedCell` 会让 `handleDataChange` 把 `selectedArrow` 置 null，属性面板（标签输入）就编辑不到箭头——参考 UI 的 Shift 拖拽建箭后箭头是选中的，键盘流也应一致（不传 selectedCell）。

---

## 七、Settings 字段（settings.ts）

| 字段 | 类型 | 说明 |
|------|------|------|
| `defaultEnv` | `picture|cd` | 新建块默认环境 |
| `renderDelay` | number | 渲染防抖 ms |
| `defaultWidth/Height` | number | 空画布默认大小 (cm) |
| `defaultZoom` | number | 默认缩放 |
| `defaultTextWidth/Formula/ShapeSize/ArrowLength` | number | 创建默认参数 |
| `focusLeft/focusRight` | string | 左右栏聚焦（`mod+h`/`mod+l`） |
| `undoKey/redoKey` | string | 快捷 |
| `keybinds` | `Record<string,string>` | 每命令键位（回落 DEFAULT_KEYS） |

---

## 八、测试（Playwright harness）

- `test/harness.ts` / `test/harness.css` / `test/index.html`：Svelte 根组件 + `window.__te` 暴露（`editor`、`open`、`generateCode`、`parseCode`、`getState()`、`setKeybinds`）。
  - **index.html 必须 `<link>` 引入根 `styles.css`**（否则参考 UI 无布局，测试全挂）。
  - harness 构建走 esbuild：`.js` 用 `jsx` loader + `jsxFactory:"h"`（Preact）。
- `test/run-test.mjs`（Playwright 驱动）：线性跑断言（每 `check()` 一行 `PASS`），目前 **181 项全 PASS**，覆盖：
  - 基本：模式、undo/redo、Tab 循环、形状、Code tab 编辑同步、错误徽标。
  - 参考 cd UI（测试 46–53，全部驱动真实 DOM）：
    - 46：Shift 拖拽建箭头 → 属性面板 keydown（Shift+↑=bend 步进到 49、↑/↓=shift ±1、`op` 反转端点、Enter 改标签、`dd` 删除）。
    - 47：**方向键**移动选中格（`data-position` 断言）、点击单元格进入 edit 并输入文本。
    - 48：单元格 `.loop` 按钮创建自环箭头、`e` 旋转 loop 90°。
    - 49：`u` undo、`Ctrl+Y` redo（回写 plugin graph）。
    - 50：60/40 分栏（`.te-cd-root`/`.te-cd-stage`/`.te-cd-code`，无 modal）、代码面板实时显示 tikzcd、改码 Parse → 网格更新（`A \arrow[r] & B` 才成对）、Parse 后面板不关且重同步。
    - 51：`a`+`ArrowRight` 键盘箭头流一步建箭 + 空节点 + 箭头保持选中（`#properties.show`）。
    - 52：Copy Code 按钮已移除、Arrow/Pan 工具 toggle（`#grid.arrow/.pan`）、属性按钮键徽标（op/dt/ds/db/…）、打字 `ds` 直接虚线、Back to editor 退出 cd（env→picture）。
    - 53：`dd` 清空格子文本、`x`+方向+`Enter` 两步建箭并保持选中、`e`+方向+`Enter` 重绑定终点、`Esc` 取消重绑定。
  - 帮助函数：`startCd`（reload + 键入 `env` + 等 `#grid`）、`putCell`、`cellCenter`、`shiftDrag`、`cdArrow/cdArrowCount`。
- **踩坑**：cd 箭头对象 id 每次 diagram→graph 重建，不能跨操作按 id 找；测试用"当前唯一箭头"（`cdArrow(null)`）断言。harness 的 index.html 自带 `<div id="root">` 挂载点，`getElementById("root")` 取到的是它而非 Preact 的 `#root.te-cd-root`——要断言分栏用 `querySelector(".te-cd-root")`。**改 `src/cd/*` 后必须重跑 `node test/build-harness.mjs`**（`npm run build` 只编 main.js，不会更新 harness.js，否则跑的是旧 bundle）。

---

## 九、常用命令（Windows 原生）

```bash
node node_modules/typescript/bin/tsc -noEmit -skipLibCheck            # 类型检查
node esbuild.config.mjs production                                     # 生产构建
node test/build-harness.mjs                                            # 编译测试 harness
node test/run-test.mjs                                                 # 跑全部测试 -> ALL TESTS PASSED
```

全绿后记得 `check` `ALL TESTS PASSED`。改某块后可只关注相关 test。

---

## 典型的"下一步"对接点（历史 TODO 遗留）

1. Toolbar 的传送（详见 §五）已就位；新增按钮如 `Undo/Redo` 直接包 `editor.undo()/redo()`。
2. Reference 文档 (`ReferenceSection.svelte`) 仍待补全快捷键/对象速查（可自动读 KEYBINDS）。
3. 孤儿组件 TruePreview/PreviewPanel 清理或接入。
4. 为新增键位配置自动生成设置 UI 已实现（按 group）；若新增命令记得在 `keybindings.ts` 加 KEYBINDS 定义。
```

（末尾按需可追加：新命令 = 在 `keybindings.ts` 加定义 + Settings 自动渲染 + VimController 命令注册 + (可选) 测试。）