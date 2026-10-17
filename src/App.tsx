/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef } from 'react';
import {
  Chart as ChartJS,
  registerables,
} from 'chart.js';
import {
  Wind,
  Sun,
  Moon,
  Play,
  Square,
  RefreshCw,
  Settings,
  ShieldCheck,
} from 'lucide-react';

// Register all Chart.js controllers and elements
ChartJS.register(...registerables);

interface SensorReading {
  temperature: number; // °C
  humidity: number; // %
  co2: number; // ppm
  co: number; // ppm
  no2: number; // ppb
  timestamp: string;
}

const MAX_CHART_POINTS = 20;
const DEFAULT_RENDER_ENDPOINT = "https://my-aqi-api.onrender.com/api/sensor-data";

export default function App() {
  // Theme state: default to Bright Mode (false) as requested
  const [isDarkMode, setIsDarkMode] = useState<boolean>(false);

  // Start / Stop Dashboard Polling state (default running)
  const [isPollingActive, setIsPollingActive] = useState<boolean>(true);
  const [countdown, setCountdown] = useState<number>(5);
  const [lastSyncTime, setLastSyncTime] = useState<string>('Just now');
  const [syncStatus, setSyncStatus] = useState<'connected' | 'mock' | 'error'>('mock');

  // API Config state
  const [renderApiUrl, setRenderApiUrl] = useState<string>(DEFAULT_RENDER_ENDPOINT);
  const [forceMock, setForceMock] = useState<boolean>(true);
  const [isConfigOpen, setIsConfigOpen] = useState<boolean>(false);
  const [testPingStatus, setTestPingStatus] = useState<string | null>(null);

  // Current Sensor Values (The 5 Target Metrics)
  const [currentReadings, setCurrentReadings] = useState<SensorReading>({
    temperature: 24.2,
    humidity: 48.5,
    co2: 560,
    co: 1.6,
    no2: 19.8,
    timestamp: new Date().toISOString(),
  });

  // Animated displayed readings for fluid number transitions matching gauge easing
  const [displayedReadings, setDisplayedReadings] = useState<SensorReading>({
    temperature: 24.2,
    humidity: 48.5,
    co2: 560,
    co: 1.6,
    no2: 19.8,
    timestamp: new Date().toISOString(),
  });
  const displayedReadingsRef = useRef<SensorReading>(displayedReadings);
  const animFrameRef = useRef<number | null>(null);

  const animateReadingsTo = (target: SensorReading) => {
    if (animFrameRef.current) {
      cancelAnimationFrame(animFrameRef.current);
    }

    const start = { ...displayedReadingsRef.current };
    const startTime = performance.now();
    const duration = 1800; // 1.8s smooth fluid easing over 5s poll cycle

    const step = (now: number) => {
      const elapsed = now - startTime;
      const progress = Math.min(elapsed / duration, 1);
      // easeOutCubic curve for organic deceleration
      const ease = 1 - Math.pow(1 - progress, 3);

      const current: SensorReading = {
        temperature: +(start.temperature + (target.temperature - start.temperature) * ease).toFixed(2),
        humidity: +(start.humidity + (target.humidity - start.humidity) * ease).toFixed(2),
        co2: Math.round(start.co2 + (target.co2 - start.co2) * ease),
        co: +(start.co + (target.co - start.co) * ease).toFixed(1),
        no2: +(start.no2 + (target.no2 - start.no2) * ease).toFixed(1),
        timestamp: target.timestamp,
      };

      displayedReadingsRef.current = current;
      setDisplayedReadings(current);

      if (progress < 1) {
        animFrameRef.current = requestAnimationFrame(step);
      }
    };

    animFrameRef.current = requestAnimationFrame(step);
  };

  // History buffers for the 2 line graphs (up to 20 points)
  const historyRef = useRef<{
    labels: string[];
    temperatures: number[];
    humidities: number[];
  }>({
    labels: [],
    temperatures: [],
    humidities: [],
  });

  // Canvas refs
  const canvasCO2Ref = useRef<HTMLCanvasElement | null>(null);
  const canvasCORef = useRef<HTMLCanvasElement | null>(null);
  const canvasNO2Ref = useRef<HTMLCanvasElement | null>(null);
  const canvasTempRef = useRef<HTMLCanvasElement | null>(null);
  const canvasHumidityRef = useRef<HTMLCanvasElement | null>(null);

  // Chart instance refs
  const chartCO2Instance = useRef<ChartJS | null>(null);
  const chartCOInstance = useRef<ChartJS | null>(null);
  const chartNO2Instance = useRef<ChartJS | null>(null);
  const chartTempInstance = useRef<ChartJS | null>(null);
  const chartHumidityInstance = useRef<ChartJS | null>(null);

  // Initialize seed historical data (20 points)
  useEffect(() => {
    const labels: string[] = [];
    const temps: number[] = [];
    const hums: number[] = [];
    const now = Date.now();

    for (let i = MAX_CHART_POINTS - 1; i >= 0; i--) {
      const time = new Date(now - i * 5000);
      labels.push(time.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }));
      temps.push(+(23.5 + Math.sin(i / 2) * 0.8 + (Math.random() - 0.5) * 0.3).toFixed(1));
      hums.push(+(47.0 + Math.cos(i / 2) * 2.2 + (Math.random() - 0.5) * 0.5).toFixed(1));
    }

    historyRef.current = { labels, temperatures: temps, humidities: hums };
    setLastSyncTime(new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }));
  }, []);

  // Sync dark mode class on HTML root
  useEffect(() => {
    if (isDarkMode) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }, [isDarkMode]);

  // Safe limit definitions for environmental sensors
  type AlertLevel = 'safe' | 'warning' | 'danger';

  const SENSOR_SAFE_LIMITS = {
    co2: {
      warningThreshold: 1000,
      dangerThreshold: 1500,
      safeText: '<800 (Pure)',
      warningText: '1000 - 1400',
      dangerText: '>1500 (Drowsy)',
      rangeText: '0 - 2000 ppm',
      alertWarningText: 'CAUTION: >1000',
      alertDangerText: 'HAZARD: >1500',
    },
    co: {
      warningThreshold: 9.0,
      dangerThreshold: 25.0,
      safeText: '<9.0 (Safe)',
      warningText: '10 - 25',
      dangerText: '>25 (Hazard)',
      rangeText: '0 - 50 ppm',
      alertWarningText: 'CAUTION: ≥9.0',
      alertDangerText: 'HAZARD: ≥25',
    },
    no2: {
      warningThreshold: 54.0,
      dangerThreshold: 100.0,
      safeText: '<53 (Good)',
      warningText: '54 - 100',
      dangerText: '>100 (High)',
      rangeText: '0 - 150 ppb',
      alertWarningText: 'CAUTION: ≥54',
      alertDangerText: 'HAZARD: >100',
    },
  };

  const getSensorAlertLevel = (sensor: 'co2' | 'co' | 'no2', value: number): AlertLevel => {
    const limits = SENSOR_SAFE_LIMITS[sensor];
    if (value >= limits.dangerThreshold) return 'danger';
    if (value >= limits.warningThreshold) return 'warning';
    return 'safe';
  };

  // Precision needle indicator plugin that tracks gauge fill edge during easing transitions
  const gaugeNeedlePlugin = {
    id: 'gaugeNeedle',
    afterDatasetDraw(chart: ChartJS, args: any) {
      if (args.index !== 0) return;
      const meta = chart.getDatasetMeta(0);
      if (!meta || !meta.data || !meta.data[0]) return;
      const arc = meta.data[0] as any;
      if (!arc.getProps) return;

      const props = arc.getProps(['x', 'y', 'innerRadius', 'outerRadius', 'endAngle'], true);
      if (!props || typeof props.endAngle !== 'number') return;
      const { x, y, innerRadius, outerRadius, endAngle } = props;

      const { ctx } = chart;
      ctx.save();

      // Needle pointer spanning across the arc from inner to outer radius
      const needleInnerR = innerRadius - 3;
      const needleOuterR = outerRadius + 5;

      const x1 = x + needleInnerR * Math.cos(endAngle);
      const y1 = y + needleInnerR * Math.sin(endAngle);
      const x2 = x + needleOuterR * Math.cos(endAngle);
      const y2 = y + needleOuterR * Math.sin(endAngle);

      const activeColor = (chart.data.datasets[0].backgroundColor as string[])?.[0] || '#10b981';
      const isDanger = activeColor === '#ef4444';
      const isWarning = activeColor === '#f59e0b';

      // Glowing indicator needle line with color-coordinated shadow
      ctx.shadowColor = isDanger
        ? 'rgba(239, 68, 68, 0.95)'
        : isWarning
        ? 'rgba(245, 158, 11, 0.95)'
        : 'rgba(16, 185, 129, 0.75)';
      ctx.shadowBlur = isDanger || isWarning ? 12 : 8;
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 3;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();

      // High-visibility needle pointer tip bead
      ctx.shadowColor = isDanger
        ? 'rgba(239, 68, 68, 1)'
        : isWarning
        ? 'rgba(245, 158, 11, 1)'
        : 'rgba(16, 185, 129, 0.9)';
      ctx.shadowBlur = 10;
      ctx.fillStyle = activeColor;
      ctx.beginPath();
      ctx.arc(x2, y2, 4.5, 0, Math.PI * 2);
      ctx.fill();

      // Visual Alert beacon ring when exceeding safe limits
      if (isDanger || isWarning) {
        ctx.beginPath();
        ctx.arc(x2, y2, 8, 0, Math.PI * 2);
        ctx.fillStyle = isDanger ? 'rgba(239, 68, 68, 0.35)' : 'rgba(245, 158, 11, 0.35)';
        ctx.fill();
      }

      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1.5;
      ctx.stroke();

      ctx.restore();
    },
  };

  // Create Half-Circle Gauge Helper with smooth easing animation and alert thresholds
  const initGaugeChart = (
    canvas: HTMLCanvasElement,
    initialVal: number,
    minVal: number,
    maxVal: number,
    sensorType: 'co2' | 'co' | 'no2'
  ): ChartJS => {
    const ctx = canvas.getContext('2d')!;
    const pct = Math.min(Math.max((initialVal - minVal) / (maxVal - minVal), 0), 1);
    const alertLevel = getSensorAlertLevel(sensorType, initialVal);
    let initialColor = '#10b981';
    if (alertLevel === 'danger') initialColor = '#ef4444';
    else if (alertLevel === 'warning') initialColor = '#f59e0b';

    return new ChartJS(ctx, {
      type: 'doughnut',
      data: {
        datasets: [
          {
            data: [pct * 100, (1 - pct) * 100],
            backgroundColor: [
              initialColor,
              isDarkMode ? 'rgba(30, 41, 59, 0.45)' : 'rgba(203, 213, 225, 0.8)',
            ],
            borderWidth: 0,
            borderRadius: [6, 0],
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        circumference: 180,
        rotation: 270,
        cutout: '75%',
        animation: {
          duration: 1800,
          easing: 'easeOutCubic',
        },
        plugins: {
          tooltip: { enabled: false },
        },
      } as any,
      plugins: [gaugeNeedlePlugin as any],
    });
  };

  // Update Half Gauge Chart with smooth easing transition and alert color shifts over the 5-second polling cycle
  const updateGauge = (
    chart: ChartJS | null,
    val: number,
    minVal: number,
    maxVal: number,
    sensorType: 'co2' | 'co' | 'no2'
  ) => {
    if (!chart) return;
    const pct = Math.min(Math.max((val - minVal) / (maxVal - minVal), 0), 1);
    chart.data.datasets[0].data = [pct * 100, (1 - pct) * 100];

    const alertLevel = getSensorAlertLevel(sensorType, val);
    let gaugeColor = '#10b981'; // Bright green for safe
    if (alertLevel === 'danger') {
      gaugeColor = '#ef4444'; // Red for critical/hazard limit exceeded
    } else if (alertLevel === 'warning') {
      gaugeColor = '#f59e0b'; // Amber for warning limit exceeded
    }

    chart.data.datasets[0].backgroundColor = [
      gaugeColor,
      isDarkMode ? 'rgba(30, 41, 59, 0.45)' : 'rgba(203, 213, 225, 0.8)',
    ];
    // Trigger fluid easing animation
    chart.update();
  };

  // Create Line Graph Helper with bright green gradient fill & pure black labels in bright mode
  const initLineGraph = (
    canvas: HTMLCanvasElement,
    label: string,
    unit: string,
    initialLabels: string[],
    initialData: number[]
  ): ChartJS => {
    const ctx = canvas.getContext('2d')!;

    // Create bright green gradient fill
    const gradient = ctx.createLinearGradient(0, 0, 0, 200);
    gradient.addColorStop(0, 'rgba(16, 185, 129, 0.38)');
    gradient.addColorStop(0.65, 'rgba(16, 185, 129, 0.10)');
    gradient.addColorStop(1, 'rgba(16, 185, 129, 0.00)');

    return new ChartJS(ctx, {
      type: 'line',
      data: {
        labels: [...initialLabels],
        datasets: [
          {
            label: label,
            data: [...initialData],
            borderColor: '#10b981',
            borderWidth: 2.2,
            pointBackgroundColor: '#10b981',
            pointBorderColor: isDarkMode ? '#090d16' : '#ffffff',
            pointBorderWidth: 1.5,
            pointRadius: 2.5,
            pointHoverRadius: 5,
            fill: true,
            backgroundColor: gradient,
            tension: 0.35,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: {
          duration: 400,
          easing: 'easeInOutQuad',
        },
        interaction: {
          intersect: false,
          mode: 'index',
        },
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: isDarkMode ? '#0f172a' : '#ffffff',
            titleColor: isDarkMode ? '#94a3b8' : '#000000',
            bodyColor: isDarkMode ? '#34d399' : '#000000',
            borderColor: 'rgba(16, 185, 129, 0.4)',
            borderWidth: 1.5,
            padding: 8,
            displayColors: false,
            callbacks: {
              title: (items) => (items.length > 0 ? `Time: ${items[0].label}` : ''),
              label: (ctx) => `${ctx.dataset.label}: ${Number(ctx.parsed.y).toFixed(2)} ${unit}`,
            },
          },
        },
        scales: {
          x: {
            grid: {
              color: isDarkMode ? 'rgba(255, 255, 255, 0.04)' : 'rgba(0, 0, 0, 0.09)',
            },
            ticks: {
              // Pure black font in bright mode, bold weight
              color: isDarkMode ? '#64748b' : '#000000',
              font: { family: '"JetBrains Mono"', size: 9, weight: 700 },
              maxTicksLimit: 6,
            },
          },
          y: {
            grid: {
              color: isDarkMode ? 'rgba(255, 255, 255, 0.05)' : 'rgba(0, 0, 0, 0.09)',
            },
            ticks: {
              precision: 0,
              // Pure black font in bright mode, bold weight, whole numbers only on Y-axis
              color: isDarkMode ? '#64748b' : '#000000',
              font: { family: '"JetBrains Mono"', size: 9, weight: 700 },
              callback: (val) => `${Math.round(Number(val))} ${unit}`,
            },
          },
        },
      },
    });
  };

  // Initialize all 5 charts
  useEffect(() => {
    if (
      canvasCO2Ref.current &&
      canvasCORef.current &&
      canvasNO2Ref.current &&
      canvasTempRef.current &&
      canvasHumidityRef.current
    ) {
      chartCO2Instance.current?.destroy();
      chartCOInstance.current?.destroy();
      chartNO2Instance.current?.destroy();
      chartTempInstance.current?.destroy();
      chartHumidityInstance.current?.destroy();

      // Gauges (CO2, CO, NO2)
      chartCO2Instance.current = initGaugeChart(canvasCO2Ref.current, currentReadings.co2, 0, 2000, 'co2');
      chartCOInstance.current = initGaugeChart(canvasCORef.current, currentReadings.co, 0, 50, 'co');
      chartNO2Instance.current = initGaugeChart(canvasNO2Ref.current, currentReadings.no2, 0, 150, 'no2');

      // Line graphs (Temperature & Humidity)
      chartTempInstance.current = initLineGraph(
        canvasTempRef.current,
        'Temperature',
        '°C',
        historyRef.current.labels,
        historyRef.current.temperatures
      );
      chartHumidityInstance.current = initLineGraph(
        canvasHumidityRef.current,
        'Humidity',
        '%',
        historyRef.current.labels,
        historyRef.current.humidities
      );
    }

    return () => {
      chartCO2Instance.current?.destroy();
      chartCOInstance.current?.destroy();
      chartNO2Instance.current?.destroy();
      chartTempInstance.current?.destroy();
      chartHumidityInstance.current?.destroy();
    };
  }, [isDarkMode]);

  // Mock generator function
  const generateMockSensorReading = (prev: SensorReading): SensorReading => {
    const tempDelta = (Math.random() - 0.48) * 0.4;
    const humDelta = (Math.random() - 0.5) * 0.8;
    const co2Delta = (Math.random() - 0.48) * 25;
    const coDelta = (Math.random() - 0.5) * 0.15;
    const no2Delta = (Math.random() - 0.5) * 0.9;

    const newTemp = +(Math.min(Math.max(prev.temperature + tempDelta, 18.0), 32.0)).toFixed(1);
    const newHumidity = +(Math.min(Math.max(prev.humidity + humDelta, 30.0), 80.0)).toFixed(1);
    const newCO2 = Math.round(Math.min(Math.max(prev.co2 + co2Delta, 400), 1600));
    const newCO = +(Math.min(Math.max(prev.co + coDelta, 0.2), 25.0)).toFixed(1);
    const newNO2 = +(Math.min(Math.max(prev.no2 + no2Delta, 5.0), 95.0)).toFixed(1);

    return {
      temperature: newTemp,
      humidity: newHumidity,
      co2: newCO2,
      co: newCO,
      no2: newNO2,
      timestamp: new Date().toISOString(),
    };
  };

  // Ingest reading and push to charts
  const ingestReading = (data: SensorReading) => {
    setCurrentReadings(data);
    animateReadingsTo(data);
    const timeStr = new Date(data.timestamp || Date.now()).toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    setLastSyncTime(timeStr);

    // Update Gauges with alert state
    updateGauge(chartCO2Instance.current, data.co2, 0, 2000, 'co2');
    updateGauge(chartCOInstance.current, data.co, 0, 50, 'co');
    updateGauge(chartNO2Instance.current, data.no2, 0, 150, 'no2');

    // Update Line Graphs (Keep max 20 data points, shift older out)
    if (chartTempInstance.current) {
      chartTempInstance.current.data.labels?.push(timeStr);
      chartTempInstance.current.data.datasets[0].data.push(data.temperature);
      if ((chartTempInstance.current.data.labels?.length ?? 0) > MAX_CHART_POINTS) {
        chartTempInstance.current.data.labels?.shift();
        chartTempInstance.current.data.datasets[0].data.shift();
      }
      chartTempInstance.current.update('none');
    }

    if (chartHumidityInstance.current) {
      chartHumidityInstance.current.data.labels?.push(timeStr);
      chartHumidityInstance.current.data.datasets[0].data.push(data.humidity);
      if ((chartHumidityInstance.current.data.labels?.length ?? 0) > MAX_CHART_POINTS) {
        chartHumidityInstance.current.data.labels?.shift();
        chartHumidityInstance.current.data.datasets[0].data.shift();
      }
      chartHumidityInstance.current.update('none');
    }
  };

  // Perform one fetch cycle
  const fetchTelemetry = async () => {
    if (forceMock) {
      setSyncStatus('mock');
      setCurrentReadings((prev) => {
        const next = generateMockSensorReading(prev);
        ingestReading(next);
        return next;
      });
      return;
    }

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 4000);

      const response = await fetch(renderApiUrl, {
        method: 'GET',
        headers: { Accept: 'application/json' },
        signal: controller.signal,
      });
      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`HTTP Error ${response.status}`);
      }

      const payload = await response.json();
      const cleanData: SensorReading = {
        temperature: +(payload.temperature ?? payload.temp ?? 24.0),
        humidity: +(payload.humidity ?? payload.hum ?? 50.0),
        co2: +(payload.co2 ?? payload.carbon_dioxide ?? 550),
        co: +(payload.co ?? payload.carbon_monoxide ?? 1.5),
        no2: +(payload.no2 ?? payload.nitrogen_dioxide ?? 20.0),
        timestamp: payload.timestamp || new Date().toISOString(),
      };

      setSyncStatus('connected');
      ingestReading(cleanData);
    } catch (err: any) {
      console.warn('Render API call failed, falling back to simulated data:', err.message);
      setSyncStatus('error');

      // Fallback to mock data so UI continues running seamlessly
      setCurrentReadings((prev) => {
        const next = generateMockSensorReading(prev);
        ingestReading(next);
        return next;
      });
    }
  };

  // Polling loop: Countdown every second, trigger fetch every 5 seconds (Only when isPollingActive is true)
  useEffect(() => {
    if (!isPollingActive) return;

    const timer = setInterval(() => {
      setCountdown((prev) => {
        if (prev <= 1) {
          fetchTelemetry();
          return 5;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(timer);
  }, [isPollingActive, forceMock, renderApiUrl]);

  // Overall AQI composite computation
  const compositeScore = Math.round(
    currentReadings.co2 / 20 + currentReadings.co * 8 + currentReadings.no2 * 0.8
  );

  let aqiCategory = {
    title: 'EXCELLENT',
    color: isDarkMode ? 'text-emerald-400' : 'text-black',
    border: isDarkMode ? 'border-emerald-500/30' : 'border-slate-400',
    bg: isDarkMode ? 'bg-emerald-500/10' : 'bg-slate-100',
  };

  if (compositeScore > 110) {
    aqiCategory = {
      title: 'UNHEALTHY',
      color: isDarkMode ? 'text-red-400' : 'text-black',
      border: isDarkMode ? 'border-red-500/40' : 'border-slate-400',
      bg: isDarkMode ? 'bg-red-500/10' : 'bg-slate-100',
    };
  } else if (compositeScore > 75) {
    aqiCategory = {
      title: 'MODERATE',
      color: isDarkMode ? 'text-amber-400' : 'text-black',
      border: isDarkMode ? 'border-amber-500/30' : 'border-slate-400',
      bg: isDarkMode ? 'bg-amber-500/10' : 'bg-slate-100',
    };
  } else if (compositeScore > 45) {
    aqiCategory = {
      title: 'GOOD',
      color: isDarkMode ? 'text-emerald-300' : 'text-black',
      border: isDarkMode ? 'border-emerald-500/30' : 'border-slate-400',
      bg: isDarkMode ? 'bg-emerald-500/10' : 'bg-slate-100',
    };
  }

  const handleTestPing = async () => {
    setTestPingStatus('Testing connection...');
    const t0 = performance.now();
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);
      const res = await fetch(renderApiUrl, { method: 'GET', signal: controller.signal });
      clearTimeout(timeoutId);
      const latency = Math.round(performance.now() - t0);
      if (res.ok) {
        setTestPingStatus(`Success! Status ${res.status} (${latency}ms roundtrip)`);
      } else {
        setTestPingStatus(`Server returned status ${res.status} (${latency}ms)`);
      }
    } catch (e: any) {
      setTestPingStatus(`Connection failed: ${e.message} (CORS or server sleeping)`);
    }
  };



  // Toggle Start / Stop
  const handleToggleStartStop = () => {
    if (isPollingActive) {
      setIsPollingActive(false);
    } else {
      setIsPollingActive(true);
      setCountdown(5);
      fetchTelemetry();
    }
  };

  return (
    <div
      className={`h-screen w-screen flex flex-col overflow-hidden transition-colors duration-300 ${
        isDarkMode ? 'bg-slate-950 text-slate-100' : 'bg-slate-100 text-black'
      }`}
    >
      {/* COMPACT TOP NAVIGATION & STATUS BAR */}
      <header
        className={`shrink-0 h-13 px-3 sm:px-5 flex items-center justify-between border-b backdrop-blur-md transition-colors ${
          isDarkMode
            ? 'bg-slate-950/90 border-emerald-500/20'
            : 'bg-white border-slate-300 shadow-sm'
        }`}
      >
        {/* Brand & AQI Badge */}
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center text-emerald-500 glow-emerald shrink-0">
            <Wind className="w-4 h-4 text-emerald-500" />
          </div>
          <div className="flex items-center gap-2">
            <span
              className="text-base font-black tracking-tight font-sans whitespace-nowrap"
              style={{ color: isDarkMode ? '#34d399' : '#000000' }}
            >
              EcoSense AQI
            </span>
            <div
              className={`hidden sm:flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-mono font-black border ${aqiCategory.bg} ${aqiCategory.color} ${aqiCategory.border}`}
            >
              <ShieldCheck className="w-3.5 h-3.5 text-emerald-500" />
              <span>{aqiCategory.title} (AQI {compositeScore})</span>
            </div>
          </div>
        </div>

        {/* Center Channel Status (Clean header without temperature and humidity readings) */}
        <div className="hidden md:flex items-center gap-2 text-xs font-mono font-bold" style={{ color: isDarkMode ? '#94a3b8' : '#000000' }}>
          <span className={`w-2 h-2 rounded-full ${isPollingActive ? 'bg-emerald-500 glow-emerald' : 'bg-amber-500'}`} />
          <span className="font-bold" style={{ color: isDarkMode ? '#94a3b8' : '#000000' }}>
            {isPollingActive ? '5 Environmental Sensors Active' : 'Dashboard Paused'}
          </span>
        </div>

        {/* CONTROLS BAR: PROMINENT START / STOP BUTTON & ACTION CONTROLLERS */}
        <div className="flex items-center gap-2 shrink-0">
          
          {/* HIGH-VISIBILITY START / STOP OPTION */}
          <button
            onClick={handleToggleStartStop}
            title={isPollingActive ? 'Click to Stop live dashboard polling' : 'Click to Start live dashboard polling'}
            className={`px-3 py-1.5 text-xs font-black rounded-lg border flex items-center gap-1.5 transition-all shadow-xs cursor-pointer ${
              isPollingActive
                ? isDarkMode
                  ? 'bg-rose-500/15 hover:bg-rose-500/25 text-rose-300 border-rose-500/40'
                  : 'bg-rose-50 hover:bg-rose-100 text-rose-800 border-rose-300'
                : isDarkMode
                  ? 'bg-emerald-500 hover:bg-emerald-400 text-slate-950 border-emerald-400 font-black glow-emerald'
                  : 'bg-emerald-500 hover:bg-emerald-600 text-white border-emerald-600 font-black shadow-sm'
            }`}
          >
            {isPollingActive ? (
              <>
                <Square className="w-3.5 h-3.5 fill-current text-rose-500" />
                <span className="font-black">Stop Dashboard</span>
              </>
            ) : (
              <>
                <Play className="w-3.5 h-3.5 fill-current" />
                <span className="font-black">Start Dashboard</span>
              </>
            )}
          </button>

          {/* Polling Status indicator */}
          <div
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-mono border ${
              isPollingActive
                ? isDarkMode
                  ? 'bg-slate-900 border-slate-800'
                  : 'bg-white border-slate-300 text-black shadow-xs font-bold'
                : isDarkMode
                  ? 'bg-amber-500/10 border-amber-500/30 text-amber-300 font-bold'
                  : 'bg-amber-50 border-amber-300 text-black font-bold'
            }`}
          >
            <div
              className={`w-2 h-2 rounded-full ${
                !isPollingActive
                  ? 'bg-amber-500'
                  : syncStatus === 'connected'
                  ? 'bg-emerald-400 animate-pulse'
                  : syncStatus === 'mock'
                  ? 'bg-emerald-500'
                  : 'bg-amber-500 animate-pulse'
              }`}
            />
            <span
              className="hidden lg:inline font-sans text-xs font-black"
              style={{ color: isDarkMode ? (isPollingActive ? '#34d399' : '#f59e0b') : '#000000' }}
            >
              {!isPollingActive
                ? 'STOPPED'
                : syncStatus === 'connected'
                ? 'Render Live'
                : syncStatus === 'mock'
                ? 'Mock Mode'
                : 'Fallback'}
            </span>
            <span className="font-bold" style={{ color: isDarkMode ? '#cbd5e1' : '#000000' }}>
              {isPollingActive ? (
                <>Next: <strong className="font-black tabular-nums" style={{ color: isDarkMode ? '#34d399' : '#000000' }}>{countdown}s</strong></>
              ) : (
                <strong className="font-black" style={{ color: isDarkMode ? '#fbbf24' : '#000000' }}>PAUSED</strong>
              )}
            </span>
          </div>

          {/* Manual Refresh / Poll Now */}
          <button
            onClick={() => {
              setCountdown(5);
              fetchTelemetry();
            }}
            title="Poll now immediately"
            className={`p-1.5 rounded-lg border transition-colors cursor-pointer ${
              isDarkMode
                ? 'bg-slate-900 hover:bg-slate-800 border-slate-800 text-emerald-400'
                : 'bg-white hover:bg-slate-200 border-slate-300 text-black shadow-xs'
            }`}
          >
            <RefreshCw className="w-3.5 h-3.5" />
          </button>

          {/* API Config Modal Trigger */}
          <button
            onClick={() => setIsConfigOpen(true)}
            title="Configure Render API endpoint"
            className={`p-1.5 rounded-lg border transition-colors cursor-pointer ${
              isDarkMode
                ? 'bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 border-emerald-500/30'
                : 'bg-white hover:bg-slate-200 text-black border-slate-300 shadow-xs'
            }`}
          >
            <Settings className="w-3.5 h-3.5" />
          </button>


          {/* Dark / Light Mode Toggle */}
          <button
            onClick={() => setIsDarkMode(!isDarkMode)}
            aria-label="Toggle Night/Day Mode"
            title={isDarkMode ? 'Switch to Bright Mode' : 'Switch to Dark Mode'}
            className={`p-1.5 rounded-lg border transition-colors cursor-pointer ${
              isDarkMode
                ? 'bg-slate-900 hover:bg-slate-800 border-slate-800 text-emerald-400'
                : 'bg-white hover:bg-slate-200 border-slate-300 text-black shadow-xs'
            }`}
          >
            {isDarkMode ? <Sun className="w-3.5 h-3.5" /> : <Moon className="w-3.5 h-3.5" />}
          </button>
        </div>
      </header>

      {/* DASHBOARD SINGLE-VIEW CANVAS (ALL 5 READINGS VISIBLE IN ONE SCREEN) */}
      <main className="flex-1 min-h-0 p-2.5 sm:p-3 lg:p-4 flex flex-col gap-2.5 sm:gap-3 overflow-hidden">
        
        {/* ROW 1: THE 3 GAS GAUGES (CO2, CO, NO2) */}
        <section className="flex-1 min-h-0 flex flex-col">
          <div className="flex items-center justify-between pb-1 shrink-0">
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-emerald-500 glow-emerald" />
              {/* Sensor Block Heading: Pure Black font in bright mode */}
              <h2
                className="text-xs sm:text-sm font-black uppercase tracking-wider sensor-heading"
                style={{ color: isDarkMode ? '#ffffff' : '#000000' }}
              >
                Gas Concentration Gauges (Real-Time Sensors)
              </h2>
            </div>
            {/* Sensor Block Subheading: Pure Black font in bright mode */}
            <span
              className="text-[11px] font-mono hidden sm:inline font-black sensor-subheading"
              style={{ color: isDarkMode ? '#94a3b8' : '#000000' }}
            >
              5s Refresh · Half-Circle Dial Readout
            </span>
          </div>

          <div className="flex-1 min-h-0 grid grid-cols-1 md:grid-cols-3 gap-2.5 sm:gap-3">
            
            {/* GAUGE 1: CO2 */}
            <div
              className={`rounded-xl p-3 flex flex-col justify-between border transition-all duration-300 relative group overflow-hidden ${
                getSensorAlertLevel('co2', displayedReadings.co2) === 'danger'
                  ? isDarkMode
                    ? 'alert-pulse-danger bg-rose-950/20 border-rose-500/80 shadow-[0_0_25px_rgba(239,68,68,0.35)]'
                    : 'alert-pulse-danger bg-rose-50/70 border-rose-500 shadow-[0_0_20px_rgba(239,68,68,0.25)]'
                  : getSensorAlertLevel('co2', displayedReadings.co2) === 'warning'
                  ? isDarkMode
                    ? 'alert-pulse-warning bg-amber-950/20 border-amber-500/70 shadow-[0_0_20px_rgba(245,158,11,0.25)]'
                    : 'alert-pulse-warning bg-amber-50/70 border-amber-500 shadow-[0_0_18px_rgba(245,158,11,0.20)]'
                  : isDarkMode
                  ? 'bg-slate-900/90 border-emerald-500/20 hover:border-emerald-500/50 hover:shadow-[0_0_20px_rgba(16,185,129,0.18)]'
                  : 'bg-white border-slate-300 hover:shadow-md'
              }`}
            >
              <div className="flex items-center justify-between shrink-0">
                <div>
                  {/* Sensor Name Heading: Pure Black font in bright mode */}
                  <h3
                    className="font-black text-xs sm:text-sm sensor-name tracking-tight"
                    style={{ color: isDarkMode ? '#f8fafc' : '#000000' }}
                  >
                    CO₂ (Carbon Dioxide)
                  </h3>
                  {/* Sensor Subtitle Heading: Pure Black font in bright mode */}
                  <p
                    className="text-[10px] font-bold sensor-subheading"
                    style={{ color: isDarkMode ? '#94a3b8' : '#000000' }}
                  >
                    Indoor Ventilation
                  </p>
                </div>
                {/* Visual Alert Badge / Range Badge */}
                {getSensorAlertLevel('co2', displayedReadings.co2) === 'danger' ? (
                  <span
                    className={`text-[10px] font-mono px-2 py-0.5 rounded font-black border flex items-center gap-1.5 animate-pulse ${
                      isDarkMode
                        ? 'bg-rose-500/25 border-rose-500/60 text-rose-300'
                        : 'bg-rose-100 border-rose-400 text-rose-950'
                    }`}
                  >
                    <span className="w-1.5 h-1.5 rounded-full bg-rose-500 animate-ping" />
                    <span>⚠️ HAZARD (&gt;1500)</span>
                  </span>
                ) : getSensorAlertLevel('co2', displayedReadings.co2) === 'warning' ? (
                  <span
                    className={`text-[10px] font-mono px-2 py-0.5 rounded font-black border flex items-center gap-1.5 animate-pulse ${
                      isDarkMode
                        ? 'bg-amber-500/20 border-amber-500/60 text-amber-300'
                        : 'bg-amber-100 border-amber-400 text-amber-950'
                    }`}
                  >
                    <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
                    <span>⚠️ ALERT (&gt;1000)</span>
                  </span>
                ) : (
                  <span
                    className="text-[10px] font-mono px-2 py-0.5 rounded font-black border sensor-badge"
                    style={{
                      color: isDarkMode ? '#34d399' : '#000000',
                      backgroundColor: isDarkMode ? 'rgba(16, 185, 129, 0.15)' : '#f1f5f9',
                      borderColor: isDarkMode ? 'rgba(16, 185, 129, 0.3)' : '#94a3b8',
                    }}
                  >
                    0 - 2000 ppm
                  </span>
                )}
              </div>

              {/* Gauge Canvas Container */}
              <div className="flex-1 relative min-h-0 w-full flex items-center justify-center my-1">
                <canvas ref={canvasCO2Ref} className="max-h-full max-w-[220px]" />
                <div className="absolute inset-0 flex flex-col items-center justify-end pb-0.5 pointer-events-none">
                  {/* Gauge Value: Pure Black in bright mode with fluid number easing and alert highlight */}
                  <span
                    className={`text-2xl sm:text-3xl font-black font-mono tabular-nums tracking-tight sensor-value ${
                      getSensorAlertLevel('co2', displayedReadings.co2) === 'danger'
                        ? 'text-rose-600 dark:text-rose-400'
                        : getSensorAlertLevel('co2', displayedReadings.co2) === 'warning'
                        ? 'text-amber-600 dark:text-amber-400'
                        : isDarkMode
                        ? 'text-white'
                        : 'text-black'
                    }`}
                  >
                    {displayedReadings.co2}
                  </span>
                  <span
                    className="text-[10px] font-black uppercase tracking-wider"
                    style={{
                      color:
                        getSensorAlertLevel('co2', displayedReadings.co2) === 'danger'
                          ? '#ef4444'
                          : getSensorAlertLevel('co2', displayedReadings.co2) === 'warning'
                          ? '#f59e0b'
                          : isDarkMode
                          ? '#34d399'
                          : '#000000',
                    }}
                  >
                    ppm
                  </span>
                </div>
              </div>

              {/* Gauge Thresholds: Active threshold pill highlights */}
              <div
                className={`pt-1.5 border-t flex justify-between items-center text-[10px] font-mono shrink-0 ${
                  isDarkMode ? 'border-slate-800/80 text-slate-400' : 'border-slate-200 text-black font-bold'
                }`}
              >
                <span
                  className={`font-bold sensor-threshold transition-all px-1.5 py-0.5 rounded ${
                    getSensorAlertLevel('co2', displayedReadings.co2) === 'safe'
                      ? isDarkMode
                        ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/40 font-black'
                        : 'bg-emerald-50 text-black border border-emerald-300 font-black'
                      : 'opacity-65'
                  }`}
                  style={{ color: isDarkMode ? (getSensorAlertLevel('co2', displayedReadings.co2) === 'safe' ? '#34d399' : '#94a3b8') : '#000000' }}
                >
                  &lt;800 (Pure)
                </span>
                <span
                  className={`font-bold sensor-threshold transition-all px-1.5 py-0.5 rounded ${
                    getSensorAlertLevel('co2', displayedReadings.co2) === 'warning'
                      ? isDarkMode
                        ? 'bg-amber-500/25 text-amber-300 border border-amber-500/50 font-black animate-pulse'
                        : 'bg-amber-100 text-black border border-amber-400 font-black animate-pulse'
                      : 'opacity-65'
                  }`}
                  style={{ color: isDarkMode ? (getSensorAlertLevel('co2', displayedReadings.co2) === 'warning' ? '#fbbf24' : '#94a3b8') : '#000000' }}
                >
                  1000 - 1400
                </span>
                <span
                  className={`font-bold sensor-threshold transition-all px-1.5 py-0.5 rounded ${
                    getSensorAlertLevel('co2', displayedReadings.co2) === 'danger'
                      ? isDarkMode
                        ? 'bg-rose-500/25 text-rose-300 border border-rose-500/50 font-black animate-pulse'
                        : 'bg-rose-100 text-black border border-rose-400 font-black animate-pulse'
                      : 'opacity-65'
                  }`}
                  style={{ color: isDarkMode ? (getSensorAlertLevel('co2', displayedReadings.co2) === 'danger' ? '#f87171' : '#94a3b8') : '#000000' }}
                >
                  &gt;1500 (Drowsy)
                </span>
              </div>
            </div>

            {/* GAUGE 2: CO */}
            <div
              className={`rounded-xl p-3 flex flex-col justify-between border transition-all duration-300 relative group overflow-hidden ${
                getSensorAlertLevel('co', displayedReadings.co) === 'danger'
                  ? isDarkMode
                    ? 'alert-pulse-danger bg-rose-950/20 border-rose-500/80 shadow-[0_0_25px_rgba(239,68,68,0.35)]'
                    : 'alert-pulse-danger bg-rose-50/70 border-rose-500 shadow-[0_0_20px_rgba(239,68,68,0.25)]'
                  : getSensorAlertLevel('co', displayedReadings.co) === 'warning'
                  ? isDarkMode
                    ? 'alert-pulse-warning bg-amber-950/20 border-amber-500/70 shadow-[0_0_20px_rgba(245,158,11,0.25)]'
                    : 'alert-pulse-warning bg-amber-50/70 border-amber-500 shadow-[0_0_18px_rgba(245,158,11,0.20)]'
                  : isDarkMode
                  ? 'bg-slate-900/90 border-emerald-500/20 hover:border-emerald-500/50 hover:shadow-[0_0_20px_rgba(16,185,129,0.18)]'
                  : 'bg-white border-slate-300 hover:shadow-md'
              }`}
            >
              <div className="flex items-center justify-between shrink-0">
                <div>
                  {/* Sensor Name Heading: Pure Black font in bright mode */}
                  <h3
                    className="font-black text-xs sm:text-sm sensor-name tracking-tight"
                    style={{ color: isDarkMode ? '#f8fafc' : '#000000' }}
                  >
                    CO (Carbon Monoxide)
                  </h3>
                  {/* Sensor Subtitle Heading: Pure Black font in bright mode */}
                  <p
                    className="text-[10px] font-bold sensor-subheading"
                    style={{ color: isDarkMode ? '#94a3b8' : '#000000' }}
                  >
                    Combustion Safety
                  </p>
                </div>
                {/* Visual Alert Badge / Range Badge */}
                {getSensorAlertLevel('co', displayedReadings.co) === 'danger' ? (
                  <span
                    className={`text-[10px] font-mono px-2 py-0.5 rounded font-black border flex items-center gap-1.5 animate-pulse ${
                      isDarkMode
                        ? 'bg-rose-500/25 border-rose-500/60 text-rose-300'
                        : 'bg-rose-100 border-rose-400 text-rose-950'
                    }`}
                  >
                    <span className="w-1.5 h-1.5 rounded-full bg-rose-500 animate-ping" />
                    <span>⚠️ HAZARD (≥25)</span>
                  </span>
                ) : getSensorAlertLevel('co', displayedReadings.co) === 'warning' ? (
                  <span
                    className={`text-[10px] font-mono px-2 py-0.5 rounded font-black border flex items-center gap-1.5 animate-pulse ${
                      isDarkMode
                        ? 'bg-amber-500/20 border-amber-500/60 text-amber-300'
                        : 'bg-amber-100 border-amber-400 text-amber-950'
                    }`}
                  >
                    <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
                    <span>⚠️ ALERT (≥9.0)</span>
                  </span>
                ) : (
                  <span
                    className="text-[10px] font-mono px-2 py-0.5 rounded font-black border sensor-badge"
                    style={{
                      color: isDarkMode ? '#34d399' : '#000000',
                      backgroundColor: isDarkMode ? 'rgba(16, 185, 129, 0.15)' : '#f1f5f9',
                      borderColor: isDarkMode ? 'rgba(16, 185, 129, 0.3)' : '#94a3b8',
                    }}
                  >
                    0 - 50 ppm
                  </span>
                )}
              </div>

              {/* Gauge Canvas Container */}
              <div className="flex-1 relative min-h-0 w-full flex items-center justify-center my-1">
                <canvas ref={canvasCORef} className="max-h-full max-w-[220px]" />
                <div className="absolute inset-0 flex flex-col items-center justify-end pb-0.5 pointer-events-none">
                  {/* Gauge Value: Pure Black in bright mode with fluid number easing and alert highlight */}
                  <span
                    className={`text-2xl sm:text-3xl font-black font-mono tabular-nums tracking-tight sensor-value ${
                      getSensorAlertLevel('co', displayedReadings.co) === 'danger'
                        ? 'text-rose-600 dark:text-rose-400'
                        : getSensorAlertLevel('co', displayedReadings.co) === 'warning'
                        ? 'text-amber-600 dark:text-amber-400'
                        : isDarkMode
                        ? 'text-white'
                        : 'text-black'
                    }`}
                  >
                    {displayedReadings.co}
                  </span>
                  <span
                    className="text-[10px] font-black uppercase tracking-wider"
                    style={{
                      color:
                        getSensorAlertLevel('co', displayedReadings.co) === 'danger'
                          ? '#ef4444'
                          : getSensorAlertLevel('co', displayedReadings.co) === 'warning'
                          ? '#f59e0b'
                          : isDarkMode
                          ? '#34d399'
                          : '#000000',
                    }}
                  >
                    ppm
                  </span>
                </div>
              </div>

              {/* Gauge Thresholds: Active threshold pill highlights */}
              <div
                className={`pt-1.5 border-t flex justify-between items-center text-[10px] font-mono shrink-0 ${
                  isDarkMode ? 'border-slate-800/80 text-slate-400' : 'border-slate-200 text-black font-bold'
                }`}
              >
                <span
                  className={`font-bold sensor-threshold transition-all px-1.5 py-0.5 rounded ${
                    getSensorAlertLevel('co', displayedReadings.co) === 'safe'
                      ? isDarkMode
                        ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/40 font-black'
                        : 'bg-emerald-50 text-black border border-emerald-300 font-black'
                      : 'opacity-65'
                  }`}
                  style={{ color: isDarkMode ? (getSensorAlertLevel('co', displayedReadings.co) === 'safe' ? '#34d399' : '#94a3b8') : '#000000' }}
                >
                  &lt;9.0 (Safe)
                </span>
                <span
                  className={`font-bold sensor-threshold transition-all px-1.5 py-0.5 rounded ${
                    getSensorAlertLevel('co', displayedReadings.co) === 'warning'
                      ? isDarkMode
                        ? 'bg-amber-500/25 text-amber-300 border border-amber-500/50 font-black animate-pulse'
                        : 'bg-amber-100 text-black border border-amber-400 font-black animate-pulse'
                      : 'opacity-65'
                  }`}
                  style={{ color: isDarkMode ? (getSensorAlertLevel('co', displayedReadings.co) === 'warning' ? '#fbbf24' : '#94a3b8') : '#000000' }}
                >
                  10 - 25
                </span>
                <span
                  className={`font-bold sensor-threshold transition-all px-1.5 py-0.5 rounded ${
                    getSensorAlertLevel('co', displayedReadings.co) === 'danger'
                      ? isDarkMode
                        ? 'bg-rose-500/25 text-rose-300 border border-rose-500/50 font-black animate-pulse'
                        : 'bg-rose-100 text-black border border-rose-400 font-black animate-pulse'
                      : 'opacity-65'
                  }`}
                  style={{ color: isDarkMode ? (getSensorAlertLevel('co', displayedReadings.co) === 'danger' ? '#f87171' : '#94a3b8') : '#000000' }}
                >
                  &gt;25 (Hazard)
                </span>
              </div>
            </div>

            {/* GAUGE 3: NO2 */}
            <div
              className={`rounded-xl p-3 flex flex-col justify-between border transition-all duration-300 relative group overflow-hidden ${
                getSensorAlertLevel('no2', displayedReadings.no2) === 'danger'
                  ? isDarkMode
                    ? 'alert-pulse-danger bg-rose-950/20 border-rose-500/80 shadow-[0_0_25px_rgba(239,68,68,0.35)]'
                    : 'alert-pulse-danger bg-rose-50/70 border-rose-500 shadow-[0_0_20px_rgba(239,68,68,0.25)]'
                  : getSensorAlertLevel('no2', displayedReadings.no2) === 'warning'
                  ? isDarkMode
                    ? 'alert-pulse-warning bg-amber-950/20 border-amber-500/70 shadow-[0_0_20px_rgba(245,158,11,0.25)]'
                    : 'alert-pulse-warning bg-amber-50/70 border-amber-500 shadow-[0_0_18px_rgba(245,158,11,0.20)]'
                  : isDarkMode
                  ? 'bg-slate-900/90 border-emerald-500/20 hover:border-emerald-500/50 hover:shadow-[0_0_20px_rgba(16,185,129,0.18)]'
                  : 'bg-white border-slate-300 hover:shadow-md'
              }`}
            >
              <div className="flex items-center justify-between shrink-0">
                <div>
                  {/* Sensor Name Heading: Pure Black font in bright mode */}
                  <h3
                    className="font-black text-xs sm:text-sm sensor-name tracking-tight"
                    style={{ color: isDarkMode ? '#f8fafc' : '#000000' }}
                  >
                    NO₂ (Nitrogen Dioxide)
                  </h3>
                  {/* Sensor Subtitle Heading: Pure Black font in bright mode */}
                  <p
                    className="text-[10px] font-bold sensor-subheading"
                    style={{ color: isDarkMode ? '#94a3b8' : '#000000' }}
                  >
                    Traffic & Emission
                  </p>
                </div>
                {/* Visual Alert Badge / Range Badge */}
                {getSensorAlertLevel('no2', displayedReadings.no2) === 'danger' ? (
                  <span
                    className={`text-[10px] font-mono px-2 py-0.5 rounded font-black border flex items-center gap-1.5 animate-pulse ${
                      isDarkMode
                        ? 'bg-rose-500/25 border-rose-500/60 text-rose-300'
                        : 'bg-rose-100 border-rose-400 text-rose-950'
                    }`}
                  >
                    <span className="w-1.5 h-1.5 rounded-full bg-rose-500 animate-ping" />
                    <span>⚠️ HAZARD (&gt;100)</span>
                  </span>
                ) : getSensorAlertLevel('no2', displayedReadings.no2) === 'warning' ? (
                  <span
                    className={`text-[10px] font-mono px-2 py-0.5 rounded font-black border flex items-center gap-1.5 animate-pulse ${
                      isDarkMode
                        ? 'bg-amber-500/20 border-amber-500/60 text-amber-300'
                        : 'bg-amber-100 border-amber-400 text-amber-950'
                    }`}
                  >
                    <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
                    <span>⚠️ ALERT (≥54)</span>
                  </span>
                ) : (
                  <span
                    className="text-[10px] font-mono px-2 py-0.5 rounded font-black border sensor-badge"
                    style={{
                      color: isDarkMode ? '#34d399' : '#000000',
                      backgroundColor: isDarkMode ? 'rgba(16, 185, 129, 0.15)' : '#f1f5f9',
                      borderColor: isDarkMode ? 'rgba(16, 185, 129, 0.3)' : '#94a3b8',
                    }}
                  >
                    0 - 150 ppb
                  </span>
                )}
              </div>

              {/* Gauge Canvas Container */}
              <div className="flex-1 relative min-h-0 w-full flex items-center justify-center my-1">
                <canvas ref={canvasNO2Ref} className="max-h-full max-w-[220px]" />
                <div className="absolute inset-0 flex flex-col items-center justify-end pb-0.5 pointer-events-none">
                  {/* Gauge Value: Pure Black in bright mode with fluid number easing and alert highlight */}
                  <span
                    className={`text-2xl sm:text-3xl font-black font-mono tabular-nums tracking-tight sensor-value ${
                      getSensorAlertLevel('no2', displayedReadings.no2) === 'danger'
                        ? 'text-rose-600 dark:text-rose-400'
                        : getSensorAlertLevel('no2', displayedReadings.no2) === 'warning'
                        ? 'text-amber-600 dark:text-amber-400'
                        : isDarkMode
                        ? 'text-white'
                        : 'text-black'
                    }`}
                  >
                    {displayedReadings.no2}
                  </span>
                  <span
                    className="text-[10px] font-black uppercase tracking-wider"
                    style={{
                      color:
                        getSensorAlertLevel('no2', displayedReadings.no2) === 'danger'
                          ? '#ef4444'
                          : getSensorAlertLevel('no2', displayedReadings.no2) === 'warning'
                          ? '#f59e0b'
                          : isDarkMode
                          ? '#34d399'
                          : '#000000',
                    }}
                  >
                    ppb
                  </span>
                </div>
              </div>

              {/* Gauge Thresholds: Active threshold pill highlights */}
              <div
                className={`pt-1.5 border-t flex justify-between items-center text-[10px] font-mono shrink-0 ${
                  isDarkMode ? 'border-slate-800/80 text-slate-400' : 'border-slate-200 text-black font-bold'
                }`}
              >
                <span
                  className={`font-bold sensor-threshold transition-all px-1.5 py-0.5 rounded ${
                    getSensorAlertLevel('no2', displayedReadings.no2) === 'safe'
                      ? isDarkMode
                        ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/40 font-black'
                        : 'bg-emerald-50 text-black border border-emerald-300 font-black'
                      : 'opacity-65'
                  }`}
                  style={{ color: isDarkMode ? (getSensorAlertLevel('no2', displayedReadings.no2) === 'safe' ? '#34d399' : '#94a3b8') : '#000000' }}
                >
                  &lt;53 (Good)
                </span>
                <span
                  className={`font-bold sensor-threshold transition-all px-1.5 py-0.5 rounded ${
                    getSensorAlertLevel('no2', displayedReadings.no2) === 'warning'
                      ? isDarkMode
                        ? 'bg-amber-500/25 text-amber-300 border border-amber-500/50 font-black animate-pulse'
                        : 'bg-amber-100 text-black border border-amber-400 font-black animate-pulse'
                      : 'opacity-65'
                  }`}
                  style={{ color: isDarkMode ? (getSensorAlertLevel('no2', displayedReadings.no2) === 'warning' ? '#fbbf24' : '#94a3b8') : '#000000' }}
                >
                  54 - 100
                </span>
                <span
                  className={`font-bold sensor-threshold transition-all px-1.5 py-0.5 rounded ${
                    getSensorAlertLevel('no2', displayedReadings.no2) === 'danger'
                      ? isDarkMode
                        ? 'bg-rose-500/25 text-rose-300 border border-rose-500/50 font-black animate-pulse'
                        : 'bg-rose-100 text-black border border-rose-400 font-black animate-pulse'
                      : 'opacity-65'
                  }`}
                  style={{ color: isDarkMode ? (getSensorAlertLevel('no2', displayedReadings.no2) === 'danger' ? '#f87171' : '#94a3b8') : '#000000' }}
                >
                  &gt;100 (High)
                </span>
              </div>
            </div>

          </div>
        </section>

        {/* ROW 2: THE 2 LINE GRAPHS (TEMPERATURE & HUMIDITY) SIDE-BY-SIDE */}
        <section className="flex-1 min-h-0 flex flex-col">
          <div className="flex items-center justify-between pb-1 shrink-0">
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-emerald-500 glow-emerald" />
              {/* Sensor Block Heading: Pure Black font in bright mode */}
              <h2
                className="text-xs sm:text-sm font-black uppercase tracking-wider sensor-heading"
                style={{ color: isDarkMode ? '#ffffff' : '#000000' }}
              >
                Environmental Trend Graphs (20-Point Buffer)
              </h2>
            </div>
            {/* Sensor Block Subheading: Pure Black font in bright mode */}
            <span
              className="text-[11px] font-mono font-black hidden sm:inline sensor-subheading"
              style={{ color: isDarkMode ? '#34d399' : '#000000' }}
            >
              Bright Green Semi-Transparent Gradient Fill
            </span>
          </div>

          <div className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-2 gap-2.5 sm:gap-3">
            
            {/* LINE GRAPH 1: Temperature */}
            <div
              className={`rounded-xl p-3 flex flex-col border transition-all duration-300 overflow-hidden ${
                isDarkMode
                  ? 'bg-slate-900/90 border-emerald-500/20 hover:border-emerald-500/50 hover:shadow-[0_0_20px_rgba(16,185,129,0.18)]'
                  : 'bg-white border-slate-300 hover:shadow-md'
              }`}
            >
              <div className="flex items-center justify-between mb-1 shrink-0">
                <div className="flex items-center gap-2">
                  <div className="w-2.5 h-2.5 rounded-full bg-emerald-500 glow-emerald" />
                  {/* Sensor Name Heading: Pure Black font in bright mode */}
                  <span
                    className="font-black text-xs sm:text-sm sensor-name tracking-tight"
                    style={{ color: isDarkMode ? '#f8fafc' : '#000000' }}
                  >
                    Temperature (°C)
                  </span>
                </div>
                {/* Live Sensor Badge: Pure Black in bright mode */}
                <div
                  className="text-xs font-mono font-black border sensor-badge px-2 py-0.5 rounded"
                  style={{
                    color: isDarkMode ? '#34d399' : '#000000',
                    backgroundColor: isDarkMode ? 'rgba(16, 185, 129, 0.15)' : '#f1f5f9',
                    borderColor: isDarkMode ? 'rgba(16, 185, 129, 0.3)' : '#94a3b8',
                  }}
                >
                  Live: <strong className="tabular-nums font-black" style={{ color: isDarkMode ? '#34d399' : '#000000' }}>{Number(currentReadings.temperature).toFixed(2)}</strong> °C
                </div>
              </div>

              {/* Chart Canvas */}
              <div className="flex-1 relative w-full min-h-0">
                <canvas ref={canvasTempRef} />
              </div>
            </div>

            {/* LINE GRAPH 2: Humidity */}
            <div
              className={`rounded-xl p-3 flex flex-col border transition-all duration-300 overflow-hidden ${
                isDarkMode
                  ? 'bg-slate-900/90 border-emerald-500/20 hover:border-emerald-500/50 hover:shadow-[0_0_20px_rgba(16,185,129,0.18)]'
                  : 'bg-white border-slate-300 hover:shadow-md'
              }`}
            >
              <div className="flex items-center justify-between mb-1 shrink-0">
                <div className="flex items-center gap-2">
                  <div className="w-2.5 h-2.5 rounded-full bg-emerald-500 glow-emerald" />
                  {/* Sensor Name Heading: Pure Black font in bright mode */}
                  <span
                    className="font-black text-xs sm:text-sm sensor-name tracking-tight"
                    style={{ color: isDarkMode ? '#f8fafc' : '#000000' }}
                  >
                    Relative Humidity (%)
                  </span>
                </div>
                {/* Live Sensor Badge: Pure Black in bright mode */}
                <div
                  className="text-xs font-mono font-black border sensor-badge px-2 py-0.5 rounded"
                  style={{
                    color: isDarkMode ? '#34d399' : '#000000',
                    backgroundColor: isDarkMode ? 'rgba(16, 185, 129, 0.15)' : '#f1f5f9',
                    borderColor: isDarkMode ? 'rgba(16, 185, 129, 0.3)' : '#94a3b8',
                  }}
                >
                  Live: <strong className="tabular-nums font-black" style={{ color: isDarkMode ? '#34d399' : '#000000' }}>{Number(currentReadings.humidity).toFixed(2)}</strong> %
                </div>
              </div>

              {/* Chart Canvas */}
              <div className="flex-1 relative w-full min-h-0">
                <canvas ref={canvasHumidityRef} />
              </div>
            </div>

          </div>
        </section>

      </main>

      {/* RENDER API CONFIG MODAL */}
      {isConfigOpen && (
        <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4">
          <div
            className={`border rounded-2xl p-5 max-w-lg w-full shadow-2xl space-y-3.5 ${
              isDarkMode ? 'bg-slate-900 border-emerald-500/30' : 'bg-white border-slate-300 text-black'
            }`}
          >
            <div className={`flex items-center justify-between pb-2 border-b ${isDarkMode ? 'border-slate-800' : 'border-slate-200'}`}>
              <div className="flex items-center gap-2">
                <Settings className="w-4 h-4 text-emerald-500" />
                <h3 className="font-black text-sm text-black dark:text-emerald-400">
                  Render REST API Endpoint Settings
                </h3>
              </div>
              <button
                onClick={() => setIsConfigOpen(false)}
                className="text-slate-400 hover:text-black dark:hover:text-white p-1 cursor-pointer"
              >
                ✕
              </button>
            </div>

            <p className="text-xs dark:text-slate-300 text-black font-bold leading-relaxed">
              Connect to your live backend deployed on Render (connected to MongoDB Atlas).
            </p>

            <div>
              <label className="block text-xs font-black dark:text-slate-300 text-black mb-1">
                Render Endpoint URL
              </label>
              <input
                type="url"
                value={renderApiUrl}
                onChange={(e) => setRenderApiUrl(e.target.value)}
                placeholder="https://your-api.onrender.com/api/sensor-data"
                className={`w-full font-mono text-xs px-3 py-2 rounded-lg border focus:outline-none focus:border-emerald-500 font-bold ${
                  isDarkMode ? 'bg-slate-950 border-slate-800 text-white' : 'bg-slate-50 border-slate-300 text-black'
                }`}
              />
            </div>

            <div className="flex items-center justify-between gap-2">
              <label className="flex items-center gap-2 text-xs dark:text-slate-300 text-black font-bold cursor-pointer">
                <input
                  type="checkbox"
                  checked={forceMock}
                  onChange={(e) => setForceMock(e.target.checked)}
                  className="rounded bg-slate-950 border-slate-700 text-emerald-500 focus:ring-emerald-400"
                />
                <span className="text-black dark:text-slate-300 font-black">Force Mock Generator Mode</span>
              </label>

              <button
                onClick={handleTestPing}
                type="button"
                className="text-xs px-3 py-1.5 rounded-lg border border-slate-300 dark:border-emerald-500/30 bg-slate-100 dark:bg-emerald-500/10 hover:bg-slate-200 text-black dark:text-emerald-400 font-mono font-bold cursor-pointer"
              >
                Test Ping
              </button>
            </div>

            {testPingStatus && (
              <div className={`p-2 rounded-lg border text-xs font-mono font-bold ${
                isDarkMode ? 'bg-slate-950/80 border-slate-800 text-emerald-400' : 'bg-slate-50 border-slate-300 text-black'
              }`}>
                {testPingStatus}
              </div>
            )}

            {/* Visual Alert Testing Controls */}
            <div className={`p-2.5 rounded-lg border flex flex-col gap-2 ${
              isDarkMode ? 'bg-slate-950/80 border-slate-800' : 'bg-slate-50 border-slate-300'
            }`}>
              <div className="text-xs font-black text-black dark:text-emerald-400 flex items-center justify-between">
                <span>Simulate Sensor Alert Levels:</span>
                <span className="text-[10px] font-mono text-slate-500 dark:text-slate-400">Shake & Pulse Test</span>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => {
                    ingestReading({
                      temperature: 25.4,
                      humidity: 49.0,
                      co2: 1650,
                      co: 28.5,
                      no2: 112.0,
                      timestamp: new Date().toISOString(),
                    });
                    setIsConfigOpen(false);
                  }}
                  className="px-2.5 py-1.5 text-xs rounded-lg bg-rose-500 hover:bg-rose-600 text-white font-bold transition-all shadow-xs cursor-pointer flex items-center justify-center gap-1.5"
                >
                  <span>🚨 Hazard Spike</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    ingestReading({
                      temperature: 24.2,
                      humidity: 48.5,
                      co2: 1150,
                      co: 12.0,
                      no2: 68.0,
                      timestamp: new Date().toISOString(),
                    });
                    setIsConfigOpen(false);
                  }}
                  className="px-2.5 py-1.5 text-xs rounded-lg bg-amber-500 hover:bg-amber-600 text-white font-bold transition-all shadow-xs cursor-pointer flex items-center justify-center gap-1.5"
                >
                  <span>⚠️ Warning Spike</span>
                </button>
              </div>
              <button
                type="button"
                onClick={() => {
                  ingestReading({
                    temperature: 23.8,
                    humidity: 46.2,
                    co2: 560,
                    co: 1.6,
                    no2: 21.0,
                    timestamp: new Date().toISOString(),
                  });
                  setIsConfigOpen(false);
                }}
                className="w-full py-1 text-xs rounded-lg border border-emerald-500/40 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-500/10 font-bold transition-all cursor-pointer"
              >
                ✓ Reset to Safe Normal Readings
              </button>
            </div>

            <div className={`p-2.5 rounded-lg border font-mono text-[11px] ${
              isDarkMode ? 'bg-slate-950/80 border-slate-800 text-slate-400' : 'bg-slate-50 border-slate-300 text-black'
            }`}>
              <div className="text-black dark:text-emerald-400 font-black mb-1">
                Expected Backend JSON Response:
              </div>
              <pre className="dark:text-slate-300 text-black font-bold overflow-x-auto">{`{
  "temperature": 24.2,
  "humidity": 48.5,
  "co2": 560,
  "co": 1.6,
  "no2": 19.8,
  "timestamp": "${new Date().toISOString()}"
}`}</pre>
            </div>

            <div className="flex justify-end gap-2 pt-1">
              <button
                onClick={() => setIsConfigOpen(false)}
                className={`px-3.5 py-1.5 text-xs rounded-lg font-bold cursor-pointer ${
                  isDarkMode ? 'bg-slate-800 hover:bg-slate-700 text-slate-300' : 'bg-slate-200 hover:bg-slate-300 text-black'
                }`}
              >
                Close
              </button>
              <button
                onClick={() => {
                  setIsConfigOpen(false);
                  setCountdown(5);
                  fetchTelemetry();
                }}
                className="px-3.5 py-1.5 text-xs rounded-lg bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-black transition-colors cursor-pointer"
              >
                Apply & Refresh
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
