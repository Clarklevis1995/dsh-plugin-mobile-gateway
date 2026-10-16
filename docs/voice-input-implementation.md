# KMM 语音输入实现与验证

## 当前交互

键盘收回时提示「描述你想要构建的内容或按住说话」。短按进入原生文字编辑，提示变为「描述你想要构建的内容」；长按录音，松手转写并回填草稿，上滑取消，不发送 Agent 消息。

长按出现录音蒙层、滑入取消状态、松手结束三个手势节点各有一次轻量触感，由 KMM 公共层统一触发，平台调用系统触感接口。

两端长按识别门槛为 100ms，蒙层淡入为 120ms，由公共层 `VoiceInputInteraction` 统一提供。静态逆向依据与 tap/longpress 验证见 [长按阈值调查](voice-input-hold-thresholds.md)。

录音遮罩覆盖底部统计条、输入框及工具栏，顶部以椭圆形透明度渐变过渡到会话内容，并整体淡入淡出。正常录音使用 Whaleness 深蓝色，上滑取消切换为浅红色。585 个粒子在静音时散乱分布，各自缓慢漂浮并改变大小、明暗，讲话时向中间聚拢，组成 45 列纯粒子波形。波形两侧粒子较小且暗，中间较大且亮，保留轻微扰动。高度由真实 RMS 音量历史驱动，不生成随机假音量。

录音遮罩不显示时间计数或「完成」按钮，松手即结束录音；只有转写等待阶段保留「取消」入口。

原生文本控件在录音和转写期间保持挂载。成功回填或确认插入后，公共层发出 `focusEditor` effect，两端恢复焦点与输入法；iOS 在下一轮主线程同步 UIKit 焦点，避免在 SwiftUI 布局过程中重入。原草稿在识别期间被编辑过时，先保留识别结果，由用户确认插入。

网关能力缺失、插件未启用或模型未准备好时，只呈现 Alert，不修改草稿、不在输入框中加入提示或按钮、不启动录音。提示用户在桌面端升级移动网关插件，并在「插件」模块启用官方语音输入插件、完成模型初始化。iOS 使用应用现有原生 Alert，Android 复用 `DshAlertDialog`。

录音过短或转写结果为空时，仅显示「未识别到人声」Toast，约两秒后自动消失，无需确认；草稿及编辑焦点不变。

## 分层

客户端仓库：`../dsh-mobile`。

- `shared/commonMain/.../facade/SharedVoiceInputStore.kt`：唯一业务状态源；能力与模型准备状态、录音 ID、取消、时长/数据限制、超时、草稿版本、跨会话隔离、音量归一化/平滑/历史、Alert 与焦点 effect。
- `shared/commonMain/.../facade/VoiceInputProtocol.kt`：官方语音目录解码、PCM 格式常量和 WAV 封装。
- `shared/commonMain/.../gateway/GatewayRuntime.kt`：控制通道请求 ID 关联、ASR 独立超时与官方错误透传。
- iOS `Core/VoiceInputAdapter.swift`：共享 Intent/effect 桥接；权限、AVAudioEngine/AVAudioConverter、平台时钟、网络和 UI 焦点回调。
- Android `platform/AndroidVoiceInputAdapter.kt`：共享 Intent/effect 桥接；权限、AudioRecord、平台时钟、网络和 UI 焦点回调。
- iOS `Components/VoiceRipplePanel.swift` 与 Android `ui/VoiceInputPanel.kt`：原生遮罩和粒子几何插值，不重复实现 ASR 判断。

两端采集 16 kHz 单声道 PCM16，公共层封装为 WAV Base64，网关调用 DSH 官方插件的 `speech` Remote API。客户端不内置 ASR 模型；模型运行在 DSH 主机。源码变更不代表已自动部署到运行中的远端服务。

## 验证（2026-10-12）

- 共享层：250 项通过，其中 20 项语音状态机测试及请求关联/超时回归。
- Android JVM 单元测试：116 项通过。
- Android APK、测试 APK 编译与 lint：通过；既有非阻塞 lint 警告保留。
- Android 17 模拟器：5 项真实 UI 测试通过，涵盖转写回填后的输入法编辑、关闭键盘后实际短按再编辑、实际长按显示统一 Alert、草稿保留、遮罩覆盖及蓝/浅红配色。
- iOS 模拟器：15 项语音、原输入控件和本地化相关测试通过，包括同一个 UITextView 保持挂载、回填后取得第一响应者、中文 marked text 可编辑，以及讲话/静音/取消三态原生截图。
- 最后渐变修正后，iOS 5 项语音测试和 Android 5 项 UI 测试再次通过。
- 新增语音 Kotlin 文件：ktlint 和 detekt 轻量静态分析通过。状态机允许前置拒绝条件，绘图固定几何数值有说明明确的局部豁免。
- 网关完整 `npm test` 与官方 DSH 0.2.0-rc.2 Speech Remote 契约测试在上一轮通过，网关协议本轮未改动；官方 Controller 校验真实 WAV，识别器使用 mock。

