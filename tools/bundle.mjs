// Builds the single-file version of the sky (everything inlined) for Streamlit.
//   node tools/bundle.mjs   ->  sky.html (used by app.py) and static/sky.html (full-screen copy, served by Streamlit)
import { build } from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
const root = path.resolve(import.meta.dirname, '..');
const F = (p) => path.join(root, 'frontend', p);
const js = (await build({ entryPoints: [F('main.js')], bundle: true, minify: true, format: 'iife', target: 'es2020', write: false })).outputFiles[0].text;
const css = (await build({ entryPoints: [F('css/style.css')], bundle: true, minify: true, write: false, loader: { '.css': 'css' } })).outputFiles[0].text;
const data = {};
for (const n of ['config.json', 'data/stars.json', 'data/constellations.json', 'data/starnames.json', 'data/planets.json']) data[n] = JSON.parse(fs.readFileSync(F(n), 'utf8'));
const safe = (s) => s.replace(/<\/(script|style)/gi, '<\\/$1').replace(/<!--/g, '<\\!--');
let html = fs.readFileSync(F('index.html'), 'utf8');
html = html.replace('<link rel="stylesheet" href="css/style.css">', () => `<style>${safe(css)}</style>`);
html = html.replace('<script type="module" src="main.js"></script>', () =>
  `<script>window.__SKY_FS_PATH__='/app/static/sky.html';window.__SKY_DATA__=${safe(JSON.stringify(data))};</script>\n<script>${safe(js)}</script>`);
fs.mkdirSync(path.join(root, 'static'), { recursive: true });
fs.writeFileSync(path.join(root, 'sky.html'), html);
fs.writeFileSync(path.join(root, 'static/sky.html'), html);
console.log('sky.html', (html.length / 1024).toFixed(0), 'KB');
