import { EventEmitter } from 'node:events'
import { websocketRtt } from './network-diagnostics.mjs'

export class WebSocketMobileTransport extends EventEmitter {
  kind = 'websocket'
  constructor(socket, { intercept } = {}) {
    super()
    this.socket = socket
    this.message = (data) => {
      if (!intercept?.(data)) this.emit('message', data)
    }
    this.closed = () => {
      socket.off('message', this.message)
      socket.off('close', this.closed)
      this.emit('close')
    }
    socket.on('message', this.message)
    socket.on('close', this.closed)
    // 网络错误由 close 统一结束生命周期，避免未处理 error 终止整个网关。
    socket.on('error', () => {})
  }
  get readyState() {
    return this.socket.readyState
  }
  send(wire) {
    if (this.readyState === 1) this.socket.send(wire)
  }
  probeNetwork(options) { return websocketRtt(this.socket, options) }
  close(code, reason) {
    this.socket.close(code, reason)
  }
}
