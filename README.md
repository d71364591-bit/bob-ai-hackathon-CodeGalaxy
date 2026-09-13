# 🚀 AI based Industry worker safety system 

> ⚠️ **Replace everything in `[ ]` brackets with your actual content before submission.**

---

## 👥 Team

| Field | Value |
|---|---|
| **Team Name** | CodeGalaxy |
| **Track** | [AI / DevOps / Sustainability / Open] |
| **Team Lead** | Dhiren Parekh — 25ec066@charusat.edu.in |
| **Members** | Dharmi Makadia, Pari Satasiya, Sej Paija |

---

## 🎯 Problem Statement

> In 2–3 sentences: What problem does your project solve? Who experiences this problem?

Industrial workers, especially those working in hazardous areas such as factories, construction sites, and chemical plants, face safety risks because supervisors often cannot know a worker’s real-time location, distance, or movement during emergencies. Existing solutions such as manual monitoring, CCTV, and GPS-based tracking can be costly, have limited indoor accuracy, or fail to provide reliable worker-level proximity information; therefore, a low-cost BLE-based system is needed to provide real-time worker tracking, distance estimation, and directional alerts to enable faster emergency response and improve workplace safety.



---

## 💡 Solution

> In 2–3 sentences: What did you build? How does it solve the problem above?

We built a low-cost BLE-based worker tracking system in which ESP32 worker tags continuously broadcast worker ID and status, while multiple ESP32 gateways measure RSSI and convert it into an estimated distance and direction, enabling real-time proximity monitoring without relying on GPS. The system uses multiple gateways instead of a single receiver to compare signal strength and determine the worker’s relative position, while filtering RSSI readings to reduce fluctuations; supervisors can view the worker’s location, distance, direction, and safety status through a live monitoring dashboard.


---

## ✨ Key Features

- **Feature 1:** Tracks workers using BLE-enabled ESP32 worker tags and a gateway
- **Feature 2:** Uses RSSI (Received Signal Strength Indicator) to estimate the distance between the worker and gateway in meters/centimeters.
- **Feature 3:** Displays worker information, status, RSSI, and estimated distance in real time through a web dashboard.
- **Feature 4:** Monitors worker status such as NORMAL and can be extended for warning/emergency conditions. Also monitors battery lavel
- **Feature 5:** Built around affordable ESP32 boards and can be expanded to support multiple workers.

---

## 🛠️ Tech Stack

| Category | Technologies |
|---|---|
| **Languages** | Python, C++, HTML, Javascript, CSS |
| **Frameworks** | Flask, Flask-SocketIO, Python serial library (pyserial) |
| **IBM Technologies** | watsonx.ai |
| **Other** | GitHub |

---

## 📁 Repository Structure

```
├── src/                  # All source code
├── docs/                 # Written documentation
│   ├── problem-statement.md
│   ├── solution-overview.md
│   ├── architecture.md
│   └── setup-guide.md
├── demo/                 # Demo artifacts
│   ├── screenshots/      # App screenshots
│   └── demo-video-link.txt  # Link to demo video
├── presentation/         # Slide deck
└── submission.yaml       # Structured submission metadata
```

---

## ⚡ How to Run

> **Copy these exact steps from your [`docs/setup-guide.md`](docs/setup-guide.md)**

```bash
# 1. Clone the repo
git clone https://github.com/[your-repo].git
cd [your-repo]

# 2. Install dependencies
[your install command here]

# 3. Configure environment
cp .env.example .env
# Edit .env with your values

# 4. Run the project
[your run command here]
```

---

## 🖥️ Demo

| Artifact | Link |
|---|---|
| 📹 Demo Video | [See demo/demo-video-link.txt](demo/demo-video-link.txt) |
| 🌐 Live Demo | [See demo/live-demo-url.txt](demo/live-demo-url.txt) |
| 🖼️ Screenshots | [See demo/screenshots/](demo/screenshots/) |
| 📊 Presentation | [See presentation/slides.pdf](presentation/) |

---

## ⚠️ Known Limitations

> Be honest — judges appreciate transparency over overclaiming.

- BLE is effective for small industrial areas but may have limited reliability and coverage in very large industrial facilities.
- Monitoring a large industrial facility with many workers and zones would require multiple gateways and a more robust network infrastructure.
- Real-time monitoring may be interrupted if the gateway, network, serial connection, or server experiences a failure.

---

## 🏅 What We're Most Proud Of

The real-time worker tracking and safety monitoring is the strongest part of the project. The combination of BLE-based worker identification, RSSI-based distance estimation, gateway processing, and a live dashboard demonstrates a practical end-to-end solution rather than just a theoretical concept. 

---
