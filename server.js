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

// 小满伴学后端 - AI 陪伴学习硬件 MVP
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
  '重要规则：当家长说「去掉X」时，你必须回复「已去掉X」。当家长说「不要X」时，你必须回复「好的，已去掉X」。当家长说「把X改成Y」时，你必须回复「已调整好」。绝对不要输出完整的学习计划，只回复1-3句话确认。',
  '',
  '你是「小满伴学」App 里的 AI 助手，名字叫「小满」，用温暖、亲切、有同理心的语气和家长对话，帮助家长为孩子制定个性化的每日学习计划。',
  '',
  '孩子默认叫「子涵」，男孩，8 岁，二年级。以家长实际提供的信息为准，如果家长没说，就按默认值理解。',
  '',
  '核心要求：',
  '1. 认真阅读家长说的每一句话，记住家长已经提供的信息（年龄、年级、性别、兴趣、IP、书籍、音乐、兴趣班、培养期望等），绝对不要重复询问已经提供过的内容。',
  '2. 不要机械地分步骤逐项追问。家长一次性提供多项信息时，直接确认并继续，不要再逐个追问。',
  '3. 直接响应家长的要求：家长要推荐书籍就推荐书籍，要加任务就加任务，要调整时长就调整时长。不要绕弯子，不要反问。',
  '4. 如果家长信息确实不完整，需要补充时，温和地一次问一个问题即可。',
  '',
  '书籍推荐规则：',
  '- 当家长要求推荐书籍时，给出 3-5 本适合该年龄段且符合孩子兴趣的课外书。',
  '- 每本书必须用中文书名号《》标注书名，并在书名后加一句简短推荐理由，例如：「《神奇校车·水的故事》——孩子熟悉题材，科学启蒙」。',
  '- 不要编造价格或链接，只给书名和理由。',
  '',
  '学习方向规则：',
  '- 当家长确认信息或要求给出方向时，从以下方向中选择并展开：阅读能力、计算能力、口语陪练、学习天天练、其他兴趣习惯。',
  '- 具体展开哪些方向以家长需求为准，不固定输出四个。',
  '- 每个方向用一句话说明重点，家长要求安排时长时再给时长。',
  '',
  '时间范围：学习任务安排在放学后 17:30 到睡前 21:30，中间预留晚饭、休息和睡前洗漱时间。',
  '',
  '表达要求：',
  '- 语言自然、口语化，像一位懂教育的朋友，不要用生硬清单和过度客套。',
  '- 家长输入较短时用 2-4 句话回应，家长要求完整方案时再完整输出。'
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

/* ---------- 家长明确指定时长的确定性兜底 ----------
   大模型有时会为了总时长平衡，把家长明确要求的「1 小时」改成 30 分钟。
   这里在返回前做一次确定性校正：从家长要求中解析时长，并把匹配到的任务
   min 改成家长说的时间。 */
function cnToInt(s){
  if (!s) return null;
  if (/^\d+$/.test(s)) return parseInt(s, 10);
  const map = { 零:0, 一:1, 二:2, 两:2, 三:3, 四:4, 五:5, 六:6, 七:7, 八:8, 九:9, 十:10 };
  if (s.length === 1) return map[s] === undefined ? null : map[s];
  if (s.indexOf('十') >= 0) {
    const parts = s.split('十');
    const tens = parts[0] ? map[parts[0]] : 1;
    const ones = parts[1] ? map[parts[1]] : 0;
    return tens * 10 + ones;
  }
  return null;
}

function normalizeDurationText(min){
  if (min >= 60 && min % 60 === 0) return (min / 60) + ' 小时';
  if (min >= 60) return Math.floor(min / 60) + ' 小时 ' + (min % 60) + ' 分钟';
  return min + ' 分钟';
}

function parseRequestedDuration(text){
  const s = (text || '').trim();
  if (!s) return null;

  // 一个半小时 / 两个半小时
  let m = s.match(/([一二两三四五六七八九十]+)?半\s*小时/);
  if (m) {
    const base = cnToInt(m[1] || '一');
    if (base) return { min: Math.round((base + 0.5) * 60), unit: '小时' };
  }

  m = s.match(/(\d+|[一二两三四五六七八九十]+)\s*(?:个)?\s*小时/);
  if (m) {
    const n = cnToInt(m[1]);
    if (n) return { min: n * 60, unit: '小时' };
  }

  m = s.match(/(\d+|[一二两三四五六七八九十]+)\s*(?:个)?\s*分钟/);
  if (m) {
    const n = cnToInt(m[1]);
    if (n) return { min: n, unit: '分钟' };
  }

  m = s.match(/(\d+|[一二两三四五六七八九十]+)\s*(?:个)?\s*min/i);
  if (m) {
    const n = cnToInt(m[1]);
    if (n) return { min: n, unit: 'min' };
  }

  return null;
}

