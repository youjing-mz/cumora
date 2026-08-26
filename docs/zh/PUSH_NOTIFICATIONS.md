# 推送通知设置 (iOS APNs + Android FCM)

Cumora 移动客户端在应用处于后台或被关闭时，支持通过 APNs (iOS) 和 FCM (Android) 投递聊天与系统消息通知。当应用处于前台时，则通过应用内 Toast 呈现。

## 代码库内置能力

- 移动端 Capacitor 推送插件集成与生命周期绑定；
- 数据库 `push_devices` 存储设备 Token 与平台标识；
- `POST /push/register` 与 `POST /push/unregister` 设备注册接口；
- 服务端纯原生 APNs 发送器（HTTP/2 + ES256 JWT）与 FCM 发送器（HTTP v1）。

## 服务端环境变量配置

在 `.env` 中配置以下变量以启用推送服务：

```env
# iOS APNs 配置
APNS_KEY_ID=ABC123XYZ
APNS_TEAM_ID=DEF456UVW
APNS_BUNDLE_ID=io.cumora.app
APNS_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----"
APNS_PRODUCTION=true

# Android FCM 配置
FCM_SERVICE_ACCOUNT_JSON='{"type":"service_account",...}'
```

构建相关说明请参阅 [MOBILE_IOS.md](./MOBILE_IOS.md)。
