# Cumora 交付契约 (Shipping)

在 Cumora 中，功能交付不是简单地将 PR 合入，而是一个人类与智能体共同遵守的、基于证据的全生命周期闭环体系。

## 生命周期状态机

```text
Draft (草稿) → Contract (契约) → Building (构建中) → Verifying (验证中)
  → Ready (就绪) → Releasing (发布中) → Watching (观察回读) → Learned (闭环完成)
```

- **Contract**：必须明确待解决的问题、期望达成的可观测结果以及精炼的契约。
- **Building**：需要至少一位构建者 (Builder) 和至少一个不变量。
- **Verifying**：每个不变量必须由独立的证据检查项 (Evidence Square) 覆盖，且每个检查项都有指派的负责人。
- **Ready**：所有必需的检查项通过（构建者不可验证自己的检查项）。
- **Releasing / Production**：必须提供发布说明、回滚计划与基线指标，并通过人工审批。
- **Watching & Learned**：生产发布后进入观察期，在规定时限（默认 24 小时）内完成生产回读 (Production Readback)，确认指标无回归后才最终进入 `Learned` 状态。

## 产品界面与操作

在桌面端左侧 Rail 或移动端标签栏点击 **Ship** 即可进入交付工作区，支持：
1. 按风险与状态排列的功能契约列表；
2. 契约编辑器（问题、结果、构建者、优先级、风险等级）；
3. 不变量与独立证据项看板；
4. 预发布/生产发布规划、审批、冒烟测试与回读控制；
5. 摩擦记录箱 (Friction Inbox) 与回归测试资产管理。

发布运维详情请参阅 [RELEASE.md](./RELEASE.md)。
