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

為確保安全性，GitHub 密鑰與管理員身分嚴禁寫死在前端或程式碼中。請於 Cloudflare Pages 設定 Secret：

```bash
# 1. 配置 GitHub OAuth 應用程式密鑰
npx wrangler pages secret put GITHUB_CLIENT_ID
npx wrangler pages secret put GITHUB_CLIENT_SECRET

# 2. 配置初始系統管理員與維運管理者 GitHub 數值 ID (嚴格限制僅接受數字 ID，不接受 username)
npx wrangler pages secret put INITIAL_ADMIN_GITHUB_ID
npx wrangler pages secret put MINERDOG_GITHUB_ID
```

### 如何查詢 GitHub 帳號數值 ID (Numeric ID)
系統後端鑑權邏輯係以 GitHub OAuth API 回傳之不可變數值 ID（即 `userData.id`，例如 `106532605`）作為唯一比對依據，**嚴格不接受英文字串之 GitHub username（使用者名稱）**。

您可以透過 GitHub 公開 API 查詢指定帳號的數值 ID（此為公開資訊，無需登入或提供任何 Token/Secret）：
```bash
# 查詢公開使用者資訊中的 id 數值 (將 <username> 替換為實際 GitHub 帳號)
curl -s https://api.github.com/users/<username> | grep '"id":'
```
或直接在瀏覽器開啟 `https://api.github.com/users/<username>` 查看 JSON 回傳中的 `"id"` 欄位整數。

> **安全注意事項**：查詢數值 ID 屬於 GitHub 公開資料，但請妥善保管管理員環境變數與 OAuth Secret，切勿將任何 Client Secret 或 Token 輸出至終端或公開回報中。

### 全新環境初始化安全說明
- **移除非管理者自動授權**：為維護學生專用模式的安全邊界，即使在資料庫課程數為 0 的全新環境中，一般學生與未獲授權使用者呼叫 `POST /api/courses` 依然會收到 `403 Forbidden`，資料庫亦不會產生任何課程或成員紀錄。
- **全新環境安全初始化途徑**：
  1. **途徑一（管理員 Web 登入建立首門課，推薦）**：
     - 維運人員設定 `INITIAL_ADMIN_GITHUB_ID`（填入管理員之 GitHub 數值 ID）。
     - 該管理員以該 GitHub 帳號透過 Web 介面登入系統，呼叫 `POST /api/courses` 建立第一門課程。
     - 系統將自動在 `courses` 建立課程，並在 `course_memberships` 為該管理員寫入 `role: 'teacher'` 活躍成員紀錄。
  2. **途徑二（D1 SQL 預先植入）**：
     - 若希望在使用者登入前由維運人員直接建立初始課程與教師成員，請務必嚴格依據 `web/schema.sql` 定義之資料結構（如 `courses` 必要欄位 `id`, `course_code`, `name`, `semester`；`course_memberships` 必要欄位 `id`, `course_id`, `github_id` 數值 ID, `username`, `role='teacher'`）撰寫符合約束之 Migration 或 Seed 腳本執行植入。

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
