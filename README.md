# Only Us Memory Cabin

双人照片网站：上传照片、持久保存、日期和文字、点评、提醒倒计时、专属密码、游客公开窗口。

## 本地运行

```powershell
cd C:\Users\86187\Documents\Codex\2026-06-15\ui-2\outputs\couple-memory-site
npm.cmd install
npm.cmd start
```

打开 `http://127.0.0.1:8899`，密码：`159951`。

## 公网部署最简单方案：Render

1. 新建 GitHub 仓库，把本目录代码上传。
2. 打开 Render，新建 Web Service，选择该仓库。
3. 使用 Docker 部署，仓库里已有 `Dockerfile`。
4. 添加持久磁盘，挂载路径 `/data`。
5. 环境变量：
   - `DATA_DIR=/data`
   - `COUPLE_SITE_PASSWORD=159951`
   - `SESSION_SECRET=换成一串长随机字符`
6. 部署完成后访问 Render 给你的公网地址。

不要部署到 GitHub Pages 这种纯静态平台，因为上传照片不能持久保存。
