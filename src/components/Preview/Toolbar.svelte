<script lang="ts">
  import { editor } from "../../EditorController";
  import { SHAPES } from "../../utils/colors";
  import { statusMessage, activeTab, helpOpen } from "../../state";

  let shapeMenu = false;

  function clickShape(name: string) {
    shapeMenu = false;
    editor.createShape(name, false);
  }

  function clickArrow() {
    editor.beginArrowFlow(false);
  }

  function openCode() {
    activeTab.set("code");
    statusMessage.set("Code view - Ctrl+E edit, Ctrl+S apply");
  }

  /** Fit the whole drawing into the viewport (also re-centres it). */
  function zoomToFit() {
    editor.zoomToFit();
    statusMessage.set("Zoomed to fit");
  }

  async function copyCode() {
    try {
      await navigator.clipboard.writeText(editor.getCurrentCode());
      statusMessage.set("TikZ code copied to clipboard");
    } catch {
      statusMessage.set("Copy failed - clipboard unavailable");
    }
  }
</script>

<div class="te-toolbar">
  <button
    class="te-tb-btn"
    title="Create text box [t] - 创建文本框"
    on:click={() => editor.createText(false)}
  >[T] Text</button>

  <div class="te-drop">
    <button class="te-tb-btn" title="Create shape [s] - 创建形状" on:click={() => { shapeMenu = !shapeMenu; }}>
      [S] Shape ▾
    </button>
    {#if shapeMenu}
      <div class="te-menu" on:mouseleave={() => (shapeMenu = false)}>
        {#each SHAPES as s}
          <button class="te-menu-item" on:click={() => clickShape(s.name)}>{s.label}</button>
        {/each}
      </div>
    {/if}
  </div>

  <button class="te-tb-btn" title="Create arrow [a] - 创建箭头" on:click={() => { shapeMenu = false; clickArrow(); }}>
    [A] Arrow
  </button>

  <span class="te-tb-sep"></span>

  <button class="te-tb-btn" title="Undo [u] - 撤销" on:click={() => editor.undo()}>↩ Undo</button>
  <button class="te-tb-btn" title="Redo [redo] - 重做" on:click={() => editor.redo()}>↪ Redo</button>
  <button class="te-tb-btn" title="Fit the drawing in the viewport - 缩放至适应窗口" on:click={zoomToFit}>⤢ Fit</button>

  <span class="te-tb-sep"></span>

  <button class="te-tb-btn" title="Open code view - 查看代码" on:click={openCode}>Open Code</button>
  <button class="te-tb-btn" title="Copy TikZ code - 复制代码" on:click={copyCode}>Copy Code</button>
  <button class="te-tb-btn" title="Keyboard shortcuts - 快捷键帮助" on:click={() => helpOpen.set(true)}>? Keys</button>

  <span class="te-tb-sep"></span>

  <button class="te-tb-btn te-tb-primary" title="Insert into current note [ok] - 插入到当前笔记" on:click={() => editor.insertToNote().then((r) => { statusMessage.set(r.message); })}>
    Insert
  </button>
</div>

<style>
  .te-toolbar {
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 4px 8px;
    border-bottom: 1px solid var(--background-modifier-border);
    flex-wrap: wrap;
  }
  .te-tb-btn {
    background: var(--background-secondary-alt);
    border: 1px solid var(--background-modifier-border);
    color: var(--text-normal);
    padding: 3px 8px;
    font-size: 12px;
    border-radius: 4px;
    cursor: pointer;
    font-family: var(--font-monospace);
  }
  .te-tb-btn:hover {
    background: var(--background-modifier-hover);
  }
  .te-tb-active {
    background: var(--interactive-accent);
    color: var(--text-on-accent);
  }
  .te-tb-primary {
    background: var(--interactive-accent);
    color: var(--text-on-accent);
  }
  .te-tb-sep {
    width: 1px;
    height: 18px;
    background: var(--background-modifier-border);
    margin: 0 4px;
  }
  .te-drop {
    position: relative;
  }
  .te-menu {
    position: absolute;
    top: 100%;
    left: 0;
    z-index: 30;
    background: var(--background-primary);
    border: 1px solid var(--background-modifier-border);
    border-radius: 6px;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.2);
    display: flex;
    flex-direction: column;
    min-width: 130px;
    padding: 4px;
  }
  .te-menu-item {
    background: transparent;
    border: none;
    color: var(--text-normal);
    text-align: left;
    padding: 5px 10px;
    font-size: 12px;
    cursor: pointer;
    border-radius: 4px;
    font-family: var(--font-monospace);
  }
  .te-menu-item:hover {
    background: var(--background-modifier-hover);
  }
</style>
