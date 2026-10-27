# 信望愛福音會筲箕灣堂 · 新站原型

[開啟展示網站](https://fhcem-skw-preview.pages.dev)

供教會評閱的互動原型：公開教會資訊、聚會時間、通告站內閱讀及 PDF 瀏覽；肢體專區有原 Google 講道表格及資料入口，另有示範點名、詩歌簡報及房間預約。

## 公開與私人資料

這個公開 repo 只包含程式、示範資料，以及原網站已公開的照片、文字和四份文件。公開 repo 的所有檔案及歷史都可以被任何人下載。

- 臨時密碼的驗證雜湊與 session 簽署金鑰只存於 Cloudflare Secrets，不在前端或此 repo。
- `.env`、`.dev.vars`、API 金鑰、登入 cookies、盤點原檔、上傳壓縮檔、私人講道／會友文件及測試證據不納入版本控制。
- 真正私人資料將來需使用受後端權限保護的儲存空間。`.gitignore` 不能刪除已上傳的秘密，也不能代替資料授權。
- 目前點名／預約仍是示範資料，只存在當前瀏覽器 localStorage；尚未有真實會友系統或跨裝置同步。

## 臨時登入

肢體專區的 HTML 和程式檔由 Worker 驗證 session 後提供。正確密碼換取有效 8 小時的 HttpOnly、Secure、SameSite=Strict cookie。每次登入另有 Durable Object 有效記錄；登出會先持久撤銷該 session，再刪除 cookie，已複製的 cookie 亦隨即失效。其他裝置的獨立登入不受影響；更換密碼雜湊會令既有 session 失效。登入有 Cloudflare 每個位置的速率限制，並非全域精確鎖定。

示範單位包含「網站管理員」、傳道同工及團契。這些是展示資料分類，尚未代表正式細項權限。密碼只交給獲邀試用的人，不寫進公開 README 或 issue。

## 本機開發

需要 Node.js 22 或以上。瀏覽器測試另需 Python、Playwright 和 Chromium。

```sh
npm ci
cp .dev.vars.example .dev.vars
# 用本機編輯器填入測試密碼的 SHA-256 雜湊及隨機 session key
npm run dev
```

本機網址為 `https://localhost:8787`。Wrangler 使用本機憑證；瀏覽器測試腳本只對精確的 `localhost`、`127.0.0.1`、`::1` 主機忽略憑證錯誤；遠端 HTTPS 強制驗證憑證，HTTP、含帳密及路徑的測試網址會拒絕。正式網址使用 Cloudflare HTTPS。

```sh
npm test
npm run check
npm run check:public
python scripts/check-auth.py https://localhost:8787
python scripts/check-session-revocation.py https://localhost:8787
python scripts/check-resources.py https://localhost:8787
python scripts/check-doc-layout.py https://localhost:8787
python scripts/check-preview.py https://localhost:8787
```

密碼測試從隱藏的互動輸入讀取，不放在命令參數或檔案。驗收使用 Chromium 模擬 1440×1000、390×844 及 320×740，並非 iPhone／Android 真機認證。

## 程式結構

- `public/`：公開頁面、樣式、動態與已公開素材。這裡的每個檔案皆可公開存取。
- `src/worker.js`、`src/auth.js`、`src/session-store.js`：Worker 路由、登入與可撤銷 session。`SESSIONS` 綁定 SQLite Durable Objects，每個登入只保存到期時間，登出／到期清除；不存密碼、cookie、會友或點名資料。
- `src/member-app.txt`、`src/member-index.txt`：由 Worker bundle 載入的肢體區程式與頁面，部署端受 session 保護；repo 裡的程式本身不是秘密。
- `public/document-content.js`、`public/documents.js`：四份原 PDF 的結構化閱讀版。
- `preview-address/`：Pages 網址透過 Service Binding 呼叫 Worker；不公開帳戶子網域。

## GitHub Actions 部署選項

CI 會在 push／pull request 驗證程式、測試及公開檔案檢查。`AUTO_DEPLOY=true` 時，main 的 push 通過檢查後會部署；其他分支及 pull request 不部署。此 repo 已設定 `AUTO_DEPLOY=true` 及所需 Actions secrets；2026-10-27 已完成首次 GitHub → Worker → Pages 部署與線上驗收。

以下步驟供日後更換 token 或重新設定時使用；目前不需要重做：

1. 開啟 [Cloudflare → My Profile → API Tokens](https://dash.cloudflare.com/profile/api-tokens)，按 **Create Token → Create Custom Token → Get started**。
2. 名稱可填 `fhcem-skw-github-deploy`；加入三項帳戶權限：**Account → Workers Scripts → Edit**、**Account → Cloudflare Pages → Edit**、**Account → Account Settings → Read**。在 **Account Resources** 選 **Include → Specific account**，只選本網站的 Cloudflare 帳戶。這個專用 token 不需 DNS、Wix 或 token 管理權限。
3. GitHub hosted runner 的 IP 會變動，不設定固定 Client IP 篩選。選擇合適到期日，按 **Continue to summary → Create Token**。複製新 token；Cloudflare 只會顯示一次。
4. 開啟 [此 repo 的 Actions Secrets](https://github.com/JS9Sch/fhcem-skw-website/settings/secrets/actions)，按 **New repository secret**。Name 填 `CLOUDFLARE_API_TOKEN`，Secret 貼上 token，按 **Add secret**。不要將 token 貼在聊天、issue、程式或截圖中。不要使用 Global API Key 或複製本機 Wrangler OAuth token。
5. 開啟 [Validate and deploy preview](https://github.com/JS9Sch/fhcem-skw-website/actions/workflows/deploy.yml)，按 **Run workflow → main → Run workflow** 驗證第一次部署。新增 secret 本身不會觸發 workflow。

`CLOUDFLARE_ACCOUNT_ID` 已配置為 secret。自動部署的開關在 [Actions Variables](https://github.com/JS9Sch/fhcem-skw-website/settings/variables/actions)：`AUTO_DEPLOY=true` 開啟；改成 `false` 或刪除即關閉。手動 Run workflow 仍可部署 main。

部署順序為 CI → Worker → Pages → 線上檢查。最後會檢查首頁、Pages 到 Worker 的連接、匿名肢體區拒絕存取，以及四份 PDF 的瀏覽器閱讀標頭。線上檢查不需要密碼、不送聯絡表格，也不會登入肢體區。檢查失敗會標記 workflow 失敗，不會自動回滾已部署內容。

缺少 token 時，部署會在寫入前停止並說明缺少憑證；不能把 CI 成功當作已部署成功。其他 fork 若要部署，須另設自己的帳戶、專案及 secrets。

首次部署 `session-v1` migration 會建立 session 儲存；舊的無狀態登入沒有有效記錄，需要重新登入一次。儲存服務不可用時登入／驗證／撤銷會拒絕，不會退回只驗簽章。

既有 Worker 已配置臨時登入秘密；部署 workflow 不會重設密碼。另建環境時，須在 Cloudflare Worker 的 Variables and Secrets 設定 `PREVIEW_PASSWORD_HASH` 與 `PREVIEW_SESSION_SECRET`，缺少時登入會拒絕。正式部署憑證不需要放在 Pages，因它使用 Service Binding。

不透過 Actions 也可在已授權的本機使用 `npm run deploy`，再於 `preview-address/` 執行 `wrangler pages deploy dist --project-name fhcem-skw-preview --branch main`。

## 內容及範圍

公開內容按 2026-10-27 原站盤點搬入，沒有原站或 Wix 圖片服務的載入依賴。2011 年文件及 2023 年疫情通告清楚標明歷史性質；現行條款、價格、人事與聚會安排仍需教會確認。活動圖片原頁沒有日期或名稱，沒有補造活動。

聯絡表格只驗證欄位，不送出。講道集在登入後嵌入原 Google 表格，可選年份並另開 Google；週刊、月訊及相片索引提供原入口。週刊／月訊仍需獲授權的 Google 帳戶；相片索引中的舊相簿連結已失效，原檔待整理。沒有複製內部文件或錄音，也沒有更改 Google 分享設定。Wix 和正式 DNS 未改動。

第三方元件授權見 `public/assets/*LICENSE*` 和站內「元件來源」。教會照片、文件及文字不包含在第三方套件的 MIT 授權內。

## Google 肢體資源設定

原來源 URL 只存於 Worker 的 `MEMBER_RESOURCES` secret，不寫進公開 repo、HTML 或前端程式。`GET /api/member-resources` 在驗證可撤銷 session 後提供資料，所有回應均 `no-store`；匿名／已登出 session 回 401，設定缺少或不符格式回 503。只有受保護的肢體 HTML 允許嵌入 `docs.google.com`；其他頁面仍禁止 iframe。

secret 的 JSON 結構為 `sermons: {url, embedUrl, tabs: [{label, url}]}` 及 `weekly: {url}`、`monthly: {url}`、`photos: {url}`。入口只接受 HTTPS 的 `docs.google.com`／`drive.google.com`，iframe 只接受已發佈的 Google Sheets URL。原站提供的來源已配置；Google 的 resource key 會保留。新環境可在 Cloudflare Worker → Settings → Variables and Secrets 加入此 secret，或使用 `wrangler secret put MEMBER_RESOURCES` 的私密輸入。請勿把實際來源貼進 issue 或提交 `.dev.vars`。

站內登入只保護這個網站提供的入口；已取得的 Google URL 是否能直接開啟，仍取決於 Google 原有分享設定。嵌入不是媒體備份，也不保證舊連結或錄音仍可播放。手機可在表格內左右滑動，或另開 Google 閱讀。

`check-resources.py` 的第三方 Google iframe 一律驗證 TLS。本機開發的憑證例外只用於固定本機 origin 的獨立傳輸；輸入密碼的 API 請求不跟隨轉址。腳本檢查匿名／登出重放、實際表格、年份切換、失敗重試和三種畫面尺寸；證據留在忽略版本控制的 `evidence/resources/`。
