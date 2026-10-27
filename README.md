# 信望愛福音會筲箕灣堂 · 新站原型

[開啟展示網站](https://fhcem-skw-preview.pages.dev)

供教會評閱的互動原型：公開教會資訊、聚會時間、通告站內閱讀及 PDF 瀏覽；肢體專區有示範點名、詩歌簡報及房間預約。

## 公開與私人資料

這個公開 repo 只包含程式、示範資料，以及原網站已公開的照片、文字和四份文件。公開 repo 的所有檔案及歷史都可以被任何人下載。

- 臨時密碼的驗證雜湊與 session 簽署金鑰只存於 Cloudflare Secrets，不在前端或此 repo。
- `.env`、`.dev.vars`、API 金鑰、登入 cookies、盤點原檔、上傳壓縮檔、私人講道／會友文件及測試證據不納入版本控制。
- 真正私人資料將來需使用受後端權限保護的儲存空間。`.gitignore` 不能刪除已上傳的秘密，也不能代替資料授權。
- 目前點名／預約仍是示範資料，只存在當前瀏覽器 localStorage；尚未有真實會友系統或跨裝置同步。

## 臨時登入

肢體專區的 HTML 和程式檔由 Worker 驗證 session 後提供。正確密碼換取有效 8 小時的 HttpOnly、Secure、SameSite=Strict cookie。可登出；更換密碼雜湊會令既有 session 失效。登入有 Cloudflare 每個位置的速率限制，並非全域精確鎖定。

示範單位包含「網站管理員」、傳道同工及團契。這些是展示資料分類，尚未代表正式細項權限。密碼只交給獲邀試用的人，不寫進公開 README 或 issue。

## 本機開發

需要 Node.js 22 或以上。瀏覽器測試另需 Python、Playwright 和 Chromium。

```sh
npm ci
cp .dev.vars.example .dev.vars
# 用本機編輯器填入測試密碼的 SHA-256 雜湊及隨機 session key
npm run dev
```

本機網址為 `https://localhost:8787`。Wrangler 使用本機憑證；本機測試腳本只對 localhost 忽略憑證錯誤。正式網址使用 Cloudflare HTTPS。

```sh
npm test
npm run check
npm run check:public
python scripts/check-auth.py https://localhost:8787
python scripts/check-doc-layout.py https://localhost:8787
python scripts/check-preview.py https://localhost:8787
```

密碼測試從隱藏的互動輸入讀取，不放在命令參數或檔案。驗收使用 Chromium 模擬 1440×1000、390×844 及 320×740，並非 iPhone／Android 真機認證。

## 程式結構

- `public/`：公開頁面、樣式、動態與已公開素材。這裡的每個檔案皆可公開存取。
- `src/worker.js`、`src/auth.js`：Worker 路由、登入與 session。
- `src/member-app.txt`、`src/member-index.txt`：由 Worker bundle 載入的肢體區程式與頁面，部署端受 session 保護；repo 裡的程式本身不是秘密。
- `public/document-content.js`、`public/documents.js`：四份原 PDF 的結構化閱讀版。
- `preview-address/`：Pages 網址透過 Service Binding 呼叫 Worker；不公開帳戶子網域。

## GitHub Actions 部署選項

CI 會在 push／pull request 驗證程式、測試及公開檔案檢查。自動部署預設關閉。

要開啟部署：

1. 在 Cloudflare 帳戶建立限定該帳戶、具備 Workers Scripts 編輯及 Cloudflare Pages 編輯權限的 API token。不要使用 Global API Key，也不要將本機 Wrangler OAuth token 複製過去。
2. 在本 repo 的 **Settings → Secrets and variables → Actions → Secrets** 新增 `CLOUDFLARE_API_TOKEN`。此 repo 的 `CLOUDFLARE_ACCOUNT_ID` 已配置；若複製到另一個 repo，亦須新增該 secret。
3. 在 **Actions → Validate and deploy preview → Run workflow** 可手動部署。先驗證，再部署 Worker 及 Pages。
4. 若想每次 push 到 `main` 自動部署，在同一設定的 **Variables** 新增 `AUTO_DEPLOY=true`。刪除或改成 `false` 可關閉。

既有 Worker 已配置臨時登入秘密；部署 workflow 不會重設密碼。另建環境時，須在 Cloudflare Worker 的 Variables and Secrets 設定 `PREVIEW_PASSWORD_HASH` 與 `PREVIEW_SESSION_SECRET`，缺少時登入會拒絕。正式部署憑證不需要放在 Pages，因它使用 Service Binding。

不透過 Actions 也可在已授權的本機使用 `npm run deploy`，再於 `preview-address/` 執行 `wrangler pages deploy dist --project-name fhcem-skw-preview --branch main`。

## 內容及範圍

公開內容按 2026-10-27 原站盤點搬入，沒有原站或 Wix 圖片服務的載入依賴。2011 年文件及 2023 年疫情通告清楚標明歷史性質；現行條款、價格、人事與聚會安排仍需教會確認。活動圖片原頁沒有日期或名稱，沒有補造活動。

聯絡表格只驗證欄位，不送出。內部週刊、月訊、私人講道、相簿及原始會友資料沒有加入。Wix 和正式 DNS 未改動。

第三方元件授權見 `public/assets/*LICENSE*` 和站內「元件來源」。教會照片、文件及文字不包含在第三方套件的 MIT 授權內。
