const markerText = (value, max, empty = false) => typeof value === 'string' && !value.includes('\0') && value.length <= max && (empty || value.trim().length > 0)
const coordinate = (a, lat = 'latitude', lon = 'longitude') => Number.isFinite(a[lat]) && a[lat] >= -90 && a[lat] <= 90 && Number.isFinite(a[lon]) && a[lon] >= -180 && a[lon] <= 180
export function appleMusicArtworkURL(value) {
  if (typeof value !== 'string' || value.length > 2048) return null
  try {
    const url = new URL(value)
    if (url.protocol !== 'https:' || !(url.hostname === 'mzstatic.com' || url.hostname.endsWith('.mzstatic.com')) || url.username || url.password || url.port || url.hash) return null
    return url.href
  } catch { return null }
}
const androidArtwork = value => typeof value === 'string' && /^content:\/\/media\/external\/audio\/albumart\/[1-9][0-9]{0,18}$/.test(value)
const musicDetails = (row, android = false) => (row.artworkURL === undefined || (android ? androidArtwork(row.artworkURL) : appleMusicArtworkURL(row.artworkURL) !== null)) &&
  (row.durationSeconds === undefined || (typeof row.durationSeconds === 'number' && Number.isFinite(row.durationSeconds) && row.durationSeconds >= 0 && row.durationSeconds <= 86400))
