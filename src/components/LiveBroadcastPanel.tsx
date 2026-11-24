import { useEffect, useRef, useState } from 'react';
import {
  Cast,
  CheckCircle2,
  Download,
  ExternalLink,
  Mic,
  MonitorPlay,
  Pause,
  PictureInPicture2,
  Play,
  Radio,
  Search,
  Smartphone,
  Square,
  Tv,
  Users,
  Volume2,
  VolumeX,
} from 'lucide-react';

interface NativeAppSource {
  id: string;
  label: string;
  category: string;
  androidPackage?: string;
  webUrl: string;
}

const NATIVE_APP_SOURCES: NativeAppSource[] = [
  {
    id: 'direct_screen',
    label: 'Tela Direta (Sem App)',
    category: 'Espelhar tela direto',
    webUrl: '',
  },
  {
    id: 'flatv',
    label: 'FlaTV+',
    category: 'Canal Oficial',
    androidPackage: 'com.flamengo.flatv',
    webUrl: 'https://flatvmais.com.br',
  },
  {
    id: 'premiere',
    label: 'Premiere',
    category: 'Brasileirão & Copa',
    androidPackage: 'com.globo.premierefc',
    webUrl: 'https://premiere.globo.com',
  },
  {
    id: 'globoplay',
    label: 'Globoplay',
    category: 'TV Globo / SporTV',
    androidPackage: 'com.globo.globotv',
    webUrl: 'https://globoplay.globo.com',
  },
  {
    id: 'cazetv',
    label: 'CazéTV',
    category: 'Streaming Ao Vivo',
    androidPackage: 'com.google.android.youtube',
    webUrl: 'https://www.youtube.com/@CazeTV',
  },
  {
    id: 'espn',
    label: 'ESPN / Disney+',
    category: 'Libertadores',
    androidPackage: 'com.disney.disneyplus',
    webUrl: 'https://www.disneyplus.com',
  },
  {
    id: 'paramount',
    label: 'Paramount+',
    category: 'Copas',
    androidPackage: 'com.cbs.ca',
    webUrl: 'https://www.paramountplus.com',
  },
  {
    id: 'iptv',
    label: 'Player IPTV / Nativo',
    category: 'App instalado',
    androidPackage: 'com.nst.iptvsmarterstvbox',
    webUrl: 'https://play.google.com/store/apps/details?id=com.nst.iptvsmarterstvbox',
  },
  {
    id: 'custom',
    label: 'Outro App Nativo',
    category: 'Buscar no celular',
    webUrl: 'https://play.google.com/store',
  },
];

function buildMobileAppLaunchHref(source: NativeAppSource, customPkg: string): string {
  const isAndroid = typeof navigator !== 'undefined' && /Android/i.test(navigator.userAgent);
  const rawPkg =
    source.id === 'custom'
      ? customPkg.trim()
      : source.androidPackage || customPkg.trim();
  const safePkg = /^[a-zA-Z0-9_.]+$/.test(rawPkg) ? rawPkg : '';
  if (isAndroid && safePkg) {
    const fallback = source.webUrl || 'https://play.google.com/store';
    return `intent://#Intent;scheme=https;package=${safePkg};S.browser_fallback_url=${encodeURIComponent(
      fallback
    )};end`;
  }
  return source.webUrl || '#';
}

type QualityPreset = '720p' | '1080p' | '480p';

const QUALITY_CONFIG: Record<
  QualityPreset,
  { width: number; height: number; fps: number; jpeg: number; label: string }
> = {
  '1080p': { width: 1920, height: 1080, fps: 20, jpeg: 0.72, label: '1080p Full HD' },
  '720p': { width: 1280, height: 720, fps: 24, jpeg: 0.72, label: '720p HD (Recomendado)' },
  '480p': { width: 854, height: 480, fps: 18, jpeg: 0.65, label: '480p Economia' },
};

interface DocumentPipApi {
  requestWindow: (options?: { width?: number; height?: number }) => Promise<Window>;
}

interface RemoteLiveState {
  isLive: boolean;
  title: string;
  sourceApp: string;
  viewerCount: number;
}

interface LiveBroadcastPanelProps {
  getAdminToken: () => Promise<string | null>;
  appName: string;
}

