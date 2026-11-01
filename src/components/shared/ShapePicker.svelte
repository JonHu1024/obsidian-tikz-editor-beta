<script lang="ts">
  import { editor } from "../../EditorController";
  import { shapePickerOpen, statusMessage } from "../../state";
  import { SHAPES } from "../../utils/colors";

  let query = "";
  let list = SHAPES;
  let idx = 0;
  let inputEl: HTMLInputElement;

  // the component mounts fresh every time the picker opens,
  // so the initial values above are the reset state
  import { onMount, onDestroy } from "svelte";
  onMount(() => {
    setTimeout(() => inputEl?.focus(), 0);
  });
  onDestroy(() => {
    // the picker can be destroyed without closePicker() running (the editor
    // is closed while the picker is open) — the pending "insert after
    // picking" flag lives on `window` and would otherwise leak into the
    // NEXT editing session
    clearInsertFlag();
  });

  $: list = SHAPES.filter((s) => s.name.toLowerCase().includes(query.toLowerCase()) || s.label.toLowerCase().includes(query.toLowerCase()));
  $: idx = Math.min(idx, Math.max(0, list.length - 1));

  function clearInsertFlag(): void {
    (window as unknown as { __teInsertAfterShape?: boolean }).__teInsertAfterShape = false;
  }

  /** Close via backdrop / Escape — must also drop the pending "insert a
   *  shape right after picking" flag or it leaks into the next creation. */
  function closePicker(): void {
    shapePickerOpen.set(false);
    clearInsertFlag();
  }

  function apply(shapeName: string) {
    shapePickerOpen.set(false);
    const insert = (window as unknown as { __teInsertAfterShape?: boolean }).__teInsertAfterShape ?? false;
    clearInsertFlag();
    editor.createShape(shapeName, insert);
    statusMessage.set(`Shape → ${shapeName}`);
  }

  function onKeyDown(e: KeyboardEvent) {
    if (e.isComposing || e.keyCode === 229) return; // IME confirmation is not a command
    if (e.key === "Enter") {
      e.preventDefault();
      if (list[idx]) apply(list[idx].name);
      return;
    }
    if (e.key === "Alt" || e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      closePicker();
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      idx = (idx + 1) % list.length;
      scrollTo(idx);
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      idx = (idx - 1 + list.length) % list.length;
      scrollTo(idx);
    }
  }

  function scrollTo(i: number) {
    const el = document.querySelector(`[data-sidx="${i}"]`);
    el?.scrollIntoView({ block: "nearest" });
  }
</script>

<div class="te-modal-backdrop" on:click={closePicker}>
    <div class="te-shape-picker" on:click|stopPropagation>
      <div class="te-sp-title">Shape 选择形状 (search / ↑↓ / Enter)</div>
      <input
        bind:this={inputEl}
        class="te-sp-input"
        type="text"
        placeholder="Search shape... 搜索形状"
        bind:value={query}
        on:keydown={onKeyDown}
      />
      <div class="te-sp-list">
        {#each list as s, i (s.name)}
          <div
            class="te-sp-item {i === idx ? 'te-sp-active' : ''}"
            data-sidx={i}
            on:mouseenter={() => (idx = i)}
            on:click={() => apply(s.name)}
          >
            {s.label}
          </div>
        {/each}
        {#if list.length === 0}
          <div class="te-sp-empty">No match 无匹配</div>
        {/if}
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
  .te-shape-picker {
    background: var(--background-primary);
    border: 1px solid var(--background-modifier-border);
    border-radius: 8px;
    padding: 12px;
    width: 240px;
    display: flex;
    flex-direction: column;
    gap: 8px;
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.3);
  }
  .te-sp-title {
    font-size: 12px;
    font-weight: bold;
    color: var(--text-normal);
    font-family: var(--font-monospace);
  }
  .te-sp-input {
    width: 100%;
    background: var(--background-secondary);
    border: 1px solid var(--background-modifier-border);
    border-radius: 4px;
    color: var(--text-normal);
    padding: 5px 8px;
    font-size: 12px;
  }
  .te-sp-list {
    display: flex;
    flex-direction: column;
    gap: 2px;
    max-height: 220px;
    overflow-y: auto;
  }
  .te-sp-item {
    padding: 6px 10px;
    border-radius: 4px;
    cursor: pointer;
    font-family: var(--font-monospace);
    font-size: 12px;
    color: var(--text-normal);
  }
  .te-sp-item:hover,
  .te-sp-active {
    background: var(--background-modifier-hover);
  }
  .te-sp-empty {
    color: var(--text-faint);
    font-size: 12px;
    padding: 8px;
  }
</style>
