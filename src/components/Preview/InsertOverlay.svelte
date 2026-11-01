<script lang="ts">
  import { onMount } from "svelte";
  import { editor } from "../../EditorController";
  import { insertState, vimMode, graph, selectedId, canvasInfo } from "../../state";
  import type { TikZObject } from "../../core/types";
  import { exactObjectBounds } from "../../core/types";
  import { cmToLocal } from "../../utils/geometry";

  let info = $canvasInfo;
  let g = $graph;
  let st = $insertState;
  let ta1: HTMLTextAreaElement;
  let ta2: HTMLTextAreaElement;

  $: info = $canvasInfo;
  $: g = $graph;
  $: st = $insertState;

  let obj: TikZObject | null = null;
  let pos = { x: 0, y: 0 };
  let pos2 = { x: 0, y: 0 };
  let caretPlaced = false;
  let lastStKey = "";
  let lastStSession = -1;
  $: {
    if (st) {
      obj = g.objects.find((o) => o.id === st.id) ?? null;
      if (obj) {
        if (obj.type === "arrow") {
          // labels sit just above / below the arrow midpoint
          // (left/right for vertical arrows)
          const p = cmToLocal((obj.x1 + obj.x2) / 2, (obj.y1 + obj.y2) / 2, g.height, info);
          const vertical = Math.abs(obj.y2 - obj.y1) > Math.abs(obj.x2 - obj.x1);
          const off = 9 * info.zoom;
          pos = vertical
            ? { x: p.x * info.zoom + info.panX - info.scrollX - off, y: p.y * info.zoom + info.panY - info.scrollY }
            : { x: p.x * info.zoom + info.panX - info.scrollX, y: p.y * info.zoom + info.panY - info.scrollY - off };
          pos2 = vertical
            ? { x: p.x * info.zoom + info.panX - info.scrollX + off, y: p.y * info.zoom + info.panY - info.scrollY }
            : { x: p.x * info.zoom + info.panX - info.scrollX, y: p.y * info.zoom + info.panY - info.scrollY + off };
        } else {
          // the edit box sits just below the node so its live render stays visible
          const b = exactObjectBounds(obj);
          const p = cmToLocal((b.left + b.right) / 2, b.bottom, g.height, info);
          const gap = 6 * info.zoom;
          pos = {
            x: p.x * info.zoom + info.panX - info.scrollX,
            y: p.y * info.zoom + info.panY - info.scrollY + gap,
          };
          pos2 = pos;
        }
      }
    } else {
      obj = null;
    }
  }

  function afterTick() {
    setTimeout(() => {
      const ta = st?.field === "textBelow" ? ta2 : ta1;
      // already focused (e.g. re-run of this block after our own input event)?
      // then only resize — re-focusing would yank the caret back mid-typing
      // when the user clicked away to inspect the canvas
      if (ta && document.activeElement !== ta) ta.focus();
      if (ta) autoSize(ta);
      if (ta && !caretPlaced) {
        // place the caret inside the $...$ pair of the label — the user
        // types the MATH part there. Only for a freshly opened object (see
        // the reactive block below), never when switching between the two
        // label boxes, where the click position must be respected.
        const v = ta.value;
        if (v.startsWith("$")) ta.setSelectionRange(1, 1);
        caretPlaced = true;
      }
    }, 0);
  }

  function autoSize(ta: HTMLTextAreaElement) {
    ta.style.width = "auto";
    ta.style.width = Math.max(60, ta.scrollWidth + 4) + "px";
    ta.style.height = "auto";
    ta.style.height = ta.scrollHeight + "px";
  }

  onMount(() => {
    afterTick();
  });

  function onInput(e: Event, field: "text" | "textBelow" | "expression") {
    if (!st) return;
    // write to the field of the textarea the user is actually typing in —
    // the previous code wrote every keystroke into the ACTIVE field, so
    // typing into the inactive (dimmed) label box corrupted the other label
    editor.finishInsert(st.id, field, (e.target as HTMLTextAreaElement).value);
    autoSize(e.target as HTMLTextAreaElement);
  }

  /** Clicking / focusing the other label's box moves the active field there.
   *  This is NOT a new editing session — the caret must stay where the
   *  user clicked. */
  function onFieldFocus(field: "text" | "textBelow") {
    if (obj?.type === "arrow" && st && st.field !== field) {
      editor.startInsert(st.id, field, false);
    }
  }

  function onKeyDown(e: KeyboardEvent) {
    // Alt (handled at window level) exits INSERT mode; ESC is left alone
    // so Obsidian's modal closes on ESC.
    if (e.key === "Tab") {
      e.preventDefault();
      if (obj?.type === "arrow") {
        const next = st?.field === "textBelow" ? "text" : "textBelow";
        if (st) editor.startInsert(st.id, next, false);
      }
    }
  }

  $: {
    const key = st ? `${st.id}:${st.field}:${st.session}` : "";
    if (key !== lastStKey) {
      lastStKey = key;
      // A NEW editing session (the user opened the label) places the caret
      // inside the $...$ pair. Switching between the two label boxes of the
      // SAME object keeps the session number and must NOT move the caret.
      if (st && st.session !== lastStSession) {
        lastStSession = st.session;
        caretPlaced = false;
      }
      // focus the freshly opened editor only — re-running this on every
      // graph change queued a timeout per keystroke
      if (st && obj) afterTick();
    }
  }
