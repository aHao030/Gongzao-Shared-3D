// Only these bounded, non-sensitive outcomes may leave a farm computer.
// A partial sweep can affirm a device it actually observed, but absence in
// a partial sweep is not evidence that a previously observed printer stopped.
const coverage = new Map([
  ['DISCOVERY_FAILED','all'], ['DISCOVERY_TARGET_LIMIT','all'], ['NO_LOCAL_IPV4_INTERFACE','all'],
  ['BAMBU_DISCOVERY_LIMIT','bambu'], ['BAMBU_PACKET_LIMIT','bambu'], ['BAMBU_LISTEN_UNAVAILABLE','bambu'],
  ['BAMBU_MULTICAST_UNAVAILABLE','bambu'], ['BAMBU_LISTEN_DISABLED','bambu'],
  ['BAMBU_DISCOVERY_IDENTITY_CONFLICT','bambu'], ['BAMBU_CONFIG_ADDRESS_CHANGED','bambu'],
  ['MDNS_SOCKET_UNAVAILABLE','http'], ['MDNS_SEND_FAILED','http'], ['INVALID_DISCOVERY_ADDRESS','http']
]);

export function sanitizePartialDiagnostics(codes) {
  return Array.isArray(codes) ? [...new Set(codes.filter(code => coverage.has(code)))].sort() : [];
}

export function incompleteForProtocol(codes, protocol) {
  return Array.isArray(codes) && codes.some(code => {
    const group = coverage.get(code);
    return group === 'all' || group === (protocol === 'bambu' ? 'bambu' : 'http');
  });
}
