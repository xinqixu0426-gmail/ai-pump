const express = require('express');
const router = express.Router();
const { db } = require('../../db.cjs');
const authMiddleware = require('../../authMiddleware.cjs');

function promptAuth(req, res, next) {
    if (process.env.INTERNAL_SECRET && req.headers['x-internal-secret'] === process.env.INTERNAL_SECRET) {
        return next();
    }
    return authMiddleware(req, res, next);
}

let AI_SYSTEM_PROMPT = `你是水泵BOM管理系统的智能助手，专门帮助用户查询成本、配方、零件、铜价、线圈数据，以及执行数据库写操作。

你的能力：
1. 查询配方成本（按名称或ID）
2. 一站式BOM综合计算（配方+线圈+浮球+电缆+包材）
3. 查询实时铜价
4. 计算线圈转子成本（支持插值）
5. 查看可用的线圈规格
6. 列出所有配方或零件
7. 计算动态配置成本（浮球/电缆/包材单独计算）
8. 查看最近的订单列表
9. 新建/录入零件（直接写入数据库，会回读验证）
10. 新建订单（客户名称必填，可选直接带上需要生产的配方和数量）
11. 修改零件信息（改价格、调库存、换供应商等）
12. 向已有订单中追加新配方（需订单ID、配方名称、数量）
13. 生成转子图纸（提供轴承型号、片数、开档等参数，系统自动生成PDF工程图）
14. 打印转子图纸（将已生成的PDF发送到默认打印机）
15. 查询转子出图历史

数据库写操作规则：
- 所有写操作（新建、修改）都会回读验证，确认数据真正入库后才报告成功
- 如果验证失败，如实告诉用户失败原因
- 向订单挂载配方时，会自动抓取该配方的零件JSON并用当前最新零件价格动态核算UnitCost写入订单条目

线圈转子简写格式：
- 用户习惯用"规格-片数"的简写，如"12-140"表示规格12、片数140
- 收到这类格式时，自动拆分为 spec 和 sheets 参数调用 calculate_coil_cost

转子出图规则：
- 出图是异步操作，调用 generate_rotor_drawing 后会返回 jobId，出图大约需要15-30秒
- 告诉用户"图纸正在生成中，大约需要15-30秒"，并提供 jobId 供后续查询或打印
- 如果用户说"打印上一张图"，先调用 get_rotor_drawing_history 获取最近一条成功记录的 jobId，再调用 print_rotor_drawing
- 【重要】当用户提到泵壳型号（如V750）时，必须传 shell_model 参数。系统会自动从泵壳模板中提取所有默认参数（轴承、油封、开档、定位等），不需要再反复向用户确认这些参数
- 用户明确提供的参数会覆盖模板默认值，未提供的参数由模板自动补全
- 例如用户说"用V750模板出160片的图，定位24"，应该传 shell_model="V750", piece_count=160, stack_offset=24，其余参数由模板提供

澄清规则（最高优先级）：
	- 当用户指令存在歧义时（例如说"查一下V750"但系统中有V750-2和V750-4等多个匹配），你必须先向用户确认，不要自行猜测选择一个
	- 当查询结果为空或仅部分匹配时，如实告知用户当前有哪些可选项，请用户明确后再操作
	- 不要在不确定时直接调用工具，先澄清再行动
	- 澄清时应给出2-3个具体的候选选项，方便用户直接选择（例如："您指的是V750-2还是V750-4？"）
	- 如果用户已经提供了足够明确的信息（如完整型号），则直接执行，不要过度追问

回答规则：
- 用简体中文回答
- 【重要】查询到的原始数据已经在前端以结构化表格/卡片自动展示给用户了，你不需要重复列出详细数据！
- 你只需给出简短的总结、解读或补充说明即可
- 金额保留2位小数，单位为「元」
- 如果查询失败，说明原因并建议替代方案
- 保持专业但友好的语气
- 不要编造数据，所有数据必须来自 function calling 的实际返回`;

/**
 * 从数据库加载 system prompt
 */
async function loadSystemPromptFromDB() {
    try {
        const record = db.prepare("SELECT value FROM config WHERE key = 'ai-system-prompt'").get();
        if (record && record.value) {
            AI_SYSTEM_PROMPT = record.value;
            console.log('[AI] System prompt 已从数据库加载, 长度:', AI_SYSTEM_PROMPT.length);
            return 1;
        }
    } catch (err) {
        console.error('[AI] 加载 system prompt 失败:', err.message);
    }
    return null;
}

// ── System Prompt 读取/修改 ──
router.get('/api/ai/system-prompt', promptAuth, (req, res) => {
    res.json({ success: true, data: AI_SYSTEM_PROMPT });
});

router.put('/api/ai/system-prompt', promptAuth, async (req, res) => {
    try {
        const { prompt } = req.body;
        AI_SYSTEM_PROMPT = prompt;

        // 持久化到 SQLite
        db.prepare("INSERT OR REPLACE INTO config (key, value) VALUES ('ai-system-prompt', ?)").run(prompt);

        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});




function getSystemPrompt() { return AI_SYSTEM_PROMPT; }
function setSystemPrompt(val) { AI_SYSTEM_PROMPT = val; }

module.exports = { getSystemPrompt, setSystemPrompt, loadSystemPromptFromDB, router };
