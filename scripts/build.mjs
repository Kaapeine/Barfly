import fs from 'fs';
import { execSync } from 'child_process';

const optionsHtmlPath = 'src/options/options.html';

// Strip the dev-only block (test tools + state inspector) so release builds
// don't ship debug UI. Markers live in the HTML itself; see options.html.
const original = fs.readFileSync(optionsHtmlPath, 'utf8');
const stripped = original.replace(
  /<!-- DEV-ONLY:START[\s\S]*?DEV-ONLY:END -->\n\n/,
  '',
);
if (stripped === original) {
  throw new Error(`DEV-ONLY markers not found in ${optionsHtmlPath} — refusing to build`);
}
fs.writeFileSync(optionsHtmlPath, stripped);

try {
  execSync(
    'web-ext build --overwrite-dest --ignore-files=scripts/** tests/** docs/** node_modules/** web-ext-artifacts/** .git/** .gitignore package-lock.json package.json vitest.config.js',
    { stdio: 'inherit' },
  );
} finally {
  // Always restore the dev version, even if the build fails.
  fs.writeFileSync(optionsHtmlPath, original);
}

console.log('✅ Build complete — options.html restored to dev mode');