export function LiveBroadcastPanel({ getAdminToken, appName }: LiveBroadcastPanelProps) {
  const [selectedSourceId, setSelectedSourceId] = useState<string>('direct_screen');
  const [customSourceName, setCustomSourceName] = useState('');
  const [customPackageName, setCustomPackageName] = useState('');
  const [nativeSearchQuery, setNativeSearchQuery] = useState('');
  const [broadcastTitle, setBroadcastTitle] = useState(`Flamengo Ao Vivo · ${appName}`);
  const [quality, setQuality] = useState<QualityPreset>('720p');
  const [captureAudio, setCaptureAudio] = useState(true);
  const [includeMicAudio, setIncludeMicAudio] = useState(true);
  const [autoPublishOnStart, setAutoPublishOnStart] = useState(true);

  const [isLive, setIsLive] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [searchingNative, setSearchingNative] = useState(false);
  const [nativeFallbackVisible, setNativeFallbackVisible] = useState(false);
  const [remoteLiveState, setRemoteLiveState] = useState<RemoteLiveState | null>(null);
  const [pipActive, setPipActive] = useState(false);

  const [viewerCount, setViewerCount] = useState(0);
  const [elapsedSec, setElapsedSec] = useState(0);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [hasCapturedAudio, setHasCapturedAudio] = useState(false);
  const [framesSent, setFramesSent] = useState(0);

  const previewVideoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const micStreamRef = useRef<MediaStream | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const frameTimerRef = useRef<number | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const timerIntervalRef = useRef<number | null>(null);
  const sendingFrameRef = useRef(false);
  const isPausedRef = useRef(false);
  isPausedRef.current = isPaused;
  const pipWindowRef = useRef<Window | null>(null);
  const pipButtonRef = useRef<HTMLButtonElement | null>(null);

  const isAndroidBrowser =
    typeof navigator !== 'undefined' && /Android/i.test(navigator.userAgent);
  const supportsWebDisplayCapture =
    typeof navigator !== 'undefined' &&
    Boolean(navigator.mediaDevices && typeof navigator.mediaDevices.getDisplayMedia === 'function');
  const supportsDocumentPip =
    typeof window !== 'undefined' &&
    Boolean((window as unknown as { documentPictureInPicture?: DocumentPipApi }).documentPictureInPicture);

  const activeSourceObj =
    NATIVE_APP_SOURCES.find((s) => s.id === selectedSourceId) || NATIVE_APP_SOURCES[0];
  const selectedSource =
    selectedSourceId === 'direct_screen'
      ? 'Tela Direta do Aparelho'
      : selectedSourceId === 'custom'
        ? customSourceName.trim() || nativeSearchQuery.trim() || 'App Nativo Selecionado'
        : activeSourceObj.label;

  const effectiveTargetPkg =
    selectedSourceId === 'custom'
      ? customPackageName.trim()
      : activeSourceObj.androidPackage || '';
  const mobileLaunchHref = buildMobileAppLaunchHref(activeSourceObj, customPackageName);
  const effectiveLive = isLive || Boolean(remoteLiveState?.isLive);
  const effectiveViewers = isLive ? viewerCount : remoteLiveState?.viewerCount ?? 0;

  // Poll /api/live/status so when the Android native APK starts transmitting, the panel shows AO VIVO immediately
  useEffect(() => {
    const checkStatus = () => {
      fetch('/api/live/status')
        .then((r) => (r.ok ? r.json() : null))
        .then((data: RemoteLiveState | null) => {
          if (data) setRemoteLiveState(data);
        })
        .catch(() => undefined);
    };
    checkStatus();
    const id = window.setInterval(checkStatus, 2500);
    return () => window.clearInterval(id);
  }, []);

  // Keep Picture-in-Picture floating button label/state synced
  useEffect(() => {
    const btn = pipButtonRef.current;
    if (!btn) return;
    if (isLive) {
      btn.textContent = `● AO VIVO ${formatDuration(elapsedSec)} · PARAR`;
      btn.style.background = '#059669';
    } else if (connecting) {
      btn.textContent = 'INICIANDO...';
      btn.style.background = '#991b1b';
    } else {
      btn.textContent = 'INICIAR TRANSMISSÃO';
      btn.style.background = '#C8102E';
    }
  }, [isLive, connecting, elapsedSec]);

  function cleanupBroadcastResources(notifyStop: boolean) {
    if (frameTimerRef.current !== null) {
      window.clearInterval(frameTimerRef.current);
      frameTimerRef.current = null;
    }
    if (timerIntervalRef.current !== null) {
      window.clearInterval(timerIntervalRef.current);
      timerIntervalRef.current = null;
    }
    if (processorRef.current) {
      try {
        processorRef.current.disconnect();
      } catch {
        // ignore
      }
      processorRef.current = null;
    }
    if (audioCtxRef.current) {
      void audioCtxRef.current.close().catch(() => undefined);
      audioCtxRef.current = null;
    }
    if (streamRef.current) {
      for (const track of streamRef.current.getTracks()) {
        track.stop();
      }
      streamRef.current = null;
    }
    if (micStreamRef.current) {
      for (const track of micStreamRef.current.getTracks()) {
        track.stop();
      }
      micStreamRef.current = null;
    }
    if (previewVideoRef.current) {
      previewVideoRef.current.srcObject = null;
    }
    if (wsRef.current) {
      try {
        if (notifyStop && wsRef.current.readyState === WebSocket.OPEN) {
          wsRef.current.send(JSON.stringify({ type: 'broadcast:stop' }));
        }
        wsRef.current.close();
      } catch {
        // ignore
      }
      wsRef.current = null;
    }
    sendingFrameRef.current = false;
    setIsLive(false);
    setIsPaused(false);
    setConnecting(false);
    setHasCapturedAudio(false);
  }

  useEffect(() => {
    return () => {
      cleanupBroadcastResources(true);
      try {
        pipWindowRef.current?.close();
      } catch {
        // ignore
      }
    };
  }, []);

  async function requestHandoffCredentials(): Promise<{
    token: string;
    serverUrl: string;
  } | null> {
    const adminToken = await getAdminToken();
    if (!adminToken) {
      setErrorMsg('Sessão administrativa expirada. Faça login novamente.');
      return null;
    }

    if (autoPublishOnStart) {
      void fetch('/api/admin/auto-publicar', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${adminToken}`,
        },
        body: JSON.stringify({ siteUrl: window.location.origin }),
      }).catch(() => undefined);
    }

    const res = await fetch('/api/admin/broadcast-handoff-token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
    });
    if (!res.ok) {
      return { token: adminToken, serverUrl: window.location.origin };
    }
    const data = (await res.json()) as { token?: string; serverUrl?: string };
    return {
      token: data.token || adminToken,
      serverUrl: data.serverUrl || window.location.origin,
    };
  }

  async function launchNativeTransmitter(options: {
    autoStart: boolean;
    directScreen: boolean;
    overlayMode?: boolean;
    searchQuery?: string;
    targetPkg?: string;
  }) {
    setErrorMsg(null);
    setNativeFallbackVisible(false);
    setSearchingNative(true);

    try {
      const creds = await requestHandoffCredentials();
      if (!creds) {
        setSearchingNative(false);
        return;
      }

      const params = new URLSearchParams();
      params.set('server', creds.serverUrl);
      params.set('token', creds.token);
      params.set('title', broadcastTitle.trim() || `Flamengo Ao Vivo · ${appName}`);
      params.set('auto', options.autoStart ? '1' : '0');
      params.set('overlay', options.overlayMode !== false ? '1' : '0');
      params.set('direct', options.directScreen ? '1' : '0');

      const query = (options.searchQuery || nativeSearchQuery || '').trim();
      const pkg = (options.targetPkg || effectiveTargetPkg || '').trim();
      if (query) params.set('query', query);
      if (pkg && /^[a-zA-Z0-9_.]+$/.test(pkg)) params.set('pkg', pkg);

      const queryString = params.toString();
      const fallbackUrl = `${window.location.origin}/?mode=app&apk_missing=1`;
      const intentUri = `intent://transmitir?${queryString}#Intent;scheme=jogosdomengao;package=com.telacast.mirror;S.browser_fallback_url=${encodeURIComponent(
        fallbackUrl
      )};end`;
      const customSchemeUri = `jogosdomengao://transmitir?${queryString}`;

      setStatusMsg(
        options.autoStart
          ? `Procurando seu aplicativo nativo${query ? ` (${query})` : ''} e iniciando transmissão...`
          : 'Ativando botão flutuante INICIAR TRANSMISSÃO sobre qualquer app (dentro ou fora do app oficial)...'
      );

      // Dispara o app nativo instalado no Android via deep-link / intent
      const anchor = document.createElement('a');
      anchor.href = isAndroidBrowser ? intentUri : customSchemeUri;
      anchor.style.display = 'none';
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();

      // Se após 1.8s o navegador continuar visível e o app nativo não assumiu o foco, oferece o download do APK
      window.setTimeout(() => {
        if (document.visibilityState === 'visible') {
          setNativeFallbackVisible(true);
        }
        setSearchingNative(false);
      }, 1800);
    } catch {
      setSearchingNative(false);
      setNativeFallbackVisible(true);
      setErrorMsg('Não foi possível acionar o aplicativo nativo automaticamente.');
    }
  }

  async function startLiveBroadcast() {
    setErrorMsg(null);
    setStatusMsg(null);
    setNativeFallbackVisible(false);

    // No celular: ativa o botão flutuante INICIAR TRANSMISSÃO para funcionar em qualquer app dentro ou fora
    if (!supportsWebDisplayCapture) {
      await launchNativeTransmitter({
        autoStart: false,
        overlayMode: true,
        directScreen: true,
      });
      return;
    }

    setConnecting(true);
    const preset = QUALITY_CONFIG[quality];

    try {
      const displayConstraints: DisplayMediaStreamOptions & Record<string, unknown> = {
        video: {
          width: { ideal: preset.width },
          height: { ideal: preset.height },
          frameRate: { ideal: preset.fps, max: 30 },
          displaySurface: 'monitor',
        },
        audio: captureAudio,
        preferCurrentTab: false,
        selfBrowserSurface: 'exclude',
        surfaceSwitching: 'include',
        monitorTypeSurfaces: 'include',
      };

      const displayStream = await navigator.mediaDevices.getDisplayMedia(displayConstraints);

      streamRef.current = displayStream;
      const videoTrack = displayStream.getVideoTracks()[0];
      const screenAudioTracks = displayStream.getAudioTracks();

      // Se a captura de tela não trouxe áudio do sistema e o microfone estiver habilitado, captura áudio pelo microfone
      let extraMicStream: MediaStream | null = null;
      if (captureAudio && screenAudioTracks.length === 0 && includeMicAudio && navigator.mediaDevices.getUserMedia) {
        try {
          extraMicStream = await navigator.mediaDevices.getUserMedia({
            audio: {
              echoCancellation: true,
              noiseSuppression: true,
              autoGainControl: true,
            },
          });
          micStreamRef.current = extraMicStream;
        } catch {
          // usuário recusou ou sem microfone
        }
      }

      const audioActive =
        captureAudio &&
        (screenAudioTracks.length > 0 || Boolean(extraMicStream?.getAudioTracks().length));
      setHasCapturedAudio(audioActive);

      if (previewVideoRef.current) {
        previewVideoRef.current.srcObject = displayStream;
        await previewVideoRef.current.play().catch(() => undefined);
      }

      const idToken = await getAdminToken();
      if (!idToken) {
        setErrorMsg('Sessão administrativa expirada. Faça login novamente.');
        cleanupBroadcastResources(false);
        return;
      }

      if (autoPublishOnStart) {
        void fetch('/api/admin/auto-publicar', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${idToken}`,
          },
          body: JSON.stringify({ siteUrl: window.location.origin }),
        }).catch(() => undefined);
      }

      const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const ws = new WebSocket(`${proto}//${window.location.host}/ws/live`);
      ws.binaryType = 'arraybuffer';
      wsRef.current = ws;

      const sampleRate = 24000;

      ws.onopen = () => {
        ws.send(
          JSON.stringify({
            type: 'auth:broadcaster',
            idToken,
            title: broadcastTitle.trim() || `Transmissão Ao Vivo · ${appName}`,
            sourceApp: selectedSource,
            hasAudio: audioActive,
            sampleRate,
          })
        );
      };

      ws.onmessage = (event) => {
        if (typeof event.data !== 'string') return;
        try {
          const msg = JSON.parse(event.data) as {
            type?: string;
            erro?: string;
            state?: { viewerCount?: number; isLive?: boolean };
          };
          if (msg.type === 'auth:error') {
            setErrorMsg(msg.erro || 'Não autorizado para transmitir.');
            cleanupBroadcastResources(false);
            return;
          }
          if (msg.type === 'auth:ok') {
            setIsLive(true);
            setConnecting(false);
            setElapsedSec(0);
            setFramesSent(0);
            setStatusMsg(
              autoPublishOnStart
                ? `Transmitindo "${selectedSource}" ao vivo agora! Site e APK auto-publicados.`
                : `Transmitindo "${selectedSource}" ao vivo para os assinantes.`
            );
            timerIntervalRef.current = window.setInterval(() => {
              if (!isPausedRef.current) {
                setElapsedSec((prev) => prev + 1);
              }
            }, 1000);
            startFrameCaptureLoop(ws, preset);
            if (audioActive) {
              startAudioCapture(ws, displayStream, micStreamRef.current, sampleRate);
            }
          }
          if (msg.type === 'live:state' && msg.state) {
            setViewerCount(msg.state.viewerCount ?? 0);
          }
          if (msg.type === 'broadcast:superseded') {
            setErrorMsg(msg.erro || 'Outra sessão assumiu a transmissão.');
            cleanupBroadcastResources(false);
          }
        } catch {
          // ignore
        }
      };

      ws.onerror = () => {
        setErrorMsg('Falha na conexão WebSocket com o servidor de transmissão.');
        cleanupBroadcastResources(false);
      };

      ws.onclose = () => {
        if (streamRef.current) {
          cleanupBroadcastResources(false);
        }
      };

      if (videoTrack) {
        videoTrack.onended = () => {
          setStatusMsg('Compartilhamento de tela encerrado.');
          cleanupBroadcastResources(true);
        };
      }
    } catch (err) {
      setConnecting(false);
      cleanupBroadcastResources(false);
      const msg = err instanceof Error ? err.message : '';
      if (msg.toLowerCase().includes('permission') || msg.toLowerCase().includes('denied')) {
        setErrorMsg('Seleção de tela cancelada ou permissão negada.');
      } else {
        setErrorMsg(msg || 'Não foi possível iniciar a captura da tela.');
      }
    }
  }

  async function toggleFloatingPipWindow() {
    const pipApi = (window as unknown as { documentPictureInPicture?: DocumentPipApi })
      .documentPictureInPicture;
    if (!pipApi) return;

    if (pipWindowRef.current && !pipWindowRef.current.closed) {
      pipWindowRef.current.close();
      pipWindowRef.current = null;
      pipButtonRef.current = null;
      setPipActive(false);
      return;
    }

    try {
      const pipWin = await pipApi.requestWindow({ width: 280, height: 120 });
      pipWindowRef.current = pipWin;
      pipWin.document.body.style.margin = '0';
      pipWin.document.body.style.background = '#09090b';
      pipWin.document.body.style.display = 'flex';
      pipWin.document.body.style.flexDirection = 'column';
      pipWin.document.body.style.alignItems = 'center';
      pipWin.document.body.style.justifyContent = 'center';
      pipWin.document.body.style.gap = '8px';
      pipWin.document.body.style.height = '100vh';
      pipWin.document.body.style.fontFamily = 'system-ui, sans-serif';

      const titleEl = pipWin.document.createElement('div');
      titleEl.textContent = appName;
      titleEl.style.color = '#a1a1aa';
      titleEl.style.fontSize = '11px';
      titleEl.style.fontWeight = '600';

      const btn = pipWin.document.createElement('button');
      btn.type = 'button';
      btn.textContent = isLive ? '● AO VIVO · PARAR' : 'INICIAR TRANSMISSÃO';
      btn.style.background = isLive ? '#059669' : '#C8102E';
      btn.style.color = '#ffffff';
      btn.style.border = 'none';
      btn.style.borderRadius = '9999px';
      btn.style.padding = '12px 22px';
      btn.style.fontSize = '14px';
      btn.style.fontWeight = '800';
      btn.style.cursor = 'pointer';
      btn.style.letterSpacing = '0.03em';
      btn.onclick = () => {
        if (streamRef.current) {
          cleanupBroadcastResources(true);
        } else {
          void startLiveBroadcast();
        }
      };

      pipButtonRef.current = btn;
      pipWin.document.body.appendChild(titleEl);
      pipWin.document.body.appendChild(btn);

      pipWin.addEventListener('pagehide', () => {
        pipWindowRef.current = null;
        pipButtonRef.current = null;
        setPipActive(false);
      });
      setPipActive(true);
    } catch {
      setPipActive(false);
    }
  }

  function startFrameCaptureLoop(
    ws: WebSocket,
    preset: { width: number; height: number; fps: number; jpeg: number }
  ) {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    const intervalMs = Math.max(40, Math.round(1000 / preset.fps));

    frameTimerRef.current = window.setInterval(() => {
      if (isPausedRef.current) return;
      const video = previewVideoRef.current;
      if (!video || !ctx || ws.readyState !== WebSocket.OPEN) return;
      if (video.readyState < 2 || video.videoWidth === 0 || video.videoHeight === 0) return;
      if (sendingFrameRef.current || ws.bufferedAmount > 512 * 1024) return;

      const scale = Math.min(1, preset.width / video.videoWidth, preset.height / video.videoHeight);
      const targetW = Math.max(320, Math.round(video.videoWidth * scale));
      const targetH = Math.max(180, Math.round(video.videoHeight * scale));

      if (canvas.width !== targetW || canvas.height !== targetH) {
        canvas.width = targetW;
        canvas.height = targetH;
      }

      ctx.drawImage(video, 0, 0, targetW, targetH);
      sendingFrameRef.current = true;

      canvas.toBlob(
        (blob) => {
          sendingFrameRef.current = false;
          if (!blob || ws.readyState !== WebSocket.OPEN) return;
          blob.arrayBuffer().then((ab) => {
            if (ws.readyState !== WebSocket.OPEN) return;
            const packet = new Uint8Array(1 + ab.byteLength);
            packet[0] = 0x01; // FRAME_VIDEO
            packet.set(new Uint8Array(ab), 1);
            ws.send(packet);
            setFramesSent((c) => c + 1);
          });
        },
        'image/jpeg',
        preset.jpeg
      );
    }, intervalMs);
  }

  function startAudioCapture(
    ws: WebSocket,
    displayStream: MediaStream,
    micStream: MediaStream | null,
    targetRate: number
  ) {
    try {
      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const audioCtx = new AudioCtx({ sampleRate: targetRate });
      audioCtxRef.current = audioCtx;

      const processor = audioCtx.createScriptProcessor(2048, 1, 1);
      processorRef.current = processor;

      const silentGain = audioCtx.createGain();
      silentGain.gain.value = 0;

      if (displayStream.getAudioTracks().length > 0) {
        const screenSource = audioCtx.createMediaStreamSource(
          new MediaStream(displayStream.getAudioTracks())
        );
        screenSource.connect(processor);
      }

      if (micStream && micStream.getAudioTracks().length > 0) {
        const micSource = audioCtx.createMediaStreamSource(
          new MediaStream(micStream.getAudioTracks())
        );
        micSource.connect(processor);
      }

      processor.onaudioprocess = (e) => {
        if (isPausedRef.current) return;
        if (ws.readyState !== WebSocket.OPEN || ws.bufferedAmount > 256 * 1024) return;
        const input = e.inputBuffer.getChannelData(0);
        const pcm16 = new Int16Array(input.length);
        for (let i = 0; i < input.length; i += 1) {
          const clamped = Math.max(-1, Math.min(1, input[i]));
          pcm16[i] = clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff;
        }
        const rawBytes = new Uint8Array(pcm16.buffer);
        const packet = new Uint8Array(1 + rawBytes.length);
        packet[0] = 0x02; // FRAME_AUDIO
        packet.set(rawBytes, 1);
        ws.send(packet);
      };

      processor.connect(silentGain);
      silentGain.connect(audioCtx.destination);
    } catch {
      setHasCapturedAudio(false);
    }
  }

  async function stopRemoteLiveBroadcast() {
    const token = await getAdminToken();
    if (!token) return;
    await fetch('/api/admin/live/stop', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    }).catch(() => undefined);
  }

  function formatDuration(sec: number): string {
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = sec % 60;
    const pad = (n: number) => String(n).padStart(2, '0');
    return h > 0 ? `${pad(h)}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
  }

  return (
    <>
      <section className="rounded-xl border border-zinc-800 bg-zinc-900 p-6 space-y-6 pb-8">
        <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
          <div>
            <div className="flex items-center gap-2 text-xs font-semibold text-red-400">
              <Radio className={`h-4 w-4 ${effectiveLive ? 'animate-pulse text-emerald-400' : ''}`} />
              <span>
                {effectiveLive ? 'TRANSMISSÃO AO VIVO NO AR' : 'Estúdio de Transmissão Direta'}
              </span>
            </div>
            <h2 className="mt-1 font-display text-2xl font-bold text-white">
              Transmissão Ao Vivo da Tela (Igual Gravador Nativo)
            </h2>
            <p className="mt-1 text-xs text-zinc-400">
              Funciona igual à gravação de tela nativa do celular, mas em vez de gravar arquivo,
              transmite vídeo e áudio ao vivo direto para os usuários (sem comentários nem reações).
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {supportsDocumentPip && (
              <button
                type="button"
                onClick={toggleFloatingPipWindow}
                className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-semibold transition-colors cursor-pointer ${
                  pipActive
                    ? 'border-emerald-700 bg-emerald-950/60 text-emerald-200'
                    : 'border-zinc-700 bg-zinc-950 text-zinc-200 hover:bg-zinc-800'
                }`}
              >
                <PictureInPicture2 className="h-3.5 w-3.5 text-[#C8102E]" />
                {pipActive
                  ? 'Botão Flutuante "INICIAR TRANSMISSÃO" Ativo'
                  : 'Ativar Botão Flutuante "INICIAR TRANSMISSÃO"'}
              </button>
            )}

            {effectiveLive && (
              <div className="flex items-center gap-4 rounded-lg border border-emerald-800 bg-emerald-950/50 px-4 py-2 text-xs">
                <span className="inline-flex items-center gap-1.5 font-semibold text-emerald-300">
                  <Users className="h-3.5 w-3.5" />
                  {effectiveViewers} assistindo
                </span>
                {isLive && (
                  <span className="font-mono text-zinc-200 tabular-nums">
                    {formatDuration(elapsedSec)}
                  </span>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Passo 1: Modo direto sem app ou escolha de App Nativo */}
        <div className="space-y-2.5">
          <label className="block text-xs font-semibold text-zinc-200">
            1. Escolha espelhar a tela direto (sem app) ou selecione um App Nativo:
          </label>
          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-5">
            {NATIVE_APP_SOURCES.map((src) => {
              const active = selectedSourceId === src.id;
              return (
                <button
                  key={src.id}
                  type="button"
                  disabled={isLive || connecting}
                  onClick={() => setSelectedSourceId(src.id)}
                  className={`rounded-lg border px-3 py-2.5 text-left transition-colors disabled:opacity-60 cursor-pointer ${
                    active
                      ? 'border-[#C8102E] bg-[#C8102E]/20 text-white'
                      : 'border-zinc-800 bg-zinc-950 text-zinc-300 hover:border-zinc-600'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-bold">{src.label}</span>
                    {active && <CheckCircle2 className="h-3.5 w-3.5 text-[#C8102E] shrink-0" />}
                  </div>
                  <p className="mt-0.5 text-[11px] text-zinc-400">{src.category}</p>
                </button>
              );
            })}
          </div>

          {selectedSourceId === 'custom' && (
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <input
                type="text"
                disabled={isLive || connecting}
                value={customSourceName}
                onChange={(e) => setCustomSourceName(e.target.value)}
                placeholder="Nome do App nativo (ex: Star+, BandPlay, Player Local...)"
                className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-xs text-white focus:border-[#C8102E] focus:outline-none"
              />
              <input
                type="text"
                disabled={isLive || connecting}
                value={customPackageName}
                onChange={(e) => setCustomPackageName(e.target.value)}
                placeholder="Pacote Android opcional (ex: com.nst.iptvsmarterstvbox)"
                className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 font-mono text-xs text-white focus:border-[#C8102E] focus:outline-none"
              />
            </div>
          )}
        </div>

        {/* Busca Automática de Aplicativo Nativo no Celular */}
        <div className="rounded-xl border border-zinc-800 bg-zinc-950 p-4 space-y-3">
          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-2 text-xs font-bold text-white">
              <Search className="h-4 w-4 text-[#C8102E]" />
              <span>Procurar Meu Aplicativo Nativo no Celular e Transmitir</span>
            </div>
            <p className="text-[11px] leading-relaxed text-zinc-400">
              Ao apertar <strong className="text-zinc-200">INICIAR TRANSMISSÃO</strong> no celular,
              qualquer app dentro ou fora do app oficial fica com o botão flutuante{' '}
              <strong className="text-zinc-200">INICIAR TRANSMISSÃO</strong>. Ao apertar nele,
              transmite vídeo e áudio ao vivo direto para o site e para os usuários simultaneamente.
            </p>
          </div>

          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <input
              type="text"
              value={nativeSearchQuery}
              onChange={(e) => setNativeSearchQuery(e.target.value)}
              placeholder="Digite o nome ou pacote do seu app nativo (ex: IPTV, FlaTV, Premiere...)"
              className="flex-1 rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-xs text-white focus:border-[#C8102E] focus:outline-none"
            />
            <button
              type="button"
              disabled={searchingNative}
              onClick={() =>
                launchNativeTransmitter({
                  autoStart: true,
                  directScreen: false,
                  searchQuery: nativeSearchQuery.trim() || selectedSource,
                  targetPkg: effectiveTargetPkg,
                })
              }
              className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-[#C8102E] px-4 py-2 text-xs font-semibold text-white hover:bg-red-700 disabled:opacity-60 whitespace-nowrap cursor-pointer"
            >
              <Smartphone className="h-3.5 w-3.5" />
              {searchingNative ? 'Procurando App Nativo...' : 'Procurar e Transmitir App Nativo'}
            </button>
          </div>

          <div className="flex flex-wrap items-center gap-2 pt-1">
            {selectedSourceId !== 'direct_screen' && mobileLaunchHref !== '#' && (
              <a
                href={mobileLaunchHref}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-zinc-800 whitespace-nowrap"
              >
                <ExternalLink className="h-3.5 w-3.5 text-[#C8102E]" />
                Abrir {selectedSource} Direto
              </a>
            )}
            <a
              href="/api/download-apk"
              download
              className="inline-flex items-center gap-1.5 rounded-lg border border-[#C8102E]/60 bg-[#C8102E]/15 px-3 py-1.5 text-xs font-semibold text-red-200 hover:bg-[#C8102E]/30 whitespace-nowrap"
            >
              <Download className="h-3.5 w-3.5" />
              Baixar APK Transmissor (Botão Flutuante Nativo)
            </a>
          </div>

          {nativeFallbackVisible && (
            <div className="rounded-lg border border-amber-800/70 bg-amber-950/40 p-3 text-xs text-amber-100 space-y-2">
              <p className="font-semibold">
                App Nativo Transmissor não respondeu automaticamente neste aparelho.
              </p>
              <p className="text-[11px] text-amber-200/90">
                No celular, navegadores bloqueiam captura de tela de outros apps sem o APK
                Transmissor instalado. Baixe e instale o APK abaixo para liberar o botão flutuante{' '}
                <strong>INICIAR TRANSMISSÃO</strong> por cima de qualquer app dentro ou fora do app
                oficial:
              </p>
              <div className="flex flex-wrap gap-2">
                <a
                  href="/api/download-apk"
                  download
                  className="inline-flex items-center gap-1.5 rounded-lg bg-[#C8102E] px-3 py-1.5 text-xs font-semibold text-white hover:bg-red-700"
                >
                  <Download className="h-3.5 w-3.5" />
                  Instalar APK Transmissor Agora
                </a>
                <button
                  type="button"
                  onClick={() => setNativeFallbackVisible(false)}
                  className="rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-xs text-zinc-200 hover:bg-zinc-800 cursor-pointer"
                >
                  Fechar aviso
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Passo 2: Título, Qualidade e Botão Principal */}
        <div className="grid grid-cols-1 gap-4 md:grid-cols-12 md:items-end">
          <div className="md:col-span-5">
            <label className="block text-xs font-medium text-zinc-300">
              2. Título da transmissão no App
            </label>
            <input
              type="text"
              maxLength={120}
              disabled={isLive || connecting}
              value={broadcastTitle}
              onChange={(e) => setBroadcastTitle(e.target.value)}
              placeholder="Ex: Flamengo x Palmeiras · Ao Vivo"
              className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-white focus:border-[#C8102E] focus:outline-none disabled:opacity-60"
            />
          </div>

          <div className="md:col-span-3">
            <label className="block text-xs font-medium text-zinc-300">Qualidade da imagem</label>
            <select
              disabled={isLive || connecting}
              value={quality}
              onChange={(e) => setQuality(e.target.value as QualityPreset)}
              className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-white focus:border-[#C8102E] focus:outline-none disabled:opacity-60"
            >
              <option value="720p">{QUALITY_CONFIG['720p'].label}</option>
              <option value="1080p">{QUALITY_CONFIG['1080p'].label}</option>
              <option value="480p">{QUALITY_CONFIG['480p'].label}</option>
            </select>
          </div>

          <div className="md:col-span-4">
            {!isLive ? (
              <button
                type="button"
                disabled={connecting || searchingNative}
                onClick={startLiveBroadcast}
                className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-[#C8102E] px-4 py-2.5 text-sm font-bold text-white hover:bg-red-700 disabled:opacity-50 cursor-pointer"
              >
                <Cast className="h-4 w-4" />
                {connecting || searchingNative
                  ? 'Ativando botão flutuante...'
                  : 'INICIAR TRANSMISSÃO'}
              </button>
            ) : (
              <button
                type="button"
                onClick={() => cleanupBroadcastResources(true)}
                className="inline-flex w-full items-center justify-center gap-2 rounded-lg border border-red-700 bg-red-950 px-4 py-2.5 text-sm font-semibold text-red-100 hover:bg-red-900 cursor-pointer"
              >
                <Square className="h-4 w-4" />
                Encerrar Transmissão
              </button>
            )}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-6 text-xs text-zinc-300">
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              disabled={isLive || connecting}
              checked={captureAudio}
              onChange={(e) => setCaptureAudio(e.target.checked)}
              className="h-4 w-4 accent-[#C8102E]"
            />
            <span>Transmitir áudio do sistema/app</span>
          </label>
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              disabled={isLive || connecting || !captureAudio}
              checked={includeMicAudio}
              onChange={(e) => setIncludeMicAudio(e.target.checked)}
              className="h-4 w-4 accent-[#C8102E]"
            />
            <span className="inline-flex items-center gap-1">
              <Mic className="h-3.5 w-3.5 text-zinc-400" />
              Usar microfone se o aparelho não enviar áudio interno
            </span>
          </label>
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              disabled={isLive || connecting}
              checked={autoPublishOnStart}
              onChange={(e) => setAutoPublishOnStart(e.target.checked)}
              className="h-4 w-4 accent-[#C8102E]"
            />
            <span>Auto-publicar Site e APK na área de transmissão ao entrar ao vivo</span>
          </label>
        </div>

        {errorMsg && (
          <p className="rounded-lg border border-red-900/60 bg-red-950/60 px-4 py-2.5 text-xs text-red-200">
            {errorMsg}
          </p>
        )}
        {statusMsg && !errorMsg && (
          <p className="rounded-lg border border-emerald-900/60 bg-emerald-950/50 px-4 py-2.5 text-xs text-emerald-200">
            {statusMsg}
          </p>
        )}

        {/* Prévia da transmissão ao vivo */}
        <div className="overflow-hidden rounded-xl border border-zinc-800 bg-black">
          <div className="flex items-center justify-between border-b border-zinc-800 bg-zinc-950 px-4 py-2 text-xs text-zinc-400">
            <span className="flex items-center gap-2">
              <MonitorPlay className="h-3.5 w-3.5 text-[#C8102E]" />
              {isLive
                ? `Fonte ativa: ${selectedSource}`
                : remoteLiveState?.isLive
                  ? `Celular/App transmitindo ao vivo: ${remoteLiveState.sourceApp}`
                  : 'Prévia da captura direta da tela'}
            </span>
            <span className="flex items-center gap-3 font-mono text-[11px]">
              {isLive && (
                <>
                  <span className="inline-flex items-center gap-1">
                    {hasCapturedAudio ? (
                      <>
                        <Volume2 className="h-3.5 w-3.5 text-emerald-400" />
                        Áudio ON
                      </>
                    ) : (
                      <>
                        <VolumeX className="h-3.5 w-3.5 text-zinc-500" />
                        Sem áudio
                      </>
                    )}
                  </span>
                  <span>{framesSent} quadros</span>
                </>
              )}
            </span>
          </div>

          <div className="relative flex min-h-[240px] items-center justify-center">
            <video
              ref={previewVideoRef}
              muted
              playsInline
              className={`max-h-[360px] w-full object-contain ${isLive ? 'block' : 'hidden'}`}
            />
            {!isLive && (
              <div className="p-8 text-center space-y-2">
                <Tv className="mx-auto h-9 w-9 text-zinc-600" />
                {remoteLiveState?.isLive ? (
                  <>
                    <p className="text-xs font-semibold text-emerald-400">
                      Transmissão ao vivo ativa pelo celular ({remoteLiveState.sourceApp})!
                    </p>
                    <p className="text-[11px] text-zinc-400">
                      {remoteLiveState.viewerCount} espectador(es) assistindo vídeo e áudio ao vivo.
                    </p>
                    <button
                      type="button"
                      onClick={() => void stopRemoteLiveBroadcast()}
                      className="mt-2 inline-flex items-center gap-1.5 rounded-lg border border-red-700 bg-red-950 px-3 py-1.5 text-xs font-semibold text-red-100 hover:bg-red-900 cursor-pointer"
                    >
                      <Square className="h-3.5 w-3.5" />
                      Encerrar Transmissão Remota
                    </button>
                  </>
                ) : (
                  <>
                    <p className="text-xs font-semibold text-zinc-300">
                      Aperte &ldquo;INICIAR TRANSMISSÃO&rdquo; para ativar o botão flutuante em
                      qualquer app
                    </p>
                    <p className="text-[11px] text-zinc-500">
                      {supportsWebDisplayCapture
                        ? 'Transmite vídeo e áudio ao vivo direto para o site e usuários simultaneamente.'
                        : 'No celular, o botão flutuante INICIAR TRANSMISSÃO aparece sobre qualquer app dentro ou fora do app oficial.'}
                    </p>
                  </>
                )}
              </div>
            )}
          </div>
        </div>
      </section>

      {/* Botão Flutuante Fixo: INICIAR TRANSMISSÃO */}
      <div className="fixed bottom-5 right-5 z-50 flex items-center gap-2">
        {!isLive ? (
          <button
            type="button"
            disabled={connecting || searchingNative}
            onClick={startLiveBroadcast}
            className="inline-flex items-center gap-2.5 rounded-full border border-red-400/40 bg-[#C8102E] px-5 py-3.5 text-sm font-extrabold tracking-wide text-white shadow-2xl shadow-red-950/80 transition-transform hover:scale-[1.03] hover:bg-red-700 active:scale-95 disabled:opacity-60 cursor-pointer"
          >
            <span className="h-2.5 w-2.5 rounded-full bg-white animate-pulse" />
            <Cast className="h-4 w-4" />
            <span>
              {connecting || searchingNative ? 'INICIANDO...' : 'INICIAR TRANSMISSÃO'}
            </span>
          </button>
        ) : (
          <div className="inline-flex items-center gap-1.5 rounded-full border border-emerald-400/40 bg-zinc-950/95 p-1.5 shadow-2xl shadow-emerald-950/80 backdrop-blur">
            <button
              type="button"
              onClick={() => setIsPaused((p) => !p)}
              className="inline-flex items-center gap-1.5 rounded-full bg-zinc-800 px-3.5 py-2 text-xs font-bold text-white hover:bg-zinc-700 cursor-pointer"
            >
              {isPaused ? <Play className="h-3.5 w-3.5 text-emerald-400" /> : <Pause className="h-3.5 w-3.5 text-amber-400" />}
              <span>{isPaused ? 'Retomar' : 'Pausar'}</span>
            </button>
            <button
              type="button"
              onClick={() => cleanupBroadcastResources(true)}
              className="inline-flex items-center gap-2 rounded-full bg-emerald-600 px-4 py-2 text-xs font-extrabold tracking-wide text-white hover:bg-emerald-700 cursor-pointer"
            >
              <span className={`h-2 w-2 rounded-full bg-white ${isPaused ? '' : 'animate-ping'}`} />
              <span className="font-mono tabular-nums">
                {isPaused ? 'PAUSADO' : 'AO VIVO'} {formatDuration(elapsedSec)}
              </span>
              <Square className="h-3.5 w-3.5" />
              <span>PARAR</span>
            </button>
          </div>
        )}
      </div>
    </>
  );
}
