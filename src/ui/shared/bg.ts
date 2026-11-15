import type { Reply, UiCommand } from '@/shared/messages';

/** Send a command to the service worker and unwrap the reply. */
export async function bg<T>(cmd: UiCommand): Promise<T> {
  const reply = (await chrome.runtime.sendMessage(cmd)) as Reply<T> | undefined;
  if (!reply) throw new Error('The extension background did not respond.');
  if (!reply.ok) throw new Error(reply.error);
  return reply.value;
}
