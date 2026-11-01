<script lang="ts">
  import { activeTab, activeSection } from "../../state";
  import type { SectionId } from "../../state";
  import GraphSection from "./GraphSection.svelte";
  import AxisSection from "./AxisSection.svelte";
  import GridSection from "./GridSection.svelte";
  import FunctionsSection from "./FunctionsSection.svelte";
  import ArrowSection from "./ArrowSection.svelte";
  import ReferenceSection from "./ReferenceSection.svelte";
  import NodesSection from "./NodesSection.svelte";
  import CodeSection from "./CodeSection.svelte";

  let tab = $activeTab;
  let section = $activeSection;

  $: tab = $activeTab;
  $: section = $activeSection;

  const NAV: { id: SectionId; label: string }[] = [
    { id: "graph", label: "Graph" },
    { id: "axis", label: "Axis" },
    { id: "grid", label: "Grid" },
    { id: "functions", label: "Functions" },
    { id: "arrow", label: "Arrows" },
    { id: "reference", label: "Reference" },
    { id: "nodes", label: "Nodes" },
  ];

  function gotoSection(id: SectionId) {
    activeSection.set(id);
    document.getElementById(`te-sec-${id}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
  }
</script>

<div class="te-props">
  <div class="te-props-tabs">
    <button
      class="te-props-tab {tab === 'props' ? 'te-active' : ''}"
      on:click={() => activeTab.set("props")}
    >Properties</button>
    <button
      class="te-props-tab {tab === 'code' ? 'te-active' : ''}"
      on:click={() => activeTab.set("code")}
    >Code</button>
  </div>

  {#if tab === "props"}
    <div class="te-props-nav">
      {#each NAV as n}
        <button
          class="te-nav-btn {section === n.id ? 'te-active' : ''}"
          on:click={() => gotoSection(n.id)}
        >{n.label}</button>
      {/each}
    </div>
    <div class="te-props-scroll">
      <section id="te-sec-graph" class="te-sec"><GraphSection /></section>
      <section id="te-sec-axis" class="te-sec"><AxisSection /></section>
      <section id="te-sec-grid" class="te-sec"><GridSection /></section>
      <section id="te-sec-functions" class="te-sec"><FunctionsSection /></section>
      <section id="te-sec-arrow" class="te-sec"><ArrowSection /></section>
      <section id="te-sec-reference" class="te-sec"><ReferenceSection /></section>
      <section id="te-sec-nodes" class="te-sec"><NodesSection /></section>
    </div>
  {:else}
    <div class="te-code-wrap">
      <CodeSection />
    </div>
  {/if}
</div>

<style>
  .te-props {
    display: flex;
    flex-direction: column;
    flex: 1;
    min-height: 0;
  }
  .te-props-tabs {
    display: flex;
    border-bottom: 1px solid var(--background-modifier-border);
  }
  .te-props-tab {
    flex: 1;
    background: transparent;
    border: none;
    border-bottom: 2px solid transparent;
    padding: 6px 0;
    font-size: 13px;
    color: var(--text-muted);
    cursor: pointer;
    font-family: var(--font-monospace);
  }
  .te-props-tab:hover {
    color: var(--text-normal);
  }
  .te-props-tab.te-active {
    color: var(--text-normal);
    border-bottom-color: var(--interactive-accent);
    font-weight: bold;
  }
  .te-props-nav {
    display: flex;
    flex-wrap: wrap;
    gap: 2px;
    padding: 6px;
    border-bottom: 1px solid var(--background-modifier-border);
  }
  .te-nav-btn {
    background: transparent;
    border: 1px solid transparent;
    border-radius: 10px;
    padding: 2px 10px;
    font-size: 11px;
    color: var(--text-muted);
    cursor: pointer;
    font-family: var(--font-monospace);
  }
  .te-nav-btn:hover {
    color: var(--text-normal);
    background: var(--background-modifier-hover);
  }
  .te-nav-btn.te-active {
    color: var(--text-accent);
    border-color: var(--interactive-accent);
  }
  .te-props-scroll {
    flex: 1;
    overflow-y: auto;
    padding: 8px 12px;
  }
  .te-code-wrap {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
    padding: 8px 12px;
    overflow: hidden;
  }
  .te-sec {
    margin-bottom: 18px;
  }
</style>