function taskMatchScore(task, request){
  const name = String(task.name || '');
  const desc = String(task.desc || '');
  const haystack = name + ' ' + desc;
  const candidates = [];

  for (const part of name.split(/[\s·，,、\-—:：/|]+/)) {
    if (part.length >= 2) candidates.push(part);
  }

  if (/天天练|数学练习|每日练习|每日练/.test(haystack)) {
    candidates.push('数学天天练', '学习天天练', '天天练', '数学练习');
  }
  if (/阅读|书单|书籍|绘本/.test(haystack)) {
    candidates.push('阅读', '书单', '书籍', '绘本');
  }
  if (/计算|口算|算术/.test(haystack)) {
    candidates.push('计算', '口算', '算术');
  }
  if (/口语|英语|陪练|跟读/.test(haystack)) {
    candidates.push('口语', '英语', '陪练', '跟读');
  }
  if (/钢琴|围棋|兴趣|运动|习惯/.test(haystack)) {
    candidates.push('钢琴', '围棋', '兴趣', '运动', '习惯');
  }

  let best = 0;
  for (const c of candidates) {
    if (request.indexOf(c) >= 0 && c.length > best) best = c.length;
  }
  return best;
}

function applyRequestedDurationToTasks(parsed, request){
  if (!parsed || !Array.isArray(parsed.tasks)) return { changed: false };
  const duration = parseRequestedDuration(request);
  if (!duration) return { changed: false };

  let bestIndex = -1;
  let bestScore = 0;
  parsed.tasks.forEach((task, i) => {
    const score = taskMatchScore(task, request);
    if (score > bestScore) {
      bestScore = score;
      bestIndex = i;
    }
  });

  if (bestIndex < 0) return { changed: false };
  const task = parsed.tasks[bestIndex];
  const min = Math.max(10, Math.min(60, duration.min));
  task.min = min;

  if (task.desc) {
    task.desc = String(task.desc).replace(/\d+(\.\d+)?\s*(?:个)?\s*(小时|分钟|min)/gi, normalizeDurationText(min));
  }

  return { changed: true, taskName: task.name || '该任务', min };
}

/* 学习计划 · 家长确认页「输入即调整」：基于当前计划 + 家长要求，由大模型重新安排并返回 JSON */
app.post('/api/plan/adjust', async (req, res) => {
  const plan = (req.body?.plan || '').trim();
  const request = (req.body?.request || '').trim();

  if (!SPARK_ENABLED) {
    return res.json({
      reply: '[演示模式] 后端尚未配置星辰 MaaS 凭证，暂不能实时调整计划。',
      tasks: []
    });
  }

  const PLAN_ADJUST_SYSTEM_PROMPT = [
    '你是「小满伴学」的 AI 计划调整助手。家长已经提供过孩子基础信息，这里只做计划调整，不需要再收集任何基础信息。',
    '请直接在原计划基础上，结合家长的要求，输出调整后的当日学习计划。不要反问，不要向家长索要更多信息，不要寒暄。',
    '时间框架（必须严格遵守）：',
    '- 放学后 17:30 到睡前 21:30，共 240 分钟。',
    '- 固定安排：17:30-17:45 放学休息、18:30-19:00 晚饭、19:00-19:15 餐后休息、21:00-21:30 睡前洗漱。',
    '- 因此学习/兴趣任务的总时长不超过 150 分钟，每项时长 10-60 分钟。',
    '- 学习任务安排在 17:45-18:30（晚饭前）和 19:15-21:00（晚饭后）两段。',
    '- tasks 只放学习/兴趣类任务（阅读、计算、口语、兴趣班、家长新加任务等），不要把晚饭、休息、洗漱放进 tasks。',
    '- 家长明确要加的新任务必须加入；家长要求调整时长的，必须按新时长调整。',
    '- 家长明确指定的任务时长优先：家长说 1 小时，该任务 min 必须是 60；家长说 30 分钟，min 必须是 30。不得为了凑总时长而压缩家长明确指定的任务，应优先压缩其他任务或调整顺序。',
    '- 原计划中已有任务的名称和类型尽量保留，不要改名叫「任务一/任务二」。',
    '- reply 只能是简短确认，不超过 30 个字。例如「已按你的要求调整好计划，请确认」。',
    '- reply 不要重复家长说的内容，不要引用之前的沟通内容，不要列出计划明细，不要解释调整原因。',
    '- reply 不要反问、不要寒暄、不要请求更多信息、不要输出任何多余文字。',
    '- 只输出 JSON，格式为：{"reply":"对家长的一句话回复","tasks":[{"name":"任务名","icon":"emoji图标","desc":"一句话说明","min":分钟数,"beforeDinner":true或false}]}',
    '- 不要输出 JSON 之外的任何文字。'
  ].join('\n');

  const userPrompt = `当前计划：\n${plan || '（暂无）'}\n\n家长调整要求：\n${request}`;

  try {
    const reply = await callSpark(
      [{ role: 'user', content: userPrompt }],
      { systemPrompt: PLAN_ADJUST_SYSTEM_PROMPT }
    );
    const jsonMatch = reply.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      if (!Array.isArray(parsed.tasks)) parsed.tasks = [];
      const applied = applyRequestedDurationToTasks(parsed, request);
      return res.json({
        reply: applied.changed
          ? `已将「${applied.taskName}」调整为 ${normalizeDurationText(applied.min)}，请确认。`
          : (parsed.reply || '已按你的要求调整好计划。'),
        tasks: parsed.tasks
      });
    }
    return res.json({ reply: reply.trim(), tasks: [] });
  } catch (err) {
    return res.status(502).json({
      reply: '调整失败：' + (err && err.message ? err.message : '未知错误'),
      tasks: []
    });
  }
});

