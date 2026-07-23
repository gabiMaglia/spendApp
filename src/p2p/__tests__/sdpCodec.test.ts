import { encodeSignal, decodeSignal } from '../sdpCodec';

// SDP realista (recortado) para medir compresión.
const SAMPLE_SDP = `v=0
o=- 4611731400430051336 2 IN IP4 127.0.0.1
s=-
t=0 0
a=group:BUNDLE 0
m=application 9 UDP/DTLS/SCTP webrtc-datachannel
c=IN IP4 0.0.0.0
a=ice-ufrag:abcd
a=ice-pwd:0123456789abcdef0123456789
a=fingerprint:sha-256 AB:CD:EF:12:34:56:78:90:AB:CD:EF:12:34:56:78:90:AB:CD:EF:12:34:56:78:90:AB:CD:EF:12:34:56:78:90
a=setup:actpass
a=mid:0
a=sctp-port:5000
a=candidate:1 1 udp 2113937151 192.168.1.10 54321 typ host
a=candidate:2 1 udp 1677729535 200.1.2.3 40000 typ srflx raddr 192.168.1.10 rport 54321`;

describe('sdpCodec', () => {
  it('roundtrip: decode(encode(x)) devuelve el mismo tipo y sdp', () => {
    const encoded = encodeSignal('offer', SAMPLE_SDP);
    const sig = decodeSignal(encoded);
    expect(sig.t).toBe('offer');
    expect(sig.sdp).toBe(SAMPLE_SDP);
  });

  it('preserva answer', () => {
    const sig = decodeSignal(encodeSignal('answer', SAMPLE_SDP));
    expect(sig.t).toBe('answer');
    expect(sig.sdp).toBe(SAMPLE_SDP);
  });

  it('el string codificado es más chico que el SDP crudo (comprime)', () => {
    const encoded = encodeSignal('offer', SAMPLE_SDP);
    expect(encoded.length).toBeLessThan(SAMPLE_SDP.length);
  });

  it('el string codificado es base64 (apto para QR)', () => {
    const encoded = encodeSignal('offer', SAMPLE_SDP);
    expect(encoded).toMatch(/^[A-Za-z0-9+/]+=*$/);
  });

  it('lanza sync.pair_invalid_signal ante payload corrupto', () => {
    expect(() => decodeSignal('no-es-base64-valido!!!###')).toThrow('sync.pair_invalid_signal');
    expect(() => decodeSignal('')).toThrow('sync.pair_invalid_signal');
  });

  it('roundtrip con contenido multibyte (utf-8)', () => {
    const sdp = SAMPLE_SDP + '\na=note:áéí ñ 日本 🚀';
    const sig = decodeSignal(encodeSignal('offer', sdp));
    expect(sig.sdp).toBe(sdp);
  });
});
