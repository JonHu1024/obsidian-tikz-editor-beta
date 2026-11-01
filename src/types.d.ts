declare module "*.tikzjaxjs" {
  const content: string;
  export default content;
}

declare module "*.css" {
  const content: string;
  export default content;
}

declare module "*.svg" {
  const content: string;
  export default content;
}

declare module "classnames" {
  const cls: (...args: any[]) => string;
  export default cls;
}

declare module "preact" {
  export function h(type: any, props: any, ...children: any[]): any;
  export function render(vnode: any, parent: HTMLElement | Element, replaceNode?: Element | null): void;
  export class Component<P = {}, S = {}> {
    constructor(props: P);
    state: Readonly<S>;
    props: Readonly<P> & { children?: any };
    setState<K extends keyof S>(update: ((prev: S) => S) | Partial<S>, cb?: () => void): void;
    render(): any;
    base: any;
    componentDidMount?(): void;
    componentDidUpdate?(prev: Readonly<P>, prevState: Readonly<S>): void;
    componentWillUpdate?(next: Readonly<P>, nextState: Readonly<S>): void;
    componentWillMount?(): void;
    componentWillUnmount?(): void;
    shouldComponentUpdate?(next: Readonly<P>, nextState: Readonly<S>): boolean;
  }
  export function Fragment(props: any): any;
}
