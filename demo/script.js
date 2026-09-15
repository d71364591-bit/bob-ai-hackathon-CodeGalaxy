/*
=============================================================================
 AEGIS-SHIELD™ Industrial Worker Safety SCADA Dashboard Client Script
 Real-Time Socket.IO, SVG Floor Plan Trilateration, Chart.js & Web Audio API
=============================================================================
*/

console.log("[AEGIS-SHIELD] Initializing Command Center Client...");

// =====================================================
// GLOBAL STATE
// =====================================================
let socket = null;
const standaloneMode = window.location.protocol === "file:";
let standaloneTimer = null;
let currentEmergency = null;
let simulationMode = true;
let isMuted = false;
let showGrid = true;
let showRays = true;
let showRadar = true;

const workersState = {};
let recentEvents = [];
let selectedWorkerForChart = "W001";

// Chart.js instances
let rssiChart = null;
let zoneChart = null;
const maxChartPoints = 25;
const chartTimelineLabels = [];
const gw1Data = [];
const gw2Data = [];
const distData = [];

// Worker movement breadcrumbs: { W001: [[x,y], ...], ... }
const workerTrails = {};
const MAX_TRAIL_LENGTH = 12;

// =====================================================
// AUDIO SYNTHESIZER (WEB AUDIO API)
// =====================================================
let audioCtx = null;

