<script lang="ts">
  import { editor } from "../../EditorController";
  import { graph } from "../../state";
  import type { GridConfig } from "../../core/types";

  let g = $graph;
  $: g = $graph;

  function patch(p: Partial<GridConfig>) {
    editor.mutate((gg) => {
      gg.grid = { ...gg.grid, ...p };
    }, true);
  }
</script>

<h3 class="te-sec-title">Grid <span class="te-tip" title="网格设置">ⓘ</span></h3>

<div class="te-field">
  <label class="te-inline"><input type="checkbox" checked={g.grid.enabled} on:change={(e) => patch({ enabled: e.currentTarget.checked })} /> Show Grid 显示网格</label>
</div>

{#if g.grid.enabled}
  <div class="te-field">
    <label for="te-grid-step">Step 网格间距 (cm)</label>
    <input
      id="te-grid-step"
      type="number"
      min="0.2"
      step="0.2"
      value={g.grid.step}
      on:change={(e) => patch({ step: Math.max(0.2, parseFloat(e.currentTarget.value) || 1) })}
    />
  </div>
  <div class="te-field">
    <label for="te-grid-color">Color 颜色</label>
    <input id="te-grid-color" type="text" value={g.grid.color} on:input={(e) => patch({ color: e.currentTarget.value })} />
  </div>
  <div class="te-field">
    <label class="te-inline"><input type="checkbox" checked={g.grid.dashed} on:change={(e) => patch({ dashed: e.currentTarget.checked })} /> Dashed 虚线</label>
  </div>
{/if}

<style>
  .te-field { margin-bottom: 10px; }
  .te-sec-title {
    margin: 0 0 10px;
    font-size: 13px;
    text-transform: uppercase;
    color: var(--text-accent);
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .te-tip { font-size: 11px; color: var(--text-faint); cursor: help; }
  .te-inline { display: flex !important; align-items: center; gap: 6px; cursor: pointer; }
  :global(.te-field label) {
    display: block;
    font-size: 11px;
    color: var(--text-muted);
    margin-bottom: 3px;
  }
  :global(.te-field input[type="text"]),
  :global(.te-field input[type="number"]) {
    width: 100%;
    background: var(--background-primary);
    color: var(--text-normal);
    border: 1px solid var(--background-modifier-border);
    border-radius: 4px;
    padding: 4px 8px;
    font-size: 12px;
  }
</style>
