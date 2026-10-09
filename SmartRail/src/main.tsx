import React, { useEffect, useRef, useState, useCallback } from 'react';
import { createRoot } from 'react-dom/client';
import {
  TrainFront,
  Activity,
  Thermometer,
  Droplets,
  Flame,
  Wind,
  MapPin,
  Radar,
  OctagonX,
  Satellite,
  Bell,
  Clock,
  Volume2,
  VolumeX,
  Layers,
  Camera,
  ExternalLink,
  CheckCircle2,
  AlertTriangle,
  RefreshCw,
  Settings,
  Eye,
  ShieldCheck
} from 'lucide-react';
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine
} from 'recharts';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

import {
  fetchESP32Data,
  checkCameraStream,
  getStoredApiUrl,
  setStoredApiUrl,
  getStoredCamUrl,
  setStoredCamUrl,
  validateDistance,
  OBSTACLE_THRESHOLD_CM,
  DEFAULT_POLL_INTERVAL_MS,
  type ESP32Telemetry,
  type TelemetrySample,
  type AlertLogItem
} from './esp32-api';

import './styles.css';

// ==============================================================================================
// 1. HELPER FORMATTERS
// ==============================================================================================
const fmt = (v: number | null | undefined, d = 1): string => {
  if (v === null || v === undefined || isNaN(v)) return '—';
  return v.toFixed(d);
};

const formatTime = (date: Date): string => {
  return date.toLocaleTimeString('en-IN', { hour12: false });
};

