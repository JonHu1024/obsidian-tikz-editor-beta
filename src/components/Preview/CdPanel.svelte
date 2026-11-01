<script lang="ts">
  import { onMount, onDestroy } from "svelte";
import { h, render } from "preact";
import CdApp from "../../cd/App.js";
import { graphToDiagram, diagramToGraph, flipGraphY } from "../../cd/diagram";
import { generateTikZ } from "../../core/TikZGenerator";
import { editor } from "../../EditorController";
import { get } from "svelte/store";
import { graph, statusMessage, cdCommandBuffer } from "../../state";

  let container: HTMLDivElement;
  let latest: { nodes: unknown[]; edges: unknown[] } | null = null;

  /** Obsidian Notice bridge (falls back to console outside Obsidian). */
  function notify(msg: string, isError: boolean): void {
    const cb = (window as unknown as { __teNotice?: (m: string, e: boolean) => void }).__teNotice;
    if (cb) cb(msg, isError);
    else (isError ? console.error : console.info)(msg);
  }

  /** Map the plugin's configurable keybindings onto the reference app. */
  function buildKeys(): Record<string, unknown> {
    const s = editor.plugin?.settings?.keybinds ?? {};
    const undoKey = editor.plugin?.settings?.undoKey ?? "mod+z";
    const redoKey = editor.plugin?.settings?.redoKey ?? "mod+y";
    const arrowFlow = s["cd.arrowFlow"] ?? "a";
    const undo = Array.from(new Set([s["normal.undo"] ?? "u", undoKey]));
    const redo = Array.from(new Set([s["cd.redo"] ?? "r", redoKey]));
    return {
      arrowFlow,
      undo,
      redo,
    };
  }

  function handleDiagramChange(diagram: { nodes: unknown[]; edges: unknown[] }, meta?: { cdMulti: unknown; cdOptions: unknown } | null): void {
    latest = diagram;
    const g = diagramToGraph(diagram as never);
    editor.mutate((cur) => {
      cur.env = "cd";
      cur.objects = g.objects;
      cur.nextId = g.nextId;
      if (meta) {
        // a code-panel Parse delivered fresh cd metadata (multi-diagram
        // layout); grid edits afterwards keep the graph's existing metadata
        cur.cdMulti = meta.cdMulti as typeof cur.cdMulti;
        cur.cdOptions = meta.cdOptions as typeof cur.cdOptions;
      }
    });
  }

  /** Diagram -> TikZ code. The plugin graph rides along as the base so the
   *  cd metadata (multi-diagram ranges/separators, preamble, raw snippets)
   *  survives every edit — a bare conversion would collapse a multi-diagram
   *  layout back into one matrix. */
  function toTeX(diagram: { nodes: unknown[]; edges: unknown[] }): string {
    return generateTikZ(diagramToGraph(diagram as never, get(graph)));
  }

  function handleInsert(diagram: { nodes: unknown[]; edges: unknown[] }): void {
    const code = toTeX(diagram);
    void editor.insertToNoteWithCode(code).then((r) => {
      // insertToNoteWithCode already closes the modal on success — calling
      // afterInserted() again closed it twice (double auto-save, duplicate
      // notice)
      // a silent failure used to look like a dead button (e.g. no active note)
      if (!r.inserted) notify(r.message, true);
    });
  }

  function handleExit(): void {
    if (latest) {
      // the cd grid is row-down, the picture canvas is y-up — without the
      // flip the whole diagram came back mirrored (top row at the bottom)
      const g = flipGraphY(diagramToGraph(latest as never));
      editor.mutate((cur) => {
        cur.env = "picture";
        cur.objects = g.objects;
        cur.nextId = g.nextId;
      });
    } else {
      editor.toggleEnv();
    }
  }

  onMount(() => {
    cdCommandBuffer.set("");
    latest = graphToDiagram(get(graph));
    let vnode = h(CdApp as never, {
      initialDiagram: latest,
      keys: buildKeys(),
      toTeX,
      onDiagramChange: handleDiagramChange,
      onInsert: handleInsert,
      onExit: handleExit,
      onBufferChange: (s: string) => cdCommandBuffer.set(s || ""),
      onNotice: notify,
    });
    render(vnode, container);
    statusMessage.set("tikzcd editor - click a cell to edit, Shift-drag creates arrows, a+direction creates an arrow in one step, click an arrow for styles");
  });

  onDestroy(() => {
    render(null as never, container);
    cdCommandBuffer.set("");
  });
</script>

<div class="te-cd te-cd-wrap" bind:this={container}></div>

<style>
  .te-cd.te-cd-wrap {
    position: relative;
    flex: 1;
    min-height: 0;
    min-width: 0;
    overflow: hidden;
    background: white;
    color: black;
  }
</style>