Android UI 测试原先间接使用 Espresso 3.5.0，在 Android 17 上反射已移除的 `InputManager.getInstance` 导致测试无法启动。增加仅用于 `androidTest` 的 Espresso 3.7.0 依赖后解决；该修复见 [官方发布记录](https://developer.android.com/jetpack/androidx/releases/test#espresso-3.7.0)，不进入生产 APK。

iOS 上一轮全量 208 项中有 1 条既有权限选项断言失败：`GatewayProtocolTests.testKMPSessionControlAdapterOwnsStateAndEmitsRequestEffectOnce`，期望过滤 `future` 权限项，而现有实现保留该项，本语音任务未修改这项行为。

上述 UI 测试使用本地测试会话、共享状态机生成的录音状态和模拟转写，不需要远端鉴权，也不启用真实麦克风。截图是原生组件渲染结果，不代表已进入远端真实会话或完成真实 ASR 模型联调。

## 转写后焦点竞争修复（2026-10-12）

在完整 iOS `ConversationView` 中重现了转写后焦点被抢走的问题：晚到的 `keyboardDidHideNotification` 无条件清除编辑焦点；另一个竞争发生在原生文本框已聚焦、SwiftUI 尚未提交新的 Binding 值时，普通刷新把旧的 `false` 当作主动失焦请求。

焦点同步现在只执行发生变化的显式请求，原生编辑开始或结束时作废旧的排队请求。键盘隐藏通知不再清除输入框焦点，编辑状态由 `UITextViewDelegate` 回报。AppStore 支持注入语音 adapter，方便真实页面使用模拟转写验证，默认运行行为保持不变。

新增两项回归测试在修复前均失败；修复后 7 项语音测试与 2 项输入框展示测试全部通过。覆盖完整会话页面回填、迟到的键盘通知、原生聚焦与旧 Binding 竞争、中文组合输入、收起键盘后再聚焦，以及明确失焦请求仍正常生效。日志：`/tmp/dsh-voice-focus-fixed.log`。本轮只修改 iOS 焦点协调和测试依赖注入，不涉及 ASR 公共层或网关协议。

## 短音节触发完整波形（2026-10-12）

原实现将粒子聚拢比例直接映射到平滑音量：较轻的声音只能部分聚拢，短音节停声后动画目标回退。现在公共层独立维护 `waveformActive`：一次未平滑的归一化音量超过既有声音门限，即将聚拢目标设为完整波形，并在最后一次有效声音后保持 600ms。继续说话只延长保持窗口，柱高仍使用实际音量历史；持续静音后恢复自由粒子。两端传入平台单调时钟，公共层按时间管理保持窗口，不依赖音量回调次数。取消、松手和新录音会重置该状态。

iOS 与 Android 聚拢动画均为 160ms，散开为 320ms。触发使用现有 RMS 能量门限，不引入客户端 ASR 或人声分类模型。新增测试验证单次较轻声音随后立即静音仍保持完整聚拢目标、语句停顿后续说话延长窗口，以及静音/无效采样/旧录音回调和录音重置。

验证：共享层 253 项测试通过（其中语音状态机 23 项）；Android 客户端与界面测试 APK 编译通过；iOS 9 项语音及输入框相关测试通过；改动 Kotlin 源码与共享测试通过 ktlint，`git diff --check` 通过。日志：`/tmp/dsh-waveform-gradle.log`、`/tmp/dsh-waveform-ios.log`。使用合成音量和模拟转写验证，未进行远端真实 ASR 联调。

## 纯粒子波形（2026-10-12）

删除 iOS 与 Android 波形中的实心圆角连接柱，波形完全由圆形粒子绘制。每列粒子由 7 个增加到 13 个，总数由 315 增至 585；聚拢后半径统一为 1.15pt/dp，保持清晰的点阵形态。静音排布调整为 39×15 的均匀分布，仍保留原有漂移和聚拢动画。公共层触发及 ASR 流程未修改。

Android Debug 构建、改动 Kotlin 文件 ktlint 和 `git diff --check` 通过；iOS 原生三态截图测试通过，并已检查讲话波形截图及更新 `voice-input-states.html` 所用三张原生预览图。日志：`/tmp/dsh-particle-density-android.log`、`/tmp/dsh-particle-density-ios.log`。

## 无语音轻提示（2026-10-12）

公共层将过短 PCM 与空白转写统一处理为无语音结果：停止录音及计时、回到 idle、清除错误与 Alert，发出一次 `showToast` effect，文案「未识别到人声」。不改草稿，不请求编辑焦点，不发送聊天消息。重复或旧的转写回调不会重复弹出。权限、网关初始化、无效音频及服务错误继续使用原 Alert 流程。

Android adapter 使用系统 `Toast.LENGTH_SHORT`；iOS adapter 只管理短暂展示及两秒自动隐藏，页面使用不拦截触摸的胶囊提示。离开页面会清除提示。新增中文与英文文案。

验证：公共层 255 项测试通过（语音状态机 25 项），涵盖过短录音、空白结果、重复回调、草稿保留与 Alert 分类；Android Debug 编译通过；iOS 语音、输入框和本地化回归通过，新增用例验证 Toast 自动隐藏且不发出草稿/焦点变更。Kotlin 修改通过 ktlint，`git diff --check` 通过。日志：`/tmp/dsh-no-speech-gradle.log`、`/tmp/dsh-no-speech-ios.log`。

## 粒子大小与明暗扰动（2026-10-12）

分散和波形状态始终使用同一批索引固定的 585 个粒子。删除聚拢时统一半径和大幅提高透明度的映射：每个粒子通过固定种子保留自己的基础半径（0.65～1.60pt/dp）和透明度（0.18～0.60），在两种状态间连续变化。加入异相、低频的半径扰动（±8%）和明暗变化，波形两端仅作轻微柔化。不在每帧重新抽取随机数，避免闪烁；音量历史和柱高不受视觉扰动影响。

两端仅修改绘制，公共层 ASR 与触发逻辑保持原行为。Android Debug 构建、Kotlin 文件 ktlint、`git diff --check` 通过；iOS 原生三态截图测试通过，已检查讲话截图中大小与明暗不规则的粒子波形，并更新三张预览图及 HTML 图片缓存版本。日志：`/tmp/dsh-particle-character-android.log`、`/tmp/dsh-particle-character-ios.log`。

## 减弱粒子差异（2026-10-12）

为避免波形呈现零散的缺点效果，两端基础半径收窄为 1.00～1.25pt/dp，基础透明度收窄为 0.44～0.56；大小动态扰动由 ±8% 降为 ±2.5%，明暗动态系数由 0.88±0.12 调整为 0.97±0.03，波形边缘柔化由 28% 减至 12%。保留各粒子的固定种子与连续低频变化，波形更均匀。

Android Debug 构建、Kotlin 文件 ktlint、`git diff --check` 及 iOS 原生三态截图测试通过；已检查讲话截图并更新三张预览图与 HTML 缓存版本。日志：`/tmp/dsh-particle-softness-android.log`、`/tmp/dsh-particle-softness-ios.log`。

## 自由漂浮与波形中心包络（2026-10-12）

分开计算自由状态与波形状态的大小、明暗，再按聚拢进度连续插值，避免把波形的规则化参数应用到自由粒子。自由状态恢复原始基础半径 0.7～1.5pt/dp 与透明度 0.12～0.38；按最新补充要求采用独立随机起点、不同速度与方向的连续漂移，叠加异相的大小呼吸（±18%）与缓慢明暗变化。Android 漂移采用整数频率，20 秒循环首尾连续；不逐帧重抽随机数。

波形使用平滑的中心包络：基础半径从两侧约 0.8 递增到中心约 1.3pt/dp，透明度从约 0.26 递增到约 0.66；仅叠加小范围的粒子差异、±2.5% 大小扰动与轻微明暗变化。音量、聚拢触发和 ASR 公共层未修改。

两端构建、Kotlin 文件 ktlint、`git diff --check` 及 iOS 三态截图测试通过，已分别检查自由漂浮与讲话截图并更新预览。日志：`/tmp/dsh-free-particle-drift-android.log`、`/tmp/dsh-free-particle-drift-ios.log`。

## 椭圆渐变与蒙层淡入淡出（2026-10-12）

删除顶部纵向线性透明度渐变，改用横向拉伸的径向透明度遮罩：中间向上扩散，两侧边缘沿椭圆弧渐隐。渐变限制在顶部 144pt/dp，下面完整不透明覆盖；蒙层高度改为至少 320pt/dp，并在输入区域高度上增加 144pt/dp，以确保弧形边缘不露出输入工具栏。粒子同时接受遮罩，避免透明区仍有明显粒子边界。

iOS 对独立蒙层容器应用 opacity transition，通常 240ms 淡入淡出，减少动态效果时 120ms。Android 使用 AnimatedVisibility，240ms 淡入、200ms 淡出。Android 淡出保留最后可见的 UI snapshot，避免浅红取消画面先跳回蓝色；这是渲染缓存，不判断 ASR 业务。退出后立即停止遮罩拦截触摸及按钮交互，输入控件保持挂载与可编辑。

验证：iOS 10 项语音与输入框回归通过，覆盖真实会话页回填焦点和三态截图；Android 17 模拟器 6 项界面测试通过，新增用例暂停动画时钟，检查淡入/淡出的中间透明帧、完成退出后移除、椭圆顶部两侧比中间更透明。Android 构建、改动 VoiceInputPanel.kt 的 ktlint 和 `git diff --check` 通过。已检查原生截图并更新三态预览。日志：`/tmp/dsh-elliptical-mask-ios.log`、`/tmp/dsh-elliptical-mask-device.log`。使用本地测试会话与模拟转写，不连接远端服务。

## 三节点触感（2026-10-12）

公共层在有效长按进入 authorizing、取消区边界由未进入变为进入、用户松手结束持有时，分别发出 `hapticStart`、`hapticCancel`、`hapticRelease`。停留在取消区或重复松手回调不重复触发；退出后再滑入是新的进入事件。提前松手也提供结束触感；自动录音上限、后台取消、断线和失败清理不伪造手势触感。网关不支持或模型未准备等拒绝路径不出现蒙层，也不触发这些事件。

iOS 使用 soft impact、selection feedback、light impact，移除原麦克风真正启动时的触感，避免迟到或重复。Android adapter 转发事件，UI 的 View 使用 LONG_PRESS、CLOCK_TICK、KEYBOARD_TAP，尊重系统触感设置且无需新增震动权限；离开页面释放回调。触发与去重判断只在 KMM 公共层，UI 不保存另一套手势业务状态。

验证：公共层 259 项测试通过（语音状态机 29 项，新增四项触感回归），Android 6 项界面回归及 iOS 10 项语音/输入框回归通过；两端编译、改动共享源码/测试及 Android adapter 的 ktlint、`git diff --check` 通过。模拟器验证事件和交互流程，不用于评价实体设备的马达手感。日志：`/tmp/dsh-voice-haptics-gradle.log`、`/tmp/dsh-voice-haptics-device.log`、`/tmp/dsh-voice-haptics-ios.log`。


## Android 持续长按与输入法冲突修复（2026-10-12）

语音在 100ms 后接管长按，但 BasicTextField 自身的原生长按选字手势此前已收到 down，继续持有时仍可能请求焦点与输入法。录音活动期间将文本框设为 disabled（保持挂载与草稿），同时清除焦点、隐藏键盘；语音手势在活动期间保持启用，避免迟到的 IME 状态取消持有手势。ASR 业务状态仍来自 KMM 公共层。

转写后的 focusEditor effect 先登记 UI 焦点请求，再于 Compose 提交恢复 enabled 后聚焦并显示键盘，避免文本框尚未恢复编辑时直接请求焦点。普通短按和语音结束后的文字修改继续走原生文本框。

验证：Android 17 Pixel_10 模拟器 8 项界面回归全部通过。新增用例先给真实文本框发送 down，再模拟录音硬件成功，持续持有 1200ms，验证文本框无焦点、IME 未出现、录音未被打断；随后发送真实 up，验证进入停止状态，再模拟转写回填并通过输入法编辑。其余用例覆盖 70ms 短按、160ms 长按前置检查、回填再编辑、发送收键盘及蒙层颜色/渐变。Debug 与 AndroidTest 编译、git diff --check 通过。测试仅使用本地会话、模拟采集及转写，不连接远端服务器或启用真实麦克风。日志：`/tmp/dsh-voice-gesture-fixed-final.log`。


## 触摸到蒙层的阶段耗时（2026-10-12）

没有把长按阈值继续降低来掩盖等待：公共层阈值仍为 100ms，淡入仍为 120ms。使用系统单调时钟及真实 MotionEvent 测量 Android 完整 ConversationScreen（14 条本地消息），保留原生编辑框、手势、触感和蒙层；替换权限回调，使其停留 authorizing，不打开麦克风或连接服务器。

最终一次 Android 17 模拟器测量：长按识别 107ms、发布 authorizing 108ms、权限检查 108ms、Canvas 蒙层首绘 170ms。独立页面 draw listener 记录 167ms，和实际 Canvas 首绘有约 3ms 的执行顺序差异。此前完整页面测量为 124ms 到权限回调、185ms 到 draw；这些是模拟器单次观测，不是用户真机的性能分位数，也不证明真机没有一秒延迟。

iOS 发现明确的主线程阻塞路径：VoiceInputAdapter.apply 在 MainActor 上同步调用 AVAudioSession.setActive、AVAudioEngine.prepare/start，蒙层状态虽已发布，绘制仍会等硬件调用返回。改为同一串行后台队列执行 start、stop 和 PCM Base64 编码；只有带录音 ID 的结果回到 MainActor，再由共享 Store 判断是否仍有效。启动期间取消会先结束 UI 状态，硬件启动完成后在队列中清理；迟到回调不能恢复已取消的录音。权限与采集器可在测试中替换，默认实现不变，ASR、超时、取消判定和草稿更新仍在 KMM 公共层。

iOS 新增回归模拟一秒同步硬件启动：gesture-dispatched uptime=274178.058896，overlay-mounted uptime=274178.062806，capture-start-begin uptime=274178.063235，capture-start-end uptime=274179.063994（1000.76ms）。蒙层提交发生在硬件启动之前；测试在约 108ms 检查主线程响应、starting 状态，并在硬件仍启动时取消。overlay-mounted 是 SwiftUI 挂载节点，不能冒称实际显示屏首帧；此测试从业务 press 调用开始，不含 UIKit 的实际触摸识别时间，也没有测量真机音频启动耗时。

Debug 阶段日志方便后续真机复现定位：Android Logcat tag 为 VoiceInputLatency，依次输出 touch-down、gesture-recognized、state-authorizing、permission-check、overlay-first-draw、capture-start-dispatched、state-recording；均为相对触摸的毫秒数。iOS 日志 subsystem 为 ai.dsh.mobile.ios，category 为 voice-input-latency，标记 VoiceInputLatency，输出触摸、识别、状态、蒙层挂载及 category/activate/prepare/start 的单调时钟和耗时。诊断不输出音频、转写或草稿；Release 不输出这些阶段日志。

验证：Android 9 项界面测试通过，iOS 11 项语音与输入框测试通过；包含持续长按不弹键盘、短按编辑、转写修改、蒙层及启动取消。Android 改动 adapter/panel/新增测试通过 ktlint，相关文件 git diff --check 通过；两端编译通过。日志：/tmp/dsh-voice-latency-android-final.log、/tmp/dsh-voice-latency-ios-traced.log。用户真机反馈的一秒延迟尚未通过设备阶段日志归因，不能直接宣称这就是其设备上的唯一原因。


## 浅深色模式的语音蒙层配色（2026-10-12）

两端根据当前有效主题选择相同配色。浅色录音保留品牌蓝（底色 #15335C、光晕 #2C5D9C），取消红色加深为玫瑰红（#DC8799 / #F0B1B8，前景 #642434）。深色录音使用低亮度蓝（#101F35 / #1B3B61，前景 #D4E1F1），取消使用暗玫瑰红（#4C2733 / #754050，前景 #F1D8DE），避免明亮粉红和纯白前景的强光感。Android 的 isSystemInDarkTheme 读取 DshTheme 提供的有效 LocalConfiguration，支持应用手动主题；iOS 读取 colorScheme。粒子大小、明暗扰动、收束、椭圆边缘和 ASR 公共逻辑保持原行为。

验证：两端编译通过，既有 Android 蒙层覆盖及取消配色回归通过；既有 iOS 截图用例扩展为浅/深色各三态，六张截图已导出并目视检查浅色取消、深色取消和深色录音，更新预览为可切换主题。Android 面板 ktlint、相关源码 git diff --check 通过。日志：/tmp/dsh-voice-theme-android.log、/tmp/dsh-voice-theme-ios.log。预览仍使用本地模拟音量，没有远端 ASR 联调。


## Android 系统导航区域白边（2026-10-12）

根因是 ConversationScreen 的 Scaffold 默认把系统导航栏底部 Insets 作为内容 padding，再由父 Column consume；蒙层位于该内容里的 HorizontalPager 中，不能绘制到被排除的导航区域。已有遮罩截图只截取自身 bounds，未包含系统导航区，因此没有发现白边。

将 Scaffold 的 contentWindowInsets 限制为横向 safeDrawing，TopAppBar 仍负责顶部安全区，页面背景及蒙层延伸到真实屏幕底边。Composer 原有 navigationBarsPadding/imePadding 继续保护可操作内容，并让测量高度包含其底部安全区；轨迹页单独保留 navigationBarsPadding，避免改变非语音内容的安全区。没有改动 KMM 语音业务、粒子或系统导航模式。

扩展既有 Android 蒙层测试，在和 MainActivity 一样的 edge-to-edge 窗口下，比较蒙层屏幕坐标和 UiAutomation 全屏截图高度，并验证最底部左右两侧实际像素是蓝色录音/红色取消背景。修复前该断言失败，修复后通过。手势导航下全部 9 项界面回归通过，三键导航下该配色/屏幕边界用例也通过；临时切换的模拟器系统导航模式已恢复。Debug/AndroidTest 编译、相关文件 git diff --check 通过。日志：/tmp/dsh-voice-navbar-before.log、/tmp/dsh-voice-navbar-after.log、/tmp/dsh-voice-navbar-threebutton.log。所有测试使用本地会话和模拟音量，不连接远端 ASR。

补充：已目视检查手势导航下的两张完整原生截图，蓝色/红色背景均覆盖导航手势条后方直至最底边；截图存入预览目录 voice-android-navigation-recording.png、voice-android-navigation-cancel.png，预览页面增加全屏截图链接。


## 扩展并平滑蒙层边缘（2026-10-12）

原渐变虽有 144pt/dp 高度，但完整不透明一直保持到归一化半径 0.68，实际变化集中于外侧约 46pt/dp，容易形成明显边界。现在两端渐变高度增至 224pt/dp，用 33 个采样点描述 smoothstep 透明度曲线；开始和结束的斜率为零，实际中心过渡宽度约 84pt/dp。椭圆横向半径保持视图宽度的 0.8，完全不透明半径设为 0.625，正好涵盖两侧与下方实色区的连接位置，避免在渐变底端产生横向接缝。

蒙层整体增高 80pt/dp（最小高度 320→400，输入区域上方额外高度 144→224），新增空间向上展开。文字和波形按原内容区域加 80pt/dp 偏移，保持距底部的位置；自由粒子的漂移和扰动参数沿用原值。输入区与系统导航区仍由下方实色部分完全覆盖；浅深色配色保持上一版。

验证：Android 8 项现有界面回归通过，包括椭圆边缘、淡入淡出、全屏导航区覆盖、长按和编辑；iOS 原生截图用例生成浅/深色六态，两端构建通过，Android 面板 ktlint 和相关文件 git diff --check 通过。已检查 iOS 讲话/深色取消及 Android 全屏录音截图，更新六张主题预览、两张 Android 全屏截图和图片缓存版本。日志：/tmp/dsh-voice-soft-edge-android.log、/tmp/dsh-voice-soft-edge-ios.log、/tmp/dsh-voice-soft-edge-screenshots.log。没有修改公共层 ASR 或触发阈值。


## 转写只回填，不主动聚焦（2026-10-12）

根据最新交互要求，ASR 转写结果填入草稿后保持未聚焦、键盘收起，只有用户点选输入框才进入编辑。KMM SharedVoiceInputStore 的 acceptTranscript 与 insertPending 均不再发出 focusEditor effect；删除 Android/iOS adapter 与页面里的对应回调，Android 保留录音期间的失焦/隐藏键盘保护，不在录音结束时安排聚焦。其他来源的用户主动编辑（例如队列草稿恢复）保留原行为。

更新既有回归：共享层验证自动回填及冲突后的手动插入都不请求焦点；Android 真实会话验证结果已写入、未聚焦、IME 未出现，随后真实触摸短按输入框才显示键盘并修改文字；持续长按松手后的回填同样验证。iOS 真实会话页与原生 UITextView 验证回填后不是 firstResponder，用户主动调用原生聚焦路径后能够编辑和处理 marked text，迟到的键盘隐藏通知也不能打断新编辑会话。

验证：KMM 259 项公共测试、Android 8 项会话界面回归、iOS 11 项语音与输入框回归全部通过；两端编译、修改共享源码/测试及 Android adapter 的 ktlint、相关文件 git diff --check 通过。日志：/tmp/dsh-voice-no-autofocus-gradle.log、/tmp/dsh-voice-no-autofocus-ios.log。测试使用本地会话及模拟转写，无远端 ASR 联调。

## 紧凑蒙层与短词录音完整性（2026-10-13）

Android 按屏幕高度、iOS 按所在 UIWindow 高度将语音蒙层限制为四分之一，包括底部系统导航区域。渐变占蒙层高度的 60%，文字和波形随之缩紧；底部普通输入区在录音期间仅隐藏绘制，保持挂载与手势链。移除 iOS 语音授权、启动、转写状态的 ProgressView；两端正常淡入为 320ms、淡出为 280ms，iOS 减弱动态效果设置下保持短过渡。椭圆渐变按设备像素对齐，iOS 实色区额外重叠一个像素，避免小尺寸下出现横向接缝。粒子的自由漂移与波形扰动沿用原参数。

短词问题的业务修正在 KMM 公共层：不再用 200ms 作为音频提交下限，非空且完整的 PCM16 交给官方识别；正常松手保留 200ms 采集尾段，取消仍立即停止并丢弃。用户在硬件 starting 阶段松手时进入 stopping，等待同一录音 ID 的启动回调，再停止并提交已有缓冲，不再直接 discard。未获授权就松手仍取消，不允许迟到权限开启录音。官方目录明确声明支持 auto 时本次请求采用自动语言，否则沿用原选择；不修改桌面插件的全局语言或 VAD 配置。两端适配器仅执行共享层提供的延迟停止效果。

用户报告 iOS 单说 Hello 返回“未识别到人声”，句中 Hello 会漏掉，但 Good morning 可识别。检查安装版本 0.2.0-rc.2 的官方 Web 录音路径发现，它等待 MediaRecorder 最后一块数据，不存在移动端此前的 200ms 提交门槛。官方 SenseVoice worker 使用 Silero VAD 分段，其默认 minSpeechSeconds 为 0.25 秒。

通过本机已下载模型临时启动官方 worker，以 macOS Samantha 合成音频进行离线检查：保留完整发音、去首尾低电平的 Hello 样本约 0.49 秒，auto/zh 均返回 Hello；截去开头 200ms 后两种语言均返回空结果，额外添加 200ms 静音不能恢复丢失的开头。其他样本存在 Yello、漏词等模型误差。这些结果说明短词对音频完整性敏感，但不能证明用户真机的唯一根因，也不能宣称真实 Hello 问题已完全解决。测试未使用用户录音，未改动运行中的官方服务、模型或配置；临时 worker 已退出。实际 iPhone 录音与远端转写效果仍待复测。

验证：KMM 261 项公共测试、Android 8 项会话回归、iOS 11 项语音/输入框回归通过。最终像素修正后，Android 全屏蒙层单测与 iOS 六态截图单测再次通过；六张原生预览已更新。网关官方 API 合同测试通过（真实官方验证器，识别器使用替身）。改动公共 Kotlin、Android 面板/适配器通过 ktlint，相关文件 git diff --check 通过。模拟器使用本地会话与模拟转写，不能代替带设备签名的真机远端联调。日志：/tmp/dsh-compact-voice-gradle.log、/tmp/dsh-compact-voice-ios.log、/tmp/dsh-compact-voice-final-android.log、/tmp/dsh-compact-voice-seam-ios.log。

## 缩短触摸到蒙层显现的等待（2026-10-13）

上一版 320ms 淡入采用慢起步的 easeInOut 曲线，初段透明度很低，放大了等待感。两端从 KMM 读取的长按判定由 100ms 缩短到 80ms，淡入由 320ms 缩短到 160ms；入场采用 cubic-bezier(0,0,0.2,1)，前段迅速显现、后段平滑收尾。Android 使用 LinearOutSlowInEasing，iOS 页面与慢启动测试共用 voiceOverlayAnimation。淡出保持 280ms；iOS 减弱动态效果时使用 80ms 线性过渡。授权及录音启动前已发布蒙层状态，后台采集仍不阻塞 UI。

Android 原生界面回归增加淡入前 32ms 的不透明度断言（超过最终效果的 25%，同时低于 90%，兼顾即时反馈和动画），保留 70ms 短按、持续长按不弹键盘、回填后点击编辑等回归。Android 17 模拟器一次真实 MotionEvent 测量记录：权限回调约 73ms，页面 draw listener 约 83ms，实际蒙层 Canvas 首绘约 100ms。draw listener 不是蒙层首绘，Canvas 首绘也不是实体显示屏的呈现时刻；测试时权限保持等待、没有打开麦克风或连接远端，不代表真机性能分位数。

验证：公共层 261 项、Android 9 项、iOS 11 项测试全部通过。iOS 一秒硬件启动替身测试使用实际入场动画，验证蒙层挂载与主线程响应在硬件完成前发生，并保留取消/迟到回调保护；该用例从业务 press 开始，不含实际 UIKit 触摸识别耗时。共享参数及 Android 延迟测试 ktlint、git diff --check 通过，原生两端编译通过。预览文字参数已同步。日志：/tmp/dsh-voice-response-20261013-gradle.log、/tmp/dsh-voice-response-20261013-ios.log。

## 蒙层高度调整为五分之二（2026-10-13）

按最新要求，将高度比例从四分之一改为五分之二（40%），由公共层 VoiceInputInteraction.OVERLAY_HEIGHT_FRACTION 统一提供。Android 按屏幕高度、iOS 按 UIWindow 高度应用同一比例，文字、粒子与椭圆渐变随蒙层尺寸展开。长按 80ms、快速淡入 160ms、淡出 280ms 及 ASR 逻辑保持原行为。

验证：两端编译通过；Android 原生蒙层单测验证 40% 高度与底部系统导航区覆盖，iOS 原生截图单测验证新高度并生成浅深色六态，均通过。已更新六张 iOS 预览与两张 Android 全屏截图，目视确认布局和底部覆盖；共享参数 ktlint 与 git diff --check 通过。日志：/tmp/dsh-two-fifths-android.log、/tmp/dsh-two-fifths-ios.log。

## 首次有声后保持波形与 iOS 尾部采样收尾（2026-10-13）

原先公共层在最后一次有效音量后的 600ms 将 waveformActive 复位，表现为波形退回自由粒子；这条路径只控制视觉状态，并没有停止录音。根据最新要求，移除静音保持计时，以现有 waveformActive 锁定本次录音是否已经进入波形：首次有效音量前自由漂浮，首次有声后保持波形直到录音结束。level 继续接收真实音量并平滑降低振幅，tick 不再因静音解除波形。上滑进入红色取消区再滑回蓝色同样保留波形；取消、松手、下一次录音及迟到旧录音回调的隔离仍生效。公共层回归验证说话后长停顿保持 recording，期间没有 stop effect 或转写请求，继续说话后仅在松手时提交整段 PCM，首尾字节完整。

iOS 实时采样转换原先只在下一块数据暂未到达时返回 noDataNow，停止时直接取已写入的 PCM，没有指示转换器结束输入。[Apple 的 AVAudioConverter 结束输入接口](https://developer.apple.com/documentation/avfaudio/avaudioconverterinputstatus/endofstream) 与当前 SDK 头文件说明：部分输入可能缓存到更多输入到达或 endOfStream 时才输出。现在 Capture 保留同一转换器，音频 tap 停止后在同一采集队列与锁内发送 endOfStream，取完尾部 PCM 后再返回录音结果；取消仍直接丢弃，转换失败显式报告，不提交不完整结果。正常松手的 200ms 采集尾段保持原值。这修复了一条确实会遗漏尾部样本的客户端路径，但不证明它是用户末尾漏字的唯一原因，也不保证官方模型逐字识别正确。

验证：KMM 262 项、Android 8 项、iOS 12 项测试全部通过。新增 iOS 硬件转换单测使用 48kHz 浮点合成输入，最后 24 帧有声，验证 16kHz PCM16 转换结束时有声尾部缓存被输出、总采样数量正确、重复结束没有重复数据。两端编译、共享源码与测试 ktlint、git diff --check 通过。原生预览扩展为浅深色各四态，新增说话后停顿的低振幅波形，首次说话前仍保持散乱粒子；目视确认新状态。日志：/tmp/dsh-voice-latched-20261013-gradle.log、/tmp/dsh-voice-latched-20261013-ios.log。测试没有真实麦克风或远端 ASR 联调，真机末尾漏字仍需复测。

## 短句 ASR 输入上下文与弱音量处理（2026-10-13）

用户报告 Android 简短“你好”及连续“你好”无法识别。本地官方 worker 对完整合成录音复现：正常音量约 0.529 秒“你好”返回空，连续三个“你好”漏掉一个，句首“你好”也会丢失。只加尾部静音或只提高音量不能解决所有样本，200ms 首部静音为 VAD 提供开头上下文后正常音量恢复；较弱输入结合增益才完整。此处是离线证据支持的输入边界问题，不是确认用户真机的唯一原因。

新增 KMM VoiceAudioFormat.prepareRecognitionPcm，captureFinished 在封装 WAV 前统一执行：增加 200ms 首部与 500ms 尾部静音，对峰值在 128..8191 的 PCM16 且峰均比至少 3 的输入施加整段固定增益，目标峰值 16384，最多 8 倍。正常音量、近零输入和低峰均比持续噪声保持原值，官方 VAD 与 ASR 仍负责最终人声识别。补静音只使用官方字节/时长限制内的剩余空间，不为增加上下文截掉已录发音；正常松手 200ms 硬件尾段与蒙层时机保持原行为。padding 是内存中补零，不增加麦克风启动等待；识别音频有额外静音长度及字节量。

验证：公共层 268 项通过，六项新音频回归覆盖首尾静音、原样保留正常发音、固定增益、增益上限、近零/持续噪声保护以及官方限额。Android 8 项交互回归通过，最终共享代码 Android 编译通过；iOS 使用最终框架的 12 项回归通过，ktlint 和 git diff --check 通过。真实编译 KMM 产生的 WAV 经网关测试适配器送入本地官方原生识别器，五个短句的三档音量正样本全部完整，静音和持续噪声负样本均为空；检测到的候选增益误识别问题已通过峰均比条件修正。

详细证据与范围见 [短句离线证据](voice-input-short-utterance-evidence/README.md)。没有修改官方 VAD 阈值或运行插件配置；没有进行用户真机录音/设备签名远端联调，因此不能宣称所有短句问题完全消失。日志：/tmp/dsh-short-speech-20261013-final-gradle.log、/tmp/dsh-short-speech-20261013-gradle.log、/tmp/dsh-short-speech-20261013-final-ios.log。

## 抬手即退出蒙层，后台完成转写（2026-10-14）

此前 UI 使用 SharedVoiceInputSnapshot.active 作为蒙层显示条件，该属性包含 stopping 和 transcribing，因此抬手后还会显示整理录音/转写状态。新增公共层 overlayVisible，只有 authorizing、starting、recording 显示录音蒙层；active 继续表示后台任务有效，用于请求 ID、超时、取消及防止同时启动另一项转写。正常松手切换到 stopping 时立即开始原有 280ms 淡出，之后保持普通输入框；不显示录音收尾、转写文案或处理按钮。后台阶段 status 返回空字符串，平台不保留并行 ASR 业务状态。

Android 和 iOS 的蒙层、底部普通输入区隐藏及触摸保护改用 overlayVisible；Android 文本框恢复 enabled，焦点与键盘由用户主动点击决定。后台阶段不让语音长按接管原生文本编辑；成功后按原有草稿冲突策略回填，不主动聚焦。Android 淡出缓存只更新仍可见的录音快照，避免退出时闪过处理状态或切换颜色；两端删除转写阶段的取消按钮。异常 Alert、无人声短 Toast 和录音尾段/采样转换收尾保持原行为。

验证：公共层新增正常松手后蒙层关闭而请求仍有效的回归，并覆盖启动阶段松手；Android 8 项原生交互测试通过，包含真实 up 后淡出、后台文本框可用、无处理文案、持续长按不弹键盘及回填后编辑；iOS 新增真实 SwiftUI 蒙层生命周期回归，抬手后 onDisappear 发生、后台转写随后回填而不自动弹键盘。两端构建、相关 Kotlin ktlint 和 git diff --check 通过。日志：/tmp/dsh-background-transcription-20261014-gradle.log、/tmp/dsh-background-transcription-20261014-ios.log。测试使用模拟器本地会话和采集替身，没有真实远端 ASR 联调。

## 晕影外侧背景色渐变（2026-10-14）

在彩色椭圆蒙层后方增加独立的外层渐变。浅色使用白色，深色使用当前页面背景色，避免明亮白边。外层横向半径为宽度的 0.98，较原彩色层的 0.8 更宽；纵向半径沿用蒙层高度的 0.6。归一化半径 0.78 到 1 使用 33 点 smoothstep 渐变，边缘斜率平滑归零。白色衬层先淡化边缘下的会话文字，再与内层蓝色/红色渐变融合，保持底部覆盖、40% 高度和原有入退场动画。

验证：两端编译通过；Android 原生椭圆、淡入淡出及导航区覆盖两项回归通过，iOS 浅深色四态截图单测通过。额外生成浅深色文字重叠预览，目视检查文字逐渐淡化及深色无亮白边；更新八张状态预览、两张文字背景示例和 Android 全屏截图。Android 面板 ktlint、git diff --check 通过。未修改 KMM 录音、转写或状态机。日志：/tmp/dsh-voice-outer-halo-20261014-android.log、/tmp/dsh-voice-outer-halo-20261014-ios.log。

## 提前采集与真实麦克风就绪门控（2026-10-14）

此前长按确认后才启动硬件，且蒙层先于麦克风实际收到 PCM 显示；用户按动画开始说话时，硬件尚未就绪。Android 读取循环还会逐块等待主线程执行音量回调，首绘等 UI 工作可能阻塞后续采集。本次将共享层的 captureStarted 统一定义为首批 PCM 已写入缓冲，只有长按已确认且首批采样已收到，才进入 recording、显示蒙层并触发开始触感。尚在授权或硬件启动时保护输入，但不假显示可录音状态。

已授权、会话连接且官方语音服务就绪时，真实手指 down 立即进入公共层 priming 并预采集，80ms 长按确认复用同一录音 ID 和已有样本；短按、手势失败或取消丢弃预采集，不发送转写请求。未授权的短按不请求权限，长按后才走原授权流程。UIKit 用原生手势的 touchesBegan/Ended/Cancelled 传递触摸边界，Android 在指针手势 finally 清理未确认的预采集；仍由 KMM 管理状态、录音 ID、权限结果、松手收尾和迟到回调隔离。

会话内已授权时提前准备硬件资源，空闲时不启动麦克风或保存音频；离开会话或进入后台释放。Android 复用停止后的 AudioRecord，按公共层 20ms 窗口读取，写入 PCM 后只向主线程排队就绪和音量通知，读取线程不等待 UI；资源 generation 防止释放后的旧任务重新缓存设备。iOS 串行队列提前 prepare AVAudioEngine，申请 10ms I/O 时长并按 20ms 请求 tap 缓冲，保留转换器 EOS 收尾。系统偏好和 tap 大小不保证设备实际采用该周期，真实首批 PCM 才是就绪依据。[Android 读取接口](https://developer.android.com/reference/android/media/AudioRecord)、[Apple I/O 时长偏好](https://developer.apple.com/documentation/avfaudio/avaudiosession/setpreferrediobufferduration(_:))、[Apple engine.prepare](https://developer.apple.com/documentation/avfaudio/avaudioengine/prepare())。

验证：最终公共层 274 项、Android 11 项相关回归、iOS 15 项相关回归全部通过；覆盖按下提前采集、首采样前不显示蒙层、长按复用启动、首部样本保留、短按丢弃、取消后的迟到回调和原生编辑行为。两端构建、相关 Kotlin ktlint 和客户端 git diff --check 通过。日志：/tmp/dsh-mic-readiness-20261014-common-final.log、/tmp/dsh-mic-readiness-20261014-gradle.log、/tmp/dsh-mic-readiness-20261014-final-gradle.log、/tmp/dsh-mic-readiness-20261014-verified-ios.log；中途新增公共层用例曾将原有 stopTicker 清理效果误判为多余，修正断言后最终全部通过。

这些测试使用本地会话和采集替身，不包含真机麦克风冷启动或设备签名远端联调。新增 first-pcm 日志用于实体设备核对触摸、硬件启动和实际收到采样之间的耗时；iOS 该耗时包含音频会话配置、激活及 engine 启动。预览说明已同步采集与显示时机，蒙层外观保持原参数。

## iOS 进入会话时预热崩溃（2026-10-14）

用户真机日志在进入会话后出现 `com.apple.coreaudio.avfaudio`，断言为 `inputNode != nullptr || outputNode != nullptr`。上一轮新增的 IOSVoiceRecorder.prepare 在新建 AVAudioEngine 上直接调用 prepare，没有先访问按需创建的输入节点；Swift try? 只能处理 NSError/Swift Error，不能兜住该 NSException。此前采集替身的 prepare 默认无操作，没有覆盖真实引擎的这个初始化条件。

修复为配置音频会话后先建立 engine.inputNode，再检查硬件输入格式的采样率及声道数；不可用时跳过空闲预热，实际长按仍走原有启动与错误处理。格式有效时才执行 engine.prepare。release 补充 engine.stop 后 reset，并停用可能被 prepare 隐式激活的音频会话。保留按下预采集、首批 PCM 就绪后显示蒙层及 KMM 状态管理。

新增真实 AVAudioEngine 回归，不使用采集替身，覆盖冷引擎、重复预热、释放后再预热三个循环，确认输入节点存在、engine 未运行且没有录音缓冲。修复前该用例复现与用户日志一致的断言并失败；修复后 iOS 语音与输入框共 16 项测试通过，构建与 git diff --check 通过。本机模拟器原生输入格式为 0 Hz，验证了不可用格式安全退出路径及节点建立；格式有效时的真机预热及带设备签名的远端会话仍需真机复测。日志：/tmp/dsh-mic-prewarm-crash-20261014-before.log、/tmp/dsh-mic-prewarm-crash-20261014-after.log。

## 按录音启动成功反馈，不再等待首批 PCM（2026-10-14）

用户反馈首 PCM 门控使蒙层再次变慢。首批缓冲交付和采样转换不等于硬件开始采集；将二者合并会在系统已经录音后增加显示等待。本次保留 KMM 的长按确认与硬件就绪两个条件，平台的 ready/started 改为系统录音启动成功并确认运行状态：iOS engine.start 成功且 isRunning，Android startRecording 成功且 RECORDSTATE_RECORDING。此时系统已启用音频流，后续首批缓冲继续完整写入；不把蒙层提前到硬件尚未启动的阶段。first-pcm 仅作为独立诊断日志，80ms 手势判定、160ms 入场与200ms 尾段保持原值。

iOS prepareSession 提前配置并激活会话，准备缓存复用到下一次手指 down；正常 stop 保留会话激活，release 在离开/后台停用会话与释放引擎。中断、路由变化及媒体服务重置会使准备缓存失效，下次启动重新准备；空闲不运行引擎或写入音频。新增受锁硬件请求 token，使短按撤销的排队 start 直接跳过，不再等待预热完成后把过期录音启动一遍。采集业务、草稿与 ASR 状态仍由 KMM 负责，平台只保存硬件准备与命令有效性。

验证：iOS 17 项、Android 11 项相关原生回归通过，覆盖录音运行但尚无音量回调时显示蒙层、首部采样保留、短按丢弃、取消排队启动、真实引擎冷预热/释放后再预热以及原生文本编辑。两端构建、Android Kotlin ktlint 与 git diff --check 通过；未改变共享业务状态机，因此不重复运行全部公共层测试。没有真机分位耗时或远端联调。日志：/tmp/dsh-mic-start-confirmation-20261014-ios.log、/tmp/dsh-mic-start-confirmation-20261014-android.log。第三方 IPA 的静态复查、REA Evidence ID、超时限制及未确认项单独保留在被忽略的 `voice-input-ipa-evidence/startup-20261014/README.md`。

## 长按、上滑与抬手三个触感节点（2026-10-14）

按最新要求，KMM 在有效长按 press 成立时立即发出 hapticStart，不等待硬件 ready 或蒙层出现；captureStarted 只更新采集状态，不重复震动。上滑跨入取消区发出 hapticCancel，留在区域内连续移动不重复，滑回后再次进入才重新反馈；有效长按 release 发出一次 hapticRelease，正常转写和上滑取消后抬手均适用。短按和系统自动停止不模拟长按/抬手触感。

Android 保留平台 LONG_PRESS、CLOCK_TICK、KEYBOARD_TAP 三种映射，iOS 保留原 impact/selection 映射，并在真实 down 时 prepare 开始触感生成器。状态与去重均在 KMM，两端只执行硬件效果。公共层 274 项、Android 三项采集平台回归、iOS 17 项语音/原生输入回归通过；新 Android 用例验证硬件仍处于 starting 时已经收到长按触感，以及完整的 start/cancel/release 顺序。Kotlin ktlint 与 git diff --check 通过。日志：/tmp/dsh-voice-three-haptics-20261014-gradle.log、/tmp/dsh-voice-three-haptics-20261014-ios.log。模拟器验证触发事件和去重，实体马达强度没有实测。

## iOS 录音期间触感被系统抑制（2026-10-14）

用户反馈 iOS 三个节点均感受不到震动。检查发现 IOSVoiceRecorder 配置了音频输入，但未调用 setAllowHapticsAndSystemSoundsDuringRecording(true)。该开关默认 false，音频输入期间系统可抑制 UIKit 触感；此前公共层和平台替身只证明事件发出，没有检查真实音频会话配置。来源：[Apple 录音触感开关](https://developer.apple.com/documentation/AVFAudio/AVAudioSession/allowHapticsAndSystemSoundsDuringRecording)，本机 AVAudioSession.h 第 111–116 行也明确说明默认值 NO。

prepareSession 在配置 record 类别后、激活会话和启动预采集前，明确允许录音触感；准备缓存的复用条件也检查 allowHapticsAndSystemSoundsDuringRecording，避免其他配置关闭后仍跳过恢复。三个原有触感节点和强度保持原值，新增 Debug 日志 VoiceInputHaptic 的 cue、recordingAllowed 字段用于核对系统配置；日志只说明请求发出和开关状态，不证明实体马达实际播放。

新增真实 AVAudioSession 回归，主动从 false 开始，覆盖冷准备、缓存复用、释放后重新准备，并在测试结束恢复原开关。修复前四个断言均失败，修复后该用例与原有语音/输入框共 18 项测试全部通过；构建、git diff --check 通过。日志：/tmp/dsh-ios-recording-haptics-20261014-before.log、/tmp/dsh-ios-recording-haptics-20261014-after.log。本轮修复明确的系统配置缺失，模拟器无法验证实体马达效果，真机仍需使用新构建复测。
