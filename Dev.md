# Dev.md — TikZ Editor 插件实际架构速查（对接用）

> 作用对象：`D:\Codes\LittleTools\ObsidianPlugin\tikz-editor`。
> 参考交互：EasyTikZ、TikZJax、draw.io。

---

## 〇-A、全量代码审核与修复（2026-11-01）

一次覆盖 picture 模式、tikzcd（Preact）子树、解析器/生成器与插件宿主的全量审核。
修复 20 个缺陷 + 8 项体验改进，新增 `test/run-audit.mjs`（54 项回归），
并**补齐了缺失的 TikZJax 端到端夹具** `test/tikzjax-runtime.html.frag`，
使 `test/run-e2e-tikzjax.mjs` 第一次真正跑通（生成的代码在真实引擎里 COMPILES）。

### A1. 致命：Code 页签整体失效

`src/components/Properties/CodeSection.svelte` 用了 `editor.replaceGraph(...)` 却**没有
import `editor`**。`tsc` 不检查 `.svelte`（tsconfig 的 include 对 tsc 无效），
esbuild-svelte 也不做类型检查 → 错误一路漏到发布版 `main.js`。
运行时点 **Run (Ctrl+S)** 抛 `ReferenceError: editor is not defined`，被 try/catch
吞成一条假的 “Parse error” 横幅，代码**永远不会被应用**，编辑器卡在 EDITING。
这也让"代码块解析失败后的修复路径"彻底不可用。

> **教训**：`tsc -noEmit` 对本仓库的 `.svelte` 文件是**无效的**。
> 要么加 `svelte-check`，要么在评审时人工核对 import。

### A2. 拖拽对象会" runaway"（对象飞走）

`localToCm()` 用画布外接框（`contentMinX` / `contentMaxY`）换算 cm，而外接框会
**随对象一起长大**。拖动时每帧外接框都变 → 同一个鼠标位置换算出的 cm 变了 →
对象越拖越快，冲出画布后自激。修复：拖拽期间**冻结**外接框
（`utils/geometry.ts` 的 `localToCmFixed()` + `PreviewCanvas` 的 `drag.extent`）。

### A3. 坐标轴预览从来没画出来过

`{#if axisGeom()}` —— Svelte 无法静态分析函数体里的依赖，条件块只在挂载时求值一次，
之后**再也不更新**。因此无论选 middle/box/axes 还是 polar，画布上**一条轴都没有**
（但生成的 LaTeX 里是有轴的，预览与代码长期不一致）。
修复：把响应式变量作为**实参**传给函数（`axisGeom(g)` / `polarGeom(g)` / `gridLines(g)`），
让 Svelte 能追踪依赖；并补上 polar（圆 + 两条半径箭头 + 四条 45° 辐条）
与 box（完整边框）的画法 —— 这两种样式此前**生成器有、预览没有**。

### A4. 其余 picture 模式缺陷

