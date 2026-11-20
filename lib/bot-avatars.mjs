import { createHash } from 'node:crypto'
import { lookOf, shapeOf, bodyOf, PICKER_SHAPES, CHARACTER_COLORS } from './vendor/ds-bot/characters.mjs'
import { GRADIENTS, INKS, inkFill } from './vendor/ds-bot/inks.mjs'

// 公开状态中的外形与颜色，对应 Web UI 的默认角色头像。
export function defaultAvatar(bot) {
  const { shape, color } = lookOf(bot)
  const def = shapeOf(shape)
  const stops = Object.hasOwn(GRADIENTS, color) ? GRADIENTS[color] : undefined
  const gradient = stops ? `<defs><linearGradient id="ink" x1="0" y1="0" x2="1" y2="1">${stops.map(([p,c]) => `<stop offset="${p}" stop-color="${c}"/>`).join('')}</linearGradient></defs>` : ''
  const paint = inkFill(color)
  const namedInk = /^var\(--bt-ink-([a-z]+)\)$/.exec(paint)?.[1]
  const fill = namedInk ? INKS[namedInk][0] : paint
  const eyes = def.eyes.map(([x,y,w,h,tilt]) =>
    `<rect x="${-w/2}" y="${-h/2}" width="${w}" height="${h}" rx="${w/2}" transform="translate(${x} ${y}) rotate(${tilt})" fill="#fff"/>`).join('')
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100" viewBox="0 0 100 100">${gradient}${bodyOf(def, stops ? 'url(#ink)' : fill)}${eyes}</svg>`
  const image = 'data:image/svg+xml;base64,' + Buffer.from(svg).toString('base64')
  return { botId: bot.id, ref: createHash('sha256').update(image).digest('hex').slice(0,16), image }
}

// 形象选择和聊天头像复用同一套 SVG，客户端可即时切换外形和配色。
let catalog
export function botAppearanceCatalog() {
  return catalog ??= {
    colors: CHARACTER_COLORS.map(id => ({ id, stops: GRADIENTS[id]?.map(([, hex]) => hex) ?? [INKS[id][0]] })),
    shapes: PICKER_SHAPES.map(id => ({
      id,
      images: Object.fromEntries(CHARACTER_COLORS.map(color => [color, defaultAvatar({ id, color, avatar: { shape: id } }).image])),
    })),
  }
}
