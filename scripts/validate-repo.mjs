#!/usr/bin/env node

/**
 * validate-repo.mjs
 * 驗證實驗 Repository 是否符合標準規範 (結構、config.yml 完整度與版本、SKILL.md 規格)
 */

import fs from 'node:fs';
import path from 'node:path';

const targetDir = process.argv[2] ? path.resolve(process.argv[2]) : path.resolve('template');

console.log(`\n🔍 正在驗證 Repository 結構: ${targetDir}\n`);

const requiredDirs = [
  'raw',
  'photos',
  'processed',
  'analysis',
  'report',
  path.join('.github', 'skills', 'experiment-report')
];

const requiredFiles = [
  'config.yml',
  'README.md',
  path.join('.github', 'skills', 'experiment-report', 'SKILL.md')
];

let hasError = false;

// 1. 檢查目錄
for (const dir of requiredDirs) {
  const fullPath = path.join(targetDir, dir);
  if (!fs.existsSync(fullPath) || !fs.statSync(fullPath).isDirectory()) {
    console.error(`❌ 缺少必要目錄: ${dir}`);
    hasError = true;
  } else {
    console.log(`✅ 目錄存在: ${dir}`);
  }
}

// 2. 檢查檔案
for (const file of requiredFiles) {
  const fullPath = path.join(targetDir, file);
  if (!fs.existsSync(fullPath) || !fs.statSync(fullPath).isFile()) {
    console.error(`❌ 缺少必要檔案: ${file}`);
    hasError = true;
  } else {
    console.log(`✅ 檔案存在: ${file}`);
  }
}

// 3. 檢查 config.yml 核心欄位與版本設定
const configPath = path.join(targetDir, 'config.yml');
if (fs.existsSync(configPath)) {
  const content = fs.readFileSync(configPath, 'utf8');
  const requiredKeys = [
    'course_id',
    'course_name',
    'experiment_id',
    'experiment_name',
    'template_version',
    'skill_version',
    'report_mode',
    'status',
    'members'
  ];

  for (const key of requiredKeys) {
    if (!new RegExp(`^\\s*${key}\\s*:`, 'm').test(content)) {
      console.error(`❌ config.yml 缺少關鍵欄位: ${key}`);
      hasError = true;
    }
  }

  // 檢查特定欄位值之合法性
  const reportModeMatch = content.match(/^\s*report_mode\s*:\s*"?([a-zA-Z0-9_-]+)"?/m);
  if (reportModeMatch) {
    const mode = reportModeMatch[1];
    if (mode !== 'shared' && mode !== 'separate') {
      console.error(`❌ config.yml 中的 report_mode 必須為 shared 或 separate，目前為: ${mode}`);
      hasError = true;
    }
  }

  const statusMatch = content.match(/^\s*status\s*:\s*"?([a-zA-Z0-9_-]+)"?/m);
  if (statusMatch) {
    const status = statusMatch[1];
    const validStatuses = ['not_started', 'in_progress', 'data_processing', 'report_writing', 'completed'];
    if (!validStatuses.includes(status)) {
      console.error(`❌ config.yml 中的 status 值無效: ${status}`);
      hasError = true;
    }
  }

  if (!hasError) {
    console.log('✅ config.yml 欄位完整度與版本設定合格');
  }
}

// 4. 檢查 SKILL.md
const skillPath = path.join(targetDir, '.github', 'skills', 'experiment-report', 'SKILL.md');
if (fs.existsSync(skillPath)) {
  const skillContent = fs.readFileSync(skillPath, 'utf8');
  const versionMatch = skillContent.match(/version:\s*"([^"]+)"/);
  if (!skillContent.includes('name: experiment-report') || !versionMatch) {
    console.error('❌ SKILL.md 標頭缺少 name 或 version 規格');
    hasError = true;
  } else {
    console.log(`✅ SKILL.md 規範與版本宣告合格 (v${versionMatch[1]})`);
  }
}

if (hasError) {
  console.error('\n❌ 驗證失敗：結構不符合規範！\n');
  process.exit(1);
} else {
  console.log('\n🎉 驗證通過：該 Repository 結構完全符合實驗工作區規範！\n');
}