| 缺陷 | 位置 | 说明 |
|------|------|------|
| 放大形状**只能点边线** | `PreviewCanvas` `.te-drawn-hit` | CSS `pointer-events: stroke` 覆盖了 SVG 的 fill 命中测试；改为 `all` + 闭合形状 `fill="transparent"` |
| 缩放一次拖拽**产生几十条撤销记录** | `PreviewCanvas.resizeObject` | 第二次 `mutate()`（重锚箭头）用 merge=false，重置了 500ms 合并窗口；改为同一个 mutate 内完成 |
| `n`（自由端点）**丢掉已选的起点对象** | `EditorController.arrowFreeEndpoint` | 只读了 `startPoint`，没读 `startId` → 箭头生成在画布中心且未绑定 |
| 函数名在导出时**被丢弃** | `TikZGenerator.generateFunction` | 绘图没有名字概念 → 用 `% tkz-function: NAME` 标记注释承载，解析器读回 |
| `$$…$$` 行间公式渲染出**多余的 $** | `utils/mathText.ts` | 只认 `$…$`；重写为支持 `$$…$$` / `\(…\)` / `\[…\]` |
| 用户对象 `[gray!60, thin]` **被吞掉** | `TikZParser.isAxisDecoration` | 刻度线改成按**几何**判定（长度 ≤ 0.2cm，或极坐标辐条起点在圆心） |
| 箭头引用**手写节点名**解析失败 | `TikZParser.parseArrowLine` | 新增 `names` 映射（`name=box1` → 对象 id），并支持 `( tkz_x )` 带空格 |
| 手写 `\node at (x,y) {…}` **不可编辑** | `TikZParser.parseText` | 补齐 TikZ 的三种 node 写法 |
| **对象 id 会撞车**，往返不稳定 | `TikZParser.nextId` | 具名对象与匿名对象可能拿到同一个 id（箭头抢走文本节点的 id）→ 预扫描全文预留 `tkz_oN_M` 的 id |
| Ctrl+H / Ctrl+L **焦点快捷键反了** | `VimController` | 原来按字母 h/l 判断；改为按设置里解析出的绑定判断 |
| 自定义颜色**不校验** | `ColorPicker` | 拼错颜色名 → 生成 `\draw[redd]` → 整块笔记编译失败；加白名单校验 |
| 颜色**没有应用到预览文字** | `PreviewCanvas` | 文字 div 不带 `color`；改为按对象颜色渲染 |
| 居中/可见性**忽略滚动偏移** | `EditorController` | `panX/panY` 是内容坐标，滚动后目标跑到视口外 |
| 文本框位置**随机跳动** | `EditorController.freePosition` | `Math.random()` → 改为视口中心 + 螺旋找空位 |
| 缩放轴/网格范围与生成器**不一致** | `PreviewCanvas` | 预览用 `exactObjectBounds`，生成器用 `objectBounds`（圆会外扩 15%） |

### A4b. 解析器：独立文字节点被形状吞掉（数据丢失）

`TikZParser` 的 shapeLabel 分支原来只判断"上一个对象是形状"就把该节点当成形状的标签。
但生成器给**菱形/椭圆**的标签单独成行，而**独立文字节点**同样是
`\node[text=…] (tkz_…) at (x,y) {…}` 一行 —— 于是任何排在形状后面的文字节点
（生成器同样给它 `tkz_` 名字）都会被吞：文字对象整个消失，文字还跑到形状身上。

修复：只有**菱形/椭圆**的标签才会单独成行，且该节点必须**落在形状正中**
（生成器就是这么发的），否则按普通文字节点解析。

### A4c. 十六进制颜色：能校验，但 xcolor 不认

`\draw[#ff8800]` 在 TikZ 里会报 *Illegal parameter number* —— xcolor 不接受写在
选项里的裸十六进制（必须先 `\definecolor`）。所以：

- 生成器 `applyColorDefs()`：把用到的十六进制颜色映射成确定性名字
  （`tkzc` + 十六进制数字），在 preamble 里补 `\definecolor{tkzcff8800}{HTML}{ff8800}`，
  选项里写 `tkzcff8800`；名字是确定性的，所以每次生成都重建、不会堆积。
- 解析器：把 `\definecolor{tkzc…}{HTML}{…}` 行**消费掉**并记成 名字→十六进制 的映射，
  模型里始终存 `#ff8800`；用户自己写的 `\definecolor` 保留在 preamble 里。

### A5. tikzcd（Preact）子树的缺陷
| 缺陷 | 位置 | 说明 |
|------|------|------|
| **点击格子会选中隔壁格子**（致命） | `src/cd/Grid.js` `coordsToPosition` | 鼠标用的是**视口**坐标，camera 用的是**网格**坐标；上游 grid 在页面原点所以看不出来，嵌进 Obsidian 弹窗后偏移 ~77×29px，`Math.floor` 把大部分点击推进了相邻行列（实测点 (1,1) 选中 (3,2)）→ 减去 grid 自身的 client 偏移 |
| cd → picture **上下镜像** | `src/cd/diagram.ts` | cd 网格行向下、picture 画布 y 向上 → 回 picture 后顶行跑到底部；新增 `flipGraphY()`（只在 `CdPanel.handleExit` 用，**不能**动 `cellCenter`，否则 LaTeX 也被翻转） |
| **第一次编辑后撤销失效** | `src/cd/App.js` `handleDataChange` | 500ms 合并窗口把**初始快照**（index 0）覆盖了 → 撤销永远回不去；合并只在 `historyPointer > 0` 时允许 |
| 自环 90° **往返变成 270°** | `TikZParser` 循环角度 | `in`/`out` 用算术平均，跨 0° 时错；改用**最短弧**中点 |
| `crossing over` 被桥接**丢弃** | `src/cd/diagram.ts` | 解析/生成都支持，桥接没带 → 每次 Parse 都降级 |
| 弯曲步进器产生 **NaN** | `src/cd/Properties.js` | 小负弯曲 + "bend left" → `steps[-1]` → undefined → 箭头从画布消失；索引加钳制 |
| Shift/Space 临时工具**卡住** | `src/cd/App.js` | keyup 丢失（切窗/alt-tab）就永久停在 arrow/pan；补 `blur`/`visibilitychange` 复位 |
| `handleEdgeChange` 往数组写 **"null" 属性** | `src/cd/App.js` | `selectedArrow` 为 null 时未拦截 |

