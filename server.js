/**
 * 小满伴学 · 后端服务（星辰 MaaS · 讯飞星火 X2.6-4B 版）
 * - 提供静态前端 (public/index.html)
 * - /api/chat          : 星火 X2.6-4B 对话 (SSE 模拟打字机)
 * - /api/check/regenerate : 学习验收「换一个」重新生成问题 (JSON)
 * - /api/health        : 健康检查
 *
 * 通过环境变量配置星辰 MaaS 凭证：
 *   SPARK_API_KEY     必填，ak- 开头的 API Key
 *   SPARK_MODEL       选填，默认 spark-x2.6-4b
 *   SPARK_API_BASE    选填，默认 https://maas-api.cn-huabei-1.xf-yun.com/v1
 *   SPARK_MAX_TOKENS / SPARK_TEMPERATURE / PORT
 *
 * 未配置 SPARK_API_KEY 时，/api/chat 会返回「演示模式」说明，便于先跑通前端与部署链路。
 */

const express = require('express');
const path = require('path');

const app = express();
app.use(express.json({ limit: '2mb' }));
app.use(express.static(path.join(__dirname, 'public')));

const PORT = process.env.PORT || 3000;

const SPARK_API_KEY = process.env.SPARK_API_KEY || '';
const SPARK_MODEL = process.env.SPARK_MODEL || 'spark-x2.6-4b';
const SPARK_API_BASE = (process.env.SPARK_API_BASE || 'https://maas-api.cn-huabei-1.xf-yun.com/v1').replace(/\/+$/, '');
const SPARK_MAX_TOKENS = Number(process.env.SPARK_MAX_TOKENS || 2048);
const SPARK_TEMPERATURE = Number(process.env.SPARK_TEMPERATURE || 0.7);
const SPARK_ENABLED = !!SPARK_API_KEY;

/* ---------------- 系统提示词 ---------------- */

const SYSTEM_PROMPT = [
  '你是「小满伴学」App 里的 AI 助手，名字叫「小满」，用温暖、亲切、有同理心的语气和家长对话，帮助家长为孩子（默认叫“子涵”，男孩，8 岁，二年级）制定个性化的每日学习计划。',
  '',
  '流程要求：',
  '1. 用语音为主的方式引导家长提供：孩子年龄、年级、性别、兴趣爱好（人物/IP/音乐/书籍）、正在上的兴趣班、培养期望。若家长一次性提供多项，直接确认并跳过已提供项。',
  '2. 信息不足时温和追问，每次只问一个最关键的问题，不要让家长感到繁琐。',
  '3. 信息齐全后给出四个学习方向：①阅读能力（按年龄+兴趣推荐书籍与每日阅读时长）；②计算能力（结合学校任务，安排每日时长）；③口语陪练（按孩子英语水平扮演英语老师，先听后互动，内容同步学校教材并适当扩展）；④其他（兴趣习惯打卡等）。',
  '4. 用简洁、有条理的方式呈现，并询问家长是否确认或需要调整。',
  '',
  '表达要求：',
  '- 语言自然、口语化，像一位懂教育的朋友，不要用生硬清单和过度客套。',
  '- 家长输入较短时用 2-4 句话回应，信息齐全后再完整输出计划。',
  '- 不编造具体书籍价格或链接，推荐书目可按题材/难度描述。'
].join('\n');

const CHECK_SYSTEM_PROMPT = [
  '你是「小满伴学」的 AI 助手。根据给定的“生成依据”（学习验收结果、孩子情绪、成长阶段），为家长生成一个适合今晚和孩子聊的亲子互动问题。',
  '要求：',
  '- 只输出一个问题，语气亲切自然，适合 8 岁孩子。',
  '- 问题要能引发孩子主动表达，不要问“你今天学了什么”这类封闭式问题。',
  '- 控制在 1-2 句话，不要加额外说明。'
].join('\n');

/* ---------------- 星辰 MaaS 调用 ---------------- */

