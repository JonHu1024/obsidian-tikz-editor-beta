import { App, Notice, PluginSettingTab, Setting } from "obsidian";
import type { App as AppType } from "obsidian";
import type TikZEditorPlugin from "./main";
import { KEYBINDS, DEFAULT_KEYS, keybindById } from "./vim/keybindings";

export interface TikZEditorSettings {
  defaultEnv: "picture" | "cd";
  defaultWidth: number;
  defaultHeight: number;
  defaultZoom: number;
  defaultTextWidth: number;
  defaultTextFormula: string;
  defaultShapeSize: number;
  defaultArrowLength: number;
  focusLeft: string;
  focusRight: string;
  undoKey: string;
  redoKey: string;
  /** Per-command keybindings. Ids are defined in src/vim/keybindings.ts.
   *  Missing ids fall back to DEFAULT_KEYS. */
  keybinds: Record<string, string>;
}

export const DEFAULT_SETTINGS: TikZEditorSettings = {
  defaultEnv: "picture",
  defaultWidth: 10,
  defaultHeight: 8,
  defaultZoom: 1.5,
  defaultTextWidth: 3,
  defaultTextFormula: "$$",
  defaultShapeSize: 1,
  defaultArrowLength: 3,
  focusLeft: "mod+h",
  focusRight: "mod+l",
  undoKey: "mod+z",
  redoKey: "mod+y",
  keybinds: { ...DEFAULT_KEYS },
};

/** Aliases currently bound to more than one command (exact match after
 *  normalisation). Rendered as a warning line so "why doesn't my key work"
 *  has an answer inside the settings pane itself. */
function findKeyConflicts(keybinds: Record<string, string>): string[] {
  const owner = new Map<string, string[]>();
  for (const kb of KEYBINDS) {
    const eff = (keybinds[kb.id] ?? kb.def).trim();
    if (!eff) continue;
    for (const raw of eff.split(",")) {
      const alias = raw.trim().toLowerCase();
      if (!alias) continue;
      const arr = owner.get(alias) ?? [];
      if (!arr.includes(kb.label)) arr.push(kb.label);
      owner.set(alias, arr);
    }
  }
  return [...owner.entries()]
    .filter(([, labels]) => labels.length > 1)
    .map(([alias, labels]) => `"${alias}" → ${labels.join(" / ")}`);
}

