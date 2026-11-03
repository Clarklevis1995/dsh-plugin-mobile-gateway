# WebRTC Gateway 本轮验收记录

## 2026-10-31：双通道 ICE 候选独立限流预算

14:53:33 的实机客户端日志为 gateway-security-failure；网关同一时刻记录 `stage=negotiating code=transport/rate-limit security=true`。旧通用令牌桶将合法 ICE 候选与控制消息合并计算，40 条突发额度可在双通道 gathering 期间耗尽。

修复将候选/EOC 单独计入 ICE 桶：额度按每设备两组、每组两通道、每通道 256 个候选及一次 EOC 推导为 1028；两个桶均保留每秒 20 个令牌恢复，控制桶仍为 40。只有处于 negotiating/ready 且会话、通道匹配的候选/EOC 使用 ICE 桶，错误会话、序号、格式和重放仍拒绝。EOC 不再占用候选数量，使第 256 个合法候选之后仍能正常结束 gathering。

回归先复现合法候选流被提前关闭，修复后两组共四通道的完整预算通过；第 257 个候选仍关闭，原控制帧洪泛测试仍通过。协商/帧/配置相关共 24 项通过。同步本机安装副本前的备份为 `/tmp/dsh-transport-negotiation-before-ice-rate.mjs`。本轮仅修改网关，无客户端改动，用户运行进程未重启。

## 2026-10-31：修复 ready 阶段误拒绝在途 ICE

实机日志显示 gateway-security-failure；网关文件日志多次记录 `stage=ready code=transport/stale-signal security=true`。两条 DataChannel 已绑定时进入 ready，但 ICE gathering 及网络中的候选/EOC 可能尚未结束，旧状态判断将它们误报为过期。

修复为 negotiating/ready 均接收合法同会话 ICE，仍逐项校验通道、连续序号、候选格式和数量、重复 offer 与结束标记。新增纯内存回归在修复前复现 4003，修复后通过，并验证不在显式选择前分发业务。协商、帧及配置相关 22 项通过；未启动或重启网关服务。本机安装副本同步单模块修复并保留 `/tmp/dsh-transport-negotiation-before-late-ice.mjs` 备份，需重载运行中的服务才能生效。客户端也需接收等待 selected 期间的合法在途 ICE。

日期：2026-10-30。环境：macOS arm64 / Node v24.20.0。网关基线：`1b42fb4af9d56fe42c055b06027533927aeb2d9b`。变更仍在工作区，未发布 npm、未部署线上、未改 Android/iOS 工程。

交付状态：**网关可联调，App 待接入**。配置、完整信令和恢复要求见 [App 接入契约](webrtc-app-integration.md)，运行库与 Worker 决策见 [运行库记录](webrtc-runtime-decision.md)。

## 自动化验证

| 验证 | 本轮结果 |
| --- | --- |
| 原有完整 npm test | 通过，含鉴权、配对、双通道、会话、问答审批、文件、语音、插件管理、多网关及 Cloudflare |
| 新增传输测试 | 共享黄金向量、UTF-8、16 KiB/16 MiB 边界、非法头、重复字段、乱序、预算、背压、超时与关闭通过 |
| 信令状态机 | bootstrap 无业务执行、双票据绑定、跨设备/通道/会话及重放拒绝、显式 commit、重复选择幂等、冲突关闭、配额归还通过 |
| 开场跨路径顺序 | commit 确认前仅 hello；每通道首次 ping 后释放业务基线，通过 |
| 两设备隔离 | 票据不可互用，逻辑 owner/代次不可改写，撤销目标设备不关闭其他设备，通过 |
| 无能力和 ws-only | 复用普通 WebSocket，真实 history/ping 通过 |
| 真实双 PC | workspaces、history、session-create、ping 及 wrong-channel 通过 |
| 真实大消息 | 1 字节合法 JSON、16 KiB 与 16 MiB 业务 JSON 实传通过 |
| 真实网络失败 | 100 ms RTC 总子阶段超时、不可达本机 STUN，显式回退后 WebSocket 业务通过 |
| 真实证书错误 | 篡改线上 offer 的 SHA-256 fingerprint，本地实际证书不变；Host 报 dtls-failed、零业务激活、零 Host 写调用，不降级，通过 |
| 真实写操作与恢复 | 已确认 session-create 后新代次 ws-only 连接，Host 创建调用计数不增加，通过；不代表已覆盖所有写操作丢响应的真机场景 |
| 100 次真实建立/释放 | 通过；业务连接、pending/active group 和 RTC Worker 回到零，主线程 UDP 计数回到基线，进程正常退出 |
| 独立运行库互通 | node-datachannel 0.33.6 客户端 → werift 0.25.2 Worker Gateway；两个 PC、16 KiB/16 MiB、workspaces/history，通过 |
| 实际 tarball | 文件清单包含 Worker、adapter、客户端、fixtures 与文档；临时安装后 P2P 业务通过 |
| 省略 optional dependency | 实际 tarball 离线安装、加载插件、runtime=unavailable、WebSocket workspaces 通过 |
| 语法和差异检查 | node --check、git diff --check 通过 |