function initAudio() {
    if (!audioCtx) {
        audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
}

function playBeep(freq = 660, duration = 0.15, type = "sine") {
    if (isMuted) return;
    try {
        initAudio();
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.type = type;
        osc.frequency.setValueAtTime(freq, audioCtx.currentTime);
        gain.gain.setValueAtTime(0.12, audioCtx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + duration);
        osc.connect(gain);
        gain.connect(audioCtx.destination);
        osc.start();
        osc.stop(audioCtx.currentTime + duration);
    } catch (e) {
        console.warn("Audio error:", e);
    }
}

function playSiren() {
    if (isMuted) return;
    try {
        initAudio();
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.type = "sawtooth";
        osc.frequency.setValueAtTime(800, audioCtx.currentTime);
        osc.frequency.linearRampToValueAtTime(1400, audioCtx.currentTime + 0.3);
        osc.frequency.linearRampToValueAtTime(800, audioCtx.currentTime + 0.6);
        gain.gain.setValueAtTime(0.15, audioCtx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.6);
        osc.connect(gain);
        gain.connect(audioCtx.destination);
        osc.start();
        osc.stop(audioCtx.currentTime + 0.6);
    } catch (e) {}
}

// =====================================================
// DOM READY & SOCKET.IO INITIALIZATION
// =====================================================
document.addEventListener("DOMContentLoaded", () => {
    // Chart.js is loaded from CDN when internet is available.
    // The rest of the standalone dashboard still works if it is unavailable.
    if (typeof Chart !== "undefined") initCharts();
    setupEventListeners();
    connectSocket();

    // Start clock in footer
    setInterval(() => {
        const d = new Date();
        document.getElementById("footerTimestamp").innerText =
            `CENTRAL NODE CLOCK: ${d.toLocaleDateString()} ${d.toLocaleTimeString()}`;
    }, 1000);
});

function connectSocket() {
    // Standalone file mode: no Flask/Socket.IO server is available.
    // Start the same visual demo locally in the browser instead.
    if (standaloneMode) {
        initializeStandaloneDemo();
        return;
    }

    const socketText = document.getElementById("socketStatusText");
    const socketPill = document.getElementById("socketStatusPill");

    socket = io();

    socket.on("connect", () => {
        console.log("[SOCKETIO] Connected to Server ID:", socket.id);
        socketText.innerText = "ONLINE (1000ms)";
        socketText.style.color = "#34d399";
    });

    socket.on("disconnect", () => {
        console.warn("[SOCKETIO] Disconnected from server.");
        socketText.innerText = "DISCONNECTED";
        socketText.style.color = "#f87171";
    });

    socket.on("init_state", (data) => {
        console.log("[SOCKETIO] Received full initial state:", data);
        simulationMode = data.simulation_mode;
        updateSimPillUI(simulationMode);
        updateSerialPillUI(data.serial_connected);

        if (data.workers) {
            data.workers.forEach((w) => {
                workersState[w.id] = w;
            });
            renderAllWorkers();
            renderWorkerTable();
            updateKPICards();
            updateZoneChart();
        }

        if (data.events) {
            recentEvents = data.events;
            renderEventLogs();
        }

        if (data.active_emergency) {
            setEmergencyUI(data.active_emergency);
        } else {
            clearEmergencyUI();
        }
    });

    socket.on("worker_update", (worker) => {
        handleWorkerUpdate(worker);
    });

    socket.on("system_status", (status) => {
        simulationMode = status.simulation_mode;
        updateSimPillUI(simulationMode);
        updateSerialPillUI(status.serial_connected, status.port);
    });

    socket.on("new_event", (event) => {
        recentEvents.unshift(event);
        if (recentEvents.length > 50) recentEvents.pop();
        renderEventLogs();

        if (event.severity === "DANGER" || event.severity === "EMERGENCY") {
            playSiren();
        } else if (event.severity === "WARNING") {
            playBeep(520, 0.2, "triangle");
        }
    });

    socket.on("emergency_alert", (emergency) => {
        setEmergencyUI(emergency);
        playSiren();
    });

    socket.on("clear_emergency", () => {
        clearEmergencyUI();
    });
}

// =====================================================
// WORKER TELEMETRY HANDLER
// =====================================================
function handleWorkerUpdate(worker) {
    const wid = worker.id;
    workersState[wid] = worker;

    // Record trail
    if (!workerTrails[wid]) workerTrails[wid] = [];
    workerTrails[wid].push([worker.x, worker.y]);
    if (workerTrails[wid].length > MAX_TRAIL_LENGTH) {
        workerTrails[wid].shift();
    }

    renderWorkerSVG(worker);
    renderTrailsSVG();
    renderTrilaterationRays(worker);
    renderWorkerTable();
    updateKPICards();
    updateZoneChart();

    // If this worker is selected in chart, feed telemetry
    if (wid === selectedWorkerForChart) {
        appendChartData(worker);
    }
}

// =====================================================
// SVG 2D FLOOR PLAN RENDERING
// =====================================================
function renderAllWorkers() {
    Object.values(workersState).forEach((worker) => {
        renderWorkerSVG(worker);
    });
}

function renderWorkerSVG(worker) {
    const container = document.getElementById("workersGroup");
    let group = document.getElementById(`svg-worker-${worker.id}`);

    if (!group) {
        group = document.createElementNS("http://www.w3.org/2000/svg", "g");
        group.setAttribute("id", `svg-worker-${worker.id}`);
        group.setAttribute("class", "worker-node");
        container.appendChild(group);

        // Click on worker to focus & select in chart
        group.addEventListener("click", () => {
            selectWorker(worker.id);
        });
    }

    const color = getStatusColor(worker.status);
    const auraColor = worker.status === "DANGER" || worker.status === "EMERGENCY" ?
        "rgba(239, 68, 68, 0.7)" : "rgba(16, 185, 129, 0.5)";

    group.innerHTML = `
        <!-- Beacon Radio Pulse Rings -->
        <circle cx="${worker.x}" cy="${worker.y}" r="16" fill="none" stroke="${auraColor}" class="worker-pulse" />
        
        <!-- Base Worker Badge -->
        <circle cx="${worker.x}" cy="${worker.y}" r="14" fill="#0f172a" stroke="${color}" stroke-width="3" />
        <circle cx="${worker.x}" cy="${worker.y}" r="6" fill="${color}" />

        <!-- Floating HUD Tag -->
        <g transform="translate(${worker.x + 18}, ${worker.y - 12})">
            <rect x="0" y="-14" width="95" height="36" rx="6" fill="rgba(15, 23, 42, 0.88)" stroke="${color}" stroke-width="1.2" />
            <text x="8" y="0" fill="#ffffff" font-size="11" font-weight="700">${worker.id}: ${worker.name.split(" ")[0]}</text>
            <text x="8" y="14" fill="#94a3b8" font-size="9" font-family="'JetBrains Mono', monospace">
                ${worker.d1 ? worker.d1 + "m" : "--"} | 🔋${worker.battery}%
            </text>
        </g>
    `;
}

function renderTrailsSVG() {
    const container = document.getElementById("workerTrailsGroup");
    container.innerHTML = "";

    Object.keys(workerTrails).forEach((wid) => {
        const trail = workerTrails[wid];
        if (trail.length < 2) return;

        const polyline = document.createElementNS("http://www.w3.org/2000/svg", "polyline");
        const pointsStr = trail.map((pt) => `${pt[0]},${pt[1]}`).join(" ");
        polyline.setAttribute("points", pointsStr);
        polyline.setAttribute("fill", "none");
        polyline.setAttribute("stroke", "rgba(56, 189, 248, 0.35)");
        polyline.setAttribute("stroke-width", "2");
        polyline.setAttribute("stroke-dasharray", "4,4");
        container.appendChild(polyline);
    });
}

function renderTrilaterationRays(worker) {
    const container = document.getElementById("trilaterationRaysGroup");
    if (!showRays) {
        container.innerHTML = "";
        return;
    }

    if (worker.id !== selectedWorkerForChart) return;

    // Gateway 1: (160, 480), Gateway 2: (840, 480)
    container.innerHTML = `
        <!-- Ray to Gateway 1 -->
        <line x1="160" y1="480" x2="${worker.x}" y2="${worker.y}" stroke="#38bdf8" stroke-width="1.5" class="worker-ray" />
        <rect x="${(160 + worker.x) / 2 - 25}" y="${(480 + worker.y) / 2 - 10}" width="50" height="18" rx="4" fill="rgba(15,23,42,0.8)" stroke="#38bdf8" stroke-width="1" />
        <text x="${(160 + worker.x) / 2}" y="${(480 + worker.y) / 2 + 3}" fill="#38bdf8" font-size="10" font-family="'JetBrains Mono', monospace" text-anchor="middle">
            ${worker.d1}m
        </text>

        <!-- Ray to Gateway 2 -->
        <line x1="840" y1="480" x2="${worker.x}" y2="${worker.y}" stroke="#38bdf8" stroke-width="1.5" class="worker-ray" />
        <rect x="${(840 + worker.x) / 2 - 25}" y="${(480 + worker.y) / 2 - 10}" width="50" height="18" rx="4" fill="rgba(15,23,42,0.8)" stroke="#38bdf8" stroke-width="1" />
        <text x="${(840 + worker.x) / 2}" y="${(480 + worker.y) / 2 + 3}" fill="#38bdf8" font-size="10" font-family="'JetBrains Mono', monospace" text-anchor="middle">
            ${worker.d2}m
        </text>
    `;
}

function getStatusColor(status) {
    switch (status) {
        case "SAFE": return "#10b981";
        case "CAUTION": return "#f59e0b";
        case "DANGER": return "#ef4444";
        case "EMERGENCY": return "#dc2626";
        default: return "#94a3b8";
    }
}

// =====================================================
// WORKER ROSTER TABLE
// =====================================================
function renderWorkerTable() {
    const tbody = document.getElementById("workerTableBody");
    tbody.innerHTML = "";

    Object.values(workersState).forEach((w) => {
        const tr = document.createElement("tr");

        const avatarClass = w.status === "EMERGENCY" ? "avatar-emergency" :
            (w.status === "DANGER" ? "avatar-danger" :
            (w.status === "CAUTION" ? "avatar-caution" : "avatar-safe"));

        const statusClass = `status-${w.status.toLowerCase()}`;

        const battFillClass = w.battery > 50 ? "battery-high" : (w.battery > 20 ? "battery-med" : "battery-low");

        tr.innerHTML = `
            <td>
                <div class="worker-cell">
                    <div class="worker-avatar ${avatarClass}">
                        ${w.id}
                    </div>
                    <div class="worker-name-group">
                        <strong>${w.name}</strong>
                        <small>ID: ${w.id}</small>
                    </div>
                </div>
            </td>
            <td>${w.role}</td>
            <td><strong>${w.current_zone}</strong></td>
            <td>
                <span style="font-family:'JetBrains Mono', monospace;">${w.gw1_rssi} dBm</span> 
                <small style="color:#64748b">(${w.d1}m)</small>
            </td>
            <td>
                <span style="font-family:'JetBrains Mono', monospace;">${w.gw2_rssi} dBm</span> 
                <small style="color:#64748b">(${w.d2}m)</small>
            </td>
            <td>
                <div class="battery-wrapper">
                    <div class="battery-bar">
                        <div class="battery-fill ${battFillClass}" style="width: ${w.battery}%"></div>
                    </div>
                    <span>${w.battery}%</span>
                </div>
            </td>
            <td>
                <span class="status-badge ${statusClass}">
                    <i class="fa-solid fa-circle" style="font-size: 6px;"></i> ${w.status}
                </span>
            </td>
            <td>
                <button class="btn btn-xs btn-danger" onclick="triggerWorkerSOS('${w.id}')" title="Trigger SOS Alert">
                    <i class="fa-solid fa-bell"></i> SOS
                </button>
            </td>
        `;
        tbody.appendChild(tr);
    });

    document.getElementById("rosterCountBadge").innerText = `${Object.keys(workersState).length} Active Tags`;
}

function triggerWorkerSOS(workerId) {
    if (standaloneMode) {
        const worker = workersState[workerId];
        if (!worker) return;
        worker.status = "DANGER";
        worker.zone_type = "DANGER";
        worker.risk_level = "CRITICAL";
        recentEvents.unshift({
            id: `DEMO-${Date.now()}`,
            timestamp: new Date().toLocaleTimeString(),
            severity: "DANGER",
            title: `MANUAL SOS: ${workerId}`,
            details: `${worker.name} triggered a local demonstration SOS alert.`,
            worker_id: workerId
        });
        renderEventLogs();
        handleWorkerUpdate(worker);
        playSiren();
        return;
    }
    if (socket) socket.emit("trigger_sos", { worker_id: workerId });
}

// =====================================================
// KPI CARDS & ANALYTICS UPDATE
// =====================================================
function updateKPICards() {
    const workers = Object.values(workersState);
    const total = workers.length;
    const safe = workers.filter((w) => w.status === "SAFE").length;
    const caution = workers.filter((w) => w.status === "CAUTION").length;
    const danger = workers.filter((w) => w.status === "DANGER" || w.status === "EMERGENCY").length;

    document.getElementById("kpiTotalWorkers").innerText = total;
    document.getElementById("kpiSafeWorkers").innerText = safe;
    document.getElementById("kpiCautionWorkers").innerText = caution;
    document.getElementById("kpiDangerWorkers").innerText = danger;

    const safePct = total > 0 ? Math.round((safe / total) * 100) : 100;
    document.getElementById("kpiSafePct").innerText = `${safePct}% Safe`;

    const hazardBadge = document.getElementById("kpiHazardBadge");
    if (danger > 0) {
        hazardBadge.className = "kpi-badge badge-danger";
        hazardBadge.innerText = `${danger} BREACH${danger > 1 ? "ES" : ""}`;
    } else {
        hazardBadge.className = "kpi-badge badge-success";
        hazardBadge.innerText = "Zero Breaches";
    }

    // Mean RSSI
    let sumRssi = 0;
    let countRssi = 0;
    workers.forEach((w) => {
        if (w.gw1_rssi) { sumRssi += w.gw1_rssi; countRssi++; }
        if (w.gw2_rssi) { sumRssi += w.gw2_rssi; countRssi++; }
    });
    const avgRssi = countRssi > 0 ? Math.round(sumRssi / countRssi) : -65;
    document.getElementById("kpiAvgRssi").innerHTML = `${avgRssi} <small>dBm</small>`;

    // Threat Level
    const threatElem = document.getElementById("kpiThreatLevel");
    const threatBadge = document.getElementById("kpiThreatBadge");

    if (currentEmergency) {
        threatElem.innerText = "EVACUATE";
        threatElem.style.color = "#ef4444";
        threatBadge.className = "kpi-badge badge-danger";
        threatBadge.innerText = "RED CODE EMERGENCY";
    } else if (danger > 0) {
        threatElem.innerText = "HIGH ALERT";
        threatElem.style.color = "#f97316";
        threatBadge.className = "kpi-badge badge-warning";
        threatBadge.innerText = "Zone Incursion Detected";
    } else if (caution > 0) {
        threatElem.innerText = "MODERATE";
        threatElem.style.color = "#eab308";
        threatBadge.className = "kpi-badge badge-warning";
        threatBadge.innerText = "Machinery Area Active";
    } else {
        threatElem.innerText = "NORMAL";
        threatElem.style.color = "#10b981";
        threatBadge.className = "kpi-badge badge-success";
        threatBadge.innerText = "Condition Green";
    }
}

// =====================================================
// CHART.JS TELEMETRY CHARTS
// =====================================================
function initCharts() {
    const rssiCtx = document.getElementById("rssiChart").getContext("2d");
    const zoneCtx = document.getElementById("zoneChart").getContext("2d");

    // Initialize labels
    for (let i = 20; i >= 0; i--) {
        chartTimelineLabels.push(`${i}s`);
        gw1Data.push(-65);
        gw2Data.push(-72);
        distData.push(2.5);
    }

    rssiChart = new Chart(rssiCtx, {
        type: "line",
        data: {
            labels: chartTimelineLabels,
            datasets: [
                {
                    label: "Gateway 1 RSSI (dBm)",
                    data: gw1Data,
                    borderColor: "#38bdf8",
                    backgroundColor: "rgba(56, 189, 248, 0.1)",
                    borderWidth: 2,
                    tension: 0.35,
                    pointRadius: 0,
                    yAxisID: "y"
                },
                {
                    label: "Gateway 2 RSSI (dBm)",
                    data: gw2Data,
                    borderColor: "#a855f7",
                    backgroundColor: "rgba(168, 85, 247, 0.1)",
                    borderWidth: 2,
                    tension: 0.35,
                    pointRadius: 0,
                    yAxisID: "y"
                },
                {
                    label: "Est. Distance (m)",
                    data: distData,
                    borderColor: "#10b981",
                    backgroundColor: "transparent",
                    borderWidth: 2,
                    borderDash: [5, 5],
                    tension: 0.35,
                    pointRadius: 0,
                    yAxisID: "y1"
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            animation: false,
            plugins: {
                legend: {
                    display: true,
                    labels: { color: "#94a3b8", font: { size: 10 } }
                }
            },
            scales: {
                x: {
                    grid: { color: "rgba(255,255,255,0.04)" },
                    ticks: { color: "#64748b", font: { size: 9 } }
                },
                y: {
                    type: "linear",
                    position: "left",
                    min: -95,
                    max: -45,
                    grid: { color: "rgba(255,255,255,0.05)" },
                    ticks: { color: "#38bdf8", font: { size: 9 }, stepSize: 10 }
                },
                y1: {
                    type: "linear",
                    position: "right",
                    min: 0,
                    max: 10,
                    grid: { drawOnChartArea: false },
                    ticks: { color: "#10b981", font: { size: 9 }, stepSize: 2 }
                }
            }
        }
    });

    zoneChart = new Chart(zoneCtx, {
        type: "doughnut",
        data: {
            labels: ["Safe Assembly", "Machinery Caution", "Hazard/Chemical Zone"],
            datasets: [
                {
                    data: [2, 1, 0],
                    backgroundColor: ["#10b981", "#f59e0b", "#ef4444"],
                    borderWidth: 0
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    position: "right",
                    labels: { color: "#94a3b8", font: { size: 11 }, padding: 12 }
                }
            },
            cutout: "68%"
        }
    });
}

function appendChartData(worker) {
    if (!rssiChart || typeof rssiChart.update !== "function") return;

    chartTimelineLabels.shift();
    chartTimelineLabels.push(new Date().toLocaleTimeString().split(" ")[0].slice(-5));

    gw1Data.shift();
    gw1Data.push(worker.gw1_rssi || -65);

    gw2Data.shift();
    gw2Data.push(worker.gw2_rssi || -70);

    distData.shift();
    distData.push(worker.d1 || 2.5);

    rssiChart.update();

    // Update sub stats
    document.getElementById("statGw1Rssi").innerText = `${worker.gw1_rssi} dBm`;
    document.getElementById("statGw2Rssi").innerText = `${worker.gw2_rssi} dBm`;
    document.getElementById("statDistance").innerText = `${worker.d1} m`;
}

function updateZoneChart() {
    if (!zoneChart) return;
    const workers = Object.values(workersState);
    const safe = workers.filter((w) => w.status === "SAFE").length;
    const caution = workers.filter((w) => w.status === "CAUTION").length;
    const danger = workers.filter((w) => w.status === "DANGER" || w.status === "EMERGENCY").length;

    zoneChart.data.datasets[0].data = [safe, caution, danger];
    zoneChart.update();
}

function selectWorker(wid) {
    selectedWorkerForChart = wid;
    document.getElementById("chartWorkerSelect").value = wid;
    const w = workersState[wid];
    if (w) {
        renderTrilaterationRays(w);
    }
}

// =====================================================
// INCIDENT & EVENT AUDIT LOG
// =====================================================
let currentFilter = "ALL";

function renderEventLogs() {
    const stream = document.getElementById("logStream");
    stream.innerHTML = "";

    const filtered = recentEvents.filter((ev) => {
        if (currentFilter === "ALL") return true;
        return ev.severity === currentFilter;
    });

    if (filtered.length === 0) {
        stream.innerHTML = `<div style="text-align:center;color:#64748b;padding:30px 0;">No matching event entries.</div>`;
        return;
    }

    filtered.forEach((ev) => {
        const item = document.createElement("div");
        item.className = `log-item log-${ev.severity.toLowerCase()}`;
        item.innerHTML = `
            <div class="log-meta">
                <span class="log-tag ${ev.severity.toLowerCase()}">${ev.severity}</span>
                <span>${ev.timestamp}</span>
            </div>
            <div class="log-body">
                <strong>${ev.title}</strong>
                <p>${ev.details}</p>
            </div>
        `;
        stream.appendChild(item);
    });
}

// =====================================================
// EMERGENCY SYSTEM UI
// =====================================================
let emergencyTimerInterval = null;
let emergencySeconds = 0;

function setEmergencyUI(emergency) {
    currentEmergency = emergency;
    const banner = document.getElementById("emergencyBanner");
    banner.classList.remove("hidden");

    document.getElementById("emergencyTitle").innerText = `CRITICAL ALERT: ${emergency.type}`;
    document.getElementById("emergencyDesc").innerText = emergency.reason;

    if (!emergencyTimerInterval) {
        emergencySeconds = 0;
        emergencyTimerInterval = setInterval(() => {
            emergencySeconds++;
            const mins = String(Math.floor(emergencySeconds / 60)).padStart(2, "0");
            const secs = String(emergencySeconds % 60).padStart(2, "0");
            document.getElementById("emergencyTimer").innerText = `${mins}:${secs}`;
        }, 1000);
    }

    updateKPICards();
}

function clearEmergencyUI() {
    currentEmergency = null;
    const banner = document.getElementById("emergencyBanner");
    banner.classList.add("hidden");

    if (emergencyTimerInterval) {
        clearInterval(emergencyTimerInterval);
        emergencyTimerInterval = null;
    }

    updateKPICards();
}

// =====================================================
// UI CONTROLS & EVENT LISTENERS
// =====================================================
function setupEventListeners() {
    // Mode Switcher (Sim vs Real)
    document.getElementById("simToggleBtn").addEventListener("click", () => {
        if (standaloneMode) {
            simulationMode = !simulationMode;
            updateSimPillUI(simulationMode);
            if (simulationMode) startStandaloneSimulation();
            else stopStandaloneSimulation();
            return;
        }
        fetch("/api/simulation/toggle", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ enable: !simulationMode })
        });
    });

    // Audio Mute Toggle
    const audioBtn = document.getElementById("audioToggleBtn");
    audioBtn.addEventListener("click", () => {
        isMuted = !isMuted;
        audioBtn.classList.toggle("muted", isMuted);
        document.getElementById("audioIcon").className = isMuted ? "fa-solid fa-volume-xmark" : "fa-solid fa-volume-high";
        document.getElementById("audioText").innerText = isMuted ? "SIREN: MUTED" : "SIREN: ARMED";
        if (!isMuted) playBeep(880, 0.1);
    });

    // Emergency Trigger Buttons
    document.getElementById("btnFireAlarm").addEventListener("click", () => {
        triggerEmergency("FIRE_OUTBREAK", "Thermal sensors and smoke alarms active. Immediate plant evacuation.");
    });

    document.getElementById("btnShortCircuit").addEventListener("click", () => {
        triggerEmergency("ELECTRICAL_SHORT_CIRCUIT", "Power grid transformer fault detected in High-Voltage substation.");
    });

    document.getElementById("btnEvacuation").addEventListener("click", () => {
        triggerEmergency("GENERAL_EVACUATION", "Command center broadcast general site evacuation protocol.");
    });

    document.getElementById("btnResetEmergency").addEventListener("click", () => {
        if (standaloneMode) { clearStandaloneEmergency(); return; }
        fetch("/api/emergency/clear", { method: "POST" });
    });

    document.getElementById("bannerDismissBtn").addEventListener("click", () => {
        if (standaloneMode) { clearStandaloneEmergency(); return; }
        fetch("/api/emergency/clear", { method: "POST" });
    });

    // Chart worker selector
    document.getElementById("chartWorkerSelect").addEventListener("change", (e) => {
        selectWorker(e.target.value);
    });

    // Map tools
    document.getElementById("toggleGridBtn").addEventListener("click", () => {
        showGrid = !showGrid;
        document.getElementById("gridOverlay").style.display = showGrid ? "block" : "none";
    });

    document.getElementById("toggleRaysBtn").addEventListener("click", () => {
        showRays = !showRays;
        const group = document.getElementById("trilaterationRaysGroup");
        group.style.display = showRays ? "block" : "none";
    });

    document.getElementById("toggleRadarBtn").addEventListener("click", () => {
        showRadar = !showRadar;
        document.getElementById("gatewayCoverageGroup").style.display = showRadar ? "block" : "none";
    });

    document.getElementById("resetZoomBtn").addEventListener("click", () => {
        const svg = document.getElementById("factoryFloor");
        svg.setAttribute("viewBox", "0 0 1000 600");
    });

    // Log filters
    document.querySelectorAll(".filter-pill").forEach((btn) => {
        btn.addEventListener("click", (e) => {
            document.querySelectorAll(".filter-pill").forEach((b) => b.classList.remove("active"));
            e.target.classList.add("active");
            currentFilter = e.target.getAttribute("data-filter");
            renderEventLogs();
        });
    });

    document.getElementById("clearLogsBtn").addEventListener("click", () => {
        recentEvents = [];
        renderEventLogs();
    });

    document.getElementById("exportLogsBtn").addEventListener("click", () => {
        const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(recentEvents, null, 2));
        const a = document.createElement("a");
        a.setAttribute("href", dataStr);
        a.setAttribute("download", `safety_audit_logs_${Date.now()}.json`);
        document.body.appendChild(a);
        a.click();
        a.remove();
    });
}

