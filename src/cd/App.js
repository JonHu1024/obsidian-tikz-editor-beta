import { h, render, Component } from "preact";
import { icon } from "./icons";
import * as diagram from "./diagram";
import { arrAdd, arrEquals, CMD_TIMEOUT } from "./helper";

import { EditorView, lineNumbers, keymap } from "@codemirror/view";
import { EditorState } from "@codemirror/state";
import { StreamLanguage, syntaxHighlighting, HighlightStyle } from "@codemirror/language";
import { tags } from "@lezer/highlight";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";

import Grid from "./Grid";
import Properties from "./Properties";
import Toolbox, { Button, Separator } from "./Toolbox";

/** Lightweight TeX highlighting for the code panel (CodeMirror stream mode):
 *  comments, \commands, \\ escapes, braces, numbers and quoted labels. */
const tikzCodeLang = StreamLanguage.define({
  token(stream) {
    if (stream.match(/%.*/)) {
      stream.skipToEnd();
      return "comment";
    }
    if (stream.match(/\\[a-zA-Z@]+/)) return "keyword";
    if (stream.match(/\\\\/)) return "escape";
    if (stream.match(/\\/)) return "escape";
    if (stream.match(/[{}\[\]]/)) return "bracket";
    if (stream.match(/\d*\.?\d+/)) return "number";
    if (stream.match(/"[^"]*"/)) return "string";
    if (stream.match(/\$\$?/)) {
      stream.skipToEnd();
      return "string";
    }
    stream.next();
    return null;
  },
});

const tikzCodeStyle = HighlightStyle.define([
  { tag: tags.keyword, color: "#0550ae" },
  { tag: tags.comment, color: "#8b949e", fontStyle: "italic" },
  { tag: tags.number, color: "#953800" },
  { tag: tags.string, color: "#116329" },
  { tag: tags.escape, color: "#953800" },
  { tag: tags.bracket, color: "#57606a" },
]);

/**
 * Port of yishn/tikzcd-editor's App (MIT), adapted for this plugin:
 *  - no URL permalink (no location.hash) — Copy Code copies the TeX instead
 *  - diagram state bridges to the plugin graph via diagram.ts
 *  - persistent right-side code panel (60/40 split) replaces the modal
 *  - persistent right-side code panel (60/40 split) replaces the modal
 *  - extra keyboard: no hjkl cursor (arrow keys move the cell), a creates an
 *    arrow in one step, x picks an arrow target with arrow keys then Enter,
 *    dd clears the cell text, ok inserts+exits, cp copies the code,
 *    u/Ctrl+Z undo, r/Ctrl+Y redo (remappable via props.keys).
 *  - selected-arrow keys live in Properties (op, t/h/l cycles, dd delete,
 *    e rebind end, dt/ds/sd/db lines, arrows shift/bend, Enter edits label).
 */
export default class CdApp extends Component {
  constructor(props) {
    super(props);

    // cd metadata (multi-diagram ranges, preamble, raws) must ride along when
    // the diagram is converted to TeX — CdPanel supplies a toTeX closure over
    // the plugin graph; the plain module fallback keeps the component usable
    // without it.
    this._toTeX = props.toTeX || ((d) => diagram.toTeX(d));

    this.state = {
      tool: "pan",
      cellSize: 130,
      diagram: props.initialDiagram || { nodes: [], edges: [] },

      cameraPosition: [-65, -65],
      selectedCell: [0, 0],
      selectedArrow: null,
      cellEditMode: false,

      codeValue: this._toTeX(props.initialDiagram || { nodes: [], edges: [] }),
    };

    this.history = [{ diagram: this.state.diagram, time: Date.now() }];
    this.historyPointer = 0;
  }

  componentDidMount() {
    const keys = this.props.keys || {};

    this.codeView = new EditorView({
      parent: this.codeHost,
      state: EditorState.create({
        doc: this.state.codeValue,
        extensions: [
          lineNumbers(),
          history(),
          keymap.of([...defaultKeymap, ...historyKeymap]),
          tikzCodeLang,
          syntaxHighlighting(tikzCodeStyle, { fallback: true }),
          EditorView.updateListener.of((u) => {
            if (u.docChanged) {
              this.setState({ codeValue: u.state.doc.toString() });
            }
          }),
          EditorView.theme({
            "&": { height: "100%", fontSize: "13px", backgroundColor: "#ffffff", color: "#1a1a1a" },
            ".cm-content": { fontFamily: 'Consolas, "Courier New", monospace', caretColor: "#1a1a1a" },
            ".cm-gutters": { backgroundColor: "#f2f2f2", color: "#6e7681", borderRight: "1px solid #e2e2e2" },
            ".cm-activeLineGutter": { backgroundColor: "#e8e8e8" },
            ".cm-selectionBackground, .cm-content ::selection": { backgroundColor: "rgba(179, 215, 255, .55)" },
          }),
        ],
      }),
    });
    // test hook: let the harness drive the editor
    if (this.codeHost) this.codeHost.__cmView = this.codeView;

    const kb = (name, fallback) => {
      const k = keys[name];
      return Array.isArray(k) ? k : k != null ? [k] : fallback;
    };

    const match = (evt, list) => {
      return list.some((k) => {
        const m = /^(mod\+)?(.+)$/.exec(k || "");
        if (!m) return evt.key === k;
        const mod = !!m[1];
        return (mod ? evt.ctrlKey || evt.metaKey : !evt.ctrlKey && !evt.metaKey) && evt.key.toLowerCase() === m[2].toLowerCase();
      });
    };

    let arrowFlow = false; // keyboard arrow creation from selectedCell
    let arrowFlowFrom = null; // source cell fixed when flow starts

    // multi-key command buffer: "ok" insert & exit, "cp" copy code, "dd" clear cell
    this._cmdSeq = "";
    this._cmdTime = 0;

    // x-flow: the selected cell is the arrow's source; arrow keys move the
    // target cell; Enter / x again confirms the arrow.
    this._xFrom = null;

    // rebind-end: moving the selected arrow's endpoint to another cell
    this._rebindIdx = null;

    const dirs = {
      ArrowLeft: [-1, 0],
      ArrowRight: [1, 0],
      ArrowUp: [0, -1],
      ArrowDown: [0, 1],
      "1": [-1, 1],
      "2": [0, 1],
      "3": [1, 1],
      "4": [-1, 0],
      "6": [1, 0],
      "7": [-1, -1],
      "8": [0, -1],
      "9": [1, -1],
    };

    this._onKeyDown = (evt) => {
      // Typing in the code panel (CodeMirror) or any textarea never hijacks keys.
      if (evt.target != null) {
        const t = evt.target;
        if (t.tagName === "TEXTAREA" || (t.closest && t.closest(".cm-editor")) != null) return;
      }

      // tools held with Shift / Space
      if (evt.key === "Shift") {
        if (this.prevTool == null) {
          this.prevTool = this.state.tool;
          this.setState({ tool: "arrow" });
        }
        return;
      }
      if (evt.key === " ") {
        if (this.prevTool == null) {
          this.prevTool = this.state.tool;
          this.setState({ tool: "pan" });
        }
        return;
      }

      // While the cell editor owns the input, only Escape/Alt leave it here;
      // every other key goes to the text input untouched.
      if (this.state.cellEditMode) {
        if (evt.key === "Escape" || evt.key === "Alt") {
          evt.preventDefault();
          this.setState({ cellEditMode: false });
        }
        return;
      }

      // Alt / Escape back out of whatever overlay is open (mirrors the
      // plugin's NORMAL-mode Alt semantics).
      if (evt.key === "Alt") {
        evt.preventDefault();
        arrowFlow = false;
        this._xFrom = null;
        this._cmdSeq = "";
        this.reportBuffer("");
        if (this._rebindIdx != null) this.cancelRebind();
        this.exitOverlays();
        return;
      }

      // ---- rebind-end mode (e on a selected arrow): arrow keys move the
      //      target cell, Enter fixes the endpoint, Escape cancels.
      if (this._rebindIdx != null) {
        const rd = dirs[evt.key];
        if (rd && !(evt.ctrlKey || evt.metaKey) && !evt.shiftKey) {
          evt.preventDefault();
          this.setState({ selectedCell: arrAdd(this.state.selectedCell, rd) });
        } else if (evt.key === "Enter") {
          evt.preventDefault();
          this.applyRebindEnd();
        } else if (evt.key === "Escape") {
          evt.preventDefault();
          this.cancelRebind();
        }
        return;
      }

      // ---- x-flow: arrow keys move the target cell; Enter / x confirm.
      if (this._xFrom != null) {
        const xd = dirs[evt.key];
        if (xd) {
          evt.preventDefault();
          this.setState({ selectedCell: arrAdd(this.state.selectedCell, xd) });
          return;
        }
        if (evt.key === "Enter" || evt.key === "x" || evt.key === "X") {
          evt.preventDefault();
          const from = this._xFrom;
          this._xFrom = null;
          this.placeKeyboardArrow(this.state.selectedCell, from);
          return;
        }
        if (evt.key === "Escape") {
          evt.preventDefault();
          this._xFrom = null;
          return;
        }
        // any other key cancels the flow
        this._xFrom = null;
      }

      // keyboard arrow flow: a arms the flow, the NEXT direction key
      // (arrows/numpad digits) creates the arrow and selects it —
      // exactly like [tikzpicture]'s a+ArrowUp.
      if (arrowFlow) {
        const d = dirs[evt.key];
        if (d) {
          evt.preventDefault();
          arrowFlow = false;
          this.placeKeyboardArrow(arrAdd(arrowFlowFrom, d), arrowFlowFrom);
          return;
        }
        if (evt.key === "Escape") {
          arrowFlow = false;
          return;
        }
        // any other key while flowing: cancel the flow (must toggle the flag
        // off, otherwise the editor stays wedged swallowing every key)
        arrowFlow = false;
        return;
      }

      // arrow-key / numpad cell cursor (hjkl movement is removed)
      const d = dirs[evt.key];
      if (d && !(evt.ctrlKey || evt.metaKey) && !evt.shiftKey) {
        if (this.state.selectedArrow != null) return;
        evt.preventDefault();
        this.setState({ selectedCell: arrAdd(this.state.selectedCell, d) });
        return;
      }

      // start keyboard arrow flow from the selected cell
      if (match(evt, kb("arrowFlow", ["a"]))) {
        if (this.state.selectedArrow != null || this.state.cellEditMode) return;
        evt.preventDefault();
        arrowFlowFrom = this.state.selectedCell;
        arrowFlow = true;
        this.setState({ selectedArrow: null });
        return;
      }

      // multi-key command buffer: ok / cp / dd
      if (!evt.ctrlKey && !evt.metaKey && !evt.altKey && /^[a-zA-Z]$/.test(evt.key)) {
        const now = Date.now();
        if (this._cmdTime == null || now - this._cmdTime > CMD_TIMEOUT) this._cmdSeq = "";
        const seq = (this._cmdSeq + evt.key).toLowerCase();
        const CMDS = {
          ok: () => {
            if (this.props.onInsert) this.props.onInsert(this.state.diagram);
          },
          cp: () => this.copyCode(),
          dd: () => {
            // With no arrow selected dd clears the current cell — but right
            // after deleting an arrow (dd / Delete on a selected arrow) a
            // stray extra "d" of the same reflex must never wipe the cell
            // under the cursor, so clear-cell is blocked briefly after any
            // arrow removal.
            if (
              this.state.selectedArrow == null &&
              Date.now() - (this._arrowDeletedAt || 0) > 400
            ) {
              this.clearCell();
            }
          },
          env: () => {
            // Switch back to the picture editor (same as the code panel's
            // Back button). Guarded so it cannot fire while an arrow is
            // selected (e starts rebind via Properties) or mid-rebind.
            if (
              this.state.selectedArrow == null &&
              this._rebindIdx == null &&
              this.props.onExit
            ) {
              this.props.onExit();
            }
          },
        };
        const isExact = CMDS[seq] != null;
        const isPrefix = Object.keys(CMDS).some((k) => k.length > seq.length && k.startsWith(seq));
        if (isExact && !isPrefix) {
          this._cmdSeq = "";
          this._cmdTime = 0;
          evt.preventDefault();
          this.reportBuffer("");
          CMDS[seq]();
          return;
        }
        if (isPrefix) {
          this._cmdSeq = seq;
          this._cmdTime = now;
          evt.preventDefault();
          this.reportBuffer(seq);
          return;
        }
        this._cmdSeq = "";
        this._cmdTime = 0;
        this.reportBuffer("");
      }

      // undo / redo
      if (match(evt, kb("undo", ["u", "mod+z"]))) {
        evt.preventDefault();
        this.undo();
        return;
      }
      if (match(evt, kb("redo", ["r", "mod+y"]))) {
        evt.preventDefault();
        this.redo();
        return;
      }

      // x: fix the current cell as the arrow's source and pick a target cell
      if (evt.key === "x" || evt.key === "X") {
        if (this.state.selectedArrow != null || this.state.cellEditMode) return;
        evt.preventDefault();
        this._xFrom = this.state.selectedCell;
        return;
      }

      // Tab: cycle the arrows starting at the selected cell; with no arrow
      // from that cell it falls back to cycling the cells themselves.
      if (evt.key === "Tab") {
        evt.preventDefault();
        evt.stopPropagation();
        this.cycleTab(evt.shiftKey ? -1 : 1);
        return;
      }

      // i: edit the selected cell's text (like NORMAL-mode i)
      if (evt.key === "i" || evt.key === "I") {
        evt.preventDefault();
        this.setState({ selectedArrow: null, cellEditMode: true });
        return;
      }

      if (evt.key === "Enter") {
        if (this.state.cellEditMode || this.state.selectedArrow != null) return;
        evt.preventDefault();
        this.setState({ cellEditMode: true });
      }
    };

    this._onKeyUp = (evt) => {
      if (evt.key === "Shift" || evt.key === " ") {
        if (this.prevTool == null) return;
        this.setState({ tool: this.prevTool });
        this.prevTool = null;
      } else if (evt.key === "Escape") {
        // Escape also cancels any pending multi-key sequence (dd/op/cp/ok)
        // so a stray key afterwards cannot complete an unintended command.
        this._cmdSeq = "";
        this._cmdTime = 0;
        this.reportBuffer("");
        this.exitOverlays();
      }
    };

    document.addEventListener("keydown", this._onKeyDown);
    window.addEventListener("blur", this._releaseTool);
    document.addEventListener("visibilitychange", this._releaseTool);
    document.addEventListener("keyup", this._onKeyUp);
  }

  componentWillUnmount() {
    if (this.codeView != null) {
      this.codeView.destroy();
      this.codeView = null;
    }
    if (this.codeHost != null) {
      this.codeHost.__cmView = null;
    }
    document.removeEventListener("keydown", this._onKeyDown);
    document.removeEventListener("keyup", this._onKeyUp);
    window.removeEventListener("blur", this._releaseTool);
    document.removeEventListener("visibilitychange", this._releaseTool);
  }

  /** Give the temporary Shift/Space tool back.
   *  The tool is restored on keyup — but a keyup can be lost (window
   *  blur, alt-tab, the editor closing), which left the canvas stuck in
   *  arrow/pan mode. */
  _releaseTool = () => {
    if (this.prevTool == null) return;
    this.setState({ tool: this.prevTool });
    this.prevTool = null;
  };

  /** The grid cell the given edge points to (`to` node position), if any. */
  arrowTargetCell(idx) {
    if (idx == null) return null;
    const edge = this.state.diagram.edges[idx];
    if (edge == null) return null;
    const target = this.state.diagram.nodes.find((n) => n.id === edge.to);
    return target != null ? [...target.position] : null;
  }

  exitOverlays() {
    this.setState((state) => {
      if (state.selectedArrow != null) {
        // Exiting arrow-selection mode (Escape/Alt/click-again): move the cell
        // cursor onto the cell the arrow points to, so the next edit lands on
        // the arrow's target cell.
        const edge = state.diagram.edges[state.selectedArrow];
        const target = edge == null ? null : state.diagram.nodes.find((n) => n.id === edge.to);
        return {
          selectedArrow: null,
          selectedCell: target != null ? [...target.position] : state.selectedCell,
        };
      }
      if (state.cellEditMode) return { cellEditMode: false };
      return null;
    });
  }

  /** Surface the in-progress command sequence (ok/cp/dd) for the status bar. */
  reportBuffer(seq) {
    if (this.props.onBufferChange) this.props.onBufferChange(seq || "");
  }

  cycleCell(diff) {
    const { nodes } = this.state.diagram;
    if (!nodes || nodes.length === 0) return;
    const sorted = nodes
      .map((n) => n.position)
      .slice()
      .sort((a, b) => a[1] - b[1] || a[0] - b[0]);
    let idx = sorted.findIndex((p) => arrEquals(p, this.state.selectedCell));
    if (idx < 0) idx = -1;
    const nextIdx = (((idx + diff) % sorted.length) + sorted.length) % sorted.length;
    this.setState({ selectedCell: sorted[nextIdx], selectedArrow: null });
  }

  deleteCell() {
    const pos = this.state.selectedCell;
    const node = this.state.diagram.nodes.find((n) => arrEquals(n.position, pos));
    if (!node) return;
    const newEdges = this.state.diagram.edges.filter((e) => e.from !== node.id && e.to !== node.id);
    const newNodes = this.state.diagram.nodes.filter((n) => n.id !== node.id);
    this.handleDataChange({ data: { nodes: newNodes, edges: newEdges }, selectedCell: pos });
  }

  cycleArrow(diff) {
    this.setState((state) => {
      if (state.selectedArrow == null) return;
      let { nodes, edges } = state.diagram;
      let length = edges.length;
      let findNodePositionById = (id) => nodes.find((node) => node.id === id).position;
      let indices = [...Array(length)]
        .map((_, i) => [i, [edges[i].from, edges[i].to].map(findNodePositionById).reduce((sum, x) => arrAdd(sum, x), [0, 0])])
        .sort(([_, arr1], [__, arr2]) => arr1[0] - arr2[0] || arr1[1] - arr2[1])
        .map(([i, _]) => i);
      let metaIndex = indices.indexOf(state.selectedArrow);
      return {
        selectedArrow: indices[(((metaIndex + diff) % length) + length) % length],
      };
    });
  }

  /** Tab cycles among the arrows that start at the current cell; if the cell
   *  has no outgoing arrows it falls back to cycling the cells themselves. */
  cycleTab(diff) {
    this.setState((state) => {
      const { nodes, edges } = state.diagram;
      let sourceId = null;
      if (state.selectedArrow != null && edges[state.selectedArrow] != null) {
        sourceId = edges[state.selectedArrow].from;
      } else {
        const cellNode = nodes.find((n) => arrEquals(n.position, state.selectedCell));
        if (cellNode) sourceId = cellNode.id;
      }
      let pool = sourceId == null ? [] : edges.map((e, i) => [i, e]).filter(([, e]) => e.from === sourceId).map(([i]) => i);
      if (pool.length > 0) {
        let pos = pool.indexOf(state.selectedArrow);
        if (pos < 0) pos = -1;
        return { selectedArrow: pool[(((pos + diff) % pool.length) + pool.length) % pool.length] };
      }
      const sorted = nodes
        .map((n) => n.position)
        .slice()
        .sort((a, b) => a[1] - b[1] || a[0] - b[0]);
      let idx = sorted.findIndex((p) => arrEquals(p, state.selectedCell));
      if (idx < 0) idx = -1;
      if (sorted.length === 0) return null;
      const nextIdx = (((idx + diff) % sorted.length) + sorted.length) % sorted.length;
      return { selectedCell: sorted[nextIdx], selectedArrow: null };
    });
  }

  /** dd with no arrow selected: clear the current cell's text. While an arrow
   *  is selected dd only ever removes the arrow (Properties handles that) and
   *  must never clear a cell's contents. */
  clearCell() {
    if (this.state.selectedArrow != null) return;
    const pos = this.state.selectedCell;
    const node = this.state.diagram.nodes.find((n) => arrEquals(n.position, pos));
    if (!node || !node.value) return;
    const nodes = this.state.diagram.nodes.map((n) => (n.id === node.id ? { ...n, value: "" } : n));
    this.handleDataChange({ data: { nodes, edges: this.state.diagram.edges }, selectedCell: pos });
  }

  /** cp: copy the generated tikz-cd code to the clipboard. */
  copyCode() {
    const text = this._toTeX(this.state.diagram);
    const done = () => {
      if (this.props.onNotice) this.props.onNotice("Code copied to clipboard", false);
    };
    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(text).then(done, done);
    } else {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      try {
        document.execCommand("copy");
      } catch (e) {
        /* ignore */
      }
      document.body.removeChild(ta);
      done();
    }
  }

  /** e on a selected arrow: drop the arrow's end and move it to another cell.
   *  The start cell stays fixed. Enter commits, Escape cancels. */
  startRebindEnd = () => {
    const idx = this.state.selectedArrow;
    if (idx == null) return;
    const edge = this.state.diagram.edges[idx];
    if (edge == null) return;
    const endNode = this.state.diagram.nodes.find((n) => n.id === edge.to);
    this._rebindIdx = idx;
    this._cmdSeq = "";
    this._cmdTime = 0;
    this.reportBuffer("");
    this.setState({ selectedArrow: null, selectedCell: endNode ? [...endNode.position] : [0, 0] });
  }

  cancelRebind() {
    const idx = this._rebindIdx;
    this._rebindIdx = null;
    this._cmdSeq = "";
    this._cmdTime = 0;
    this.reportBuffer("");
    if (idx != null) this.setState({ selectedArrow: idx });
  }

  applyRebindEnd() {
    if (this._rebindIdx == null) return;
    const idx = this._rebindIdx;
    this._rebindIdx = null;
    this._cmdSeq = "";
    this._cmdTime = 0;
    this.reportBuffer("");
    const { nodes, edges } = this.state.diagram;
    const edge = edges[idx];
    if (edge == null) return;
    const target = this.state.selectedCell;
    const nodes2 = nodes.map((n) => ({ ...n }));
    const edges2 = edges.map((e, i) => (i === idx ? { ...e } : e));
    let toNode = nodes2.find((n) => arrEquals(n.position, target));
    if (toNode == null) {
      toNode = { id: diagram.getId(), position: [...target], value: "" };
      nodes2.push(toNode);
    }
    edges2[idx] = { ...edges2[idx], to: toNode.id };
    const newNodes = nodes2.filter(
      (n) => n.value.trim() !== "" || edges2.some((e) => e.from === n.id || e.to === n.id)
    );
    this.handleDataChange({ data: { nodes: newNodes, edges: edges2 }, selectedCell: null });
    this.setState({ selectedArrow: idx });
  }

  placeKeyboardArrow(to, from = this.state.selectedCell) {
    if (to == null || (from[0] === to[0] && from[1] === to[1])) return;
    const { nodes, edges } = this.state.diagram;
    // Copy the node array before appending: history snapshots keep the
    // PREVIOUS diagram object, so mutating `nodes` in place would corrupt the
    // undo entry (the "before" snapshot would already contain the new node).
    const nodes2 = nodes.map((n) => ({ ...n }));
    let [fromNode, toNode] = [from, to].map((position) => nodes2.find((n) => n.position[0] === position[0] && n.position[1] === position[1]));
    if (fromNode == null) {
      fromNode = { id: diagram.getId(), position: [...from], value: "" };
      nodes2.push(fromNode);
    }
    if (toNode == null) {
      toNode = { id: diagram.getId(), position: [...to], value: "" };
      nodes2.push(toNode);
    }
    this.handleDataChange({
      data: { nodes: nodes2, edges: [...edges, { from: fromNode.id, to: toNode.id }] },
    });
  }

  handleDataChange = (evt) => {
    let edgeAdded = this.state.diagram.edges.length + 1 === evt.data.edges.length;
    let historyEntry = { diagram: evt.data, time: Date.now() };

    // The 500 ms window groups rapid successive edits. It must NEVER merge
    // into the very first entry: that entry is the "before" snapshot, and
    // overwriting it made undo a permanent no-op for the first edit (the
    // user could not get back to the state they started from).
    let canMerge =
      this.historyPointer > 0 &&
      this.historyPointer === this.history.length - 1 &&
      Date.now() - this.history[this.historyPointer].time <= 500;

    if (this.history[this.historyPointer].diagram !== evt.data) {
      if (canMerge) {
        // same edit group: replace the current entry
        this.history[this.historyPointer] = historyEntry;
      } else {
        this.history.splice(this.historyPointer + 1, this.history.length, historyEntry);
        this.historyPointer = this.history.length - 1;
      }
    }

    this.setState(
      (state) => ({
        diagram: evt.data,
        codeValue: this._toTeX(evt.data),
        selectedArrow: edgeAdded ? evt.data.edges.length - 1 : state.selectedArrow,
        ...(evt.selectedCell != null ? { selectedCell: evt.selectedCell, selectedArrow: null } : {}),
      }),
      () => {
        if (this.props.onDiagramChange) {
          const meta = this._parseMeta || null;
          this._parseMeta = null;
          this.props.onDiagramChange(this.state.diagram, meta);
        }
      }
    );
  };

  handleCellClick = (evt) => {
    this.setState({
      selectedCell: evt.position,
      selectedArrow: null,
      cellEditMode: true,
    });
  };

  handleCellSubmit = (evt) => {
    this.setState({ cellEditMode: false });
  };

  handleArrowClick = (evt) => {
    if (this.state.selectedArrow === evt.edge) {
      // Clicking the selected arrow again deselects it and puts the cell
      // cursor on the cell the arrow points to.
      const target = this.arrowTargetCell(evt.edge);
      this.setState({
        selectedArrow: null,
        ...(target != null ? { selectedCell: target } : {}),
      });
      return;
    }
    this.setState({ selectedArrow: evt.edge });
  };

  handleToolClick = (tool) => {
    if (this.toolClickHandlersCache == null) this.toolClickHandlersCache = {};
    if (this.toolClickHandlersCache[tool] == null) {
      this.toolClickHandlersCache[tool] = () => this.setState({ tool, selectedArrow: null });
    }
    return this.toolClickHandlersCache[tool];
  };

  componentDidUpdate() {
    // External code changes (grid edits) sync into the CodeMirror doc; while
    // the user types, the update listener already mirrors the doc into state.
    if (this.codeView != null && this.codeView.state.doc.toString() !== this.state.codeValue) {
      this.codeView.dispatch({
        changes: { from: 0, to: this.codeView.state.doc.length, insert: this.state.codeValue },
        selection: { anchor: 0 },
      });
    }
  }

  handleParseCode = () => {
    let newCode = this.state.codeValue;
    try {
      let data = diagram.fromTeX(newCode);
      // parsed cd metadata (multi-diagram ranges) is delivered to the plugin
      // graph with exactly this change; grid edits afterwards keep the
      // graph's existing metadata
      this._parseMeta = data.meta || null;
      this.resetCamera();
      this.handleDataChange({ data });
      if (this.props.onNotice) this.props.onNotice("Parse OK - canvas updated", false);
    } catch (err) {
      // Never mutate state on failure: the previous behaviour fell through
      // to an empty diagram and overwrote the user's code.
      if (this.props.onNotice) {
        this.props.onNotice(`Could not parse code: ${err.message}`, true);
      } else {
        alert(`Could not parse code.\n\nReason: ${err.message}`);
      }
    }
  };

  moveInHistory = (step) => {
    if (this.history[this.historyPointer + step] == null) return;
    this.historyPointer += step;
    const snap = this.history[this.historyPointer].diagram;
    this.setState({ diagram: snap, selectedArrow: null, codeValue: this._toTeX(snap) });
    if (this.props.onDiagramChange) this.props.onDiagramChange(snap, null);
  };

  undo = () => this.moveInHistory(-1);
  redo = () => this.moveInHistory(1);

  handleEdgeChange = (evt) => {
    // no arrow selected: the change has no target — writing it anyway
    // stored a bogus "null" property on the edges array
    if (this.state.selectedArrow == null) return;
    if (this.state.selectedArrow < 0) return;
    let newEdges = [...this.state.diagram.edges];
    newEdges[this.state.selectedArrow] = { ...newEdges[this.state.selectedArrow], ...evt.data };
    if (evt.data.value != null && evt.data.value.trim() === "") {
      delete newEdges[this.state.selectedArrow].value;
    }
    this.handleDataChange({ data: { nodes: this.state.diagram.nodes, edges: newEdges } });
  };

  handleEdgeRemoveClick = () => {
    let newEdges = this.state.diagram.edges.filter((_, i) => i !== this.state.selectedArrow);
    let newNodes = this.state.diagram.nodes.filter(
      (n) => n.value.trim() !== "" || newEdges.some((e) => e.from === n.id || e.to === n.id)
    );
    // Park the cell cursor on the deleted arrow's source cell so the next
    // cell-oriented action has a predictable target, and start the
    // clear-cell grace window so leftover "d" keys of the same dd reflex
    // cannot wipe that cell's content.
    let sourceCell = null;
    const removed = this.state.diagram.edges[this.state.selectedArrow];
    if (removed != null) {
      const fromNode = this.state.diagram.nodes.find((n) => n.id === removed.from);
      if (fromNode != null) sourceCell = [...fromNode.position];
    }
    this.handleDataChange({ data: { nodes: newNodes, edges: newEdges } });
    this._arrowDeletedAt = Date.now();
    this._cmdSeq = "";
    this._cmdTime = 0;
    this.reportBuffer("");
    this.setState({ selectedArrow: null, ...(sourceCell != null ? { selectedCell: sourceCell } : {}) });
  };

  resetCamera = () => {
    this.setState({
      cameraPosition: Array(2).fill(-Math.floor(this.state.cellSize / 2)),
      selectedCell: [0, 0],
      selectedArrow: null,
    });
  };

  render() {
    return (
      <div id="root" class="te-cd-root">
        <div class="te-cd-stage">
          <Grid
            cellSize={this.state.cellSize}
            cameraPosition={this.state.cameraPosition}
            data={this.state.diagram}
            mode={this.state.tool}
            selectedCell={this.state.selectedArrow == null ? this.state.selectedCell : null}
            selectedArrow={this.state.selectedArrow}
            cellEditMode={this.state.cellEditMode}
            onPan={(evt) => this.setState({ cameraPosition: evt.cameraPosition })}
            onDataChange={this.handleDataChange}
            onCellClick={this.handleCellClick}
            onCellSubmit={this.handleCellSubmit}
            onArrowClick={this.handleArrowClick}
          />

          <Properties
            edgeId={this.state.selectedArrow}
            show={this.state.selectedArrow != null}
            data={this.state.diagram.edges[this.state.selectedArrow]}
            onChange={this.handleEdgeChange}
            onRemoveClick={this.handleEdgeRemoveClick}
            onRebindEnd={this.startRebindEnd}
            onBufferChange={this.props.onBufferChange}
          />

          <Toolbox id="toolbox">
            <Button checked={this.state.tool === "pan"} icon={icon("tools/pan.svg")} name="Pan Tool (Space)" onClick={this.handleToolClick("pan")} />
            <Button checked={this.state.tool === "arrow"} icon={icon("tools/arrow.svg")} name="Arrow Tool (Shift)" onClick={this.handleToolClick("arrow")} />

            <Separator />

            <Button disabled={this.history[this.historyPointer - 1] == null} icon={icon("tools/undo.svg")} name="Undo (u)" onClick={this.undo} />
            <Button disabled={this.history[this.historyPointer + 1] == null} icon={icon("tools/redo.svg")} name="Redo (Ctrl+Y)" onClick={this.redo} />
          </Toolbox>
        </div>

        <div class="te-cd-code">
          <div class="te-cd-code-bar">
            <span class="te-cd-code-title">Code</span>
            {this.props.onInsert && (
              <button title="Insert into note" onClick={() => this.props.onInsert(this.state.diagram)}>
                Insert
              </button>
            )}
            {this.props.onExit && (
              <button title="Back to editor" onClick={this.props.onExit}>
                Back
              </button>
            )}
          </div>
          <div class="te-cd-code-edit">
            <div class="te-cd-code-editor" ref={(el) => (this.codeHost = el)}></div>
          </div>
          <div class="te-cd-code-foot">
            <button class="te-cd-parse" onClick={this.handleParseCode}>
              Parse
            </button>
          </div>
        </div>
      </div>
    );
  }
}
