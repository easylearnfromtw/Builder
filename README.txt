哲愷訓練日誌（純前端）

使用方式：直接用瀏覽器打開 index.html 即可，不需要安裝或伺服器。
也可以把整個資料夾放到 GitHub Pages、Netlify 等靜態網站空間。

資料只存在你使用的瀏覽器裡（localStorage）。
換裝置或清除瀏覽資料前，請到右上「設定」按「複製備份」保存，之後可貼回或用檔案匯入還原。
字型需要網路連線（Google Fonts），離線時會改用系統字型。

iPhone 加到主畫面：把資料夾放到網站空間後，用 Safari 打開網址，點分享 → 「加入主畫面」，
之後就會像 App 一樣全螢幕開啟、有自己的圖示。（直接從「檔案」App 打開 index.html 無法加到主畫面）
注意：加到主畫面後的紀錄和 Safari 裡的紀錄是分開保存的，請在同一個地方記錄，或用備份搬移。

地點與天氣：輸入地點或按「目前位置」後，會用 Open-Meteo（免金鑰）自動帶入當時的天氣。
這需要網路：放在自己的網址（GitHub Pages、Netlify 等）或加到主畫面後就會運作；
「目前位置」需要 https 網址並允許定位。


Strava 串聯（新增）：
- 右上角「設定與備份」→「串聯 Strava」→「第一次使用？展開 Strava 串聯教學」。
- 若網站已設置安全 Cloudflare Worker，填入 Worker 網址並儲存，即可點「連結 Strava」進入官方授權畫面。
- 回到健人後按「同步跑步紀錄」可匯入最近 100 筆 Strava 活動中的跑步／健走（依 Strava ID 去重）。
- 請注意：單靠 GitHub Pages 不能完成 Strava OAuth；必須另外部署 strava-worker/，並將 Client Secret 放在 Worker 機密環境變數中。設定詳見 strava-worker/README.md。
- 在你部署 Worker 與建立 Strava API 應用程式之前，網站不會顯示「已連線」的假狀態。
- 匯入的跑步紀錄仍儲存在瀏覽器 localStorage，未提供跨裝置自動同步。