### A6. 体验改进

- **`?` 打开快捷键速查表**（`HelpOverlay.svelte`），工具栏也有 **? Keys** 按钮；
  速查表直接读 `KEYBINDS` + 用户设置，永远不会过期。
- **Fit（缩放至适应窗口）**：工具栏按钮 + `zz` 键。
- 工具栏 `[A] Arrow` 去掉只有一项的下拉菜单，直接建箭头。
- **Insert 不再重复关闭弹窗**（`afterInserted()` 被调用两次 → 双重 auto-save + 重复通知）。
- 状态栏在 picture 模式也显示键位提示；cd 模式提示保留。
- 函数名在 Nodes 列表里显示；多函数模板不再把 LaTeX 反斜杠翻倍（`\frac` → `\\frac` 会断行）。
- `SectionId` 补上 `arrow` / `nodes`（原来靠 `as never` 硬转）；`.te-root` 加 `:focus-visible` 轮廓。

### A7. 测试

- 新增 `test/run-audit.mjs`：**54 项**回归，覆盖上面每一条。
  所有用例都在**修复前的备份**上确认过会失败（轴不渲染 / gray!60 被吞 / 拖拽偏差 1.5cm /
  cd 点错格子 / Code 页 ReferenceError …）。
- 补齐 `test/tikzjax-runtime.html.frag`（之前不入库，导致 e2e 跑不起来）：
  现在直接用仓库内 `tikzjax-src/tikzjax-renderer.js`（已加编译结果日志）
  + `fonts-embedded.css`，`node test/run-e2e-tikzjax.mjs` 可直接跑，
  五个样例全部 **COMPILES**（含十六进制颜色与函数名标记两个新场景）。
- `package.json` 增加 `test` / `test:audit` / `test:e2e` 脚本。

> **注意**：改 `src/cd/*` 或 `src/**` 后必须重跑 `node test/build-harness.mjs`
> （`npm run build` 只编 main.js，不会更新 harness.js，否则跑的是旧 bundle）。

---

## 〇、最近会话变更（二开 batch 5：tikzcd 多图横向并列）

新功能：一个代码块内多个 `\begin{tikzcd}` 环境（TikZJax 文档的 side-by-side 排版）
在 cd 编辑器里同时显示、编辑，写回/插入按图还原。

1. **模型**：TikZGraph 新增 `cdMulti: { cdOptions?, colStart, colEnd, sep }[]` —
   图 i 的格子占共享网格的列区间 [colStart, colEnd]（后图整体右移，中间恰一个空列
   作为视觉间隔），sep 是该图**前面**的分隔符（默认 `\quad \quad`，原样保留）。
2. **解析** parseTikZCd：matchAll 全部 tikzcd 环境，逐环境以列偏移解析（cells/arrows
   的列加 colStart），记录每图 maxCol（含箭头目标列）、环境选项、环境间文本为 sep；
   最后一个环境之后的尾部仍进 rawSnippets。箭头目标越界只扩当前图 colEnd
   （不迁移后图——跨图箭头是已知边界，勿画）。
3. **生成** generateTikZCd：格子按列区间分组到各图，每图独立 minRow..maxRow /
   minCol..maxCol 全矩形发射（沿用 batch 3 的规则），环境间用各自的 sep 拼接。
   **单图（无 cdMulti）输出与旧版逐字节相同**；空图回退单环境发射。
