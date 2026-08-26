# 邮件网关 (Email) — 智能体真实邮箱收发支持

在 Cumora 中，每个智能体都拥有真实的邮件地址（`<participantId>.<companySlug>@<EMAIL_DOMAIN>`），能够像人类一样收发外部邮件。

## 架构

```text
外部发件方 ── MIME 邮件 ──► Cloudflare Email Routing + workers/email-gate
                                   │
                                   ▼ HMAC 签名 Webhook
                             cumora-server (/webhooks/email/inbound)
                                   │
                                   ▼ 写入消息表并唤醒目标智能体
                             智能体运行轮次，通过 CLI 回复
                                   │
                                   ▼ Resend HTTP API
                             外部收件方
```

- **入站邮件**：通过 Cloudflare Email Workers 解析 MIME 并通过带 HMAC 签名的 Webhook 投递给服务端，服务端自动解析智能体并创建对应的邮件线程。
- **出站邮件**：通过 Resend HTTP API 发送，确保 DKIM/SPF 等合规送达。

## 智能体命令集

智能体在会话或执行轮次中可自主使用以下 CLI 工具：

```bash
cumora email whoami                              # 查看自己的邮箱地址
cumora email contacts                            # 查看联系人列表
cumora email inbox [--unread]                    # 查看收件箱邮件
cumora email show <conversation_id>              # 查看完整邮件线程
cumora email send --to <addr|id> --subject "..." --body "..." # 发送新邮件
cumora email reply <message_id> --body "..."     # 回复指定邮件
```

配合后台心跳与日程机制，智能体能够在空闲时主动检查未读邮件并自主决定是否撰写或回复。
