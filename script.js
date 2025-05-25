// Connect to WebSocket server running on local machine
const ws = new WebSocket("ws://localhost:3000");

// DOM Elements
const chatMessages = document.getElementById('chat-messages');
const sendBtn = document.getElementById('send-btn');
const messageInput = document.getElementById('message-input');
const videoStream = document.getElementById('videoStream');
const speedSlider = document.getElementById('speed-slider');
const speedValue = document.getElementById('speed-value');

// Connection status
const connectionDot = document.getElementById('connection-dot');
const connectionText = document.getElementById('connection-text');
const darkModeToggle = document.getElementById('dark-mode-toggle');

// Track pressed keys to prevent key repeat
const pressedKeys = new Set();
// Track current global speed
let currentGlobalSpeed = 50; // Default speed matching slider
let lastSentSpeed = 50; // Track the last speed actually sent to prevent duplicates

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

// Single, comprehensive message handler
ws.addEventListener('message', (event) => {
    if (event.data instanceof ArrayBuffer) {
        // Route binary data to audio processor
        audioStream.processChunk(event.data);
    } else if (typeof event.data === 'string') {
        // Route text data based on content
        try {
            const data = JSON.parse(event.data);
            // Route based on message type
            if (data.type === 'audio_control') {
                handleAudioControl(data);
            } else if (data.type === 'audio_metadata') {
                handleAudioMetadata(data);
            } else {
                handleRobotMessage(data);
            }
        } catch {
            handleRawTextMessage(event.data);
        }
    }
});

// FIXED: Audio control handler
function handleAudioControl(data) {
    console.log('[Audio Control]', data);
    if (data.status === 'audio_started') {
        appendMessage('System', 'Audio streaming started');
        audioStream.initializeContext();
    } else if (data.status === 'audio_stopped') {
        appendMessage('System', 'Audio streaming stopped');
    }
}

// FIXED: Audio metadata handler
function handleAudioMetadata(data) {
    console.log(`[Audio Metadata] Seq: ${data.seq}, Size: ${data.size} bytes`);
}

// Robot message handler
function handleRobotMessage(data) {
    appendMessage('Robot', JSON.stringify(data));
}

// Raw text message handler
function handleRawTextMessage(message) {
    appendMessage('Server', message);
}

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
        // Always include current speed for convenience/visibility in JSON
        payload.speed = currentGlobalSpeed;
    } else if (['pan', 'tilt'].includes(command)) {
        payload.cmd = "servo";
        payload.axis = command;
        if (value !== null) payload.angle = value;
    } else if (command === 'speed') {
        // Handle explicit speed commands
        payload.cmd = command;
        if (value !== null) {
            payload.value = value;
            lastSentSpeed = value;
            currentGlobalSpeed = value;
        }
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

// FIXED: Separate speed command function to avoid confusion
function sendSpeedCommand(speed) {
    if (!ws || ws.readyState !== WebSocket.OPEN) {
        appendMessage('System', 'Cannot send speed: Not connected to server.');
        return;
    }
    
    // Only send if speed actually changed
    if (speed !== lastSentSpeed) {
        const payload = {
            cmd: "speed",
            value: speed
        };
        
        ws.send(JSON.stringify(payload));
        appendMessage('You', `Speed: ${speed}%`);
        lastSentSpeed = speed;
        currentGlobalSpeed = speed;
    }
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
    
    sendCommand(cmd, val);
    messageInput.value = '';
}

// Dark Mode Toggle
if (darkModeToggle) {
    darkModeToggle.addEventListener('click', () => {
        const currentTheme = document.documentElement.getAttribute('data-theme');
        const icon = darkModeToggle.querySelector('i');

        if (currentTheme === 'dark') {
            document.documentElement.setAttribute('data-theme', 'light');
            if (icon) icon.classList.replace('fa-sun', 'fa-moon');
        } else {
            document.documentElement.setAttribute('data-theme', 'dark');
            if (icon) icon.classList.replace('fa-moon', 'fa-sun');
        }
    });
}

window.addEventListener('DOMContentLoaded', () => {
    // Set default theme
    document.documentElement.setAttribute('data-theme', 'dark');
    if (darkModeToggle) {
        const icon = darkModeToggle.querySelector('i');
        if (icon) {
            icon.classList.remove('fa-sun');
            icon.classList.add('fa-moon');
        }
    }
    
    // FIXED: Speed Slider Functionality - sends while dragging but prevents motor command conflicts
    const speedSlider = document.getElementById('speed-slider');
    const speedValue = document.getElementById('speed-value');

    // Track timeout for speed command debouncing
    let speedTimeout = null;

    // Update speed value display when slider changes - ALWAYS send command
    speedSlider.addEventListener('input', function() {
        const speed = parseInt(this.value);
        speedValue.textContent = `${speed}%`;
        currentGlobalSpeed = speed; // Update the global speed for future motor commands
        
        // Clear any existing timeout to prevent command spam
        if (speedTimeout) {
            clearTimeout(speedTimeout);
        }
        
        // Send speed command with minimal debouncing for responsive dragging
        speedTimeout = setTimeout(() => {
            sendSpeedCommand(speed);
        }, 25); // Very short delay for real-time feel
    });

    // Mouse/Touch events for speed adjustment - removed the isSpeedAdjusting logic
    speedSlider.addEventListener('mousedown', function() {
        // Send immediate speed command when starting to drag
        sendSpeedCommand(parseInt(this.value));
    });

    speedSlider.addEventListener('touchstart', function() {
        // Send immediate speed command when starting to drag
        sendSpeedCommand(parseInt(this.value));
    });

    // Optional: Final command on release (can remove if not needed)
    speedSlider.addEventListener('mouseup', function() {
        // Clear any pending timeout and send final command
        if (speedTimeout) {
            clearTimeout(speedTimeout);
        }
        sendSpeedCommand(parseInt(this.value));
    });

    speedSlider.addEventListener('touchend', function() {
        // Clear any pending timeout and send final command
        if (speedTimeout) {
            clearTimeout(speedTimeout);
        }
        sendSpeedCommand(parseInt(this.value));
    });

    // Keyboard controls for fine adjustment
    speedSlider.addEventListener('keydown', function(e) {
        e.preventDefault();
        
        if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') {
            this.value = Math.max(0, parseInt(this.value) - 1);
        } else if (e.key === 'ArrowRight' || e.key === 'ArrowUp') {
            this.value = Math.min(100, parseInt(this.value) + 1);
        }
        
        speedValue.textContent = `${this.value}%`;
        currentGlobalSpeed = parseInt(this.value);
        sendSpeedCommand(currentGlobalSpeed);
    });

    // Video stream setup
    if (videoStream) {
        videoStream.src = "/video/"; // This uses your server's proxy route
        
        videoStream.onerror = function() {
            console.error('Error loading video stream via proxy');
            appendMessage('System', 'Failed to load video feed via proxy. Check ESP32-CAM IP configuration.');
        };
        
        videoStream.onloadstart = function() {
            console.log('Video stream started loading...');
            appendMessage('System', 'Connecting to video feed...');
        };

        videoStream.onloadeddata = function() {
            console.log('Video stream loaded successfully');
            appendMessage('System', 'Video feed connected successfully.');
        };
    }
});