/* 积分商城 · 新增兑换商品：AI 生成匹配图片（Pollinations.ai 免费文生图） */
app.post('/api/reward/add', async (req, res) => {
  const name = (req.body?.name || '').trim();
  const cost = Number(req.body?.cost || 0);
  if (!name) return res.status(400).json({ error: '请填写商品名称' });

  let prompt;
  if (SPARK_ENABLED) {
    try {
      prompt = await callSpark(
        [{ role: 'user', content: `请为以下儿童积分商城商品写一个英文AI画图提示词，用于生成可爱的卡通风格商品图。只输出英文提示词本身，不要其他内容。商品：${name}` }],
        { systemPrompt: '你是图片生成提示词助手。根据中文商品名称，输出一个适合AI画图的英文提示词，描述一个可爱的卡通风格儿童积分商城商品图片，简洁背景。只输出英文提示词，不要任何其他内容。' }
      );
      prompt = (prompt || '').trim();
    } catch {
      prompt = '';
    }
  }
  if (!prompt) {
    prompt = `a cute cartoon sticker of ${name}, child-friendly, colorful, simple background, high quality`;
  }

  const encodedPrompt = encodeURIComponent(prompt).replace(/'/g, '%27').replace(/"/g, '%22');
  const imageUrl = `https://image.pollinations.ai/prompt/${encodedPrompt}?width=512&height=512&nologo=true`;

  return res.json({
    id: 'rw' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5),
    name,
    cost,
    image: imageUrl
  });
});