// ==============================================================================================
// 2. MAIN APPLICATION COMPONENT
// ==============================================================================================
export function SmartRailApp() {
  // Navigation View
  const [activeTab, setActiveTab] = useState<string>('overview');

  // Hardware Connection & Telemetry State
  const [apiUrl, setApiUrl] = useState<string>(getStoredApiUrl());
  const [camUrl, setCamUrl] = useState<string>(getStoredCamUrl());
  const [pollIntervalMs, setPollIntervalMs] = useState<number>(DEFAULT_POLL_INTERVAL_MS);

  const [esp32Online, setEsp32Online] = useState<boolean>(false);
  const [camOnline, setCamOnline] = useState<boolean>(false);
  const [camReloadKey, setCamReloadKey] = useState<number>(0);
  const camImgRef = useRef<HTMLImageElement | null>(null);
  const [lastSeen, setLastSeen] = useState<Date | null>(null);

  const [telemetry, setTelemetry] = useState<ESP32Telemetry | null>(null);
  const [debouncedObstacle, setDebouncedObstacle] = useState<boolean>(false);
  const [history, setHistory] = useState<TelemetrySample[]>([]);
  const [alerts, setAlerts] = useState<AlertLogItem[]>([]);

  // Obstacle debounce counters (2 consecutive hits required to transition state)
  const obstacleHitsRef = useRef<number>(0);
  const clearHitsRef = useRef<number>(0);

  // Sound & Clock
  const [soundEnabled, setSoundEnabled] = useState<boolean>(false);
  const [currentTime, setCurrentTime] = useState<Date>(new Date());
  const audioCtxRef = useRef<AudioContext | null>(null);

  // Settings Draft State
  const [draftApiUrl, setDraftApiUrl] = useState<string>(apiUrl);
  const [draftCamUrl, setDraftCamUrl] = useState<string>(camUrl);
  const [saveSuccess, setSaveSuccess] = useState<boolean>(false);

  // Keep live clock ticking
  useEffect(() => {
    const clockTimer = setInterval(() => setCurrentTime(new Date()), 1000);
    return () => clearInterval(clockTimer);
  }, []);

  // Previous alert state cache to detect transitions
  const prevAlertsRef = useRef<{
    gas: boolean;
    flame: boolean;
    vibration: boolean;
    obstacle: boolean;
  }>({ gas: false, flame: false, vibration: false, obstacle: false });

  // Add an event to the alert log
  const logAlert = useCallback((type: string, severity: 'HIGH' | 'CRITICAL' | 'WARNING' | 'INFO', sensor: string, value: string, message: string) => {
    const newAlert: AlertLogItem = {
      id: `${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
      timestamp: formatTime(new Date()),
      timeEpoch: Date.now(),
      type,
      severity,
      sensor,
      value,
      message,
    };
    setAlerts(prev => [newAlert, ...prev].slice(0, 200));
  }, []);

  // ============================================================================================
  // 3. REAL HARDWARE TELEMETRY POLLING LOOP (GET /data)
  // Single polling loop; cleans up interval on unmount; no fake or mock fallbacks.
  // ============================================================================================
  useEffect(() => {
    let isMounted = true;

    const poll = async () => {
      try {
        const data = await fetchESP32Data(apiUrl);
        if (!isMounted) return;

        // Strict sensor validation: HC-SR04 distance calculation in centimeters
        const validDist = validateDistance(data.distance);
        data.distance = validDist;

        setTelemetry(data);
        setEsp32Online(true);
        setLastSeen(new Date());

        // Append to history buffer for live sensor graphs
        setHistory(prev => {
          const sample: TelemetrySample = {
            time: formatTime(new Date()),
            seconds: Math.floor(Date.now() / 1000) % 3600,
            temperature: data.temperature ?? null,
            humidity: data.humidity ?? null,
            gas: data.gas ?? 0,
            distance: validDist,
          };
          return [...prev, sample].slice(-60);
        });

        // Obstacle Stability & Debounce Logic (Requirement 15):
        // 2 consecutive readings <= OBSTACLE_THRESHOLD_CM -> Obstacle State ON
        // 2 consecutive readings >  OBSTACLE_THRESHOLD_CM -> Obstacle State OFF
        if (validDist !== null && validDist <= OBSTACLE_THRESHOLD_CM) {
          clearHitsRef.current = 0;
          obstacleHitsRef.current += 1;
          if (obstacleHitsRef.current >= 2) {
            setDebouncedObstacle(prev => {
              if (!prev) {
                logAlert(
                  'OBSTACLE DETECTED',
                  'CRITICAL',
                  'HC-SR04',
                  `${fmt(validDist)} cm`,
                  `Hazard detected directly on track (distance ${fmt(validDist)} cm <= ${OBSTACLE_THRESHOLD_CM} cm threshold)`
                );
              }
              return true;
            });
          }
        } else if (validDist !== null && validDist > OBSTACLE_THRESHOLD_CM) {
          obstacleHitsRef.current = 0;
          clearHitsRef.current += 1;
          if (clearHitsRef.current >= 2) {
            setDebouncedObstacle(prev => {
              if (prev) {
                logAlert(
                  'TRACK CLEAR',
                  'INFO',
                  'HC-SR04',
                  `${fmt(validDist)} cm`,
                  `Obstacle cleared from track detection zone (distance ${fmt(validDist)} cm > ${OBSTACLE_THRESHOLD_CM} cm)`
                );
              }
              return false;
            });
          }
        } else {
          // Distance is null / timeout / out of range (No reflected echo)
          obstacleHitsRef.current = 0;
          clearHitsRef.current = 0;
          setDebouncedObstacle(prev => {
            if (prev) {
              logAlert(
                'TRACK CLEAR',
                'INFO',
                'HC-SR04',
                'Clear',
                'Obstacle removed or sensor out of range'
              );
            }
            return false;
          });
        }

        // Evaluate remaining real physical sensor alerts
        const prev = prevAlertsRef.current;

        // Gas Alert
        if (data.gasAlert && !prev.gas) {
          logAlert('GAS / SMOKE ALERT', 'HIGH', 'MQ-2', `${data.gas ?? 0} ADC`, 'Gas concentration exceeded threshold (>1800)');
        } else if (!data.gasAlert && prev.gas) {
          logAlert('GAS LEVEL NORMAL', 'INFO', 'MQ-2', `${data.gas ?? 0} ADC`, 'Gas concentration returned to safe level');
        }

        // Flame Alert
        if (data.flameAlert && !prev.flame) {
          logAlert('FLAME DETECTED', 'CRITICAL', 'Flame IR', 'ACTIVE', 'Optical IR flame detected near rail section');
        } else if (!data.flameAlert && prev.flame) {
          logAlert('FLAME CLEARED', 'INFO', 'Flame IR', 'CLEAR', 'Fire/flame condition cleared');
        }

        // Vibration Alert
        if (data.vibrationAlert && !prev.vibration) {
          logAlert('VIBRATION DETECTED', 'WARNING', 'SW-420', 'HIGH', 'Physical track shock or vibration anomaly detected');
        } else if (!data.vibrationAlert && prev.vibration) {
          logAlert('VIBRATION NORMALIZED', 'INFO', 'SW-420', 'NORMAL', 'Track vibration returned to baseline');
        }

        prevAlertsRef.current = {
          gas: Boolean(data.gasAlert),
          flame: Boolean(data.flameAlert),
          vibration: Boolean(data.vibrationAlert),
          obstacle: Boolean(validDist !== null && validDist <= OBSTACLE_THRESHOLD_CM),
        };

      } catch {
        if (!isMounted) return;
        // Hardware unreachable: flag offline and do NOT show stale telemetry as live
        obstacleHitsRef.current = 0;
        clearHitsRef.current = 0;
        setDebouncedObstacle(false);
        setEsp32Online(false);
        setTelemetry(null);
      }
    };

    poll();
    const intervalId = setInterval(poll, pollIntervalMs);

    return () => {
      isMounted = false;
      clearInterval(intervalId);
    };
  }, [apiUrl, pollIntervalMs, logAlert]);

  // ESP32-CAM stream health check via decoded frame dimensions
  // Note: MJPEG multipart streams in Chromium do not fire standard onload completion events,
  // but naturalWidth > 0 indicates active, successfully decoded stream frames.
  useEffect(() => {
    let isMounted = true;
    const checkCamStatus = () => {
      if (!isMounted) return;
      const img = camImgRef.current;
      if (img && img.naturalWidth > 0 && img.naturalHeight > 0) {
        setCamOnline(true);
      }
    };

    const intervalId = setInterval(checkCamStatus, 500);
    checkCamStatus();

    return () => {
      isMounted = false;
      clearInterval(intervalId);
    };
  }, [camUrl, camReloadKey]);

  // ============================================================================================
  // 4. AUDIBLE BUZZER ALARM (WEB AUDIO API)
  // ============================================================================================
  const hasObstacle = Boolean(esp32Online && debouncedObstacle);
  const anyAlert = Boolean(
    esp32Online && (
      hasObstacle ||
      telemetry?.gasAlert ||
      telemetry?.flameAlert ||
      telemetry?.vibrationAlert
    )
  );

  useEffect(() => {
    if (!soundEnabled || !anyAlert) return;

    if (!audioCtxRef.current) {
      audioCtxRef.current = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
    }

    const ctx = audioCtxRef.current;
    if (ctx.state === 'suspended') {
      ctx.resume().catch(() => {});
    }

    const beep = () => {
      if (ctx.state !== 'running') return;
      try {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(880, ctx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(440, ctx.currentTime + 0.18);
        gain.gain.setValueAtTime(0.08, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.18);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start();
        osc.stop(ctx.currentTime + 0.2);
      } catch {
        // audio context safely ignored
      }
    };

    beep();
    const timer = setInterval(beep, 900);
    return () => clearInterval(timer);
  }, [soundEnabled, anyAlert]);

  // Handle saving new hardware settings
  const handleSaveSettings = (e: React.FormEvent) => {
    e.preventDefault();
    setStoredApiUrl(draftApiUrl);
    setStoredCamUrl(draftCamUrl);
    setApiUrl(draftApiUrl);
    setCamUrl(draftCamUrl);
    setSaveSuccess(true);
    setTimeout(() => setSaveSuccess(false), 3000);
  };

  // ============================================================================================
  // 5. SUB-COMPONENTS
  // ============================================================================================

  // Track Live View with HC-SR04 Real Obstacle Detection
  const renderTrackView = () => {
    const isConn = esp32Online;
    const dist = isConn ? (telemetry?.distance ?? null) : null;

    // Obstacle X position mapped dynamically to physical distance (2cm -> x=270, 50cm -> x=540)
    const obstacleX = dist !== null
      ? Math.max(260, Math.min(560, 260 + (dist / OBSTACLE_THRESHOLD_CM) * 280))
      : 480;

    return (
      <div className="panel">
        <div className="panel-header">
          <div className="panel-title">
            <TrainFront size={18} />
            <span>Track 01 — Stationary Railway Inspection Testbench</span>
          </div>
          <span className={`status-pill ${!isConn ? 'offline' : hasObstacle ? 'offline' : dist === null ? 'warning' : 'online'}`}>
            <i />
            {!isConn
              ? 'ESP32 OFFLINE'
              : hasObstacle
              ? 'OBSTACLE DETECTED'
              : dist === null
              ? 'DATA UNAVAILABLE'
              : 'TRACK CLEAR'}
          </span>
        </div>
        <div className="panel-body" style={{ padding: 0 }}>
          <div className="track-wrap">
            <div className={`track-status-banner ${!isConn ? '' : hasObstacle ? 'obstacle' : dist === null ? 'warning' : 'clear'}`}>
              <div className="obstacle-callout">
                {!isConn ? (
                  <>
                    <OctagonX size={16} />
                    <span>ESP32 OFFLINE · WAITING FOR TELEMETRY</span>
                  </>
                ) : hasObstacle ? (
                  <>
                    <AlertTriangle size={16} />
                    <span>⚠ OBSTACLE DETECTED AT {fmt(dist)} CM</span>
                  </>
                ) : dist === null ? (
                  <>
                    <AlertTriangle size={16} />
                    <span>ULTRASONIC DATA UNAVAILABLE (NO ECHO / OUT OF RANGE)</span>
                  </>
                ) : (
                  <>
                    <CheckCircle2 size={16} />
                    <span>✓ TRACK CLEAR · DISTANCE: {fmt(dist)} CM</span>
                  </>
                )}
              </div>
              <span className="mono" style={{ fontSize: 11 }}>
                HC-SR04 SENSOR · GPIO 33/25 · THRESHOLD &le; {OBSTACLE_THRESHOLD_CM} CM
              </span>
            </div>

            {/* Visual Railway Track Schematic */}
            <svg className="track-svg" viewBox="0 0 900 240">
              <defs>
                <pattern id="sleepers" width="24" height="60" patternUnits="userSpaceOnUse">
                  <rect x="8" y="2" width="8" height="56" rx="1" fill="#283842" />
                </pattern>
                <linearGradient id="trainGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop stopColor="#e4eff2" />
                  <stop offset="1" stopColor="#829ea6" />
                </linearGradient>
              </defs>

              {/* Background Track Grid */}
              <rect x="0" y="0" width="900" height="240" fill="#08141a" />
              <line x1="0" y1="80" x2="900" y2="80" stroke="#162832" strokeDasharray="6 6" />
              <line x1="0" y1="210" x2="900" y2="210" stroke="#162832" strokeDasharray="6 6" />

              {/* Rails and Sleepers */}
              <rect x="0" y="115" width="900" height="60" fill="url(#sleepers)" />
              <line x1="0" y1="125" x2="900" y2="125" stroke="#607c87" strokeWidth="4" />
              <line x1="0" y1="165" x2="900" y2="165" stroke="#607c87" strokeWidth="4" />

              {/* Station Markers */}
              <text x="25" y="60" fill="#4f7180" fontSize="11" letterSpacing="1.5">TEST SECTOR A (STATIONARY)</text>
              <text x="710" y="60" fill="#4f7180" fontSize="11" letterSpacing="1.5">FORWARD RADAR ZONE</text>

              {/* Ultrasonic Waves from Train Front */}
              {isConn && (
                <g style={{ color: hasObstacle ? '#ff6a78' : '#41e0ac' }}>
                  <path d="M 230 135 A 25 25 0 0 1 230 155" fill="none" stroke="currentColor" strokeWidth="2" opacity="0.6" />
                  <path d="M 245 125 A 38 38 0 0 1 245 165" fill="none" stroke="currentColor" strokeWidth="2" opacity="0.4" />
                  <path d="M 260 115 A 50 50 0 0 1 260 175" fill="none" stroke="currentColor" strokeWidth="2" opacity="0.25" />
                </g>
              )}

              {/* Train Locomotive SR-001 (Stationary Test Unit) */}
              <g transform="translate(60, 112)">
                <rect x="0" y="5" width="55" height="38" rx="4" fill="url(#trainGrad)" stroke="#b0c8ce" />
                <rect x="60" y="5" width="55" height="38" rx="4" fill="url(#trainGrad)" stroke="#b0c8ce" />
                <path d="M 120 5 L 155 5 Q 170 12 170 24 Q 170 36 155 43 L 120 43 Z" fill="url(#trainGrad)" stroke="#b0c8ce" />
                {/* Windshield */}
                <path d="M 148 11 L 162 17 Q 165 24 162 31 L 148 37 Z" fill="#0c232c" />
                {/* Stripe */}
                <rect x="0" y="24" width="168" height="6" fill="#1b7e68" />
                {/* Wheels */}
                <circle cx="20" cy="46" r="6" fill="#1b2a33" stroke="#48616e" strokeWidth="2" />
                <circle cx="45" cy="46" r="6" fill="#1b2a33" stroke="#48616e" strokeWidth="2" />
                <circle cx="80" cy="46" r="6" fill="#1b2a33" stroke="#48616e" strokeWidth="2" />
                <circle cx="105" cy="46" r="6" fill="#1b2a33" stroke="#48616e" strokeWidth="2" />
                <circle cx="138" cy="46" r="6" fill="#1b2a33" stroke="#48616e" strokeWidth="2" />
                <text x="75" y="72" fill="#7d9ca9" fontSize="11" fontWeight="600" textAnchor="middle">SR–001</text>
              </g>

              {/* REAL PHYSICAL OBSTACLE — Appears ONLY when real HC-SR04 detects obstacle */}
              {isConn && hasObstacle && (
                <g transform={`translate(${obstacleX}, 110)`}>
                  <rect x="-15" y="0" width="30" height="48" rx="3" fill="#e69522" stroke="#ffe28a" strokeWidth="2" />
                  <path d="M -12 8 L 12 24 M -12 24 L 12 40" stroke="#09151c" strokeWidth="4" />
                  <text x="0" y="-12" textAnchor="middle" fill="#ff7684" fontSize="12" fontWeight="700">
                    OBSTACLE ({fmt(dist)} cm)
                  </text>
                  <line x1={230 - obstacleX} y1="24" x2="-15" y2="24" stroke="#ff6a78" strokeWidth="2" strokeDasharray="5 5" />
                </g>
              )}
            </svg>

            {/* Metrics Footer */}
            <div className="track-metrics-bar">
              <div className="track-metric-item">
                <span>TRAIN UNIT</span>
                <b>SR–001 (Stationary)</b>
              </div>
              <div className="track-metric-item">
                <span>MEASURED DISTANCE</span>
                <b>{!isConn ? '—' : dist === null ? 'Unavailable' : `${fmt(dist)} cm`}</b>
              </div>
              <div className="track-metric-item">
                <span>OBSTACLE STATUS</span>
                <b style={{ color: !isConn ? '#8fa7b4' : hasObstacle ? '#ff6a78' : dist === null ? '#ebc45f' : '#41e0ac' }}>
                  {!isConn
                    ? 'OFFLINE'
                    : hasObstacle
                    ? 'CRITICAL'
                    : dist === null
                    ? 'UNAVAILABLE'
                    : 'NORMAL'}
                </b>
              </div>
              <div className="track-metric-item">
                <span>SENSOR TRIGGER</span>
                <b>Threshold &le; {OBSTACLE_THRESHOLD_CM} cm</b>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  };

  // ESP32-CAM Live Feed Viewer
  const renderCameraFeed = () => {
    return (
      <div className="panel">
        <div className="panel-header">
          <div className="panel-title">
            <Camera size={18} />
            <span>ESP32-CAM Live Video Stream</span>
          </div>
          <span className={`status-pill ${camOnline ? 'online' : 'offline'}`}>
            <i />
            {camOnline ? 'CAMERA ONLINE' : 'CAMERA OFFLINE'}
          </span>
        </div>
        <div className="panel-body">
          <div className="camera-feed-container">
            <>
              {/* Primary: Direct MJPEG stream in img tag */}
              <img
                ref={camImgRef}
                key={`${camUrl}-${camReloadKey}`}
                src={camReloadKey > 0 ? `${camUrl}${camUrl.includes('?') ? '&' : '?'}t=${camReloadKey}` : camUrl}
                alt="ESP32-CAM Live Video Feed"
                className="camera-stream-img"
                onLoad={() => setCamOnline(true)}
                onError={() => {
                  setCamOnline(false);
                }}
                style={{ display: 'block', width: '100%', minHeight: 240, background: '#09151c' }}
              />
              <div className="camera-overlay">
                <span className="cam-live-badge">
                  <span style={{ width: 6, height: 6, borderRadius: '50%', background: camOnline ? '#41e0ac' : '#e05241', display: 'inline-block' }} />
                  {camOnline ? 'LIVE MJPEG STREAM' : 'CONNECTING...'}
                </span>
                <span className="mono" style={{ fontSize: 10, color: '#88a6b4', background: '#09151ca8', padding: '3px 8px', borderRadius: 4 }}>
                  ESP32-CAM AI-THINKER
                </span>
              </div>
              {!camOnline && (
                <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', background: '#09151ce0', gap: 12 }}>
                  <Camera size={44} style={{ color: '#4a7a8a' }} />
                  <h4 style={{ color: '#c5d8de', margin: 0 }}>Connecting to stream…</h4>
                  <p style={{ color: '#7aa0ae', margin: 0, fontSize: 12, textAlign: 'center' }}>
                    <code style={{ color: '#89e5c9', fontSize: 11 }}>{camUrl}</code>
                  </p>
                  <div style={{ display: 'flex', gap: 10 }}>
                    <button
                      className="btn-secondary"
                      onClick={() => {
                        setCamOnline(false);
                        setCamReloadKey(Date.now());
                      }}
                    >
                      <RefreshCw size={14} /> Retry Stream
                    </button>
                    <button
                      className="btn-secondary"
                      onClick={() => setActiveTab('settings')}
                    >
                      <Settings size={14} /> Change IP
                    </button>
                  </div>
                </div>
              )}
            </>
          </div>
          <div className="cam-actions-bar">
            <span>Stream Source: <b className="mono" style={{ color: '#c7dee6' }}>{camUrl}</b></span>
            <a
              href={camUrl.replace('/stream', '')}
              target="_blank"
              rel="noreferrer"
              className="btn-secondary"
              style={{ padding: '4px 10px', fontSize: 11 }}
            >
              <ExternalLink size={12} /> Open Fullscreen Stream
            </a>
          </div>
        </div>
      </div>
    );
  };

  // Real Physical Sensor Cards
  const renderSensorCards = () => {
    const isConn = esp32Online;
    const dist = isConn ? (telemetry?.distance ?? null) : null;

    const cards = [
      {
        name: 'Temperature',
        icon: Thermometer,
        value: isConn && telemetry?.temperature !== null ? `${fmt(telemetry?.temperature)}` : 'Sensor unavailable',
        unit: isConn && telemetry?.temperature !== null ? '°C' : '',
        status: !isConn || telemetry?.temperature === null ? 'offline' : (telemetry?.temperature ?? 0) > 45 ? 'warning' : 'normal',
        statusText: !isConn || telemetry?.temperature === null ? 'UNAVAILABLE' : (telemetry?.temperature ?? 0) > 45 ? 'HIGH TEMP' : 'NORMAL',
        detail: 'DHT22 · GPIO 4',
      },
      {
        name: 'Humidity',
        icon: Droplets,
        value: isConn && telemetry?.humidity !== null ? `${fmt(telemetry?.humidity)}` : 'Sensor unavailable',
        unit: isConn && telemetry?.humidity !== null ? '%' : '',
        status: !isConn || telemetry?.humidity === null ? 'offline' : 'normal',
        statusText: !isConn || telemetry?.humidity === null ? 'UNAVAILABLE' : 'NORMAL',
        detail: 'DHT22 · GPIO 4',
      },
      {
        name: 'MQ-2 Gas / Smoke',
        icon: Wind,
        value: isConn ? `${telemetry?.gas ?? 0}` : 'Sensor unavailable',
        unit: isConn ? 'ADC' : '',
        status: !isConn ? 'offline' : telemetry?.gasAlert ? 'danger' : 'normal',
        statusText: !isConn ? 'UNAVAILABLE' : telemetry?.gasAlert ? 'GAS ALERT!' : 'NORMAL',
        detail: 'MQ-2 Analog · GPIO 35 (Thresh 1800)',
      },
      {
        name: 'Flame Sensor',
        icon: Flame,
        value: isConn ? (telemetry?.flameAlert ? 'DETECTED' : 'CLEAR') : 'Sensor unavailable',
        unit: '',
        status: !isConn ? 'offline' : telemetry?.flameAlert ? 'danger' : 'normal',
        statusText: !isConn ? 'UNAVAILABLE' : telemetry?.flameAlert ? 'FIRE DETECTED!' : 'NORMAL',
        detail: 'IR Flame · GPIO 32 (Active LOW)',
      },
      {
        name: 'Track Vibration',
        icon: Activity,
        value: isConn ? (telemetry?.vibrationAlert ? 'VIBRATION' : 'STABLE') : 'Sensor unavailable',
        unit: '',
        status: !isConn ? 'offline' : telemetry?.vibrationAlert ? 'danger' : 'normal',
        statusText: !isConn ? 'UNAVAILABLE' : telemetry?.vibrationAlert ? 'VIBRATION!' : 'NORMAL',
        detail: 'SW-420 Sensor · GPIO 34',
      },
      {
        name: 'Ultrasonic Sensor',
        icon: Radar,
        value: !isConn || dist === null ? 'Sensor unavailable' : `${fmt(dist)}`,
        unit: isConn && dist !== null ? 'cm' : '',
        status: !isConn
          ? 'offline'
          : dist === null
          ? 'offline'
          : hasObstacle
          ? 'danger'
          : 'normal',
        statusText: !isConn
          ? 'ESP32 OFFLINE'
          : dist === null
          ? 'DATA UNAVAILABLE'
          : hasObstacle
          ? 'OBSTACLE DETECTED'
          : 'TRACK CLEAR',
        detail: `HC-SR04 · GPIO 33/25 (Divider) · Thresh ${OBSTACLE_THRESHOLD_CM}cm`,
      },
    ];

    return (
      <div className="sensor-grid">
        {cards.map(c => (
          <div key={c.name} className={`sensor-card ${c.status}`}>
            <div className="sensor-header">
              <span>{c.name}</span>
              <c.icon size={15} />
            </div>
            <div className={`sensor-val ${c.status === 'offline' ? 'unavailable' : ''}`}>
              {c.value}
              {c.unit && <small>{c.unit}</small>}
            </div>
            <div className="sensor-footer">
              <span className={`sensor-status-tag ${c.status}`}>{c.statusText}</span>
              <span className="sensor-subtext">{c.detail}</span>
            </div>
          </div>
        ))}
      </div>
    );
  };

  // Real GPS Panel (Leaflet integration without artificial movement)
  const renderGPSPanel = () => {
    const hasFix = Boolean(esp32Online && telemetry?.latitude !== null && telemetry?.longitude !== null);
    const lat = telemetry?.latitude;
    const lng = telemetry?.longitude;

    return (
      <div className="panel">
        <div className="panel-header">
          <div className="panel-title">
            <MapPin size={18} />
            <span>GPS Satellite Tracking</span>
          </div>
          <span className={`status-pill ${hasFix ? 'online' : 'offline'}`}>
            <i />
            {hasFix ? 'GPS FIX LOCKED' : 'GPS UNAVAILABLE'}
          </span>
        </div>
        <div className="panel-body">
          <div className="gps-map-container">
            <GPSMapComponent lat={lat} lng={lng} hasFix={hasFix} />
            {!hasFix && (
              <div className="gps-offline-overlay">
                <Satellite size={28} />
                <b>GPS UNAVAILABLE</b>
                <span>Waiting for satellite line-of-sight fix (Indoors or no signal)</span>
              </div>
            )}
          </div>
          <div className="gps-readout-grid">
            <div className="gps-coord-box">
              <span>LATITUDE</span>
              <b>{hasFix ? `${fmt(lat, 6)}° N` : 'Waiting for Fix'}</b>
            </div>
            <div className="gps-coord-box">
              <span>LONGITUDE</span>
              <b>{hasFix ? `${fmt(lng, 6)}° E` : 'Waiting for Fix'}</b>
            </div>
          </div>
        </div>
      </div>
    );
  };

  // Real Alerts & Logs Table
  const renderAlertsTable = () => {
    return (
      <div className="panel">
        <div className="panel-header">
          <div className="panel-title">
            <Bell size={18} />
            <span>Real Hardware Safety Event Log</span>
          </div>
          <span className="mono" style={{ fontSize: 11, color: '#7e9fad' }}>
            {alerts.length} Recorded Events
          </span>
        </div>
        <div className="panel-body" style={{ padding: 0, maxHeight: 380, overflowY: 'auto' }}>
          {alerts.length === 0 ? (
            <div style={{ padding: '36px 20px', textAlign: 'center', color: '#688694' }}>
              <ShieldCheck size={36} style={{ margin: '0 auto 10px', color: '#41e0ac' }} />
              <b style={{ display: 'block', color: '#d2e4ea', fontSize: 14 }}>All Systems Normal</b>
              <span style={{ fontSize: 12 }}>Real alerts will appear here as physical sensor thresholds are crossed.</span>
            </div>
          ) : (
            alerts.map(a => (
              <div key={a.id} className="alert-row">
                <div className="alert-row-left">
                  <span className={`alert-badge ${a.severity}`}>{a.severity}</span>
                  <div>
                    <b style={{ display: 'block', fontSize: 12, color: '#e0edf1' }}>{a.type}</b>
                    <span style={{ fontSize: 11, color: '#88a3af' }}>{a.message} · Value: {a.value}</span>
                  </div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <span className="mono" style={{ fontSize: 11, color: '#7696a4' }}>{a.timestamp}</span>
                  <span style={{ display: 'block', fontSize: 10, color: '#577887' }}>{a.sensor}</span>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    );
  };

  // Telemetry Graphs
  const renderCharts = () => {
    return (
      <div className="charts-grid-2">
        <div className="chart-box">
          <div className="chart-header">
            <span>DHT22 Temperature History (°C)</span>
            <b>{fmt(telemetry?.temperature)} °C</b>
          </div>
          <ResponsiveContainer width="100%" height={160}>
            <AreaChart data={history}>
              <CartesianGrid stroke="#1c2f3a" strokeDasharray="3 3" />
              <XAxis dataKey="time" tick={{ fill: '#628190', fontSize: 10 }} />
              <YAxis tick={{ fill: '#628190', fontSize: 10 }} domain={['auto', 'auto']} />
              <Tooltip contentStyle={{ background: '#0e1d24', border: '1px solid #284452', borderRadius: 4 }} />
              <Area type="monotone" dataKey="temperature" stroke="#41e0ac" fill="#41e0ac22" isAnimationActive={false} />
            </AreaChart>
          </ResponsiveContainer>
        </div>

        <div className="chart-box">
          <div className="chart-header">
            <span>MQ-2 Gas / Smoke History (ADC)</span>
            <b>{telemetry?.gas ?? '—'} ADC</b>
          </div>
          <ResponsiveContainer width="100%" height={160}>
            <AreaChart data={history}>
              <CartesianGrid stroke="#1c2f3a" strokeDasharray="3 3" />
              <XAxis dataKey="time" tick={{ fill: '#628190', fontSize: 10 }} />
              <YAxis tick={{ fill: '#628190', fontSize: 10 }} domain={[0, 4095]} />
              <Tooltip contentStyle={{ background: '#0e1d24', border: '1px solid #284452', borderRadius: 4 }} />
              <ReferenceLine y={1800} stroke="#ff6a78" strokeDasharray="4 4" label={{ value: 'Gas Alert (1800)', fill: '#ff6a78', fontSize: 10 }} />
              <Area type="monotone" dataKey="gas" stroke="#f0be54" fill="#f0be5422" isAnimationActive={false} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>
    );
  };

  // Hardware Settings Form
  const renderSettings = () => {
    return (
      <div className="panel" style={{ maxWidth: 700 }}>
        <div className="panel-header">
          <div className="panel-title">
            <Settings size={18} />
            <span>Hardware Network Configuration</span>
          </div>
          <span className="mono" style={{ fontSize: 11, color: '#7a99a7' }}>IP Address Settings</span>
        </div>
        <div className="panel-body">
          <form className="settings-box" onSubmit={handleSaveSettings}>
            <div className="form-group">
              <label>ESP32 Railway Monitor URL (GET /data)</label>
              <input
                className="form-input"
                value={draftApiUrl}
                onChange={e => setDraftApiUrl(e.target.value)}
                placeholder="http://192.168.1.105"
              />
              <span className="form-help">
                Set this to the IP address displayed by your ESP32 in the Arduino Serial Monitor (e.g. http://192.168.1.105).
              </span>
            </div>

            <div className="form-group">
              <label>ESP32-CAM MJPEG Stream URL (GET /stream)</label>
              <input
                className="form-input"
                value={draftCamUrl}
                onChange={e => setDraftCamUrl(e.target.value)}
                placeholder="http://192.168.1.106/stream"
              />
              <span className="form-help">
                Set this to the IP address and /stream endpoint printed by the ESP32-CAM in Serial Monitor.
              </span>
            </div>

            <div className="form-group">
              <label>Dashboard Polling Rate (ms)</label>
              <select
                className="form-input"
                value={pollIntervalMs}
                onChange={e => setPollIntervalMs(Number(e.target.value))}
              >
                <option value={1000}>1000 ms (1 second - Recommended)</option>
                <option value={1500}>1500 ms (Normal)</option>
                <option value={2000}>2000 ms (Gentle)</option>
                <option value={3000}>3000 ms (Low network load)</option>
              </select>
            </div>

            <div className="form-group">
              <label>Obstacle Detection Distance Threshold</label>
              <input
                className="form-input"
                disabled
                value={`${OBSTACLE_THRESHOLD_CM} cm (Central Safety Standard)`}
                style={{ opacity: 0.85 }}
              />
              <span className="form-help">
                HC-SR04 readings &le; {OBSTACLE_THRESHOLD_CM} cm trigger OBSTACLE DETECTED. Readings &gt; {OBSTACLE_THRESHOLD_CM} cm indicate TRACK CLEAR.
              </span>
            </div>

            <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginTop: 10 }}>
              <button type="submit" className="btn-primary">
                Save &amp; Apply Hardware URLs
              </button>
              <button
                type="button"
                className="btn-secondary"
                onClick={() => {
                  fetchESP32Data(draftApiUrl)
                    .then(() => alert('ESP32 reached successfully! Received valid /data telemetry.'))
                    .catch(e => alert(`ESP32 connection failed: ${e.message}`));
                }}
              >
                Test ESP32 Connection
              </button>
            </div>

            {saveSuccess && (
              <div style={{ color: '#41e0ac', fontSize: 13, display: 'flex', gap: 8, alignItems: 'center' }}>
                <CheckCircle2 size={16} /> New hardware URLs saved and active!
              </div>
            )}
          </form>
        </div>
      </div>
    );
  };

  // ============================================================================================
  // 6. RENDER APP LAYOUT
  // ============================================================================================
  const liveDist = esp32Online ? (telemetry?.distance ?? null) : null;

  return (
    <div className="app-layout">
      {/* Left Sidebar */}
      <aside className="sidebar">
        <div className="sidebar-header">
          <div className="sidebar-brand-mark">
            <TrainFront size={22} />
          </div>
          <div className="sidebar-brand-text">
            <div className="sidebar-brand-title">Smart<span>Rail</span></div>
            <div className="sidebar-brand-sub">CONTROL CENTER</div>
          </div>
        </div>

        <nav className="sidebar-nav">
          <button
            className={`nav-item ${activeTab === 'overview' ? 'active' : ''}`}
            onClick={() => setActiveTab('overview')}
          >
            <Layers size={16} />
            <span>Dashboard</span>
          </button>
          <button
            className={`nav-item ${activeTab === 'camera' ? 'active' : ''}`}
            onClick={() => setActiveTab('camera')}
          >
            <Camera size={16} />
            <span>Live Camera</span>
            {camOnline && <span className="nav-badge" style={{ background: '#113328', color: '#41e0ac' }}>LIVE</span>}
          </button>
          <button
            className={`nav-item ${activeTab === 'train' ? 'active' : ''}`}
            onClick={() => setActiveTab('train')}
          >
            <TrainFront size={16} />
            <span>Train Monitoring</span>
          </button>
          <button
            className={`nav-item ${activeTab === 'sensors' ? 'active' : ''}`}
            onClick={() => setActiveTab('sensors')}
          >
            <Activity size={16} />
            <span>Sensor Data</span>
          </button>
          <button
            className={`nav-item ${activeTab === 'gps' ? 'active' : ''}`}
            onClick={() => setActiveTab('gps')}
          >
            <MapPin size={16} />
            <span>GPS Tracking</span>
          </button>
          <button
            className={`nav-item ${activeTab === 'alerts' ? 'active' : ''}`}
            onClick={() => setActiveTab('alerts')}
          >
            <Bell size={16} />
            <span>Alerts &amp; Logs</span>
            {alerts.length > 0 && <span className="nav-badge">{alerts.length}</span>}
          </button>
          <button
            className={`nav-item ${activeTab === 'settings' ? 'active' : ''}`}
            onClick={() => setActiveTab('settings')}
          >
            <Settings size={16} />
            <span>Settings</span>
          </button>
        </nav>

        <div className="sidebar-footer">
          <div className="hardware-meta-box">
            <div>
              <span>DEVICE</span>
              <b>ESP32 DevKit V1</b>
            </div>
            <div>
              <span>TELEMETRY</span>
              <b>GET /data</b>
            </div>
            <div>
              <span>CAMERA</span>
              <b>ESP32-CAM</b>
            </div>
          </div>
        </div>
      </aside>

      {/* Main Wrapper */}
      <div className="main-wrapper">
        {/* Top Header */}
        <header className="top-header">
          <div className="top-header-left">
            <div className="train-id-badge">
              <TrainFront size={15} />
              <span>TRAIN ID: SR–001 (Stationary Testbench)</span>
            </div>
            <div className="hardware-status-pills">
              <span className={`status-pill ${esp32Online ? 'online' : 'offline'}`}>
                <i />
                {esp32Online ? 'ESP32 ONLINE' : 'ESP32 OFFLINE'}
              </span>
              <span className={`status-pill ${camOnline ? 'online' : 'offline'}`}>
                <i />
                {camOnline ? 'CAMERA ONLINE' : 'CAMERA OFFLINE'}
              </span>
            </div>
          </div>

          <div className="top-header-right">
            <div className="header-clock">
              <Clock size={15} />
              <span>{formatTime(currentTime)}</span>
            </div>
            <button
              className={`icon-btn ${soundEnabled ? 'active' : ''}`}
              title={soundEnabled ? 'Mute buzzer alarm' : 'Enable audio alarm sound'}
              onClick={() => setSoundEnabled(!soundEnabled)}
            >
              {soundEnabled ? <Volume2 size={17} /> : <VolumeX size={17} />}
            </button>
          </div>
        </header>

        {/* Page Content */}
        <div className="page-body">
          {/* Master System Banner */}
          <div className={`system-strip ${anyAlert ? 'danger' : esp32Online ? '' : 'warning'}`}>
            <div className="system-strip-left">
              {anyAlert ? (
                <OctagonX size={20} style={{ color: '#ff6a78' }} />
              ) : (
                <ShieldCheck size={20} style={{ color: '#41e0ac' }} />
              )}
              <div>
                <strong>
                  {hasObstacle
                    ? `⚠ OBSTACLE DETECTED AT ${fmt(liveDist)} CM — TRACK BLOCKED`
                    : anyAlert
                    ? 'CRITICAL RAILWAY HAZARD DETECTED'
                    : esp32Online
                    ? 'ALL PHYSICAL SENSORS ACTIVE & REPORTING'
                    : 'WAITING FOR HARDWARE CONNECTION'}
                </strong>
                <span>
                  {esp32Online
                    ? hasObstacle
                      ? `HC-SR04 Ultrasonic Sensor on GPIO 33/25 detected obstacle within ${OBSTACLE_THRESHOLD_CM} cm safety threshold`
                      : `ESP32 connected at ${apiUrl} · Last received ${lastSeen ? formatTime(lastSeen) : 'just now'}`
                    : `ESP32 offline · Polling ${apiUrl ? apiUrl : 'configured IP'}/data · Check Wi-Fi and power supply`}
                </span>
              </div>
            </div>
            <div className="system-strip-right">
              <span className="mono" style={{ fontSize: 11, color: '#88a6b4' }}>
                Buzzer: <b>{anyAlert ? 'TRIGGERED (GPIO 27)' : 'STANDBY'}</b>
              </span>
            </div>
          </div>

          {/* Real Sensor Metrics Strip */}
          {renderSensorCards()}

          {/* View Tab Switching */}
          {activeTab === 'overview' && (
            <div className="dashboard-grid">
              <div className="grid-col">
                {renderTrackView()}
                {renderCharts()}
              </div>
              <div className="grid-col">
                {renderCameraFeed()}
                {renderGPSPanel()}
                {renderAlertsTable()}
              </div>
            </div>
          )}

          {activeTab === 'camera' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
              {renderCameraFeed()}
              <div className="panel">
                <div className="panel-header">
                  <div className="panel-title">
                    <Eye size={18} />
                    <span>Camera Hardware Configuration</span>
                  </div>
                </div>
                <div className="panel-body">
                  <p style={{ fontSize: 13, color: '#97b1bd', lineHeight: 1.6 }}>
                    The live stream above is rendered in real-time from the AI-Thinker ESP32-CAM module using an MJPEG stream over HTTP.
                    It supports direct browser inspection, zero third-party cloud streaming latency, and native CORS headers.
                  </p>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'train' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
              {renderTrackView()}
              {renderAlertsTable()}
            </div>
          )}

          {activeTab === 'sensors' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
              {renderCharts()}
              {renderAlertsTable()}
            </div>
          )}

          {activeTab === 'gps' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
              {renderGPSPanel()}
            </div>
          )}

          {activeTab === 'alerts' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
              {renderAlertsTable()}
            </div>
          )}

          {activeTab === 'settings' && (
            <div>
              {renderSettings()}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// Leaflet Map Component with real coordinates
function GPSMapComponent({ lat, lng, hasFix }: { lat?: number | null; lng?: number | null; hasFix: boolean }) {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const markerRef = useRef<L.CircleMarker | null>(null);

  useEffect(() => {
    if (!mapContainerRef.current) return;

    // Default center (Hyderabad area if fix not ready)
    const initialLat = lat || 17.4435;
    const initialLng = lng || 78.3772;

    const map = L.map(mapContainerRef.current, {
      zoomControl: false,
      attributionControl: false,
      dragging: true,
      scrollWheelZoom: false,
    }).setView([initialLat, initialLng], 14);

    mapRef.current = map;

    // Tile-free schematic background
    L.circleMarker([initialLat, initialLng], {
      radius: 8,
      color: '#41e0ac',
      fillColor: '#41e0ac',
      fillOpacity: 0.8,
    }).addTo(map);

    L.control.zoom({ position: 'bottomright' }).addTo(map);

    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // Update marker position on real GPS changes
  useEffect(() => {
    if (!mapRef.current) return;
    if (hasFix && lat && lng) {
      if (!markerRef.current) {
        markerRef.current = L.circleMarker([lat, lng], {
          radius: 9,
          color: '#07161b',
          weight: 2,
          fillColor: '#41e0ac',
          fillOpacity: 1,
        }).addTo(mapRef.current);
      } else {
        markerRef.current.setLatLng([lat, lng]);
      }
      mapRef.current.panTo([lat, lng]);
    }
  }, [lat, lng, hasFix]);

  return <div ref={mapContainerRef} style={{ width: '100%', height: '100%' }} />;
}

// Root Entry Point
createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <SmartRailApp />
  </React.StrictMode>
);
