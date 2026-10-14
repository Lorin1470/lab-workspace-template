#!/usr/bin/env node

/**
 * sync-skill.mjs
 * 單一來源同步工具：將根目錄的 Agent Skill 自動同步至 template 目錄
 * 確保母倉庫本身與衍生 Template 的 Skill 規範永遠保持一致，避免雙頭維護。
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');

const SOURCE_SKILLS_DIR = path.join(ROOT_DIR, '.github', 'skills');
const TARGET_SKILLS_DIR = path.join(ROOT_DIR, 'template', '.github', 'skills');
const WEB_SKILL_DIR = path.join(ROOT_DIR, 'web', 'public', 'skills', 'github-workspace');
const SOURCE_WS_DIR = path.join(SOURCE_SKILLS_DIR, 'github-workspace');

console.log('🔄 正在同步 Agent Skill 規範...');
console.log(`   來源 (Source):  ${SOURCE_SKILLS_DIR}`);
console.log(`   目標 (Target):  ${TARGET_SKILLS_DIR}`);
console.log(`   網站靜態來源:   ${WEB_SKILL_DIR}`);

if (!fs.existsSync(SOURCE_SKILLS_DIR)) {
  console.error('❌ 錯誤：來源 Skills 目錄不存在！');
  process.exit(1);
}

// 1. 同步至 template/ 目錄
copyRecursiveSync(SOURCE_SKILLS_DIR, TARGET_SKILLS_DIR);
console.log('✅ template/ 已更新為最新 Skill 規範。');

// 2. 同步 github-workspace 至 web/public/skills/github-workspace
if (fs.existsSync(SOURCE_WS_DIR)) {
  if (!fs.existsSync(WEB_SKILL_DIR)) {
    fs.mkdirSync(WEB_SKILL_DIR, { recursive: true });
  }
  const files = [];
  copyRecursiveWithManifest(SOURCE_WS_DIR, WEB_SKILL_DIR, '', files);
  fs.writeFileSync(
    path.join(WEB_SKILL_DIR, 'manifest.json'),
    JSON.stringify(files, null, 2),
    'utf8'
  );
  console.log(`✅ web/public/skills/github-workspace 已同步完成 (含 ${files.length} 個檔案與 manifest.json)。\n`);
}

function copyRecursiveSync(src, dest) {
  if (!fs.existsSync(dest)) {
    fs.mkdirSync(dest, { recursive: true });
  }
  const entries = fs.readdirSync(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyRecursiveSync(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

function copyRecursiveWithManifest(src, dest, rel, fileList) {
  if (!fs.existsSync(dest)) {
    fs.mkdirSync(dest, { recursive: true });
  }
  const entries = fs.readdirSync(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    const relPath = rel ? `${rel}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      copyRecursiveWithManifest(srcPath, destPath, relPath, fileList);
    } else if (entry.name !== 'manifest.json') {
      fs.copyFileSync(srcPath, destPath);
      fileList.push(relPath);
    }
  }
}
