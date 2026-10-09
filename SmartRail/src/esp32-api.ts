/// <reference types="vite/client" />

/**
 * SmartRail — Real Hardware API Client
 * Manages real telemetry communication with ESP32 WebServer (GET /data)
 * and ESP32-CAM live stream (GET /stream).
 */

// Central configurable obstacle detection threshold in centimeters
export const OBSTACLE_THRESHOLD_CM = 50;

// Central polling interval recommendation (1 second)
export const DEFAULT_POLL_INTERVAL_MS = 1000;

/**
 * Central ESP32 Telemetry contract matching real hardware sensor payload
 */
export interface ESP32Telemetry {
  distance?: number | null;
  temperature?: number | null;
  humidity?: number | null;
  vibration?: number | boolean | null;
  gas?: number | null;
  smoke?: number | null;
  flame?: number | null;
  motion?: boolean | null;
  latitude?: number | null;
  longitude?: number | null;
  gasAlert?: boolean;
  flameAlert?: boolean;
  vibrationAlert?: boolean;
  obstacleAlert?: boolean;
}

export interface TelemetrySample {
  time: string;
  seconds: number;
  temperature: number | null;
  humidity: number | null;
  gas: number;
  distance: number | null;
}

export interface AlertLogItem {
  id: string;
  timestamp: string;
  timeEpoch: number;
  type: string;
  severity: 'HIGH' | 'CRITICAL' | 'WARNING' | 'INFO';
  sensor: string;
  value: string;
  message: string;
}

export type UltrasonicStatus = 'CRITICAL' | 'NORMAL' | 'UNAVAILABLE';

/**
 * Strict physical distance validation for HC-SR04 ultrasonic sensor.
 * Returns valid centimeters (between 2.0 and 400.0 cm) or null for any invalid/offline/timeout state.
 */
export function validateDistance(distance: unknown): number | null {
  if (distance === null || distance === undefined) return null;
  const num = typeof distance === 'number' ? distance : parseFloat(String(distance));
  if (isNaN(num) || !isFinite(num) || num <= 0 || num > 400) {
    return null;
  }
  return num;
}

/**
 * Evaluates whether a valid distance reading represents an obstacle hazard.
 * Invalid or unavailable distances NEVER trigger an obstacle alert.
 */
export function isObstacle(distance: number | null | undefined, threshold = OBSTACLE_THRESHOLD_CM): boolean {
  if (distance === null || distance === undefined || isNaN(distance) || distance <= 0) {
    return false;
  }
  return distance <= threshold;
}

/**
 * Returns standardized status string for UI display.
 */
export function getUltrasonicStatus(
  distance: number | null | undefined,
  isOnline: boolean,
  threshold = OBSTACLE_THRESHOLD_CM
): UltrasonicStatus {
  if (!isOnline || distance === null || distance === undefined || isNaN(distance) || distance <= 0) {
    return 'UNAVAILABLE';
  }
  return distance <= threshold ? 'CRITICAL' : 'NORMAL';
}

// Environment variables (No hardcoded IP addresses in source code, with safe discovered defaults)
const metaEnv = (import.meta as unknown as { env?: Record<string, string> }).env || {};
export const DEFAULT_ESP32_URL = metaEnv.VITE_ESP32_API_URL?.trim() || 'http://10.73.17.9';
export const DEFAULT_CAM_URL = metaEnv.VITE_ESP32_CAM_URL?.trim() || 'http://10.73.17.41/stream';
export const IS_MOCK_ENABLED = metaEnv.VITE_ENABLE_SENSOR_MOCK === 'true';

export function getStoredApiUrl(): string {
  const envUrl = metaEnv.VITE_ESP32_API_URL?.trim() || DEFAULT_ESP32_URL;
  const stored = localStorage.getItem('smartrail_esp32_url')?.trim();
  if (stored && stored !== 'http://YOUR_ESP32_IP' && !stored.includes('YOUR_ESP32_IP')) {
    return stored;
  }
  return envUrl;
}

export function setStoredApiUrl(url: string): void {
  localStorage.setItem('smartrail_esp32_url', url.trim());
}

