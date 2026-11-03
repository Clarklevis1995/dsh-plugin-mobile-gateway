# WebRTC 运行库决策

日期：2026-10-30。Host 实测环境：macOS arm64，Node v24.20.0。网关基线：`1b42fb4af9d56fe42c055b06027533927aeb2d9b`，本轮修改未发布。

## 选型

生产侧实验 adapter 选用 **werift 0.25.2**，精确锁定为正式运行时 dependency（2026-10-31 更新），MIT 许可证，包声明 Node >=22。以每个协商组一个 Node Worker 承载两个独立 PeerConnection。普通 WebSocket 不依赖 Worker 或 werift；开关关闭时不加载，加载失败不宣告 capability，不影响原入口。

对照库为 **node-datachannel 0.33.6**，MPL 2.0，声明 Node >=18.20.0；本轮只安装在临时目录用于独立客户端互操作，没有加入网关依赖。发布包通过各平台 optional native 包分发，当前实际安装的是 darwin-arm64。它的包清单还声明其他系统/架构制品，未在本轮逐平台实测，不能据此宣称 Gateway 支持矩阵已完成。

来源：[werift 上游](https://github.com/shinyoshiaki/werift-webrtc)、[node-datachannel 上游](https://github.com/murat-dogan/node-datachannel)、各精确版本实际 npm 包的 package.json、类型声明和源代码。未复制参考 ds-harness-remote 的业务 RPC 或账号协议。

## 为什么隔离 Worker

同库真实收发和 libdatachannel 客户端互通都能成功，但直接在主线程取消 werift 协商时，发现尚未完成的 STUN/异步工作可留下持续定时器，导致业务已回退而进程不能正常退出。因此不使用“仅调用 pc.close 就证明清理完成”的实现。

`rtc-worker.mjs` 隔离 ICE、DTLS、SCTP 及库内计时器；一组两个 PC 共享一个 Worker，两条 DC 仍各用独立 SCTP association。关闭整组后，父线程拒绝未完成 RPC，并 await Worker.terminate，回收该组线程内全部 UDP 和定时器；不会通过全局清理其他插件使用的运行库。

werift 0.25.2 的底层 Connection 即使收到空 iceServers，仍会设置默认 Google STUN。adapter 在空配置的本地描述阶段显式清除公开的 connection.stunServer 字段，确保只使用网关下发的列表。2026-10-31 起，生产默认列表为 Cloudflare STUN；底层显式空列表的隔离行为仍保留。没有修改库源文件或覆盖全局函数；升级依赖时必须重新验证这条兼容处理。

Worker 启动和运行库有内存/CPU 成本；pending、每设备组数、active、队列和重组均有限额。16 个 active group 是资源上限，不代表已验证 16 台手机的内存、延迟和功耗表现。生产默认开启前必须测量目标机器的并发峰值。

## 已取得的互操作证据

- 两个真实 PC 承载真实网关 workspaces、history、session-create、ping，验证 wrong-channel。
- Node 联调客户端与 werift Gateway：1 字节合法 JSON、16 KiB 边界、16 MiB 逻辑消息。
- node-datachannel/libdatachannel 独立客户端 → werift Gateway：两个 PC、16 KiB 与 16 MiB、工作区与历史。
- 原生 polyfill 的 ICE 候选带 `a=`，在客户端 adapter 去掉该 SDP 行前缀后符合公共 candidate 字段契约。
- 100 次真实连接释放；组数、业务连接与 RTC Worker 回到零，进程正常退出。主线程 UDP 句柄计数也回到基线，不能将该计数单独当作跨线程 UDP 证明。

Android AAR、iOS XCFramework、16 KiB page、签名、真机系统版本与网络矩阵均未验证。这里的 libdatachannel 互通不能替代 libwebrtc 真机互通。实验开关仍默认关闭，网关可联调，App 待接入。

## 打包要求

npm files 必须包含 `lib/rtc-worker.mjs`、Worker client、所有 adapter、测试客户端、共享 fixtures 和接入文档。`werift` 作为普通 dependencies 由包管理器直接安装，不需要 C++ 构建环境。`npm run test:package` 保留为手动专项检查，使用真实 tarball 和独立临时目录验证 npm、pnpm 安装及 RTC 加载；不绑定发布生命周期。
