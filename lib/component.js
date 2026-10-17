// stub — owned by a subagent, see CONTRACT.md
export class Component extends HTMLElement {}
export function define(tag, spec, Cls = Component) { if (!customElements.get(tag)) customElements.define(tag, Cls); }
