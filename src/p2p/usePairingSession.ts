import { useCallback, useEffect, useRef, useState } from 'react';
import { RTCPeerConnection, RTCSessionDescription } from 'react-native-webrtc';
import { encodeSignal, decodeSignal } from './sdpCodec';
import { buildDelta, applyDelta, deltaToQRString, parseDeltaFromQR } from '@/src/sync/useSyncQR';

export type PairingRole = 'offer' | 'answer';
// idle → preparing (creando SDP + ICE) → awaiting-peer (mostrando MI QR / esperando
// al otro) → connecting → syncing → done | error
export type PairingPhase = 'idle' | 'preparing' | 'awaiting-peer' | 'connecting' | 'syncing' | 'done' | 'error';

export interface PairingSummary { records: number; }

// STUN de Google para atravesar NAT entre redes distintas. Solo expone la IP
// pública propia al STUN (metadata mínima estándar); no hay servidor de
// signaling ni tercero que vea con quién te conectás (eso viaja por el QR).
const ICE_SERVERS = [{ urls: 'stun:stun.l.google.com:19302' }];
const CHANNEL_LABEL = 'splitp2p-sync';

/**
 * Sesión de emparejamiento WebRTC por QR (serverless). El canal WebRTC ya viaja
 * cifrado con DTLS end-to-end; el fingerprint va dentro del SDP del QR, así que
 * el escaneo físico autentica al peer y pinnea la clave (sin MITM).
 */
export function usePairingSession(currentUserId: string) {
  const [phase, setPhase] = useState<PairingPhase>('idle');
  const [role, setRole] = useState<PairingRole | null>(null);
  const [mySignal, setMySignal] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<PairingSummary | null>(null);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const pcRef = useRef<any>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const channelRef = useRef<any>(null);
  const doneRef = useRef(false);

  const fail = useCallback((key: string) => { setError(key); setPhase('error'); }, []);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const wireChannel = useCallback((ch: any) => {
    channelRef.current = ch;
    ch.addEventListener('open', () => {
      setPhase('syncing');
      try { ch.send(deltaToQRString(buildDelta(currentUserId))); } catch { /* noop */ }
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ch.addEventListener('message', (ev: any) => {
      if (doneRef.current) return;
      try {
        const raw = typeof ev.data === 'string' ? ev.data : String(ev.data);
        const delta = parseDeltaFromQR(raw);
        applyDelta(delta, currentUserId);
        const records =
          (delta.groups?.length ?? 0) + (delta.expenses?.length ?? 0) +
          (delta.payments?.length ?? 0) + (delta.users?.length ?? 0);
        doneRef.current = true;
        setSummary({ records });
        setPhase('done');
      } catch {
        fail('sync.pair_bad_data');
      }
    });
  }, [currentUserId, fail]);

  const newPc = useCallback(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const pc: any = new RTCPeerConnection({ iceServers: ICE_SERVERS });
    pc.addEventListener('connectionstatechange', () => {
      const st = pc.connectionState;
      if ((st === 'failed' || st === 'closed') && !doneRef.current) fail('sync.pair_connection_failed');
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    pc.addEventListener('datachannel', (e: any) => wireChannel(e.channel));
    pcRef.current = pc;
    return pc;
  }, [wireChannel, fail]);

  // Espera a que ICE termine de juntar candidatos (non-trickle): así el SDP del
  // QR ya trae todos los candidatos y no hace falta signaling en vivo.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const gatherComplete = (pc: any) => new Promise<void>((resolve) => {
    if (pc.iceGatheringState === 'complete') return resolve();
    const check = () => { if (pc.iceGatheringState === 'complete') resolve(); };
    pc.addEventListener('icegatheringstatechange', check);
    setTimeout(resolve, 4000); // safety net: usar los candidatos juntados hasta acá
  });

  /** Rol OFERENTE: crea la oferta y expone su QR. */
  const startAsOfferer = useCallback(async () => {
    try {
      setRole('offer'); setError(null); setSummary(null); doneRef.current = false; setPhase('preparing');
      const pc = newPc();
      wireChannel(pc.createDataChannel(CHANNEL_LABEL));
      const offer = await pc.createOffer({});
      await pc.setLocalDescription(offer);
      await gatherComplete(pc);
      setMySignal(encodeSignal('offer', pc.localDescription.sdp));
      setPhase('awaiting-peer');
    } catch {
      fail('sync.pair_failed');
    }
  }, [newPc, wireChannel, fail]);

  /** Rol RESPONDEDOR: escaneó la oferta → genera la respuesta y expone su QR. */
  const acceptOfferAndAnswer = useCallback(async (offerPayload: string) => {
    try {
      const sig = decodeSignal(offerPayload);
      if (sig.t !== 'offer') return fail('sync.pair_expected_offer');
      setRole('answer'); setError(null); setSummary(null); doneRef.current = false; setPhase('preparing');
      const pc = newPc();
      await pc.setRemoteDescription(new RTCSessionDescription({ type: 'offer', sdp: sig.sdp }));
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      await gatherComplete(pc);
      setMySignal(encodeSignal('answer', pc.localDescription.sdp));
      setPhase('awaiting-peer');
    } catch (e) {
      fail(e instanceof Error && e.message.startsWith('sync.') ? e.message : 'sync.pair_failed');
    }
  }, [newPc, fail]);

  /** Rol OFERENTE: escaneó la respuesta → completa la conexión. */
  const acceptAnswer = useCallback(async (answerPayload: string) => {
    try {
      const sig = decodeSignal(answerPayload);
      if (sig.t !== 'answer') return fail('sync.pair_expected_answer');
      const pc = pcRef.current;
      if (!pc) return fail('sync.pair_failed');
      setPhase('connecting');
      await pc.setRemoteDescription(new RTCSessionDescription({ type: 'answer', sdp: sig.sdp }));
    } catch (e) {
      fail(e instanceof Error && e.message.startsWith('sync.') ? e.message : 'sync.pair_failed');
    }
  }, [fail]);

  const reset = useCallback(() => {
    try { channelRef.current?.close(); } catch { /* noop */ }
    try { pcRef.current?.close(); } catch { /* noop */ }
    channelRef.current = null; pcRef.current = null; doneRef.current = false;
    setPhase('idle'); setRole(null); setMySignal(null); setError(null); setSummary(null);
  }, []);

  // Cierra la conexión al desmontar.
  useEffect(() => () => {
    try { channelRef.current?.close(); } catch { /* noop */ }
    try { pcRef.current?.close(); } catch { /* noop */ }
  }, []);

  return { phase, role, mySignal, error, summary, startAsOfferer, acceptOfferAndAnswer, acceptAnswer, reset };
}
