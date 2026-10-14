#!/usr/bin/env node

/**
 * validate-repo.mjs
 * 驗證實驗 Repository 是否符合標準規範 (結構、config.yml、SKILL.md)
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const targetDir = process.argv[2] ? path.resolve(process.argv[2]) : path.resolve('template');

console.log(`\n🔍 正在驗證 Repository 結構: ${targetDir}\n`);

const requiredDirs = [
  'raw',
  'photos',
  'processed',
  'analysis',
  'report',
  path.join('.github', 'skills', 'experiment-report'),
  path.join('.github', 'skills', 'github-workspace')
];

const requiredFiles = [
  'config.yml',
  'README.md',
  path.join('.github', 'skills', 'experiment-report', 'SKILL.md'),
  path.join('.github', 'skills', 'github-workspace', 'SKILL.md')
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

// 3. 檢查 config.yml 核心欄位
const configPath = path.join(targetDir, 'config.yml');
if (fs.existsSync(configPath)) {
  const content = fs.readFileSync(configPath, 'utf8');
  const requiredKeys = [
    'course_id',
    'course_name',
    'experiment_id',
    'experiment_name',
    'template_version',
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
  if (!hasError) {
    console.log('✅ config.yml 欄位完整度合格');
  }
}

// 4. 實質深度檢查 experiment-report/SKILL.md
const skillPath = path.join(targetDir, '.github', 'skills', 'experiment-report', 'SKILL.md');
if (fs.existsSync(skillPath)) {
  const skillContent = fs.readFileSync(skillPath, 'utf8');
  const versionMatch = skillContent.match(/version:\s*"([^"]+)"/);
  const hasFrontmatter = skillContent.startsWith('---') && skillContent.includes('name: experiment-report') && skillContent.includes('description:');

  if (!hasFrontmatter || !versionMatch) {
    console.error('❌ experiment-report/SKILL.md Frontmatter 格式不合法或缺少關鍵欄位');
    hasError = true;
  } else {
    // 檢查實質安全核心規範關鍵字
    const requiredSections = [
      'raw/',
      'Git 安全鎖',
      'Commit Message 規範',
      'report_mode'
    ];
    const missing = requiredSections.filter(sec => !skillContent.includes(sec));
    if (missing.length > 0) {
      console.error(`❌ experiment-report/SKILL.md 缺少必要安全章節或規範: ${missing.join(', ')}`);
      hasError = true;
    } else {
      console.log(`✅ experiment-report/SKILL.md 實質規範與版本宣告合格 (v${versionMatch[1]})`);
    }
  }
}

// 5. 實質深度檢查 github-workspace/SKILL.md
const wsSkillPath = path.join(targetDir, '.github', 'skills', 'github-workspace', 'SKILL.md');
if (fs.existsSync(wsSkillPath)) {
  const wsSkillContent = fs.readFileSync(wsSkillPath, 'utf8');
  const wsVersionMatch = wsSkillContent.match(/version:\s*"([^"]+)"/);
  const wsHasFrontmatter = wsSkillContent.startsWith('---') && wsSkillContent.includes('name: github-workspace') && wsSkillContent.includes('description:');

  if (!wsHasFrontmatter || !wsVersionMatch) {
    console.error('❌ github-workspace/SKILL.md Frontmatter 格式不合法或缺少關鍵欄位');
    hasError = true;
  } else {
    // 檢查實質操作與安全核心規範關鍵字
    const requiredWsSections = [
      'Course Mode',
      'Experiment Mode',
      'Raw Data Sanctuary',
      'report_mode: separate',
      'report_mode: shared',
      'Commit SHA',
      'Git 安全鎖'
    ];
    const missing = requiredWsSections.filter(sec => !wsSkillContent.includes(sec));
    if (missing.length > 0) {
      console.error(`❌ github-workspace/SKILL.md 缺少必要架構或安全章節: ${missing.join(', ')}`);
      hasError = true;
    } else {
      console.log(`✅ github-workspace/SKILL.md 實質規範與版本宣告合格 (v${wsVersionMatch[1]})`);
    }
  }
}

// 6. 母倉庫同步一致性檢查 (若在母倉庫內執行且 template 目錄存在)
const rootSkillsDir = path.resolve('.github', 'skills');
const templateSkillsDir = path.resolve('template', '.github', 'skills');
const webWsSkill = path.resolve('web', 'public', 'skills', 'github-workspace', 'SKILL.md');

if (fs.existsSync(rootSkillsDir) && fs.existsSync(templateSkillsDir)) {
  const rootWsSkill = path.join(rootSkillsDir, 'github-workspace', 'SKILL.md');
  const tmplWsSkill = path.join(templateSkillsDir, 'github-workspace', 'SKILL.md');
  if (fs.existsSync(rootWsSkill) && fs.existsSync(tmplWsSkill)) {
    const rootHash = crypto.createHash('sha256').update(fs.readFileSync(rootWsSkill)).digest('hex');
    const tmplHash = crypto.createHash('sha256').update(fs.readFileSync(tmplWsSkill)).digest('hex');
    if (rootHash !== tmplHash) {
      console.error('❌ 母倉庫與 template 中的 github-workspace/SKILL.md 內容不一致 (雜湊不匹配)！請執行 npm run sync-skill');
      hasError = true;
    } else {
      console.log('✅ 母倉庫與 template 之 Skill 雜湊完全一致 (Sync verified)');
    }

    // 驗證 web/public 靜態檔案一致性
    if (fs.existsSync(webWsSkill)) {
      const webHash = crypto.createHash('sha256').update(fs.readFileSync(webWsSkill)).digest('hex');
      if (rootHash !== webHash) {
        console.error('❌ 母倉庫與 web/public 中的 github-workspace/SKILL.md 內容不一致！請執行 npm run sync-skill');
        hasError = true;
      } else {
        console.log('✅ 母倉庫與 web/public 之 Skill 雜湊完全一致 (Web sync verified)');
      }
    }
  }
}

if (hasError) {
  console.error('\n❌ 驗證失敗：結構不符合規範！\n');
  process.exit(1);
} else {
  console.log('\n🎉 驗證通過：該 Repository 結構完全符合實驗工作區規範！\n');
}
