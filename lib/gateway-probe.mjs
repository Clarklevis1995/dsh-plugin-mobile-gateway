// Echo only a strictly bounded, non-secret challenge on an unauthenticated
// rejection. This does not authorize a device or expose management data.
export function gatewayProbeHeader(value) {
  return typeof value === 'string' && /^[a-f0-9]{32}$/.test(value)
    ? `X-DSH-Gateway-Probe: ${value}\r\n` : ''
}
