# 小满伴学 · AI 陪伴学习硬件 MVP（可部署版）

一个可运行、可部署的「小满伴学」家长端 App 原型后端：

- 前端：`public/index.html`（单文件，自包含，无外部脚本/字体依赖）
- 后端：`server.js`（Express，调用讯飞星火 X2.6-4B，走星辰 MaaS 的 OpenAI 兼容 HTTP 接口）
- 接口：`/api/chat`（流式对话）、`/api/check/regenerate`（学习验收「换一个」重新生成问题）、`/api/health`（健康检查）

## 本地运行

1. 安装依赖

```bash
npm install
```

2. 配置凭证（可选，不配也能跑「演示模式」）

复制 `.env.example` 为 `.env`，填入星辰 MaaS 的 `SPARK_API_KEY`；或直接用环境变量：

```bash
# PowerShell
$env:SPARK_API_KEY="ak-你的apikey"
```

3. 启动

```bash
npm start
```

打开 http://localhost:3000 即可看到 App 原型。进入「伴学」页，在输入框打字并回车，即可与真实星火大模型对话（未配凭证时进入演示模式）。

## 部署到云端

### Render（最简单，推荐）

1. 把整个项目推到 GitHub。
2. Render 点 New → Web Service → Connect to Git → 选择仓库。
3. 确认 Build Command 为 `npm install`，Start Command 为 `npm start`。
4. 在 Environment 里添加 1 个变量：`SPARK_API_KEY` = `ak-03a574484c16cb932c38cf069b505b09`。
5. 点 Deploy，状态变 Live 后得到 `*.onrender.com` 网址。

## 讯飞星火 X2.6-4B 接口说明（星辰 MaaS）

- 接口地址：`https://maas-api.cn-huabei-1.xf-yun.com/v1/chat/completions`
- 模型：`spark-x2.6-4b`
- 鉴权：`Authorization: Bearer <SPARK_API_KEY>`（ak- 开头的 Key）
- 请求体为 OpenAI 兼容格式：`model`、`messages`、`max_tokens`、`temperature`、`thinking: { type: "disabled" }`
- 响应取 `choices[0].message.content`；`thinking` 关闭后跳过推理过程，直接返回正文，响应更快。
- 凭证获取：登录 https://maas.xfyun.cn 模型广场，领取「Spark-X2.6-4B（限时免费）」后创建应用，获取 API Key。

## 前端与后端的约定

- 前端通过 `POST /api/chat`，body：`{ "messages": [{ "role": "user", "content": "..." }, ...] }`。
- 后端返回 SSE：`data: {"delta":"片段"}`，结束 `data: {"done":true}`。
- 前端对网络失败有兜底，不会白屏。
