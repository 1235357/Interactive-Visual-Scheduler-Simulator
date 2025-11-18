// Process Scheduling Simulator - New UI Logic (index_new.html)
// CPS 3250 Final Project - All English, teaching-focused visualizations

// =============================
// Basic data model & global state
// =============================

class Process {
	constructor(name, arrival, burst, priority = 0) {
		this.name = name || "";
		this.arrival = parseInt(arrival, 10);
		this.burst = parseInt(burst, 10);
		this.priority = parseInt(priority, 10);

		if (!Number.isFinite(this.arrival) || this.arrival < 0) this.arrival = 0;
		if (!Number.isFinite(this.burst) || this.burst <= 0) this.burst = 1;
		if (!Number.isFinite(this.priority)) this.priority = 0;

		this.startTime = null;
		this.finishTime = null;
		this.responseTime = null;
		this.remaining = null;
		this.RR = null;
	}
}

// Global process list used by the Setup / Simulate / Compare tabs
let processes = [];
let autoProcessCount = 1; // for auto-generated names P1, P2, ...

// Simulation playback state
let simulation = null;
let currentStepIndex = 0;
let isPlaying = false;
let playTimer = null;
let playSpeed = 1;
// Track whether the latest step advance was triggered by the user
// clicking the Step button (as opposed to automatic playback).
let lastStepUserInitiated = false;

// Main CPU Gantt scale & auto-fit flag
let ganttScale = 24; // pixels per time unit (approximate)
let autoFitGantt = true;

// Teaching mode sequence
const TEACHING_ALGOS = ["fcfs", "sjf", "srtf", "priority", "hrrn", "rr"];
// Per-algorithm teaching pace multipliers (for CPU stage). Values are
// applied on top of the base 7s per step so that more complex
// algorithms (e.g., HRRN, RR) have a bit more time per step.
const TEACHING_ALGO_PACE = {
	fcfs: 1.0,
	sjf: 1.0,
	srtf: 1.2,
	priority: 1.1,
	hrrn: 1.5,
	rr: 1.2
};
// Per-step teaching pace for HEFT teaching (HEFT tab). Rank steps use the
// base rhythm; schedule steps get a bit more time so EFT comparisons are
// easier to follow.
const HEFT_TEACHING_PACE = {
	rank: 1.0,
	schedule: 1.2
};
let isTeachingMode = false;
let teachingAlgoIndex = 0;
let teachingOriginalSpeed = 1;
let teachingStage = null; // "cpu" | "compare" | "heft" | null

// HEFT teaching & simulation state
let heftSimulation = null; // { result, steps }
let heftStepIndex = 0;
let heftTeachingIndex = 0;
let heftTeachingTimer = null;
// Teaching focus timer for guiding the user's attention (CPU → Gantt/Explanation)
let teachingFocusTimer = null;

// =============================
// Colors for processes/tasks
// =============================

const PROCESS_COLORS = [
	"#60a5fa", "#f87171", "#34d399", "#fbbf24",
	"#a78bfa", "#f97316", "#2dd4bf", "#facc15",
	"#fb7185", "#22c55e"
];

const processColorCache = {};

function getColorForProcess(name) {
	if (!name) return "#9ca3af";
	if (processColorCache[name]) return processColorCache[name];
	const index = Object.keys(processColorCache).length % PROCESS_COLORS.length;
	const color = PROCESS_COLORS[index];
	processColorCache[name] = color;
	return color;
}

// =============================
// Persistent configuration (localStorage)
// =============================

const STORAGE_KEY = "scheduler-simulator-config-v1";

function saveUserConfig() {
	try {
		const algoInput = document.querySelector("input[name='algo']:checked");
		const algo = algoInput ? algoInput.value : null;
		const qInput = document.getElementById("quantum");
		const quantum = qInput ? parseInt(qInput.value, 10) || null : null;

		const data = {
			processes: processes.map(p => ({
				name: p.name,
				arrival: p.arrival,
				burst: p.burst,
				priority: p.priority
			})),
			algo,
			quantum
		};
		if (typeof window !== "undefined" && window.localStorage) {
			window.localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
		}
	} catch (err) {
		console.warn("Failed to save scheduler config", err);
	}
}

function loadUserConfig() {
	let raw = null;
	try {
		if (typeof window !== "undefined" && window.localStorage) {
			raw = window.localStorage.getItem(STORAGE_KEY);
		}
	} catch (err) {
		console.warn("Failed to read scheduler config", err);
	}
	if (!raw) {
		updateProcessTable();
		return;
	}

	let data;
	try {
		data = JSON.parse(raw);
	} catch (err) {
		console.warn("Invalid scheduler config JSON", err);
		updateProcessTable();
		return;
	}

	processes = Array.isArray(data.processes)
		? data.processes.map(p => new Process(p.name, p.arrival, p.burst, p.priority))
		: [];

	// Rebuild autoProcessCount based on existing names (P1, P2, ...)
	if (!processes.length) {
		autoProcessCount = 1;
	} else {
		const maxNum = processes.reduce((max, p) => {
			const m = p.name && /^P(\d+)$/.exec(p.name);
			return m ? Math.max(max, parseInt(m[1], 10)) : max;
		}, 0);
		autoProcessCount = Math.max(maxNum + 1, processes.length + 1);
	}

	updateProcessTable();

	// Restore algorithm choice
	if (data.algo) {
		const radio = document.querySelector(`input[name='algo'][value='${data.algo}']`);
		if (radio) {
			radio.checked = true;
			onAlgoChange(data.algo);
		}
	}

	// Restore quantum for Round Robin
	if (typeof data.quantum === "number") {
		const qInput = document.getElementById("quantum");
		if (qInput) qInput.value = String(data.quantum);
	}
}

// =============================
// Algorithm descriptions (Setup tab)
// =============================

const ALGO_INFO = {
	fcfs: {
		title: "First-Come First-Served (FCFS)",
		text: "Non-preemptive: always runs the process that arrived earliest among the ready queue."
	},
	sjf: {
		title: "Shortest Job First (SJF)",
		text: "Non-preemptive: among all ready processes, runs the one with the smallest CPU burst time."
	},
	srtf: {
		title: "Shortest Remaining Time First (SRTF)",
		text: "Preemptive: at each moment, chooses the job with the smallest remaining time; new short jobs may preempt the current one."
	},
	priority: {
		title: "Preemptive Priority Scheduling",
		text: "Preemptive: always runs the job with the highest priority (here: the smallest numeric value)."
	},
	hrrn: {
		title: "Highest Response Ratio Next (HRRN)",
		text: "Non-preemptive: selects the job with the largest response ratio RR = (Waiting + Burst) / Burst."
	},
	rr: {
		title: "Round Robin (RR)",
		text: "Time-sliced: each ready process runs for at most one time quantum before moving to the back of the ready queue."
	}
};

// =============================
// Setup tab helpers (process table & examples)
// =============================

function updateProcessTable() {
	const tbody = document.querySelector("#process-table tbody");
	const emptyState = document.getElementById("empty-state");
	const countSpan = document.getElementById("process-count");
	if (!tbody) return;

	tbody.innerHTML = "";

	if (!processes || processes.length === 0) {
		if (emptyState) emptyState.style.display = "flex";
		if (countSpan) countSpan.textContent = "0 processes";
		return;
	}

	if (emptyState) emptyState.style.display = "none";

	processes.forEach((p, index) => {
		const tr = document.createElement("tr");

		const tdName = document.createElement("td");
		tdName.textContent = p.name;
		tr.appendChild(tdName);

		const tdArr = document.createElement("td");
		tdArr.textContent = p.arrival;
		tr.appendChild(tdArr);

		const tdBurst = document.createElement("td");
		tdBurst.textContent = p.burst;
		tr.appendChild(tdBurst);

		const tdPrio = document.createElement("td");
		tdPrio.textContent = p.priority;
		tr.appendChild(tdPrio);

		const tdActions = document.createElement("td");
		const btn = document.createElement("button");
		btn.className = "btn-secondary";
		btn.textContent = "Remove";
		btn.addEventListener("click", () => {
			processes.splice(index, 1);
			updateProcessTable();
			saveUserConfig();
		});
		tdActions.appendChild(btn);
		tr.appendChild(tdActions);

		tbody.appendChild(tr);
	});

	if (countSpan) {
		const n = processes.length;
		countSpan.textContent = `${n} process${n === 1 ? "" : "es"}`;
	}
}

function addProcess() {
	const nameInput = document.getElementById("pname");
	const arrivalInput = document.getElementById("arrival");
	const burstInput = document.getElementById("burst");
	const priorityInput = document.getElementById("priority");

	if (!arrivalInput || !burstInput || !priorityInput) return;

	const arrival = parseInt(arrivalInput.value, 10);
	const burst = parseInt(burstInput.value, 10);
	const priority = parseInt(priorityInput.value, 10);

	if (!Number.isFinite(arrival) || arrival < 0 || !Number.isFinite(burst) || burst <= 0) {
		alert("Please enter a valid arrival time (≥ 0) and burst time (> 0). ");
		return;
	}

	let name = nameInput && nameInput.value ? nameInput.value.trim() : "";
	if (!name) {
		name = `P${autoProcessCount++}`;
	} else {
		const m = /^P(\d+)$/.exec(name);
		if (m) {
			const num = parseInt(m[1], 10);
			if (num >= autoProcessCount) autoProcessCount = num + 1;
		}
	}

	const p = new Process(name, arrival, burst, Number.isFinite(priority) ? priority : 0);
	processes.push(p);
	updateProcessTable();
	saveUserConfig();

	if (nameInput) nameInput.value = "";
}

function clearProcesses() {
	processes = [];
	autoProcessCount = 1;
	updateProcessTable();
	saveUserConfig();
}

function loadExample(type) {
	processes = [];
	let example = [];

	switch (type) {
		case "cpu-heavy":
		case "cpu": {
			// CPU-heavy: long jobs with some overlap
			example = [
				{ name: "P1", arrival: 0, burst: 10, priority: 1 },
				{ name: "P2", arrival: 0, burst: 6, priority: 2 },
				{ name: "P3", arrival: 2, burst: 8, priority: 3 },
				{ name: "P4", arrival: 4, burst: 4, priority: 2 }
			];
			break;
		}
		case "bursty": {
			// Bursty arrivals: many jobs arriving in bursts
			example = [
				{ name: "P1", arrival: 0, burst: 3, priority: 1 },
				{ name: "P2", arrival: 1, burst: 2, priority: 2 },
				{ name: "P3", arrival: 2, burst: 1, priority: 3 },
				{ name: "P4", arrival: 5, burst: 7, priority: 1 },
				{ name: "P5", arrival: 6, burst: 3, priority: 2 },
				{ name: "P6", arrival: 6, burst: 2, priority: 3 },
				{ name: "P7", arrival: 7, burst: 8, priority: 1 },
				{ name: "P8", arrival: 8, burst: 2, priority: 2 }
			];
			break;
		}
		case "priority": {
			// Priority-focused: mix of priorities to show preemption/starvation
			example = [
				{ name: "P1", arrival: 0, burst: 8, priority: 3 },
				{ name: "P2", arrival: 0, burst: 4, priority: 1 },
				{ name: "P3", arrival: 1, burst: 9, priority: 4 },
				{ name: "P4", arrival: 2, burst: 5, priority: 2 },
				{ name: "P5", arrival: 4, burst: 2, priority: 0 }
			];
			break;
		}
		case "basic":
		default: {
			// Balanced default example
			example = [
				{ name: "P1", arrival: 0, burst: 5, priority: 2 },
				{ name: "P2", arrival: 1, burst: 3, priority: 1 },
				{ name: "P3", arrival: 2, burst: 8, priority: 3 },
				{ name: "P4", arrival: 3, burst: 6, priority: 2 }
			];
			break;
		}
	}

	example.forEach(e => {
		processes.push(new Process(e.name, e.arrival, e.burst, e.priority));
	});

	// Update autoProcessCount so that future auto-named processes don't collide
	const maxNum = example.reduce((max, e) => {
		const m = e.name && /^P(\d+)$/.exec(e.name);
		return m ? Math.max(max, parseInt(m[1], 10)) : max;
	}, 0);
	autoProcessCount = maxNum ? maxNum + 1 : processes.length + 1;

	updateProcessTable();
	saveUserConfig();
}

// =============================
// Scheduling algorithms
// =============================

function fcfs(ps) {
	ps.sort((a, b) => a.arrival - b.arrival);

	let time = 0;
	const gantt = [];

	ps.forEach(p => {
		if (time < p.arrival) {
			// CPU idle until process arrives
			gantt.push({ process: "Idle", start: time, end: p.arrival });
			time = p.arrival;
		}

		const start = time;
		const end = start + p.burst;
		gantt.push({ process: p.name, start, end });

		p.startTime = start;
		p.finishTime = end;
		p.responseTime = start - p.arrival;

		time = end;
	});

	const metrics = ps.map(p => {
		const turnaround = p.finishTime - p.arrival;
		const waiting = turnaround - p.burst;
		return {
			process: p.name,
			waiting,
			turnaround,
			response: p.responseTime
		};
	});

	return { gantt, metrics };
}

