import { RemixIcon } from '../icons/RemixIcons';
import type { mcpClients } from './mcpClients';
import { ProviderAvatar } from './settingsPrimitives';

export function McpClientAvatar({ client }: { client: typeof mcpClients[number] }) {
  return client.id === 'mcp'
    ? <span className="om-avatar" aria-hidden="true"><RemixIcon name="plug-line" size={24} /></span>
    : <ProviderAvatar name={client.name} provider={{ id: client.brand, custom: false }} />;
}
