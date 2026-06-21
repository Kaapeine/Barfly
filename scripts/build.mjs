import fs from 'fs';
import { execSync } from 'child_process';

const manifestPath = 'manifest.json';

// Read manifest
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

// Switch to release options page
manifest.options_ui.page = 'src/options/options.html';
fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');

// Build with web-ext
execSync(
  'web-ext build --overwrite-dest --ignore-files=scripts/** tests/** docs/** node_modules/** web-ext-artifacts/** .git/** .gitignore package-lock.json package.json vitest.config.js',
  { stdio: 'inherit' },
);

// Restore to dev options page
manifest.options_ui.page = 'src/options/options.html';
fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');

console.log('✅ Build complete — manifest restored to dev mode');