function sjf(ps) {
	ps.sort((a, b) => a.arrival - b.arrival);

	let time = 0;
	let completed = 0;
	const n = ps.length;
	const gantt = [];

	while (completed < n) {
		const ready = ps.filter(p => p.finishTime == null && p.arrival <= time);

		if (ready.length === 0) {
			const next = ps.find(p => p.finishTime == null);
			if (!next) break;
			if (next.arrival > time) {
				gantt.push({ process: "Idle", start: time, end: next.arrival });
				time = next.arrival;
			}
			continue;
		}

		ready.sort((a, b) => a.burst - b.burst);
		const p = ready[0];

		const start = time;
		const end = start + p.burst;
		gantt.push({ process: p.name, start, end });

		p.startTime = start;
		p.finishTime = end;
		p.responseTime = start - p.arrival;

		time = end;
		completed++;
	}

	const metrics = ps.map(p => {
		const turnaround = p.finishTime - p.arrival;
		const waiting = turnaround - p.burst;
		return {
			process: p.name,
			waiting,
			turnaround,
			response: p.responseTime
		};
	});

	return { gantt, metrics };
}

function srtf(ps) {
	ps.sort((a, b) => a.arrival - b.arrival);
	ps.forEach(p => {
		p.remaining = p.burst;
		p.startTime = null;
		p.finishTime = null;
	});

	let time = 0;
	let completed = 0;
	const n = ps.length;
	const gantt = [];

	let currentProcess = null;
	let segmentStart = 0;

	while (completed < n) {
		const ready = ps.filter(p => p.arrival <= time && p.remaining > 0);

		if (ready.length === 0) {
			// CPU idle
			if (currentProcess !== "Idle") {
				if (currentProcess !== null) {
					gantt.push({ process: currentProcess, start: segmentStart, end: time });
				}
				currentProcess = "Idle";
				segmentStart = time;
			}
			time++;
			continue;
		}

		ready.sort((a, b) => a.remaining - b.remaining);
		const p = ready[0];

		if (currentProcess !== p.name) {
			if (currentProcess !== null) {
				gantt.push({ process: currentProcess, start: segmentStart, end: time });
			}
			currentProcess = p.name;
			segmentStart = time;
			if (p.startTime == null) p.startTime = time;
		}

		p.remaining--;
		time++;

		if (p.remaining === 0) {
			p.finishTime = time;
			completed++;
		}
	}

	if (currentProcess !== null) {
		gantt.push({ process: currentProcess, start: segmentStart, end: time });
	}

	const metrics = ps.map(p => {
		const turnaround = p.finishTime - p.arrival;
		const waiting = turnaround - p.burst;
		const response = p.startTime - p.arrival;
		return { process: p.name, waiting, turnaround, response };
	});

	return { gantt, metrics };
}

function priorityScheduling(ps) {
	ps.forEach(p => {
		p.remaining = p.burst;
		p.startTime = null;
		p.finishTime = null;
	});

	ps.sort((a, b) => a.arrival - b.arrival);

	let time = 0;
	let completed = 0;
	const n = ps.length;
	const gantt = [];
	let current = null;
	let segmentStart = 0;

	while (completed < n) {
		const ready = ps.filter(p => p.arrival <= time && p.remaining > 0);

		if (ready.length === 0) {
			if (current !== "Idle") {
				if (current !== null) {
					gantt.push({ process: current, start: segmentStart, end: time });
				}
				current = "Idle";
				segmentStart = time;
			}
			time++;
			continue;
		}

		ready.sort((a, b) => a.priority - b.priority);
		const p = ready[0];

		if (current !== p.name) {
			if (current !== null) {
				gantt.push({ process: current, start: segmentStart, end: time });
			}
			current = p.name;
			segmentStart = time;
			if (p.startTime == null) p.startTime = time;
		}

		p.remaining--;
		time++;

		if (p.remaining === 0) {
			p.finishTime = time;
			completed++;
		}
	}

	if (current !== null) {
		gantt.push({ process: current, start: segmentStart, end: time });
	}

	const metrics = ps.map(p => {
		const turnaround = p.finishTime - p.arrival;
		const waiting = turnaround - p.burst;
		const response = p.startTime - p.arrival;
		return { process: p.name, waiting, turnaround, response };
	});

	return { gantt, metrics };
}

function hrrn(ps) {
	ps.forEach(p => {
		p.finishTime = null;
		p.startTime = null;
	});

	ps.sort((a, b) => a.arrival - b.arrival);

	let time = 0;
	let completed = 0;
	const n = ps.length;
	const gantt = [];

	while (completed < n) {
		const ready = ps.filter(p => p.finishTime == null && p.arrival <= time);

		if (ready.length === 0) {
			const next = ps.find(p => p.finishTime == null);
			if (!next) break;
			if (next.arrival > time) {
				gantt.push({ process: "Idle", start: time, end: next.arrival });
				time = next.arrival;
			}
			continue;
		}

		ready.forEach(p => {
			const waiting = time - p.arrival;
			p.RR = (waiting + p.burst) / p.burst;
		});

		ready.sort((a, b) => b.RR - a.RR);
		const p = ready[0];

		const start = time;
		const end = start + p.burst;
		if (p.startTime == null) p.startTime = start;
		gantt.push({ process: p.name, start, end });

		p.finishTime = end;
		time = end;
		completed++;
	}

	const metrics = ps.map(p => {
		const turnaround = p.finishTime - p.arrival;
		const waiting = turnaround - p.burst;
		const response = p.startTime - p.arrival;
		return { process: p.name, waiting, turnaround, response };
	});

	return { gantt, metrics };
}

function rr(ps, quantum) {
	ps.forEach(p => {
		p.remaining = p.burst;
		p.startTime = null;
		p.finishTime = null;
	});

	ps.sort((a, b) => a.arrival - b.arrival);

	let time = 0;
	const gantt = [];
	const queue = [];
	const n = ps.length;
	let completed = 0;
	let idx = 0;

	while (completed < n) {
		while (idx < n && ps[idx].arrival <= time) {
			queue.push(ps[idx]);
			idx++;
		}

		if (queue.length === 0) {
			const nextArrival = ps[idx]?.arrival;
			if (nextArrival != null && nextArrival > time) {
				gantt.push({ process: "Idle", start: time, end: nextArrival });
				time = nextArrival;
				continue;
			}
			time++;
			continue;
		}

		const p = queue.shift();
		if (p.startTime == null) p.startTime = time;

		const exec = Math.min(quantum, p.remaining);
		gantt.push({ process: p.name, start: time, end: time + exec });

		time += exec;
		p.remaining -= exec;

		while (idx < n && ps[idx].arrival <= time) {
			queue.push(ps[idx]);
			idx++;
		}

		if (p.remaining > 0) {
			queue.push(p);
		} else {
			p.finishTime = time;
			completed++;
		}
	}

	const metrics = ps.map(p => {
		const turnaround = p.finishTime - p.arrival;
		const waiting = turnaround - p.burst;
		const response = p.startTime - p.arrival;
		return { process: p.name, waiting, turnaround, response };
	});

	return { gantt, metrics };
}

// =============================
// Simulation building & explanations
// =============================

function runScheduler() {
	if (processes.length === 0) {
		alert("Please add at least one process in the Setup tab.");
		return;
	}

	const algo = document.querySelector("input[name='algo']:checked");
	if (!algo) {
		alert("Please select a scheduling algorithm in the Setup tab.");
		return;
	}
	const selected = algo.value;

	const ps = processes.map(
		p => new Process(p.name, p.arrival, p.burst, p.priority)
	);

	let result;
	if (selected === "fcfs") result = fcfs(ps);
	else if (selected === "sjf") result = sjf(ps);
	else if (selected === "srtf") result = srtf(ps);
	else if (selected === "priority") result = priorityScheduling(ps);
	else if (selected === "hrrn") result = hrrn(ps);
	else if (selected === "rr") {
		const qVal = document.getElementById("quantum")?.value;
		const q = parseInt(qVal, 10);
		if (!q || q <= 0) {
			alert("Round Robin requires a positive time quantum.");
			return;
		}
		result = rr(ps, q);
	}

	if (!result) return;

	simulation = buildSimulation(ps, result, selected);
	currentStepIndex = 0;
	autoFitGantt = true;
	fitMainGanttToViewport();
	pauseSimulation();
	renderCurrentStep();
	updateSimStatus("ready");

	saveUserConfig();
}

function buildSimulation(processList, result, algoKey) {
	const gantt = [...result.gantt].sort((a, b) => a.start - b.start);

	const processesByName = {};
	processList.forEach(p => {
		processesByName[p.name] = p;
	});

	const executed = {};
	processList.forEach(p => {
		executed[p.name] = 0;
	});

	const steps = [];
	let currentTime = 0;

	for (let i = 0; i < gantt.length; i++) {
		const slot = gantt[i];

		if (slot.start > currentTime) {
			const idleStart = currentTime;
			const idleEnd = slot.start;
			const state = computeStateAtTime(processList, executed, idleStart);
			const explanation = createExplanationForStep({
				isIdle: true,
				start: idleStart,
				end: idleEnd,
				ready: state.ready,
				completed: state.completed,
				running: null
			}, algoKey);
			steps.push({
				index: steps.length,
				start: idleStart,
				end: idleEnd,
				processName: "Idle",
				isIdle: true,
				ready: state.ready,
				completed: state.completed,
				explanation
			});
			currentTime = idleEnd;
		}

		const stepStart = slot.start;
		const stepEnd = slot.end;
		const state = computeStateAtTime(processList, executed, stepStart);
		const runningProc = processesByName[slot.process] || null;
		const explanation = createExplanationForStep({
			isIdle: false,
			start: stepStart,
			end: stepEnd,
			ready: state.ready,
			completed: state.completed,
			running: runningProc
		}, algoKey);

		steps.push({
			index: steps.length,
			start: stepStart,
			end: stepEnd,
			processName: slot.process,
			isIdle: false,
			ready: state.ready,
			completed: state.completed,
			explanation
		});

		if (runningProc) {
			executed[runningProc.name] += (stepEnd - stepStart);
		}
		currentTime = stepEnd;
	}

	const summary = computeSummaryMetrics(result.metrics);

	return {
		steps,
		gantt,
		metrics: result.metrics,
		summary,
		algo: algoKey
	};
}

function computeStateAtTime(processList, executed, time) {
	const ready = [];
	const completed = [];

	processList.forEach(p => {
		const exec = executed[p.name] || 0;
		const remaining = Math.max(p.burst - exec, 0);
		const waiting = Math.max(time - p.arrival - exec, 0);

		if (p.finishTime != null && p.finishTime <= time) {
			completed.push(p.name);
		} else if (p.arrival <= time && remaining > 0) {
			ready.push({
				name: p.name,
				arrival: p.arrival,
				burst: p.burst,
				priority: p.priority,
				remaining,
				waiting
			});
		}
	});

	return { ready, completed };
}

