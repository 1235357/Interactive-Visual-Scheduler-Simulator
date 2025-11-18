
# [Interactive Visual Scheduler Simulator](https://1235357.github.io/Interactive-Visual-Scheduler-Simulator/)

> CPS 3250 – Operating Systems Final Project  
> Kean University · Department of Computer Science  
> Instructor: Dr. Hamza Djigal

An interactive, teaching‑oriented CPU scheduling simulator with rich visualizations and animations.  

---

## 🎯 Project Overview

This project is a web-based **Process Scheduling Simulator** designed for the course **CPS 3250: Operating Systems**. It visualizes classic CPU scheduling algorithms in real time, with:

- Animated **Gantt charts**
- Live **CPU / ready-queue views**
- Step-by-step **decision explanations**
- Automatic **algorithm comparison**
- A **HEFT / Cloud** tab for DAG scheduling on multiple virtual machines

The entire app is implemented as a static website (HTML + CSS + JavaScript), making it easy to deploy on **GitHub Pages** (`*.github.io`). All state is stored on the client side (via `localStorage`), so the simulator works without any backend server.

In the GitHub repository, the deployable version of the app lives under the `/docs` folder, so that GitHub Pages can serve `docs/index.html` directly.

https://1235357.github.io/Interactive-Visual-Scheduler-Simulator

---

## ✨ Key Features

- **Six CPU scheduling algorithms** with full visual explanation:
  - FCFS / First-Come, First-Served
  - SJF / Shortest Job First (non-preemptive)
  - SRTF / Shortest Remaining Time First (preemptive SJF)
  - Preemptive Priority Scheduling
  - HRRN / Highest Response Ratio Next
  - RR / Round Robin (configurable quantum)
- **Rich visualizations**
  - Dynamic **Gantt chart** with color-coded process segments
  - Live **CPU** status (running / idle) and animated **ready queue**
  - Per-step **decision log** and **natural-language explanation**
  - Detailed metrics table and **summary statistics**
- **Teaching Mode**
  - One-click teaching mode that guides through:
    1. Single algorithm execution with detailed explanations  
    2. Cross-algorithm comparison  
    3. HEFT / cloud scheduling example
  - Designed for **classroom demos** and **self-study**
- **Comparison Tab**
  - Run all algorithms on the same process set
  - See Gantt charts and metrics side-by-side
  - Supports fairness / performance discussions (e.g., waiting time vs response time)
- **HEFT / Cloud Tab**
  - Implements a simplified **HEFT (Heterogeneous Earliest Finish Time)** scheduler
  - Static DAG of tasks mapped onto heterogeneous VMs (different speeds, communication costs)
  - Visual multi-processor Gantt timelines and step-by-step HEFT decisions
- **State persistence**
  - Uses `localStorage` (key: `scheduler_simulator_v2`) to remember:
    - Process list
    - Selected algorithm & quantum
    - Some UI preferences
  - This means **data survives page refresh** (better than purely temporary state), while still being fully GitHub Pages–friendly.

---

## 🎨 Visual Animations & Teaching Design

The simulator is intentionally designed to look and feel like a modern teaching tool rather than a plain table of numbers. A few highlights:

- **CPU pulse animation** – when the CPU is running a process, the CPU panel gently pulses to emphasize that the core is busy; when idle, it calms down and shows an "Idle" badge.
- **Sliding ready‑queue chips** – each ready process is rendered as a colored “chip” that slides into the queue, showing the evolution of the ready set over time.
- **Gantt bar transitions** – each segment in the Gantt chart fades/expands into place, with the currently executing segment highlighted so students can easily track the CPU decision.
- **Subtle hover effects** – hovering over bars and chips reveals extra context (time ranges, process identity), reinforcing the mapping between text and visualization.
- **HEFT highlighting** – in the HEFT/Cloud tab, the current task being explained is highlighted on the multi‑VM timeline so the text explanation and animation are linked.

All animations are implemented purely with **CSS keyframes and transitions** in `style_new.css`, with class names like `fadeIn`, `cpuPulse`, `ganttAppear`, and `ganttPulse`. There is no heavy JS animation library, which keeps the site lightweight and GitHub Pages‑friendly.

---

## 🧮 Implemented Algorithms

All algorithms are implemented in plain JavaScript in `script_new.js` and are used for both simulation and comparison:

- **FCFS (First-Come, First-Served)**
  - Non-preemptive, processes dispatched in arrival order.
- **SJF (Shortest Job First)**
  - Non-preemptive, always picks the ready process with the smallest burst time.
- **SRTF (Shortest Remaining Time First)**
  - Preemptive SJF, re-evaluated at each time unit.
- **Preemptive Priority Scheduling**
  - Smaller numerical priority = higher priority; higher-priority processes can preempt lower ones.
- **HRRN (Highest Response Ratio Next)**
  - Non-preemptive, uses response ratio  
    $RR = \dfrac{\text{Waiting} + \text{Burst}}{\text{Burst}}$  
    to balance short and long processes.
- **RR (Round Robin)**
  - Preemptive, configurable time quantum, circular ready queue.

For each algorithm the simulator computes per-process metrics such as:

- Waiting time  
- Turnaround time  
- Response time  

and aggregates them into useful averages for comparison.

---

## 🖥️ User Interface & Tabs

The main UI is defined in `docs/index.html` (for deployment) and styled with `docs/style_new.css`. It is organized into four main tabs:

### 1. Setup Tab

- **Add Processes**
  - Input fields: **Name**, **Arrival Time**, **Burst Time**, **Priority**
  - Validation for missing / invalid values
- **Example Workloads**
  - Buttons to quickly load:
    - Basic Example
    - CPU-Heavy Example
    - Bursty Arrivals Example
    - Priority Example
