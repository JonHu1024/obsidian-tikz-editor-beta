<script lang="ts">
  import { editor } from "../../EditorController";
  import { graph } from "../../state";

  let g = $graph;
  $: g = $graph;

  function setTitle(v: string) {
    editor.mutate((gg) => (gg.title = v), true);
  }
</script>

<h3 class="te-sec-title">Graph <span class="te-tip" title="整个图的基本属性">ⓘ</span></h3>

<div class="te-field">
  <label for="te-graph-title">Title 标题</label>
  <input id="te-graph-title"
    type="text"
    value={g.title}
    placeholder="Untitled"
    on:input={(e) => setTitle(e.currentTarget.value)}
  />
</div>

<style>
  .te-field {
    margin-bottom: 10px;
  }
  .te-sec-title {
    margin: 0 0 10px;
    font-size: 13px;
    text-transform: uppercase;
    color: var(--text-accent);
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .te-tip {
    font-size: 11px;
    color: var(--text-faint);
    cursor: help;
  }
  :global(.te-field label) {
    display: block;
    font-size: 11px;
    color: var(--text-muted);
    margin-bottom: 3px;
  }
  :global(.te-field input[type="text"]) {
    width: 100%;
    background: var(--background-primary);
    color: var(--text-normal);
    border: 1px solid var(--background-modifier-border);
    border-radius: 4px;
    padding: 4px 8px;
    font-size: 12px;
  }
</style>
