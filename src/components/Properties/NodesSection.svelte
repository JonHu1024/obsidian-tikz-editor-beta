<script lang="ts">
  import { onMount } from "svelte";
  import { graph, selectedId, focusNodesSearch } from "../../state";
  import { editor } from "../../EditorController";

  let g = $graph;
  let sel = $selectedId;
  let query = "";
  let searchEl: HTMLInputElement;
  let highlightId: string | null = null;

  $: g = $graph;
  $: sel = $selectedId;
  onMount(() => {
    return focusNodesSearch.subscribe((n) => {
      if (n > 0) {
        searchEl?.focus();
        searchEl?.select();
      }
    });
  });

  function typeLabel(o: (typeof g.objects)[number]): string {
    switch (o.type) {
      case "text": return "text";
      case "rectangle": return "rect";
      case "square": return "square";
      case "circle": return "circle";
      case "diamond": return "diamond";
      case "ellipse": return "ellipse";
      case "arrow": return "arrow";
      case "function": return "func";
      default: return o.type;
    }
  }

  function content(o: (typeof g.objects)[number]): string {
    switch (o.type) {
      case "text": return o.text;
      case "rectangle": case "square": case "circle": case "diamond": case "ellipse": return o.text || "";
      case "arrow": return o.text || o.textBelow || "";
      case "function": return o.text ? `${o.text} · ${o.expression}` : o.expression;
      default: return "";
    }
  }

  $: filtered = g.objects.filter((o) => {
    if (!query) return true;
    const q = query.toLowerCase();
    return content(o).toLowerCase().includes(q) || typeLabel(o).includes(q);
  });

  function select(o: (typeof g.objects)[number]) {
    editor.selectAndCenter(o.id);
  }
</script>

<div class="te-nodes">
  <div class="te-nodes-head">
    <span class="te-nodes-title">Nodes 节点列表 <span class="te-nodes-hint">Ctrl+F</span></span>
    <input
      bind:this={searchEl}
      bind:value={query}
      class="te-nodes-search"
      placeholder="Search by content... 按内容搜索"
      on:pointerdown={(e) => e.stopPropagation()}
    />
  </div>
  <div class="te-nodes-list">
    {#if filtered.length === 0}
      <div class="te-nodes-empty">No matching nodes 无匹配节点</div>
    {/if}
    {#each filtered as o (o.id)}
      <button
        class="te-node-item {sel === o.id ? 'te-node-active' : ''}"
        on:click={() => select(o)}
        on:dblclick={() => {
          if (o.type !== "function" && o.type !== "arrow") editor.startInsert(o.id, "text");
        }}
      >
        <span class="te-node-type">{typeLabel(o)}</span>
        <span class="te-node-content">{content(o) || "—"}</span>
      </button>
    {/each}
  </div>
</div>

<style>
  .te-nodes {
    display: flex;
    flex-direction: column;
    gap: 6px;
    max-height: 240px;
  }
  .te-nodes-head {
    display: flex;
    align-items: center;
    gap: 8px;
    justify-content: space-between;
  }
  .te-nodes-title {
    font-size: 12px;
    font-weight: bold;
    color: var(--text-normal);
    font-family: var(--font-monospace);
    white-space: nowrap;
  }
  .te-nodes-hint {
    font-weight: normal;
    color: var(--text-faint);
    font-size: 10px;
  }
  .te-nodes-search {
    flex: 1;
    max-width: 220px;
    background: var(--background-primary);
    border: 1px solid var(--background-modifier-border);
    border-radius: 4px;
    padding: 3px 8px;
    font-size: 12px;
    color: var(--text-normal);
  }
  .te-nodes-search:focus {
    border-color: var(--interactive-accent);
  }
  .te-nodes-list {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 2px;
    max-height: 190px;
    border: 1px solid var(--background-modifier-border);
    border-radius: 6px;
    padding: 4px;
  }
  .te-node-item {
    display: flex;
    align-items: center;
    gap: 8px;
    background: transparent;
    border: 1px solid transparent;
    border-radius: 4px;
    padding: 3px 8px;
    font-size: 12px;
    cursor: pointer;
    text-align: left;
  }
  .te-node-item:hover {
    background: var(--background-modifier-hover);
  }
  .te-node-active {
    border-color: var(--interactive-accent);
    background: var(--background-modifier-hover);
  }
  .te-node-type {
    font-family: var(--font-monospace);
    font-size: 10px;
    color: var(--text-accent);
    background: var(--background-modifier-border);
    border-radius: 8px;
    padding: 1px 6px;
    flex-shrink: 0;
  }
  .te-node-content {
    color: var(--text-muted);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    font-family: var(--font-monospace);
    font-size: 11px;
  }
  .te-nodes-empty {
    color: var(--text-faint);
    font-size: 12px;
    text-align: center;
    padding: 10px;
  }
</style>