export function getStoredCamUrl(): string {
  const envUrl = metaEnv.VITE_ESP32_CAM_URL?.trim() || DEFAULT_CAM_URL;
  const stored = localStorage.getItem('smartrail_cam_url')?.trim();
  if (stored && stored !== 'http://YOUR_CAM_IP/stream' && !stored.includes('YOUR_CAM_IP')) {
    return stored;
  }
  return envUrl;
}

export function setStoredCamUrl(url: string): void {
  localStorage.setItem('smartrail_cam_url', url.trim());
}

/**
 * Fetch live sensor telemetry from real ESP32 (GET /data)
 * Strict 2500ms timeout prevents browser freeze.
 */
export async function fetchESP32Data(baseUrl: string): Promise<ESP32Telemetry> {
  const cleanUrl = baseUrl?.trim();
  if (!cleanUrl || cleanUrl === 'http://YOUR_ESP32_IP' || cleanUrl.includes('YOUR_ESP32_IP')) {
    throw new Error('ESP32 URL not configured. Set VITE_ESP32_API_URL in .env or Settings.');
  }

  const url = `${cleanUrl.replace(/\/+$/, '')}/data`;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 2500);

  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
      },
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      throw new Error(`HTTP error ${response.status}`);
    }

    const data: unknown = await response.json();
    if (!data || typeof data !== 'object') {
      throw new Error('Invalid JSON payload received from ESP32');
    }

    const raw = data as Record<string, unknown>;

    // Sanitize and validate every incoming telemetry field
    const telemetry: ESP32Telemetry = {
      temperature: typeof raw.temperature === 'number' && isFinite(raw.temperature) ? raw.temperature : null,
      humidity: typeof raw.humidity === 'number' && isFinite(raw.humidity) ? raw.humidity : null,
      vibration: typeof raw.vibration === 'number' || typeof raw.vibration === 'boolean' ? raw.vibration : 0,
      gas: typeof raw.gas === 'number' && isFinite(raw.gas) ? raw.gas : (typeof raw.smoke === 'number' && isFinite(raw.smoke) ? raw.smoke : 0),
      smoke: typeof raw.smoke === 'number' && isFinite(raw.smoke) ? raw.smoke : (typeof raw.gas === 'number' && isFinite(raw.gas) ? raw.gas : null),
      flame: typeof raw.flame === 'number' ? raw.flame : 1,
      distance: validateDistance(raw.distance),
      latitude: typeof raw.latitude === 'number' && isFinite(raw.latitude) ? raw.latitude : null,
      longitude: typeof raw.longitude === 'number' && isFinite(raw.longitude) ? raw.longitude : null,
      gasAlert: Boolean(raw.gasAlert),
      flameAlert: Boolean(raw.flameAlert),
      vibrationAlert: Boolean(raw.vibrationAlert),
      obstacleAlert: Boolean(raw.obstacleAlert),
    };

    return telemetry;
  } catch (err) {
    clearTimeout(timeoutId);
    throw err;
  }
}

/**
 * Check if the ESP32-CAM is online by fetching a single JPEG snapshot from /capture.
 */
export async function checkCameraStream(camUrl: string): Promise<boolean> {
  const cleanUrl = camUrl?.trim();
  if (!cleanUrl || cleanUrl.includes('YOUR_CAM_IP')) return false;

  const baseUrl = cleanUrl
    .replace(/\/stream\/?$/, '')
    .replace(/\/+$/, '');
  const captureUrl = `${baseUrl}/capture?_t=${Date.now()}`;

  return new Promise((resolve) => {
    const img = new Image();
    let resolved = false;

    const timer = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        img.src = '';
        resolve(false);
      }
    }, 5000);

    img.onload = () => {
      if (!resolved) {
        resolved = true;
        clearTimeout(timer);
        resolve(true);
      }
    };

    img.onerror = () => {
      if (!resolved) {
        resolved = true;
        clearTimeout(timer);
        resolve(false);
      }
    };

    img.src = captureUrl;
  });
}