上述“真实”指本机真实 ICE/DTLS/SCTP 收发及插件业务分发，Host 业务服务使用测试替身，不操作用户的真实 Harness 会话。Mock 状态机测试与实连证据分别列出。主线程 UDP 统计看不到 Worker 内 UDP；资源验收同时断言实际 Worker 退出，不用单一句柄计数代替跨线程清理证明。

默认 `npm test` 中独立原生库互通用例因未设置外部库路径而跳过；已使用下述显式命令单独实测通过，不能把默认 skipped 记成默认通过。运行库缺失时，真实 RTC 专项也会明确跳过，WSS 回归仍运行。

## 可复现命令

```bash
npm test
npm run test:webrtc
npm run test:webrtc:stress
MGW_NATIVE_RTC_ROOT=/tmp/mgw-rtc-native-runtime/node_modules/node-datachannel \
  node --test test/webrtc/interop.test.mjs
node --check lib/index.mjs
node --check lib/client.js
git diff --check
npm pack --dry-run
```

对照库是临时依赖，需在临时目录安装精确 `node-datachannel@0.33.6`，不能把示例路径当成仓库依赖。本轮还在 `/tmp/mgw-rtc-install-full` 与 `/tmp/mgw-rtc-install-no-optional` 从真实 tarball 离线安装，通过实际插件加载、配对和 workspaces 查询验证两种路径；未运行发布命令。

## 仍待验收

- Android、iOS 原生 libwebrtc 接入、签名制品、ABI、Android 16 KiB page、真机前后台和切网恢复。
- 不同宽带、家宽到蜂窝、双重 NAT、IPv6/IPv4 组合、企业代理/禁 UDP 的真机网络矩阵；目前无跨公网 P2P 成功率结论。
- 真机文件上传/下载、语音、图片和所有写操作丢响应的端到端恢复；现有业务单元/WS 回归不替代这些场景。
- 目标 OS/架构的实际 DSH 插件安装与双端互通；本轮未验证 Windows、Linux、Android 或 iOS 运行库制品。
- 并发设备内存、CPU、功耗、控制通道延迟和网络统计。本轮仅验证约束及清理，不宣称性能或流量节省比例。

因此保留实验默认关闭；启用后使用 P2P 优先策略。没有 TURN、独立信令、应用层 E2EE、ICE restart 或无缝迁移；Cloudflare 仍是可选鉴权信令入口。默认开启、App 发布和线上灰度另行验收。


## 2026-10-31：连接方式界面更新

按产品要求改为默认 P2P 优先，管理页“配对连接方式”提供与 Cloudflare 并列的“P2P 外网直连”，不再需要通过手改配置开启。新增连接方式、STUN 与配对地址的持久化和管理 API；对新连接生效，既有 RTC 业务不被切换操作中断。此前“实验默认关闭”的结论属于上一轮验收范围。

新增测试覆盖默认值、跨重启保存、网关身份不变、配置校验、同源防护、切换后旧 RTC 可继续 Ping、新 WebSocket/P2P 连接选择；全量 `npm test` 通过。真实 React 界面已验证两选项并列、P2P 默认选中、Cloudflare 保存与刷新恢复。跨网成功仍取决于可达信令入口与 NAT 条件，未新增协调服务器或 TURN。


## 2026-10-31：RTC 依赖自动安装验收

