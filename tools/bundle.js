#!/usr/bin/env node
'use strict';
/**
 * Builds dist/index.html: web/template.html with every src module inlined behind a tiny
 * require() shim, so the page works from a single file with no server and no dependencies.
 */

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const order = ['rng', 'names', 'veg', 'birds', 'animals', 'world', 'facade', 'camera', 'render', 'color', 'hud', 'travel', 'minimap', 'index'];

let bundle =
  'var __defs = {}, __cache = {};\n' +
  'function __require(p) {\n' +
  '  var k = p.replace(/^\\.\\//, "").replace(/\\.js$/, "");\n' +
  '  if (__cache[k]) return __cache[k].exports;\n' +
  '  var m = { exports: {} }; __cache[k] = m;\n' +
  '  __defs[k](m, m.exports, __require);\n' +
  '  return m.exports;\n' +
  '}\n';

for (const name of order) {
  const src = fs.readFileSync(path.join(root, 'src', name + '.js'), 'utf8');
  if (/<\/script/i.test(src)) throw new Error(name + '.js contains a closing script tag');
  bundle += '__defs[' + JSON.stringify(name) + '] = function (module, exports, require) {\n' + src + '\n};\n';
}

const template = fs.readFileSync(path.join(root, 'web', 'template.html'), 'utf8');
if (!template.includes('/*BUNDLE*/')) throw new Error('template is missing the /*BUNDLE*/ marker');

fs.mkdirSync(path.join(root, 'dist'), { recursive: true });
const out = path.join(root, 'dist', 'index.html');
fs.writeFileSync(out, template.replace('/*BUNDLE*/', () => bundle));
console.log('wrote ' + path.relative(root, out) + ' (' + fs.statSync(out).size + ' bytes)');
