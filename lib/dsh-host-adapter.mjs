import crypto from 'node:crypto'
import os from 'node:os'

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

export const DSH_VERSION = '0.1.5-rc.2'
export const SESSION_FORMAT_VERSION = 3

export function readHistoryRecords(records) {
  return requireArray(records, 'session history').map(record => {
    const value = requireRecord(record, 'session history record')
    if (value.type !== 'event') throw new Error('DSH 0.1.5-rc.2 history requires event records')
    const event = requireRecord(value.event, 'session history event')
    if (!Number.isSafeInteger(event.seq) || event.seq < 0) throw new Error('invalid history sequence')
    return event
  })
}

export function readSessionSnapshot(frame, sessionId) {
  requireRecord(frame, 'session/follow')
  if (frame.type !== 'snapshot' || !Number.isSafeInteger(frame.cursor) || frame.cursor < -1
    || frame.header?.id !== sessionId) throw new Error('session/follow returned an invalid snapshot')
  if (frame.header.version !== SESSION_FORMAT_VERSION) {
    throw Object.assign(new Error('mobile-gateway requires DSH 0.1.5-rc.2 Session format 3'), {
      code: 'unsupported-session-format',
    })
  }
  return {
    events: readHistoryRecords(frame.records).map(event => ({ event })),
    hasMore: frame.hasMore === true,
    projections: requireRecord(frame.projections, 'session/follow projections'),
    historyFormatVersion: frame.header.version,
    cursor: frame.cursor,
  }
}

async function firstStreamFrame(gateway, namespace, method, args, signal) {
  const ownedAbort = new AbortController()
  const streamSignal = signal ? AbortSignal.any([signal, ownedAbort.signal]) : ownedAbort.signal
  let iterator
  try {
    const iterable = await gateway.stream({ namespace, method, args, signal: streamSignal })
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

// The 0.1.5-rc.2 SessionController names its reserved list argument
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
export function createDshHostAdapter(typertGateway) {
  if (!typertGateway || typeof typertGateway.invoke !== 'function' || typeof typertGateway.stream !== 'function') {
    throw new Error('mobile-gateway requires the DSH Remote Gateway host service')
  }

  const invoke = (namespace, method, args, signal) => typertGateway.invoke({
    namespace,
    method,
    args,
    ...(signal === undefined ? {} : { signal }),
  })

  const sessionSnapshot = async (request, signal) => {
    const frame = requireRecord(await firstStreamFrame(
      typertGateway,
      'session',
      'follow',
      requestArgs(request),
      signal,
    ), 'session/follow')
    return readSessionSnapshot(frame, request.address.sessionId)
  }

  const history = async (payload, signal) => {
    const request = {
      address: { kind: 'session', sessionId: payload.sessionId },
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

  const commands = {
    list: (sessionId, signal) => invoke('commands', 'list', { agentId: sessionId }, signal),
    // DSH 0.1.5-rc.2 accepts `submittedAttachments`. The parsed
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

  const describeHost = async (signal) => {
    const [sessions, catalog, canOpenPath] = await Promise.all([
      invoke('session', 'list', sessionListArgs({}), signal),
      modelCatalog(signal),
      invoke('session', 'canOpenWorkspacePath', {}, signal).catch(() => false),
    ])
    return {
      version: 'remote-gateway',
      dshVersion: DSH_VERSION,
      historyFormatVersion: SESSION_FORMAT_VERSION,
      cwd: os.homedir(),
      attachedSessions: Array.isArray(sessions?.items) ? sessions.items.length : 0,
      canOpenPath: canOpenPath === true,
      defaultProvider: catalog.default?.provider,
      defaultModel: catalog.default?.model,
    }
  }

  return {
    sessions: {
      list: (payload = {}, signal) => invoke('session', 'list', sessionListArgs(payload), signal),
      search: (payload, signal) => invoke('session', 'search', requestArgs(payload), signal),
      create: (payload, signal) => invoke('session', 'create', requestArgs(payload), signal),
      prompt: (payload, signal) => invoke('session', 'prompt', requestArgs({
        requestId: crypto.randomUUID(),
        ...payload,
      }), signal),
      attachment: (payload, signal) => invoke('session', 'attachment', requestArgs(payload), signal),
      fork: (payload, signal) => invoke('session', 'fork', requestArgs(payload), signal),
      cancel: (payload, signal) => invoke('session', 'cancel', requestArgs(payload), signal),
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
        const frame = requireRecord(await firstStreamFrame(typertGateway, 'workspace', 'follow', {}, signal), 'workspace/follow')
        if (frame.type !== 'baseline') throw new Error('workspace/follow returned an invalid opening baseline')
        return requireRecord(frame.value, 'workspace/follow baseline')
      },
      create: (payload, signal) => invoke('workspace', 'create', requestArgs(payload), signal),
      archiveSession: (payload, signal) => invoke('workspace', 'archiveSession', requestArgs(payload), signal),
    },
    settings: {
      describe: (_payload = {}, signal) => invoke('settings', 'describe', {}, signal),
      update: (payload, signal) => invoke('settings', 'update', {
        ns: payload.ns,
        patch: payload.patch,
        ...(payload.expectedRevision === undefined ? {} : { expectedRevision: payload.expectedRevision }),
      }, signal),
    },
    skills: {
      list: (payload, signal) => invoke('skills', 'list', requestArgs(payload), signal),
    },
    agentPresets: {
      list: (_payload = {}, signal) => invoke('agentPresets', 'list', {}, signal),
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
    openSessionStream(sessionId, signal) {
      return typertGateway.stream({
        namespace: 'session', method: 'follow',
        // Bound the opening window at the Host; older records remain available via session.page.
        args: requestArgs({ address: { kind: 'session', sessionId }, maxMessages: 12, assistantStream: true }),
        signal,
      })
    },
    openControlStream(signal) {
      return typertGateway.stream({ namespace: 'session', method: 'control', args: {}, signal })
    },
    openWorkspaceStream(signal) {
      return typertGateway.stream({ namespace: 'workspace', method: 'follow', args: {}, signal })
    },
  }
}