`werift@0.25.2` 已从 optionalDependencies 移入 dependencies，并同步 pnpm 锁文件，声明 Node >=22。组件由包管理器直接安装。2026-11-03 移除 `prepublishOnly` 强制验收钩子，`npm run test:package` 仅保留为手动专项检查。

实际 `npm pack` 后分别在独立临时项目进行 npm 与 pnpm 生产安装，均显式禁用可选依赖及安装脚本；确认 RTC 库随插件自动安装、adapter 可加载、默认传输运行库状态为 available、Worker 文件完整。两种安装均通过，不依赖源码目录的 node_modules。测试未创建 PeerConnection、Worker 或网关监听服务，临时安装目录自动清理。


## 2026-10-31：默认 Cloudflare STUN

生产默认 `stun:stun.cloudflare.com:3478`，由网关同时用于两个 PeerConnection 并下发 App；管理页可覆盖，清空恢复默认。历史管理状态中的空列表按默认发现服务恢复，底层显式空列表仍支持 host-only 隔离测试。

纯内存协议/分片测试 17 项通过，包含默认列表、非法值、自定义覆盖，以及相同 STUN 服务下发客户端和两个网关 Peer 的验证。实际 tarball 经 npm/pnpm 独立安装后，默认 STUN 列表和 RTC 加载均通过。本机单次 Cloudflare STUN Binding 请求收到成功响应；本地现有网关设置已保存，网关身份及进程保持不变。未启动测试网关或重启服务。STUN 响应成功不代表手机跨 NAT 的端到端直连已完成。


## 服务端网络检测验收

新增检测页与管理 API，包含双通道实际连接方式、WebSocket 协议 RTT、RTC ICE RTT、平均延迟、WebSocket P95 与曲线。25 项纯内存协议、统计、React 组件及 Worker 测试通过，涵盖相关性、超时/退出/后台取消、连接代际、缓存并发、统计单位、无样本空值与资源释放。实际 tarball 经 npm/pnpm 安装通过，统计模块随 Worker 打包。

未启动新网关或重启用户服务。离线浏览器预览受 URL 安全策略限制，改用组件渲染测试；尚未进行当前在线手机的端到端界面联调。


## 2026-10-31 增量 ICE 建连验证

- 在本机 UDP 黑洞模拟不可达 STUN，修改前原生 Peer 的 SDP 应答在 2.5 秒截止时仍未返回，新增回归用例失败。
- 修改后同场景应答约 100–120 毫秒、加密 DataChannel 首次往返约 240–260 毫秒；该时刻 STUN 仍未结束，确认成功来自并行建连而非跳过 STUN。
- 本机 STUN 延迟响应测试验证：首轮业务完成后继续产生 server-reflexive 候选及结束事件，已建立的加密通道仍可收发。
- 内存信令配合两条真实原生 RTC 通道，在不可达 STUN 场景约 319 毫秒完成绑定、整组提交与 MGW1 Ping/Pong。只绑定 control 时没有业务激活，必须等待 conversation 绑定并显式提交。
- 真实 DTLS 指纹不匹配仍触发安全失败，没有开放 DataChannel 或业务消息。
- `node --test test/webrtc/trickle-unit.test.mjs test/webrtc/trickle.test.mjs test/webrtc/negotiation.test.mjs test/webrtc/framing.test.mjs` 共 32 项通过，0 失败；覆盖早期/迟到收集失败、关闭取消、远端结束标记、非增量 SDP 兼容及既有鉴权、双通道、回退、帧预算与资源清理。

上述为本机原生库与协议验证，使用临时 UDP Socket、RTC Worker 和内存信令，不启动插件 HTTP 网关，不连接或重启用户真实网关。毫秒数据不代表蜂窝公网建连承诺；仍需真机在家宽/蜂窝、多网卡、IPv6 和不可达 STUN 条件下复验。源码及本地安装副本已同步，运行中服务未自动重启。


### 首次使用默认局域网直连

按新的产品要求，未保存连接方案时默认选择 `lan`，使用同一 Wi-Fi 下的内网地址和 WebSocket；P2P 需要主动选择。局域网入口缺失时等待配置，不自动回退公网。已保存的 P2P、Cloudflare、自动或手动方案以及显式启动配置保持优先。上文默认 P2P 的说明属于此前产品规则。
