# 更新日志

## [1.0.2] - 2026-03-15

### 新增
- 卡片内联提醒横幅：当会话进入"等待输入"或"需关注"状态时，卡片内显示脉冲动效提醒横幅
- VSCode 检测：每 15 秒扫描 VSCode 窗口，若检测到与会话目录匹配的 VSCode 窗口，卡片底部显示"VSCode"标记

### 变更
- 移除基于终端窗口的自动孤儿会话清理（`scheduleRemoval` / `cancelRemoval` / `findOrphanSessions` 轮询），改为保留会话直到自然结束或手动移除
- 移除卡片上的"跳转终端"按钮（不再适用于 VSCode 驱动场景）

## [1.0.1] - 2026-03-15

### 新增
- 支持全部 21 个 Claude Code hook 事件（新增 8 个：PostCompact、InstructionsLoaded、TaskCompleted、TeammateIdle、WorktreeCreate、WorktreeRemove、Elicitation、ElicitationResult）
- 增强已有事件的字段提取（model、source、agent_type、tool_response、reason 等）
- 会话卡片显示模型名称和代理类型
- 新增统计指标：指令加载数、任务完成数、工作区数
- 压缩耗时计算（PostCompact 与 PreCompact 配对）
- 8 个新事件类型的图标和颜色样式

## [1.0.0] - 2026-03-14

### 新增
- 初始版本：实时监控 Claude Code 会话的 Dashboard
- 支持 13 个 hook 事件
- WebSocket 实时推送
- 会话卡片展示（状态、工具、token 用量、费用估算）
- 事件日志面板
- 多会话管理
- 导航栏版本号显示
