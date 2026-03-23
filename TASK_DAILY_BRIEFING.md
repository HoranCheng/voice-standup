# Voice Standup — 每日简报调度执行包

**交付对象：** 老顾（Main agent）
**审核：** 若楠（Beta）
**起草：** 阿哲（Alpha）

---

## A. 目标

为 Voice Standup 实现工作日简报调度器：

1. 按时间聚合各项目频道动态，生成简报
2. 将简报 PUT 到 Worker KV（`PUT https://voice-standup.henrycdev26.workers.dev/api/standup`）
3. 将简报发送到 #command
4. 根据 Henry 是否回应，决定当天后续简报是否发送

---

## B. 时间规则

**仅澳洲工作日（周一至周五）运行。**

| 时间 (AEST) | 类型 | 聚合范围 | 条件 |
|-------------|------|---------|------|
| 06:10 | 早报 | 昨晚 → 今早的频道动态 | 无条件 |
| 10:50 | 午间总结 | 今早 → 现在的频道动态 | **仅当 Henry 已回应早报** |
| 16:30 | 下午汇报 | 午间 → 现在的频道动态 | **仅当 Henry 已回应早报** |

**"Henry 已回应"判定：**
- **只认 #command 频道**：Henry 在 #command 对当天 06:10 早报有明确回复 / 指导意见，视为已回应
- 不认 Worker KV 发送记录（KV 只说明简报发出过，不说明 Henry 回应过）
- 如果 06:10 早报发出后到 10:50 之前 Henry 在 #command 无任何回复 → 10:50 和 16:30 不发
- **跳过时的执行约束：** 10:50 / 16:30 的 cron 触发后，若判定为"未回应"，老顾需在 #command 发一条简短记录（如 "⏭️ 午间简报跳过：Henry 未回应早报"），然后正常退出，不生成简报内容，不 PUT Worker KV

**公共假期：** v1 不处理，仅按周一到周五。后续可加假期列表。

---

## C. 聚合频道范围

### 确定纳入（Projects 分区）
- `#receipt-app`
- `#kinder-capture`
- `#voice-standup`
- `#library-system`
- `#3d-print-lab`
- `#ipad-battery-lab`
- `#nas-setup`

### 待 Henry 确认
- `#learning-story`
- `#kinder-activities`
- `#dev-output`
- `#claw-lab`

### 不纳入
- `#command`（指挥频道，不是动态源）
- `#alpha-beta-room`（讨论频道）
- `#announcements`（公告频道）

---

## D. 简报格式

每份简报应包含：

```
📋 [早报/午间总结/下午汇报] — YYYY-MM-DD

## 项目动态摘要

### #receipt-app
- [有动态的简短摘要]
- [关键事件/决策/变更]

### #kinder-capture
- [有动态的简短摘要]

### #voice-standup
- [有动态的简短摘要]

（无动态的频道不列出）

## 待 Henry 关注
- [需要 Henry 决策/确认的事项]
- [被 @Henry 提及的内容]

## 阻塞项
- [各项目当前已知的阻塞]
```

**要求：**
- 只报有动态的频道
- 每个频道摘要 2-5 句话
- 突出需要 Henry 注意的事项
- 不报日常反应（emoji reaction）等噪音

---

## E. 指导意见拆分下发

Henry 通过 Voice Standup PWA 开完会后，会将指导意见发布到：
- `POST /api/publish`（发到产品频道 #voice-standup）
- `POST /api/publish-command`（发到 #command）

**老顾收到 #command 的指导意见后，需要：**

1. **解析内容** — 识别涉及哪些项目
2. **处理信息** — 整理成对应频道能理解的任务格式
3. **分发** — 发送到对应的项目频道

**分发格式：**
```
📌 Henry 指导意见 — YYYY-MM-DD

[从指导意见中提取的、与本频道相关的具体任务/方向/决策]

来源：Voice Standup 会议
```

**约束：**
- 只转发与该频道相关的部分
- 不要把不相关的指导意见发到不相关的频道
- 如果指导意见中提到新项目 → 发到 #command 请 Henry 决定是否建新频道
- **映射不清时不得自行分发：** 若 Henry 的指导意见无法明确映射到现有项目频道，或涉及多个项目但边界不清，老顾不得自行猜测分发。必须回 #command 请求 Henry 确认目标频道或是否需要新建频道后再发送。

---

## F. 技术实现建议

### 简报生成（老顾 cron）
- 使用 OpenClaw 的 cron 功能
- 3 个 cron job（06:10 / 10:50 / 16:30 AEST）
- job payload: `agentTurn` with message 描述需要做什么
- 10:50 和 16:30 的 job 先检查 Henry 回应状态再决定是否执行

### PUT 到 Worker KV
- Endpoint: `PUT https://voice-standup.henrycdev26.workers.dev/api/standup`
- Body: `{ "content": "简报内容" }`
- 需要确认 Worker 端是否需要 auth header

### 发到 #command
- 使用 message tool
- target: #command 的频道 ID（`1483410775694512168`）

### WEBHOOK_COMMAND
- Worker 的 `/api/publish-command` 需要一个 Discord webhook URL
- Henry 是否已经建好 webhook？需要确认

---

## 待确认事项

1. [ ] Kinder 分区频道是否纳入聚合
2. [ ] Dev 分区频道是否纳入聚合
3. [ ] Worker PUT 端点是否需要 auth
4. [ ] WEBHOOK_COMMAND webhook 是否已建
5. [x] "已回应"判定方式：只认 #command 回复（已确认）
6. [ ] 公共假期是否需要 v1 处理

---

**状态：** 初稿，待若楠 review + Henry 确认待确认事项
