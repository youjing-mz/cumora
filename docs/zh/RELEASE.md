# 版本发布与部署手册

本文档说明 Cumora 桌面端应用打包发布以及服务端受控部署流程。

## 桌面端发布快速指南

```bash
# 1. 升级 package.json 版本号并生成 Git Tag
npm version patch       # 0.1.0 → 0.1.1

# 2. 推送 Tag 触发 GitHub Actions 自动化发布
git push origin main --tags
```

推送 `v*` 标签将自动触发跨平台打包工作流，生成 macOS (Apple Silicon + Intel)、Windows 和 Linux 的二进制安装包并发布到 GitHub Releases。桌面端内置自动更新器会自动拉取新版本。

## 服务端后端部署流程

服务端的生产部署独立于桌面端 Tag，必须经过显式审批与验证：

1. 代码合入 `main` 后自动运行测试套件与类型检查，构建不可变的 Docker 镜像；
2. 在 GitHub Actions 中执行 Deploy 流程并输入目标镜像 SHA；
3. 生产环境部署必须经过拥有权限的人员批准；
4. 部署后自动执行冒烟测试，若冒烟测试未通过则自动执行 `kubectl rollout undo` 回滚。

功能契约与生产回读规范请参阅 [SHIPPING.md](./SHIPPING.md)。
