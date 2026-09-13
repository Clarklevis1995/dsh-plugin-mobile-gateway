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

function chunkRowLength(event) {
  if (event.type === 'chunkrow/tool-call-chunks') return requireArray(event.data?.args, event.type).length
  return requireArray(event.data?.texts, event.type).length
}

// DSH 0.1.2 compresses consecutive assistant deltas inside history pages.
// dsh-mobile-v1 predates that storage shape, so restore the exact logical
// SessionEvent sequence at this boundary instead of teaching every client a
// Host-specific encoding detail.
function expandChunkRow(event) {
  const data = requireRecord(event.data, event.type)
  const values = event.type === 'chunkrow/tool-call-chunks'
    ? requireArray(data.args, event.type)
    : requireArray(data.texts, event.type)
  const gaps = requireArray(data.dt, event.type)
  if (gaps.length !== Math.max(0, values.length - 1)) {
    throw new Error(`${event.type} returned invalid timing data`)
  }
  const events = []
  let time = event.time
  for (let index = 0; index < values.length; index += 1) {
    if (index > 0) time += gaps[index - 1]
    let chunk
    if (event.type === 'chunkrow/text-chunks') {
      chunk = { type: 'text-delta', index: data.index, text: values[index] }
    } else if (event.type === 'chunkrow/reasoning-chunks') {
      chunk = { type: 'reasoning-delta', index: data.index, text: values[index] }
    } else {
      chunk = {
        type: 'tool-call-delta',
        index: data.index,
        id: data.id,
        ...(Object.hasOwn(data, 'name') ? { name: data.name } : {}),
        argumentsDelta: values[index],
      }
    }
    events.push({
      type: 'assistant/chunk',
      seq: event.seq + index,
      time,
      data: { turn: data.turn, step: data.step, chunk },
    })
  }
  return events
}

export function expandHistoryRecords(records) {
  const events = []
  for (const record of requireArray(records, 'session history')) {
    const value = requireRecord(record, 'session history record')
    const event = requireRecord(value.event, 'session history event')
    if (value.type === 'event') {
      events.push(event)
      continue
    }
    if (value.type !== 'chunks' || ![
      'chunkrow/text-chunks',
      'chunkrow/reasoning-chunks',
      'chunkrow/tool-call-chunks',
    ].includes(event.type)) {
      throw new Error('session history returned an unsupported record')
    }
    if (chunkRowLength(event) === 0) throw new Error(`${event.type} returned an empty run`)
    events.push(...expandChunkRow(event))
  }
  return events
}

async function firstStreamFrame(gateway, namespace, method, args, signal) {
  const ownedAbort = signal === undefined ? new AbortController() : null
  const streamSignal = signal ?? ownedAbort.signal
  const iterable = await gateway.stream({ namespace, method, args, signal: streamSignal })
  const iteratorFactory = iterable?.[Symbol.asyncIterator] ?? iterable?.[Symbol.iterator]
  if (typeof iteratorFactory !== 'function') throw new Error(`${namespace}/${method} returned an invalid stream`)
  const iterator = iteratorFactory.call(iterable)
  try {
    const first = await iterator.next()
    if (first.done) throw new Error(`${namespace}/${method} ended before its opening frame`)
    return first.value
  } finally {
    ownedAbort?.abort()
    if (typeof iterator.return === 'function') await iterator.return()
  }
}

function requestArgs(request) {
  return { request }
}

// The RC.1 SessionController intentionally names its reserved list argument
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
    if (frame.type !== 'snapshot' || !Number.isSafeInteger(frame.cursor)) {
      throw new Error('session/follow returned an invalid opening snapshot')
    }
    return frame
  }

  const history = async (payload, signal) => {
    const request = {
      address: { kind: 'session', sessionId: payload.sessionId },
      ...(payload.maxMessages === undefined ? {} : { maxMessages: payload.maxMessages }),
    }
    const snapshot = await sessionSnapshot(request, signal)
    let records = snapshot.records
    let hasMore = snapshot.hasMore === true
    if (payload.beforeSeq !== undefined) {
      const page = requireRecord(await invoke('session', 'page', requestArgs({
        address: request.address,
        throughSeq: snapshot.cursor,
        beforeSeq: payload.beforeSeq,
        ...(payload.maxMessages === undefined ? {} : { maxMessages: payload.maxMessages }),
      }), signal), 'session/page')
      records = page.records
      hasMore = page.hasMore === true
    }
    return {
      events: expandHistoryRecords(records).map(event => ({ event })),
      hasMore,
      projections: requireRecord(snapshot.projections, 'session/follow projections'),
    }
  }

  const modelCatalog = async (signal) => requireRecord(
    await invoke('session', 'modelCatalog', {}, signal),
    'session/modelCatalog',
  )

  const commands = {
    list: (sessionId, signal) => invoke('commands', 'list', { agentId: sessionId }, signal),
    // Alpha1 renamed the execute argument to `submittedAttachments`. The parsed
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
    openControlStream(signal) {
      return typertGateway.stream({ namespace: 'session', method: 'control', args: {}, signal })
    },
    openWorkspaceStream(signal) {
      return typertGateway.stream({ namespace: 'workspace', method: 'follow', args: {}, signal })
    },
  }
}
