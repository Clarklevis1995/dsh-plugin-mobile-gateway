import { createHash, randomUUID } from 'node:crypto';
import { posix } from 'node:path';

// Project files are resolved only in the session's verified execution realm.
export function createPlatformFiles(ctx, admission, options) {
  const { access, principal } = admission;
  const execution = ctx.get('platformExecution');
  if (!execution) throw new Error('Mobile project files require platformExecution');
  const transfers = new Map();
  async function resolve(sessionId, input = '.', signal) {
    access.requireSession(principal, sessionId, 'read');
    const { agent, root } = await execution.artifactContext(principal, sessionId, 'read');
    const fs = execution.serviceFor(agent, 'fs');
    if (typeof input !== 'string' || input.includes('\0') || input.includes('\\') || input.split('/').includes('..')) throw new Error('Invalid project file path');
    const parent = await fs.resolve(root, { signal });
    const target = await fs.resolve(input, { cwd: root, signal });
    if (!fs.contains(parent, target)) throw new Error('File is outside the project workspace');
    const stat = await fs.stat(target, signal);
    if (!stat) throw new Error('File does not exist');
    const path = posix.relative(fs.processPath(parent), fs.processPath(target)) || '.';
    return { fs, target, stat, path };
  }
  const media = name => /\.pdf$/i.test(name) ? 'application/pdf' : /\.png$/i.test(name) ? 'image/png'
    : /\.jpe?g$/i.test(name) ? 'image/jpeg' : /\.(txt|md|json|ya?ml|csv|log|ts|js|py)$/i.test(name) ? 'text/plain' : 'application/octet-stream';
  const metadata = value => ({ path: value.path, name: posix.basename(value.path), size: value.stat.size,
    mediaType: media(value.path), modifiedAt: value.stat.modifiedAt ?? value.stat.mtimeMs ?? null });
  return {
    async handle(client, msg) {
      try {
        if (!options.fileDownloadsEnabled) throw new Error('File downloads are disabled');
        const signal = client.platformAbort.signal;
        signal.throwIfAborted();
        let frame, authorizedSession = msg.sessionId;
        if (msg.type === 'file-list' || msg.type === 'file-resolve' || msg.type === 'file-download-open') {
          const value = await resolve(msg.sessionId, msg.path, signal);
          if (msg.type === 'file-list') {
            if (value.stat.type !== 'directory') throw new Error('Path is not a directory');
            const listed = await value.fs.listDir(value.target, signal);
            const entries = [];
            for (const item of listed) {
              const target = item.target;
              if (!target || !value.fs.contains(value.target, target)) continue;
              const stat = await value.fs.stat(target, signal);
              if (!stat || !['file', 'directory'].includes(stat.type)) continue;
              const path = posix.join(value.path === '.' ? '' : value.path, item.name);
              entries.push({ name: item.name, path, kind: stat.type, ...(stat.type === 'file' ? { bytes: stat.size, mediaType: media(path), modifiedAt: stat.modifiedAt ?? stat.mtimeMs ?? null } : {}) });
            }
            frame = { kind: 'file-list', sessionId: msg.sessionId, path: value.path, entries };
          } else {
            if (value.stat.type !== 'file' || !Number.isSafeInteger(value.stat.size) || value.stat.size > options.fileDownloadMaxBytes) throw new Error('File is not downloadable');
            const meta = metadata(value);
            if (msg.type === 'file-resolve') frame = { kind: 'file-resolved', sessionId: msg.sessionId, ...meta };
            else {
              if (transfers.size >= options.fileDownloadMaxTransfers) throw new Error('Too many downloads');
              const id = randomUUID();
              transfers.set(id, { client, ...value, sessionId: msg.sessionId, offset: 0, hash: createHash('sha256'), activeAt: Date.now(), busy: false });
              frame = { kind: 'file-download-opened', transferId: id, sessionId: msg.sessionId, ...meta, chunkBytes: options.fileDownloadChunkBytes };
            }
          }
        } else {
          const transfer = transfers.get(msg.transferId);
          if (!transfer || transfer.client !== client) throw new Error('Download is no longer active');
          access.requireSession(principal, transfer.sessionId, 'read');
          authorizedSession = transfer.sessionId;
          if (msg.type === 'file-download-cancel') { transfers.delete(msg.transferId); frame = { kind: 'file-download-cancelled', transferId: msg.transferId }; }
          else {
            if (transfer.busy || msg.offset !== transfer.offset) throw new Error('Invalid download offset');
            transfer.busy = true;
            try {
              const fresh = await resolve(transfer.sessionId, transfer.path, signal);
              if (fresh.target.targetKey !== transfer.target.targetKey || fresh.stat.version !== transfer.stat.version) throw new Error('File changed during download');
              const data = Buffer.from(await fresh.fs.readByteRange(fresh.target, { offset: transfer.offset, length: Math.min(options.fileDownloadChunkBytes, transfer.stat.size - transfer.offset) }, signal));
              const offset = transfer.offset;
              transfer.offset += data.length; transfer.activeAt = Date.now(); transfer.hash.update(data);
              const eof = transfer.offset === transfer.stat.size;
              frame = { kind: 'file-download-chunk', transferId: msg.transferId, offset, data: data.toString('base64'), eof };
              if (eof) { frame.sha256 = transfer.hash.digest('hex'); transfers.delete(msg.transferId); }
            } finally { transfer.busy = false; }
          }
        }
        access.requireSession(principal, authorizedSession, 'read');
        return { ...frame, ...(msg.requestId ? { requestId: msg.requestId } : {}) };
      } catch (error) { return { kind: 'error', code: 'file-access-denied', requestType: msg.type, requestId: msg.requestId, message: error.message }; }
    },
    async expire() { for (const [id, value] of transfers) if (!value.busy && value.activeAt + options.fileDownloadIdleMs < Date.now()) transfers.delete(id); },
    async closeClient(client) { for (const [id, value] of transfers) if (value.client === client) transfers.delete(id); },
    async dispose() { transfers.clear(); },
  };
}
