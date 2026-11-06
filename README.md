# 信望愛福音會筲箕灣堂 · 新站原型

[開啟展示網站](https://fhcem-skw-preview.pages.dev)

信望愛福音會筲箕灣堂新網站（試行版，內容待教會審閱）：公開頁面有真正的網址（主頁、認識我們、聚會時間、教會活動、教會通告、聯絡我們、鳴謝及授權）；肢體專區有原 Google 講道表格及資料入口，另有團契點名、詩歌庫（試行），以及開發中的房間預約及詩歌簡報工具。

## 公開與私人資料

這個公開 repo 只包含程式、示範資料，以及原網站已公開的照片、文字和四份文件。公開 repo 的所有檔案及歷史都可以被任何人下載。

- 臨時密碼的驗證雜湊與 session 簽署金鑰只存於 Cloudflare Secrets，不在前端或此 repo。
- `.env`、`.dev.vars`、API 金鑰、登入 cookies、盤點原檔、上傳壓縮檔、私人講道／會友文件及測試證據不納入版本控制。
- 真正私人資料將來需使用受後端權限保護的儲存空間。`.gitignore` 不能刪除已上傳的秘密，也不能代替資料授權。
- 團契點名存於 Cloudflare D1（只存團內稱呼）；詩歌庫的歌曲資料存於同一個 D1，樂譜 PDF 存於教會的 Google Drive（網站代讀寫）；房間預約及簡報仍是示範資料，只存在當前瀏覽器 localStorage。

## 臨時登入

肢體專區的 HTML 和程式檔由 Worker 驗證 session 後提供。登入頁只有一個密碼欄：會友密碼換取有效 8 小時的 HttpOnly、Secure、SameSite=Strict cookie；全體傳道同工共用的同工密碼（由網站管理員在點名「設定」設定，PBKDF2 雜湊存於 D1）及網站管理員密碼（Worker secret `ATTENDANCE_ADMIN_CODE_HASH`）換取同類 cookie，但記住 90 日。更改同工密碼會即時登出所有同工；更換管理員雜湊會登出管理員。每次登入另有 Durable Object 有效記錄；登出會先持久撤銷該 session，再刪除 cookie，已複製的 cookie 亦隨即失效。其他裝置的獨立登入不受影響；更換密碼雜湊會令既有 session 失效。登入有 Cloudflare 每個位置的速率限制，並非全域精確鎖定。

團契點名：每個團契有一條點名連結 `/attendance/#<token>`，由同工建立或重設後發到該團群組。token 只在網址 fragment（不會送到伺服器記錄），頁面讀取後即從網址列移除，經 `POST /api/attendance/link` 換取只限該團的 HttpOnly cookie（90 日）；D1 只存 token 的 SHA-256。持連結即有該團的全部點名功能（點名、改期／取消、名單、該團月訊一行及統計），但不能開啟肢體專區其他內容；每次修改記下「<團名>連結」。重設連結會令舊連結及記住它的手機即時失效。每按一次即儲存一個人的出席狀態或一個人數，幾部手機同時點名不會互相覆蓋。

詩歌庫（試行）：已登入的會友可搜尋歌曲、在瀏覽器檢視或下載樂譜／鼓譜 PDF（歌頁及下載均提示「只供本堂聚會及練習使用，請勿外傳」）；同工及管理員可上載（一個 PDF，或最多 10 張相片在瀏覽器按次序合成一個 PDF，上限 20 MB）、取代（舊檔移到該歌的「舊版」）、刪除（移到「已刪除」，不會真正刪除）及修改歌曲資料。權限只在 `src/songs.js` 的 `songAccess()` 判斷，日後改為個人登入時只改這一處。PDF 由 Worker 驗證登入後從 Google Drive 轉送，Drive 檔案不公開分享。Drive 版面：`網站／詩歌庫／<中文歌名>／樂譜（X調）.pdf`、`樂譜（簡譜）（X調）.pdf`、`鼓譜.pdf`、`原檔／`、`舊版／`，以及 `網站／詩歌庫／已刪除／`。

版本及標籤（`0003_song_versions.sql`）：同一首歌同一類型及調可有多個**版本**（`song_files.version`，'' 或「標準」＝標準；例如 簡譜、鋼琴、前奏、和弦、和音），上載同一版本才會取代（舊檔移到舊版），還原亦只換回同一版本。上載 API：`POST /api/songs/upload?song=&kind=&key=&version=&photos=`（`version` 可省略）；`attach` 亦接受 `version`。歌曲有**標籤**（`songs.tags`，JSON 陣列，最多 5 個，每個 1–12 字），`POST`／`PATCH /api/songs/song` 可帶 `tags`，不帶則不變；`GET /api/songs/list` 每首歌附 `tags`，另回傳 `tags: [{name, count}]`。搜尋亦比對標籤（排在歌名相符之後）；按標籤篩選在歌單頁面進行（list 已包含全部歌曲及標籤，不必再發請求）。

Google Drive 連接：Worker secrets `GOOGLE_CLIENT_ID`、`GOOGLE_CLIENT_SECRET`（OAuth Web client，scope 只有 `drive.file`：網站只看到自己建立或用 Google Picker 選取的檔案）。管理員在詩歌庫「管理」按「連接 Google Drive」，用教會帳戶按「允許」；refresh token 以 AES-GCM 加密存於 D1（金鑰由 `PREVIEW_SESSION_SECRET` 導出），亦可改用 secret `GOOGLE_REFRESH_TOKEN`。OAuth redirect URI：`https://fhcem-skw-preview.pages.dev/api/google/callback`（可用 `GOOGLE_REDIRECT_URI` 覆蓋）。「重新掃描 Drive」列出直接放在「網站／詩歌庫」而未歸入的 PDF；「從 Drive 選取檔案」用 Google Picker：有人直接放進 Drive 的 PDF（網站的 `drive.file` 權限看不到），同工在 Picker 選取後網站才看到，再按「歸入」。要另設 Worker secrets `GOOGLE_PICKER_API_KEY`（Google Cloud → APIs & Services → Credentials 建立 API key：API restrictions 只限 Google Picker API；Application restrictions 選 Websites，加網站網址 `https://fhcem-skw-preview.pages.dev/*` **及 `https://docs.google.com/*`**——Picker 的 iframe 在 docs.google.com，缺少會出現「API developer key is invalid」）及 `GOOGLE_PROJECT_NUMBER`（同一個 Cloud project 的 project number，即 Picker 的 App ID；要與 OAuth client 同一 project，Google Picker API 要在該 project 啟用）。`GET /api/songs/picker`（只限同工／管理員，`no-store`）回傳 API key、App ID、由網站 refresh token 換來的短期 access token（scope 仍只是 `drive.file`，只在 Worker 記憶體短暫重用，不存 D1）及「網站／詩歌庫」資料夾 id；未設定 → 409 `picker_not_configured`，未連接 → 409 `drive_not_connected`。頁面按下按鈕才載入 `https://apis.google.com/js/api.js`；肢體專區頁的 CSP 因此多了 `script-src https://apis.google.com` 及 `frame-src https://docs.google.com https://drive.google.com`（公開頁面不變）。手機上 Picker 可能不好用，建議用電腦。本機假 Drive 模式用示範選取視窗，不載入 Google。本機開發在 `.dev.vars` 加 `SONGS_FAKE_DRIVE=1`，改用本機 D1 內的假 Drive，不會連接 Google；`node scripts/songs-seed.mjs <核對表.csv> 20` 產生假資料 SQL（`wrangler d1 execute ATT_DB --local --file …`）。上線前：GitHub variable `D1_MIGRATIONS=local` 時，先在已授權的本機執行 `npx wrangler d1 migrations apply ATT_DB --remote`（`0002_songs.sql`、`0003_song_versions.sql`），再設定上述 Google secrets；不要在 Cloudflare 設 `SONGS_FAKE_DRIVE`。

房間預約的示範單位（「網站管理員」、傳道同工及團契）仍只是展示資料分類。密碼只交給獲邀試用的人，不寫進公開 README 或 issue。

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
npm run build        # 由 site/ 產生 public/ 的靜態頁面
npm test
npm run check
npm run check:public
python scripts/check-pages.py https://localhost:8787 --shots --members
python scripts/check-auth.py https://localhost:8787
python scripts/check-session-revocation.py https://localhost:8787
python scripts/check-resources.py https://localhost:8787
python scripts/check-doc-layout.py https://localhost:8787
python scripts/check-ui-controls.py https://localhost:8787
python scripts/check-walks.py https://localhost:8787
python scripts/check-songs.py https://localhost:8787   # 詩歌庫；要先清空本機 D1 並匯入假資料（見腳本說明）
python scripts/check-preview.py https://localhost:8787
```

密碼測試從隱藏的互動輸入讀取，不放在命令參數或檔案。驗收使用 Chromium 模擬 1440×1000、390×844 及 320×740，並非 iPhone／Android 真機認證。

## 程式結構

- `site/`：公開頁面的來源（版面、頁面、內容資料）。`npm run build` 產生 `public/**/index.html` 及 `src/member-index.txt`；產生的檔案一併提交，`npm test` 會檢查是否最新。部署流程不需另加 build 步驟。
- `public/`：產生的公開頁面、`assets/site.css`／`site.js`、肢體專區樣式 `assets/members.css`、相片及 PDF。這裡的每個檔案皆可公開存取。
- `src/worker.js`（入口）、`src/router.js`（路由，可在 node:test 測試）、`src/auth.js`、`src/session-store.js`：登入與可撤銷 session。`src/attendance.js`、`src/attendance-core.js`、`src/unit-access.js`：團契點名 API、規則及月訊表、同工／管理員密碼與點名連結 cookie。`src/songs.js`、`src/songs-core.js`、`src/drive.js`：詩歌庫 API、排序／搜尋規則、Google Drive（及本機假 Drive）存取。`SESSIONS` 綁定 SQLite Durable Objects，每個登入只保存到期時間，登出／到期清除；不存密碼、cookie、會友或點名資料。
- `src/member-app.txt`、`src/member-index.txt`：由 Worker bundle 載入的肢體區程式與頁面，部署端受 session 保護；repo 裡的程式本身不是秘密。
- `site/data/documents.mjs`：四份原 PDF 的結構化閱讀版（/notices/<slug>/）。`site/data/bus.mjs`：「怎樣來」巴士下車資料（城巴、九巴及運輸署開放數據，2026 年 11 月）。
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

## 介面元件

七個元件改編自 Uiverse Galaxy（MIT）：箭嘴按鈕、搜尋欄、點名分段選擇、勾選框、聚會分類選項、浮動標籤輸入欄及載入動畫。作者和原始連結列於 `/credits/`，完整授權位於 `/assets/UIVERSE-LICENSE.txt`。使用原生 HTML/CSS/JavaScript，沒有新增 UI 套件。動態只在系統沒有開啟「減少動態」時播放；正式版不設動態開關。

`check-pages.py` 檢查所有公開頁面（加 `--members` 亦檢查六個肢體專區畫面）在 1440、390、320 寬的 JS 錯誤、橫向溢出、壞圖、短連結換行及減少動態；`check-ui-controls.py` 驗證搜尋、點名、分類選項、提示框、聯絡表格及主要按鈕的鍵盤操作。`check-walks.py` 驗證「怎樣來」地圖的六條步行路線（按站名或地圖標記顯示、一次一條、再按收起、說明文字、手機上自動捲到路線、減少動態、未載入程式時保持純文字）。截圖保存在忽略版本控制的 `evidence/`。

## 網址

公開：`/`、`/about/`（`faith/`、`history/`、`churches/`）、`/meetings/`、`/activities/`、`/notices/`（`weather/`、`song-copyright/`、`recreation/`、`weddings-funerals/`、`covid-2023/`）、`/contact/`、`/credits/`、`/login/`、`/attendance/`（打開團契點名連結）。不存在的網址顯示 404 頁；舊 Wix 網址不再轉向。

肢體專區：`/members/`、`/members/resources/`、`/members/attendance/`、`/members/songs/`（`?song=<id>` 歌頁、`?tab=upload`、`?tab=admin`）、`/members/rooms/`、`/members/ppt/`。未登入會 302 到 `/login/?next=…`；`/members/app.js` 未登入回 401。只持團契點名連結的手機只可開 `/members/attendance/` 及其程式檔。
