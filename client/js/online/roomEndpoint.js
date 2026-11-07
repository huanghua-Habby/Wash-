/** Published static pages explicitly select the PC authority; LAN pages use their own host. */
export function roomEndpoint(location, configured = '') {
  if (configured) {
    const endpoint = new URL(configured);
    if (!['ws:', 'wss:'].includes(endpoint.protocol) || endpoint.username || endpoint.password) {
      throw new Error('房间服地址必须使用 ws:// 或 wss://');
    }
    return endpoint.href;
  }
  const prefix = location.pathname.match(/^\/mp\/[^/]+/)?.[0] || '';
  return `${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}${prefix}/ws`;
}
