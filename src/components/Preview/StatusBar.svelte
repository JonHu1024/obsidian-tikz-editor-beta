<script lang="ts">
  import { onDestroy } from "svelte";
  import { vimMode, commandBuffer, arrowFlow, activeTab, statusMessage, graph, cdCommandBuffer } from "../../state";
  import { DEFAULT_KEYS } from "../../vim/keybindings";
  import { editor } from "../../EditorController";

  let mode = $vimMode;
  let buf = $commandBuffer;
  let flow = $arrowFlow;
  let msg = $statusMessage;
  let g = $graph;
  let cdbuf = $cdCommandBuffer;

  function kb(id: string): string {
    const kb = editor.plugin?.settings?.keybinds;
    return kb?.[id] ?? DEFAULT_KEYS[id] ?? "";
  }

  $: mode = $vimMode;
  $: buf = $commandBuffer;
  $: flow = $arrowFlow;
  $: msg = $statusMessage;
  $: g = $graph;
  $: cdbuf = $cdCommandBuffer;

  // status messages used to stick forever; clear them a few seconds after
  // the last update so the bar reflects the CURRENT state
  let expireTimer: ReturnType<typeof setTimeout> | null = null;
  $: scheduleExpire(msg);
  function scheduleExpire(m: string) {
    if (expireTimer) clearTimeout(expireTimer);
    if (m) expireTimer = setTimeout(() => statusMessage.set(""), 5000);
  }
  onDestroy(() => {
    if (expireTimer) clearTimeout(expireTimer);
  });

  function modeLabel(): string {
    if (mode === "INSERT") return "INSERT MODE";
    if (mode === "ARROW_EDITING") return "ARROW EDITING";
    return "NORMAL MODE";
  }
</script>

<div class="te-statusbar">
  <div class="te-sb-left">
    <span class="te-sb-env" class:te-sb-env-cd={g.env === "cd"}>[{g.env === "cd" ? "tikzcd" : "tikzpicture"}]</span>
    <span class="te-sb-mode" class:te-sb-mode-normal={mode === "NORMAL"}>{modeLabel()}</span>
    {#if flow}
      <span class="te-sb-flow">
        {#if flow.kind === "dir"}
          → direction: arrow keys / 1-9
        {:else}
          pick {flow.target === "start" ? "start" : "end"}: click / Tab+Enter / n=free
        {/if}
      </span>
    {/if}
    {#if msg}
      <span class="te-sb-msg">{msg}</span>
    {/if}
    {#if g.env === "cd" && (mode === "ARROW_EDITING" || mode === "NORMAL")}
      <span
        class="te-sb-hint"
        title={mode === "ARROW_EDITING"
          ? `cd 箭头键位: op 反向 · t 尾/映射/钩 循环 · h 头/燕尾/双头 循环 · l 标签位置 循环 · dt 点线 / ds 虚线 / sd 实线 / db 双线 · ↑/↓ 平移 · Shift+↑/↓ 弯曲 · Enter 编辑标签 · e 移动终点(方向键+Enter) · dd 删除箭头`
          : `cd 网格: ↑↓←→ 移动光标 · Enter/i 编辑格 · a+方向 快速箭头 · x 选终点(方向键+Enter 确认) · dd 清空格子 · u/Ctrl+Z 撤销 · r/Ctrl+Y 重做 · cp 复制代码 · ok 插入并退出 · Tab 循环同起点箭头`}
      >{mode === "ARROW_EDITING"
          ? `cdØ: op t/h/l dt/ds/sd/db ↑↓/Sh↑↓ Enter e dd`
          : `cdØ: ↑↓←→ | i | a | x | dd | u/r | cp | ok | Tab`}</span>
    {/if}
    {#if g.env !== "cd"}
      <span
        class="te-sb-hint"
        title="画布快捷键: t 文本 · s 形状 · a 箭头 · f 函数 · i 编辑 · d 删除 · c 颜色 · u 撤销 · redo 重做 · ok 插入 · ? 全部键位 · Alt 取消/退出 · Ctrl+H 画布 · Ctrl+L 属性"
      >画布: t/s/a/f · i/d/c · u/redo · ok · ?</span>
    {/if}
  </div>
  <div class="te-sb-right">
    <span class="te-sb-cmd">:{g.env === "cd" ? cdbuf : buf}</span>
  </div>
</div>

<style>
  .te-statusbar {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 2px 10px;
    border-top: 1px solid var(--background-modifier-border);
    background: var(--background-secondary);
    font-size: 12px;
    font-family: var(--font-monospace);
    min-height: 24px;
    gap: 8px;
  }
  .te-sb-left {
    display: flex;
    align-items: center;
    gap: 10px;
    min-width: 0;
    overflow: hidden;
  }
  .te-sb-env {
    font-size: 11px;
    font-weight: bold;
    color: var(--text-muted);
    background: var(--background-modifier-border);
    border-radius: 8px;
    padding: 1px 8px;
    font-family: var(--font-monospace);
  }
  .te-sb-env.te-sb-env-cd {
    color: var(--text-accent);
  }
  .te-sb-mode {
    font-weight: bold;
    color: var(--interactive-accent);
    letter-spacing: 0.5px;
  }
  .te-sb-mode-normal {
    color: var(--text-accent);
  }
  .te-sb-flow {
    color: var(--text-muted);
    font-style: italic;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .te-sb-msg {
    color: var(--text-faint);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .te-sb-hint {
    color: var(--text-accent);
    opacity: 0.75;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .te-sb-right {
    display: flex;
    align-items: center;
    gap: 10px;
    white-space: nowrap;
  }  .te-sb-cmd {
    min-width: 60px;
    text-align: right;
    color: var(--text-muted);
    letter-spacing: 1px;
  }
</style>
