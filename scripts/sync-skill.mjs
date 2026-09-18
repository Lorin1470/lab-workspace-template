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

const SOURCE_SKILL_DIR = path.join(ROOT_DIR, '.github', 'skills', 'experiment-report');
const TARGET_SKILL_DIR = path.join(ROOT_DIR, 'template', '.github', 'skills', 'experiment-report');

console.log('🔄 正在同步 Agent Skill 規範...');
console.log(`   來源 (Source):  ${SOURCE_SKILL_DIR}`);
console.log(`   目標 (Target):  ${TARGET_SKILL_DIR}`);

if (!fs.existsSync(SOURCE_SKILL_DIR)) {
  console.error('❌ 錯誤：來源 Skill 目錄不存在！');
  process.exit(1);
}

copyRecursiveSync(SOURCE_SKILL_DIR, TARGET_SKILL_DIR);
console.log('✅ Agent Skill 同步完成！template/ 已更新為最新 Skill 規範。\n');

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
