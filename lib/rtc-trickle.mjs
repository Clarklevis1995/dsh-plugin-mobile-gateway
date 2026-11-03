// werift 0.25.2 的 setLocalDescription 在 gatherCandidates 返回后才启动 ICE/DTLS。
// 协议 v1 每个 Peer 只协商一次；局部适配此固定版本，保留原有 SDP 校验、
// 候选收集、连接和证书校验，仅在首个候选可用时允许后续握手并行推进。
export function enableTrickleIce(pc, onFailure) {
  if (typeof pc.gatherCandidates !== 'function' || typeof pc.onIceCandidate?.subscribe !== 'function')
    throw new Error('unsupported RTC gathering API')
  const gather = pc.gatherCandidates.bind(pc)
  const addCandidate = pc.addIceCandidate.bind(pc)
  const close = pc.close.bind(pc)
  let gathering, startup, subscription, release, closed = false
  const unsubscribe = () => { subscription?.unSubscribe(); subscription = null }
  pc.gatherCandidates = () => {
    if (closed) return Promise.reject(new Error('RTC peer closed'))
    if (startup) return startup
    // 已在 SDP 宣告候选结束的非增量客户端沿用完整收集，避免提前耗尽检查列表。
    if (/(?:^|\r?\n)a=end-of-candidates(?:\r?\n|$)/.test(pc.remoteDescription?.sdp || '')) {
      gathering = Promise.resolve().then(gather)
      startup = gathering
      return startup
    }
    const firstCandidate = new Promise(resolve => { release = resolve })
    subscription = pc.onIceCandidate.subscribe(candidate => { if (candidate) release() })
    // 先安装监听，再启动收集，避免快速的 host 候选事件丢失。
    gathering = Promise.resolve().then(gather)
    gathering.catch(() => { if (!closed) onFailure() })
    startup = Promise.race([gathering, firstCandidate]).finally(unsubscribe)
    return startup
  }
  pc.addIceCandidate = async candidate => {
    // 远端 EOC 可能早于本端 STUN 候选。不要让 ICE 在仍有本地候选时过早判死。
    // 普通候选立即交给原实现，成功路径无需等待这个后台收尾任务。
    if (!candidate?.candidate && gathering) await gathering
    if (closed) throw new Error('RTC peer closed')
    return addCandidate(candidate)
  }
  pc.close = async () => {
    closed = true
    unsubscribe()
    release?.()
    return close()
  }
}
