// Connect to WebSocket server running on local machine
const ws = new WebSocket("ws://localhost:3000"); // Changed to localhost since your server runs on same machine

// DOM Elements
const chatMessages = document.getElementById('chat-messages');
const sendBtn = document.getElementById('send-btn');
const messageInput = document.getElementById('message-input');
const videoStream = document.getElementById('videoStream');

// Connection status
const connectionDot = document.getElementById('connection-dot');
const connectionText = document.getElementById('connection-text');
const darkModeToggle = document.getElementById('dark-mode-toggle');

// Track pressed keys to prevent key repeat
const pressedKeys = new Set();

// On open
ws.addEventListener('open', () => {
    appendMessage('System', 'Connected to control server.');
    if (connectionDot) connectionDot.classList.add('connected');
    if (connectionText) connectionText.textContent = 'Connected';
});

// On close
ws.addEventListener('close', () => {
    appendMessage('System', 'Disconnected from control server. Check server IP and ensure it is running.');
    if (connectionDot) connectionDot.classList.remove('connected');
    if (connectionText) connectionText.textContent = 'Disconnected';
});

// On error
ws.addEventListener('error', (error) => {
    appendMessage('System', 'WebSocket Error. Check console for details.');
    console.error('WebSocket Error:', error);
    if (connectionDot) connectionDot.classList.remove('connected');
    if (connectionText) connectionText.textContent = 'Error';
});

// *** NEW: Handle incoming messages from backend/ESP32 ***
ws.addEventListener('message', (event) => {
    try {
        const data = JSON.parse(event.data);
        appendMessage('Robot', JSON.stringify(data));
    } catch {
        appendMessage('Robot', event.data);
    }
});

function appendMessage(sender, text) {
    if (!chatMessages) {
        console.error("Error: chat-messages element not found in HTML.");
        return;
    }
    const msgDiv = document.createElement('div');
    msgDiv.className = `message ${sender === 'System' ? 'system' : 'user'}`;

    msgDiv.innerHTML = `
        <div class="message-content"><strong>${sender}:</strong> ${text}</div>
        <div class="message-time">${new Date().toLocaleTimeString()}</div>
    `;
    chatMessages.appendChild(msgDiv);
    chatMessages.scrollTop = chatMessages.scrollHeight;
}

function sendCommand(command, value = null) {
    if (!ws || ws.readyState !== WebSocket.OPEN) {
        appendMessage('System', 'Cannot send command: Not connected to server.');
        return;
    }
    // Build payload matching ESP32 expectations
    let payload = {};

    if (['forward', 'reverse', 'left', 'right', 'stop'].includes(command)) {
        payload.cmd = "motor";
        // ESP32 expects 'backward' instead of 'reverse'
        payload.action = (command === 'reverse') ? 'backward' : command;
        // optionally send speeds if you want, else defaults on ESP32 will be used
        // payload.speedL = 100;
        // payload.speedR = 100;
    } else if (['pan', 'tilt'].includes(command)) {
        payload.cmd = "servo";
        payload.axis = command;
        if (value !== null) payload.angle = value;
    } else {
        payload.cmd = command;
        if (value !== null) payload.value = value;
    }

    ws.send(JSON.stringify(payload));
    appendMessage('You', `${command}${value !== null ? `: ${value}` : ''}`);
}

function sendPanTiltCommand(axis, angle) {
    if (!ws || ws.readyState !== WebSocket.OPEN) {
        appendMessage('System', 'Cannot send command: Not connected to server.');
        return;
    }
    
    const payload = {
        cmd: "servo",
        axis: axis,
        angle: angle
    };
    
    ws.send(JSON.stringify(payload));
    appendMessage('You', `${axis}: ${angle}°`);
}

// Button click events
document.querySelectorAll('[data-command]').forEach(button => {
    button.addEventListener('click', () => {
        const cmd = button.dataset.command;
        sendCommand(cmd);
    });
});

// Keyboard Events (WASD for motors, IJKL for pan/tilt)
const keyMap = {
    'w': 'forward',
    'a': 'left',
    's': 'reverse',
    'd': 'right',
    'i': 'tilt',      // Tilt up
    'j': 'pan',       // Pan left
    'k': 'tilt',      // Tilt down
    'l': 'pan'        // Pan right
};

// Pan/Tilt state tracking
let currentPanAngle = 90;  // Start at center position
let currentTiltAngle = 90; // Start at center position
const panTiltStep = 5;     // Degrees to move per step
const panTiltInterval = 100; // Milliseconds between steps when holding key
const panTiltIntervals = {}; // Store interval IDs

// Define pan/tilt directions with degree increments
const panTiltDirections = {
    'i': { command: 'tilt', increment: panTiltStep },    // Tilt up (increase angle)
    'j': { command: 'pan', increment: -panTiltStep },    // Pan left (decrease angle)
    'k': { command: 'tilt', increment: -panTiltStep },   // Tilt down (decrease angle)
    'l': { command: 'pan', increment: panTiltStep }      // Pan right (increase angle)
};