function createExplanationForStep(step, algoKey) {
	const { isIdle, start, end, ready, running } = step;

	// Find the state record for the running process inside the ready set,
	// so we can show its waiting/remaining/burst values in formulas.
	const runningState = running && Array.isArray(ready)
		? ready.find(p => p.name === running.name)
		: null;

	const readySummary = ready && ready.length
		? ready.map(p => `${p.name}(arrival=${p.arrival}, burst=${p.burst}, remaining=${p.remaining}, waiting=${p.waiting})`).join(", ")
		: "(empty)";

	if (isIdle) {
		if (!ready || ready.length === 0) {
			return `
				<div class="step-detail">
					<div class="step-header">⏸️ CPU Idle: Time ${start}–${end}</div>
					<div class="step-decision">
						At this time no process has arrived yet, so the CPU stays idle.
					</div>
				</div>
			`;
		}
		return `
			<div class="step-detail">
				<div class="step-header">⏸️ CPU Idle: Time ${start}–${end}</div>
				<div class="step-decision">
					There are ready processes but the timeline shows an idle gap (e.g., between dispatches or due to modelling granularity).
				</div>
			</div>
		`;
	}

	if (!running) {
		return `
			<div class="step-detail">
				<div class="step-header">⚙️ Time ${start}–${end}</div>
				<div class="step-decision">The CPU executes a process, but detailed information is not available.</div>
			</div>
		`;
	}

	const algoInfo = ALGO_INFO[algoKey];
	const baseTitle = algoInfo ? algoInfo.title : algoKey.toUpperCase();

	let ruleSummary = "";
	let detailedExplanation = "";
	let formula = "";
	let ruleChunks = null;
	let decisionHtml = null;

	switch (algoKey) {
		case "fcfs": {
			ruleSummary = "FCFS always chooses the process that arrived earliest among the ready processes (non-preemptive).";
			ruleChunks = [
				"First-Come First-Served (FCFS):",
				"non-preemptive,",
				"serve ready processes strictly by arrival order."
			];
			let orderPart = "";
			if (ready && ready.length) {
				const sorted = [...ready].sort((a, b) => a.arrival - b.arrival);
				orderPart = sorted.map(p => `${p.name}: arrival = ${p.arrival}`).join(" \u2192 ");
			}
			detailedExplanation = `The scheduler chooses <strong>${running.name}</strong> because it is at the front of the arrival-time order.`;
			decisionHtml = `
				It chooses
				<span class="word-chunk" style="animation-delay:0.40s"><strong>${running.name}</strong></span>
				because it is
				<span class="word-chunk" style="animation-delay:0.65s">the earliest-arrived process</span>
				in the
				<span class="word-chunk" style="animation-delay:0.90s">ready set.</span>
			`;
			formula = ready && ready.length
				? `Order by arrival time at t = ${start}: ${orderPart}. The first in this order is ${running.name}.`
				: "Selection rule: min(arrival_time) among ready processes.";
			break;
		}
		case "sjf": {
			ruleSummary = "SJF (non-preemptive) always runs the job with the smallest burst time among all ready jobs.";
			ruleChunks = [
				"Shortest Job First (SJF):",
				"non-preemptive,",
				"pick the job with the smallest CPU burst among ready jobs."
			];
			let burstsPart = "";
			if (ready && ready.length) {
				burstsPart = ready.map(p => `${p.name}: burst = ${p.burst}`).join(", ");
			}
			const burstShown = runningState ? runningState.burst : running.burst;
			detailedExplanation = `<strong>${running.name}</strong> has the shortest CPU burst time among the ready jobs (Burst = ${burstShown}).`;
			decisionHtml = `
				<span class="word-chunk" style="animation-delay:0.40s"><strong>${running.name}</strong></span>
				has the
				<span class="word-chunk" style="animation-delay:0.65s">smallest CPU burst</span>
				among the ready jobs
				<span class="word-chunk" style="animation-delay:0.90s">(Burst = ${burstShown}).</span>
			`;
			formula = ready && ready.length
				? `Burst times at t = ${start}: ${burstsPart}. The smallest burst is ${burstShown}, so SJF chooses ${running.name}.`
				: `Selection rule: pick the smallest burst time.`;
			break;
		}
		case "srtf": {
			ruleSummary = "SRTF (preemptive) always runs the process with the smallest remaining time; new short jobs may preempt the current one.";
			ruleChunks = [
				"Shortest Remaining Time First (SRTF):",
				"preemptive,",
				"choose the job with the smallest remaining processing time;",
				"new short jobs can preempt the current one."
			];
			let remPart = "";
			if (ready && ready.length) {
				remPart = ready.map(p => `${p.name}: remaining = ${p.remaining}`).join(", ");
			}
			const remShown = runningState ? runningState.remaining : (running.remaining ?? "?");
			detailedExplanation = `At time ${start}, <strong>${running.name}</strong> has the smallest remaining time among all ready processes (Remaining = ${remShown}).`;
			decisionHtml = `
				At time ${start},
				<span class="word-chunk" style="animation-delay:0.40s"><strong>${running.name}</strong></span>
				has the
				<span class="word-chunk" style="animation-delay:0.65s">smallest remaining time</span>
				among ready processes
				<span class="word-chunk" style="animation-delay:0.90s">(Remaining = ${remShown}).</span>
			`;
			formula = ready && ready.length
				? `Remaining times at t = ${start}: ${remPart}. The smallest remaining time is ${remShown}, so SRTF runs ${running.name}.`
				: "Selection rule: min(remaining_time) among ready processes.";
			break;
		}
		case "priority": {
			ruleSummary = "Preemptive priority scheduling always runs the ready job with the highest priority (here: smallest numeric value).";
			ruleChunks = [
				"Preemptive priority scheduling:",
				"always run the job with the highest priority",
				"(here: the smallest numeric priority value)."
			];
			let prioPart = "";
			if (ready && ready.length) {
				prioPart = ready.map(p => `${p.name}: priority = ${p.priority}`).join(", ");
			}
			const prioShown = runningState ? runningState.priority : running.priority;
			detailedExplanation = `<strong>${running.name}</strong> has the highest priority among the ready jobs (Priority = ${prioShown}, smaller means higher priority).`;
			decisionHtml = `
				<span class="word-chunk" style="animation-delay:0.40s"><strong>${running.name}</strong></span>
				has the
				<span class="word-chunk" style="animation-delay:0.65s">highest priority</span>
				among ready jobs
				<span class="word-chunk" style="animation-delay:0.90s">(Priority = ${prioShown}, smaller means higher).</span>
			`;
			formula = ready && ready.length
				? `Priorities at t = ${start}: ${prioPart}. The smallest priority value is ${prioShown}, so the scheduler runs ${running.name}.`
				: "Selection rule: run the job with the smallest priority value.";
			break;
		}
		case "hrrn": {
			ruleSummary = "HRRN (non-preemptive) chooses the job with the highest response ratio RR = (Waiting + Burst) / Burst.";
			ruleChunks = [
				"Highest Response Ratio Next (HRRN):",
				"non-preemptive,",
				"choose the job with the largest response ratio",
				"RR = (Waiting + Burst) / Burst."
			];
			let chosenRR = null;
			if (ready && ready.length) {
				const withRR = ready.map(p => {
					const waiting = p.waiting;
					const burst = p.burst;
					const rrVal = (waiting + burst) / burst;
					return { name: p.name, waiting, burst, rrVal };
				});
				withRR.sort((a, b) => b.rrVal - a.rrVal);
				chosenRR = withRR.find(x => x.name === running.name) || withRR[0];
			}
			detailedExplanation = `<strong>${running.name}</strong> has the highest response ratio among the ready processes.`;
			if (chosenRR) {
				decisionHtml = `
					<span class="word-chunk" style="animation-delay:0.40s"><strong>${running.name}</strong></span>
					has the
					<span class="word-chunk" style="animation-delay:0.65s">largest RR</span>
					among all ready jobs
					<span class="word-chunk" style="animation-delay:0.90s">so it is chosen.</span>
				`;
			}
			if (chosenRR) {
				const W = chosenRR.waiting;
				const B = chosenRR.burst;
				const RR = chosenRR.rrVal;
				const procName = chosenRR.name;
				const numerator = W + B;
				formula = `
					<div class="formula-animate formula-hrrn">
						<div class="formula-line" style="animation:formulaLineHighlight 0.5s 0s forwards;">
							Step 1: RR(i) = (Waiting_i + Burst_i) / Burst_i
						</div>
						<div class="formula-line" style="animation:formulaLineHighlight 0.5s 0.5s forwards;">
							Step 2: RR(${procName}) = (<span class="term-part1">${W} + ${B}</span>) / <span class="term-part2">${B}</span>
						</div>
						<div class="formula-line" style="animation:formulaLineHighlight 0.5s 1s forwards;">
							Step 3: RR(${procName}) = <span class="term-result">${numerator}/${B}</span>
						</div>
						<div class="formula-line" style="animation:formulaLineHighlight 0.5s 1.5s forwards;">
							Step 4: RR(${procName}) ≈ <span class="term-result">${RR.toFixed(3)}</span> (largest RR, so chosen)
						</div>
					</div>
				`;
			} else {
				formula = "RR = (Waiting + Burst) / Burst; pick the job with the largest RR.";
			}
			break;
		}
		case "rr": {
			ruleSummary = "Round Robin runs each ready job for at most one time quantum, then moves it to the back of the ready queue if it is not finished.";
			ruleChunks = [
				"Round Robin (RR):",
				"time-sliced scheduling,",
				"each job runs at most one time quantum,",
				"then moves to the back of the ready queue."
			];
			const qInput = document.getElementById("quantum");
			const qVal = qInput ? parseInt(qInput.value, 10) : NaN;
			const quantum = Number.isFinite(qVal) && qVal > 0 ? qVal : "Q";
			const slice = end - start;
			const remBefore = runningState ? runningState.remaining : "R";
			detailedExplanation = `It is <strong>${running.name}</strong>'s turn in the RR queue; it runs for ${slice} time unit(s).`;
			decisionHtml = `
				It is now
				<span class="word-chunk" style="animation-delay:0.40s"><strong>${running.name}</strong></span>
				's turn in the RR queue, so it runs for
				<span class="word-chunk" style="animation-delay:0.65s">${slice} time unit(s)</span>
				before going to the back of the queue if not finished.
			`;
			formula = `Execution this step: exec = min(quantum = ${quantum}, remaining = ${remBefore}) = ${slice}.`;
			break;
		}
		default:
			ruleSummary = "";
	}

	const ruleHtml = ruleChunks && ruleChunks.length
		? ruleChunks.map((chunk, idx) => `
			<span class="word-chunk" style="animation-delay:${(0.20 * idx).toFixed(2)}s">${chunk}</span>
		`).join(" ")
		: ruleSummary;

	const decisionContent = decisionHtml != null ? decisionHtml : detailedExplanation;

	return `
		<div class="step-detail">
			<div class="step-header">⚙️ ${baseTitle} — Time ${start}–${end}</div>
			<div class="step-rule">📚 ${ruleHtml}</div>
			<div class="step-decision">
				✅ <strong>Scheduling decision:</strong> ${decisionContent}<br>
				📊 <strong>Ready queue:</strong> [${readySummary}]
			</div>
			${formula ? `<div class="step-formula">🔢 ${formula}</div>` : ""}
		</div>
	`;
}

function computeSummaryMetrics(metrics) {
	if (!metrics || metrics.length === 0) {
		return { avgWaiting: 0, avgTurnaround: 0, avgResponse: 0 };
	}
	let totalW = 0, totalT = 0, totalR = 0;
	metrics.forEach(m => {
		totalW += m.waiting;
		totalT += m.turnaround;
		totalR += m.response;
	});
	const n = metrics.length;
	return {
		avgWaiting: totalW / n,
		avgTurnaround: totalT / n,
		avgResponse: totalR / n
	};
}

// =============================
// Rendering (Simulate tab)
// =============================

function renderCurrentStep() {
	if (!simulation || !simulation.steps || simulation.steps.length === 0) {
		const chart = document.getElementById("gantt");
		if (chart) chart.innerHTML = "";
		return;
	}

	if (currentStepIndex < 0) currentStepIndex = 0;
	if (currentStepIndex >= simulation.steps.length) currentStepIndex = simulation.steps.length - 1;

	const step = simulation.steps[currentStepIndex];

	renderGanttAtStep(step);
	renderCpuAndQueue(step);
	renderStepExplanation(step);
	renderDecisionLog(currentStepIndex);
	showMetrics(simulation.metrics);
	renderMetricSummary(simulation.summary);

	const tLabel = document.getElementById("current-time");
	if (tLabel) tLabel.textContent = step.start;

	// Decide whether to drive the "camera" (scrolling focus) for this step.
	// In Teaching Mode (CPU stage), we always run the full staged focus
	// pattern. Outside teaching mode we only apply a lighter focus hint
	// during auto-play or when the user manually pressed Step.
	const inTeachingCpuStage = isTeachingMode && teachingStage === "cpu";
	const shouldGuide =
		inTeachingCpuStage ||
		(!isTeachingMode && (isPlaying || lastStepUserInitiated));
	if (shouldGuide) {
		guideTeachingFocusForCurrentStep(inTeachingCpuStage);
	}

	// This flag is only meaningful for the frame in which a manual
	// step happened; clear it after we've rendered the step.
	lastStepUserInitiated = false;
}

function renderGanttAtStep(step) {
	if (!simulation) return;
	const chart = document.getElementById("gantt");
	if (!chart) return;

	chart.innerHTML = "";
	const currentTime = step.end;

		simulation.gantt.forEach(slot => {
			const box = document.createElement("div");
			box.className = "gantt-box";
			const isIdle = slot.process === "Idle";
			if (isIdle) box.classList.add("idle");
			let width = (slot.end - slot.start) * ganttScale;
			if (!Number.isFinite(width) || width <= 0) {
				width = 1; // ensure very small/edge segments are still visible
			}
			box.style.width = width + "px";

		const isCurrent = slot.start === step.start && slot.process === step.processName;
		if (isCurrent) {
			box.classList.add("current");
		}

		if (!isIdle && slot.end <= currentTime) {
			box.style.backgroundColor = getColorForProcess(slot.process);
		} else if (!isIdle && slot.start < currentTime) {
			box.style.backgroundColor = getColorForProcess(slot.process);
			box.style.opacity = "0.6";
		}

		const nameEl = document.createElement("div");
		nameEl.textContent = slot.process;
		const timeEl = document.createElement("div");
		timeEl.className = "time-range";
		timeEl.textContent = `${slot.start}-${slot.end}`;

		box.appendChild(nameEl);
		box.appendChild(timeEl);
		chart.appendChild(box);

		// Keep the current execution segment in view by scrolling the
		// Gantt container horizontally as the simulation progresses.
		if (isCurrent) {
			const container = chart.parentElement;
			if (container && typeof container.scrollLeft === "number") {
				const boxRect = box.getBoundingClientRect();
				const contRect = container.getBoundingClientRect();
				const boxCenter = (boxRect.left + boxRect.right) / 2;
				const contCenter = (contRect.left + contRect.right) / 2;
				container.scrollLeft += boxCenter - contCenter;
			} else if (box.scrollIntoView) {
				box.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "center" });
			}
		}
	});
}

