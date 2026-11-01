<script lang="ts">
  import { graph, selectedId } from "../../state";
  import { editor } from "../../EditorController";
  import type { ArrowObject } from "../../core/types";

  let sel = $selectedId;

  $: sel = $selectedId;
  $: arrow = (sel ? $graph.objects.find((o) => o.id === sel) : null) as ArrowObject | null;

  const HEADS: { id: ArrowObject["head"]; label: string; title: string }[] = [
    { id: "end", label: "→", title: "Arrow at end -> 末端箭头" },
    { id: "start", label: "←", title: "Arrow at start <- 起点箭头" },
    { id: "both", label: "↔", title: "Both ends <-> 双向箭头" },
    { id: "none", label: "—", title: "Plain line 无箭头" },
  ];
  const TIPS: { id: ArrowObject["tip"]; label: string; title: string }[] = [
    { id: "arrow", label: "▸", title: "arrow -> 默认箭头" },
    { id: "latex", label: "▶", title: "latex 细长箭头" },
    { id: "stealth", label: "►", title: "stealth 隐形战机箭头" },
    { id: "to", label: "▷", title: "to 小箭头" },
    { id: "triangle", label: "△", title: "triangle 45 大三角" },
    { id: "angle", label: "∠", title: "angle 60 角形" },
    { id: "o", label: "○", title: "o 空心圆" },
    { id: "star", label: "●", title: "* 实心圆" },
    { id: "bar", label: "⎸", title: "| 竖杠" },
    { id: "diamond", label: "◇", title: "diamond 菱形" },
  ];
  const DASHES: { id: ArrowObject["dash"]; label: string; title: string }[] = [
    { id: "solid", label: "──", title: "Solid 实线" },
    { id: "dashed", label: "┄┄", title: "Dashed 虚线" },
    { id: "dotted", label: "⋯⋯", title: "Dotted 点线" },
  ];
  function setHead(h: ArrowObject["head"]) {
    if (arrow) editor.setArrowStyle(arrow.id, h, arrow.tip, arrow.dash);
  }
  function setTip(t: ArrowObject["tip"]) {
    if (arrow) editor.setArrowStyle(arrow.id, arrow.head, t, arrow.dash);
  }
  function setDash(d: ArrowObject["dash"]) {
    if (arrow) editor.setArrowStyle(arrow.id, arrow.head, arrow.tip, d);
  }
</script>

<div class="te-arrow-sec">
  <div class="te-arrow-title">Arrow Style 箭头样式 <span class="te-arrow-hint2">(ARROW EDITING 模式下按 a 也可选择)</span></div>
  {#if !arrow || arrow.type !== "arrow"}
    <div class="te-arrow-hint">Select an arrow to style it 选中一个箭头进行样式设置</div>
  {:else}
    <div class="te-arrow-row">
      <span class="te-arrow-label">Head 箭头</span>
      <div class="te-arrow-btns">
        {#each HEADS as h}
          <button
            class="te-arrow-btn {arrow.head === h.id ? 'te-arrow-active' : ''}"
            title={h.title}
            on:click={() => setHead(h.id)}
          >{h.label}</button>
        {/each}
      </div>
    </div>
    <div class="te-arrow-row">
      <span class="te-arrow-label">Tip 样式</span>
      <div class="te-arrow-btns te-arrow-wrap">
        {#each TIPS as t}
          <button
            class="te-arrow-btn {arrow.tip === t.id ? 'te-arrow-active' : ''}"
            title={t.title}
            on:click={() => setTip(t.id)}
          >{t.label}</button>
        {/each}
      </div>
    </div>
    <div class="te-arrow-row">
      <span class="te-arrow-label">Line 线条</span>
      <div class="te-arrow-btns">
        {#each DASHES as d}
          <button
            class="te-arrow-btn {arrow.dash === d.id ? 'te-arrow-active' : ''}"
            title={d.title}
            on:click={() => setDash(d.id)}
          >{d.label}</button>
        {/each}
      </div>
    </div>
  {/if}
</div>

<style>
  .te-arrow-sec {
    display: flex;
    flex-direction: column;
    gap: 8px;
    max-width: 340px;
  }
  .te-arrow-title {
    font-size: 12px;
    font-weight: bold;
    color: var(--text-normal);
    font-family: var(--font-monospace);
  }
  .te-arrow-hint2 {
    font-weight: normal;
    color: var(--text-faint);
    font-size: 10px;
  }
  .te-arrow-hint {
    font-size: 12px;
    color: var(--text-faint);
  }
  .te-arrow-row {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .te-arrow-label {
    font-size: 11px;
    color: var(--text-muted);
    width: 52px;
    flex-shrink: 0;
  }
  .te-arrow-btns {
    display: flex;
    gap: 4px;
  }
  .te-arrow-wrap {
    flex-wrap: wrap;
  }
  .te-arrow-btn {
    min-width: 30px;
    background: var(--background-primary);
    border: 1px solid var(--background-modifier-border);
    border-radius: 6px;
    padding: 4px 8px;
    font-size: 13px;
    color: var(--text-muted);
    cursor: pointer;
    font-family: var(--font-monospace);
    line-height: 1;
  }
  .te-arrow-btn:hover {
    color: var(--text-normal);
    background: var(--background-modifier-hover);
  }
  .te-arrow-btn:disabled {
    opacity: 0.4;
    cursor: default;
  }
  .te-arrow-value {
    font-size: 11px;
    color: var(--text-muted);
    font-family: var(--font-monospace);
    min-width: 28px;
    text-align: center;
    align-self: center;
  }
  .te-arrow-btn.te-arrow-active {
    color: var(--text-accent);
    border-color: var(--interactive-accent);
    background: var(--background-modifier-hover);
  }
</style>
