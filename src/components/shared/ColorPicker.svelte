<script lang="ts">
  import { editor } from "../../EditorController";
  import { colorPickerOpen, statusMessage } from "../../state";
  import { NAMED_COLORS, colorHex, isValidColor } from "../../utils/colors";

  let query = "";
  let list = NAMED_COLORS;
  let idx = 0;
  let inputEl: HTMLInputElement;
  let custom = "";
  let customError = "";

  // the component mounts fresh every time the picker opens,
  // so the initial values above are the reset state
  import { onMount } from "svelte";
  onMount(() => {
    setTimeout(() => inputEl?.focus(), 0);
  });

  $: list = NAMED_COLORS.filter((c) => c.toLowerCase().includes(query.toLowerCase()));
  $: idx = Math.min(idx, Math.max(0, list.length - 1));

  function apply(color: string) {
    const sel = editor.getSelected();
    if (sel) {
      editor.mutate((g) => {
        const o = g.objects.find((x) => x.id === sel.id);
        if (o) o.color = color;
      });
    }
    colorPickerOpen.set(false);
    statusMessage.set(`Color → ${color}`);
  }

  function onKeyDown(e: KeyboardEvent) {
    if (e.isComposing || e.keyCode === 229) return; // IME confirmation is not a command
    if (e.key === "Enter") {
      e.preventDefault();
      if (list[idx]) apply(list[idx]);
      return;
    }
    if (e.key === "Alt" || e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      colorPickerOpen.set(false);
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
    const el = document.querySelector(`[data-cidx="${i}"]`);
    el?.scrollIntoView({ block: "nearest" });
  }

  function mouseEnter(i: number) {
    idx = i;
  }
</script>

<div class="te-modal-backdrop" on:click={() => colorPickerOpen.set(false)}>
    <div class="te-color-picker" on:click|stopPropagation>
      <div class="te-cp-title">Color 选择颜色 (search / ↑↓ / Enter)</div>
      <input
        bind:this={inputEl}
        class="te-cp-input"
        type="text"
        placeholder="Search color... 搜索颜色"
        bind:value={query}
        on:keydown={onKeyDown}
      />
      <div class="te-cp-list">
        {#each list as c, i (c)}
          <div
            class="te-cp-item {i === idx ? 'te-cp-active' : ''}"
            data-cidx={i}
            on:mouseenter={() => mouseEnter(i)}
            on:click={() => apply(c)}
          >
            <span class="te-cp-swatch" style="background: {colorHex(c)}"></span>
            <span class="te-cp-name">{c}</span>
          </div>
        {/each}
        {#if list.length === 0}
          <div class="te-cp-empty">No match 无匹配</div>
        {/if}
      </div>
      <div class="te-cp-footer">
        Custom: <input
          class="te-cp-input"
          type="text"
          placeholder="e.g. blue!50"
          bind:value={custom}
          on:input={() => (customError = "")}
          on:keydown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              const v = custom.trim();
              if (!v) return;
              // an unknown colour name makes pgf fail with "Undefined color"
              // and breaks the whole tikz block in the note — reject it here
              if (!isValidColor(v)) {
                customError = `Unknown color "${v}" — use a name like red / blue / blue!50`;
                statusMessage.set(customError);
                return;
              }
              apply(v);
            }
          }}
        />
      </div>
      {#if customError}
        <div class="te-cp-error">{customError}</div>
      {/if}
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
  .te-color-picker {
    background: var(--background-primary);
    border: 1px solid var(--background-modifier-border);
    border-radius: 8px;
    padding: 12px;
    width: 260px;
    max-height: 70%;
    display: flex;
    flex-direction: column;
    gap: 8px;
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.3);
  }
  .te-cp-title {
    font-size: 12px;
    font-weight: bold;
    color: var(--text-normal);
    font-family: var(--font-monospace);
  }
  .te-cp-input {
    width: 100%;
    background: var(--background-secondary);
    border: 1px solid var(--background-modifier-border);
    border-radius: 4px;
    color: var(--text-normal);
    padding: 5px 8px;
    font-size: 12px;
  }
  .te-cp-list {
    flex: 1;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-height: 80px;
  }
  .te-cp-item {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 4px 8px;
    border-radius: 4px;
    cursor: pointer;
    font-family: var(--font-monospace);
    font-size: 12px;
    color: var(--text-normal);
  }
  .te-cp-item:hover,
  .te-cp-active {
    background: var(--background-modifier-hover);
  }
  .te-cp-swatch {
    width: 14px;
    height: 14px;
    border-radius: 3px;
    border: 1px solid var(--background-modifier-border);
  }
  .te-cp-empty {
    color: var(--text-faint);
    font-size: 12px;
    padding: 8px;
  }
  .te-cp-footer {
    font-size: 11px;
    color: var(--text-muted);
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .te-cp-error {
    font-size: 11px;
    color: var(--text-error);
    background: var(--background-modifier-error);
    border: 1px solid var(--color-red);
    border-radius: 4px;
    padding: 4px 6px;
  }
</style>
