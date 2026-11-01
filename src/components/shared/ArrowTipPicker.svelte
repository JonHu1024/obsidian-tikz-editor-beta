<script lang="ts">
  import { get } from "svelte/store";
  import { editor } from "../../EditorController";
  import { arrowTipPickerOpen, selectedId, graph, statusMessage } from "../../state";
  import type { ArrowObject } from "../../core/types";

  const TIPS: { id: ArrowObject["tip"]; label: string; title: string }[] = [
    { id: "arrow", label: "▸ arrow", title: "默认箭头" },
    { id: "latex", label: "▶ latex", title: "细长箭头" },
    { id: "stealth", label: "► stealth", title: "隐形战机" },
    { id: "to", label: "▷ to", title: "小箭头" },
    { id: "triangle", label: "△ triangle 45", title: "大三角" },
    { id: "angle", label: "∠ angle 60", title: "角形" },
    { id: "o", label: "○ o", title: "空心圆" },
    { id: "star", label: "● *", title: "实心圆" },
    { id: "bar", label: "⎸ |", title: "竖杠" },
    { id: "diamond", label: "◇ diamond", title: "菱形" },
  ];

  let idx = 0;
  import { onMount, onDestroy } from "svelte";
  let cleanKey: (() => void) | null = null;
  onMount(() => {
    window.addEventListener("keydown", onKeyDown, true);
    cleanKey = () => window.removeEventListener("keydown", onKeyDown, true);
  });
  onDestroy(() => {
    cleanKey?.();
  });

  function getSelectedArrow(): ArrowObject | null {
    const id = get(selectedId);
    const g = get(graph);
    if (!id) return null;
    const o = g.objects.find((x) => x.id === id);
    // the selection may have changed to a non-arrow while the picker was
    // open — the unchecked cast would happily apply a style to it
    return o && o.type === "arrow" ? o : null;
  }

  function apply(tip: ArrowObject["tip"]) {
    const sel = getSelectedArrow();
    if (!sel) {
      statusMessage.set("Select an arrow first");
      arrowTipPickerOpen.set(false);
      return;
    }
    editor.setArrowStyle(sel.id, sel.head, tip, sel.dash);
    statusMessage.set(`Arrow tip → ${tip}`);
    arrowTipPickerOpen.set(false);
  }

  function onKeyDown(e: KeyboardEvent) {
    if (e.isComposing || e.keyCode === 229) return; // IME confirmation is not a command
    if (e.key === "Enter") {
      e.preventDefault();
      apply(TIPS[idx].id);
      return;
    }
    if (e.key === "Alt" || e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      arrowTipPickerOpen.set(false);
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      idx = (idx + 1) % TIPS.length;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      idx = (idx - 1 + TIPS.length) % TIPS.length;
    }
  }
</script>

<div class="te-modal-backdrop" on:click={() => arrowTipPickerOpen.set(false)}>
  <div class="te-tip-picker" on:click|stopPropagation>
    <div class="te-tp-title">Arrow tip 箭头样式 (↑↓ / Enter / Alt)</div>
    <div class="te-tp-grid">
      {#each TIPS as t, i}
        <div
          class="te-tp-item {i === idx ? 'te-tp-active' : ''}"
          on:mouseenter={() => (idx = i)}
          on:click={() => apply(t.id)}
          title={t.title}
        >{t.label}</div>
      {/each}
    </div>
  </div>
</div>

<style>
  .te-modal-backdrop {
    position: absolute;
    inset: 0;
    background: rgba(0, 0, 0, 0.35);
    z-index: 100;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .te-tip-picker {
    background: var(--background-primary);
    border: 1px solid var(--background-modifier-border);
    border-radius: 8px;
    padding: 12px;
    width: 320px;
    display: flex;
    flex-direction: column;
    gap: 8px;
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.3);
  }
  .te-tp-title {
    font-size: 12px;
    font-weight: bold;
    color: var(--text-normal);
    font-family: var(--font-monospace);
  }
  .te-tp-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 4px;
    max-height: 300px;
    overflow-y: auto;
  }
  .te-tp-item {
    padding: 6px 10px;
    border-radius: 4px;
    cursor: pointer;
    font-family: var(--font-monospace);
    font-size: 12px;
    color: var(--text-normal);
  }
  .te-tp-item:hover,
  .te-tp-active {
    background: var(--background-modifier-hover);
  }
</style>
