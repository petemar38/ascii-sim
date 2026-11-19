'use strict';
/**
 * HUD text. Pure data in, strings out, so the terminal player and the web page share it
 * and a minimap or color pass can extend it without touching the renderer.
 */

const { locate } = require('./world');

const POINTS = ['NORTH', 'NORTH-EAST', 'EAST', 'SOUTH-EAST', 'SOUTH', 'SOUTH-WEST', 'WEST', 'NORTH-WEST'];

/** Camera angle (0 = east, clockwise) -> compass bearing in degrees (0 = north, clockwise). */
function bearingDeg(angle) {
  const deg = ((angle * 180) / Math.PI + 90) % 360;
  return deg < 0 ? deg + 360 : deg;
}

function compassPoint(deg) {
  return POINTS[Math.round(deg / 45) % 8];
}

function pad(label, width = 11) {
  return (label + '.'.repeat(width)).slice(0, width);
}

function clock(time) {
  const h = Math.floor(time) % 24;
  const m = Math.floor((time - Math.floor(time)) * 60);
  return String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0');
}

/** @returns {string[]} HUD lines for the current position. */
function buildHud(world, cam, time) {
  const here = locate(world, cam.x, cam.y);
  const deg = bearingDeg(cam.angle);
  return [
    pad('DISTRICT') + ' ' + here.district.toUpperCase(),
    pad('STREET') + ' ' + here.street.toUpperCase(),
    pad('CROSS') + ' ' + here.cross.toUpperCase(),
    pad('BEARING') + ' ' + Math.round(deg) + ' DEG / ' + compassPoint(deg),
    pad('POSITION') + ' ' + cam.x.toFixed(1) + ', ' + cam.y.toFixed(1),
    pad('TIME') + ' ' + clock(time),
  ];
}

module.exports = { buildHud, bearingDeg, compassPoint, clock };