4. **桥接保真**：diagramToGraph/toTeX 增加可选 base 图（携带 cdMulti/cdOptions/
   preamble/raws/title）；App.js 的 toTeX 全部改走 `props.toTeX`（CdPanel 提供，
   闭包当前插件图），onInsert 改传 diagram 本体；代码面板 Parse 经
   `diagram.fromTeX` 返回 `meta`，App.handleParseCode → onDiagramChange(diagram,
   meta) 一次性写入插件图（普通格子编辑不覆盖既有元数据）。
5. **crossing over**：解析器新增 `crossingOver`（此前 "crossing" 被颜色兜底吞掉、
   "over" 丢失 → 生成非法代码），生成器原样回发。
6. e2e：test/run-e2e-tikzjax.mjs 增加第三例 —— TikZJax 文档双图样例经本插件
   parse+generate 后在**真实 obsidian-tikzjax 运行时**编译 COMPILES。rig 的运行时
   片段不入库：从 vault 的 obsidian-tikzjax/main.js 提取 `var tikzjax_default = \`...\``
   存为 test/tikzjax-runtime.html.frag 即可重跑（用完删）。

验收：tsc 0 error；Playwright 269 项全 PASS（新增组 69 七项）；生产构建通过；已部署 vault。

---

## 〇（历史）、最近会话变更（二开 batch 4：对照真实 TikZJax 管线修复"编辑器能画、笔记编译不过"）

用户报告：编辑器画布完全正常，但 obsidian-tikzjax（artisticat1, v0.5.2）在笔记里无法
编译生成的 cd / picture 代码。做法：从 vault 的 obsidian-tikzjax/main.js 提取其内嵌
tikzjax 运行时（含 wasm/内核/tex_files），在无头浏览器里 1:1 复现其编译管线，直接读
TeX console 定位（te-katex 与真实 LaTeX 的能力差异编辑器侧不可见）。

1. **`\mathbb` 等未定义（根因）**：该内核 **不预加载 amsmath/amssymb**（`! Undefined
   control sequence \mathbb`），插件也不注入宏包；KaTeX 画布照常渲染所以编辑器看不出。
   修复：`generateTikZ` 正文扫描 AMS 命令（mathbb/Bbb/mathfrak/boldsymbol/varnothing/
   lesssim/gtrsim/nmid/subsetneq/supsetneq/complement/ncong/text/tfrac/dfrac/binom/
   substack/xrightarrow/xleftarrow/xleftrightarrow），按需注入
   `\usepackage{amsmath,amssymb}`（用户 preamble 已含 amssymb 则不重复）。
   实测内核：`\usepackage{amssymb}` 修 \mathbb；`\boldsymbol` 还需 amsmath（故两条一起）。
2. **箭头先于其绑定的节点被发射**：`\draw (tkz_a) -- (tkz_b)` 排在定义 tkz_b 的节点前
   → pgf "No shape named tkz_b is known"。修复：generateTikZ 重写装配段 —— 对象按
   （稳定）源码序排好后，把前向引用的箭头**推迟到其最后一个引用对象之后**（+0.5 严格
   后置）；raw 行按"锚点对象"插入；**不再按 _srcLine 二次排序**（旧机制会悄悄还原顺序）。
   良构代码逐字节不变。
3. **解析器前向引用**：`(tkz_…)` 端点在节点尚未解析时 resolveRef 失败 → 箭头掉进
   rawSnippets（此前只靠"节点名里的大数字触发 scaffold 延迟"侥幸二次解析）。新增
   pendingRefRetry 第三遍：带 tkz_/te_ 引用且解析失败的箭头，全 body 解析完后再试。
4. **往返不确定性（老毛病）**：makeId 的全局 uidCounter 泄漏 → 同一代码两次解析 id
   不同（椭圆标签 tkz_o5_1 vs tkz_o5_4）→ 生成代码不稳定。parseTikZ 现在调用
   resetUidCounter()；raw 行解析时 trim（原缩进+生成器 2 空格缩进每轮膨胀）。
5. e2e 校验脚本 `test/run-e2e-tikzjax.mjs`：用户原始两段代码 → 本插件 parse+generate →
   真实 tikzjax 运行时编译，两段 COMPILES（构建后可随时重跑验证新回归）。

