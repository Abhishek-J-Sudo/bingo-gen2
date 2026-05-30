// Usage: node scripts/slice-spritesheet.js <character>
// Example: node scripts/slice-spritesheet.js ninja
//
// Expects: assets/characters/<character>/<character>-spritesheet.png
// Layout:  left 1/4 = full body | right 3/4 = 3×2 grid of parts

const sharp = require('sharp');
const path = require('path');
const fs = require('fs');

const character = process.argv[2];
if (!character) {
  console.error('Usage: node scripts/slice-spritesheet.js <character>');
  process.exit(1);
}

const dir = path.join(__dirname, '..', 'assets', 'characters', character);
const input = path.join(dir, `${character}-spritesheet.png`);

if (!fs.existsSync(input)) {
  console.error(`Not found: ${input}`);
  process.exit(1);
}

async function slice() {
  const meta = await sharp(input).metadata();
  const W = meta.width;
  const H = meta.height;

  const colW = Math.floor(W / 4);
  const rowH = Math.floor(H / 2);
  const colWLast = W - colW * 3;  // absorbs any leftover pixels
  const rowHLast = H - rowH;

  const parts = [
    { name: 'full',  left: 0,        top: 0,    width: colW,     height: H        },
    { name: 'head',  left: colW,     top: 0,    width: colW,     height: rowH     },
    { name: 'torso', left: colW * 2, top: 0,    width: colW,     height: rowH     },
    { name: 'arm-l', left: colW * 3, top: 0,    width: colWLast, height: rowH     },
    { name: 'arm-r', left: colW,     top: rowH, width: colW,     height: rowHLast },
    { name: 'leg-l', left: colW * 2, top: rowH, width: colW,     height: rowHLast },
    { name: 'leg-r', left: colW * 3, top: rowH, width: colWLast, height: rowHLast },
  ];

  console.log(`Image: ${W}×${H}px  |  col: ${colW}px  row: ${rowH}px`);

  for (const part of parts) {
    const out = path.join(dir, `${character}-${part.name}.png`);
    await sharp(input)
      .extract({ left: part.left, top: part.top, width: part.width, height: part.height })
      .png()
      .toFile(out);
    console.log(`  ✓ ${character}-${part.name}.png`);
  }

  console.log('\nDone. Drop the PNGs through remove.bg if they have white backgrounds.');
}

slice().catch(err => { console.error(err); process.exit(1); });
