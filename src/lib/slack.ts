const MAX_CHARS = 3500;

export async function safePostMessage(client: any, params: {
  channel: string;
  text: string;
  thread_ts?: string;
}) {
  for (const chunk of chunkText(params.text, MAX_CHARS)) {
    await retry(() => client.chat.postMessage({
      channel: params.channel,
      text: chunk,
      thread_ts: params.thread_ts,
    }));
  }
}

function* chunkText(s: string, max: number) {
  let i = 0;
  while (i < s.length) {
    yield s.slice(i, i + max);
    i += max;
  }
}

async function retry<T>(fn: () => Promise<T>, attempts = 5, baseMs = 500): Promise<T> {
  let lastErr: any;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err: any) {
      lastErr = err;
      const retryAfter = Number(err?.data?.headers?.['retry-after']);
      const delay = Number.isFinite(retryAfter) ? retryAfter * 1000 : baseMs * 2 ** i;
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw lastErr;
}