// FIXED: Audio streaming functionality with proper Web Audio Context initialization
const audioStream = {
  active: false,
  context: null,
  sampleRate: 8000, // Ensure this matches ESP32's sample rate
  
  async initializeContext() {
    if (!this.context) {
      try {
        this.context = new (window.AudioContext || window.webkitAudioContext)({
          sampleRate: this.sampleRate
        });
        
        // Resume context if it's suspended (browser autoplay policy)
        if (this.context.state === 'suspended') {
          await this.context.resume();
        }
        
        console.log(`[Audio] Context initialized - Sample Rate: ${this.context.sampleRate}Hz`);
      } catch (error) {
        console.error('[Audio] Failed to initialize context:', error);
        appendMessage('System', 'Failed to initialize audio context');
      }
    }
  },
  
  start: function() {
    if (!this.active) {
      console.log("[Audio] Sending start command to server...");
      ws.send(JSON.stringify({ 
        cmd: 'start_audio',
        timestamp: Date.now()
      }));
      this.active = true;
    }
  },

  stop: function() {
    if (this.active) {
      ws.send(JSON.stringify({ cmd: 'stop_audio' }));
      this.active = false;
      if (this.context) {
        this.context.close().then(() => {
          this.context = null;
          console.log("[Audio] Context closed. Streaming stopped.");
        });
      }
    }
  },

  processChunk: function(audioData) {
    if (!this.active || !this.context) {
      console.log("[Audio] Received data but no context - initializing...");
      this.initializeContext();
      return;
    }

    try {
      const intArray = new Int16Array(audioData);
      const floatArray = new Float32Array(intArray.length);
      
      for (let i = 0; i < intArray.length; i++) {
        floatArray[i] = intArray[i] / 32768.0; // Normalize to [-1, 1]
      }

      const buffer = this.context.createBuffer(1, floatArray.length, this.sampleRate);
      buffer.getChannelData(0).set(floatArray);
      
      const source = this.context.createBufferSource();
      source.buffer = buffer;
      source.connect(this.context.destination);
      source.start(this.context.currentTime);
      
      console.log(`[Audio] Played chunk (${audioData.byteLength} bytes)`);
    } catch (error) {
      console.error("[Audio] Error processing chunk:", error);
    }
  }
};

// Enhanced console interface with user permission handling
window.start_audio = async () => {
  try {
    // Request user permission for audio
    await audioStream.initializeContext();
    audioStream.start();
  } catch (error) {
    console.error('Failed to start audio:', error);
    appendMessage('System', 'Failed to start audio - check browser permissions');
  }
};

window.stop_audio = () => audioStream.stop();

console.log("------------------------------------------");
console.log("Audio Control Commands:");
console.log("start_audio() - Start audio streaming");
console.log("stop_audio()  - Stop audio streaming");
console.log("------------------------------------------");