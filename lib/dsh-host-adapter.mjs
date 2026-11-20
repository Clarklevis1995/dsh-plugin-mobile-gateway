import { parseWireImages } from './message-images.mjs'
import { createBotAdapter } from './bot-bridge.mjs'
import { createBotImages } from './bot-images.mjs'
import { createWorkspaceChangesAdapter } from './workspace-changes.mjs'
import { resolveDshRuntimeVersion } from './dsh-runtime-version.mjs'
import crypto from 'node:crypto'
import os from 'node:os'
import { Readable } from 'node:stream'
import { sessionAddress, normalizeProjectionValues, normalizeTeamProjection } from './session-target.mjs'
import { userMessageTextParts } from './message-text.mjs'
import { toolImages } from './tool-images.mjs'

function requireRecord(value, endpoint) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${endpoint} returned an invalid object`)
  }
  return value
}

function requireArray(value, endpoint) {
  if (!Array.isArray(value)) throw new Error(`${endpoint} returned an invalid array`)
  return value
}

// 适配基线，用于契约测试和未知宿主的默认接口选择，不作为运行时版本上报。
export const DSH_VERSION = '0.2.2-rc.3'
export const SESSION_FORMAT_VERSION = 4

export function readHistoryRecords(records) {
  return requireArray(records, 'session history').map(record => {
    const value = requireRecord(record, 'session history record')
    if (value.type !== 'event') throw new Error('DSH Session V4 history requires event records')
    const event = requireRecord(value.event, 'session history event')
    if (!Number.isSafeInteger(event.seq) || event.seq < 0) throw new Error('invalid history sequence')
    const textParts = event.type === 'user/message' ? userMessageTextParts(event.data?.content) : undefined
    return textParts ? { ...event, data: { ...event.data, textParts } } : event
  })
}

export function readSessionSnapshot(frame, sessionId) {
  requireRecord(frame, 'session/follow')
  if (frame.type !== 'snapshot' || !Number.isSafeInteger(frame.cursor) || frame.cursor < -1
    || frame.header?.id !== sessionId) throw new Error('session/follow returned an invalid snapshot')
  if (frame.header.version !== SESSION_FORMAT_VERSION) {
    throw Object.assign(new Error(`mobile-gateway requires Session format ${SESSION_FORMAT_VERSION}; received ${frame.header.version}`), {
      code: 'unsupported-session-format',
    })
  }
  return {
    events: readHistoryRecords(frame.records).map(event => ({ event })),
    hasMore: frame.hasMore === true,
    projections: {
      ...requireRecord(frame.projections, 'session/follow projections'),
      ...(Object.hasOwn(frame.projections, 'values')
        ? { values: normalizeProjectionValues(frame.projections.values) } : {}),
    },
    historyFormatVersion: frame.header.version,
    cursor: frame.cursor,
  }
}

async function firstStreamFrame(stream, namespace, method, args, signal) {
  const ownedAbort = new AbortController()
  const streamSignal = signal ? AbortSignal.any([signal, ownedAbort.signal]) : ownedAbort.signal
  let iterator
  try {
    const iterable = await stream(namespace, method, args, streamSignal)
    const iteratorFactory = iterable?.[Symbol.asyncIterator] ?? iterable?.[Symbol.iterator]
    if (typeof iteratorFactory !== 'function') throw new Error(`${namespace}/${method} returned an invalid stream`)
    iterator = iteratorFactory.call(iterable)
    const first = await iterator.next()
    if (first.done) throw new Error(`${namespace}/${method} ended before its opening frame`)
    return first.value
  } finally {
    ownedAbort.abort()
    if (typeof iterator?.return === 'function') await iterator.return()
  }
}

function requestArgs(request) {
  return { request }
}

// The SessionController names its reserved list argument
// `_request`. Typert descriptors preserve that source parameter name exactly,
// so this endpoint cannot share the normal `{ request }` wrapper.
function sessionListArgs(request) {
  return { _request: request }
}

/**
 * The only module allowed to know DSH Remote endpoint names and argument
 * descriptors. Its public methods intentionally match mobile-gateway domain
 * operations, not the upstream transport envelope.
 */
export function createDshHostAdapter(typertGateway, peer, connection, { runtimeVersion = resolveDshRuntimeVersion() } = {}) {
  if (!typertGateway || typeof typertGateway.invoke !== 'function' || typeof typertGateway.stream !== 'function') {
    throw new Error('mobile-gateway requires the DSH Remote Gateway host service')
  }
  if (!peer || !(peer.signal instanceof AbortSignal)) {
    throw new Error('mobile-gateway requires a DSH Connection Peer (DSH 0.2.1-rc.2 or later)')
  }

  const invoke = (namespace, method, args, signal) => typertGateway.invoke({
    namespace,
    method,
    args,
    peer,
    ...(signal === undefined ? {} : { signal }),
  })
  const stream = (namespace, method, args, signal) => typertGateway.stream({
    namespace, method, args, peer, signal,
  })
  const controlVersion = runtimeVersion ?? DSH_VERSION
  // RC.2 起统一子代理控制接口；旧宿主继续使用原描述符。
  const core = controlVersion.split(/[+-]/)[0].split('.').map(Number)
  const minimum = [0, 2, 2]
  const changed = core.findIndex((part, index) => part !== minimum[index])
  const unifiedSubagents = changed < 0
    ? !controlVersion.includes('-') || Number(controlVersion.match(/-rc\.(\d+)/)?.[1]) >= 2
    : core[changed] > minimum[changed]
  // Dispatch in-process through the official authenticated route; no loopback
  // HTTP listener, browser cookie, or public /api exposure is required.
  const prompt = (payload, signal) => serializeSession(payload.sessionId, async () => {
    if (payload.parentSessionId !== undefined) {
      if (payload.subagentMode !== 'continuable') {
        throw Object.assign(new Error('only continuable subagents accept messages'), { code: 'subagent/not-resumable' })
      }
      // 新接口按 child 授权；先通过历史地址验证移动端声明的直接父子关系。
      if (unifiedSubagents) await sessionSnapshot({ address: sessionAddress(payload), maxMessages: 1 }, signal)
      return invoke('subagents', 'prompt', requestArgs({
        requestId: payload.requestId ?? crypto.randomUUID(),
        ...(!unifiedSubagents ? { parentSessionId: payload.parentSessionId, mode: 'continuable' } : {}),
        childSessionId: payload.sessionId, delivery: payload.mode, content: payload.content,
        ...(payload.clientTimeZone === undefined ? {} : { clientTimeZone: payload.clientTimeZone }),
      }), signal)
    }
    // Accepted input may not have reached turn/start yet. Keep that gap
    // locked; the persistent event or a subsequent read retires the marker.
    const alreadyAdmitted = admittedPrompts.has(payload.sessionId)
    admittedPrompts.add(payload.sessionId)
    try {
      return await invoke('session', 'prompt', requestArgs({ requestId: crypto.randomUUID(), ...payload }), signal)
    } catch (error) {
      if (!alreadyAdmitted) admittedPrompts.delete(payload.sessionId)
      throw error
    }
  })
  const uploadHandler = connection?.createSharedFetchHandler?.('/api')
  const uploadUrl = new URL('http://localhost/api/session/uploadFileBinary')
  const uploadsAvailable = () => uploadHandler?.requestBodyMode({ method: 'POST', url: uploadUrl }) === 'streaming'

  // 与 Web 的 @ 面板共用官方候选接口。文件路径相对于当前会话，
  // 对话引用使用 Host 已编码的 mention，并由 prompt 解析为只读上下文。
  const referenceCandidates = async (agentId, query, quoted, signal) => {
    const args = { agentId, query }
    const [files, sessions] = await Promise.allSettled([
      invoke('fileReferences', 'list', args, signal),
      quoted || query.includes('/') ? Promise.resolve([]) : invoke('sessionReferenceResolver', 'candidates', args, signal),
    ])
    signal.throwIfAborted()
    const items = []
    if (files.status === 'fulfilled' && Array.isArray(files.value)) {
      for (const candidate of files.value.slice(0, 24)) {
        const { path, kind } = candidate ?? {}
        if (!['file', 'directory'].includes(kind) || typeof path !== 'string' ||
            !path || path.length > 2048 || /[\u0000-\u001f\u007f-\u009f"]/u.test(path)) continue
        const directory = kind === 'directory'
        const rawPath = path.replace(/\/$/u, '')
        const slash = rawPath.lastIndexOf('/')
        const display = rawPath.slice(slash + 1) || rawPath
        const fullPath = directory ? rawPath + '/' : rawPath
        const wire = quoted || /\s/u.test(fullPath) ? `@"${fullPath}"` : `@${fullPath}`
        items.push({ id: path, kind, label: directory ? display + '/' : display,
          detail: slash > 0 ? rawPath.slice(0, slash) : '', wire, path: fullPath })
      }
    }
    if (sessions.status === 'fulfilled' && Array.isArray(sessions.value)) {
      for (const candidate of sessions.value.slice(0, 24)) {
        const { sessionId, mention, displayTitle, label } = candidate ?? {}
        if (typeof sessionId !== 'string' || typeof mention !== 'string' ||
            !mention.startsWith('@[') || mention.length > 4096 || sessionId === agentId) continue
        items.push({ id: sessionId, kind: 'session', label: displayTitle || label || sessionId, wire: mention })
      }
    }
    if (files.status === 'rejected' && sessions.status === 'rejected') throw files.reason
    return { items }
  }

  const sessionSnapshot = async (request, signal) => {
    const frame = requireRecord(await firstStreamFrame(
      stream,
      'session',
      'follow',
      requestArgs(request),
      signal,
    ), 'session/follow')
    return readSessionSnapshot(frame, request.address.kind === 'subagent'
      ? request.address.childSessionId : request.address.sessionId)
  }

  const history = async (payload, signal) => {
    const request = {
      address: sessionAddress(payload),
      // Older-page requests need only the opening cursor/projections, not another large latest page.
      ...(payload.beforeSeq !== undefined ? { maxMessages: 1 }
        : payload.maxMessages === undefined ? {} : { maxMessages: payload.maxMessages }),
    }
    const snapshot = await sessionSnapshot(request, signal)
    let events = snapshot.events
    let hasMore = snapshot.hasMore
    if (payload.beforeSeq !== undefined) {
      const page = requireRecord(await invoke('session', 'page', requestArgs({
        address: request.address,
        throughSeq: snapshot.cursor,
        beforeSeq: payload.beforeSeq,
        ...(payload.maxMessages === undefined ? {} : { maxMessages: payload.maxMessages }),
      }), signal), 'session/page')
      events = readHistoryRecords(page.records).map(event => ({ event }))
      hasMore = page.hasMore === true
    }
    return {
      ...snapshot,
      events,
      hasMore,
    }
  }

  const modelCatalog = async (signal) => requireRecord(
    await invoke('session', 'modelCatalog', {}, signal),
    'session/modelCatalog',
  )

  // 新版 Host 接受完整图片引用。旧移动协议仍由会话历史决定可读取的附件。
  const attachment = async (payload, signal) => {
    let beforeSeq
    let throughSeq
    while (true) {
      const page = requireRecord(await invoke('session', 'events', requestArgs({
        address: sessionAddress(payload), maxMessages: 100,
        ...(beforeSeq === undefined ? {} : { beforeSeq, throughSeq }),
      }), signal), 'session/events')
      if (!Number.isSafeInteger(page.cursor) || page.cursor < -1) throw new Error('invalid attachment history cursor')
      throughSeq ??= page.cursor
      const events = readHistoryRecords(page.records)
      for (const event of events) {
        const data = event.data || {}
        const refs = toolImages({ ...data, message: data.message ?? { content: data.content } })
        const ref = refs.find(item => item.attachmentId === payload.attachmentId)
        if (ref) return invoke('session', 'attachment', requestArgs({ sessionId: payload.sessionId, attachment: ref }), signal)
      }
      if (!page.hasMore) break
      const oldest = events[0]?.seq
      if (!Number.isSafeInteger(oldest) || (beforeSeq !== undefined && oldest >= beforeSeq)) {
        throw new Error('attachment history did not advance')
      }
      beforeSeq = oldest
    }
    throw Object.assign(new Error('Image is not referenced by this session'), { code: 'session/attachment-invalid' })
  }

  // 普通模式与 Bot 图片共用同一套官方工作区读接口和会话附件实现。
  const imageFiles = {
    stat: ({ sessionId, path }, signal) => invoke('workspaceFiles', 'stat', {
      workspaceFileScopeId: sessionId, path,
    }, signal),
    readBytes: ({ sessionId, path, offset, length }, signal) => invoke('workspaceFiles', 'readBytes', {
      workspaceFileScopeId: sessionId, path, options: { range: { offset, length } },
    }, signal),
  }
  const botImages = createBotImages({
    attachment, files: imageFiles,
    async readPage({ sessionId, beforeSeq, throughSeq }, signal) {
      const page = requireRecord(await invoke('session', 'events', requestArgs({
        address: sessionAddress({ sessionId }), maxMessages: 100,
        ...(beforeSeq === undefined ? {} : { beforeSeq }),
        ...(throughSeq === undefined ? {} : { throughSeq }),
      }), signal), 'session/events')
      return { events: readHistoryRecords(page.records), hasMore: page.hasMore === true, cursor: page.cursor }
    },
    async watch(sessionId, signal, onEvent) {
      const frames = await stream('session', 'follow', requestArgs({
        address: sessionAddress({ sessionId }), maxMessages: 1, assistantStream: true,
      }), signal)
      let cursor
      for await (const frame of frames) {
        if (signal.aborted) break
        if (cursor === undefined) {
          const opening = readSessionSnapshot(frame, sessionId)
          cursor = opening.cursor
          for (const { event } of opening.events) onEvent(event)
          continue
        }
        if (frame.type === 'event') {
          if (frame.event?.seq !== cursor + 1) throw new Error('Bot image event sequence gap')
          cursor = frame.event.seq; onEvent(frame.event)
        }
      }
      signal.throwIfAborted()
      throw new Error('Bot image follow ended')
    },
  })

  // Control and conversation sockets share this adapter. Admit a prompt only
  // after an earlier preset switch finishes, and re-check later switches.
  const sessionOperations = new Map()
  const admittedPrompts = new Set()
  const serializeSession = (sessionId, operation) => {
    const task = (sessionOperations.get(sessionId) ?? Promise.resolve()).then(operation)
    const guard = task.catch(() => {})
    sessionOperations.set(sessionId, guard)
    return task.finally(() => {
      if (sessionOperations.get(sessionId) === guard) sessionOperations.delete(sessionId)
    })
  }
  const sessionPreset = async (sessionId, signal) => {
    const snapshot = await sessionSnapshot({ address: { kind: 'session', sessionId }, maxMessages: 1 }, signal)
    const values = snapshot.projections.values
    const metadata = values?.sessionListMetadata
    // Host 明确允许 null，表示没有记录预设；不能把它当作查询失败。
    // 缺失字段和损坏值仍拒绝，锁定状态独立使用持久化元数据判断。
    const preset = values?.agentPreset
    if (!(preset === null || (typeof preset === 'string' && preset.trim())) || !metadata || typeof metadata.blank !== 'boolean'
      || !(metadata.lastPromptAt === null || Number.isFinite(metadata.lastPromptAt))) {
      throw Object.assign(new Error('session preset state is unavailable'), { code: 'agent-preset/unavailable' })
    }
    const durableLock = !metadata.blank || metadata.lastPromptAt !== null
    if (durableLock) admittedPrompts.delete(sessionId)
    return { sessionId, agentPreset: values.agentPreset, locked: durableLock || admittedPrompts.has(sessionId) }
  }

  const commands = {
    list: (sessionId, signal) => invoke('commands', 'list', { agentId: sessionId }, signal),
    // DSH accepts `submittedAttachments`. The parsed
    // wire images already carry the { type: 'image', ... } shape it expects, so
    // only the field name changes.
    execute: (sessionId, line, attachments, signal) => invoke(
      'commands',
      'execute',
      { agentId: sessionId, line, submittedAttachments: attachments },
      signal,
    ),
  }

  const goalRefValue = (value, endpoint) => {
    const goal = requireRecord(value, endpoint)
    if (typeof goal.id !== 'string' || !Number.isSafeInteger(goal.revision)) {
      throw new Error(`${endpoint} returned an invalid goal`)
    }
    return { ref: { id: goal.id, revision: goal.revision } }
  }

  const dshVersion = runtimeVersion
  const describeHost = async (signal) => {
    const [sessions, catalog, canOpenPath] = await Promise.all([
      invoke('session', 'list', sessionListArgs({}), signal),
      modelCatalog(signal),
      invoke('session', 'canOpenWorkspacePath', {}, signal).catch(() => false),
    ])
    return {
      version: 'remote-gateway',
      dshVersion,
      historyFormatVersion: SESSION_FORMAT_VERSION,
      cwd: os.homedir(),
      attachedSessions: Array.isArray(sessions?.items) ? sessions.items.length : 0,
      canOpenPath: canOpenPath === true,
      defaultProvider: catalog.default?.provider,
      defaultModel: catalog.default?.model,
    }
  }

  return {
    agentTeams: {
      available: () => unifiedSubagents,
      async setEnabled({ sessionId, enabled }, signal) {
        if (!unifiedSubagents) throw Object.assign(new Error('Team mode control requires DSH RC.2 or later'), { code: 'unsupported' })
        return serializeSession(sessionId, async () => {
          // 同一个认证 Peer 调用官方根会话接口；由 Host 校验根身份、权限及持久化。
          await invoke('agentTeams', 'setEnabled', { agentId: sessionId, enabled }, signal)
          const snapshot = await invoke('session', 'projections', requestArgs({ sessionId }), signal)
          const team = normalizeTeamProjection(snapshot?.values?.agentTeam)
          if (snapshot?.kind !== 'sequenced' || !Number.isSafeInteger(snapshot.asOfSeq)
            || typeof team?.enabled !== 'boolean') {
            throw Object.assign(new Error('Team mode saved but its current projection is unavailable; refresh before retrying'), { code: 'team-mode-unconfirmed' })
          }
          return { agentTeam: team, asOfSeq: snapshot.asOfSeq, projectionState: 'ready' }
        })
      },
    },
    bot: createBotAdapter(uploadHandler, peer, botImages, async (sessionId, payload, signal) => {
      const parsed = parseWireImages(payload.images, 'bot-call')
      const receipts = payload.receipts ?? []
      const text = typeof payload.text === 'string' ? payload.text.trim() : ''
      if (parsed.error || !Array.isArray(receipts) || receipts.length > 20
        || receipts.some(id => typeof id !== 'string' || !id.trim() || id.length > 256)
        || new Set(receipts).size !== receipts.length || text.length > 100_000
        || !(text || parsed.value.length || receipts.length)
        || parsed.value.length + receipts.length > 20) {
        throw Object.assign(new Error('Invalid Bot message attachments'), { code: 'bad-request' })
      }
      const content = [...(text ? [{ type: 'text', text }] : []), ...parsed.value,
        ...receipts.map(receiptId => ({ type: 'file', receiptId }))]
      return prompt({ sessionId, mode: 'queue', content }, signal)
    }, referenceCandidates),
    workspaceChanges: createWorkspaceChangesAdapter(uploadHandler, peer),
    files: {
      ...imageFiles,
      available: uploadsAvailable,
      async upload({ sessionId, name, data }, signal) {
        if (!uploadsAvailable()) throw Object.assign(new Error('The official file upload service is unavailable'), { code: 'file-upload-unavailable' })
        const url = new URL(uploadUrl)
        url.searchParams.set('sessionId', sessionId)
        url.searchParams.set('name', name)
        const uploadSignal = signal ? AbortSignal.any([signal, peer.signal]) : peer.signal
        uploadSignal.throwIfAborted()
        const source = Readable.from(data, { objectMode: false })
        try {
          const response = await uploadHandler.fetch(new Request(url, {
            method: 'POST', headers: { 'content-type': 'application/octet-stream' },
            body: Readable.toWeb(source), duplex: 'half',
            signal: uploadSignal,
          }), peer)
          if (!response.ok) throw Object.assign(new Error(`Official file upload returned HTTP ${response.status}`), { code: 'file-upload-unavailable' })
          const result = await response.json()
          if (result.ok !== true) throw Object.assign(new Error(result.error?.message || 'Official file upload failed'),
            { code: result.error?.code || 'file-upload-failed' })
          return requireRecord(result.value, 'file upload')
        } catch (error) {
          uploadSignal.throwIfAborted()
          throw error
        } finally { source.destroy() }
      },
    },
    speech: {
      catalog: (signal) => invoke('speech', 'catalog', {}, signal),
      follow: (signal) => stream('speech', 'follow', {}, signal),
      configure: (patch, signal) => invoke('speech', 'configure', { patch }, signal),
      prepare: (providerId, options, signal) => invoke('speech', 'prepare', {
        providerId, ...(options === undefined ? {} : { options }),
      }, signal),
      cancelPreparation: (providerId, signal) => invoke('speech', 'cancelPreparation', { providerId }, signal),
      transcribe: (request, signal) => invoke('speech', 'transcribe', { request }, signal),
    },
    sessions: {
      async projections(payload, signal) {
        const snapshot = await invoke('session', 'projections', requestArgs(payload), signal)
        return snapshot === null ? null : { ...snapshot, values: normalizeProjectionValues(snapshot.values) }
      },
      list: (payload = {}, signal) => invoke('session', 'list', sessionListArgs(payload), signal),
      search: (payload, signal) => invoke('session', 'search', requestArgs(payload), signal),
      create: (payload, signal) => invoke('session', 'create', requestArgs(payload), signal),
      prompt,
      attachment,
      fork: (payload, signal) => invoke('session', 'fork', requestArgs(payload), signal),
      async cancel(payload, signal) {
        if (payload.parentSessionId === undefined) return invoke('session', 'cancel', requestArgs(payload), signal)
        if (payload.subagentMode !== 'continuable') {
          throw Object.assign(new Error('only continuable subagents accept interrupts'), { code: 'subagent/not-resumable' })
        }
        if (unifiedSubagents) {
          await sessionSnapshot({ address: sessionAddress(payload), maxMessages: 1 }, signal)
          return invoke('subagents', 'interruptByUser', { childSessionId: payload.sessionId }, signal)
        }
        return invoke('subagents', 'interruptByParent', {
          parentSessionId: payload.parentSessionId, childSessionId: payload.sessionId, mode: 'continuable',
        }, signal)
      },
      updateQueue: (payload, signal) => invoke('session', 'updateQueue', requestArgs(payload), signal),
      rename: (payload, signal) => invoke('session', 'rename', requestArgs(payload), signal),
      selectModel: (payload, signal) => invoke('session', 'selectModel', requestArgs(payload), signal),
      history,
      async models(payload, signal) {
        const [catalog, snapshot] = await Promise.all([
          modelCatalog(signal),
          sessionSnapshot({ address: { kind: 'session', sessionId: payload.sessionId }, maxMessages: 1 }, signal),
        ])
        const current = snapshot.projections?.values?.modelSelection?.next ?? catalog.default
        return {
          current,
          routable: typeof current?.provider === 'string'
            && requireArray(catalog.routableProviders, 'session/modelCatalog routableProviders').includes(current.provider),
          groups: requireArray(catalog.groups, 'session/modelCatalog groups'),
          failures: requireArray(catalog.failures, 'session/modelCatalog failures'),
        }
      },
    },
    workspace: {
      async list(_payload = {}, signal) {
        const frame = requireRecord(await firstStreamFrame(stream, 'workspace', 'follow', {}, signal), 'workspace/follow')
        if (frame.type !== 'baseline') throw new Error('workspace/follow returned an invalid opening baseline')
        return requireRecord(frame.value, 'workspace/follow baseline')
      },
      create: (payload, signal) => invoke('workspace', 'create', requestArgs(payload), signal),
      archiveSession: (payload, signal) => invoke('workspace', 'archiveSession', requestArgs(payload), signal),
    },
    settings: {
      describe: (_payload = {}, signal) => invoke('settings', 'describe', {}, signal),
      mutate: (payload, signal) => invoke('settings', 'mutate', {
        ns: payload.ns,
        ops: payload.ops,
        expectedRevision: payload.expectedRevision,
      }, signal),
      update: (payload, signal) => invoke('settings', 'update', {
        ns: payload.ns,
        patch: payload.patch,
        ...(payload.expectedRevision === undefined ? {} : { expectedRevision: payload.expectedRevision }),
      }, signal),
    },
    plugins: {
      inventory: (_payload = {}, signal) => invoke('pluginInventory', 'list', {}, signal),
      listBundles: (signal) => invoke('pluginManager', 'listBundles', {}, signal),
      listPlugins: (signal) => invoke('pluginManager', 'listPlugins', {}, signal),
      registries: (signal) => invoke('pluginManager', 'registries', {}, signal),
      versions: (name, options, signal) => invoke('pluginManager', 'listVersions', { name, options }, signal),
      detail: (name, language, signal) => invoke('pluginManager', 'readBundleDetail', { name, language }, signal),
      update: (name, version, options) => invoke('pluginManager', 'updateBundle', { name, version, options }),
      inspect: (spec, options, signal) => invoke('pluginManager', 'inspect', {
        spec, ...(options === undefined ? {} : { options }),
      }, signal),
      installBundle: (spec, options) => invoke('pluginManager', 'installBundle', { spec, options }),
      waitForInstall: (requestId) => invoke('pluginManager', 'waitForInstall', { requestId }),
      cancelInstall: (requestId) => invoke('pluginManager', 'cancelInstall', { requestId }),
      setBundleEnabled: (name, enabled) => invoke('pluginManager', 'setBundleEnabled', { name, enabled }),
      setPluginEnabled: (id, enabled) => invoke('pluginManager', 'setPluginEnabled', { id, enabled }),
      removeBundle: (name) => invoke('pluginManager', 'removeBundle', { name }),
      listVersionExemptions: () => invoke('pluginManager', 'listVersionExemptions', {}),
      setVersionExemption: (packageVersion, runtimeVersion, enabled, acceptRisk) => invoke(
        'pluginManager', 'setVersionExemption', {
          packageVersion, runtimeVersion, enabled,
          ...(acceptRisk === undefined ? {} : { acceptRisk }),
        },
      ),
    },
    permissionPresets: {
      catalog: (_payload = {}, signal) => invoke('permissionPresets', 'catalog', {}, signal),
    },
    schedule: {
      async catalog(_payload = {}, signal) {
        return { items: requireArray(await invoke('schedule', 'catalog', {}, signal), 'schedule/catalog') }
      },
      async list(payload, signal) {
        if (payload.sessionId !== undefined) {
          const items = requireArray(await invoke('schedule', 'catalog', {}, signal), 'schedule/catalog')
            .filter(item => item.status === 'active' && (item.target?.sessionId === payload.sessionId
              || item.involvedSessionIds?.includes(payload.sessionId)))
          return { items }
        }
        const result = requireRecord(await invoke('schedule', 'list', requestArgs(payload), signal), 'schedule/list')
        requireArray(result.items, 'schedule/list items')
        return result
      },
      history: (payload, signal) => invoke('schedule', 'history', requestArgs(payload), signal),
      view: (payload, signal) => invoke('schedule', 'view', requestArgs(payload), signal),
      create: (payload, signal) => invoke('schedule', 'create', requestArgs(payload), signal),
      edit: (payload, signal) => invoke('schedule', 'edit', requestArgs(payload), signal),
      run: (payload, signal) => invoke('schedule', 'run', requestArgs(payload), signal),
      deleteInactive: (_payload, signal) => invoke('schedule', 'deleteInactive', {}, signal),
    },
    skills: {
      list: (payload, signal) => invoke('skills', 'list', requestArgs(payload), signal),
    },
    agentPresets: {
      list: (_payload = {}, signal) => invoke('agentPresets', 'list', {}, signal),
      session: (payload, signal) => serializeSession(payload.sessionId, () => sessionPreset(payload.sessionId, signal)),
      select: (payload, signal) => serializeSession(payload.sessionId, async () => {
        const state = await sessionPreset(payload.sessionId, signal)
        if (state.locked) {
          throw Object.assign(new Error('session has already started; its agent preset is fixed'), { code: 'agent-preset/locked' })
        }
        // Host validates the live catalog, mounts the composition, checks its
        // own turn boundary and persists agent-preset/selected on this ID.
        const selected = await invoke('agentPresets', 'select', {
          agentId: payload.sessionId, agentPreset: payload.agentPreset,
        }, signal)
        if (typeof selected !== 'string' || !selected) throw new Error('agentPresets/select returned an invalid preset')
        return { sessionId: payload.sessionId, agentPreset: selected }
      }),
    },
    llm: {
      async models(_payload = {}, signal) {
        const catalog = await modelCatalog(signal)
        return { groups: catalog.groups, failures: catalog.failures }
      },
      async providers(_payload = {}, signal) {
        const providers = await invoke('llm', 'listConfigurableProviders', {}, signal)
        return { providers: requireArray(providers, 'llm/listConfigurableProviders') }
      },
    },
    goals: {
      async edit(payload) {
        return goalRefValue(await invoke('goals', 'edit', {
          agentId: payload.sessionId,
          ref: payload.ref,
          request: {
            ...(payload.objective === undefined ? {} : { objective: payload.objective }),
            ...(payload.maxGoalRounds === undefined ? {} : { maxGoalRounds: payload.maxGoalRounds }),
          },
        }), 'goals/edit')
      },
      async pause(payload) {
        return goalRefValue(
          await invoke('goals', 'pause', { agentId: payload.sessionId, ref: payload.ref }),
          'goals/pause',
        )
      },
      async resume(payload) {
        return goalRefValue(
          await invoke('goals', 'resume', { agentId: payload.sessionId, ref: payload.ref }),
          'goals/resume',
        )
      },
      clear: async payload => {
        await invoke('goals', 'clear', { agentId: payload.sessionId, ref: payload.ref })
        return { cleared: true }
      },
    },
    commands,
    host: {
      describe: (_payload = {}, signal) => describeHost(signal),
    },
    describeHost,
    dshVersion,
    observeSessionEvent(sessionId, event) {
      if (event.type === 'turn/start') admittedPrompts.delete(sessionId)
    },
    openSessionStream(sessionId, signal, target = { sessionId }) {
      return stream('session', 'follow',
        // Bound the opening window at the Host; older records remain available via session.page.
        requestArgs({ address: sessionAddress(target), maxMessages: 12, assistantStream: true }),
        signal,
      )
    },
    async *openControlStream(signal) {
      for await (const frame of await stream('session', 'control', {}, signal)) {
        if (frame.type === 'baseline' && frame.value?.projections) {
          yield { ...frame, value: { ...frame.value, projections: Object.fromEntries(
            Object.entries(frame.value.projections).map(([id, baseline]) => [id,
              { ...baseline, values: normalizeProjectionValues(baseline.values) }]),
          ) } }
          continue
        }
        if (frame.type !== 'projection' || !Object.hasOwn(frame, 'changes')) {
          yield frame.type === 'projection' && frame.key === 'agentTeam'
            ? { ...frame, value: normalizeTeamProjection(frame.value) } : frame
          continue
        }
        const changes = requireArray(frame.changes, 'session/control changes')
        for (const change of changes) {
          if (typeof change?.key !== 'string' || !Object.hasOwn(change, 'val')) {
            throw new Error('session/control returned an invalid projection change')
          }
        }
        for (const { key, val } of changes) {
          yield { type: 'projection', sessionId: frame.sessionId, seq: frame.seq, key,
            value: key === 'agentTeam' ? normalizeTeamProjection(val) : val }
        }
      }
    },
    openWorkspaceStream(signal) {
      return stream('workspace', 'follow', {}, signal)
    },
  }
}
