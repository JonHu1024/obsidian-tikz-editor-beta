<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import Toolbar from "./Preview/Toolbar.svelte";
  import PreviewCanvas from "./Preview/PreviewCanvas.svelte";
  import InsertOverlay from "./Preview/InsertOverlay.svelte";
  import CdPanel from "./Preview/CdPanel.svelte";
  import PropertiesPanel from "./Properties/PropertiesPanel.svelte";
  import StatusBar from "./Preview/StatusBar.svelte";
  import ColorPicker from "./shared/ColorPicker.svelte";
  import ShapePicker from "./shared/ShapePicker.svelte";
  import ArrowTipPicker from "./shared/ArrowTipPicker.svelte";
  import HelpOverlay from "./shared/HelpOverlay.svelte";
  import { vim } from "../vim/VimController";
  import { editor } from "../EditorController";
  import { graph, renderError, statusMessage, colorPickerOpen, shapePickerOpen, arrowTipPickerOpen, graphVersion, helpOpen } from "../state";
  import katexCss from "../core/katex-inline.css";

  let rootEl: HTMLDivElement;
  let isReady = false;

  // In tikzcd mode the reference editor handles ALL keyboard input (it owns
  // its own document-level listeners); the vim layer is bypassed entirely.
  $: cdMode = $graph.env === "cd";

  // Listening at window level (capture) so Vim keys work no matter where
  // focus ended up (e.g. after the INSERT textarea is removed).
  function onKeyDown(e: KeyboardEvent) {
    if (cdMode) return;
    vim.keydown(e);
  }

  function onRootClick(e: MouseEvent) {
    if (!isReady) return;
    // Focus stealing is unnecessary (the keydown listener is window-level),
    // and harmful: it would blur CodeMirror / inputs. Only release buttons
    // so Space/Enter do not re-trigger them.
    const t = e.target as HTMLElement;
    const btn = t.closest("button");
    if (btn) btn.blur();
  }

  onMount(async () => {
    window.addEventListener("keydown", onKeyDown, true);
    // KaTeX styles (self-contained, CSP-safe). Selectors are scoped under
    // .te-root so Obsidian's built-in KaTeX CSS cannot override them and
    // vice versa.
    if (!document.getElementById("te-katex-css")) {
      const style = document.createElement("style");
      style.id = "te-katex-css";
      style.textContent = katexCss.replace(/(^|[,}])\s*\.katex/g, "$1.te-root .katex");
      document.head.appendChild(style);
    }
    statusMessage.set("NORMAL mode - t/s/a create, i edit, u undo, ok insert");
    isReady = true;
    rootEl.focus({ preventScroll: true });
  });

  onDestroy(() => {
    window.removeEventListener("keydown", onKeyDown, true);
  });
</script>

<div
  class="te-root"
  tabindex="0"
  bind:this={rootEl}
  on:keydown={onKeyDown}
  on:click={onRootClick}
>
  {#if cdMode}
    <div class="te-cd-host">
      {#key $graphVersion}
        <CdPanel />
      {/key}
    </div>
    <StatusBar />
  {:else}
    <div class="te-main">
      <div class="te-left">
        <Toolbar />
        <div class="te-left-canvas">
          <PreviewCanvas />
          <InsertOverlay />
        </div>
      </div>
      <div class="te-right">
        <div class="te-right-props">
          <PropertiesPanel />
        </div>
      </div>
    </div>
    <StatusBar />
    {#if $colorPickerOpen}
      <ColorPicker />
    {/if}
    {#if $shapePickerOpen}
      <ShapePicker />
    {/if}
    {#if $arrowTipPickerOpen}
      <ArrowTipPicker />
    {/if}
  {/if}
  <HelpOverlay />
</div>

<style>
  .te-root {
    display: flex;
    flex-direction: column;
    height: 100%;
    outline: none;
    user-select: none;
  }
  /* the root is a tab stop (it receives the keyboard focus) — it must show
   * where the focus is, otherwise keyboard users are lost */
  .te-root:focus-visible {
    outline: 2px solid var(--interactive-accent);
    outline-offset: -2px;
  }
  .te-main {
    display: flex;
    flex: 1;
    min-height: 0;
  }
  .te-left {
    flex: 5;
    min-width: 0;
    display: flex;
    flex-direction: column;
    border-right: 1px solid var(--background-modifier-border);
  }
  .te-left-canvas {
    position: relative;
    flex: 1;
    min-height: 0;
  }
  .te-right {
    flex: 5;
    min-width: 0;
    display: flex;
    flex-direction: column;
  }
  .te-right-props {
    flex: 6;
    min-height: 0;
    display: flex;
    flex-direction: column;
  }
  .te-cd-host {
    position: relative;
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
  }
</style>
