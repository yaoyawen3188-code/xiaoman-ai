# 小满伴学 · 部署上线指南

目标：把后端 + 前端一起部署到 Render，并接上讯飞星火 X2.6-4B 真实大模型。

## 第一步：确认大模型凭证（已经可用）

代码走的是**星辰 MaaS**（https://maas.xfyun.cn）的「Spark-X2.6-4B（限时免费）」模型，
只需要一个环境变量：

- `SPARK_API_KEY` = `ak-03a574484c16cb932c38cf069b505b09`

如果你以后在星辰模型广场重新创建了应用，把 Key 换成新的即可，代码不用改。

## 第二步：把项目推到 GitHub

Render 只能从 Git 仓库部署，不支持直接上传 zip。

### 方式 A：你手动上传（最简单）

1. 用本项目目录下的 `xiaoman-ai-deploy.zip`（已排除 `node_modules`）。
2. 打开 https://github.com/new 创建新仓库，例如 `xiaoman-ai`。
3. 选择「Upload zip」，上传刚才的 zip。
4. 记录仓库地址：`https://github.com/<你的用户名>/xiaoman-ai.git`。

### 方式 B：我代推（需要你提供 GitHub 凭证）

给我一个 GitHub Personal Access Token（repo 权限）+ 你的 GitHub 用户名，
我用 API 直接建仓库并推送，无需你手动操作。

## 第三步：部署到 Render

1. 打开 https://render.com 并登录。
2. 点 **New → Web Service**。
3. 在「Connect to Git」里选择刚才的仓库。
4. Render 会自动识别为 Node 项目，确认：
   - Build Command：`npm install`
   - Start Command：`npm start`
5. 在 **Environment** 里添加 1 个变量：
   - `SPARK_API_KEY` = `ak-03a574484c16cb932c38cf069b505b09`
6. 点 **Deploy**，等待几秒，状态变 `Live` 后会得到一个 `*.onrender.com` 网址。
7. 打开网址 → 进入「伴学」页 → 输入文字回车，即可与真实星火大模型对话。

## 本地验证（可选）

```powershell
$env:SPARK_API_KEY="ak-03a574484c16cb932c38cf069b505b09"
npm start
```

访问 http://localhost:3000 ，进入「伴学」页对话，即可验证真实大模型效果。
