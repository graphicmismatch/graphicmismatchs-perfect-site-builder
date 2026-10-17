// Small inline SVG icon set shared by the Inspector and Project panels.
const svg = body => `<svg class="ic" viewBox="0 0 16 16" fill="none" stroke-width="1.2" stroke-linejoin="round" stroke-linecap="round">${body}</svg>`;

const I = {
  folder: '<path d="M1.5 3.5h4.5l1.5 1.5h7v8h-13z" fill="#c9a44c" stroke="#8c6d28"/><path d="M1.5 6.5h13" stroke="#e3c06a"/>',
  image: '<rect x="1.5" y="2.5" width="13" height="11" rx="1" fill="#3d6e8f" stroke="#8fc3e6"/><circle cx="5.5" cy="6" r="1.4" fill="#ffe28a"/><path d="M2 12.5l4-4 3 3 2-2 3.5 3.5" stroke="#bfe6a0"/>',
  video: '<rect x="1.5" y="3" width="13" height="10" rx="1" fill="#5a3d7a" stroke="#c39ae8"/><path d="M6.5 5.8v4.4l3.8-2.2z" fill="#f0e0ff" stroke="none"/>',
  audio: '<path d="M6 11.5V3.5l7-1.5v8" stroke="#f0a35a"/><circle cx="4.3" cy="11.6" r="1.8" fill="#f0a35a" stroke="#f0a35a"/><circle cx="11.3" cy="10.1" r="1.8" fill="#f0a35a" stroke="#f0a35a"/>',
  json: '<path d="M5.5 2.5c-2 0-1.5 2-1.5 3.5S2.5 8 2.5 8s1.5 0 1.5 2-.5 3.5 1.5 3.5M10.5 2.5c2 0 1.5 2 1.5 3.5s1.5 2 1.5 2-1.5 0-1.5 2 .5 3.5-1.5 3.5" stroke="#e8c84a"/><circle cx="8" cy="8" r=".9" fill="#e8c84a" stroke="none"/>',
  font: '<path d="M3 13.5L7.2 2.5h1.6L13 13.5M5 9h6" stroke="#d8d8d8" stroke-width="1.5"/>',
  text: '<path d="M3.5 1.5h6l3 3v10h-9z" fill="#4a4a4a" stroke="#bdbdbd"/><path d="M5.5 7h5M5.5 9.5h5M5.5 12h3" stroke="#bdbdbd"/>',
  file: '<path d="M3.5 1.5h6l3 3v10h-9z" fill="#444" stroke="#999"/><path d="M9.5 1.5v3h3" stroke="#999"/>',
  extension: '<path d="M2.5 3.5h4v1.2a1.3 1.3 0 1 0 2.6 0V3.5h4.4v4.4h-1.2a1.3 1.3 0 1 0 0 2.6h1.2v4h-11z" fill="#6a4a8c" stroke="#d2b4f5"/>',
  component: '<path d="M2.5 5.5h3a1.5 1.5 0 1 1 3 0h3v3a1.5 1.5 0 1 1 0 3v3h-9z" fill="#2f7d6d" stroke="#7fe0c8"/>',
  behaviour: '<path d="M3.5 1.5h6l3 3v10h-9z" fill="#2c4f7c" stroke="#8ab4f0"/><path d="M6.8 7.5l-1.8 2 1.8 2M9.2 7.5l1.8 2-1.8 2" stroke="#e6f0ff"/>',
  anim: '<path d="M2 8l3-3 3 3-3 3z" fill="#9b8de8" stroke="#d6cfff"/><path d="M8.5 8l3-3 3 3-3 3z" fill="#5f52b0" stroke="#d6cfff"/>',
  node: '<path d="M8 1.8l5.5 3v6.4L8 14.2 2.5 11.2V4.8z" fill="#4c4c4c" stroke="#c8c8c8"/><path d="M2.5 4.8L8 8l5.5-3.2M8 8v6.2" stroke="#c8c8c8"/>',
  rect: '<rect x="3" y="3" width="10" height="10" stroke="#9ad" stroke-dasharray="2 1.5"/><path d="M1.5 1.5l3 3M14.5 1.5l-3 3M1.5 14.5l3-3M14.5 14.5l-3-3" stroke="#9ad"/>',
  canvas: '<rect x="1.5" y="2.5" width="13" height="11" rx="1" stroke="#c8c8c8"/><path d="M1.5 5h13" stroke="#c8c8c8"/>',
  textc: '<path d="M3 3.5h10M8 3.5v10" stroke="#d8d8d8" stroke-width="1.8"/>',
  button: '<rect x="1.5" y="4.5" width="13" height="7" rx="2" fill="#555" stroke="#ccc"/><path d="M5 8h6" stroke="#ccc"/>',
  link: '<path d="M7 9a2.5 2.5 0 0 0 3.5 0l2.5-2.5a2.5 2.5 0 0 0-3.5-3.5L8.5 4M9 7a2.5 2.5 0 0 0-3.5 0L3 9.5A2.5 2.5 0 0 0 6.5 13l1-1" stroke="#7ab0ff"/>',
  html: '<path d="M5 4L1.5 8 5 12M11 4l3.5 4-3.5 4M9.3 3L6.7 13" stroke="#f08a5a"/>',
  style: '<path d="M3 13c3 0 3-2 3-3l6.5-6.5-1.8-1.8L4 8.5c-1 0-1 2.5-1 4.5z" fill="#5a8fdc" stroke="#a9c8f5"/>',
  layout: '<rect x="1.5" y="2.5" width="13" height="11" stroke="#aaa"/><rect x="3.5" y="4.5" width="3" height="7" fill="#8ab" stroke="none"/><rect x="7.5" y="4.5" width="3" height="7" fill="#8ab" stroke="none"/><rect x="11.5" y="4.5" width="1.5" height="7" fill="#8ab" stroke="none"/>',
  effect: '<path d="M8 1.5l1.6 4.2 4.4.3-3.4 2.8 1.1 4.3L8 10.7l-3.7 2.4 1.1-4.3L2 6l4.4-.3z" fill="#d6b04a" stroke="#f3dc8e"/>',
  data: '<ellipse cx="8" cy="4" rx="5.5" ry="2" stroke="#7fd0e0"/><path d="M2.5 4v8c0 1.1 2.5 2 5.5 2s5.5-.9 5.5-2V4M2.5 8c0 1.1 2.5 2 5.5 2s5.5-.9 5.5-2" stroke="#7fd0e0"/>',
  dots: '<circle cx="8" cy="3.5" r="1.2" fill="currentColor" stroke="none"/><circle cx="8" cy="8" r="1.2" fill="currentColor" stroke="none"/><circle cx="8" cy="12.5" r="1.2" fill="currentColor" stroke="none"/>',
  target: '<circle cx="8" cy="8" r="5.5" stroke="currentColor"/><circle cx="8" cy="8" r="2" fill="currentColor" stroke="none"/>',
  warn: '<path d="M8 1.8l6.5 12H1.5z" fill="#d8a02c" stroke="#d8a02c"/><path d="M8 6v4M8 11.8v.4" stroke="#222" stroke-width="1.6"/>',
};

export const icon = name => svg(I[name] ?? I.file);

const BY_TYPE = {
  Canvas: 'canvas', CanvasScaler: 'canvas', Image: 'image', Text: 'textc', Button: 'button', Link: 'link', Video: 'video',
  Audio: 'audio', HTML: 'html', Style: 'style', Animator: 'anim', Repeat: 'data',
};
const BY_CAT = { Layout: 'layout', Effects: 'effect', Media: 'video', Web: 'html', Data: 'data', Animation: 'anim', Extensions: 'extension' };
export function compIcon(type, def) {
  if (type.startsWith('component:')) return icon('component');
  if (type.startsWith('behaviour:')) return icon('behaviour');
  return icon(BY_TYPE[type] ?? BY_CAT[def?.category] ?? 'node');
}