async function callSpark(messages, { systemPrompt = SYSTEM_PROMPT } = {}) {
  if (!SPARK_ENABLED) {
    throw new Error('SPARK_DISABLED');
  }

  // 系统消息必须放在最前
  const text = [
    { role: 'system', content: systemPrompt },
    ...messages
  ];

  const url = `${SPARK_API_BASE}/chat/completions`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${SPARK_API_KEY}`
    },
    body: JSON.stringify({
      model: SPARK_MODEL,
      messages: text.map((m) => ({ role: m.role, content: m.content })),
      max_tokens: SPARK_MAX_TOKENS,
      temperature: SPARK_TEMPERATURE,
      thinking: { type: 'disabled' }
    })
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`Spark HTTP ${res.status}: ${errText.slice(0, 300)}`);
  }

  const data = await res.json();
  const choice = data?.choices?.[0];
  // 优先取正文 content；若为空则退回 reasoning_content（推理过程）
  const content = choice?.message?.content || choice?.message?.reasoning_content || '';
  return content;
}

/* ---------------- 接口 ---------------- */

app.get('/api/health', (req, res) => {
  res.json({
    ok: true,
    service: 'xiaoman-ai',
    model: SPARK_MODEL,
    spark_configured: SPARK_ENABLED,
    api_base: SPARK_API_BASE
  });
});

app.post('/api/chat', async (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  const send = (payload) => {
    res.write(`data: ${JSON.stringify(payload)}\n\n`);
  };

  const messages = Array.isArray(req.body?.messages) ? req.body.messages : [];

  if (!SPARK_ENABLED) {
    const reply =
      '[演示模式] 后端尚未配置星辰 MaaS 凭证（SPARK_API_KEY），当前不会调用真实大模型。\n' +
      '请设置环境变量 SPARK_API_KEY 后重启服务，即可启用真实 AI 对话。\n\n' +
      '（这句话来自后端演示回退逻辑，说明部署链路已通。）';
    send({ delta: reply });
    send({ done: true });
    return res.end();
  }

  try {
    // 先发一个开始标记，便于前端展示“正在思考”
    send({ delta: '' });
    const reply = await callSpark(messages, {});
    // 逐字下发，模拟打字机效果（MVP 友好）
    for (let i = 0; i < reply.length; i += 6) {
      send({ delta: reply.slice(i, i + 6) });
      await new Promise((r) => setTimeout(r, 25));
    }
    send({ done: true });
    res.end();
  } catch (err) {
    send({
      error:
        'AI 服务暂时不可用：' +
        (err && err.message ? err.message : '未知错误')
    });
    res.end();
  }
});

app.post('/api/check/regenerate', async (req, res) => {
  const index = Number(req.body?.index || 0);
  const context = req.body?.context || '';

  if (!SPARK_ENABLED) {
    return res.json({
      question:
        '[演示模式] 当前未配置星辰 MaaS 凭证。配置后「换一个」将由大模型实时重新生成亲子互动问题。'
    });
  }

  const prompt = `${CHECK_SYSTEM_PROMPT}\n生成依据：${context || '学习验收结果、孩子情绪、成长阶段'}\n请针对第 ${index + 1} 个互动方向生成一个问题。`;
  try {
    const reply = await callSpark([{ role: 'user', content: prompt }], {
      systemPrompt: CHECK_SYSTEM_PROMPT
    });
    res.json({ question: reply.trim() || '[未生成内容]' });
  } catch (err) {
    res.status(502).json({
      question: '重新生成失败：' + (err && err.message ? err.message : '未知错误')
    });
  }
});

/* ---------------- 启动 ---------------- */

app.listen(PORT, () => {
  console.log(`小满伴学后端已启动：http://localhost:${PORT}`);
  console.log(`星辰 MaaS：${SPARK_ENABLED ? '已启用' : '未启用（演示模式）'}`);
  if (SPARK_ENABLED) {
    console.log(`  model=${SPARK_MODEL}`);
    console.log(`  api_base=${SPARK_API_BASE}`);
  }
});

module.exports = app;
