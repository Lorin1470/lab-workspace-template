# Cloudflare Web App 部署指南

本專案的前端與後端採用 **Cloudflare Pages + Pages Functions + D1 Database** 進行部署。

---

## 一、先備條件
1. 已安裝 Wrangler：`npx wrangler`。
2. 已登入 Cloudflare：`npx wrangler whoami`。
3. 具備託管域名（本環境現有：`minerdog.qzz.io`）。

---

## 二、D1 資料庫初始化

在終端機中執行建立指令：

```bash
# 1. 建立 D1 資料庫
npx wrangler d1 create experiment-workspace-db

# 2. 執行資料表綱要 (Schema)
npx wrangler d1 execute experiment-workspace-db --file=web/schema.sql
```

建立後會取得 `database_id`，請將其填入 `web/wrangler.toml` 中的 `database_id` 欄位。

---

## 三、設定 GitHub 認證與管理員環境變數 (Secrets)

為確保安全性，GitHub 密鑰與管理員身分嚴禁寫死在前端。請於 Cloudflare Pages 設定 Secret：

```bash
# 1. 配置 GitHub OAuth 密鑰
npx wrangler pages secret put GITHUB_CLIENT_ID
npx wrangler pages secret put GITHUB_CLIENT_SECRET

# 2. 配置初始系統管理員與維運管理者 GitHub ID (例如數值 ID 106532605 或 GitHub username)
npx wrangler pages secret put INITIAL_ADMIN_GITHUB_ID
npx wrangler pages secret put MINERDOG_GITHUB_ID
```

### 全新環境初始化安全說明
- **移除非管理者自動授權**：為維護學生專用模式的安全邊界，即使在資料庫課程數為 0 的全新環境中，一般學生與未獲授權使用者呼叫 `POST /api/courses` 依然會收到 `403 Forbidden`，資料庫亦不會產生任何課程或成員紀錄。
- **全新環境安全初始化途徑**：
  1. **途徑一（管理員 Web 登入）**：由 `INITIAL_ADMIN_GITHUB_ID` 或 `MINERDOG_GITHUB_ID` 指定之管理員以 GitHub 帳號登入系統，呼叫 `POST /api/courses` 建立第一門課程；該管理員將自動登記為教師。
  2. **途徑二（D1 SQL 預先植入）**：維運人員於佈署時，透過 `npx wrangler d1 execute <db-name> --command="..."` 預先寫入第一筆課程與指定教師之 `course_memberships`。

---

## 四、建置與部署

```bash
# 1. 進入 web 目錄並安裝相依
cd web
npm install

# 2. 建置前端靜態資源
npm run build

# 3. 部署至 Cloudflare Pages
npx wrangler pages deploy dist --project-name=lab-workspace-web
```

---

## 五、自訂網域綁定
部署完成後，可於 Cloudflare 控制台或透過 Wrangler 將專案綁定至現有網域之子網域：
* 建議子網域：`lab.minerdog.qzz.io`
