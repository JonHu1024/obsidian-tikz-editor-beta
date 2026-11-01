// Keybinding registry: every keyboard command the editor understands is
// registered here with a stable id, a human-readable label, a group and a
// DEFAULT key. The user can rebind any of them in the plugin settings
// (TikZEditorSettings.keybinds). The defaults match the editor's original
// (muscle-memory) keymap and follow a vim *philosophy*: modal, mnemonic,
// minimal — not necessarily vim's exact letters.

export type KeybindGroup = "normal" | "cd" | "cdarrow" | "tool" | "system";

export interface KeybindDef {
  id: string;
  group: KeybindGroup;
  label: string;
  /** hint shown next to the input in settings */
  desc?: string;
  /** default key. Multi-char strings are command sequences ("redo", "op"). */
  def: string;
}

export const KEYBINDS: KeybindDef[] = [
  // ---- NORMAL mode ----
  { id: "normal.undo", group: "normal", label: "Undo 撤销", def: "u" },
  { id: "normal.redo", group: "normal", label: "Redo 重做", def: "redo" },
  { id: "normal.edit", group: "normal", label: "Edit selected 编辑选中对象", def: "i" },
  { id: "normal.delete", group: "normal", label: "Delete selected 删除选中对象", def: "d" },
  { id: "normal.color", group: "normal", label: "Color picker 颜色选择", def: "c" },
  { id: "normal.createText", group: "normal", label: "Create text box 创建文本框", def: "t" },
  { id: "normal.createTextInsert", group: "normal", label: "Create text + insert 创建文本并编辑", def: "T" },
  { id: "normal.createShape", group: "normal", label: "Create shape 创建形状", def: "s" },
  { id: "normal.createShapeInsert", group: "normal", label: "Create shape + insert 创建形状并编辑", def: "S" },
  { id: "normal.createArrow", group: "normal", label: "Create arrow 创建箭头", def: "a" },
  { id: "normal.createArrowInsert", group: "normal", label: "Create arrow + insert 创建箭头并编辑", def: "A" },
  { id: "normal.createFunction", group: "normal", label: "Add function 添加函数", def: "f" },
  { id: "normal.toggleEnv", group: "normal", label: "Toggle env (empty canvas) 切换环境", def: "env" },
  { id: "normal.insertNote", group: "normal", label: "Insert into note 插入到笔记", def: "ok" },
  { id: "normal.help", group: "normal", label: "Keyboard shortcuts 快捷键帮助", def: "?" },
  { id: "normal.zoomToFit", group: "normal", label: "Fit drawing in view 缩放至适应", def: "zz" },
  // ---- cd grid (reference tikzcd editor, no selection) ----
  { id: "cd.editCell", group: "cd", label: "Edit / create cell text 编辑或创建格文本", def: "Enter" },
  { id: "cd.arrowFlow", group: "cd", label: "Create arrow: start/place flow 箭头起点/落点键", desc: "Press once on the source cell, then a direction key (arrows/numpad digits) creates and selects the arrow in one step.", def: "a" },
  { id: "cd.arrowTarget", group: "cd", label: "Create arrow to a target cell 箭头到目标格", desc: "Press on the source cell; arrow keys move the target cell, Enter (or x again) confirms the arrow.", def: "x" },
  { id: "cd.clearCell", group: "cd", label: "Clear cell content 清空格子内容", def: "dd" },
  { id: "cd.redo", group: "cd", label: "Redo (cd) 重做", def: "r" },
  { id: "cd.copyCode", group: "cd", label: "Copy code 复制代码", def: "cp" },
  // ---- cd arrow editing (reference tikzcd editor, arrow selected) ----
  { id: "cdarrow.reverse", group: "cdarrow", label: "Reverse arrow 反向箭头", def: "op" },
  { id: "cdarrow.cycleTail", group: "cdarrow", label: "Cycle tail: tail / maps to / hook 尾部循环", def: "t" },
  { id: "cdarrow.cycleHead", group: "cdarrow", label: "Cycle head: default / harpoon / two heads 头部循环", def: "h" },
  { id: "cdarrow.lineDashed", group: "cdarrow", label: "Line: dashed 虚线", def: "ds" },
  { id: "cdarrow.lineDotted", group: "cdarrow", label: "Line: dotted 点线", def: "dt" },
  { id: "cdarrow.lineSolid", group: "cdarrow", label: "Line: solid 实线", def: "sd" },
  { id: "cdarrow.lineDouble", group: "cdarrow", label: "Line: double 双线", def: "db" },
  { id: "cdarrow.linePhantom", group: "cdarrow", label: "Line: phantom 隐形", def: "p" },
  { id: "cdarrow.shiftLeft", group: "cdarrow", label: "Shift left 左移", def: "ArrowUp" },
  { id: "cdarrow.shiftRight", group: "cdarrow", label: "Shift right 右移", def: "ArrowDown" },
  { id: "cdarrow.bendLeft", group: "cdarrow", label: "Bend left 向左弯", def: "Shift+ArrowUp" },
  { id: "cdarrow.bendRight", group: "cdarrow", label: "Bend right 向右弯", def: "Shift+ArrowDown" },
  { id: "cdarrow.delete", group: "cdarrow", label: "Delete arrow 删除箭头", def: "dd" },
  { id: "cdarrow.rebindEnd", group: "cdarrow", label: "Move arrow end 移动箭头终点", desc: "Arrow keys move the end cell, Enter commits, Escape cancels.", def: "e" },
  { id: "cdarrow.loopRotate", group: "cdarrow", label: "Rotate loop 旋转自环", def: "e" },
  { id: "cdarrow.editLabel", group: "cdarrow", label: "Edit arrow label 编辑箭头标签", def: "Enter" },
  // ---- the plugin's own NORMAL-mode arrow-key commands (these are the
  //      keys actually consumed at runtime when editing arrows on the
  //      tikzpicture canvas; the reference tikzcd editor above uses the
  //      same op / a / b / e letters as documented). ----
  { id: "cdarrow.swap", group: "cdarrow", label: "Swap arrow endpoints 交换箭头发尾", def: "op" },
  { id: "cdarrow.tipPicker", group: "cdarrow", label: "Open head/tail picker 打开头尾选择器", def: "a" },
  { id: "cdarrow.rebindStart", group: "cdarrow", label: "Rebind arrow start 重定起点", def: "b" },
  // picture-mode arrow editing keys queried by VimController — they were
  // documented in the README but missing from this registry, which made the
  // features unreachable AND unbindable; defaults follow the README
  { id: "cdarrow.labelPos", group: "cdarrow", label: "(legacy) Cycle label position 标签位置循环", def: "l" },
  { id: "cdarrow.labelLong", group: "cdarrow", label: "(legacy) Cycle label length position 标签纵向位置", desc: "(legacy)", def: "L" },
  { id: "cdarrow.resetBend", group: "cdarrow", label: "(legacy) Reset bend/shift 重置弯曲与偏移", def: "0" },
  { id: "cdarrow.loop", group: "cdarrow", label: "(legacy) Toggle self-loop 自环开关", def: "O" },
  { id: "cdarrow.loopFlip", group: "cdarrow", label: "(legacy) Flip loop direction 自环换向", def: "E" },
  // ---- mouse tools (tikzcd grid canvas) ----
  { id: "tool.pan", group: "tool", label: "Temporary Pan tool 临时平移工具", desc: "Hold while dragging the canvas.", def: "Space" },
  { id: "tool.arrow", group: "tool", label: "Temporary Arrow tool 临时箭头工具", desc: "Hold and drag from one cell to another to create an arrow.", def: "Shift" },
  { id: "system.focusNodes", group: "system", label: "Search nodes 搜索节点", def: "mod+f" },
];