- **Process List**
  - A responsive table listing all processes
  - Badge showing number of processes
  - Friendly empty state message when there are no processes
- **Algorithm Selection**
  - Modern cards for the six CPU scheduling algorithms
  - Detailed **description card** for the selected algorithm
  - Time quantum input shown when **Round Robin** is selected

### 2. Simulate Tab

- **Simulation Controls**
  - Play / Pause / Step / Reset buttons
  - Adjustable **animation speed**
  - Status indicator (Ready / Running / Paused) and current time
- **CPU & Ready Queue View**
  - Large “CPU” box showing current process (or Idle)
  - Animated ready queue with color-coded process chips
- **Dynamic Gantt Chart**
  - Horizontal timeline showing colored segments per process
  - Zoom controls for the Gantt chart
- **Explanation & Decision Log**
  - For each time step:
    - A natural-language explanation of **why** the scheduler chose that process
    - A scrollable decision log listing all steps
- **Metrics**
  - Per-process metrics table
  - Summary box with average waiting / turnaround / response times

### 3. Compare Tab

- **Run Comparison** with one click:
  - Re-runs all algorithms on the same process set
  - Displays static Gantt charts per algorithm
  - Comparison table with key metrics (average waiting/turnaround/response, etc.)
- Ideal for **reports, posters, and in-class discussions**.

### 4. HEFT / Cloud Tab

- **HEFT Example**
  - Built-in sample DAG with tasks `T1…T6`
  - Three processors (VMs) with different speeds
  - Configurable communication cost
- **Custom DAG Input**
  - Text area for specifying your own DAG and VM characteristics (parsed by `parseHeftDagInput()`)
- **HEFT Timeline**
  - Separate rows for each VM with colored task segments
  - Visual representation of communication and scheduling decisions
- **Step-by-step HEFT Explanation**
  - Explanation panel and decision log similar to the CPU scheduling simulation
- Serves as a bridge between **OS scheduling** and **cloud/distributed systems** scheduling.

---

## 🎓 Teaching Mode

At the top navigation bar there is a **“Teaching Mode”** button that:

1. Locks / adapts some controls to ensure a smooth demonstration flow.  
2. Automatically walks through:
   - CPU scheduling animations for the selected algorithms  
   - The comparison tab  
   - The HEFT / Cloud tab  
3. Controls playback to keep the explanation **pedagogical and not too fast**.

This mode is intended for **lectures, tutorials, and live demos**.

---

## 🧱 Project Structure

In this repository, the main files are:

- `docs/index.html` – Main HTML entry point and layout for all tabs (served by GitHub Pages).
- `docs/style_new.css` – Design system, layout, animations, and all visual styles.
- `docs/script_new.js` – All simulator logic:
  - Data model for processes
  - CPU scheduling algorithms
  - Simulation step builder and explanation generator
  - DOM rendering for Gantt, CPU/queue, logs, metrics
  - HEFT algorithm and cloud scheduling view
  - Teaching mode behavior
- `README.md` – (This file) project description and usage guide.

If you want to keep a local development copy outside of `/docs`, you can still use `index_new.html`, `style_new.css`, and `script_new.js` at the project root, but the version used by GitHub Pages is the one under `/docs`.

---

## 🚀 Running Locally

Because this is a pure front-end project, you can run it locally without any backend.

1. **Clone the repository**

   ```powershell
   git clone https://github.com/1235357/Interactive-Visual-Scheduler-Simulator.github.io.git
   cd Interactive-Visual-Scheduler-Simulator.github.io
   ```

2. **Open the simulator**

- Option A: Open `docs/index.html` directly in your browser.
- Option B (recommended): Serve via a simple static server, for example:

  ```powershell
  # if you have Node.js
  npx serve .
  ```

   Then open the printed local URL (e.g., `http://localhost:3000`) in your browser.

---

## 🌐 Deploying to GitHub Pages

This project is designed to satisfy the requirement: **“can be deployed as a static website on GitHub Pages, storing only temporary data on the client”**, with the bonus that part of the data persists via `localStorage`.

To deploy:

1. Push all project files (including the `/docs` folder) to this repository.

2. In the GitHub repo:

   - Go to **Settings → Pages**.
   - Under **Source**, select “Deploy from a branch”.
   - Choose the `main` branch and the `/docs` folder.

3. After GitHub finishes building, GitHub Pages will serve `docs/index.html` as the site entry point. Your simulator will be available at:

   ```text
   https://1235357.github.io/Interactive-Visual-Scheduler-Simulator.github.io/
   ```

(If the URL or branch name changes, update this section accordingly.)

---

## 📊 Course & Evaluation Notes

This simulator supports the CPS 3250 project objectives:

- **Apply OS scheduling principles** in practical, visual scenarios.
- **Analyze and compare** different strategies using real metrics (waiting, turnaround, response time).
- **Connect to cloud/distributed systems** via the HEFT / Cloud tab, modeling heterogeneous VMs and DAG tasks.
- **Communicate technical results** effectively via:
  - Live demo
  - Algorithm comparison views
  - Clear step-by-step explanations suitable for presentations and posters.

---

## 🔮 Possible Future Work

Some potential extensions:

- Add **real-time scheduling** algorithms (e.g., RM, EDF).
- Model **I/O-bound** processes and blocking / wake-up behavior.
- Add **energy-aware** scheduling metrics.
- Import / export workloads as JSON for reproducible experiments.
- Support multi-core CPU scheduling beyond single-core + HEFT cloud model.

---

## 🙏 Acknowledgements

- **Course**: CPS 3250 – Principles of Operating Systems  
- **Institution**: Wenzhou-Kean University  
- **Instructor**: Dr. Hamza Djigal  
- **Tools**: This project was designed to be easily hosted on **GitHub Pages** and to run in any modern browser without additional setup.