function renderCpuAndQueue(step) {
	const cpuContent = document.getElementById("cpu-content");
	const queueContent = document.getElementById("queue-content");
	if (!cpuContent || !queueContent) return;

	// CPU
	cpuContent.innerHTML = "";
	if (step.isIdle) {
		cpuContent.classList.remove("running");
		cpuContent.innerHTML = '<div class="idle-indicator">Idle</div>';
	} else {
		cpuContent.classList.add("running");
		const chip = document.createElement("div");
		chip.className = "process-chip";
		chip.style.backgroundColor = getColorForProcess(step.processName);
		chip.innerHTML = `<span class="name">${step.processName}</span>`;
		cpuContent.appendChild(chip);
	}

	// Ready queue
	queueContent.innerHTML = "";
	if (!step.ready || step.ready.length === 0) {
		const emptyMsg = document.createElement("div");
		emptyMsg.style.color = "#9ca3af";
		emptyMsg.style.fontSize = "13px";
		emptyMsg.textContent = "Queue is empty";
		queueContent.appendChild(emptyMsg);
	} else {
		step.ready.forEach(p => {
			const chip2 = document.createElement("div");
			chip2.className = "process-chip";
			chip2.style.backgroundColor = getColorForProcess(p.name);
			const label = document.createElement("span");
			label.className = "name";
			label.textContent = p.name;
			const meta = document.createElement("span");
			meta.className = "meta";
			meta.textContent = ` arrival=${p.arrival}, remaining=${p.remaining}`;
			chip2.appendChild(label);
			chip2.appendChild(meta);
			queueContent.appendChild(chip2);
		});
	}
}

/* OLD HEFT formula block that used to live inside renderCpuAndQueue (now disabled)
	// Ready queue
			formulaBox.innerHTML = `
				<div class="formula-animate formula-heft-rank">
					<div class="formula-line" style="animation:formulaLineHighlight 0.5s 0s forwards;">
						Step 1: rank_u(i) = avgComp(i) + max_{child}(comm(i, child) + rank_u(child))
					</div>
					<div class="formula-line" style="animation:formulaLineHighlight 0.5s 0.5s forwards;">
						Step 2: avgComp(${step.taskId})  <span class="term-part1">${avgStr}</span>
					</div>
					<div class="formula-line" style="animation:formulaLineHighlight 0.5s 1s forwards;">
						Step 3: rank_u(${step.taskId})  <span class="term-result">${rankStr}</span>
					</div>
				</div>
			`;
		step.ready.forEach(p => {
			const heftResult = heftSimulation.result;
			const decisions = heftResult && Array.isArray(heftResult.decisions) ? heftResult.decisions : null;
			const dec = decisions ? decisions.find(d => d.taskId === step.taskId) : null;
			if (dec && Array.isArray(dec.options) && dec.options.length) {
				let html = `
					<div class="formula-animate formula-heft-schedule">
						<div class="formula-line" style="animation:formulaLineHighlight 0.5s 0s forwards;">
							Step 1: EFT(i, P) = max(available_time(P), parent ready times on P) + comp_time(i, P)
						</div>
				`;
				dec.options.forEach((opt, idx) => {
					const baseStr = Number.isFinite(opt.start) ? opt.start.toFixed(1) : "base";
					const compStr = Number.isFinite(opt.compTime) ? opt.compTime.toFixed(1) : "comp";
					const endStr = Number.isFinite(opt.end) ? opt.end.toFixed(1) : "EFT";
					const delay = 0.5 * (idx + 1);
					const chosenMark = opt.processorId === dec.chosenProcessorId ? "   13 chosen" : "";
					html += `
						<div class="formula-line" style="animation:formulaLineHighlight 0.5s ${delay}s forwards;">
							${opt.processorId}: EFT(${step.taskId}, ${opt.processorId}) =
							<span class="term-part1">${baseStr}</span>
							+ <span class="term-part2">${compStr}</span>
							= <span class="term-result">${endStr}</span>${chosenMark}
						</div>
					`;
				});
				const finalDelay = 0.5 * (dec.options.length + 1);
				html += `
						<div class="formula-line" style="animation:formulaLineHighlight 0.5s ${finalDelay}s forwards;">
							Step ${dec.options.length + 2}: HEFT chooses ${dec.chosenProcessorId} because it has the smallest EFT.
						</div>
					</div>
				`;
				formulaBox.innerHTML = html;
			} else {
				const compTime = step.end - step.start;
				const compStr = Number.isFinite(compTime) ? compTime.toFixed(1) : "comp";
				const endStr = Number.isFinite(step.end) ? step.end.toFixed(1) : "EFT";
				formulaBox.innerHTML = `
					<div class="formula-animate formula-heft-schedule">
						EFT(${step.taskId}, ${step.processorId}) =
						<span class="term-part1">max(available_time(${step.processorId}), parent ready times on ${step.processorId})</span>
						+ <span class="term-part2">comp_time(${step.taskId}, ${step.processorId})  ${compStr}</span>
						= <span class="term-result">${endStr}</span>
					</div>
				`;
			}
			queueContent.appendChild(chip);
		});
	}
}
*/

// Guide vertical focus during Teaching Mode (CPU stage): first show the
// CPU & Ready Queue card, then after a short delay show the Gantt +
// Algorithm Explanation area. This makes the "story" of each step more
// natural: who is running / waiting → how the timeline and metrics evolve.
function guideTeachingFocusForCurrentStep(inTeachingCpuStage) {
	// Only drive the camera when the Simulate tab is actually visible.
	const simulateTab = document.getElementById("tab-simulate");
	if (!simulateTab || !simulateTab.classList.contains("active")) return;

	// Clear any previous pending focus transition so we don't stack timers
	// across rapid steps or stage changes.
	if (teachingFocusTimer) {
		clearTimeout(teachingFocusTimer);
		teachingFocusTimer = null;
	}

	const cpuContainer = document.querySelector(".cpu-queue-container");
	const cpuCard = cpuContainer ? cpuContainer.closest(".card") : null;
	const ganttCard = document.querySelector(".gantt-section") || document.getElementById("gantt");
	const explanationCard = document.querySelector(".explanation-card") || document.getElementById("step-explanation");

	const scrollOptions = { behavior: "smooth", block: "center", inline: "nearest" };

	// Phase 1: immediately bring CPU & Ready Queue into view.
	if (cpuCard && typeof cpuCard.scrollIntoView === "function") {
		cpuCard.scrollIntoView(scrollOptions);
	}

	// If we are NOT in the teaching CPU stage, use a lighter, quicker
	// two-phase focus: CPU first, then shortly after the explanation.
	if (!isTeachingMode || teachingStage !== "cpu") {
		if (explanationCard && typeof explanationCard.scrollIntoView === "function") {
			teachingFocusTimer = setTimeout(() => {
				// Outside teaching mode we don't need strict stage checks, but
				// still cancel if the Simulate tab is no longer visible.
				const tabNow = document.getElementById("tab-simulate");
				if (!tabNow || !tabNow.classList.contains("active")) return;
				explanationCard.scrollIntoView(scrollOptions);
			}, 800);
		}
		return;
	}

	// In Teaching Mode (CPU stage), run a full three-phase focus with
	// explicit dwell times:
	// 1) CPU & Ready Queue  — shown immediately
	// 2) Gantt Chart        — after 2 seconds
	// 3) Algorithm Explanation — after another 2 seconds (total ≈ 4s)
	// The remaining ~3s of dwell time before the next step are provided
	// by the teaching playback interval (see scheduleNextStep).
	if (ganttCard && typeof ganttCard.scrollIntoView === "function") {
		teachingFocusTimer = setTimeout(() => {
			if (!isTeachingMode || teachingStage !== "cpu") return;
			ganttCard.scrollIntoView(scrollOptions);

			if (explanationCard && typeof explanationCard.scrollIntoView === "function") {
				teachingFocusTimer = setTimeout(() => {
					if (!isTeachingMode || teachingStage !== "cpu") return;
					explanationCard.scrollIntoView(scrollOptions);
				}, 2000);
			}
		}, 2000);
	}
}

function renderStepExplanation(step) {
	const box = document.getElementById("step-explanation");
	if (!box) return;
	box.innerHTML = "";

	const explanationWrapper = document.createElement("div");
	explanationWrapper.innerHTML = step.explanation;
	box.appendChild(explanationWrapper);

	const p2 = document.createElement("p");
	const readyNames = step.ready && step.ready.length ? step.ready.map(p => p.name).join(", ") : "(empty)";
	const completedNames = step.completed && step.completed.length ? step.completed.join(", ") : "(none)";
	p2.textContent = `Ready queue: [${readyNames}], Completed: [${completedNames}]`;
	box.appendChild(p2);

	// As we move through time, show a small live summary of metrics for
	// processes that have already finished. This reinforces the idea that
	// the averages are built step by step instead of appearing "all at once".
	if (simulation && simulation.metrics && step.completed && step.completed.length) {
		const metricsMap = {};
		simulation.metrics.forEach(m => { metricsMap[m.process] = m; });

		const summaryDiv = document.createElement("div");
		summaryDiv.className = "metrics-so-far";

		const title = document.createElement("div");
		title.className = "metrics-so-far-title";
		title.textContent = "So far (completed processes):";
		summaryDiv.appendChild(title);

		const table = document.createElement("table");
		table.className = "metrics-so-far-table";

		const thead = document.createElement("thead");
		thead.innerHTML = "<tr><th>Process</th><th>W</th><th>T</th><th>R</th></tr>";
		table.appendChild(thead);

		const tbody = document.createElement("tbody");
		step.completed.forEach(name => {
			const m = metricsMap[name];
			if (!m) return;
			const row = document.createElement("tr");
			row.innerHTML = `
				<td>${name}</td>
				<td>${m.waiting}</td>
				<td>${m.turnaround}</td>
				<td>${m.response}</td>
			`;
			tbody.appendChild(row);
		});
		table.appendChild(tbody);
		summaryDiv.appendChild(table);

		box.appendChild(summaryDiv);
	}
}

function renderDecisionLog(currentIdx) {
	const container = document.getElementById("decision-log");
	if (!container || !simulation) return;
	container.innerHTML = "";

	simulation.steps.forEach((s, idx) => {
		const row = document.createElement("div");
		row.className = "decision-log-entry" + (idx === currentIdx ? " current" : "");
		const t = document.createElement("span");
		t.className = "time";
		t.textContent = `${s.start}-${s.end}`;
		const proc = document.createElement("span");
		proc.className = "proc";
		proc.textContent = s.processName;
		row.appendChild(t);
		row.appendChild(proc);
		container.appendChild(row);

		// Auto-scroll the decision log so the current step stays in view.
		if (idx === currentIdx && row.scrollIntoView) {
			row.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "nearest" });
		}
	});
}

function showMetrics(metrics) {
	const tbody = document.querySelector("#result-table tbody");
	if (!tbody) return;
	tbody.innerHTML = "";

	metrics.forEach(m => {
		const row = document.createElement("tr");
		row.innerHTML = `
			<td>${m.process}</td>
			<td>${m.waiting}</td>
			<td>${m.turnaround}</td>
			<td>${m.response}</td>
		`;
		tbody.appendChild(row);
	});
}

function renderMetricSummary(summary) {
	const box = document.getElementById("metric-summary");
	if (!box || !summary) return;
	box.innerHTML = `Average Waiting Time: ${summary.avgWaiting.toFixed(2)} &nbsp; | &nbsp; ` +
		`Average Turnaround Time: ${summary.avgTurnaround.toFixed(2)} &nbsp; | &nbsp; ` +
		`Average Response Time: ${summary.avgResponse.toFixed(2)}`;
}

// =============================
// Playback controls
// =============================

function playSimulation() {
	if (!simulation || !simulation.steps || simulation.steps.length === 0) return;
	if (isPlaying) return;
	isPlaying = true;
	updateSimStatus("running");
	scheduleNextStep();
}

function pauseSimulation() {
	isPlaying = false;
	if (playTimer) {
		clearTimeout(playTimer);
		playTimer = null;
	}
	if (simulation) updateSimStatus("paused");
}

