<script lang="ts">
  import { onMount } from "svelte";
  import { get } from "svelte/store";
  import { helpOpen } from "../../state";
  import { KEYBINDS } from "../../vim/keybindings";
  import { editor } from "../../EditorController";
  import { DEFAULT_KEYS } from "../../vim/keybindings";

  /** The effective binding (settings override first, built-in default second). */
  function keyOf(id: string): string {
    const s = editor.plugin?.settings?.keybinds;
    return (s?.[id] ?? DEFAULT_KEYS[id] ?? "").trim();
  }

  const GROUPS: { id: string; title: string; note?: string }[] = [
    { id: "normal", title: "NORMAL MODE 普通模式" },
    { id: "cd", title: "tikzcd 格子导航" },
    { id: "cdarrow", title: "tikzcd 箭头编辑" },
    { id: "tool", title: "鼠标工具" },
    { id: "system", title: "系统" },
  ];

  onMount(() => {
    const onKey = (e: KeyboardEvent) => {
      // The overlay is always mounted, so this listener must stay out of the
      // way while it is closed — otherwise it swallows the Escape / Alt
      // keys that the colour and shape pickers rely on to close.
      if (!get(helpOpen)) return;
      if (e.key === "Escape" || e.key === "Alt") {
        e.preventDefault();
        e.stopPropagation();
        helpOpen.set(false);
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  });
</script>

{#if $helpOpen}
  <div class="te-help-backdrop" on:click={() => helpOpen.set(false)}>
    <div class="te-help" on:click|stopPropagation>
      <div class="te-help-head">
        <span class="te-help-title">键盘快捷键 / Keyboard shortcuts</span>
        <button class="te-help-close" title="Close 关闭" on:click={() => helpOpen.set(false)}>✕</button>
      </div>
      <div class="te-help-body">
        {#each GROUPS as grp}
          {@const items = KEYBINDS.filter((k) => k.group === grp.id)}
          {#if items.length > 0}
            <div class="te-help-group">
              <div class="te-help-gtitle">{grp.title}</div>
              {#each items as k (k.id)}
                <div class="te-help-row">
                  <kbd class="te-help-key">{keyOf(k.id) || "—"}</kbd>
                  <span class="te-help-label">{k.label}</span>
                </div>
              {/each}
            </div>
          {/if}
        {/each}
        <div class="te-help-group">
          <div class="te-help-gtitle">通用 / Common</div>
          <div class="te-help-row"><kbd class="te-help-key">Alt</kbd><span class="te-help-label">取消 / 退出当前模式 / 取消选择 (cancel / exit mode / deselect)</span></div>
          <div class="te-help-row"><kbd class="te-help-key">Ctrl+Z</kbd><span class="te-help-label">撤销 (undo)</span></div>
          <div class="te-help-row"><kbd class="te-help-key">Ctrl+Y</kbd><span class="te-help-label">重做 (redo)</span></div>
          <div class="te-help-row"><kbd class="te-help-key">Ctrl+滚轮</kbd><span class="te-help-label">缩放画布 (zoom canvas)</span></div>
          <div class="te-help-row"><kbd class="te-help-key">双击</kbd><span class="te-help-label">编辑对象文字 (edit object text)</span></div>
        </div>
      </div>
      <div class="te-help-foot">按 Esc / Alt 关闭 · 所有键位均可在插件设置中修改</div>
    </div>
  </div>
{/if}

<style>
  .te-help-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.45);
    z-index: 200;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .te-help {
    background: var(--background-primary);
    color: var(--text-normal);
    border: 1px solid var(--background-modifier-border);
    border-radius: 10px;
    box-shadow: 0 10px 40px rgba(0, 0, 0, 0.35);
    max-width: 720px;
    width: 90%;
    max-height: 80vh;
    display: flex;
    flex-direction: column;
    font-family: var(--font-monospace);
  }
  .te-help-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 10px 14px;
    border-bottom: 1px solid var(--background-modifier-border);
  }
  .te-help-title {
    font-size: 14px;
    font-weight: bold;
  }
  .te-help-close {
    background: transparent;
    border: none;
    color: var(--text-muted);
    font-size: 14px;
    cursor: pointer;
    border-radius: 4px;
    padding: 2px 6px;
  }
  .te-help-close:hover {
    background: var(--background-modifier-hover);
    color: var(--text-normal);
  }
  .te-help-body {
    overflow-y: auto;
    padding: 10px 14px;
    column-count: 2;
    column-gap: 24px;
  }
  .te-help-group {
    break-inside: avoid;
    margin-bottom: 12px;
  }
  .te-help-gtitle {
    font-size: 11px;
    text-transform: uppercase;
    color: var(--text-accent);
    font-weight: bold;
    margin-bottom: 4px;
    border-bottom: 1px solid var(--background-modifier-border);
    padding-bottom: 2px;
  }
  .te-help-row {
    display: flex;
    gap: 8px;
    align-items: baseline;
    font-size: 11px;
    padding: 1px 0;
  }
  .te-help-key {
    background: var(--background-secondary-alt);
    border: 1px solid var(--background-modifier-border);
    border-radius: 4px;
    padding: 0 5px;
    font-size: 10px;
    min-width: 42px;
    text-align: center;
    flex-shrink: 0;
    color: var(--text-normal);
  }
  .te-help-label {
    color: var(--text-muted);
  }
  .te-help-foot {
    padding: 8px 14px;
    border-top: 1px solid var(--background-modifier-border);
    font-size: 10px;
    color: var(--text-faint);
  }
</style>