</script>

{#if st && obj}
  {#if obj.type === "arrow"}
    <textarea
      bind:this={ta1}
      class="te-insert-ta te-insert-pos {st.field === 'text' ? 'te-insert-active' : ''}"
      style="left: {pos.x}px; top: {pos.y}px;"
      value={obj.text}
      on:input={(e) => onInput(e, "text")}
      on:focus={() => onFieldFocus("text")}
      on:keydown={onKeyDown}
      placeholder="Label - 标签"
      rows="1"
    ></textarea>
    <textarea
      bind:this={ta2}
      class="te-insert-ta te-insert-pos {st.field === 'textBelow' ? 'te-insert-active' : ''}"
      style="left: {pos2.x}px; top: {pos2.y}px;"
      value={obj.textBelow}
      on:input={(e) => onInput(e, "textBelow")}
      on:focus={() => onFieldFocus("textBelow")}
      on:keydown={onKeyDown}
      placeholder="Label - 标签"
      rows="1"
    ></textarea>
  {:else}
    <textarea
      bind:this={ta1}
      class="te-insert-ta te-insert-pos te-insert-active"
      style="left: {pos.x}px; top: {pos.y}px;"
      value={obj.type === "function" ? obj.expression : obj.text}
      on:input={(e) => onInput(e, obj.type === "function" ? "expression" : "text")}
      on:keydown={onKeyDown}
      placeholder={obj.type === "function" ? "Expression 函数表达式 (e.g. sin(x))" : "Text (supports $math$, multi-line) - 支持数学公式和多行"}
      rows="1"
    ></textarea>
  {/if}
{/if}

<style>
  .te-insert-ta {
    min-width: 60px;
    max-width: 420px;
    font-size: 10px;
    background: transparent;
    color: var(--text-normal);
    border: 1px dashed var(--interactive-accent);
    border-radius: 3px;
    padding: 1px 4px;
    font-family: var(--font-monospace);
    line-height: 1.25;
    opacity: 0.85;
    overflow: hidden;
    resize: none;
    white-space: pre;
    overflow-wrap: normal;
  }
  .te-insert-pos {
    position: absolute;
    transform: translate(-50%, 0);
    z-index: 20;
  }
  .te-insert-ta.te-insert-active {
    opacity: 1;
    border-style: solid;
    border-color: var(--interactive-accent);
  }
</style>