已知残留（未修，有意）：`\node` 文本对象紧跟在形状后会被当作形状标签吞并
（shapeLabel 分支歧义，"Insert" 会画在椭圆内）；raw 多行上下文缩进不保留。

验收：tsc 0 error；Playwright 263 项全 PASS；生产构建通过；已部署 vault。

---

## 〇（历史）、最近会话变更（二开 batch 3：用户实测两处回归的根因修复）

用户报告 (1) cd 代码 TikZJax 无法渲染且重开丢箭头、(2) tikzpicture 画布完全空白。
浏览器探针（test harness）复现并修复，回归用例见 run-test.mjs 组 68：

1. **cd 矩阵折叠（P0，生成器老毛病，被 batch 2 的数学修复暴露）**：
   `generateTikZCd` 只发射"有内容的行/列"，空行（spacer row）被折叠，但箭头方向
   （`dd`/`uurr` 跨两格）不变 → 产出 2 行矩阵配越界箭头：TikZJax 编译失败；
   重开时 `graphToDiagram` 把"指向无节点格"的箭头整条丢弃（图二只剩 1 条箭头）。
   修复（四处）：
   - 生成器：箭头**目标格**也登记为空格；矩阵按 minRow..maxRow / minCol..maxCol
     **全矩形发射**（保留空行、支持负列），不再 pop 尾部空格 —— 每行格数一致，
     `\arrow` 的每一步都落在已定义的格上。
   - 生成器：inside 标签改为 tikz-cd 文档语法 `"label", description`
     （旧 `description="..."` 给 pgfkeys style 赋值，真实 tikz-cd 拒绝）。
   - diagram.ts 桥接：箭头端点无节点时**创建占位空节点**，不再丢箭头。
   - 解析器：接受裸 `description` 键（在颜色兜底前拦截，否则会被当成颜色）。
2. **picture 画布全空（P0）**：`drawAttrs` 的函数求值无兜底 —— pgf 弧度写法
   `plot (\x,{sin(\x r)})` 经 parseFunction 变成 `sin(x r)`，math.ts 把 `xr`
   合成一个未知标识符抛 MathError，异常穿透 Svelte 渲染**整个画布停止绘制**
   （实测 drawn=0/texts=0）。修复：
   - drawAttrs 函数分支 try/catch（不可求值的曲线跳过，其余照常画）；
   - parseFunction 归一 `\x r` → `x`（弧度即默认），曲线可正常画出；
   - loadFromContext 的 Esc 基线 `generateTikZ(g)` 移入独立 try/catch（失败回落
     原始块文本），杜绝"解析成功但基线生成失败 → 误报无法解析 → 空画布"。
3. 注意：若笔记里已被写入"折叠后的坏代码"（2 行 + dd/uurr），新构建能完整加载
   3 条箭头（占位节点），生成代码为**合法** tikz-cd（补齐空行/空列），但越界箭头
   指向的是空格 —— 需要在编辑器里用 `e`（重绑终点）把箭头拖回目标格，或恢复
   原始的带空行版本。原始带空行的代码在新构建下完美往返。

验收：tsc 0 error；Playwright 257 项全 PASS；npm run build 通过；已部署 vault。

---

## 〇（历史）、最近会话变更（二开 batch 2：渲染损坏修复 + cd 数据保真 + 键位冲突 + 死代码清除）

审查发现并修复（回归用例见 run-test.mjs 组 67，新增 15 断言，全套 249 项全绿）：

1. **渲染/生成损坏（core）**：
   - P0：`generateTikZCd` 把 math 模式的格子文本送进 `escapeNodeText`（文本模式转义），
     `\sum_{i=1}^n` 被改写成 `\sum_\{i=1\}^n` —— 所有带花括号的 cd 格子插入笔记后无法编译。
     现在只走 `cleanMathText`（剥冗余定界符），不转义 math 内容。
   - `escapeNodeText`（picture 文本节点，text mode）补齐 `_ ^ ~ $` 转义
     （`\_`、`\textasciicircum`、`\textasciitilde`、`\$`，`(?<!\\)` 防双转义）；
     `unescapeBraces` 对称还原 → 文件名/snake_case 文本不再产出非法 LaTeX，且往返 byte 稳定。
   - PreviewCanvas 网格横线被画成竖线（gridLines 把横线 y 存进 x 字段、渲染只换了一根轴）。
     gridLines 改为输出显式 cm 端点。实测 6×4 网格从 12 竖 0 横 → 正常。
   - isAxisDecoration 对任意含 `gray!60` 的行整行吞掉（用户 gray!60 箭头/圆消失）；
     parseArrowLine 里还有第二处同样的拦截。两处都收紧/移除，只保留刻度线精确签名
     `\draw[gray!60, thin] (a,b) -- (c,d);`。