export const DEFAULT_KEYS: Record<string, string> = Object.fromEntries(
  KEYBINDS.map((k) => [k.id, k.def])
);

export function keybindById(id: string): KeybindDef | undefined {
  return KEYBINDS.find((k) => k.id === id);
}

const NAMED_KEYS = new Set([
  "Enter", "Tab", "Backspace", "Space", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight",
]);

/**
 * Does this KeyboardEvent trigger any of the aliases named in `binding`?
 * `binding` is a comma-separated list of keys (aliases), each either a single
 * character ("t"), a named key ("Enter", "ArrowUp", "Space"), a "mod+X"
 * shortcut, or a multi-character sequence ("redo", "op", "ok", "env") which
 * is only ever matched by the command buffer, not here.
 */
export function keyMatches(binding: string, e: KeyboardEvent): boolean {
  const alias = binding.split(",").map((s) => s.trim()).filter(Boolean);
  for (const a of alias) {
    const lc = a.toLowerCase();
    if (lc.startsWith("mod+")) {
      const rest = a.slice(4);
      if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === rest.toLowerCase()) return true;
      continue;
    }
    if (a.length === 1 || NAMED_KEYS.has(a)) {
      if (e.key === a) return true;
      continue;
    }
    // multi-character sequence is handled by the command buffer
  }
  return false;
}

/** True when `binding` contains a plain single-letter alias. The command
 *  buffer matches sequences by prefix; single characters fire immediately. */
export function charKey(binding: string): string | null {
  const alias = binding.split(",").map((s) => s.trim()).filter(Boolean);
  for (const a of alias) {
    if (a.length === 1) return a;
  }
  return null;
}