/* 伴学 · AI 创建可交互学习活动应用 */
app.post('/api/app/create', async (req, res) => {
  const instructions = (req.body?.instructions || '').trim();
  if (!instructions) {
    return res.status(400).json({ error: '请输入活动指令' });
  }

  if (!SPARK_ENABLED) {
    return res.json({
      type: 'oral',
      title: '口语练习 · 示例活动',
      subtitle: '同步学校教材，AI 老师陪练口语',
      content: instructions,
      difficulties: [
        { level: '低', desc: '课文内容', items: [{ en: 'Hello! What\'s your name?', zh: '你好！你叫什么名字？' }] },
        { level: '中', desc: '场景衍生', items: [{ en: 'Nice to meet you!', zh: '很高兴认识你！' }] },
        { level: '高', desc: '拓展内容', items: [{ en: 'Where are you from?', zh: '你来自哪里？' }] }
      ],
      duration: 15,
      icon: '🗣️'
    });
  }

  const APP_SYSTEM_PROMPT = [
    '你是「小满伴学」的 AI 活动创建助手。根据家长的描述，创建一个可交互的学习活动应用规格，用于在设备端运行。',
    '',
    '活动类型（type）可选：',
    '- oral：口语练习（英语跟读/对话，含英文句子和中文翻译）',
    '- reading：阅读理解（含阅读材料和问题）',
    '- quiz：知识问答（含问题和选项）',
    '- other：其他互动活动',
    '',
    '难度（difficulties）规则：',
    '- 默认三个难度：低、中、高',
    '- 低：完全以课文/基础内容为主',
    '- 中：适当增加场景衍生，联系前后内容',
    '- 高：增加教材外的拓展内容',
    '- 每个难度下要有 3-5 条具体内容（items），oral 类型每条包含 en（英文）和 zh（中文翻译）',
    '',
    '输出 JSON 格式（只输出 JSON，不要其他内容）：',
    '{"type":"oral","title":"活动标题","subtitle":"一句话副标题，不超过40个字","content":"内容描述","difficulties":[{"level":"低","desc":"说明","items":[{"en":"英文句子","zh":"中文翻译"}]},{"level":"中","desc":"说明","items":[]},{"level":"高","desc":"说明","items":[]}],"duration":15,"icon":"🗣️"}',
    '',
    '要求：',
    '- subtitle：一句话副标题，不超过40个字，概括活动亮点或学习目标',
    '- 内容要真实、适合对应年级的教材内容',
    '- 英文句子要地道、口语化',
    '- 如果家长没有指定教材，按小学中年级水平生成'
  ].join('\n');

  try {
    const reply = await callSpark(
      [{ role: 'user', content: instructions }],
      { systemPrompt: APP_SYSTEM_PROMPT }
    );

    const jsonMatch = reply.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const raw = jsonMatch[0];
      let spec;
      try {
        spec = JSON.parse(raw);
      } catch (parseErr) {
        // AI 返回的 JSON 可能有格式问题，尝试修复
        spec = repairJson(raw);
        if (!spec) {
          return res.status(500).json({ error: 'AI 返回的 JSON 格式有误，请换一种描述方式重试' });
        }
      }
      // 规范化
      if (!spec.type) spec.type = 'oral';
      if (!spec.title) spec.title = '学习活动';
      if (!spec.subtitle) spec.subtitle = (spec.title || '学习活动') + '，趣味互动学习';
      if (!spec.content) spec.content = instructions;
      if (!Array.isArray(spec.difficulties)) spec.difficulties = [];
      if (!spec.duration) spec.duration = 15;
      if (!spec.icon) spec.icon = '🎮';
      return res.json(spec);
    }
    return res.status(500).json({ error: 'AI 未能生成有效规格，请换一种描述方式' });
  } catch (err) {
    return res.status(502).json({
      error: '活动创建失败：' + (err && err.message ? err.message : '未知错误')
    });
  }
});