2. **cd 数据保真**：
   - diagram.ts 桥接（graphToDiagram/diagramToGraph）不携带 color → cd 面板 Parse 或
     任意格子编辑都会把 `\arrow[r, red]` 洗成黑色。edge 现在随身带 color（不提供改色 UI）。
   - cd App 新增 `env` 命令（无选中/未重绑时）→ onExit 回 picture；
     startRebindEnd/cancelRebind/applyRebindEnd 复位多键缓冲，防 `e`+rebind 后残留序列误触发。
   - **dd 防误清格**：删除箭头（dd/Delete）后记录 `_arrowDeletedAt`，400ms 内 clearCell 被阻塞；
     删除后光标停靠到被删箭头的起点格。用户"dd 删箭头总连带着清掉格子"已修。
   - cd 格子拖动长按 800ms → 300ms（grabber 仍可即拖）。
   - cp 复制成功有 Notice；cd 面板 Insert 失败（如无活动笔记）有错误提示（此前静默）。
3. **键位**：
   - picture ARROW_EDITING 下 `ok` 不可达：`o` 被 `op` 交换序列守卫吞掉。pendingOP 现在
     在第二个键为 `k` 时完成插入，其它键清 pendingOP 后回落重新处理。
   - undoKey/redoKey 设置此前对 picture 无效（Ctrl 分支硬编码）。现在 Ctrl 分支按设置
     别名匹配（`Ctrl+Shift+Z` 永远是重做别名）；设置页描述同步更新。
4. **数据安全/UX**：
   - openEditor 在编辑器已打开时切换代码块，先 stashSessionDraft() 再换上下文
     （此前直接 loadGraph 丢编辑）。Modal onClose 复用同一方法。
   - InsertOverlay：按键写入**实际输入的 textarea 对应字段**（此前写进激活字段），
     点击/聚焦另一个标签框自动切换激活字段。
   - StatusBar 状态消息 5s 自动过期。
5. **死代码清除**（运行时不可达，cd 由 Preact 编辑器整屏接管，vim 层被旁路）：
   - VimController：isCd/cdSafe/CD_TAILS/CD_HEADS/cd 样式键块/cd 网格导航块/CD_CELL 步长分支。
   - EditorController：cdCursorMove/Enter/AtCm、createCdArrowBetween、insertCdCell、
     addLoopToCell、全部 setCd*/bend/shift/loop/reverse 样式方法、freePosition 的 cd 分支。
   - PreviewCanvas cd 网格/光标/cdarrow 拖拽、Toolbar cd 工具、ArrowSection 与 ArrowTipPicker
     的 cd 分支、App.svelte 的 toolHeld 接线。
   - state.ts：cdCursor/toolHeld/setPositionFlow/codeSync/dragging 删除；harness 同步。
   - **键位注册表（keybindings.ts）条目全部保留**——设置 UI 与测试 66 仍依赖。

验收：tsc 0 error；Playwright 249 项全 PASS；npm run build 通过。

6. **Esc 自动写回（追加需求）**：按 Esc/点遮罩关闭时自动把未写回的修改写进笔记。
   - `TikZEditorPlugin.sessionInitialCode`：会话加载时（`loadFromContext`）记录生成代码的
     规范形基线；关闭时 `autoSaveOnClose()` 与当前生成代码比较，**无变化不写**
     （避免"打开就 Esc 也重写块"）。手动 Insert 在 `replaceOrInsertBlock` 两条成功路径上
     回写基线 → 关闭时不会二次写入。
   - 安全回落（绝不硬写）：无活动笔记 / 活动笔记不是打开编辑器那篇（错笔记保护）/
     原块围栏失效（`cursorFallback:false`，防在光标处插出重复块）/ 原块 parseFailed ——
     四种情况改存草稿并 Notice。写回成功 Notice "已自动写回笔记"。
   - 新建模式（editContext=null）有修改时按 Insert 语义在光标处插入。
   - 注意：此逻辑在 obsidian 侧（main.ts/TikZEditorModal），Playwright harness 无法覆盖，
     靠 tsc+构建+手动验收；改动前 249 项测试保持全绿。