function triggerEmergency(type, reason) {
    if (standaloneMode) {
        currentEmergency = { type, reason, timestamp: new Date().toLocaleTimeString() };
        Object.values(workersState).forEach(w => w.status = "EMERGENCY");
        recentEvents.unshift({
            id: `DEMO-${Date.now()}`,
            timestamp: new Date().toLocaleTimeString(),
            severity: "EMERGENCY",
            title: `EMERGENCY BROADCAST: ${type}`,
            details: reason,
            worker_id: null
        });
        renderEventLogs();
        setEmergencyUI(currentEmergency);
        Object.values(workersState).forEach(w => handleWorkerUpdate(w));
        playSiren();
        return;
    }
    fetch("/api/emergency/trigger", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type, reason })
    });
}

function updateSimPillUI(isSim) {
    const text = document.getElementById("simModeText");
    text.innerText = isSim ? "SIMULATION (ACTIVE)" : "HARDWARE (COM3)";
    text.style.color = isSim ? "#f59e0b" : "#38bdf8";
}

function updateSerialPillUI(isConnected, port = "COM3") {
    const text = document.getElementById("serialStatusText");
    if (isConnected) {
        text.innerText = `ONLINE (${port})`;
        text.style.color = "#34d399";
    } else {
        text.innerText = `DISCONNECTED (${port})`;
        text.style.color = "#94a3b8";
    }
}


