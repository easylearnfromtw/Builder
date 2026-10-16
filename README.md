# 健人｜哲愷訓練日誌

個人化重訓及跑步日誌，採用純前端 HTML/CSS/JavaScript。正式網址（需先開啟 GitHub Pages）：https://easylearnfromtw.github.io/Builder/

## GitHub Pages

在儲存庫 **Settings → Pages → Build and deployment** 選 **Deploy from a branch**，選 `main` / `/(root)` 並儲存。部署完成後由上面網址開啟，請勿用 `/index.html` 以外的其他任意路徑。

## Strava 串聯

在網站右上角 **設定與備份 → 串聯 Strava → 第一次使用？展開 Strava 串聯教學** 有完整操作流程。

GitHub Pages 是公開靜態網站，無法安全保管 Strava Client Secret，因此須另外部署專案的 `strava-worker/` 至 Cloudflare Worker。請依 [Strava 後端部署說明](strava-worker/README.md) 設定 API App、Worker KV、機密環境變數。建立後，在健人設定頁填入 Worker 網址，再進行官方 OAuth 授權及活動同步。**在 Worker 尚未部署之前，不會自動完成 Strava 串聯。**

訓練資料存在目前瀏覽器的 localStorage；請定期在設定中備份。
