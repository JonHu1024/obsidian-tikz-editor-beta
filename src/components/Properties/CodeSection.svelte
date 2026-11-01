<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import { EditorView, lineNumbers, keymap } from "@codemirror/view";
  import { EditorState, Compartment } from "@codemirror/state";
  import { StreamLanguage, syntaxHighlighting, HighlightStyle } from "@codemirror/language";
  import type { StringStream } from "@codemirror/language";
  import { tags } from "@lezer/highlight";
  import { history, historyKeymap, defaultKeymap, undo, redo } from "@codemirror/commands";
  import { searchKeymap, search } from "@codemirror/search";
  import { get } from "svelte/store";
  import { graph, renderError, statusMessage } from "../../state";
  import { generateTikZ } from "../../core/TikZGenerator";
  import { parseTikZ } from "../../core/TikZParser";
  // `editor` is used by runCode() — the import was missing, which made the
  // whole Code tab unusable: clicking Run threw "editor is not defined"
  // and the edited code was never applied to the model.
  import { editor } from "../../EditorController";

  let cmHost: HTMLDivElement;
  let view: EditorView | null = null;
  let unsub: (() => void) | null = null;
  let syncing = false;
  let lastGenerated = "";
  let editing = false;
  let err = $renderError;
  $: err = $renderError;

  const editableCompartment = new Compartment();

  const tikzLang = StreamLanguage.define({
    token(stream: StringStream) {
      if (stream.match(/%.*/)) {
        stream.skipToEnd();
        return "comment";
      }
      if (stream.match(/\\[a-zA-Z@]+/)) return "keyword";
      if (stream.match(/[{}\[\]]/)) return "bracket";
      if (stream.match(/\d*\.?\d+/)) return "number";
      if (stream.match(/\$+/)) {
        stream.skipToEnd();
        return "string";
      }
      stream.next();
      return null;
    },
  });

  const hlStyle = HighlightStyle.define([
    { tag: tags.keyword, color: "var(--color-purple)" },
    { tag: tags.comment, color: "var(--text-faint)", fontStyle: "italic" },
    { tag: tags.number, color: "var(--color-orange)" },
    { tag: tags.string, color: "var(--color-green)" },
    { tag: tags.bracket, color: "var(--text-muted)" },
  ]);

  onMount(() => {
    lastGenerated = generateTikZ($graph);
    view = new EditorView({
      parent: cmHost,
      state: EditorState.create({
        doc: lastGenerated,
        extensions: [
          lineNumbers(),
          history(),
          keymap.of([
            { key: "Mod-e", run: () => {
              startEdit();
              return true;
            } },
            { key: "Mod-s", run: () => {
              runCode();
              return true;
            } },
            { key: "Mod-z", run: () => { undo(view); return true; } },
            { key: "Mod-y", run: () => { redo(view); return true; } },
            { key: "Mod-Shift-z", run: () => { redo(view); return true; } },
            ...defaultKeymap,
            ...historyKeymap,
            ...searchKeymap,
          ]),
          search({ top: true }),
          tikzLang,
          syntaxHighlighting(hlStyle, { fallback: true }),
          editableCompartment.of(EditorState.readOnly.of(true)),
          EditorView.theme({
            "&": { height: "100%", fontSize: "12px", backgroundColor: "transparent" },
            ".cm-content": { fontFamily: "var(--font-monospace)" },
          }),
        ],
      }),
    });

    // model -> doc sync (paused while editing so user edits are never clobbered)
    unsub = graph.subscribe((g) => {
      if (editing) return;
      const code = generateTikZ(g);
      lastGenerated = code;
      if (view && view.state.doc.toString() !== code) {
        syncing = true;
        // clamp the current anchor into the new doc instead of forcing 0:
        // a stale selection can crash CodeMirror's internal line iterator,
        // but snapping to 0 jumped the viewport to the top on every sync
        const anchor = Math.min(view.state.selection.main.anchor, code.length);
        view.dispatch({
          changes: { from: 0, to: view.state.doc.length, insert: code },
          selection: { anchor },
        });
        syncing = false;
      }
    });
  });

  onDestroy(() => {
    unsub?.();
    view?.destroy();
    view = null;
  });

  function setEditing(v: boolean) {
    editing = v;
    view?.dispatch({ effects: editableCompartment.reconfigure(EditorState.readOnly.of(!v)) });
  }

  function startEdit() {
    setEditing(true);
    statusMessage.set("Editing code - Ctrl+S / Run to apply and render");
    setTimeout(() => view?.focus(), 0);
  }

  function runCode() {
    if (!view) return;
    const code = view.state.doc.toString();
    lastGenerated = code;
    try {
      const parsed = parseTikZ(code, get(graph));
      // go through the controller so undo history is rebased onto the new
      // model — previously graph.set() bypassed history and Ctrl+Z would
      // silently discard the applied code
      editor.replaceGraph(parsed);
      setEditing(false);
      statusMessage.set("Code applied - preview re-rendered");
    } catch (e) {
      renderError.set("Parse error: " + String(e));
    }
  }
</script>

<div class="te-code">
  <div class="te-code-toolbar">
    <span class="te-code-state {editing ? 'te-state-editing' : ''}">{editing ? "EDITING" : "VIEW"}</span>
    <button
      class="te-code-btn"
      disabled={editing}
      title="Start editing (no rendering while editing) - 开始编辑, 编辑期间不渲染"
      on:click={startEdit}
    >Edit (Ctrl+E)</button>
    <button
      class="te-code-btn te-code-run"
      disabled={!editing}
      title="Apply code and re-render - 应用代码并渲染"
      on:click={runCode}
    >Run (Ctrl+S)</button>
  </div>
  {#if err}
    <div class="te-code-error" title="Rendering error - 渲染错误">
      ⚠ {err}
    </div>
  {/if}
  <div class="te-code-editor" bind:this={cmHost}></div>
</div>

<style>
  .te-code {
    display: flex;
    flex-direction: column;
    flex: 1;
    min-height: 0;
    gap: 8px;
  }
  .te-code-toolbar {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .te-code-state {
    font-family: var(--font-monospace);
    font-size: 11px;
    font-weight: bold;
    color: var(--text-muted);
    letter-spacing: 1px;
  }
  .te-code-state.te-state-editing {
    color: var(--text-accent);
  }
  .te-code-btn {
    background: var(--background-secondary-alt);
    border: 1px solid var(--background-modifier-border);
    color: var(--text-normal);
    padding: 3px 10px;
    font-size: 12px;
    border-radius: 4px;
    cursor: pointer;
    font-family: var(--font-monospace);
  }
  .te-code-btn:hover:not(:disabled) {
    background: var(--background-modifier-hover);
  }
  .te-code-btn:disabled {
    opacity: 0.45;
    cursor: default;
  }
  .te-code-run {
    background: var(--interactive-accent);
    color: var(--text-on-accent);
    border-color: transparent;
  }
  .te-code-error {
    background: var(--background-modifier-error);
    color: var(--text-error);
    border: 1px solid var(--color-red);
    border-radius: 6px;
    padding: 8px 10px;
    font-size: 12px;
    font-family: var(--font-monospace);
    white-space: pre-wrap;
    word-break: break-word;
  }
  .te-code-editor {
    flex: 1;
    min-height: 0;
    overflow: hidden;
    border: 1px solid var(--background-modifier-border);
    border-radius: 6px;
  }
  .te-code-editor :global(.cm-editor) {
    height: 100%;
  }
</style>
