// node test/markdown.test.js
import assert from 'node:assert/strict';
import { markdown } from '../lib/markdown.js';

const md = (s, o) => markdown(s, { href: h => (h === 'about' ? 'about.html' : h), asset: p => 'assets/' + p, ...o });
assert.equal(md('# Hello *World*'), '<h1 id="hello-world">Hello <em>World</em></h1>');
assert.equal(md('## Title ##'), '<h2 id="title">Title</h2>');
assert.equal(md('a\nb'), '<p>a\nb</p>');
assert.equal(md('a  \nb'), '<p>a<br>\nb</p>');
assert.equal(md('**b** _i_ ~~s~~ `x<y` snake_case_word'), '<p><strong>b</strong> <em>i</em> <del>s</del> <code>x&lt;y</code> snake_case_word</p>');
assert.equal(md('[About](about) [x](https://x.test "T") <https://a.test>'), '<p><a href="about.html">About</a> <a href="https://x.test" title="T">x</a> <a href="https://a.test">https://a.test</a></p>');
assert.equal(md('![A cat](img/cat.png) ![w](https://w.test/a.png)'), '<p><img src="assets/img/cat.png" alt="A cat"> <img src="https://w.test/a.png" alt="w"></p>');
assert.match(md('[bad](javascript:alert(1))'), /^<p><a href="#">bad<\/a>/); // script URLs are neutralised
assert.equal(md('<b>raw</b> & more'), '<p>&lt;b&gt;raw&lt;/b&gt; &amp; more</p>');   // escaped by default
assert.equal(md('<b>raw</b>', { html: true }), '<p><b>raw</b></p>');
assert.equal(md('```js\nif (a < b) {}\n```'), '<pre><code class="language-js">if (a &lt; b) {}</code></pre>');
assert.equal(md('> quote\n> more'), '<blockquote>\n<p>quote\nmore</p>\n</blockquote>');
assert.equal(md('---'), '<hr>');
assert.equal(md('- a\n- b\n  - c\n- d'), '<ul>\n<li>a</li>\n<li>b\n<ul>\n<li>c</li>\n</ul></li>\n<li>d</li>\n</ul>');
assert.equal(md('3. x\n4. y'), '<ol start="3">\n<li>x</li>\n<li>y</li>\n</ol>');
assert.equal(md('- a\n\n- b'), '<ul>\n<li><p>a</p></li>\n<li><p>b</p></li>\n</ul>');
assert.equal(md('| A | B |\n|:--|--:|\n| 1 | 2 |'), '<table>\n<thead><tr><th style="text-align:left">A</th><th style="text-align:right">B</th></tr></thead>\n<tbody>\n<tr><td style="text-align:left">1</td><td style="text-align:right">2</td></tr>\n</tbody>\n</table>');
assert.equal(md('para\n# head'), '<p>para</p>\n<h1 id="head">head</h1>');
assert.equal(md('\\*not em\\*'), '<p>*not em*</p>');
console.log('markdown ok');
