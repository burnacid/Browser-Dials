/**
 * generate-icons.js — run once with Node to produce placeholder PNG icons.
 * Usage: node generate-icons.js
 * Requires: npm install canvas  (only needed to run this script once)
 */

'use strict';

const { createCanvas } = require('canvas');
const fs               = require('fs');
const path             = require('path');

const SIZES  = [16, 32, 48, 128];
const OUTDIR = path.join(__dirname, 'extension', 'icons');

fs.mkdirSync(OUTDIR, { recursive: true });

for (const size of SIZES) {
  const canvas   = createCanvas(size, size);
  const ctx      = canvas.getContext('2d');
  const pad      = Math.round(size * 0.1);
  const radius   = Math.round(size * 0.2);

  // Background gradient
  const grad = ctx.createLinearGradient(0, 0, size, size);
  grad.addColorStop(0, '#2563eb');
  grad.addColorStop(1, '#7c3aed');

  // Rounded rect
  ctx.beginPath();
  ctx.moveTo(pad + radius, pad);
  ctx.lineTo(size - pad - radius, pad);
  ctx.quadraticCurveTo(size - pad, pad, size - pad, pad + radius);
  ctx.lineTo(size - pad, size - pad - radius);
  ctx.quadraticCurveTo(size - pad, size - pad, size - pad - radius, size - pad);
  ctx.lineTo(pad + radius, size - pad);
  ctx.quadraticCurveTo(pad, size - pad, pad, size - pad - radius);
  ctx.lineTo(pad, pad + radius);
  ctx.quadraticCurveTo(pad, pad, pad + radius, pad);
  ctx.closePath();
  ctx.fillStyle = grad;
  ctx.fill();

  // Grid dots (2x2)
  const dotR   = Math.max(1, Math.round(size * 0.1));
  const offset = Math.round(size * 0.28);
  const center = Math.round(size / 2);
  const dots   = [
    [center - offset, center - offset],
    [center + offset, center - offset],
    [center - offset, center + offset],
    [center + offset, center + offset],
  ];
  ctx.fillStyle = 'rgba(255,255,255,0.9)';
  for (const [x, y] of dots) {
    ctx.beginPath();
    ctx.arc(x, y, dotR, 0, Math.PI * 2);
    ctx.fill();
  }

  const out = path.join(OUTDIR, `icon${size}.png`);
  fs.writeFileSync(out, canvas.toBuffer('image/png'));
  console.log(`Written ${out}`);
}