// =====================================================
// STANDALONE BROWSER DEMO ENGINE
// =====================================================
const standaloneInitialWorkers = {
    W001: { id:"W001", name:"Marcus Vance", role:"Plant Technician", x:350, y:430, gw1_rssi:-62, gw2_rssi:-76, d1:2.1, d2:4.8, battery:94, status:"SAFE", current_zone:"Main Assembly & Packaging", zone_type:"SAFE", risk_level:"LOW", last_seen:"--" },
    W002: { id:"W002", name:"Elena Rostova", role:"Robotics Specialist", x:500, y:220, gw1_rssi:-70, gw2_rssi:-69, d1:3.7, d2:3.6, battery:87, status:"CAUTION", current_zone:"Robotic Arc-Welding Cell", zone_type:"CAUTION", risk_level:"MODERATE", last_seen:"--" },
    W003: { id:"W003", name:"David Chen", role:"Safety Inspector", x:750, y:140, gw1_rssi:-85, gw2_rssi:-61, d1:7.2, d2:2.0, battery:64, status:"DANGER", current_zone:"Toxic Chemical Storage", zone_type:"DANGER", risk_level:"CRITICAL", last_seen:"--" }
};
const standalonePaths = {
    W001:[[250,440],[450,430],[650,450],[400,480],[300,420]],
    W002:[[480,250],[400,200],[550,180],[500,300],[420,220]],
    W003:[[750,140],[820,100],[880,180],[710,200],[640,320],[550,420]]
};
const standalonePathIndex = {W001:0,W002:0,W003:0};

