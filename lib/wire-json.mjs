// Host 的摘要截断可能留下单个 UTF-16 代理项。JSON.stringify 会将其转义，
// 但 Swift/Foundation 仍拒绝整帧；在传输边界统一输出有效 Unicode。
// 不修改原对象、历史正文、有效 emoji 或字面量反斜杠转义文本。
export function stringifyWireFrame(frame) {
  return JSON.stringify(frame, (_key, value) =>
    typeof value === 'string' ? value.replace(/[\uD800-\uDFFF]/gu, '\uFFFD') : value)
}
