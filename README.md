# 起名斋 · 多模型 AI 起名平台

Vercel Serverless + 手写 SSE 流式输出 + Supabase 历史记录，一套代码切换豆包 / DeepSeek / 通义千问 / Kimi 四家模型。

## 目录结构

```
├── api/
│   ├── name.js        # 核心：modelConfigMap + 共用调用代码 + SSE 转发 + 落库
│   └── history.js     # GET 最近历史记录
├── scripts/
│   ├── dev-server.js  # 本地开发服务器（不需要 vercel CLI）
│   └── mock-upstream.js  # 假的大模型上游，没密钥也能联调
├── supabase/
│   └── schema.sql     # 建表 SQL（含调试/正式两套权限方案）
├── index.html         # 前端单页
├── .env.example       # 环境变量模板（复制为 .env 后填写）
└── 实验报告.md
```

## 快速开始

```bash
npm install
cp .env.example .env    # 填入你的密钥（至少一个模型的）
npm run dev             # 打开 http://localhost:3000
```

> 还没拿到密钥？可以先用 mock 验证链路：
> 终端 1 运行 `npm run mock`，终端 2 在 `.env` 里写
> `DOUBAO_API_KEY=mock-key` 和 `DOUBAO_BASE_URL=http://127.0.0.1:4010/api/v1`，
> 然后 `npm run dev`。页面会"流式"吐出预置的三个名字。
> 拿到真密钥后，删掉 .env 里的 DOUBAO_BASE_URL 那一行即可。

也可以用 Vercel 官方 CLI 跑（和线上一致）：`npx vercel dev`。

## 环境变量

| 变量 | 说明 |
| --- | --- |
| `SUPABASE_URL` / `SUPABASE_ANON_KEY` | Supabase 项目地址与匿名密钥 |
| `SUPABASE_SERVICE_ROLE_KEY` | 可选，正式上线用，服务端绕过 RLS |
| `DOUBAO_API_KEY` + `DOUBAO_MODEL` | 火山方舟（MODEL 填推理接入点 ID） |
| `DEEPSEEK_API_KEY` | DeepSeek |
| `QWEN_API_KEY` | 通义千问 DashScope |
| `KIMI_API_KEY` | Kimi / Moonshot |
| `*_BASE_URL` | 可选，覆盖接口地址（走代理 / mock 联调） |

## 一键发布

```bash
# 只推到 GitHub（建仓库 + 推送一次完成，令牌不写入 .git/config）
GH_TOKEN=ghp_xxx bash scripts/publish.sh

# 连 Vercel 一起（自动读取 .env 配置环境变量后部署）
GH_TOKEN=ghp_xxx VERCEL_TOKEN=xxx bash scripts/publish.sh
```

没有令牌也可以：先 `gh auth login`，再 `bash scripts/publish.sh`。

## 部署到 Vercel（网页导入）

1. 确认 `.env` 在 `.gitignore` 里（本仓库已配置）；
2. 推送到 GitHub；
3. Vercel → Add New Project → 导入该仓库；
4. Settings → Environment Variables，把 `.env` 里每一项都填一遍；
5. Deploy，拿到公网地址。

## 数据库

执行 `supabase/schema.sql`。权限方案见文件内注释：

- **调试期**：放开 anon 插入/读取两条策略，方便课堂上快速验证；
- **正式上线**：删掉 anon 策略，服务端改用 `SUPABASE_SERVICE_ROLE_KEY`（RLS 保持开启），数据库不对浏览器暴露。