/* 修复 LLM 返回的不规范 JSON */
function repairJson(raw) {
  if (!raw) return null;
  try {
    // 1. 单引号 → 双引号（但要小心字符串内的引号）
    let s = raw;
    // 2. 属性名不加引号：{type:'oral'} → {"type":"oral"}
    //    匹配 { 或 , 后面跟字母/下划线，再跟 :
    s = s.replace(/([{,]\s*)([a-zA-Z_][a-zA-Z0-9_]*)\s*:/g, '$1"$2":');
    // 3. 字符串值用单引号：'oral' → "oral"
    //    只处理属性值位置的单引号
    s = s.replace(/:\s*'([^']*)'/g, ': "$1"');
    // 4. 去掉末尾多余的逗号
    s = s.replace(/,\s*}/g, '}');
    s = s.replace(/,\s*]/g, ']');
    // 5. 处理嵌套对象里的属性名（递归修复）
    //    先尝试解析，如果失败再尝试更激进的修复
    return JSON.parse(s);
  } catch (e) {
    // 尝试更激进的修复：把所有单引号字符串替换为双引号
    try {
      let s = raw;
      // 更宽松的属性名匹配
      s = s.replace(/([{,]\s*)([a-zA-Z_][a-zA-Z0-9_]*)\s*:/g, '$1"$2":');
      // 更宽松的字符串值匹配
      s = s.replace(/:\s*'([^']*)'/g, ': "$1"');
      s = s.replace(/:\s*`([^`]*)`/g, ': "$1"');
      s = s.replace(/,\s*}/g, '}');
      s = s.replace(/,\s*]/g, ']');
      return JSON.parse(s);
    } catch (e2) {
      return null;
    }
  }
}

/* 伴学 · AI 为已创建活动生成简短命名和简介 */
app.post('/api/app/describe', async (req, res) => {
  const spec = req.body?.spec || {};
  if (!spec.title && !spec.content) {
    return res.status(400).json({ error: '缺少活动信息' });
  }

  if (!SPARK_ENABLED) {
    const title = (spec.title || '学习活动').substring(0, 10);
    const desc = (spec.content || '').substring(0, 30);
    return res.json({ shortName: title, shortDesc: desc, subtitle: (spec.subtitle || '').substring(0, 40) });
  }

  const DESCRIBE_SYSTEM_PROMPT = [
    '你是「小满伴学」的 AI 活动命名助手。根据活动规格，生成活动名称、一句话副标题和一句话简介。',
    '',
    '要求：',
    '- shortName：不超过 10 个字，简洁有力，适合在列表中显示',
    '- subtitle：不超过 40 个字，概括活动亮点或学习目标，适合作为副标题展示',
    '- shortDesc：不超过 30 个字，概括活动内容',
    '- 不要输出任何其他内容，只输出 JSON',
    '',
    '输出格式：{"shortName":"名称","subtitle":"副标题","shortDesc":"简介"}'
  ].join('\n');

  const userPrompt = `活动标题：${spec.title || ''}\n活动内容：${spec.content || ''}\n活动类型：${spec.type || 'oral'}\n难度级数：${(spec.difficulties || []).length}`;

  try {
    const reply = await callSpark(
      [{ role: 'user', content: userPrompt }],
      { systemPrompt: DESCRIBE_SYSTEM_PROMPT }
    );

    const jsonMatch = reply.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      let parsed = JSON.parse(jsonMatch[0]);
      if (!parsed.shortName) parsed.shortName = (spec.title || '学习活动').substring(0, 10);
      if (!parsed.subtitle) parsed.subtitle = (spec.subtitle || (spec.title || '学习活动') + '，趣味互动学习').substring(0, 40);
      if (!parsed.shortDesc) parsed.shortDesc = (spec.content || '').substring(0, 30);
      // 截断确保不超长
      parsed.shortName = String(parsed.shortName).substring(0, 15);
      parsed.subtitle = String(parsed.subtitle).substring(0, 40);
      parsed.shortDesc = String(parsed.shortDesc).substring(0, 50);
      return res.json(parsed);
    }
    // fallback
    return res.json({
      shortName: (spec.title || '学习活动').substring(0, 10),
      subtitle: (spec.subtitle || '').substring(0, 40),
      shortDesc: (spec.content || '').substring(0, 30)
    });
  } catch (err) {
    return res.status(502).json({
      error: '命名失败：' + (err && err.message ? err.message : '未知错误')
    });
  }
});

/* 伴学 · AI 根据家长指令调整活动内容 */
app.post('/api/app/update', async (req, res) => {
  const app = req.body?.app || {};
  const instruction = (req.body?.instruction || '').trim();
  if (!app.title && !app.content) {
    return res.status(400).json({ error: '缺少活动信息' });
  }
  if (!instruction) {
    return res.status(400).json({ error: '请提供调整指令' });
  }

  if (!SPARK_ENABLED) {
    return res.json(app);
  }

  const APP_UPDATE_SYSTEM_PROMPT = [
    '你是「小满伴学」的 AI 活动编辑助手。根据家长的调整指令，更新一个可交互学习活动。',
    '',
    '当前活动信息：',
    `标题：${app.title || ''}`,
    `副标题：${app.subtitle || ''}`,
    `内容：${app.content || ''}`,
    `类型：${app.type || 'oral'}`,
    `难度：${(app.difficulties || []).map(d => d.level).join('、') || '无'}`,
    `时长：${app.duration || 15} 分钟`,
    '',
    '家长的调整指令：' + instruction,
    '',
    '要求：',
    '- 返回更新后的完整活动 JSON，包含 title, subtitle, content, type, difficulties, duration, icon 字段',
    '- subtitle：一句话副标题，不超过40个字，概括活动亮点或学习目标',
    '- difficulties 数组中每个元素包含 level, desc, items 三个字段',
    '- icon 保持原值或选择合适 emoji',
    '- 只输出 JSON，不要输出任何其他内容',
    '',
    '输出格式：{"title":"...","subtitle":"...","content":"...","type":"oral","difficulties":[{"level":"低","desc":"...","items":["..."]}],"duration":15,"icon":"🎮"}'
  ].join('\n');

  try {
    const reply = await callSpark(
      [{ role: 'user', content: instruction }],
      { systemPrompt: APP_UPDATE_SYSTEM_PROMPT }
    );

    const jsonMatch = reply.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      let updated = JSON.parse(jsonMatch[0]);
      // 合并原字段，保留 id、shortName、shortDesc 等
      Object.assign(app, updated);
      return res.json(app);
    }
    return res.json(app);
  } catch (err) {
    return res.status(502).json({
      error: '更新失败：' + (err && err.message ? err.message : '未知错误')
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
