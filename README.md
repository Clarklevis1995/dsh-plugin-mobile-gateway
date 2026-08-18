# dsh-plugin-mobile-gateway

dsh 的持久化 WebSocket 网关：在 web 服务器上注册 `/ws/mobile`，转发 agent 实时输出给移动端，并提供会话/工作区/模型/权限/默认配置/分支等 24 个信令。

- **协议文档**：[`PROTOCOL.md`](PROTOCOL.md)（与源码 `lib/index.js` 顶部注释同源）
- **日志**：`/tmp/mobile-gateway.log`（连接/查询/错误），宿主 stdout 同步输出

## 它是如何生效的

```
① package.json 声明 dsh.bundle.patch（门槛：有它才算 dsh 插件）
② dsh plugin --profile web add <路径>  → pnpm 安装 + 自动加入 dsh.profile.bundles
③ 启动 dsh web  → 按 bundles 顺序叠加各 bundle 的 cordis.patch.yml → 插件生效
```

`dsh.bundle.patch` 缺失时 `dsh plugin add` 只装依赖、**不生效**。

## 管理命令速查

```bash
# 安装（file: 复制安装，自包含，依赖解析最稳）
dsh plugin --profile web add file:/Users/lichaofan/DeepseekHarnessProject/dsh-plugin-mobile-gateway

# 更新（file: 是复制安装——改源码后必须 remove + add 才会刷新副本）
dsh plugin --profile web remove dsh-plugin-mobile-gateway
dsh plugin --profile web add file:/Users/lichaofan/DeepseekHarnessProject/dsh-plugin-mobile-gateway

# 卸载
dsh plugin --profile web remove dsh-plugin-mobile-gateway
#   并从 ~/.dsh/profiles/web/package.json 的 dsh.profile.bundles 里删除该包名

# 验证组合树（不启动）
dsh --profile web --dump-config | grep -A3 mobile-gateway
```

## 重要注意事项

| 事项 | 说明 |
|---|---|
| **改代码必须重装** | `file:` 是复制，改 `lib/index.js` 后需 remove + add（或 bump package.json 版本） |
| **重装后必须重启** | composition 启动时解析，web profile 的 HMR 被禁用：`dsh web` 重启才生效 |
| **不要用 link:** | `link:` 符号链接会从源码真实路径解析依赖（`ws` 会找不到）；`file:` 复制进 profile node_modules 才稳 |
| **补丁覆盖是整段替换** | 覆盖现有行要重述全部 config key；行 id 不能与现有行冲突 |
| **认证缺失** | `/ws/mobile` 无鉴权，暴露公网前必须加 token |

## 本地测试

```bash
# 完整分发链路测试（mock harness + 真实 ws 客户端，当前 34 个断言）
NODE_PATH=/Users/lichaofan/.npm/_npx/1e7f6d9597241db0/node_modules \
  node test/gateway.test.js
```

## 版本历史

见 `PROTOCOL.md` §14。
