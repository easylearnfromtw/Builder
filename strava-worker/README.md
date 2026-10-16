# 健人 × Strava 串聯後端（Cloudflare Worker）

> 本資料夾包含可部署的 OAuth2 後端程式碼，但**不包含個人的 Strava 憑證**。GitHub Pages 不能安全保管 Client Secret；沒有部署後端和設定 Strava App 之前，前台「連結 Strava」不會完成授權。

## 一、建立 Strava 應用程式

1. 登入 https://www.strava.com/settings/api （Strava 目前要求訂閱才能新建 API 應用程式）。
2. 設定 Application Name / Category / Website。
3. `Authorization Callback Domain` 填**你的 Cloudflare Worker 網域**，例如 `jianren-strava.your-account.workers.dev`（不含 `https://` 和路徑）。
4. 在 Strava 後台取得 `Client ID` 與 `Client Secret`。**Client Secret 不得寫入 HTML、GitHub、程式碼或前台設定。**

## 二、部署 Cloudflare Worker

1. 在 Cloudflare 建立 Workers KV 命名空間，名字可叫 `jianren-strava-sessions`。
2. 修改 `wrangler.toml`：將 `APP_URL` 換為健人網站實際完整 HTTPS 網址（**保留結尾的 `/`**），填入 KV namespace 實際 ID 並解除 `kv_namespaces` 區塊註解。
3. 在 `strava-worker/` 資料夾執行 `npx wrangler deploy`，或在 Cloudflare Workers 介面匯入程式碼並設定同樣的環境變數及 KV 綁定。
4. 在 Cloudflare Worker 的 Secrets and variables 設定以下 **Secrets**：
   - `STRAVA_CLIENT_ID`：Strava Client ID。
   - `STRAVA_CLIENT_SECRET`：Strava Client Secret。
   - `STATE_SECRET`：至少 32 位隨機字元的簽章密鑰，請用密碼管理器產生。
5. 在 Worker 綁定 KV variable `STRAVA_SESSIONS` 到上一步建立的命名空間；`APP_URL` 作為一般文字變數（完整網址）。
6. 開啟 `https://<你的 Worker 網域>/health`，應回傳 `{"ok":true,"name":"Jianren Strava OAuth Proxy"}`。
7. 如部署後 Worker 網域不同於 Strava App 的 Callback Domain，回 Strava 設定頁修正該網域。

**Wrangler 指令範例（請在 `strava-worker/` 路徑執行）：**

```bash
npx wrangler secret put STRAVA_CLIENT_ID
npx wrangler secret put STRAVA_CLIENT_SECRET
npx wrangler secret put STATE_SECRET
npx wrangler deploy
```

輸入 Secret 時遵循 Cloudflare 提示，不要把 Secret 寫在命令列參數、聊天內容或公開檔案。

## 三、在「健人」設定完成連結

1. 在健人網站右上角選「設定與備份」。
2. 展開「第一次使用？展開 Strava 串聯教學」。
3. 在「Strava 安全服務網址」輸入 Worker 的根網址，按「儲存服務網址」。
4. 按「連結 Strava」，登入 Strava 並同意授權 `read` + `activity:read`。
5. 返回健人，設定頁顯示「已連線」，按「同步跑步紀錄」。
6. 系統讀取最近 100 筆活動，匯入跑步與健走；使用 Strava 活動 ID 去重。重訓等其他活動不會被匯入。

## 隱私與安全

- Client Secret、OAuth refresh token、access token 均儲存在 Cloudflare Worker/Workers KV 後端，從未暴露於靜態網站。
- 前端只保存一組 256-bit 專屬連線金鑰在瀏覽器的 localStorage，不包含 Strava refresh token；因此仍須避免不可信的瀏覽器擴充功能及 XSS。
- Strava 回跳 URL 用 `#` 片段傳遞單次連線金鑰，網站會即時清除網址片段；並比對瀏覽器 sessionStorage 中發出的隨機 nonce。
- 「解除連線」會請後端向 Strava 撤銷授權，成功後刪除 KV session；前端仍保留已匯入的運動紀錄。若遠端撤銷失敗，系統會提示失敗；可至 Strava「我的應用程式」手動撤銷。
- 此 MVP 沒有跨裝置雲端同步：跑步資料仍儲存在**目前瀏覽器**，不同裝置需要重新授權及同步。建議定期使用設定中的「複製備份」。
- Strava 新建立的應用程式依 2026 年文件有使用者數與 API rate-limit 的限制，商用前應閱讀並遵守其審核、資料使用與 webhook 規定。

參考：[Strava 官方 OAuth 文件](https://developers.strava.com/docs/authentication/) / [Getting Started](https://developers.strava.com/docs/getting-started/)。
