const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const axios = require('axios');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// Serve static files (your web UI, etc)
app.use(express.static(__dirname));

// CORS middleware (optional, keep if needed)
app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept");
  next();
});

// 🔧 IMPORTANT: Update this IP address to match your ESP32-CAM's actual IP
const ESP32_CAM_IP = '192.168.1.100'; // 🔄 CHANGE THIS TO YOUR ESP32-CAM IP
const ESP32_STREAM_URL = `http://${ESP32_CAM_IP}/stream`;

console.log(`📷 ESP32-CAM configured for IP: ${ESP32_CAM_IP}`);
console.log(`📡 Stream URL: ${ESP32_STREAM_URL}`);

wss.on('connection', (socket, req) => {
  const clientIP = req.socket.remoteAddress;
  console.log(`✅ Client connected: ${clientIP}`);

  // Audio state tracking
  let audioStreamActive = false;
  let lastAudioTimestamp = 0;
  let audioSequence = 0;
  let bytesReceived = 0;
  let lastBandwidthCheck = Date.now();

  socket.on('message', (message, isBinary) => {
    try {
      if (isBinary) {
        if (!audioStreamActive) {
          console.log(`⚠️ Ignoring audio from ${clientIP} - stream not active`);
          return;
        }

        // Validate audio chunk
        if (message.length > 1024 * 1024) {
          throw new Error('Audio data too large');
        }

        // Throttle if needed
        const now = Date.now();
        if (now - lastAudioTimestamp < 50) return;
        lastAudioTimestamp = now;

        // Update bandwidth stats
        bytesReceived += message.length;

        // Broadcast with metadata
        const metadata = JSON.stringify({
          type: 'audio',
          timestamp: now,
          size: message.length,
          seq: audioSequence++
        });

        wss.clients.forEach(client => {
          if (client !== socket && client.readyState === WebSocket.OPEN) {
            client.send(metadata);
            client.send(message, { binary: true });
          }
        });

        // Log bandwidth periodically
        if (now - lastBandwidthCheck > 5000) {
          const kbps = (bytesReceived * 8 / 1024 / 5).toFixed(2);
          console.log(`📊 Audio bandwidth: ${kbps} kbps`);
          bytesReceived = 0;
          lastBandwidthCheck = now;
        }
        return;
      }

      // JSON message handling
      let data;
      try {
        data = JSON.parse(message.toString());
        console.log(`📨 Received from client ${clientIP}:`, data);
        
        if (data.command === 'start_audio' || data.cmd === 'start_audio') {
  audioStreamActive = true;
  console.log(`🎤 Audio streaming enabled for ${clientIP}`);
  // Send confirmation with proper type
  socket.send(JSON.stringify({ 
    type: 'audio_control',
    status: 'audio_started',
    timestamp: Date.now()
  }));
} else if (data.command === 'stop_audio' || data.cmd === 'stop_audio') {
  audioStreamActive = false;
  console.log(`🔇 Audio streaming disabled for ${clientIP}`);
  socket.send(JSON.stringify({ 
    type: 'audio_control',
    status: 'audio_stopped',
    timestamp: Date.now()
  }));
}

        // Broadcast JSON messages to other clients
        wss.clients.forEach(client => {
          if (client !== socket && client.readyState === WebSocket.OPEN) {
            client.send(JSON.stringify(data));
          }
        });

      } catch (err) {
        console.error(`⚠️ Invalid JSON from ${clientIP}:`, err.message);
      }

    } catch (err) {
      console.error(`❌ Error handling message from ${clientIP}:`, err.message);
    }
  });

  socket.on('close', () => {
    console.log(`🔌 Client disconnected: ${clientIP}`);
    audioStreamActive = false; // Clean up audio state
  });

  socket.on('error', (err) => {
    console.error(`❌ WebSocket error from ${clientIP}:`, err);
    audioStreamActive = false;
  });
});

// MJPEG proxy route for frontend - this allows your web page to access the camera stream
app.get('/video/', async (req, res) => {
  console.log(`📷 MJPEG client connected - proxying from ${ESP32_STREAM_URL}`);

  try {
    const response = await axios({
      method: 'get',
      url: ESP32_STREAM_URL,
      responseType: 'stream',
      timeout: 10000, // 10 second timeout
    });

    // Set proper headers for MJPEG stream
    res.setHeader('Content-Type', 'multipart/x-mixed-replace; boundary=frame');
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    
    // Pipe the ESP32 stream to the client
    response.data.pipe(res);

    // Handle client disconnect
    req.on('close', () => {
      console.log('📴 MJPEG client disconnected');
      if (response.data && !response.data.destroyed) {
        response.data.destroy();
      }
    });

    // Handle ESP32 connection errors
    response.data.on('error', (err) => {
      console.error('❌ ESP32 stream error:', err.message);
      if (!res.headersSent) {
        res.status(502).send('ESP32 camera stream error');
      }
    });

  } catch (err) {
    console.error('❌ Failed to connect to ESP32-CAM:', err.message);
    
    let errorMessage = 'Unable to connect to ESP32-CAM. ';
    if (err.code === 'ECONNREFUSED') {
      errorMessage += `Check if ESP32-CAM is running and accessible at ${ESP32_CAM_IP}`;
    } else if (err.code === 'ETIMEDOUT') {
      errorMessage += 'Connection timed out. Check network connectivity.';
    } else {
      errorMessage += err.message;
    }
    
    res.status(502).send(errorMessage);
  }
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    esp32_cam_url: ESP32_STREAM_URL,
    connected_clients: wss.clients.size
  });
});

// ESP32-CAM status check endpoint
app.get('/camera-status', async (req, res) => {
  try {
    const response = await axios.get(`http://${ESP32_CAM_IP}/status`, { timeout: 5000 });
    res.json({ status: 'connected', esp32_response: response.data });
  } catch (err) {
    res.status(502).json({ 
      status: 'disconnected', 
      error: err.message,
      esp32_cam_ip: ESP32_CAM_IP
    });
  }
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`🌐 Server running at http://localhost:${PORT}`);
  console.log(`🛰️ WebSocket server ready at ws://localhost:${PORT}`);
  console.log(`📷 MJPEG proxy available at http://localhost:${PORT}/video/`);
  console.log(`🔧 Update ESP32_CAM_IP in server.js to match your ESP32-CAM's IP address`);
  console.log(`📡 Current ESP32-CAM IP: ${ESP32_CAM_IP}`);
});