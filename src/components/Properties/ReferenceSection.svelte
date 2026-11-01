<script lang="ts">
  const SECTIONS: { title: string; keys: { keys: string; desc: string }[] }[] = [
    {
      title: "NORMAL MODE 普通模式",
      keys: [
        { keys: "t / T", desc: "Create text box (T: also insert) 创建文本框" },
        { keys: "s / S", desc: "Create shape (S: also insert) 创建形状" },
        { keys: "a / A", desc: "Create arrow (A: also insert) 创建箭头" },
        { keys: "f", desc: "Add function 新增函数" },
        { keys: "env", desc: "Toggle environment tikzpicture ⇄ tikzcd (empty canvas) 切换环境" },
        { keys: "i", desc: "Edit selected text (INSERT mode) 编辑文字" },
        { keys: "d", desc: "Delete selected object 删除对象" },
        { keys: "c", desc: "Change color (searchable) 修改颜色" },
        { keys: "u / Ctrl+Z", desc: "Undo 撤销" },
        { keys: "redo / Ctrl+Y", desc: "Redo 重做" },
        { keys: "↑↓←→", desc: "Fine move (0.16cm) 微调位置" },
        { keys: "Ctrl+↑↓←→", desc: "Coarse move (1.2cm) 大幅移动" },
        { keys: "Ctrl+ - / +", desc: "Zoom out / in 缩小/放大画布" },
        { keys: "Ctrl+滚轮", desc: "Zoom at cursor 以光标为中心缩放" },
        { keys: "Ctrl+F", desc: "Focus node list search 聚焦节点列表搜索" },
        { keys: "Tab", desc: "Cycle selection 循环选中对象" },
        { keys: "ok", desc: "Insert code block into note (auto close) 插入到笔记并关闭" },
        { keys: "Alt", desc: "Exit mode / cancel 退出模式" },
        { keys: "Alt+E", desc: "Back to NORMAL from anywhere 任意状态回到普通模式" },
      ],
    },
    {
      title: "ARROW EDITING 箭头编辑模式",
      keys: [
        { keys: "a", desc: "Arrow tip picker 弹出箭头样式选择框" },
        { keys: "op", desc: "Swap arrow start/end 交换箭头起点终点" },
        { keys: "b / e", desc: "Rebind arrow start / end 重新绑定箭头端点" },
        { keys: "↑↓←→", desc: "Translate the whole arrow 整体平移箭头" },
        { keys: "h / l", desc: "Shorten / lengthen the arrow 缩短/伸长箭头" },
        { keys: "i", desc: "Edit the arrow label 编辑箭头标签" },
        { keys: "Alt", desc: "Back to NORMAL 回到普通模式" },
      ],
    },
    {
      title: "INSERT 编辑模式",
      keys: [
        { keys: "Alt", desc: "Finish editing 完成编辑" },
        { keys: "Tab", desc: "Switch arrow label field 切换箭头标签位置" },
        { keys: "Enter", desc: "New line 换行" },
      ],
    },
    {
      title: "Mouse 鼠标操作",
      keys: [
        { keys: "Click 点击", desc: "Select object 选中对象" },
        { keys: "Drag 拖拽", desc: "Move object / pan empty canvas 移动对象/平移画布" },
        { keys: "8 handles 八点手柄", desc: "Resize selected object 拉伸对象" },
        { keys: "Double-click 双击", desc: "Edit text 编辑文字" },
      ],
    },
  ];

  const FUNCS: string[] = [
    "sin(x), cos(x), tan(x)", "asin(x), acos(x), atan(x)",
    "exp(x), ln(x), log(x), log2(x)", "sqrt(x), abs(x), floor(x), ceil(x), round(x)",
    "deg(x), rad(x), mod(x,y)", "Constants: pi, e, tau",
    "Operators: + - * / ^", "Examples: sin(x), x^2 - 3*x, exp(-x/5)*sin(x)",
  ];

  const SHAPES: string[] = [
    "Text: node with $math$ support, multi-line 文本框(支持数学公式)",
    "Rectangle / Square 矩形/正方形", "Circle 圆形", "Diamond 菱形", "Ellipse 椭圆",
    "Arrow: draggable, endpoints rebindable (b/e), tip styles (a) 箭头",
  ];

  const ENV: string[] = [
    "tikzpicture: full features 完整功能 (shapes/functions/axis/grid)",
    "tikzcd: text boxes + arrows only 仅文本框与箭头 (commutative diagrams)",
    "env 指令切换 (空白画布时); 设置中的 Default environment 决定新建默认",
  ];
</script>

<h3 class="te-sec-title">Reference <span class="te-tip" title="参考文档, 不可修改">ⓘ</span></h3>
<p class="te-note">Reference grouped by mode. 按模式分组的参考文档, 仅作提示, 不可修改.</p>

{#each SECTIONS as sec}
  <h4 class="te-sub">{sec.title}</h4>
  <table class="te-ref-table">
    {#each sec.keys as k}
      <tr>
        <td class="te-kbd">{k.keys}</td>
        <td>{k.desc}</td>
      </tr>
    {/each}
  </table>
{/each}

<h4 class="te-sub">Environments 环境</h4>
<ul class="te-ref-list">
  {#each ENV as e}
    <li>{e}</li>
  {/each}
</ul>

<h4 class="te-sub">Supported functions 支持的函数</h4>
<ul class="te-ref-list">
  {#each FUNCS as f}
    <li><code>{f}</code></li>
  {/each}
</ul>

<h4 class="te-sub">Supported objects 支持的对象</h4>
<ul class="te-ref-list">
  {#each SHAPES as s}
    <li>{s}</li>
  {/each}
</ul>

<style>
  .te-sec-title {
    font-size: 13px;
    color: var(--text-normal);
    margin: 0 0 6px;
  }
  .te-tip {
    font-size: 11px;
    color: var(--text-faint);
    cursor: help;
  }
  .te-note {
    font-size: 11px;
    color: var(--text-faint);
    margin: 0 0 12px;
  }
  .te-sub {
    font-size: 12px;
    color: var(--text-accent);
    margin: 14px 0 6px;
  }
  .te-ref-table {
    width: 100%;
    border-collapse: collapse;
    font-size: 11px;
  }
  .te-ref-table td {
    padding: 3px 6px;
    border-bottom: 1px solid var(--background-modifier-border);
    vertical-align: top;
  }
  .te-kbd {
    white-space: nowrap;
    font-family: var(--font-monospace);
    color: var(--text-accent);
  }
  .te-ref-list {
    margin: 0;
    padding-left: 18px;
    font-size: 11px;
    color: var(--text-muted);
  }
</style>
