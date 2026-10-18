// Multiple languages. project.json `languages: [{ code: 'en', name: 'English' }, { code: 'fr', name: 'Français' }]`,
// the first is the default (the site root); every other one is built under /<code>/.
// Per language:
//   - node overrides under the key `lang:<code>` (the same mechanism as breakpoint overrides; the editor's language
//     selector records them): translated text, alt text, links, even a different layout;
//   - JSON data: assets/<name>.<code>.json, when it exists, replaces assets/<name>.json (translated collections);
//   - strings: assets/locales/<code>.json, used with {{t:key.path}} bindings (falling back to the default language's).
export const langKey = code => `lang:${code}`;
export const isLangKey = k => typeof k === 'string' && k.startsWith('lang:');

// [{ code, name }] (empty: a one-language site)
export function languagesOf(project) {
  const l = Array.isArray(project?.languages) ? project.languages : [];
  return l.filter(x => x && /^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$/.test(x.code)).map(x => ({ code: x.code, name: x.name || x.code }));
}
export const defaultLanguage = project => languagesOf(project)[0]?.code ?? null;

// assets/<name>.<code>.json -> the JSON asset it translates (<name>.json), or null
export const translationOf = (file, codes) => {
  const m = /^(.*)\.([a-z]{2,3}(?:-[A-Za-z0-9]{2,8})*)\.json$/.exec(file);
  return m && codes.includes(m[2]) ? `${m[1]}.json` : null;
};
export const translationFile = (file, code) => file.replace(/\.json$/, `.${code}.json`);

const merge = (a, b) => {
  if (!b || typeof b !== 'object' || Array.isArray(b) || !a || typeof a !== 'object' || Array.isArray(a)) return b ?? a;
  const o = { ...a };
  for (const [k, v] of Object.entries(b)) o[k] = merge(a[k], v);
  return o;
};

// render options for one language: { lang, langKey (null for the default), json, strings, languages }
export function languageOptions(project, json, code) {
  const langs = languagesOf(project), def = langs[0]?.code;
  if (!langs.length) return {};
  code ??= def;
  const codes = langs.map(l => l.code), j = {};
  for (const [f, v] of Object.entries(json ?? {})) if (!translationOf(f, codes)) j[f] = code !== def && json[translationFile(f, code)] !== undefined ? json[translationFile(f, code)] : v;
  return {
    lang: code, langKey: code === def ? null : langKey(code), json: j, languages: langs,
    strings: merge(json?.[`locales/${def}.json`] ?? {}, code === def ? {} : json?.[`locales/${code}.json`] ?? {}),
  };
}