function standaloneZone(x,y){
    if(x>=680&&x<=960&&y>=40&&y<=260) return ["Toxic Chemical Storage","DANGER","CRITICAL"];
    if(x>=40&&x<=320&&y>=40&&y<=260) return ["High Voltage Substation","DANGER","CRITICAL"];
    if(x>=370&&x<=630&&y>=120&&y<=320) return ["Robotic Arc-Welding Cell","CAUTION","MODERATE"];
    if(x>=200&&x<=800&&y>=380&&y<=560) return ["Main Assembly & Packaging","SAFE","LOW"];
    if(x>=40&&x<=160&&y>=380&&y<=560) return ["Emergency Muster Point","SAFE","SAFE"];
    return ["Neutral Factory Corridor","SAFE","LOW"];
}

function standaloneDistance(x,y,gx,gy){ return Math.max(0.2, Math.hypot(x-gx,y-gy)/70); }
function standaloneRssi(distance){ return -59 - (10*2.4*Math.log10(Math.max(.2,distance))) + (Math.random()*3-1.5); }

function initializeStandaloneDemo(){
    simulationMode = true;
    updateSimPillUI(true);
    updateSerialPillUI(false,"DEMO");
    const socketText=document.getElementById("socketStatusText");
    socketText.innerText="LOCAL DEMO"; socketText.style.color="#34d399";
    Object.keys(standaloneInitialWorkers).forEach(id=>{ workersState[id]={...standaloneInitialWorkers[id]}; });
    recentEvents = [{id:"DEMO-001",timestamp:new Date().toLocaleTimeString(),severity:"INFO",title:"Standalone Demo Initialized",details:"Browser-only simulation is active. No ESP32 or Flask server is required.",worker_id:null}];
    renderAllWorkers(); renderWorkerTable(); updateKPICards(); updateZoneChart(); renderEventLogs();
    Object.values(workersState).forEach(w=>appendChartData(w));
    const sel=document.getElementById("chartWorkerSelect");
    if(sel) sel.value=selectedWorkerForChart;
    startStandaloneSimulation();
}

