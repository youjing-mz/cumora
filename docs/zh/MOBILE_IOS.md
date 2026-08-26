# Cumora 移动端 — iOS 构建与发布

本文档介绍通过 Capacitor 构建、测试并提交 Cumora iOS 应用的端到端流程。

## 架构概览

- **渲染层**：与 Electron 桌面端共用相同的 Vite/React 产物（`src/`）。通过 `useIsMobile()` 和 Capacitor 的 `window.Capacitor.isNativePlatform()` 判定并激活移动端专属界面。
- **原生容器**：Capacitor 8.x。配置位于 `capacitor.config.ts`。原生插件封装在 `src/lib/native.ts` 中，包括状态栏、启动屏幕、键盘控制、触觉反馈等。
- **后端连接**：默认通过 `VITE_CUMORA_API_BASE` 指向生产环境 API 地址，私有化部署时可调整。

## 本地开发与构建

```bash
# 1. 安装依赖
npm install

# 2. 从 build/icon.png 生成应用图标与启动图
npm install --no-save sharp
node scripts-gen-ios-assets.mjs

# 3. 构建前端产物并同步到原生 iOS 工程
npm run mobile:sync

# 4. 在模拟器中运行
npm run mobile:ios:run

# 5. 打开 Xcode 工程
npx cap open ios
```

推送通知配置请参阅 [PUSH_NOTIFICATIONS.md](./PUSH_NOTIFICATIONS.md)。
