import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');
const SOURCE_WS_DIR = path.join(ROOT_DIR, '.github', 'skills', 'github-workspace');
const PUBLIC_WS_DIR = path.join(__dirname, 'public', 'skills', 'github-workspace');

function syncSkillFiles() {
  if (!fs.existsSync(SOURCE_WS_DIR)) return;
  if (!fs.existsSync(PUBLIC_WS_DIR)) {
    fs.mkdirSync(PUBLIC_WS_DIR, { recursive: true });
  }
  const files: string[] = [];
  const copyRecursive = (src: string, dest: string, rel = '') => {
    if (!fs.existsSync(dest)) fs.mkdirSync(dest, { recursive: true });
    const entries = fs.readdirSync(src, { withFileTypes: true });
    for (const entry of entries) {
      const srcPath = path.join(src, entry.name);
      const destPath = path.join(dest, entry.name);
      const relPath = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        copyRecursive(srcPath, destPath, relPath);
      } else if (entry.name !== 'manifest.json') {
        fs.copyFileSync(srcPath, destPath);
        files.push(relPath);
      }
    }
  };
  copyRecursive(SOURCE_WS_DIR, PUBLIC_WS_DIR);
  fs.writeFileSync(path.join(PUBLIC_WS_DIR, 'manifest.json'), JSON.stringify(files, null, 2), 'utf8');
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    {
      name: 'sync-skill-plugin',
      buildStart() {
        syncSkillFiles();
      },
      configureServer() {
        syncSkillFiles();
      }
    }
  ],
  server: {
    port: 3000
  }
});