function resetSimulation() {
	pauseSimulation();
	if (!simulation) return;
	currentStepIndex = 0;
	renderCurrentStep();
	updateSimStatus("ready");
}

function stepSimulation() {
	pauseSimulation();
	if (!simulation || !simulation.steps) return;
	if (currentStepIndex < simulation.steps.length - 1) {
		// Mark this frame as a user-driven step so that renderCurrentStep
		// can apply guided focus even outside Teaching Mode (helpful for
		// recording demo videos).
		lastStepUserInitiated = true;
		currentStepIndex++;
		renderCurrentStep();
		updateSimStatus("running");
	} else {
		updateSimStatus("finished");
	}
}

function scheduleNextStep() {
	if (!isPlaying || !simulation || !simulation.steps) return;
	// In Teaching Mode (CPU stage), slow down the automatic playback so
	// that the camera can dwell on CPU → Gantt → Explanation for a full
	// cycle (approximately 2s + 2s + 3s = 7s per step). Outside teaching
	// mode, keep the normal 1s base interval.
	let baseInterval;
	if (isTeachingMode && teachingStage === "cpu") {
		let factor = 1;
		if (simulation && simulation.algo && TEACHING_ALGO_PACE[simulation.algo]) {
			factor = TEACHING_ALGO_PACE[simulation.algo];
		}
		baseInterval = 7000 * factor;
	} else {
		baseInterval = 1000;
	}
	const interval = baseInterval / playSpeed;
	playTimer = setTimeout(() => {
		if (!simulation || !simulation.steps) return;
		if (currentStepIndex < simulation.steps.length - 1) {
			currentStepIndex++;
			renderCurrentStep();
			scheduleNextStep();
		} else {
			isPlaying = false;
			updateSimStatus("finished");
		}
	}, interval);
}

function changeSpeed(value) {
	const v = parseFloat(value) || 1;
	playSpeed = v;
	const label = document.getElementById("speed-label");
	if (label) label.textContent = `${v.toFixed(2)}x`;
	if (isPlaying) {
		pauseSimulation();
		playSimulation();
	}
}

function updateSimStatus(state) {
	const dot = document.getElementById("sim-status");
	const text = document.getElementById("sim-status-text");
	if (!dot || !text) return;

	dot.classList.remove("ready", "running", "paused");

	switch (state) {
		case "running":
			dot.classList.add("running");
			text.textContent = "Running";
			break;
		case "paused":
			dot.classList.add("paused");
			text.textContent = "Paused";
			break;
		case "finished":
			dot.classList.add("ready");
			text.textContent = "Finished";
			break;
		default:
			dot.classList.add("ready");
			text.textContent = "Ready";
	}
}

// =============================
// Gantt zoom & auto-fit
// =============================

function fitMainGanttToViewport() {
	if (!simulation || !simulation.gantt || simulation.gantt.length === 0) return;
	const chart = document.getElementById("gantt");
	if (!chart) return;
	const container = chart.parentElement; // .gantt-container
	if (!container) return;

	// Reset to a neutral scale before measuring
	let maxEnd = 0;
	simulation.gantt.forEach(slot => {
		if (typeof slot.end === "number" && slot.end > maxEnd) maxEnd = slot.end;
	});
	if (!maxEnd || maxEnd <= 0) return;

	const containerWidth = container.clientWidth || 0;
	if (!containerWidth) return;

	// Leave a bit of padding so the last box is not glued to the edge
	const available = Math.max(containerWidth - 40, 80);
	const rawScale = available / maxEnd;
	// Avoid over-zooming when the schedule is very short, but otherwise
	// let rawScale shrink as needed so the full timeline fits.
	const maxScale = 48; // allow moderate zoom-in if the schedule is short
	ganttScale = Math.min(rawScale, maxScale);
}

// Gantt zoom controls
function zoomGantt(direction) {
	autoFitGantt = false; // user has taken manual control over zoom
	if (direction === "in") {
		ganttScale = Math.min(ganttScale * 1.25, 96);
	} else {
		ganttScale = Math.max(ganttScale / 1.25, 8);
	}
	if (simulation && simulation.steps && simulation.steps.length > 0) {
		renderCurrentStep();
	}
}

function resetGanttFit() {
	// Restore automatic fitting for the main Simulate Gantt chart
	// and recompute the scale based on the current container width.
	if (!simulation || !simulation.gantt || simulation.gantt.length === 0) return;
	autoFitGantt = true;
	fitMainGanttToViewport();
	if (simulation.steps && simulation.steps.length > 0) {
		renderCurrentStep();
	}
}

// =============================
// Algorithm selection and Setup → Simulate
// =============================

function onAlgoChange(algoKey) {
	const box = document.getElementById("algo-description");
	const quantumConfig = document.getElementById("quantum-config");

	if (quantumConfig) {
		quantumConfig.style.display = algoKey === "rr" ? "block" : "none";
	}

	if (!box) {
		saveUserConfig();
		return;
	}

	const info = ALGO_INFO[algoKey];
	if (!info) {
		box.textContent = "";
	} else {
		box.innerHTML = `<strong>${info.title}</strong><br>${info.text}`;
	}
	saveUserConfig();
}

function onQuantumChange() {
	saveUserConfig();
}

function proceedToSimulation() {
	runScheduler();
	if (simulation && simulation.steps && simulation.steps.length > 0) {
		switchTab("simulate");
	}
}

// =============================
// Comparison tab
// =============================

function runComparison() {
	if (processes.length === 0) {
		alert("Please add processes first in the Setup tab.");
		return;
	}

	const compareAlgos = ["fcfs", "sjf", "srtf", "priority", "hrrn", "rr"];
	const algoLabels = {
		fcfs: "FCFS",
		sjf: "SJF",
		srtf: "SRTF",
		priority: "Priority",
		hrrn: "HRRN",
		rr: "Round Robin"
	};

	const results = [];

	let quantum = null;
	const qInput = document.getElementById("quantum");
	if (qInput) {
		const val = parseInt(qInput.value, 10);
		if (val && val > 0) quantum = val;
	}

	compareAlgos.forEach(key => {
		if (key === "rr" && !quantum) return;

		const ps = processes.map(
			p => new Process(p.name, p.arrival, p.burst, p.priority)
		);

		let result;
		if (key === "fcfs") result = fcfs(ps);
		else if (key === "sjf") result = sjf(ps);
		else if (key === "srtf") result = srtf(ps);
		else if (key === "priority") result = priorityScheduling(ps);
		else if (key === "hrrn") result = hrrn(ps);
		else if (key === "rr") result = rr(ps, quantum);

		if (!result) return;
		const summary = computeSummaryMetrics(result.metrics);
		results.push({
			key,
			label: algoLabels[key] || key,
			gantt: result.gantt,
			metrics: result.metrics,
			summary
		});
	});

	if (results.length === 0) {
		alert("No algorithms could be compared. Make sure RR has a valid time quantum.");
		return;
	}

	renderComparison(results);
}

function renderComparison(results) {
	const container = document.getElementById("compare-results");
	const tableBody = document.querySelector("#compare-table tbody");
	if (!container || !tableBody) return;

	container.innerHTML = "";
	tableBody.innerHTML = "";

	// Compute a shared scale so that all comparison Gantt rows use
	// the same notion of "time width" and fit within the available
	// container space without horizontal scrolling.
	let maxEnd = 0;
	results.forEach(item => {
		if (!item.gantt) return;
		item.gantt.forEach(slot => {
			if (typeof slot.end === "number" && slot.end > maxEnd) {
				maxEnd = slot.end;
			}
		});
	});
	if (!maxEnd || maxEnd <= 0) maxEnd = 1;

	let containerWidth = container.clientWidth || 0;
	if (!containerWidth) {
		const rect = container.getBoundingClientRect();
		containerWidth = rect.width || 0;
	}
	if (!containerWidth) containerWidth = 800;

	// Leave some margin so gaps between segments do not cause overflow.
	const available = Math.max(containerWidth * 0.85, 80);
	const compareScale = available / maxEnd;

	results.forEach(item => {
		const rowDiv = document.createElement("div");
		rowDiv.className = "compare-row";

		const title = document.createElement("div");
		title.className = "compare-title";
		title.textContent = item.label;

		const ganttRow = document.createElement("div");
		ganttRow.className = "compare-gantt";
		renderGanttStatic(ganttRow, item.gantt, compareScale);

		rowDiv.appendChild(title);
		rowDiv.appendChild(ganttRow);
		container.appendChild(rowDiv);

		const tr = document.createElement("tr");
		const s = item.summary;
		tr.innerHTML = `
			<td>${item.label}</td>
			<td>${s.avgWaiting.toFixed(2)}</td>
			<td>${s.avgTurnaround.toFixed(2)}</td>
			<td>${s.avgResponse.toFixed(2)}</td>
		`;
		tableBody.appendChild(tr);
	});
}

function renderGanttStatic(container, ganttData, scale) {
	container.innerHTML = "";
	if (!ganttData || ganttData.length === 0) return;

	ganttData.forEach(slot => {
		const box = document.createElement("div");
		box.className = "gantt-box";
		const isIdle = slot.process === "Idle";
		if (isIdle) box.classList.add("idle");
		const duration = (slot.end - slot.start);
		const pxPerUnit = (typeof scale === "number" && scale > 0) ? scale : 24;
		let width = duration * pxPerUnit;
		if (!Number.isFinite(width) || width <= 0) width = 2;
		box.style.width = width + "px";
		if (!isIdle) box.style.backgroundColor = getColorForProcess(slot.process);

		const nameEl = document.createElement("div");
		nameEl.textContent = slot.process;
		const timeEl = document.createElement("div");
		timeEl.className = "time-range";
		timeEl.textContent = `${slot.start}-${slot.end}`;

		box.appendChild(nameEl);
		box.appendChild(timeEl);
		container.appendChild(box);
	});
}

// =============================
// HEFT (HEFT/Cloud tab)
// =============================

const HEFT_EXAMPLE = {
	processors: [
		{ id: "VM1", speed: 1.0 },
		{ id: "VM2", speed: 0.6 },
		{ id: "VM3", speed: 1.2 }
	],
	tasks: [
		{ id: "T1", weight: 10, parents: [] },
		{ id: "T2", weight: 18, parents: ["T1"] },
		{ id: "T3", weight: 12, parents: ["T1"] },
		{ id: "T4", weight: 14, parents: ["T2", "T3"] },
		{ id: "T5", weight: 10, parents: ["T3"] },
		{ id: "T6", weight: 8, parents: ["T4", "T5"] }
	],
	comm: 2
};

function runHeftExample() {
	startHeftSimulation(HEFT_EXAMPLE);
}

function runHeftCustom() {
	const cfg = parseHeftDagInput();
	if (!cfg) return;
	startHeftSimulation(cfg);
}

function parseHeftDagInput() {
	const area = document.getElementById("heft-dag-input");
	if (!area) return null;
	const lines = area.value.split(/\n/).map(l => l.trim()).filter(l => l.length > 0);
	if (lines.length === 0) {
		alert("Please enter at least one task line in the HEFT DAG input, or use the example.");
		return null;
	}

	const tasks = [];
	lines.forEach(line => {
		const parts = line.split(/\s+/);
		if (parts.length < 2) return;
		const id = parts[0];
		const weight = parseFloat(parts[1]);
		if (!id || !Number.isFinite(weight) || weight <= 0) return;
		let parents = [];
		if (parts.length >= 3) {
			parents = parts[2].split(",").map(s => s.trim()).filter(Boolean);
		}
		tasks.push({ id, weight, parents });
	});

	if (tasks.length === 0) {
		alert("No valid tasks were parsed from the HEFT DAG input.");
		return null;
	}

	const validIds = new Set(tasks.map(t => t.id));
	tasks.forEach(t => {
		t.parents = (t.parents || []).filter(pid => validIds.has(pid));
	});

	return {
		processors: HEFT_EXAMPLE.processors,
		tasks,
		comm: HEFT_EXAMPLE.comm
	};
}

