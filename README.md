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

CI 會在 push／pull request 驗證程式、測試及公開檔案檢查。`AUTO_DEPLOY=true` 時，main 的 push 通過檢查後會部署；其他分支及 pull request 不部署。此 repo 已準備開啟自動部署，目前仍須加入下述 API token 才能執行部署。

首次啟用（帳戶 ID 已設定，毋須重新加入）：

1. 開啟 [Cloudflare → My Profile → API Tokens](https://dash.cloudflare.com/profile/api-tokens)，按 **Create Token → Create Custom Token → Get started**。
2. 名稱可填 `fhcem-skw-github-deploy`；加入三項帳戶權限：**Account → Workers Scripts → Edit**、**Account → Cloudflare Pages → Edit**、**Account → Account Settings → Read**。在 **Account Resources** 選 **Include → Specific account**，只選本網站的 Cloudflare 帳戶。這個專用 token 不需 DNS、Wix 或 token 管理權限。
3. GitHub hosted runner 的 IP 會變動，不設定固定 Client IP 篩選。選擇合適到期日，按 **Continue to summary → Create Token**。複製新 token；Cloudflare 只會顯示一次。
4. 開啟 [此 repo 的 Actions Secrets](https://github.com/JS9Sch/fhcem-skw-website/settings/secrets/actions)，按 **New repository secret**。Name 填 `CLOUDFLARE_API_TOKEN`，Secret 貼上 token，按 **Add secret**。不要將 token 貼在聊天、issue、程式或截圖中。不要使用 Global API Key 或複製本機 Wrangler OAuth token。
5. 開啟 [Validate and deploy preview](https://github.com/JS9Sch/fhcem-skw-website/actions/workflows/deploy.yml)，按 **Run workflow → main → Run workflow** 驗證第一次部署。新增 secret 本身不會觸發 workflow。

`CLOUDFLARE_ACCOUNT_ID` 已配置為 secret。自動部署的開關在 [Actions Variables](https://github.com/JS9Sch/fhcem-skw-website/settings/variables/actions)：`AUTO_DEPLOY=true` 開啟；改成 `false` 或刪除即關閉。手動 Run workflow 仍可部署 main。

部署順序為 CI → Worker → Pages → 線上檢查。最後會檢查首頁、Pages 到 Worker 的連接、匿名肢體區拒絕存取，以及四份 PDF 的瀏覽器閱讀標頭。線上檢查不需要密碼、不送聯絡表格，也不會登入肢體區。檢查失敗會標記 workflow 失敗，不會自動回滾已部署內容。

缺少 token 時，部署會在寫入前停止並說明缺少憑證；不能把 CI 成功當作已部署成功。其他 fork 若要部署，須另設自己的帳戶、專案及 secrets。

既有 Worker 已配置臨時登入秘密；部署 workflow 不會重設密碼。另建環境時，須在 Cloudflare Worker 的 Variables and Secrets 設定 `PREVIEW_PASSWORD_HASH` 與 `PREVIEW_SESSION_SECRET`，缺少時登入會拒絕。正式部署憑證不需要放在 Pages，因它使用 Service Binding。

不透過 Actions 也可在已授權的本機使用 `npm run deploy`，再於 `preview-address/` 執行 `wrangler pages deploy dist --project-name fhcem-skw-preview --branch main`。

## 內容及範圍

公開內容按 2026-10-27 原站盤點搬入，沒有原站或 Wix 圖片服務的載入依賴。2011 年文件及 2023 年疫情通告清楚標明歷史性質；現行條款、價格、人事與聚會安排仍需教會確認。活動圖片原頁沒有日期或名稱，沒有補造活動。

聯絡表格只驗證欄位，不送出。內部週刊、月訊、私人講道、相簿及原始會友資料沒有加入。Wix 和正式 DNS 未改動。

第三方元件授權見 `public/assets/*LICENSE*` 和站內「元件來源」。教會照片、文件及文字不包含在第三方套件的 MIT 授權內。
