import sharp from 'sharp';
import fs from 'fs';
import path from 'path';

const sizes = [16, 32, 48, 192, 512];
const publicDir = './public';

if (!fs.existsSync(publicDir)) {
  fs.mkdirSync(publicDir, { recursive: true });
}

async function createIcon(size, filename) {
  const svg = `
    <svg width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg">
      <rect width="${size}" height="${size}" fill="#16a34a" rx="${size * 0.2}"/>
      <text x="50%" y="55%" dominant-baseline="middle" text-anchor="middle"
            font-family="Arial" font-size="${size * 0.5}" fill="white" font-weight="bold">M</text>
    </svg>
  `;

  await sharp(Buffer.from(svg))
    .png()
    .toFile(path.join(publicDir, filename));

  console.log(`Created ${filename}`);
}

async function createIco() {
  const svg = `
    <svg width="256" height="256" xmlns="http://www.w3.org/2000/svg">
      <rect width="256" height="256" fill="#16a34a" rx="51"/>
      <text x="128" y="170" text-anchor="middle" font-family="Arial" font-size="128" fill="white" font-weight="bold">M</text>
    </svg>
  `;

  // Create PNG and save as ico (just use png)
  await sharp(Buffer.from(svg))
    .resize(32, 32)
    .png()
    .toFile(path.join(publicDir, 'favicon.ico'));

  console.log('Created favicon.ico');
}

async function main() {
  await createIcon(192, 'icon-192.png');
  await createIcon(512, 'icon-512.png');
  await createIco();
  console.log('All icons created!');
}

main();