function computeHeftSchedule(example) {
	const { tasks, processors, comm } = example;

	const avgComp = {};
	tasks.forEach(t => {
		let sum = 0;
		processors.forEach(p => {
			sum += t.weight / p.speed;
		});
		avgComp[t.id] = sum / processors.length;
	});

	const succMap = {};
	tasks.forEach(t => { succMap[t.id] = []; });
	tasks.forEach(t => {
		(t.parents || []).forEach(pid => {
			if (!succMap[pid]) succMap[pid] = [];
			succMap[pid].push(t.id);
		});
	});

	const rank = {};
	function rankUp(taskId) {
		if (rank[taskId] != null) return rank[taskId];
		const succs = succMap[taskId] || [];
		if (succs.length === 0) {
			rank[taskId] = avgComp[taskId];
		} else {
			let maxSucc = 0;
			succs.forEach(sid => {
				const childRank = rankUp(sid);
				const edgeComm = comm || 0;
				maxSucc = Math.max(maxSucc, childRank + edgeComm);
			});
			rank[taskId] = avgComp[taskId] + maxSucc;
		}
		return rank[taskId];
	}

	tasks.forEach(t => rankUp(t.id));

	const orderedTasks = [...tasks].sort((a, b) => rank[b.id] - rank[a.id]);

	const procAvailable = {};
	processors.forEach(p => { procAvailable[p.id] = 0; });

	const assignment = {};
	const decisions = [];

	orderedTasks.forEach(t => {
		let bestProc = null;
		let bestStart = 0;
		let bestEnd = Infinity;

		const options = [];

		processors.forEach(p => {
			const compTime = t.weight / p.speed;
			let est = procAvailable[p.id];
			const parentImpacts = [];

			(t.parents || []).forEach(pid => {
				const parentA = assignment[pid];
				if (!parentA) return;
				const sameProc = parentA.processorId === p.id;
				const edgeComm = sameProc ? 0 : (comm || 0);
				const readyTime = parentA.end + edgeComm;
				parentImpacts.push({
					parentId: pid,
					parentProc: parentA.processorId,
					parentEnd: parentA.end,
					comm: edgeComm,
					readyTime
				});
				est = Math.max(est, readyTime);
			});

			const finish = est + compTime;
			options.push({ processorId: p.id, start: est, end: finish, compTime, parentImpacts });

			if (finish < bestEnd) {
				bestEnd = finish;
				bestStart = est;
				bestProc = p.id;
			}
		});

		assignment[t.id] = { processorId: bestProc, start: bestStart, end: bestEnd };
		procAvailable[bestProc] = bestEnd;

		decisions.push({
			taskId: t.id,
			chosenProcessorId: bestProc,
			chosenStart: bestStart,
			chosenEnd: bestEnd,
			options
		});
	});

	const schedule = [];
	Object.keys(assignment).forEach(tid => {
		const a = assignment[tid];
		schedule.push({ taskId: tid, processorId: a.processorId, start: a.start, end: a.end });
	});

	return { processors, tasks, schedule, rank, orderedTasks, decisions, avgComp, comm };
}

function buildHeftSteps(result) {
	const steps = [];
	const tasksById = {};
	result.tasks.forEach(t => { tasksById[t.id] = t; });

	if (result.orderedTasks && result.orderedTasks.length) {
		result.orderedTasks.forEach(t => {
			const rid = t.id;
			const rankVal = result.rank[rid];
			const avg = result.avgComp ? result.avgComp[rid] : null;
			const succIds = result.tasks
				.filter(x => Array.isArray(x.parents) && x.parents.includes(rid))
				.map(x => x.id);

			let text;
			if (!succIds.length) {
				if (avg != null) {
					text = `Task ${rid} has no successors, so rank_u(${rid}) equals its average computation cost ≈ ${avg.toFixed(2)}.`;
				} else {
					text = `Task ${rid} has no successors, so rank_u(${rid}) is simply its average computation cost (≈ ${rankVal.toFixed(2)}).`;
				}
			} else {
				const comm = result.comm || 0;
				const pieces = succIds.map(cid => {
					const term = result.rank[cid] + comm;
					return `${cid}: rank_u(${cid}) + comm(${comm}) = ${term.toFixed(2)}`;
				}).join("; ");
				const avgStr = avg != null ? avg.toFixed(2) : "avgComp";
				text = `For task ${rid}, rank_u(${rid}) = avgComp(${rid}) + max_succ(rank_u(child) + comm). Here avgComp(${rid}) ≈ ${avgStr}, children terms: ${pieces}, so rank_u(${rid}) ≈ ${rankVal.toFixed(2)}.`;
			}

			steps.push({ kind: "rank", title: `Compute rank_u for ${rid}`, text, taskId: rid });
		});
	}

	if (result.decisions && result.decisions.length) {
		result.decisions.forEach(dec => {
			const parts = [];
			dec.options.forEach(opt => {
				let impactsStr;
				if (opt.parentImpacts && opt.parentImpacts.length) {
					impactsStr = opt.parentImpacts.map(pi => {
						const same = pi.parentProc === opt.processorId;
						const commStr = same ? "0 (same processor)" : pi.comm.toFixed(1);
						return `${pi.parentId} on ${pi.parentProc} finishes at ${pi.parentEnd.toFixed(1)}; ready = ${pi.parentEnd.toFixed(1)} + comm ${commStr} = ${pi.readyTime.toFixed(1)}`;
					}).join("; ");
				} else {
					impactsStr = "no parents, the task can start whenever its processor is free.";
				}
				parts.push(`On ${opt.processorId}: start at ${opt.start.toFixed(1)}, finish at ${opt.end.toFixed(1)}. Parents: ${impactsStr}`);
			});

			const optionSummary = parts.join(" | ");
			const chosen = dec.options.find(o => o.processorId === dec.chosenProcessorId) || dec.options[0];
			const text = `Scheduling task ${dec.taskId}: ${optionSummary}. HEFT chooses ${dec.chosenProcessorId} because it gives the earliest finish time (${chosen.end.toFixed(1)}).`;

			steps.push({
				kind: "schedule",
				title: `Place ${dec.taskId} on ${dec.chosenProcessorId}`,
				text,
				taskId: dec.taskId,
				processorId: dec.chosenProcessorId,
				start: chosen.start,
				end: chosen.end
			});
		});
	}

	return steps;
}

function renderHeftResult(result) {
	const infoBox = document.getElementById("heft-info");
	const ganttBox = document.getElementById("heft-gantt");
	if (!infoBox || !ganttBox) return;

	const makespan = result.schedule.reduce((m, s) => Math.max(m, s.end), 0);
	infoBox.innerHTML = `HEFT scheduled ${result.tasks.length} tasks on ${result.processors.length} processors. Estimated makespan ≈ ${makespan.toFixed(1)} time units.`;

	const byProc = {};
	result.processors.forEach(p => { byProc[p.id] = []; });
	result.schedule.forEach(s => {
		if (!byProc[s.processorId]) byProc[s.processorId] = [];
		byProc[s.processorId].push(s);
	});
	Object.keys(byProc).forEach(pid => {
		byProc[pid].sort((a, b) => a.start - b.start);
	});

	ganttBox.innerHTML = "";

	result.processors.forEach(p => {
		const row = document.createElement("div");
		row.className = "heft-row";

		const label = document.createElement("div");
		label.className = "heft-row-label";
		label.textContent = p.id;

		const track = document.createElement("div");
		track.className = "heft-row-track";

		const tasks = byProc[p.id] || [];
		tasks.forEach(seg => {
			const box = document.createElement("div");
			box.className = "gantt-box";
			box.style.backgroundColor = getColorForProcess(seg.taskId);
			const duration = seg.end - seg.start;
			let grow = (Number.isFinite(duration) && duration > 0) ? duration : 0.1;
			// Use flex-grow proportional to duration so that each HEFT
			// row auto-fits the available width without horizontal scroll.
			box.style.flex = `${grow} 0 0`;

			// Attach metadata so we can highlight boxes during HEFT teaching steps
			box.dataset.taskId = seg.taskId;
			box.dataset.processorId = seg.processorId;
			box.dataset.start = String(seg.start);
			box.dataset.end = String(seg.end);

			const nameEl = document.createElement("div");
			nameEl.textContent = seg.taskId;
			const timeEl = document.createElement("div");
			timeEl.className = "time-range";
			timeEl.textContent = `${seg.start.toFixed(1)}-${seg.end.toFixed(1)}`;

			box.appendChild(nameEl);
			box.appendChild(timeEl);
			track.appendChild(box);
		});

		row.appendChild(label);
		row.appendChild(track);
		ganttBox.appendChild(row);
	});
}

function renderHeftGraph(result) {
	const container = document.getElementById("heft-graph");
	if (!container) return;
	container.innerHTML = "";

	const tasks = result.tasks || [];
	if (!tasks.length) return;

	// Pre-compute order indices for visualization: rank_u ordering and
	// actual scheduling order.
	const rankIndex = {};
	if (Array.isArray(result.orderedTasks)) {
		result.orderedTasks.forEach((t, idx) => {
			if (t && t.id != null) rankIndex[t.id] = idx + 1;
		});
	}
	const scheduleIndex = {};
	if (Array.isArray(result.decisions)) {
		result.decisions.forEach((dec, idx) => {
			if (dec && dec.taskId != null) scheduleIndex[dec.taskId] = idx + 1;
		});
	}

	// Compute a simple layered layout: roots on the left, deeper tasks to the right.
	const tasksById = {};
	tasks.forEach(t => { tasksById[t.id] = t; });

	const level = {};
	function getLevel(id) {
		if (level[id] != null) return level[id];
		const t = tasksById[id];
		if (!t || !t.parents || !t.parents.length) {
			level[id] = 0;
		} else {
			let maxParent = 0;
			(t.parents || []).forEach(pid => {
				maxParent = Math.max(maxParent, getLevel(pid));
			});
			level[id] = maxParent + 1;
		}
		return level[id];
	}

	tasks.forEach(t => getLevel(t.id));

	const groups = {};
	let maxLevel = 0;
	tasks.forEach(t => {
		const lv = level[t.id] || 0;
		maxLevel = Math.max(maxLevel, lv);
		if (!groups[lv]) groups[lv] = [];
		groups[lv].push(t.id);
	});

	const allGroups = Object.values(groups);
	const maxCount = allGroups.length ? Math.max(...allGroups.map(g => g.length)) : 1;

	const xSpacing = 180;
	const ySpacing = 90;
	const marginX = 60;
	const marginY = 40;
	const width = marginX * 2 + maxLevel * xSpacing;
	const height = marginY * 2 + (maxCount - 1) * ySpacing;

	const nodePos = {};
	Object.keys(groups).forEach(lvStr => {
		const lv = parseInt(lvStr, 10);
		const ids = groups[lv];
		const offset = (maxCount - ids.length) / 2;
		ids.forEach((id, idx) => {
			const row = offset + idx;
			nodePos[id] = {
				x: marginX + lv * xSpacing,
				y: marginY + row * ySpacing
			};
		});
	});

	const svgNS = "http://www.w3.org/2000/svg";
	const svg = document.createElementNS(svgNS, "svg");
	svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
	svg.setAttribute("width", String(width));
	svg.setAttribute("height", String(height));

	const defs = document.createElementNS(svgNS, "defs");
	const marker = document.createElementNS(svgNS, "marker");
	marker.setAttribute("id", "heft-arrow");
	marker.setAttribute("markerWidth", "8");
	marker.setAttribute("markerHeight", "8");
	marker.setAttribute("refX", "6");
	marker.setAttribute("refY", "3");
	marker.setAttribute("orient", "auto");
	const markerPath = document.createElementNS(svgNS, "path");
	markerPath.setAttribute("d", "M0,0 L6,3 L0,6 Z");
	markerPath.setAttribute("fill", "#9ca3af");
	marker.appendChild(markerPath);
	defs.appendChild(marker);
	svg.appendChild(defs);

	// Draw edges (parent -> child)
	tasks.forEach(t => {
		(t.parents || []).forEach(pid => {
			const from = nodePos[pid];
			const to = nodePos[t.id];
			if (!from || !to) return;
			const line = document.createElementNS(svgNS, "line");
			line.setAttribute("x1", String(from.x));
			line.setAttribute("y1", String(from.y));
			line.setAttribute("x2", String(to.x));
			line.setAttribute("y2", String(to.y));
			line.setAttribute("class", "heft-edge");
			line.setAttribute("marker-end", "url(#heft-arrow)");
			line.dataset.from = pid;
			line.dataset.to = t.id;
			svg.appendChild(line);
		});
	});

	// Draw nodes on top of edges
	tasks.forEach(t => {
		const pos = nodePos[t.id];
		if (!pos) return;
		const g = document.createElementNS(svgNS, "g");
		g.setAttribute("class", "heft-node");
		g.dataset.taskId = t.id;

		const circle = document.createElementNS(svgNS, "circle");
		circle.setAttribute("cx", String(pos.x));
		circle.setAttribute("cy", String(pos.y));
		circle.setAttribute("r", "18");
		g.appendChild(circle);

		const label = document.createElementNS(svgNS, "text");
		label.setAttribute("class", "id");
		label.setAttribute("x", String(pos.x));
		label.setAttribute("y", String(pos.y));
		label.setAttribute("text-anchor", "middle");
		label.setAttribute("dominant-baseline", "middle");
		label.textContent = t.id;
		g.appendChild(label);

		const meta = document.createElementNS(svgNS, "text");
		meta.setAttribute("class", "meta");
		meta.setAttribute("x", String(pos.x));
		meta.setAttribute("y", String(pos.y + 26));
		meta.setAttribute("text-anchor", "middle");
		let metaText = `w=${t.weight}`;
		const rIdx = rankIndex[t.id];
		const sIdx = scheduleIndex[t.id];
		const tags = [];
		if (rIdx != null) tags.push(`r${rIdx}`);
		if (sIdx != null) tags.push(`s${sIdx}`);
		if (tags.length) metaText += ` • ${tags.join("/")}`;
		meta.textContent = metaText;
		g.appendChild(meta);

		svg.appendChild(g);
	});

	container.appendChild(svg);
}