function startStandaloneSimulation(){
    stopStandaloneSimulation();
    standaloneTimer=setInterval(()=>{
        if(!standaloneMode || !simulationMode) return;
        Object.values(workersState).forEach(worker=>{
            const path=standalonePaths[worker.id]||[[400,400]];
            let idx=standalonePathIndex[worker.id]||0;
            const [tx,ty]=path[idx];
            const dx=tx-worker.x, dy=ty-worker.y, dist=Math.hypot(dx,dy);
            if(dist<20){ idx=(idx+1)%path.length; standalonePathIndex[worker.id]=idx; }
            else { const speed=8+Math.random()*6; worker.x += dx/dist*speed+(Math.random()*4-2); worker.y += dy/dist*speed+(Math.random()*4-2); }
            worker.x=Math.max(50,Math.min(950,worker.x)); worker.y=Math.max(50,Math.min(550,worker.y));
            const d1=standaloneDistance(worker.x,worker.y,160,480);
            const d2=standaloneDistance(worker.x,worker.y,840,480);
            worker.d1=+d1.toFixed(2); worker.d2=+d2.toFixed(2);
            worker.gw1_rssi=+standaloneRssi(d1).toFixed(1); worker.gw2_rssi=+standaloneRssi(d2).toFixed(1);
            worker.battery=Math.max(15,worker.battery-(Math.random()<.04?1:0));
            const [zone,type,risk]=standaloneZone(worker.x,worker.y);
            worker.current_zone=zone; worker.zone_type=type; worker.risk_level=risk;
            worker.status=currentEmergency?"EMERGENCY":type==="DANGER"?"DANGER":type==="CAUTION"?"CAUTION":"SAFE";
            worker.last_seen=new Date().toLocaleTimeString();
            handleWorkerUpdate({...worker});
        });
    },1000);
}
function stopStandaloneSimulation(){ if(standaloneTimer){clearInterval(standaloneTimer); standaloneTimer=null;} }
function clearStandaloneEmergency(){
    currentEmergency=null; clearEmergencyUI();
    Object.values(workersState).forEach(w=>{ const z=standaloneZone(w.x,w.y); w.status=z[1]==="DANGER"?"DANGER":z[1]==="CAUTION"?"CAUTION":"SAFE"; handleWorkerUpdate({...w}); });
    recentEvents.unshift({id:`DEMO-${Date.now()}`,timestamp:new Date().toLocaleTimeString(),severity:"INFO",title:"Emergency Protocol Cleared",details:"Standalone demonstration returned to normal monitoring.",worker_id:null});
    renderEventLogs();
}
