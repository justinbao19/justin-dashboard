const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

function fail(msg) {
  console.error(`ERROR: ${msg}`);
  process.exit(1);
}

const root = process.cwd();
const vercelPath = path.join(root, 'vercel.json');
if (!fs.existsSync(vercelPath)) fail('vercel.json missing');

let vercel;
try {
  vercel = JSON.parse(fs.readFileSync(vercelPath, 'utf8'));
} catch (e) {
  fail(`vercel.json invalid JSON: ${e.message}`);
}

if (Object.prototype.hasOwnProperty.call(vercel, 'public')) {
  fail('vercel.json must not contain deprecated `public` field');
}

const trackedForbidden = ['.vercel/README.txt', '.vercel/project.json'];
const tracked = execSync('git ls-files', { encoding: 'utf8' }).split('\n').filter(Boolean);
for (const item of trackedForbidden) {
  if (tracked.includes(item)) fail(`forbidden tracked file: ${item}`);
}

const docsPath = path.join(root, 'docs', 'FREE-API-SOURCES.md');
if (fs.existsSync(docsPath)) {
  const docs = fs.readFileSync(docsPath, 'utf8');
  if (/Finnhub:\s*[A-Za-z0-9]{20,}/.test(docs)) {
    fail('docs/FREE-API-SOURCES.md appears to contain a live Finnhub key');
  }
}

console.log('guard ok');