function highlightHeftTask(taskId) {
	const ganttBox = document.getElementById("heft-gantt");
	if (!ganttBox) return;
	const boxes = ganttBox.querySelectorAll(".gantt-box");
	boxes.forEach(box => {
		box.classList.remove("current");
		if (box.dataset && box.dataset.taskId === String(taskId)) {
			box.classList.add("current");
			// Ensure the highlighted HEFT task box is visible inside the
			// scrollable Gantt container.
			const container = ganttBox.parentElement;
			if (container && typeof container.scrollLeft === "number") {
				const boxRect = box.getBoundingClientRect();
				const contRect = container.getBoundingClientRect();
				const boxCenter = (boxRect.left + boxRect.right) / 2;
				const contCenter = (contRect.left + contRect.right) / 2;
				container.scrollLeft += boxCenter - contCenter;
			} else if (box.scrollIntoView) {
				box.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "center" });
			}
		}
	});
}

function highlightHeftGraphNode(taskId, kind) {
	const container = document.getElementById("heft-graph");
	if (!container) return;
	const nodes = container.querySelectorAll(".heft-node");
	const edges = container.querySelectorAll(".heft-edge");

	// Determine which tasks have already had rank_u computed and which
	// have already been scheduled up to the current teaching step.
	const rankDone = new Set();
	const schedDone = new Set();
	if (heftSimulation && heftSimulation.steps && heftSimulation.steps.length) {
		for (let i = 0; i <= heftStepIndex; i++) {
			const s = heftSimulation.steps[i];
			if (!s || !s.taskId) continue;
			if (s.kind === "rank") rankDone.add(s.taskId);
			if (s.kind === "schedule") schedDone.add(s.taskId);
		}
	}

	// Apply persistent color coding: blue-ish for tasks whose rank_u has
	// been computed, green for tasks already scheduled. The "current"
	// step gets an extra highlight ring.
	nodes.forEach(node => {
		const id = node.dataset ? node.dataset.taskId : null;
		node.classList.remove("current", "rank", "schedule");
		if (!id) return;
		if (rankDone.has(id)) node.classList.add("rank");
		if (schedDone.has(id)) node.classList.add("schedule");
	});

	edges.forEach(edge => edge.classList.remove("current"));

	const target = Array.from(nodes).find(node => node.dataset && node.dataset.taskId === String(taskId));
	if (target) {
		target.classList.add("current");

		// Highlight incoming edges for this task
		edges.forEach(edge => {
			if (edge.dataset && edge.dataset.to === String(taskId)) {
				edge.classList.add("current");
			}
		});

		// Auto-scroll the graph container so the current node is in view
		const rect = target.getBoundingClientRect();
		const contRect = container.getBoundingClientRect();
		container.scrollLeft += (rect.left + rect.right) / 2 - (contRect.left + contRect.right) / 2;
		container.scrollTop += (rect.top + rect.bottom) / 2 - (contRect.top + contRect.bottom) / 2;
	}
}

function clearHeftGraphHighlight() {
	const container = document.getElementById("heft-graph");
	if (!container) return;
	const nodes = container.querySelectorAll(".heft-node");
	nodes.forEach(node => node.classList.remove("current"));
	const edges = container.querySelectorAll(".heft-edge");
	edges.forEach(edge => edge.classList.remove("current"));
}

function clearHeftHighlight() {
	const ganttBox = document.getElementById("heft-gantt");
	if (!ganttBox) return;
	const boxes = ganttBox.querySelectorAll(".gantt-box.current");
	boxes.forEach(box => box.classList.remove("current"));
}

function showHeftStep(index) {
	if (!heftSimulation || !heftSimulation.steps || heftSimulation.steps.length === 0) {
		renderHeftStep();
		renderHeftDecisionLog();
		return;
	}
	if (index < 0) index = 0;
	if (index >= heftSimulation.steps.length) index = heftSimulation.steps.length - 1;
	heftStepIndex = index;
	renderHeftStep();
	renderHeftDecisionLog();
}

function startHeftSimulation(config) {
	const result = computeHeftSchedule(config);
	heftStepIndex = 0;

	// During HEFT teaching, also guide the viewer's attention across the
	// HEFT graph, multi-VM Gantt, and explanation panel for each step.
	if (isTeachingMode && teachingStage === "heft") {
		guideHeftFocusForCurrentStep();
	}
	heftSimulation = { result, steps: buildHeftSteps(result) };
	renderHeftResult(result);
	renderHeftGraph(result);
	showHeftStep(0);
}

function renderHeftStep() {
	const box = document.getElementById("heft-step-explanation");
	if (!box) return;
	box.innerHTML = "";

	if (!heftSimulation || !heftSimulation.steps || heftSimulation.steps.length === 0) {
		const p = document.createElement("p");
		p.textContent = 'Run a HEFT schedule, then use "Next Step" to walk through the algorithm.';
		box.appendChild(p);
		return;
	}

	if (heftStepIndex < 0) heftStepIndex = 0;
	if (heftStepIndex >= heftSimulation.steps.length) heftStepIndex = heftSimulation.steps.length - 1;

	const step = heftSimulation.steps[heftStepIndex];

	// Link text explanation with both the DAG graph and the multi-VM Gantt chart
	if (step.taskId) {
		highlightHeftGraphNode(step.taskId, step.kind);
	} else {
		clearHeftGraphHighlight();
	}
	if (step.kind === "schedule" && step.taskId) {
		highlightHeftTask(step.taskId);
	} else {
		clearHeftHighlight();
	}

	const wrapper = document.createElement("div");
	wrapper.className = "step-detail";

	const header = document.createElement("div");
	header.className = "step-header";
	header.textContent = step.title;
	wrapper.appendChild(header);

	const rule = document.createElement("div");
	rule.className = "step-rule";
	if (step.kind === "rank") {
		rule.textContent = "HEFT first computes an upward rank for each task: rank_u(i) = avgComp(i) + max_{j in succ(i)} (comm(i,j) + rank_u(j)).";
	} else {
		rule.textContent = "Then HEFT maps tasks onto processors by minimizing the earliest finish time (EFT) for each candidate processor.";
	}
	wrapper.appendChild(rule);

	const dec = document.createElement("div");
	dec.className = "step-decision";
	dec.textContent = step.text;
	wrapper.appendChild(dec);

	const formulaBox = document.createElement("div");
	formulaBox.className = "step-formula";
	if (step.kind === "rank" && step.taskId) {
		const heftResult = heftSimulation.result;
		const rankVal = heftResult && heftResult.rank ? heftResult.rank[step.taskId] : null;
		const avg = heftResult && heftResult.avgComp ? heftResult.avgComp[step.taskId] : null;
		const rankStr = rankVal != null ? rankVal.toFixed(2) : "…";
		const avgStr = avg != null ? avg.toFixed(2) : "avgComp";
		formulaBox.innerHTML = `
			<div class="formula-animate formula-heft-rank">
				<div class="formula-line" style="animation:formulaLineHighlight 0.5s 0s forwards;">
					Step 1: rank_u(i) = avgComp(i) + max_{child}(comm(i, child) + rank_u(child))
				</div>
				<div class="formula-line" style="animation:formulaLineHighlight 0.5s 0.5s forwards;">
					Step 2: avgComp(${step.taskId}) ≈ <span class="term-part1">${avgStr}</span>
				</div>
				<div class="formula-line" style="animation:formulaLineHighlight 0.5s 1s forwards;">
					Step 3: rank_u(${step.taskId}) ≈ <span class="term-result">${rankStr}</span>
				</div>
			</div>
		`;
	} else if (step.kind === "schedule" && step.taskId) {
		const heftResult = heftSimulation.result;
		const decisions = heftResult && Array.isArray(heftResult.decisions) ? heftResult.decisions : null;
		const decObj = decisions ? decisions.find(d => d.taskId === step.taskId) : null;
		if (decObj && Array.isArray(decObj.options) && decObj.options.length) {
			let html = `
				<div class="formula-animate formula-heft-schedule">
					<div class="formula-line" style="animation:formulaLineHighlight 0.5s 0s forwards;">
						Step 1: EFT(i, P) = max(available_time(P), parents_ready_on_P) + comp_time(i, P)
					</div>
			`;
			decObj.options.forEach((opt, idx) => {
				const baseStr = Number.isFinite(opt.start) ? opt.start.toFixed(1) : "base";
				const compStr = Number.isFinite(opt.compTime) ? opt.compTime.toFixed(1) : "comp";
				const endStr = Number.isFinite(opt.end) ? opt.end.toFixed(1) : "EFT";
				const delay = 0.5 * (idx + 1);
				const chosenMark = opt.processorId === decObj.chosenProcessorId ? " 9 2 chosen" : "";
				html += `
					<div class="formula-line" style="animation:formulaLineHighlight 0.5s ${delay}s forwards;">
						${opt.processorId}: EFT(${step.taskId}, ${opt.processorId}) =
						<span class="term-part1">${baseStr}</span>
						+ <span class="term-part2">${compStr}</span>
						= <span class="term-result">${endStr}</span>${chosenMark}
					</div>
				`;
			});
			const finalDelay = 0.5 * (decObj.options.length + 1);
			html += `
					<div class="formula-line" style="animation:formulaLineHighlight 0.5s ${finalDelay}s forwards;">
						Step ${decObj.options.length + 2}: HEFT chooses ${decObj.chosenProcessorId} because its EFT is the smallest.
					</div>
				</div>
			`;
			formulaBox.innerHTML = html;
		} else {
			const compTime = step.end - step.start;
			const compStr = Number.isFinite(compTime) ? compTime.toFixed(1) : "comp";
			const endStr = Number.isFinite(step.end) ? step.end.toFixed(1) : "EFT";
			formulaBox.innerHTML = `
				<div class="formula-animate formula-heft-schedule">
					EFT(${step.taskId}, ${step.processorId}) =
					<span class="term-part1">max(available_time(${step.processorId}), parents_ready_on_${step.processorId})</span>
					+ <span class="term-part2">comp_time(${step.taskId}, ${step.processorId}) = ${compStr}</span>
					= <span class="term-result">${endStr}</span>
				</div>
			`;
		}
	} else {
		formulaBox.textContent = "HEFT alternates between computing rank_u values and choosing processors based on earliest finish time.";
	}
	wrapper.appendChild(formulaBox);

	box.appendChild(wrapper);

	// Show a small live summary of HEFT tasks that have already been scheduled so far
	const result = heftSimulation.result;
	if (result && Array.isArray(result.schedule)) {
		const done = new Set();
		for (let i = 0; i <= heftStepIndex; i++) {
			const s = heftSimulation.steps[i];
			if (s.kind === "schedule" && s.taskId) {
				done.add(s.taskId);
			}
		}
		if (done.size) {
			const metricsDiv = document.createElement("div");
			metricsDiv.className = "metrics-so-far";
			const title = document.createElement("div");
			title.className = "metrics-so-far-title";
			title.textContent = "Tasks already placed on processors:";
			metricsDiv.appendChild(title);

			const table = document.createElement("table");
			table.className = "metrics-so-far-table";
			const thead = document.createElement("thead");
			thead.innerHTML = "<tr><th>Task</th><th>Processor</th><th>Start</th><th>End</th></tr>";
			table.appendChild(thead);
			const tbody = document.createElement("tbody");

			const scheduleByTask = {};
			result.schedule.forEach(seg => { scheduleByTask[seg.taskId] = seg; });
			done.forEach(id => {
				const seg = scheduleByTask[id];
				if (!seg) return;
				const row = document.createElement("tr");
				row.innerHTML = `
					<td>${seg.taskId}</td>
					<td>${seg.processorId}</td>
					<td>${seg.start.toFixed(1)}</td>
					<td>${seg.end.toFixed(1)}</td>
				`;
				tbody.appendChild(row);
			});
			table.appendChild(tbody);
			metricsDiv.appendChild(table);
			box.appendChild(metricsDiv);
		}
	}
}

