import { build } from 'esbuild';
import { readFile, writeFile } from 'node:fs/promises';

const result = await build({entryPoints: ['src/main.js'], bundle: true, format: 'iife',
  platform: 'browser', target: ['chrome100', 'edge100', 'safari16'], write: false,
  minify: true, legalComments: 'none', charset: 'utf8'});
const template = await readFile('src/template.html', 'utf8');
const css = await readFile('src/styles.css', 'utf8');
const js = result.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');
const html = template.replace('/* APP_STYLES */', css).replace('/* APP_SCRIPT */', js);
await writeFile('index.html', html);
await writeFile('王陆语料库听写练习_v5.html', html);
console.log(`Built two identical standalone pages (${Math.round(Buffer.byteLength(html) / 1024)} KB each).`);