---

## 〇（历史）、最近会话变更（二开 batch 1：往返一致性 + 数据安全 + 键位体系 + 死管线移除）

审查发现并修复（全部有回归用例，见 run-test.mjs 组 66）：

1. **往返一致性（core）**：
   - P0：椭圆 `circle (rx and ry)` 被 parseCircle 吞成圆 → parseObjectLine 先试 ellipse，
     且 circle 半径组必须为纯数字。
   - box 轴刻度数字标签（gray!80/scriptsize）不再漏入 rawSnippets（此前每轮 +16 条无限膨胀）。
   - 极坐标轴以**圆心锚**识别（circle 记录 polarCenter，两条半径箭头按起点归队），
     不再依赖 frame 常数 → 默认/超界画布都不再泄漏普通箭头对象。
   - 笛卡尔轴/frame 在内容超界时走**两段式匹配**（scaffoldShaped + extendsBeyondCanvas 延迟
     → 循环后按最终 pictureExtent 重判），带 node[ 的行永不延迟（保住标签挂接，测试 38）。
   - tikzcd 环境选项 `[row sep=…]` 捕获进 graph.cdOptions 并原样回写，不再污染 (0,0) 格。
   - escapeNodeText 的 $$..$$ 分支提到单 $ 前（此前 ${x^2}$ 被转义损坏）。
   - math.ts：`-2^2=-4`（unary 移到 power 外层）、`2e` 抛错不再静默截断、
     FUNCS 用 hasOwn 防原型链（constructor/__proto__）。
   - colors.ts：`x!N` 改为向白混色（tikz 语义）且 clamp，`blue!150` 不再产出非法 hex。
2. **数据安全**：
   - 解析失败 → Notice 提示 + parseFailed 标记；replaceOrInsertBlock 检测该标记时
     **拒绝覆盖原块**；行号缓存再校验（围栏不在即回落光标插入）。
   - Esc 关闭自动存草稿（内存 Map，按 文件#行号 键控）；重开同块提示恢复；Insert 后清除。
   - cd Parse：fromTeX 对无 \begin{tikzcd} 输入抛错；App.js 失败不改状态；
     Notice 经 window.__teNotice 全局桥（保持 cd 子树零 obsidian 依赖——harness 可打包）。
3. **键位体系**：
   - 补注册幽灵 id：labelPos(l)/labelLong(L)/resetBend(0)/loop(O)/loopFlip(E)——README 文档
     的这些键此前静默失效且不可重绑；删除从未查询的 cycleLabelPos 与死代码 cellBelow/Above、
     cd.nav* 查询（方向键回退保留）。focusLeft/focusRight 设置真正生效。
   - 设置页：每组独立 Reset 按钮 + 顶部 ⚠ 冲突列表（精确别名重复检测）。
4. **死渲染管线移除**：TikZEngine/TruePreview/PreviewPanel/SVGExporter/tikzjax-bundle/
   fonts-embedded.css 删除（TruePreview 引用的 store/engine 属性本就不存在）；
   settings.renderDelay 一并移除。main.js 相应瘦身。
5. **小 UX**：Code Run 走 replaceGraph 入撤销史且光标不再跳顶；textBelow 标签双击可编辑；
   resize 手柄屏幕尺寸恒定（11px/zoom）；Space/Shift 工具窗口失焦自动复位；
   InsertOverlay 不再每击键抢焦点；函数 Domain 校验 from≤to 且拒绝非数字；
   picker 全部加 IME isComposing 守卫。

验收：tsc 0 error；Playwright 225+9 回归全绿；npm run build 通过。

---

## 〇（历史）、最近会话变更（2026-08-07 第二次：cd 参考编辑器键盘"新纪元"，测试 181 项全 PASS）

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