<script lang="ts">
  import { editor } from "../../EditorController";
  import { graph } from "../../state";
  import type { AxisConfig } from "../../core/types";

  let g = $graph;
  $: g = $graph;

  function patch(p: Partial<AxisConfig>) {
    editor.mutate((gg) => {
      gg.axis = { ...gg.axis, ...p };
    }, true);
  }

  function setType(v: string) {
    patch({ type: v === "polar" ? "polar" : "cartesian" });
  }

  function setStyle(v: string) {
    patch({ style: v === "box" ? "box" : v === "axes" ? "axes" : "middle" });
  }
</script>

<h3 class="te-sec-title">Axis <span class="te-tip" title="坐标系设置: Cartesian 直角坐标系 / Polar 极坐标系">ⓘ</span></h3>

<div class="te-field">
  <label class="te-inline"><input type="checkbox" checked={g.axis.enabled} on:change={(e) => patch({ enabled: e.currentTarget.checked })} /> Show Axis 显示坐标系</label>
</div>

{#if g.axis.enabled}
  <div class="te-field">
    <label for="te-axis-type">Type 类型</label>
    <select id="te-axis-type" value={g.axis.type} on:change={(e) => setType(e.currentTarget.value)}>
      <option value="cartesian">Cartesian 直角坐标</option>
      <option value="polar">Polar 极坐标</option>
    </select>
  </div>

  {#if g.axis.type === "cartesian"}
    <div class="te-field te-row">
      <div>
        <label for="te-axis-xlabel">X Label X轴标签</label>
        <input id="te-axis-xlabel" type="text" value={g.axis.xLabel} on:input={(e) => patch({ xLabel: e.currentTarget.value })} />
      </div>
      <div>
        <label for="te-axis-ylabel">Y Label Y轴标签</label>
        <input id="te-axis-ylabel" type="text" value={g.axis.yLabel} on:input={(e) => patch({ yLabel: e.currentTarget.value })} />
      </div>
    </div>
    <div class="te-field">
      <label for="te-axis-style">Style 样式</label>
      <select id="te-axis-style" value={g.axis.style} on:change={(e) => setStyle(e.currentTarget.value)}>
        <option value="box">Box 四周框线</option>
        <option value="middle">Middle 穿过原点</option>
        <option value="axes">Axes 仅坐标轴</option>
      </select>
    </div>
    <div class="te-field">
      <label for="te-axis-step">Tick step 刻度间距</label>
      <input id="te-axis-step"
        type="number"
        min="0.2"
        step="0.2"
        value={g.axis.step}
        on:change={(e) => patch({ step: Math.max(0.2, parseFloat(e.currentTarget.value) || 1) })}
      />
    </div>
  {/if}
{/if}

<style>
  .te-field { margin-bottom: 10px; }
  .te-row { display: flex; gap: 10px; }
  .te-row > div { flex: 1; }
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
  :global(.te-field input[type="number"]),
  :global(.te-field select) {
    width: 100%;
    background: var(--background-primary);
    color: var(--text-normal);
    border: 1px solid var(--background-modifier-border);
    border-radius: 4px;
    padding: 4px 8px;
    font-size: 12px;
  }
</style>
