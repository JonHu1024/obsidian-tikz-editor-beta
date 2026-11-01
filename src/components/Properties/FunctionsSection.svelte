<script lang="ts">
  import { editor } from "../../EditorController";
  import { graph, selectedId, statusMessage } from "../../state";
  import type { FunctionObject } from "../../core/types";
  import { buildMultiPlotTemplate } from "../../core/multiPlot";

  let multiOpen = false;
  let multiExpr = "";

  async function insertMultiPlot() {
    const exprs = multiExpr.split("\n").map((e) => e.trim()).filter(Boolean);
    if (exprs.length === 0) {
      statusMessage.set("Enter at least one function");
      return;
    }
    const code = buildMultiPlotTemplate(exprs);
    const r = await editor.insertToNoteWithCode(code);
    statusMessage.set(r.message);
  }

  let g = $graph;
  let sel = $selectedId;
  $: g = $graph;
  $: sel = $selectedId;

  $: funcs = g.objects.filter((o) => o.type === "function") as FunctionObject[];

  function patchFn(id: string, p: Partial<FunctionObject>) {
    editor.mutate((gg) => {
      const o = gg.objects.find((x) => x.id === id);
      if (o && o.type === "function") {
        Object.assign(o, p);
      }
    }, true);
  }

  function removeFn(id: string) {
    editor.mutate((gg) => {
      gg.objects = gg.objects.filter((o) => o.id !== id);
    });
    if (sel === id) selectedId.set(null);
  }
</script>

<h3 class="te-sec-title">Functions <span class="te-tip" title="函数列表: name 名称, expression 表达式 (支持 sin cos tan exp ln sqrt abs mod 等, 变量为 x), color 颜色">ⓘ</span></h3>

<div class="te-fn-list">
  {#each funcs as fn, i (fn.id)}
    <div class="te-fn-card {sel === fn.id ? 'te-fn-selected' : ''}" on:click={() => selectedId.set(fn.id)}>
      <div class="te-fn-header">
        <span class="te-fn-idx">f{i + 1}</span>
        <button
          class="te-fn-del"
          title="Delete function 删除函数"
          on:click|stopPropagation={() => removeFn(fn.id)}
        >✕</button>
      </div>
      <div class="te-field">
        <label for="te-fn-name">Name 名称</label>
        <input id="te-fn-name" type="text" value={fn.text} placeholder={`f${i + 1}`} on:input={(e) => patchFn(fn.id, { text: e.currentTarget.value })} />
      </div>
      <div class="te-field">
        <label for="te-fn-expr">Expression 表达式</label>
        <input id="te-fn-expr" type="text" value={fn.expression} on:input={(e) => patchFn(fn.id, { expression: e.currentTarget.value })} />
      </div>
      <div class="te-field te-row">
        <div>
          <label for="te-fn-color">Color 颜色</label>
          <input id="te-fn-color" type="text" value={fn.color} on:input={(e) => patchFn(fn.id, { color: e.currentTarget.value })} />
        </div>
        <div>
          <label for="te-fn-dom0">Domain 范围 (from)</label>
          <input id="te-fn-dom0" type="number" step="0.5" value={fn.domain[0]} on:change={(e) => { const v = parseFloat(e.currentTarget.value); if (!isNaN(v)) patchFn(fn.id, { domain: [v, Math.max(v, fn.domain[1])] }); }} />
        </div>
        <div>
          <label for="te-fn-dom1">to</label>
          <input id="te-fn-dom1" type="number" step="0.5" value={fn.domain[1]} on:change={(e) => { const v = parseFloat(e.currentTarget.value); if (!isNaN(v)) patchFn(fn.id, { domain: [Math.min(fn.domain[0], v), v] }); }} />
        </div>
      </div>
    </div>
  {/each}
  {#if funcs.length === 0}
    <p class="te-fn-empty">No functions. Press <code>f</code> or use the button below. 暂无函数, 按 f 键添加</p>
  {/if}
</div>

<button class="te-fn-add" on:click={() => editor.createFunction()}>+ Add function 添加函数</button>

<div class="te-multi">
  <button class="te-fn-add" on:click={() => (multiOpen = !multiOpen)}>⇉ Multi-function plot 多函数绘图</button>
  {#if multiOpen}
    <div class="te-multi-box">
      <label class="te-multi-label" for="te-multi-expr">One expression per line 每行一个函数表达式 (e.g. sin(x) / x^2)</label>
      <textarea id="te-multi-expr" bind:value={multiExpr} class="te-multi-ta" rows="4" placeholder={"sin(x)\ncos(x)\nx^2/4 - 1"}></textarea>
      <button class="te-multi-insert" on:click={insertMultiPlot}>Insert template 插入模板</button>
    </div>
  {/if}
</div>

<style>
  .te-fn-list { display: flex; flex-direction: column; gap: 8px; margin-bottom: 10px; }
  .te-fn-card {
    border: 1px solid var(--background-modifier-border);
    border-radius: 6px;
    padding: 8px;
    cursor: pointer;
  }
  .te-fn-card:hover { border-color: var(--interactive-accent); }
  .te-fn-selected { border-color: var(--interactive-accent); box-shadow: 0 0 4px var(--interactive-accent); }
  .te-fn-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px; }
  .te-fn-idx { font-family: var(--font-monospace); font-size: 11px; color: var(--text-accent); }
  .te-fn-del {
    background: transparent; border: none; color: var(--text-faint);
    cursor: pointer; font-size: 12px; border-radius: 3px;
  }
  .te-fn-del:hover { color: var(--color-red); }
  .te-fn-empty { font-size: 12px; color: var(--text-faint); }
  .te-fn-add {
    width: 100%;
    background: var(--background-secondary-alt);
    border: 1px dashed var(--background-modifier-border);
    color: var(--text-muted);
    border-radius: 6px;
    padding: 6px;
    cursor: pointer;
    font-size: 12px;
  }
  .te-fn-add:hover { color: var(--text-normal); border-color: var(--interactive-accent); }
  .te-multi { margin-top: 10px; display: flex; flex-direction: column; gap: 6px; }
  .te-multi-box { display: flex; flex-direction: column; gap: 6px; border: 1px solid var(--background-modifier-border); border-radius: 6px; padding: 8px; }
  .te-multi-label { font-size: 11px; color: var(--text-muted); }
  .te-multi-ta {
    width: 100%;
    background: var(--background-primary);
    color: var(--text-normal);
    border: 1px solid var(--background-modifier-border);
    border-radius: 4px;
    padding: 6px 8px;
    font-size: 12px;
    font-family: var(--font-monospace);
    resize: vertical;
  }
  .te-multi-insert {
    background: var(--interactive-accent);
    color: var(--text-on-accent);
    border: none;
    border-radius: 6px;
    padding: 6px;
    font-size: 12px;
    cursor: pointer;
  }
  .te-field { margin-bottom: 8px; }
  .te-row { display: flex; gap: 8px; }
  .te-row > div { flex: 1; }
  :global(.te-field label) {
    display: block; font-size: 11px; color: var(--text-muted); margin-bottom: 3px;
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