// Guide focus during HEFT teaching: for each HEFT step, move the
// viewport through the DAG graph, the HEFT Gantt, and the explanation
// panel with comfortable dwell times, mirroring the CPU teaching
// behaviour.
function guideHeftFocusForCurrentStep() {
	if (!isTeachingMode || teachingStage !== "heft") return;
	const heftTab = document.getElementById("tab-heft");
	if (!heftTab || !heftTab.classList.contains("active")) return;

	if (teachingFocusTimer) {
		clearTimeout(teachingFocusTimer);
		teachingFocusTimer = null;
	}

	const graph = document.getElementById("heft-graph");
	const graphCard = graph ? graph.closest(".card") : null;
	const gantt = document.getElementById("heft-gantt");
	const ganttCard = gantt ? gantt.closest(".card") : null;
	const explanation = document.getElementById("heft-step-explanation");
	const explanationCard = explanation ? explanation.closest(".card") : null;

	const scrollOptions = { behavior: "smooth", block: "center", inline: "nearest" };

	// Phase 1: focus the DAG graph and rank/schedule structure.
	if (graphCard && typeof graphCard.scrollIntoView === "function") {
		graphCard.scrollIntoView(scrollOptions);
	}

	// Phase 2: after 2 seconds, focus the HEFT Gantt (multi-VM timeline).
	if (ganttCard && typeof ganttCard.scrollIntoView === "function") {
		teachingFocusTimer = setTimeout(() => {
			if (!isTeachingMode || teachingStage !== "heft") return;
			ganttCard.scrollIntoView(scrollOptions);

			// Phase 3: after another 2 seconds, focus the explanation panel.
			if (explanationCard && typeof explanationCard.scrollIntoView === "function") {
				teachingFocusTimer = setTimeout(() => {
					if (!isTeachingMode || teachingStage !== "heft") return;
					explanationCard.scrollIntoView(scrollOptions);
				}, 2000);
			}
		}, 2000);
	}
}

function renderHeftDecisionLog() {
	const container = document.getElementById("heft-decision-log");
	if (!container) return;
	container.innerHTML = "";

	if (!heftSimulation || !heftSimulation.steps) return;

	heftSimulation.steps.forEach((s, idx) => {
		const row = document.createElement("div");
		row.className = "decision-log-entry" + (idx === heftStepIndex ? " current" : "");
		const num = document.createElement("span");
		num.className = "time";
		num.textContent = `${idx + 1}.`;
		const title = document.createElement("span");
		title.className = "proc";
		title.textContent = s.title;
		row.appendChild(num);
		row.appendChild(title);
		container.appendChild(row);

		if (idx === heftStepIndex && row.scrollIntoView) {
			row.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "nearest" });
		}
	});
}

function heftNextStep() {
	if (!heftSimulation || !heftSimulation.steps || heftSimulation.steps.length === 0) return;
	if (heftStepIndex < heftSimulation.steps.length - 1) {
		heftStepIndex++;
	} else {
		heftStepIndex = 0;
	}
	renderHeftStep();
	renderHeftDecisionLog();
}

function startHeftTeachingStage() {
	// Ensure we have a HEFT schedule to teach
	if (!heftSimulation || !heftSimulation.steps || heftSimulation.steps.length === 0) {
		runHeftExample();
	}

	if (!heftSimulation || !heftSimulation.steps || heftSimulation.steps.length === 0) return;

	teachingStage = "heft";
	heftTeachingIndex = 0;
	showHeftStep(heftTeachingIndex);

	// We are leaving the CPU teaching focus pattern; clear any pending
	// CPU-stage focus timers so they do not interfere with HEFT.
	if (teachingFocusTimer) {
		clearTimeout(teachingFocusTimer);
		teachingFocusTimer = null;
	}

	const box = document.getElementById("heft-step-explanation");
	if (box) {
		const intro = document.createElement("p");
		intro.innerHTML = "<strong>Teaching focus (HEFT):</strong> see how rank_u and earliest finish time decide which processor each task runs on.";
		box.insertBefore(intro, box.firstChild || null);
	}

	scheduleNextHeftTeachingStep();
}

function finishTeachingModeAfterHeft() {
	const box = document.getElementById("heft-step-explanation");
	if (box) {
		const summary = document.createElement("p");
		summary.innerHTML = "<strong>Teaching mode finished.</strong> You have now seen both CPU scheduling and HEFT task mapping. Try switching tabs and running your own custom workloads.";
		box.appendChild(summary);
	}
	stopTeachingMode();
}

function scheduleNextHeftTeachingStep() {
	if (!isTeachingMode || teachingStage !== "heft") return;
	if (!heftSimulation || !heftSimulation.steps || heftSimulation.steps.length === 0) return;

	const total = heftSimulation.steps.length;
	if (heftTeachingIndex >= total - 1) {
		finishTeachingModeAfterHeft();
		return;
	}
	
	// In HEFT teaching, mirror the CPU teaching rhythm so that for each
	// HEFT step we can focus on Graph d Gantt d Explanation with
	// comfortable dwell times ( 2s + 2s + 3s = 7s per step). Allow
	// rank vs schedule steps to have slightly different pace factors.
	const baseBase = 7000;
	let factor = 1;
	const currentStep = heftSimulation.steps[heftTeachingIndex];
	if (currentStep && currentStep.kind && HEFT_TEACHING_PACE[currentStep.kind]) {
		factor = HEFT_TEACHING_PACE[currentStep.kind];
	}
	const interval = (baseBase * factor) / playSpeed;

	// In HEFT teaching, mirror the CPU teaching rhythm so that for each
	// HEFT step we can focus on Graph → Gantt → Explanation with
	// comfortable dwell times (≈ 2s + 2s + 3s = 7s per step).
	// interval is already computed above using HEFT_TEACHING_PACE.
	if (heftTeachingTimer) {
		clearTimeout(heftTeachingTimer);
	}
	heftTeachingTimer = setTimeout(() => {
		if (!isTeachingMode || teachingStage !== "heft") return;
		heftTeachingIndex++;
		showHeftStep(heftTeachingIndex);
		scheduleNextHeftTeachingStep();
	}, interval);
}

// =============================
// Teaching mode (top navigation)
// =============================

function setTeachingControlsDisabled(disabled) {
	const ids = ["btn-play", "btn-pause", "btn-step", "btn-reset", "quantum"];
	ids.forEach(id => {
		const el = document.getElementById(id);
		if (el) el.disabled = disabled;
	});
	const algoRadios = document.querySelectorAll("input[name='algo']");
	algoRadios.forEach(r => { r.disabled = disabled; });
	const teachingBtn = document.getElementById("btn-teaching-mode");
	if (teachingBtn) teachingBtn.disabled = disabled;
}

function startTeachingMode() {
	if (isTeachingMode) {
		stopTeachingMode();
		return;
	}

	if (processes.length === 0) {
		loadExample("basic");
	}

	const qInput = document.getElementById("quantum");
	if (qInput && (!qInput.value || parseInt(qInput.value, 10) <= 0)) {
		qInput.value = 2;
		onQuantumChange();
	}

	pauseSimulation();
	isTeachingMode = true;
	teachingAlgoIndex = 0;
	teachingOriginalSpeed = playSpeed;
	teachingStage = "cpu";

	// Cancel any lingering focus timers from a previous teaching run
	if (teachingFocusTimer) {
		clearTimeout(teachingFocusTimer);
		teachingFocusTimer = null;
	}

	// Reset any HEFT teaching timers/index from a previous run
	heftTeachingIndex = 0;
	if (heftTeachingTimer) {
		clearTimeout(heftTeachingTimer);
		heftTeachingTimer = null;
	}

	const speedSlider = document.getElementById("speed");
	if (speedSlider) speedSlider.value = 1;
	changeSpeed(1);

	setTeachingControlsDisabled(true);
	const btn = document.getElementById("btn-teaching-mode");
	if (btn) btn.textContent = "Stop Teaching Mode";

	switchTab("simulate");
	runCurrentTeachingAlgorithm();
}

function stopTeachingMode() {
	isTeachingMode = false;
	teachingStage = null;
	pauseSimulation();

	if (heftTeachingTimer) {
		clearTimeout(heftTeachingTimer);
		heftTeachingTimer = null;
	}
	if (teachingFocusTimer) {
		clearTimeout(teachingFocusTimer);
		teachingFocusTimer = null;
	}
	setTeachingControlsDisabled(false);
	changeSpeed(teachingOriginalSpeed);
	const speedSlider = document.getElementById("speed");
	if (speedSlider) speedSlider.value = teachingOriginalSpeed;
	const btn = document.getElementById("btn-teaching-mode");
	if (btn) btn.textContent = "Teaching Mode";
}

function runCurrentTeachingAlgorithm() {
	if (!isTeachingMode) return;
	// If we have finished all CPU algorithms, move to comparison and then HEFT
	if (teachingAlgoIndex >= TEACHING_ALGOS.length) {
		if (teachingStage === "cpu") {
			// Before moving away from CPU stage, cancel any pending CPU-focus timers
			if (teachingFocusTimer) {
				clearTimeout(teachingFocusTimer);
				teachingFocusTimer = null;
			}
			teachingStage = "compare";
			pauseSimulation();
			runComparison();
			switchTab("compare");
			const box = document.getElementById("step-explanation");
			if (box) {
				box.innerHTML = `<p><strong>Teaching: CPU algorithms recap.</strong> This table shows how each algorithm trades off waiting, turnaround, and response time on the same workload.</p>`;
			}

			// After a short pause, automatically transition to the HEFT teaching stage
			setTimeout(() => {
				if (!isTeachingMode) return;
				switchTab("heft");
				startHeftTeachingStage();
			}, 2500);
		}
		return;
	}

	teachingStage = "cpu";

	const algoKey = TEACHING_ALGOS[teachingAlgoIndex];

	const radio = document.querySelector(`input[name='algo'][value='${algoKey}']`);
	if (radio) {
		radio.checked = true;
		onAlgoChange(algoKey);
	}

	runScheduler();

	const box = document.getElementById("step-explanation");
	if (box) {
		const info = ALGO_INFO[algoKey];
		const intro = document.createElement("div");
		intro.className = "teaching-intro";
		const title = info ? info.title : algoKey.toUpperCase();
		intro.innerHTML = `
			<p><strong>Teaching focus:</strong> ${title}</p>
			<p>Watch how the highlighted bar in the Gantt chart and the CPU/Ready Queue follow this rule, and how this changes waiting and turnaround time.</p>
		`;
		box.insertBefore(intro, box.firstChild || null);
	}

	playSimulation();
	watchTeachingProgress();
}

function watchTeachingProgress() {
	if (!isTeachingMode) return;
	if (!simulation || !simulation.steps || simulation.steps.length === 0) return;

	if (!isPlaying && currentStepIndex >= simulation.steps.length - 1) {
		// One algorithm has just finished. Before moving on to the next
		// algorithm in teaching mode, pause on the Performance Metrics so
		// students can digest the results.
		teachingAlgoIndex++;
		const metricsBox = document.getElementById("metric-summary");
		const metricsCard = metricsBox ? metricsBox.closest(".card") : null;
		if (metricsCard && typeof metricsCard.scrollIntoView === "function") {
			metricsCard.scrollIntoView({ behavior: "smooth", block: "center", inline: "nearest" });
		}
		setTimeout(() => {
			if (!isTeachingMode) return;
			runCurrentTeachingAlgorithm();
		}, 4000);
	} else {
		setTimeout(() => { watchTeachingProgress(); }, 500);
	}
}

// =============================
// Tabs and Help modal
// =============================

function switchTab(tabName) {
	const buttons = document.querySelectorAll(".tab-btn");
	const contents = document.querySelectorAll(".tab-content");

	buttons.forEach(btn => {
		const tab = btn.getAttribute("data-tab");
		if (tab === tabName) btn.classList.add("active");
		else btn.classList.remove("active");
	});

	contents.forEach(section => {
		if (section.id === `tab-${tabName}`) section.classList.add("active");
		else section.classList.remove("active");
	});

	// When switching into the Simulate tab, auto-fit the main Gantt
	// timeline to the available width (unless the user has manually
	// overridden zoom), then re-render the current step.
	if (tabName === "simulate" && simulation && simulation.steps && simulation.steps.length > 0) {
		if (autoFitGantt) {
			fitMainGanttToViewport();
		}
		renderCurrentStep();
	}
}

function showHelp() {
	const modal = document.getElementById("help-modal");
	if (!modal) return;
	modal.classList.add("active");
}

function closeHelp() {
	const modal = document.getElementById("help-modal");
	if (!modal) return;
	modal.classList.remove("active");
}

// =============================
// Bootstrap
// =============================

window.addEventListener("load", () => {
	loadUserConfig();
	updateProcessTable();
	updateSimStatus("ready");

	// Ensure the correct tab is visible on first load
	switchTab("setup");
});

// Recompute auto-fit layout when the window resizes so that the
// Simulate Gantt chart continues to fit within the visible area as
// long as the user has not manually overridden the zoom level.
window.addEventListener("resize", () => {
	if (simulation && autoFitGantt) {
		fitMainGanttToViewport();
		if (simulation.steps && simulation.steps.length > 0) {
			renderCurrentStep();
		}
	}
});