export class TikZEditorSettingTab extends PluginSettingTab {
  constructor(
    app: AppType,
    private plugin: TikZEditorPlugin
  ) {
    super(app, plugin);
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl("h2", { text: "TikZ Editor Settings" });

    new Setting(containerEl)
      .setName("Default environment 默认环境")
      .setDesc("Environment used for new code blocks: tikzpicture (full features) or tikzcd (text + arrows only). 新建代码块的默认环境. 在空白画布时可用 env 指令切换.")
      .addDropdown((d) =>
        d
          .addOption("picture", "tikzpicture")
          .addOption("cd", "tikzcd")
          .setValue(this.plugin.settings.defaultEnv)
          .onChange(async (v) => {
            this.plugin.settings.defaultEnv = v as "picture" | "cd";
            await this.plugin.saveSettings();
          })
      );

    containerEl.createEl("h3", { text: "Editor" });

    new Setting(containerEl)
      .setName("Default graph width (cm)")
      .setDesc("Width used when creating a new TikZ code block.")
      .addText((t) =>
        t
          .setValue(String(this.plugin.settings.defaultWidth))
          .onChange(async (v) => {
            const n = parseFloat(v);
            if (!isNaN(n) && n > 0) {
              this.plugin.settings.defaultWidth = n;
              await this.plugin.saveSettings();
            }
          })
      );

    new Setting(containerEl)
      .setName("Default graph height (cm)")
      .setDesc("Height used when creating a new TikZ code block.")
      .addText((t) =>
        t
          .setValue(String(this.plugin.settings.defaultHeight))
          .onChange(async (v) => {
            const n = parseFloat(v);
            if (!isNaN(n) && n > 0) {
              this.plugin.settings.defaultHeight = n;
              await this.plugin.saveSettings();
            }
          })
      );

    new Setting(containerEl)
      .setName("Preview zoom")
      .setDesc("Initial zoom factor of the preview canvas.")
      .addSlider((s) =>
        s
          .setLimits(0.3, 8, 0.1)
          .setValue(this.plugin.settings.defaultZoom)
          .setDynamicTooltip()
          .onChange(async (v) => {
            this.plugin.settings.defaultZoom = v;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Default text box width (cm)")
      .setDesc("Width used when creating a text box. 新建文本框的默认宽度")
      .addText((t) =>
        t
          .setValue(String(this.plugin.settings.defaultTextWidth))
          .onChange(async (v) => {
            const n = parseFloat(v);
            if (!isNaN(n) && n > 0) {
              this.plugin.settings.defaultTextWidth = n;
              await this.plugin.saveSettings();
            }
          })
      );

    new Setting(containerEl)
      .setName("Default text box formula 文本框默认公式")
      .setDesc("Content auto-filled into every new text box; the cursor is placed inside the $...$ pair when editing. 新建文本框自动填入的内容, 编辑时光标自动位于 $...$ 内部")
      .addText((t) =>
        t
          .setValue(this.plugin.settings.defaultTextFormula)
          .onChange(async (v) => {
            this.plugin.settings.defaultTextFormula = v;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Default shape size (cm)")
      .setDesc("Size scale for newly created shapes (rectangle/circle/diamond/ellipse). 新建形状的默认大小")
      .addText((t) =>
        t
          .setValue(String(this.plugin.settings.defaultShapeSize))
          .onChange(async (v) => {
            const n = parseFloat(v);
            if (!isNaN(n) && n > 0) {
              this.plugin.settings.defaultShapeSize = n;
              await this.plugin.saveSettings();
            }
          })
      );

    new Setting(containerEl)
      .setName("Default arrow length (cm)")
      .setDesc("Length of newly created arrows. 新建箭头的默认长度")
      .addText((t) =>
        t
          .setValue(String(this.plugin.settings.defaultArrowLength))
          .onChange(async (v) => {
            const n = parseFloat(v);
            if (!isNaN(n) && n > 0) {
              this.plugin.settings.defaultArrowLength = n;
              await this.plugin.saveSettings();
            }
          })
      );

    containerEl.createEl("h3", { text: "In-editor keybindings" });
    containerEl.createEl("p", {
      text: "The Alt+D command can be rebound in Settings → Hotkeys. In-editor shortcuts below are set in this plugin's settings. Modifiers: mod = Ctrl (or Cmd on macOS).",
    });

    new Setting(containerEl)
      .setName("Focus left panel (canvas)")
      .setDesc("Move keyboard focus to the canvas (the left column) and back to Vim mode. 切换到左侧画布.")
      .addText((t) =>
        t
          .setValue(this.plugin.settings.focusLeft)
          .onChange(async (v) => {
            this.plugin.settings.focusLeft = v.trim() || "mod+h";
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Focus right panel (properties)")
      .setDesc("Move keyboard focus to the properties panel (the right column). 切换到右侧属性面板.")
      .addText((t) =>
        t
          .setValue(this.plugin.settings.focusRight)
          .onChange(async (v) => {
            this.plugin.settings.focusRight = v.trim() || "mod+l";
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Undo shortcut")
      .setDesc("Ctrl-style shortcut used INSIDE the editor (picture canvas and tikzcd panel). Aliases separated by commas; default mod+z.")
      .addText((t) =>
        t
          .setValue(this.plugin.settings.undoKey)
          .onChange(async (v) => {
            this.plugin.settings.undoKey = v.trim() || "mod+z";
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Redo shortcut")
      .setDesc("Ctrl-style shortcut used INSIDE the editor. Ctrl+Shift+Z always works as an extra redo alias; default mod+y.")
      .addText((t) =>
        t
          .setValue(this.plugin.settings.redoKey)
          .onChange(async (v) => {
            this.plugin.settings.redoKey = v.trim() || "mod+y";
            await this.plugin.saveSettings();
          })
      );

    containerEl.createEl("h3", { text: "Keybindings 键位设置" });
    containerEl.createEl("p", {
      text: "All in-editor vim keys are configurable here. 所有编辑器键位均可在此调整. A key may be a single character (t), a named key (Enter, ArrowUp, Space), a sequence typed in NORMAL mode (redo, op, ok, env), or mod+N for system-style shortcuts. Multi-key commands are matched as prefixes, so single letters take effect immediately.",
    });

    // conflict overview (exact-alias duplicates make commands unreachable)
    const conflicts = findKeyConflicts(this.plugin.settings.keybinds);
    if (conflicts.length > 0) {
      containerEl.createEl("p", {
        text: "⚠ 键位冲突（后注册者遮蔽前者，请修改其一）: " + conflicts.join("; "),
        cls: "mod-warning",
      });
    }

    const groups: { id: string; title: string }[] = [
      { id: "normal", title: "NORMAL MODE 普通模式" },
      { id: "cd", title: "tikzcd grid 格子导航" },
      { id: "cdarrow", title: "tikzcd ARROW EDITING 箭头编辑" },
      { id: "tool", title: "Mouse tools 鼠标工具" },
      { id: "system", title: "System 系统" },
    ];
    void keybindById;
    for (const grp of groups) {
      // group heading carries its own per-group reset
      new Setting(containerEl)
        .setName(grp.title)
        .setHeading()
        .addButton((b) =>
          b
            .setButtonText("Reset")
            .setTooltip("Restore this group to its defaults 恢复本组默认键位")
            .onClick(async () => {
              for (const k of KEYBINDS.filter((x) => x.group === grp.id)) {
                this.plugin.settings.keybinds[k.id] = k.def;
              }
              await this.plugin.saveSettings();
              this.display();
            })
        );
      for (const kb of KEYBINDS.filter((k) => k.group === grp.id)) {
        new Setting(containerEl)
          .setName(kb.label)
          .setDesc(kb.desc ?? `Default: ${kb.def}`)
          .addText((t) =>
            t
              .setValue(this.plugin.settings.keybinds[kb.id] ?? kb.def)
              .onChange(async (v) => {
                const val = v.trim();
                if (val) {
                  this.plugin.settings.keybinds[kb.id] = val;
                } else {
                  delete this.plugin.settings.keybinds[kb.id];
                }
                await this.plugin.saveSettings();
              })
          );
      }
    }

    new Setting(containerEl)
      .setName("Reset keybindings to defaults")
      .setDesc("Restore all keybindings to the built-in defaults.")
      .addButton((b) =>
        b.setButtonText("Reset").onClick(async () => {
          this.plugin.settings.keybinds = { ...DEFAULT_KEYS };
          await this.plugin.saveSettings();
          this.display();
        })
      );
  }

}
