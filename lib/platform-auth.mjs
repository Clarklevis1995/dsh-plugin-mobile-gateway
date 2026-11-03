// Optional adapter: all identity and authorization remain owned by platformAccess.
// The central factory assigns authority to the verified account, never the device.
export function platformAdmission(ctx, request) {
  const access = ctx.get('platformAccess');
  if (!access) return null;
  const { principal } = access.authenticateHttp(request);
  access.requirePrincipal(principal);
  return { access, principal };
}

export function canRead(admission, sessionId) {
  if (!admission) return true;
  try {
    admission.access.requireSession(admission.principal, String(sessionId), 'read');
    return true;
  } catch { return false; }
}

export function canAnswer(admission, sessionId) {
  return !admission || admission.access.canAnswer(admission.principal, String(sessionId));
}

export function filterPlatformFrame(admission, frame) {
  if (!admission) return frame;
  const { access, principal } = admission;
  try { access.requirePrincipal(principal); } catch { return null; }
  if (frame.sessionId && !canRead(admission, frame.sessionId)) {
    if (frame.kind === 'error') return { kind: 'error', code: 'access-denied', message: 'Session access denied', requestType: frame.requestType, requestId: frame.requestId };
    return null;
  }
  if (/^(question|approval)-/.test(frame.kind) && !canAnswer(admission, frame.sessionId)) return null;
  if (!access.isOwner(principal) && /^plugin|^schedule-/.test(frame.kind)) return null;
  if (frame.kind === 'session-archives') return { ...frame, archivedSessionIds: frame.archivedSessionIds.filter(id => canRead(admission, id)) };
  if (frame.kind === 'session-queues') return { ...frame, queues: Object.fromEntries(Object.entries(frame.queues).filter(([id]) => canRead(admission, id))) };
  if (frame.kind === 'projection-baseline') return { ...frame, projections: Object.fromEntries(Object.entries(frame.projections).filter(([id]) => canRead(admission, id))) };
  return frame;
}

export function createActorApi(ctx, admission, adapter, deviceId) {
  const { access, principal } = admission;
  const peer = access.acquirePrincipalPeer(principal, { channel: 'mobile', loginId: deviceId, interactions: 'none' });
  const base = adapter(ctx.typertGateway, peer, ctx.connection);
  base.sessions.create = async payload => {
    access.requirePrincipal(principal);
    const workspaceId = payload.workspaceId;
    const matches = access.config.projects.filter(project => access.project(project.id).workspaceIds?.includes(workspaceId));
    if (matches.length !== 1) throw new Error('A unique authorized project workspace is required');
    return access.createSessionForPrincipal(principal, {
      projectId: matches[0].id, workspaceId, agentPreset: payload.agentPreset,
      creationKey: payload.requestId, visibility: 'private',
    });
  };
  const upload = base.files.upload;
  base.files.upload = async (payload, signal) => {
    access.requireSession(principal, payload.sessionId, 'write');
    if (ctx.get('platformFileIngress')?.ready !== true) throw new Error('Native all-client attachment ingress is not ready');
    return upload(payload, signal);
  };
  // Every method, including methods not allowed by current policy, still goes
  // through the native Gateway with this actor Peer. There is no owner fallback.
  const guarded = (value, receiver) => typeof value === 'function'
    ? (...args) => {
      access.requirePrincipal(principal);
      peer.signal.throwIfAborted();
      return access.runAsPrincipal(principal, () => value.apply(receiver, args));
    }
    : value && typeof value === 'object'
      ? new Proxy(value, { get(target, key) { return guarded(Reflect.get(target, key), target); } })
      : value;
  return { api: guarded(base), peer };
}

// The native control streams already enforce current resource access. The
// additional per-frame check closes the revocation-to-transport race.
export function followActorCatalogs(ws, api, admission, send, signal) {
  const emit = frame => { const filtered = filterPlatformFrame(admission, frame); if (filtered && ws.readyState === 1) send(filtered); };
  const queues = values => Object.fromEntries(Object.entries(values ?? {}).map(([id, record]) => {
    const inbox = record.values?.inbox;
    const items = ['next-turn', 'next-step'].flatMap(target => (inbox?.[target] ?? []).map(message => ({
      id: message.id, placement: target === 'next-turn' ? 'queued' : message.source?.kind === 'user' ? 'steering' : 'context',
      ...(message.source?.rpcId ? { rpcId: message.source.rpcId } : {}), message: { id: message.id, content: message.content },
    })));
    return [id, items];
  }));
  const keys = { todos: 'tasks-updated', goal: 'goal-updated', turnOutline: 'turn-outline-updated',
    agentTeam: 'agent-team-updated', subagentCatalog: 'subagents-updated', subagent: 'subagent-identity-updated', subagentTiming: 'subagent-timing-updated' };
  const tasks = [
    (async () => {
      for await (const frame of await api.openWorkspaceStream(signal)) {
        const ids = frame.type === 'baseline' ? frame.value?.archivedSessionIds : frame.archivedSessionIds;
        if (Array.isArray(ids)) emit({ kind: 'session-archives', archivedSessionIds: ids });
      }
    })(),
    (async () => {
      for await (const frame of await api.openControlStream(signal)) {
        if (frame.type === 'baseline') {
          emit({ kind: 'projection-baseline', projections: frame.value.projections });
          emit({ kind: 'session-queues', queues: queues(frame.value.projections) });
        } else if (frame.type === 'projection') {
          if (frame.key === 'inbox') emit({ kind: 'session-queue', sessionId: frame.sessionId,
            items: queues({ [frame.sessionId]: { values: { inbox: frame.value } } })[frame.sessionId] });
          else if (keys[frame.key]) emit({ kind: keys[frame.key], sessionId: frame.sessionId, asOfSeq: frame.seq, [frame.key]: frame.value });
        }
      }
    })(),
  ];
  return Promise.all(tasks).catch(error => { if (!signal.aborted && ws.readyState === 1) ws.close(1011, 'Mobile authorization stream ended'); });
}
