import { RTCPeerConnection, RTCIceCandidate } from 'react-native-webrtc';

export interface SpikeResult {
  ok: boolean;
  message: string;
}

/**
 * Spike de validación de react-native-webrtc: crea DOS RTCPeerConnection en el
 * MISMO proceso y las conecta entre sí (loopback), cruzando SDP e ICE a mano —
 * sin red ni servidor de signaling. Abre un DataChannel y hace ping→pong
 * bidireccional. Si el "pong" vuelve, el módulo nativo (JSI + DataChannel)
 * funciona end-to-end en este build. Aísla exactamente la pieza más riesgosa
 * antes de construir el flujo de sync real.
 */
export async function runWebRTCLoopbackSpike(log: (line: string) => void): Promise<SpikeResult> {
  // Tipamos como `any`: react-native-webrtc extiende EventTarget en runtime
  // (addEventListener funciona) pero sus tipos TS no lo exponen. Es un spike.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let pcA: any = null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let pcB: any = null;
  const cleanup = () => {
    try { pcA?.close(); } catch { /* noop */ }
    try { pcB?.close(); } catch { /* noop */ }
  };

  try {
    pcA = new RTCPeerConnection({ iceServers: [] });
    pcB = new RTCPeerConnection({ iceServers: [] });

    const result = await new Promise<SpikeResult>((resolve) => {
      const timeout = setTimeout(() => {
        resolve({
          ok: false,
          message: 'Timeout (10s): el DataChannel no se abrió. La conexión ICE loopback no completó.',
        });
      }, 10000);
      const finish = (r: SpikeResult) => { clearTimeout(timeout); resolve(r); };

      // ICE: cruzamos los candidatos a mano (loopback, sin red).
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      pcA!.addEventListener('icecandidate', (e: any) => {
        if (e.candidate) pcB!.addIceCandidate(new RTCIceCandidate(e.candidate)).catch(() => {});
      });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      pcB!.addEventListener('icecandidate', (e: any) => {
        if (e.candidate) pcA!.addIceCandidate(new RTCIceCandidate(e.candidate)).catch(() => {});
      });

      // Lado receptor (B).
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      pcB!.addEventListener('datachannel', (e: any) => {
        log('B recibió el DataChannel');
        const ch = e.channel;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ch.addEventListener('message', (ev: any) => {
          log(`B recibió: "${ev.data}"`);
          if (ev.data === 'ping') ch.send('pong');
        });
      });

      // Lado emisor (A).
      const channel = pcA!.createDataChannel('spike');
      channel.addEventListener('open', () => {
        log('canal abierto (A) → enviando "ping"');
        channel.send('ping');
      });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      channel.addEventListener('message', (ev: any) => {
        log(`A recibió: "${ev.data}"`);
        if (ev.data === 'pong') {
          finish({ ok: true, message: '✅ WebRTC OK — DataChannel bidireccional (ping→pong) funcionando.' });
        }
      });

      // Handshake SDP loopback.
      (async () => {
        try {
          const offer = await pcA!.createOffer({});
          await pcA!.setLocalDescription(offer);
          await pcB!.setRemoteDescription(offer);
          const answer = await pcB!.createAnswer();
          await pcB!.setLocalDescription(answer);
          await pcA!.setRemoteDescription(answer);
          log('SDP offer/answer intercambiado (loopback)');
        } catch (err) {
          finish({
            ok: false,
            message: `Error en el handshake SDP: ${err instanceof Error ? err.message : String(err)}`,
          });
        }
      })();
    });

    cleanup();
    return result;
  } catch (e) {
    cleanup();
    return {
      ok: false,
      message: `No se pudo crear RTCPeerConnection (¿módulo nativo sin linkear? falta rebuild): ${e instanceof Error ? e.message : String(e)}`,
    };
  }
}
