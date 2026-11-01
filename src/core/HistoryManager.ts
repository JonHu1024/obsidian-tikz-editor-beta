import { cloneGraph } from "./types";
import type { TikZGraph } from "./types";

export class HistoryManager {
  private states: string[] = [];
  private index = -1;
  private maxSize = 100;

  constructor(initial: TikZGraph) {
    this.states.push(JSON.stringify(initial));
    this.index = 0;
  }

  push(state: TikZGraph): void {
    const snapshot = JSON.stringify(state);
    if (this.states[this.index] === snapshot) return;
    this.states = this.states.slice(0, this.index + 1);
    this.states.push(snapshot);
    if (this.states.length > this.maxSize) {
      this.states.shift();
    }
    this.index = this.states.length - 1;
  }

  canUndo(): boolean {
    return this.index > 0;
  }

  canRedo(): boolean {
    return this.index < this.states.length - 1;
  }

  undo(): TikZGraph | null {
    if (!this.canUndo()) return null;
    this.index--;
    return JSON.parse(this.states[this.index]) as TikZGraph;
  }

  redo(): TikZGraph | null {
    if (!this.canRedo()) return null;
    this.index++;
    return JSON.parse(this.states[this.index]) as TikZGraph;
  }

  cloneCurrent(): TikZGraph {
    return cloneGraph(JSON.parse(this.states[this.index]) as TikZGraph);
  }
}