export function appleMusicURL(value) {
  if (typeof value !== 'string' || value.length > 4096) return null
  try {
    const url = new URL(value)
    if (url.protocol !== 'https:' || url.hostname !== 'music.apple.com' || url.username || url.password || url.port || url.hash) return null
    const parts = decodeURIComponent(url.pathname).split('/').filter(Boolean)
    if (/^[a-z]{2}$/.test(parts[0])) parts.shift()
    if (parts.length < 2 || parts.length > 3 || !['song', 'album', 'artist', 'playlist'].includes(parts[0])) return null
    if (!(parts[0] === 'playlist' ? /^pl\.[A-Za-z0-9._-]{1,200}$/ : /^[0-9]{1,20}$/).test(parts.at(-1))) return null
    const songs = url.searchParams.getAll('i')
    if (songs.length > 1 || songs.some(id => !/^[0-9]{1,20}$/.test(id))) return null
    url.search = ''
    if (songs.length) url.searchParams.set('i', songs[0])
    return url.href
  } catch { return null }
}
const libraryId = value => typeof value === 'string' && value.startsWith('library:') && value.length > 8 && value.length <= 208 && !/[\x00-\x1f\x7f]/.test(value)
const uuid = value => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
const offsetDate = value => typeof value === 'string' && value.length <= 40 && /^\d{4}-\d\d-\d\dT.*(?:Z|[+-]\d\d:\d\d)$/.test(value) && Number.isFinite(Date.parse(value))
const validZone = value => { if (typeof value !== 'string' || value.length > 80 || !value) return false; try { new Intl.DateTimeFormat('en', { timeZone: value }); return true } catch { return false } }
const object = value => value && typeof value === 'object' && !Array.isArray(value)
const text = (value, max = 128) => typeof value === 'string' && value.trim().length > 0 && value.length <= max
export function validateArguments(tool, args) {
  if (!object(args)) return false
  const allowed = {
    'calendar.create': ['operationId', 'title', 'start', 'end', 'timeZone', 'notes', 'location', 'allDay', 'alertMinutesBefore'],
    'reminders.create': ['operationId', 'title', 'dueDate', 'timeZone', 'notes', 'priority', 'notify'],
    'alarms.open-create': ['operationId', 'title', 'fireDate', 'timeZone'],
    'alarms.create': ['operationId', 'title', 'fireDate', 'timeZone'], 'alarms.list': [], 'alarms.cancel': ['operationId', 'alarmId'],
    'calendar.busy': ['start', 'end', 'timeZone'], 'reminders.list': ['start', 'end', 'timeZone'],
    'location.precise': ['maxAgeSeconds'],
    'maps.search': ['query', 'latitude', 'longitude', 'radiusMeters', 'limit'], 'maps.geocode': ['address', 'limit'],
    'maps.reverse-geocode': ['latitude', 'longitude'],
    'maps.directions': ['startLatitude', 'startLongitude', 'endLatitude', 'endLongitude', 'transport'],
    'maps.open': ['latitude', 'longitude', 'name', 'mode', 'transport'],
    'maps.markers.create': ['operationId', 'name', 'latitude', 'longitude', 'address', 'notes'],
    'maps.markers.list': ['query', 'offset', 'limit'],
    'maps.markers.update': ['operationId', 'markerId', 'name', 'latitude', 'longitude', 'address', 'notes', 'expectedRevision'],
    'maps.markers.delete': ['operationId', 'markerId', 'expectedRevision'],
    'location.current': ['requestedPrecision', 'maxAgeSeconds'], 'photos.select': [],
    'music.catalog-search': ['query', 'limit'], 'music.library': ['kind', 'query', 'offset', 'limit'], 'music.play-library': ['kind', 'itemId'],
    'music.search': ['query'], 'music.state': [], 'music.play': ['itemId'], 'music.pause': [], 'music.seek': ['seconds'],
    'health.daily-summary': ['start', 'end', 'timeZone'],
  }[tool]
  if (!allowed || Object.keys(args).some(key => !allowed.includes(key))) return false
  if (['calendar.busy', 'reminders.list', 'health.daily-summary'].includes(tool)) {
    if (![args.start, args.end].every(v => text(v, 40) && /^\d{4}-\d\d-\d\dT.*(?:Z|[+-]\d\d:\d\d)$/.test(v))) return false
    const a = Date.parse(args.start), b = Date.parse(args.end)
    if (!Number.isFinite(a) || !Number.isFinite(b) || b <= a || b - a > 8 * 86400000 || !text(args.timeZone, 80)) return false
    try { new Intl.DateTimeFormat('en', { timeZone: args.timeZone }) } catch { return false }
  }
  if (tool === 'location.current' && ((args.requestedPrecision !== undefined && args.requestedPrecision !== 'coarse') || (args.maxAgeSeconds !== undefined && (!Number.isInteger(args.maxAgeSeconds) || args.maxAgeSeconds < 1 || args.maxAgeSeconds > 300)))) return false
  if (tool.startsWith('maps.markers.')) {
    if (tool === 'maps.markers.list') return (args.query === undefined || markerText(args.query, 200)) &&
      (args.offset === undefined || (Number.isInteger(args.offset) && args.offset >= 0 && args.offset <= 2147483647)) &&
      (args.limit === undefined || (Number.isInteger(args.limit) && args.limit >= 1 && args.limit <= 20))
    if (!uuid(args.operationId)) return false
    if (tool !== 'maps.markers.create' && !uuid(args.markerId)) return false
    if ((tool === 'maps.markers.create' || args.name !== undefined) && !markerText(args.name, 200)) return false
    if ((tool === 'maps.markers.create' || args.latitude !== undefined || args.longitude !== undefined) && !coordinate(args)) return false
    if (args.address !== undefined && !markerText(args.address, 400, true)) return false
    if (args.notes !== undefined && !markerText(args.notes, 1000, true)) return false
    if (args.expectedRevision !== undefined && (!Number.isInteger(args.expectedRevision) || args.expectedRevision < 1 || args.expectedRevision > 2147483647)) return false
    if (tool === 'maps.markers.update' && !['name', 'latitude', 'longitude', 'address', 'notes'].some(key => args[key] !== undefined)) return false
  }
  if (tool === 'location.precise' && args.maxAgeSeconds !== undefined && (!Number.isInteger(args.maxAgeSeconds) || args.maxAgeSeconds < 1 || args.maxAgeSeconds > 300)) return false
  if (tool === 'maps.search') {
    if (!text(args.query, 200) || ((args.latitude !== undefined || args.longitude !== undefined) && !coordinate(args))) return false
    if (args.radiusMeters !== undefined && (!coordinate(args) || !Number.isFinite(args.radiusMeters) || args.radiusMeters < 100 || args.radiusMeters > 100000)) return false
  }
  if (tool === 'maps.geocode' && !text(args.address, 200)) return false
  if (['maps.search', 'maps.geocode'].includes(tool) && args.limit !== undefined && (!Number.isInteger(args.limit) || args.limit < 1 || args.limit > (tool === 'maps.search' ? 20 : 5))) return false
  if (['maps.reverse-geocode', 'maps.open'].includes(tool) && !coordinate(args)) return false
  if (tool === 'maps.directions' && (!coordinate(args, 'startLatitude', 'startLongitude') || !coordinate(args, 'endLatitude', 'endLongitude') || (args.transport !== undefined && !['driving', 'walking'].includes(args.transport)))) return false
  if (tool === 'maps.open' && ((args.name !== undefined && !text(args.name, 200)) || (args.mode !== undefined && !['show', 'directions'].includes(args.mode)) ||
      (args.transport !== undefined && (args.mode !== 'directions' || !['driving', 'walking', 'transit'].includes(args.transport))))) return false
  if (tool === 'music.catalog-search' && (!text(args.query, 100) || (args.limit !== undefined && (!Number.isInteger(args.limit) || args.limit < 1 || args.limit > 20)))) return false
  if (tool === 'music.library') {
    if (args.kind !== undefined && !['songs', 'albums', 'artists', 'playlists'].includes(args.kind)) return false
    if (args.query !== undefined && !text(args.query, 100)) return false
    if (args.offset !== undefined && (!Number.isInteger(args.offset) || args.offset < 0 || args.offset > 10000)) return false
    if (args.limit !== undefined && (!Number.isInteger(args.limit) || args.limit < 1 || args.limit > 50)) return false
  }
  if (tool === 'music.play-library' && (!['songs', 'albums', 'playlists'].includes(args.kind) || !libraryId(args.itemId))) return false
  if (tool === 'music.search' && !text(args.query, 100)) return false
  if (tool === 'music.play' && args.itemId !== undefined && (typeof args.itemId !== 'string' || !/^\d{1,20}$/.test(args.itemId))) return false
  if (tool === 'music.seek' && (!Number.isFinite(args.seconds) || args.seconds < 0 || args.seconds > 86400)) return false
  if (['calendar.create', 'reminders.create', 'alarms.create', 'alarms.cancel', 'alarms.open-create'].includes(tool)) {
    if (!uuid(args.operationId)) return false
    if (tool === 'alarms.cancel') return uuid(args.alarmId)
    if (!text(args.title, 500) || !validZone(args.timeZone)) return false
    if (args.notes !== undefined && (typeof args.notes !== 'string' || args.notes.length > 2000)) return false
    if (tool === 'calendar.create') {
      if (!offsetDate(args.start) || !offsetDate(args.end) || Date.parse(args.end) <= Date.parse(args.start) || Date.parse(args.end) - Date.parse(args.start) > 31 * 86400000) return false
      if (args.location !== undefined && (typeof args.location !== 'string' || args.location.length > 500)) return false
      if (args.allDay !== undefined && typeof args.allDay !== 'boolean') return false
      if (args.alertMinutesBefore !== undefined && (!Number.isInteger(args.alertMinutesBefore) || args.alertMinutesBefore < 0 || args.alertMinutesBefore > 10080)) return false
    }
    if (tool === 'reminders.create') {
      if (args.dueDate !== undefined && !offsetDate(args.dueDate)) return false
      if (args.priority !== undefined && ![0, 1, 5, 9].includes(args.priority)) return false
      if (args.notify !== undefined && typeof args.notify !== 'boolean') return false
      if (args.notify === true && args.dueDate === undefined) return false
    }
    if (['alarms.create', 'alarms.open-create'].includes(tool) && !offsetDate(args.fireDate)) return false
  }
  return true
}
const keys = (value, allowed) => object(value) && Object.keys(value).every(key => allowed.includes(key))
const date = value => text(value, 40) && Number.isFinite(Date.parse(value))
const number = value => typeof value === 'number' && Number.isFinite(value) && value >= 0
export function validateResult(tool, value) {
  if (!object(value)) return false
  const metadata = ['collectedAt', 'timeZone', 'coverage', 'truncated', 'source', 'availability']
  if (metadata.some(key => value[key] !== undefined && (key === 'truncated' ? typeof value[key] !== 'boolean' : !text(value[key], 128)))) return false
  if (tool === 'calendar.create') return keys(value, ['id', 'title', 'start', 'end', 'timeZone', 'allDay', 'operationId', 'status']) && text(value.id, 512) && text(value.title, 500) && offsetDate(value.start) && offsetDate(value.end) && Date.parse(value.start) < Date.parse(value.end) && validZone(value.timeZone) && typeof value.allDay === 'boolean' && uuid(value.operationId) && value.status === 'created'
  if (tool === 'reminders.create') return keys(value, ['id', 'title', 'dueDate', 'timeZone', 'notify', 'priority', 'operationId', 'status']) && text(value.id, 512) && text(value.title, 500) && (value.dueDate === null || offsetDate(value.dueDate)) && validZone(value.timeZone) && typeof value.notify === 'boolean' && [0, 1, 5, 9].includes(value.priority) && uuid(value.operationId) && value.status === 'created'
  if (tool === 'alarms.open-create') return keys(value, ['operationId', 'status', 'requiresConfirmation', 'skipUIRequested', 'title', 'fireDate', 'timeZone']) && uuid(value.operationId) && value.status === 'handoff-requested' && ((value.requiresConfirmation === true && value.skipUIRequested === undefined) || (value.skipUIRequested === true && value.requiresConfirmation === undefined)) && text(value.title, 500) && offsetDate(value.fireDate) && validZone(value.timeZone)
  const alarmRow = row => keys(row, ['id', 'title', 'fireDate', 'timeZone', 'state']) && uuid(row.id) && text(row.title, 500) && offsetDate(row.fireDate) && validZone(row.timeZone) && ['scheduled', 'alerting', 'countdown', 'paused', 'unknown'].includes(row.state)
  if (tool === 'alarms.create') { const { operationId, status, ...row } = value; return uuid(operationId) && status === 'created' && alarmRow(row) }
  if (tool === 'alarms.list') return keys(value, ['items', 'truncated', 'source']) && value.source === 'whaleness-host-alarms' && typeof value.truncated === 'boolean' && Array.isArray(value.items) && value.items.length <= 100 && value.items.every(alarmRow)
  if (tool === 'alarms.cancel') return keys(value, ['id', 'operationId', 'status']) && uuid(value.id) && uuid(value.operationId) && value.status === 'cancelled'
  if (tool === 'calendar.busy') return keys(value, [...metadata, 'busyIntervals']) && Array.isArray(value.busyIntervals) && value.busyIntervals.length <= 2000 && value.busyIntervals.every(row => keys(row, ['start', 'end']) && date(row.start) && date(row.end) && Date.parse(row.start) < Date.parse(row.end))
  if (tool === 'reminders.list') return keys(value, [...metadata, 'items']) && Array.isArray(value.items) && value.items.length <= 100 && value.items.every(row => keys(row, ['title', 'completed', 'dueDate']) && typeof row.title === 'string' && row.title.length <= 500 && typeof row.completed === 'boolean' && (row.dueDate === null || date(row.dueDate)))
  const marker = row => keys(row, ['id', 'name', 'latitude', 'longitude', 'address', 'notes', 'revision', 'createdAt', 'updatedAt']) && uuid(row.id) && markerText(row.name, 200) && coordinate(row) && markerText(row.address, 400, true) && markerText(row.notes, 1000, true) && Number.isSafeInteger(row.revision) && row.revision > 0 && date(row.createdAt) && date(row.updatedAt)
  if (tool === 'maps.markers.list') return keys(value, ['items', 'total', 'offset', 'limit', 'hasMore', 'nextOffset', 'source']) && value.source === 'whaleness-host-markers' &&
    Number.isSafeInteger(value.total) && value.total >= 0 && Number.isInteger(value.offset) && value.offset >= 0 && value.offset <= 2147483647 && Number.isInteger(value.limit) && value.limit >= 1 && value.limit <= 20 &&
    Array.isArray(value.items) && value.items.length <= value.limit && value.items.length <= Math.max(value.total - value.offset, 0) && value.items.every(marker) && typeof value.hasMore === 'boolean' && value.hasMore === (value.offset + value.items.length < value.total) &&
    (value.hasMore ? value.items.length > 0 && value.nextOffset === value.offset + value.items.length : value.nextOffset === null)
  if (['maps.markers.create', 'maps.markers.update'].includes(tool)) return keys(value, ['marker', 'operationId', 'status', 'replayed', 'source']) && marker(value.marker) && uuid(value.operationId) && typeof value.replayed === 'boolean' && value.source === 'whaleness-host-markers' && value.status === (tool === 'maps.markers.create' ? 'created' : 'updated')
  if (tool === 'maps.markers.delete') return keys(value, ['markerId', 'operationId', 'status', 'existed', 'replayed', 'source']) && uuid(value.markerId) && uuid(value.operationId) && value.status === 'deleted' && typeof value.existed === 'boolean' && typeof value.replayed === 'boolean' && value.source === 'whaleness-host-markers'
  if (tool === 'location.precise') return keys(value, ['latitude', 'longitude', 'precision', 'horizontalAccuracyMeters', 'sampledAt']) && coordinate(value) && value.precision === 'precise' && number(value.horizontalAccuracyMeters) && date(value.sampledAt)
  if (['maps.search', 'maps.geocode', 'maps.reverse-geocode'].includes(tool)) return keys(value, ['items', 'truncated', 'source']) && ['apple-maps', 'android-geocoder'].includes(value.source) && typeof value.truncated === 'boolean' && Array.isArray(value.items) && value.items.length <= (tool === 'maps.search' ? 20 : 5) && value.items.every(row => keys(row, ['name', 'latitude', 'longitude', 'address']) && coordinate(row) && typeof row.name === 'string' && row.name.length <= 200 && typeof row.address === 'string' && row.address.length <= 400)
  if (tool === 'maps.directions') return keys(value, ['routes', 'transport', 'truncated', 'estimatedAt', 'source']) && value.source === 'apple-maps' && ['driving', 'walking'].includes(value.transport) && typeof value.truncated === 'boolean' && date(value.estimatedAt) && Array.isArray(value.routes) && value.routes.length <= 3 && value.routes.every(row => keys(row, ['name', 'distanceMeters', 'expectedTravelSeconds', 'steps', 'stepsTruncated']) && typeof row.name === 'string' && row.name.length <= 200 && number(row.distanceMeters) && number(row.expectedTravelSeconds) && typeof row.stepsTruncated === 'boolean' && Array.isArray(row.steps) && row.steps.length <= 40 && row.steps.every(step => keys(step, ['instruction', 'distanceMeters']) && typeof step.instruction === 'string' && step.instruction.length <= 160 && number(step.distanceMeters)))
  if (tool === 'maps.open') return keys(value, ['status', 'latitude', 'longitude', 'name', 'mode', 'transport']) && ['ready', 'handoff-requested'].includes(value.status) && coordinate(value) && typeof value.name === 'string' && value.name.length <= 200 && ['show', 'directions'].includes(value.mode) && (value.mode === 'directions' ? ['driving', 'walking', 'transit'].includes(value.transport) : value.transport === undefined)
  if (tool === 'location.current') return keys(value, ['latitude', 'longitude', 'precision', 'horizontalAccuracyMeters', 'sampledAt']) && Number.isFinite(value.latitude) && Math.abs(value.latitude) <= 90 && Number.isFinite(value.longitude) && Math.abs(value.longitude) <= 180 && value.precision === 'coarse' && number(value.horizontalAccuracyMeters) && value.horizontalAccuracyMeters >= 1500 && date(value.sampledAt)
  if (tool === 'music.catalog-search') return keys(value, ['items', 'source']) && value.source === 'apple-music-catalog' && Array.isArray(value.items) && value.items.length <= 20 && value.items.every(row =>
    keys(row, ['id', 'title', 'artist', 'album', 'url', 'artworkURL', 'durationSeconds']) && musicDetails(row) && typeof row.id === 'string' && /^catalog:[0-9]{1,20}$/.test(row.id) && text(row.title, 500) &&
    ['artist', 'album'].every(key => row[key] === undefined || (typeof row[key] === 'string' && row[key].length <= 500)) && (row.url === undefined || appleMusicURL(row.url) !== null))
  const androidLibrary = value.source === 'android-media-store'
  if (tool === 'music.library') return keys(value, ['items', 'kind', 'offset', 'limit', 'hasMore', 'nextOffset', 'pagingLimitReached', 'source', 'scope', 'downloadedOnly', 'status']) &&
    ['songs', 'albums', 'artists', 'playlists'].includes(value.kind) && Number.isInteger(value.offset) && value.offset >= 0 && value.offset <= 10000 &&
    Number.isInteger(value.limit) && value.limit >= 1 && value.limit <= 50 && typeof value.hasMore === 'boolean' &&
    Array.isArray(value.items) && value.items.length <= value.limit && value.items.every(row => keys(row, ['id', 'title', 'artist', 'album', 'url', 'artworkURL', 'durationSeconds']) && musicDetails(row, androidLibrary) && (row.url === undefined || (!androidLibrary && appleMusicURL(row.url) !== null)) && (androidLibrary ? /^library:android:songs:[1-9][0-9]{0,18}$/.test(row.id) : libraryId(row.id)) && typeof row.title === 'string' && row.title.length <= 500 &&
      ['artist', 'album'].every(key => row[key] === undefined || (typeof row[key] === 'string' && row[key].length <= 500))) &&
    typeof value.pagingLimitReached === 'boolean' && value.pagingLimitReached === (value.hasMore && value.offset + value.items.length > 10000) &&
    (value.hasMore && !value.pagingLimitReached ? value.items.length > 0 && value.nextOffset === value.offset + value.items.length : value.nextOffset === null) &&
    (androidLibrary ? value.kind === 'songs' && value.scope === 'device-shared-audio' && value.downloadedOnly === true : value.source === 'apple-music-library' && value.scope === 'device-synced-personal-library' && value.downloadedOnly === false) &&
    value.status === (value.items.length ? 'ok' : 'empty-in-requested-scope')
  if (tool === 'music.search') return keys(value, [...metadata, 'items']) && Array.isArray(value.items) && value.items.length <= 20 && value.items.every(row => keys(row, value.source === 'android-media-store' ? ['id', 'title', 'artist', 'album', 'artworkURL', 'durationSeconds'] : ['id', 'title', 'artist']) && (value.source !== 'android-media-store' || (musicDetails(row, true) && (row.album === undefined || (typeof row.album === 'string' && row.album.length <= 500)))) && typeof row.id === 'string' && /^\d{1,20}$/.test(row.id) && typeof row.title === 'string' && row.title.length <= 500 && typeof row.artist === 'string' && row.artist.length <= 500)
  if (tool.startsWith('music.') && ['android-media-store', 'android-media-session'].includes(value.source)) return keys(value, ['playbackState', 'playbackSeconds', 'requested', 'source', 'status', 'playerPackage', 'track']) && Number.isInteger(value.playbackState) && value.playbackState >= 0 && value.playbackState <= 5 && (value.playbackSeconds === undefined || number(value.playbackSeconds)) && (value.requested === undefined || value.requested === tool) && (value.status === undefined || value.status === 'handoff-requested') && (value.playerPackage === undefined || (text(value.playerPackage, 255) && /^[A-Za-z0-9_.]+$/.test(value.playerPackage))) && (value.track === undefined || (keys(value.track, ['title', 'artist', 'album']) && Object.values(value.track).every(item => typeof item === 'string' && item.length <= 500)))
  if (tool.startsWith('music.')) return keys(value, ['playbackState', 'playbackSeconds', 'requested']) && Number.isInteger(value.playbackState) && value.playbackState >= 0 && value.playbackState <= 5 && (value.playbackSeconds === undefined || number(value.playbackSeconds)) && (value.requested === undefined || value.requested === tool)
  if (tool === 'health.daily-summary') return keys(value, [...metadata, 'steps', 'sleepMinutes']) && (value.steps === null || number(value.steps)) && (value.sleepMinutes === null || number(value.sleepMinutes))
  if (tool !== 'photos.select' || !keys(value, ['images']) || !Array.isArray(value.images) || value.images.length !== 1) return false
  return value.images.every(image => keys(image, ['mediaType', 'width', 'height', 'data']) && image.mediaType === 'image/jpeg' &&
    Number.isInteger(image.width) && image.width > 0 && image.width <= 768 &&
    Number.isInteger(image.height) && image.height > 0 && image.height <= 768 &&
    typeof image.data === 'string' && image.data.length <= 87384 && /^[A-Za-z0-9+/]+={0,2}$/.test(image.data) &&
    Buffer.from(image.data, 'base64').length <= 65536 && Buffer.from(image.data, 'base64').toString('base64') === image.data)
}
