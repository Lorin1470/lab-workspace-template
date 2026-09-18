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

## 三、設定 GitHub 認證環境變數 (Secrets)

為確保安全性，GitHub 密鑰嚴禁寫死在前端。請於 Cloudflare Pages 設定 Secret：

```bash
# 在 Cloudflare Pages 專案中配置後端密鑰
npx wrangler pages secret put GITHUB_CLIENT_ID
npx wrangler pages secret put GITHUB_CLIENT_SECRET
```

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