document.addEventListener('keydown', (e) => {
    const key = e.key.toLowerCase();
    const isTyping = document.activeElement === messageInput;

    if (!isTyping && keyMap[key] && !pressedKeys.has(key)) {
        e.preventDefault();
        pressedKeys.add(key);
        
        // Handle WASD (motor commands)
        if (['w', 'a', 's', 'd'].includes(key)) {
            sendCommand(keyMap[key]);
        }
        // Handle IJKL (pan/tilt commands with continuous movement)
        else if (['i', 'j', 'k', 'l'].includes(key)) {
            const panTiltInfo = panTiltDirections[key];
            
            // Update angle based on increment
            if (panTiltInfo.command === 'pan') {
                currentPanAngle = Math.max(0, Math.min(180, currentPanAngle + panTiltInfo.increment));
                sendPanTiltCommand('pan', currentPanAngle);
                
                // Set up continuous movement while key is held
                panTiltIntervals[key] = setInterval(() => {
                    currentPanAngle = Math.max(0, Math.min(180, currentPanAngle + panTiltInfo.increment));
                    sendPanTiltCommand('pan', currentPanAngle);
                }, panTiltInterval);
                
            } else if (panTiltInfo.command === 'tilt') {
                currentTiltAngle = Math.max(0, Math.min(180, currentTiltAngle + panTiltInfo.increment));
                sendPanTiltCommand('tilt', currentTiltAngle);
                
                // Set up continuous movement while key is held
                panTiltIntervals[key] = setInterval(() => {
                    currentTiltAngle = Math.max(0, Math.min(180, currentTiltAngle + panTiltInfo.increment));
                    sendPanTiltCommand('tilt', currentTiltAngle);
                }, panTiltInterval);
            }
        }
    }
}, true);

document.addEventListener('keyup', (e) => {
    const key = e.key.toLowerCase();
    const isTyping = document.activeElement === messageInput;

    if (!isTyping && keyMap[key] && pressedKeys.has(key)) {
        e.preventDefault();
        pressedKeys.delete(key);
        
        // Handle WASD (send stop for motors)
        if (['w', 'a', 's', 'd'].includes(key)) {
            sendCommand('stop');
        }
        // Handle IJKL (stop continuous pan/tilt movement)
        else if (['i', 'j', 'k', 'l'].includes(key)) {
            if (panTiltIntervals[key]) {
                clearInterval(panTiltIntervals[key]);
                delete panTiltIntervals[key];
            }
        }
    }
}, true);

// Chat Input Handling
if (sendBtn && messageInput) {
    sendBtn.addEventListener('click', handleChatInput);
    messageInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            handleChatInput();
        }
    });
}

function handleChatInput() {
    const input = messageInput.value.trim();
    if (!input) return;

    const parts = input.split(':');
    const cmd = parts[0].trim().toLowerCase();
    const valStr = parts.length > 1 ? parts[1].trim() : null;
    let val = null;

    if (valStr !== null) {
        val = parseInt(valStr, 10);
        if (isNaN(val)) val = valStr;
    }
    
    const validCommands = ['forward', 'reverse', 'left', 'right', 'stop', 'pan', 'tilt'];
    if (validCommands.includes(cmd)) {
        sendCommand(cmd, val);
    } else {
        appendMessage('System', `Unknown command: ${cmd}. Valid commands: ${validCommands.join(', ')}`);
    }

    messageInput.value = '';
}

// Dark Mode Toggle
if (darkModeToggle) {
    darkModeToggle.addEventListener('click', () => {
        const currentTheme = document.documentElement.getAttribute('data-theme');
        const icon = darkModeToggle.querySelector('i');

        if (currentTheme === 'dark') {
            document.documentElement.setAttribute('data-theme', 'light');
            localStorage.setItem('theme', 'light');
            if (icon) icon.classList.replace('fa-sun', 'fa-moon');
        } else {
            document.documentElement.setAttribute('data-theme', 'dark');
            localStorage.setItem('theme', 'dark');
            if (icon) icon.classList.replace('fa-moon', 'fa-sun');
        }
    });
}

window.addEventListener('DOMContentLoaded', () => {
    // Theme persistence
    const savedTheme = localStorage.getItem('theme') || 'light';
    document.documentElement.setAttribute('data-theme', savedTheme);
    if (darkModeToggle) {
        const icon = darkModeToggle.querySelector('i');
        if (icon) {
            if (savedTheme === 'dark') {
                icon.classList.remove('fa-moon');
                icon.classList.add('fa-sun');
            } else {
                icon.classList.remove('fa-sun');
                icon.classList.add('fa-moon');
            }
        }
    }

    // Load MJPG stream from ESP32-CAM
    if (videoStream) {
        videoStream.src = "http://192.168.15.146/stream";
        
        videoStream.onerror = function() {
            console.error('Error loading video stream');
            appendMessage('System', 'Failed to load video feed. Check ESP32-CAM connection.');
        };
        
        videoStream.onload = function() {
            console.log('Video stream loaded successfully');
        };
    }
});